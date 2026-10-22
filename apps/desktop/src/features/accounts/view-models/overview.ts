// Account overview card (Build 18.5): what one account attempt's card says, mapped from data that already exists.
// Identity comes from the stored account, its lineage and phase events; money comes only from the latest saved
// Build 16 calculation (when Today's freshness rules call it current) or from a checkpoint the trader recorded;
// rule thresholds come from the rulebook version assigned to this attempt. Nothing here adds, subtracts or
// compares money: every amount is a value Rust or the engine recorded. Unknown, not calculated, not current,
// no rule and not applicable stay different words, and none of them is shown as zero or Safe.
import {
  derivePhaseHistory,
  statusLabels,
  type AccountPhaseEvent,
  type FinancialObservation,
  type RuleDefinition as Rule,
  type RuleOutcome,
  type RulebookVersionDetail,
  type Trade,
} from "@fundedflow/domain";

import type { MetricValue, StatusKind, Tone } from "../../../design-system";
import { RULE_FIELDS, enumLabel, PRESENCE_LABELS, describeValue, presenceOf } from "../../rulebooks/view-models/rule-fields";
import { checkpointSummary, headline, latestTrade, metricsOf, STALE_TEXT, statedCoverage, type Loadable, type MoneyText, type RiskTruth } from "../../today/view-models/today";
import { PROP_ACCOUNT_TYPES, type RulebookStatus, type SetupItem } from "../setup";
import type { AccountViewModel } from "./account";

export const ACCOUNT_TYPE_WORDS: Record<AccountViewModel["accountType"], string> = {
  evaluation: "Evaluation",
  sim_funded: "Sim funded",
  live_funded: "Live funded",
  personal: "Personal",
  demo: "Demo",
  other: "Other",
};

const STATUS_TONE: Record<AccountViewModel["status"], Tone> = { active: "flow", passed: "profit", failed: "loss", paused: "neutral", closed: "neutral" };

/** Records the card reads for one attempt (from the canonical calculation inputs read now). */
export interface OverviewRecords {
  trades: readonly Trade[];
  observations: readonly FinancialObservation[];
  phaseHistory: readonly AccountPhaseEvent[];
}

export interface OverviewInput {
  account: AccountViewModel;
  activeId: string | null;
  /** Position in the reset lineage, when known. */
  attempt: { number: number; of: number } | null;
  setup: SetupItem[] | null;
  rulebook: RulebookStatus;
  /** The assigned version: loading, unreadable, or its detail. */
  version: Loadable<RulebookVersionDetail>;
  truth: RiskTruth;
  records: Loadable<OverviewRecords>;
  fmt: MoneyText;
  /** Formats an instant in the account's zone with the zone name. */
  when: (instant: string) => string;
}

export interface Provenance {
  label: string;
  tone: Tone;
}

export interface OverviewFigure {
  label: string;
  value: MetricValue;
  provenance: Provenance | null;
  /** One line: as-of time, floor basis or why the value is missing. */
  note: string | null;
}

export interface OverviewMeter {
  label: string;
  /** Engine-recorded amounts as decimal text; only their ratio sets the bar width. */
  value: string;
  max: string;
  tone: "flow" | "profit" | "warn" | "loss";
  valueText: string;
  note: string;
}

export interface OverviewRule {
  key: "drawdown" | "target" | "consistency" | "rulebook" | "start";
  label: string;
  value: string;
  /** Not a value (no rule, not calculated, off): drawn quieter than a real threshold. */
  muted: boolean;
}

/**
 * The Risk section of the account detail page: the same state the card's headroom badge names, with Today's
 * status only when the saved calculation is current. Detail page and card read one model, so they never disagree.
 */
export interface OverviewRisk {
  /** The saved calculation is current: its figures carry their as-of time. */
  current: boolean;
  /** Today's status for a current estimate; otherwise the card's state word (Not current, No rulebook, …). */
  label: string;
  status: StatusKind;
  detail: string;
  /** Why the last saved estimate isn't current, one line each. */
  reasons: string[];
  /** What the last saved estimate said and its cutoff in the account zone, when it isn't current. */
  lastRecorded: string | null;
  /** A live attempt without a current calculation: it is never shown as safe. */
  neverSafe: boolean;
  /** A live attempt with a rulebook in force today: Calculate can run. */
  canCalculate: boolean;
}

export type LastTraded = { kind: "checking" } | { kind: "unknown" } | { kind: "none" } | { kind: "at"; at: string; text: string };

export interface OverviewModel {
  identity: {
    mark: string;
    eyebrow: string;
    title: string;
    reference: string | null;
    type: string;
    /** Only when the recorded phase says more than the type. */
    phase: string | null;
    attempt: string | null;
  };
  status: {
    lifecycle: Provenance;
    archived: boolean;
    setup: "needs" | "complete" | null;
    active: boolean;
    /** Failed, passed, closed, paused or archived: never part of today's risk. */
    history: boolean;
  };
  headroom: OverviewFigure;
  balance: OverviewFigure;
  floor: OverviewFigure;
  meters: OverviewMeter[];
  rules: OverviewRule[];
  risk: OverviewRisk;
  lastTraded: LastTraded;
  /** Failed attempts keep their card, tinted. */
  tint: "loss" | "muted" | null;
}

/** Keeps the last four characters of a broker number; never shows FundedFlow's own ids. */
export function maskReference(ref: string | null): string | null {
  const value = ref?.trim();
  if (!value) return null;
  return value.length <= 4 ? value : `••••${value.slice(-4)}`;
}

const unavailable = (reason: string): MetricValue => ({ kind: "unavailable", reason });
const money = (amount: string | null, currency: string, signed = false): MetricValue => ({ kind: "money", amount, currency, signed });

/** The phase each prop account type implies; a recorded phase that matches it adds nothing to the type label. */
const TYPE_PHASE: Partial<Record<AccountViewModel["accountType"], AccountPhaseEvent["toPhase"]>> = {
  evaluation: "evaluation", sim_funded: "simulated_funded", live_funded: "live_funded",
};

/** The recorded phase, when it says more than the account type; null when there is nothing to add. */
function phaseOf(records: Loadable<OverviewRecords>, account: AccountViewModel): string | null {
  const prop = PROP_ACCOUNT_TYPES.has(account.accountType);
  if (records.state === "loading") return prop ? "Phase: checking…" : null;
  if (records.state === "error") return prop ? "Phase unknown" : null;
  const effective = derivePhaseHistory(account.id, records.value.phaseHistory).effective;
  const phase = effective[effective.length - 1];
  if (!phase) return prop ? "Phase not recorded" : null;
  if (phase.providerLabel) return `Phase: ${phase.providerLabel}`;
  return TYPE_PHASE[account.accountType] === phase.toPhase ? null : `Phase: ${enumLabel(phase.toPhase)}`;
}

const OBSERVATION_SOURCE: Record<FinancialObservation["sourceCategory"], string> = {
  firm_dashboard: "from the firm's dashboard",
  statement: "from a statement",
  user_entered: "entered by you",
};

function balanceFigure(input: OverviewInput): OverviewFigure {
  const { account, truth, records, when } = input;
  // A current calculation's balance: opening checkpoint + closed trades + ledger, as Rust's engine recorded it.
  if (truth.kind === "current" && truth.result.balance !== null) {
    const coverage = statedCoverage(truth.snapshot.explanation);
    const incomplete = coverage ? (["closedTrades", "fees", "ledger"] as const).filter(k => coverage[k] !== "available") : [];
    const words = { closedTrades: "closed trades", fees: "fees", ledger: "deposits and withdrawals" };
    return {
      label: "Estimated balance",
      value: money(truth.result.balance, account.currency),
      provenance: { label: "From your records", tone: "flow" },
      note: `As of ${when(truth.result.asOf)}${incomplete.length ? ` · ${incomplete.map(k => words[k]).join(", ")} stated incomplete` : ""}`,
    };
  }
  if (records.state === "loading") return { label: "Balance", value: { kind: "text", text: null }, provenance: null, note: "Checking checkpoints…" };
  if (records.state === "error") return { label: "Balance", value: unavailable("Checkpoints couldn't be read."), provenance: { label: "Unknown", tone: "neutral" }, note: "Checkpoints couldn't be read." };
  const latest = checkpointSummary(records.value.observations).latest;
  if (!latest) {
    return {
      label: "Balance",
      value: unavailable("No balance checkpoint recorded yet."),
      provenance: { label: "Not available", tone: "neutral" },
      note: "Record a balance checkpoint to show one. The starting balance isn't today's balance.",
    };
  }
  const since = records.value.trades.filter(t => Date.parse(t.exitAt ?? t.entryAt) > Date.parse(latest.observedAt)).length;
  const confirmed = latest.confirmation === "user_confirmed";
  const equity = latest.kind === "equity";
  return {
    label: confirmed ? (equity ? "Last confirmed equity" : "Last confirmed balance") : equity ? "Last reported equity" : "Last reported balance",
    value: money(latest.value, latest.currency),
    provenance: confirmed ? { label: "Confirmed by you", tone: "profit" } : { label: "Not confirmed", tone: "warn" },
    note: `${OBSERVATION_SOURCE[latest.sourceCategory]}, ${when(latest.observedAt)}${since > 0 ? ` · ${since} ${since === 1 ? "trade" : "trades"} since, not included` : ""}`,
  };
}

/** Why the drawdown figures are missing, or null when the saved calculation is current. */
function riskGap(input: OverviewInput): { provenance: Provenance; reason: string } | null {
  const { truth, rulebook, setup } = input;
  const h = headline(truth);
  switch (truth.kind) {
    case "current":
      return null;
    case "historical":
      return { provenance: { label: "History only", tone: "neutral" }, reason: "This attempt isn't active, so it isn't part of today's risk." };
    case "checking":
      return { provenance: { label: "Checking…", tone: "neutral" }, reason: "Checking the last saved estimate." };
    case "none":
      if (rulebook.kind === "none" && setup && setup.length > 0) return { provenance: { label: "Needs setup", tone: "warn" }, reason: "Assign a rulebook, then calculate on Today." };
      if (rulebook.kind === "none") return { provenance: { label: "No rulebook", tone: "neutral" }, reason: "No rulebook is assigned, so there is no drawdown floor to show." };
      return { provenance: { label: "Not calculated", tone: "neutral" }, reason: "Nothing has been calculated for this attempt yet. Calculate on Today." };
    case "read-failed":
      return { provenance: { label: "Unknown", tone: "neutral" }, reason: "The saved calculation couldn't be read." };
    case "legacy":
      return { provenance: { label: "Unknown", tone: "neutral" }, reason: "The last saved calculation predates the rules engine." };
    case "check-failed":
    case "stale": {
      const why = truth.kind === "stale" ? STALE_TEXT[truth.reasons[0]!] : "Its sources couldn't be checked again.";
      const stop = h.category === "Stop";
      return {
        provenance: stop ? { label: "Stop · not current", tone: "loss" } : { label: "Not current", tone: "warn" },
        reason: `The last estimate isn't current. ${why}${h.lastRecorded ? ` ${h.lastRecorded}` : ""}`,
      };
    }
  }
}

function riskSummary(input: OverviewInput, gap: ReturnType<typeof riskGap>): OverviewRisk {
  const { truth, rulebook, when } = input;
  const h = headline(truth);
  const live = truth.kind !== "historical";
  const canCalculate = live && rulebook.kind === "assigned";
  if (!gap) return { current: true, label: h.label, status: h.status, detail: h.detail, reasons: [], lastRecorded: null, neverSafe: false, canCalculate };
  const saved = truth.kind === "stale" || truth.kind === "check-failed" ? truth.result : null;
  const status: StatusKind = !live || truth.kind === "checking" ? "neutral" : h.category === "Stop" ? "danger" : saved ? "stale" : "unknown";
  return {
    current: false,
    label: gap.provenance.label,
    status,
    detail: truth.kind === "stale" ? "The last saved estimate isn't current." : gap.reason,
    reasons: truth.kind === "stale" ? truth.reasons.map(r => STALE_TEXT[r]) : [],
    lastRecorded: saved && h.lastRecorded ? `${h.lastRecorded} Its cutoff was ${when(saved.asOf)}.` : null,
    neverSafe: live && truth.kind !== "checking",
    canCalculate,
  };
}

function drawdownOutcome(truth: RiskTruth): RuleOutcome | null {
  if (truth.kind !== "current") return null;
  const rules = truth.result.rules.filter(r => r.ruleType === "max_drawdown");
  return rules.length === 1 ? rules[0]! : null;
}

const meterTone = (o: RuleOutcome): OverviewMeter["tone"] => (o.state === "breached" ? "loss" : o.state === "caution" ? "warn" : "flow");
const str = (v: unknown) => (typeof v === "string" ? v : null);

function rulesOf(version: Loadable<RulebookVersionDetail>, type: Rule["ruleType"]): Rule[] | null {
  return version.state === "ready" ? version.value.rules.filter(r => r.ruleType === type) : null;
}

/** Engine says this rule doesn't apply to the attempt's phase/path (resolved from the assigned version). */
function engineNotApplicable(truth: RiskTruth, type: Rule["ruleType"]): boolean {
  if (truth.kind !== "current") return false;
  const outcomes = truth.result.rules.filter(r => r.ruleType === type);
  return outcomes.length > 0 && outcomes.every(o => o.state === "not_applicable" || o.state === "absent" || o.state === "disabled");
}

function ruleRows(input: OverviewInput, meters: OverviewMeter[]): OverviewRule[] {
  const { account, rulebook, version, truth, fmt } = input;
  const rows: OverviewRule[] = [];
  const prop = PROP_ACCOUNT_TYPES.has(account.accountType);
  if (rulebook.kind === "loading" || (rulebook.kind === "assigned" && version.state === "loading")) {
    rows.push({ key: "rulebook", label: "Rules", value: "Checking…", muted: true });
    return rows;
  }
  if (rulebook.kind === "unknown" || version.state === "error") {
    rows.push({ key: "rulebook", label: "Rules", value: "Unknown: the rulebook couldn't be read", muted: true });
    return rows;
  }
  if (rulebook.kind === "none") {
    rows.push({ key: "rulebook", label: "Rules", value: prop ? "Needs setup: no rulebook assigned" : "No rulebook (not needed for this account)", muted: true });
    return rows;
  }
  if (version.state !== "ready") return rows;
  const metrics = truth.kind === "current" ? metricsOf(truth.result, account.currency, fmt) : null;

  // Maximum drawdown: amount and method from the assigned version, always shown when the rulebook has one.
  const dd = rulesOf(version, "max_drawdown")!;
  if (dd.length === 0) rows.push({ key: "drawdown", label: "Max drawdown", value: "No drawdown rule in this rulebook", muted: true });
  else if (dd.length > 1) rows.push({ key: "drawdown", label: "Max drawdown", value: "Several drawdown rules: see details", muted: true });
  else {
    const p = dd[0]!.parameters as Record<string, unknown>;
    const amountSpec = RULE_FIELDS.max_drawdown.find(f => f.key === "amount")!;
    const amount = describeValue(amountSpec, p.amount, account.currency);
    const known = presenceOf(p.amount) === "value";
    rows.push({ key: "drawdown", label: "Max drawdown", value: known ? `${amount} · ${enumLabel(String(p.method ?? "unknown"))}` : amount, muted: !known });
  }

  // Profit target: only when the version states one for this phase; progress only from a current calculation.
  const targets = rulesOf(version, "profit_target")!;
  if (targets.length === 1 && !engineNotApplicable(truth, "profit_target")) {
    const p = targets[0]!.parameters as Record<string, unknown>;
    const state = presenceOf(p.amount);
    if (state !== "not_applicable") {
      const target = metrics?.find(m => m.key === "target");
      if (state === "value") {
        const amount = describeValue(RULE_FIELDS.profit_target.find(f => f.key === "amount")!, p.amount, account.currency);
        if (target?.state === "known" && target.outcome) {
          const o = target.outcome;
          const attained = o.metrics.attained === true;
          rows.push({ key: "target", label: "Profit target", value: attained ? `${amount} · reached` : `${amount} · ${fmt(str(o.metrics.remaining))} to go`, muted: false });
          const profit = str(o.metrics.profit);
          const of = str(o.metrics.profitTarget);
          if (profit !== null && of !== null && meters.length < 2) {
            meters.push({ label: "Profit target progress", value: profit, max: of, tone: attained ? "profit" : "flow", valueText: `${fmt(profit)} of ${fmt(of)}`, note: attained ? "Reached" : `${fmt(str(o.metrics.remaining))} to go` });
          }
        } else {
          // The reason stays in View details; the card only says the progress isn't known.
          rows.push({ key: "target", label: "Profit target", value: `${amount} · progress ${truth.kind === "current" ? "unknown" : "not calculated"}`, muted: false });
        }
      } else if (state !== null) {
        rows.push({ key: "target", label: "Profit target", value: state === "explicit_none" ? "None for this phase (stated by the source)" : PRESENCE_LABELS[state], muted: true });
      }
    }
  } else if (targets.length > 1) {
    rows.push({ key: "target", label: "Profit target", value: "Several target rules: see details", muted: true });
  }

  // Consistency: threshold from the version; the observed result only when the current calculation has one.
  const consistency = rulesOf(version, "consistency")!;
  if (consistency.length === 1 && !engineNotApplicable(truth, "consistency")) {
    const p = consistency[0]!.parameters as Record<string, unknown>;
    const state = presenceOf(p.maxBestDayShare);
    if (state !== "not_applicable") {
      const threshold = describeValue(RULE_FIELDS.consistency.find(f => f.key === "maxBestDayShare")!, p.maxBestDayShare, account.currency);
      const metric = metrics?.find(m => m.key === "consistency");
      let result: string;
      if (state !== "value") result = state === "explicit_none" ? "None (stated by the source)" : PRESENCE_LABELS[state ?? "unknown"];
      else if (!metric) result = `Best day at most ${threshold} · result not calculated`;
      else if (metric.state === "known" && metric.value.kind === "text") result = `Best day at most ${threshold} · ${metric.value.text}`;
      else result = `Best day at most ${threshold} · result unknown`;
      rows.push({ key: "consistency", label: "Consistency", value: result, muted: state !== "value" || metric?.state !== "known" });
    }
  } else if (consistency.length > 1) {
    rows.push({ key: "consistency", label: "Consistency", value: "Several consistency rules: see details", muted: true });
  }
  return rows;
}


export function overviewModel(input: OverviewInput): OverviewModel {
  const { account, activeId, attempt, setup, truth, records, fmt } = input;
  const history = truth.kind === "historical";
  const gap = riskGap(input);
  const outcome = drawdownOutcome(truth);
  const meters: OverviewMeter[] = [];

  let headroom: OverviewFigure;
  let floor: OverviewFigure;
  if (gap) {
    headroom = { label: "Drawdown headroom", value: truth.kind === "checking" ? { kind: "text", text: null } : unavailable(gap.reason), provenance: gap.provenance, note: gap.reason };
    floor = { label: "Drawdown floor", value: truth.kind === "checking" ? { kind: "text", text: null } : unavailable(gap.reason), provenance: null, note: null };
  } else {
    const metric = truth.kind === "current" ? metricsOf(truth.result, account.currency, fmt).find(m => m.key === "drawdown")! : null;
    const asOf = truth.kind === "current" ? `As of ${input.when(truth.result.asOf)}` : null;
    if (!metric || metric.state !== "known" || !outcome) {
      const reason = metric?.value.kind === "unavailable" ? metric.value.reason : "Not available from the saved calculation.";
      headroom = { label: "Drawdown headroom", value: unavailable(reason), provenance: { label: metric?.state === "no-rule" ? "No rule" : "Unknown", tone: "neutral" }, note: reason };
      floor = { label: "Drawdown floor", value: unavailable(reason), provenance: null, note: null };
    } else {
      const headroomAmount = str(outcome.metrics.drawdownHeadroom);
      const floorAmount = str(outcome.metrics.drawdownFloor);
      const locked = outcome.metrics.drawdownLocked === true;
      headroom = {
        label: "Drawdown headroom",
        value: money(headroomAmount, account.currency),
        provenance: outcome.state === "breached" ? { label: "Limit reached", tone: "loss" } : outcome.state === "caution" ? { label: "Caution", tone: "warn" } : { label: "Current estimate", tone: "flow" },
        note: asOf,
      };
      floor = { label: locked ? "Drawdown floor (locked)" : "Drawdown floor", value: money(floorAmount, account.currency), provenance: null, note: "Minimum balance the rule allows" };
      const amount = str(outcome.operands.amount);
      if (headroomAmount !== null && amount !== null)
        meters.push({ label: "Drawdown headroom", value: headroomAmount, max: amount, tone: meterTone(outcome), valueText: `${fmt(headroomAmount)} left · limit ${fmt(amount)}`, note: `Floor ${fmt(floorAmount)}` });
    }
  }

  const rules = ruleRows(input, meters);
  rules.push({ key: "start", label: "Started with", value: fmt(account.startingBalance), muted: true });

  let lastTraded: LastTraded;
  if (records.state === "loading") lastTraded = { kind: "checking" };
  else if (records.state === "error") lastTraded = { kind: "unknown" };
  else {
    const t = latestTrade(records.value.trades.filter(x => x.accountId === account.id));
    lastTraded = t ? { kind: "at", at: t.exitAt ?? t.entryAt, text: input.when(t.exitAt ?? t.entryAt) } : { kind: "none" };
  }

  const firm = account.propFirm?.trim();
  return {
    identity: {
      mark: (firm || account.name).trim().slice(0, 1).toUpperCase(),
      eyebrow: firm || (PROP_ACCOUNT_TYPES.has(account.accountType) ? "No firm set" : account.accountType === "personal" ? "Personal · no firm" : "No firm"),
      title: account.name,
      reference: maskReference(account.externalRef),
      type: ACCOUNT_TYPE_WORDS[account.accountType],
      phase: phaseOf(records, account),
      attempt: attempt && attempt.of > 1 ? `Attempt ${attempt.number} of ${attempt.of}` : null,
    },
    status: {
      lifecycle: { label: statusLabels[account.status], tone: STATUS_TONE[account.status] },
      archived: account.archivedAt !== null,
      setup: setup === null ? null : setup.length > 0 ? "needs" : "complete",
      active: activeId === account.id,
      history,
    },
    headroom,
    balance: balanceFigure(input),
    floor,
    meters: meters.slice(0, 2),
    rules,
    risk: riskSummary(input, gap),
    lastTraded,
    tint: account.status === "failed" ? "loss" : account.archivedAt ? "muted" : null,
  };
}
