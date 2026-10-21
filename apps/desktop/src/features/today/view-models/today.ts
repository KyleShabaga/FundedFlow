// Today (Build 21): what the latest saved Build 16 calculation can honestly say about an account attempt now. Pure
// mapping only. Every figure is the engine's own recorded value (EngineResult); nothing here adds, subtracts or
// classifies risk. The one judgement made here is whether a saved estimate is *current*: an unchanged-inputs check
// (useCalculationFreshness "current") only says the sources for the original cutoff are unchanged, so Today also
// requires the same Rust-derived trading day, no newer trades, checkpoints or ledger movements after the cutoff and
// the rulebook version in force now. Anything else is "not current" and shows as Unknown, never as the old Safe.
import {
  isRiskEligible,
  tradeSchema,
  type AccountRiskInputs,
  type EngineResult,
  type FinancialObservation,
  type Reconciliation,
  type RuleOutcome,
  type RuleType,
  type Trade,
} from "@fundedflow/domain";
import { z } from "zod";

import type { MetricValue, StatusKind } from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import type { SnapshotViewModel } from "../../insights/view-models/snapshot";
import { recordedEngineResult, type Freshness } from "../../rulebooks/api/risk";
import { ASSURANCE, RESULT_STATUS, reasonText } from "../../rulebooks/view-models/engine-wording";

export type RiskCategory = EngineResult["status"];

/** Why a saved estimate is not the current one. */
export type StaleReason = "sources-changed" | "earlier-trading-day" | "newer-data" | "other-rulebook-version";

/** A query's facts as Today reads them: still loading, unreadable, or a value. */
export type Loadable<T> = { state: "loading" } | { state: "error" } | { state: "ready"; value: T };

export type RiskTruth =
  /** Failed, passed, closed, paused or archived: history, never part of today's risk. */
  | { kind: "historical" }
  | { kind: "checking" }
  /** The saved calculation itself could not be read. */
  | { kind: "read-failed" }
  | { kind: "none" }
  /** Saved before the Build 16 engine: shown as recorded, never as a status. */
  | { kind: "legacy"; snapshot: SnapshotViewModel }
  /** Its sources could not be re-read, so it cannot be called current. */
  | { kind: "check-failed"; snapshot: SnapshotViewModel; result: EngineResult }
  | { kind: "stale"; snapshot: SnapshotViewModel; result: EngineResult; reasons: StaleReason[]; newer: NewerData }
  | { kind: "current"; snapshot: SnapshotViewModel; result: EngineResult };

export interface NewerData {
  trades: number;
  checkpoints: number;
  ledger: number;
}

export interface TruthInput {
  account: Pick<AccountViewModel, "id" | "status" | "archivedAt">;
  snapshot: Loadable<SnapshotViewModel | null>;
  /** Unchanged-inputs check for the snapshot's own cutoff (useCalculationFreshness). */
  freshness: Loadable<Freshness>;
  /** Canonical inputs read now (Rust trading day, records and the assignment in force). */
  facts: Loadable<AccountRiskInputs>;
}

const after = (a: string | null, b: string) => a !== null && Date.parse(a) > Date.parse(b);

/** Records the saved cutoff could not have seen: anything effective after its as-of instant. */
export function newerThan(result: Pick<EngineResult, "asOf">, facts: Pick<AccountRiskInputs, "trades" | "observations" | "ledger">): NewerData {
  return {
    trades: facts.trades.filter(t => after(t.exitAt ?? t.entryAt, result.asOf)).length,
    checkpoints: facts.observations.filter(o => after(o.observedAt, result.asOf)).length,
    ledger: facts.ledger.filter(e => after(e.effectiveAt, result.asOf)).length,
  };
}

export function deriveRiskTruth({ account, snapshot, freshness, facts }: TruthInput): RiskTruth {
  if (!isRiskEligible(account)) return { kind: "historical" };
  if (snapshot.state === "loading") return { kind: "checking" };
  if (snapshot.state === "error") return { kind: "read-failed" };
  const saved = snapshot.value;
  if (saved === null) return { kind: "none" };
  // The view model already refuses another account's snapshot; this keeps Today honest if that ever changes.
  if (saved.accountId !== account.id) return { kind: "read-failed" };
  const recorded = recordedEngineResult(saved.explanation);
  if (!recorded || recorded.result.accountId !== account.id) return { kind: "legacy", snapshot: saved };
  const result = recorded.result;
  if (freshness.state === "loading" || facts.state === "loading") return { kind: "checking" };
  if (freshness.state === "error" || facts.state === "error" || freshness.value.kind === "not-engine") return { kind: "check-failed", snapshot: saved, result };
  const now = facts.value;
  if (now.account.id !== account.id) return { kind: "check-failed", snapshot: saved, result };
  const reasons: StaleReason[] = [];
  if (freshness.value.kind === "changed") reasons.push("sources-changed");
  if (result.tradingDay !== now.effectiveTradingDay) reasons.push("earlier-trading-day");
  const newer = newerThan(result, now);
  if (newer.trades + newer.checkpoints + newer.ledger > 0) reasons.push("newer-data");
  if ((now.applicableAssignment?.rulebookVersionId ?? null) !== result.rulebookVersionId) reasons.push("other-rulebook-version");
  return reasons.length ? { kind: "stale", snapshot: saved, result, reasons, newer } : { kind: "current", snapshot: saved, result };
}

export const STALE_TEXT: Record<StaleReason, string> = {
  "sources-changed": "Trades, checkpoints, ledger or rules it used have changed since it was calculated.",
  "earlier-trading-day": "It was calculated for an earlier trading day.",
  "newer-data": "Records dated after its cutoff exist (newer trades, checkpoints or ledger movements).",
  "other-rulebook-version": "Another rulebook version (or none) applies now.",
};

export interface Headline {
  /** The risk category shown, or null when no category applies (checking, historical). */
  category: RiskCategory | null;
  label: string;
  status: StatusKind;
  detail: string;
  /** Plain words for what the last saved calculation said, when it is not the current one. */
  lastRecorded: string | null;
}

const recordedLine = (r: EngineResult) => `Last saved estimate: ${RESULT_STATUS[r.status].label} for trading day ${r.tradingDay}.`;

/**
 * The status Today leads with. Only a current calculation shows its own Safe or Caution. A Stop recorded earlier is
 * never cleared by time passing or a failed check: it stays Stop, marked not current, until a new calculation.
 */
export function headline(truth: RiskTruth): Headline {
  const unknown = (label: string, detail: string, lastRecorded: string | null = null): Headline => ({ category: "Unknown", label, status: "unknown", detail, lastRecorded });
  switch (truth.kind) {
    case "historical":
      return { category: null, label: "Not in today's risk", status: "neutral", detail: "This attempt isn't active, so it is history only. Nothing here is a current estimate.", lastRecorded: null };
    case "checking":
      return { category: null, label: "Checking…", status: "neutral", detail: "Checking the last saved estimate against this account's records.", lastRecorded: null };
    case "read-failed":
      return unknown("Unknown", "The saved calculation couldn't be read.");
    case "none":
      return unknown("Unknown", "Nothing has been calculated for this account yet.");
    case "legacy":
      return unknown("Unknown", "The last saved calculation predates the rules engine, so it gives no status.");
    case "check-failed":
    case "stale": {
      const why = truth.kind === "stale" ? truth.reasons.map(r => STALE_TEXT[r]).join(" ") : "Its sources couldn't be checked again.";
      if (truth.result.status === "Stop") return { category: "Stop", label: "Stop (last saved, not current)", status: "danger", detail: `A Stop was recorded and is never cleared without a new calculation. ${why}`, lastRecorded: recordedLine(truth.result) };
      return unknown("Unknown", `The last saved estimate is not current. ${why}`, recordedLine(truth.result));
    }
    case "current":
      return { category: truth.result.status, label: RESULT_STATUS[truth.result.status].label, status: RESULT_STATUS[truth.result.status].kind, detail: ASSURANCE[truth.result.assurance], lastRecorded: null };
  }
}

/* ---------- Metrics ---------- */

export type MetricKey = "balance" | "dayPnl" | "target" | "dailyLoss" | "drawdown" | "tradingDays" | "consistency" | "equity";
export type MetricState = "known" | "unknown" | "unsupported" | "manual" | "stale-source" | "conflicting" | "not-applicable" | "no-rule" | "ambiguous";

export interface TodayMetric {
  key: MetricKey;
  label: string;
  value: MetricValue;
  state: MetricState;
  /** One line under the value: the limit, floor or target it is measured against, or why it is unknown. */
  sub: string | null;
  /** What the value is calculated from. */
  basis: string;
  /** The engine's outcome for the rule behind it (null for account-wide values). */
  outcome: RuleOutcome | null;
  /** Rule type behind it, to label "no rule" honestly. */
  ruleType: RuleType | null;
}

const STATE_OF: Record<RuleOutcome["state"], MetricState> = {
  satisfied: "known", breached: "known", caution: "known",
  unknown: "unknown", unsupported: "unsupported", manual_only: "manual", stale: "stale-source", conflicting: "conflicting",
  not_applicable: "not-applicable", absent: "not-applicable", disabled: "not-applicable",
};
const STATE_WORD: Record<Exclude<MetricState, "known">, string> = {
  unknown: "Unknown", unsupported: "Not supported", manual: "Manual check", "stale-source": "Stale source", conflicting: "Conflicting",
  "not-applicable": "Not applicable", "no-rule": "No rule", ambiguous: "Several rules",
};
export const metricStateWord = (state: MetricState) => (state === "known" ? null : STATE_WORD[state]);

type Amount = string | number | boolean | null | undefined;
const text = (v: Amount) => (typeof v === "string" ? v : null);

function money(amount: string | null, currency: string, signed = true): MetricValue {
  return { kind: "money", amount, currency, signed };
}

function ruleMetric(result: EngineResult, type: RuleType, key: MetricKey, label: string, basis: string,
  pick: (o: RuleOutcome) => { value: MetricValue; sub: string | null }): TodayMetric {
  const rules = result.rules.filter(r => r.ruleType === type);
  const base = { key, label, basis, ruleType: type };
  if (rules.length === 0) return { ...base, state: "no-rule", outcome: null, value: { kind: "unavailable", reason: "The rulebook has no rule of this kind." }, sub: null };
  if (rules.length > 1) return { ...base, state: "ambiguous", outcome: null, value: { kind: "unavailable", reason: "Several rules of this kind: see the full calculation." }, sub: null };
  const outcome = rules[0]!;
  const state = STATE_OF[outcome.state];
  if (state !== "known") return { ...base, state, outcome, value: { kind: "unavailable", reason: reasonText(outcome.reasonCode) }, sub: null };
  const picked = pick(outcome);
  // A rule the engine evaluated but without this figure (e.g. headroom on an unobserved equity basis) stays unknown.
  if ((picked.value.kind === "money" && picked.value.amount == null) || (picked.value.kind === "count" && picked.value.value == null))
    return { ...base, state: "unknown", outcome, value: { kind: "unavailable", reason: reasonText(outcome.reasonCode) }, sub: picked.sub };
  return { ...base, state, outcome, ...picked };
}

/** "$3,000.00" style operand text for sub lines, formatted by the caller's money formatter. */
export type MoneyText = (amount: string | null) => string;

/** Today's figures, each straight from the engine result. Unknown stays unknown: never zero, never Safe. */
export function metricsOf(result: EngineResult, currency: string, fmt: MoneyText): TodayMetric[] {
  const breached = (o: RuleOutcome) => (o.state === "breached" ? "Limit reached. " : "");
  return [
    {
      key: "balance", label: "Last known balance", basis: "Opening checkpoint + closed trades + ledger. Not live equity.",
      value: money(result.balance, currency, false), state: result.balance === null ? "unknown" : "known", outcome: null, ruleType: null,
      sub: result.balance === null ? "Needs a confirmed opening balance and history stated complete." : null,
    },
    {
      key: "dayPnl", label: "Realized P&L today", basis: `Closed trades on trading day ${result.tradingDay}, after fees.`,
      value: money(result.realizedDayPnl, currency), state: result.realizedDayPnl === null ? "unknown" : "known", outcome: null, ruleType: null,
      sub: result.realizedDayPnl === null ? "Some of the day's trades have no P&L, or the history is incomplete." : null,
    },
    ruleMetric(result, "profit_target", "target", "Profit target progress", "Qualified balance − opening checkpoint.", o => ({
      value: money(text(o.metrics.profit), currency),
      sub: o.metrics.attained === true ? `Target ${fmt(text(o.metrics.profitTarget))} reached.` : `Target ${fmt(text(o.metrics.profitTarget))} · ${fmt(text(o.metrics.remaining))} to go.`,
    })),
    ruleMetric(result, "daily_loss_limit", "dailyLoss", "Daily loss room left", "Daily limit + today's realized P&L.", o => ({
      value: money(text(o.metrics.dailyLossRemaining), currency, false),
      sub: `${breached(o)}Daily limit ${fmt(text(o.metrics.dailyLossLimit))}.`,
    })),
    ruleMetric(result, "max_drawdown", "drawdown", "Drawdown headroom", "Comparable balance − drawdown floor.", o => ({
      value: money(text(o.metrics.drawdownHeadroom), currency, false),
      sub: `${breached(o)}Floor ${fmt(text(o.metrics.drawdownFloor))}${o.metrics.drawdownLocked === true ? " (locked)" : ""}.`,
    })),
    ruleMetric(result, "min_trading_days", "tradingDays", "Qualifying trading days", "Distinct Rust trading days meeting the rule's minimum.", o => ({
      value: { kind: "count", value: typeof o.metrics.tradingDaysCompleted === "number" ? o.metrics.tradingDaysCompleted : null, unit: typeof o.metrics.tradingDaysRequired === "number" ? `of ${o.metrics.tradingDaysRequired}` : undefined },
      sub: o.metrics.attained === true ? "Minimum reached." : "Minimum not reached yet.",
    })),
    ruleMetric(result, "consistency", "consistency", "Consistency", "Best day's profit against the rule's share.", o => ({
      value: { kind: "text", text: o.metrics.attained === true ? "Within the rule" : "Needs more profit" },
      sub: `Best day ${fmt(text(o.metrics.bestDayProfit))} of ${fmt(text(o.metrics.denominator))}.`,
    })),
    {
      key: "equity", label: "Open P&L and live equity", basis: "Needs open positions, which FundedFlow doesn't record.",
      value: { kind: "unavailable", reason: "Not recorded: closed-trade exports don't show open positions or intraday peaks." }, state: "unsupported", outcome: null, ruleType: null, sub: null,
    },
  ];
}

/* ---------- Contributing records ---------- */

const recordedTrades = z.array(tradeSchema);

/**
 * Closed trades the saved calculation used for a metric, from the inputs frozen into the snapshot (not today's
 * trades). Day figures list the calculation's trading day only. Newest exit first.
 */
export function contributingTrades(explanation: Record<string, unknown>, result: EngineResult, metric: Pick<TodayMetric, "key" | "outcome">): Trade[] {
  const parsed = recordedTrades.safeParse((explanation.inputs as { trades?: unknown } | undefined)?.trades);
  if (!parsed.success) return [];
  const refs = new Set(metric.outcome?.sourceReferences ?? result.sourceReferences);
  const daily = metric.key === "dayPnl" || metric.key === "dailyLoss";
  return parsed.data
    .filter(t => t.accountId === result.accountId && refs.has(t.id) && t.exitAt !== null && (!daily || t.tradingDay === result.tradingDay))
    .sort((a, b) => Date.parse(b.exitAt!) - Date.parse(a.exitAt!));
}

/** The completeness the trader stated for the saved calculation, as recorded with it. */
export function statedCoverage(explanation: Record<string, unknown>): Record<"closedTrades" | "fees" | "ledger", string> | null {
  const coverage = recordedEngineResult(explanation)?.coverage;
  return coverage ? { closedTrades: coverage.closedTrades, fees: coverage.fees, ledger: coverage.ledger } : null;
}

/* ---------- Checkpoints and comparisons ---------- */

const BALANCE_KINDS = new Set<FinancialObservation["kind"]>(["opening_balance", "balance", "eod_settlement", "equity"]);

/** Observations still in force: an original replaced by a correction is history, not current evidence. */
export function currentObservations(observations: readonly FinancialObservation[]): FinancialObservation[] {
  const replaced = new Set(observations.map(o => o.supersedesId).filter((v): v is string => v !== null));
  return observations.filter(o => !replaced.has(o.id));
}

export interface CheckpointSummary {
  /** Newest checkpoint with a value, by when it was observed (not recorded). */
  latest: FinancialObservation | null;
  /** The confirmed opening balance a comparison measures from (newest when several). */
  opening: FinancialObservation | null;
  /** Checkpoints of the same kind and moment that disagree. */
  conflicts: FinancialObservation[][];
}

export function checkpointSummary(observations: readonly FinancialObservation[]): CheckpointSummary {
  const live = currentObservations(observations).filter(o => BALANCE_KINDS.has(o.kind));
  const byTime = (a: FinancialObservation, b: FinancialObservation) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || (a.recordedAt < b.recordedAt ? 1 : -1);
  const withValue = live.filter(o => o.value !== null).sort(byTime);
  const groups = new Map<string, FinancialObservation[]>();
  for (const o of live) {
    const key = `${o.kind}|${o.basis}|${o.currency}|${Date.parse(o.observedAt)}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return {
    latest: withValue[0] ?? null,
    opening: withValue.find(o => o.kind === "opening_balance" && o.confirmation === "user_confirmed") ?? null,
    conflicts: [...groups.values()].filter(g => new Set(g.map(o => o.value)).size > 1),
  };
}

/** The latest comparison for each checkpoint still in force, when it didn't match. */
export function openDiscrepancies(reconciliations: readonly Reconciliation[], observations: readonly FinancialObservation[]): Reconciliation[] {
  const live = new Set(currentObservations(observations).map(o => o.id));
  const latest = new Map<string, Reconciliation>();
  for (const r of reconciliations) {
    if (!live.has(r.observation.id)) continue;
    const prev = latest.get(r.observation.id);
    if (!prev || prev.recordedAt <= r.recordedAt) latest.set(r.observation.id, r);
  }
  return [...latest.values()].filter(r => r.result.reconciliationStatus !== "matched");
}

/** Newest trade activity (exit, or entry while open). */
export function latestTrade(trades: readonly Trade[]): Trade | null {
  const at = (t: Trade) => Date.parse(t.exitAt ?? t.entryAt);
  return trades.reduce<Trade | null>((best, t) => (best === null || at(t) > at(best) ? t : best), null);
}

/* ---------- All accounts ---------- */

/** Active, usable attempts first (Today's scope); finished, paused and archived ones are history. */
export function splitAttempts<A extends Pick<AccountViewModel, "status" | "archivedAt">>(accounts: readonly A[]): { active: A[]; history: A[] } {
  return { active: accounts.filter(a => isRiskEligible(a)), history: accounts.filter(a => !isRiskEligible(a)) };
}
