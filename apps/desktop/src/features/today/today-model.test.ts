// Build 21 truth model and mapping: when a saved estimate is current, how each status headlines, and that every
// figure is the engine's (unknown stays unknown, a real zero stays zero). Pure functions on synthetic engine records.
import { defaultEnginePolicy, ENGINE_VERSION, type AccountRiskInputs, type EngineResult, type FinancialObservation, type Reconciliation } from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import { formatMoney } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { toAccountViewModel } from "../accounts/view-models/account";
import { toSnapshotViewModel } from "../insights/view-models/snapshot";
import { closedTrade } from "../rulebooks/test-store";
import { parseAmount } from "./components/VerifyBalanceDialog";
import { drawdownOutcome } from "./test-store";
import {
  checkpointSummary, contributingTrades, deriveRiskTruth, headline, metricsOf, newerThan, openDiscrepancies, splitAttempts, statedCoverage,
  type TruthInput,
} from "./view-models/today";
import { checkpointInstant } from "./view-models/zoned-time";

const A = "acct-a";
const account = toAccountViewModel(makeAccount({ id: A, name: "Eval A" }));
const VERSION = "version-1";
const trades = [closedTrade(A, 1, "125.5", "2026-10-21"), closedTrade(A, 2, "-40", "2026-10-20")];

function result(over: Partial<EngineResult> = {}): EngineResult {
  return {
    accountId: A, rulebookVersionId: VERSION, assignmentId: "assign-1", programmePhaseId: null, phasePathId: null, engineVersion: ENGINE_VERSION,
    tradingDay: "2026-10-21", asOf: "2026-10-21T17:00:00.000Z", dataAsOf: "2026-10-21T15:01:00.000Z", inputsHash: "hash-1",
    status: "Safe", assurance: "user_reported_estimate", reasons: [], rules: [drawdownOutcome({ headroom: "2125.5", sourceReferences: trades.map(t => t.id) })],
    tradingDaysCompleted: 2, balance: "52125.5", realizedDayPnl: "125.5", sourceReferences: trades.map(t => t.id), assumptions: ["Coverage is user-reported"],
    ...over,
  };
}
function snapshot(r: EngineResult, extra: Record<string, unknown> = {}) {
  return toSnapshotViewModel({
    id: "snap-1", accountId: r.accountId, rulebookVersionId: r.rulebookVersionId, tradingDay: r.tradingDay, isEndOfDay: false, dataAsOf: r.dataAsOf,
    dataSource: "manual", calculatedAt: "2026-10-21T17:00:05.000Z", engineVersion: r.engineVersion, inputsHash: r.inputsHash, feesIncluded: true,
    unrealizedIncluded: false, balance: r.balance, realizedDayPnl: r.realizedDayPnl, unrealizedPnl: null, dailyLossLimit: null, dailyLossRemaining: null,
    drawdownMode: null, highWaterMark: null, drawdownFloor: null, drawdownHeadroom: null, drawdownLocked: null, profitTarget: null,
    tradingDaysCompleted: r.tradingDaysCompleted, tradingDaysRequired: null, status: r.status.toLowerCase(), statusReasons: r.reasons.length ? r.reasons : ["x"],
    explanation: { engine: r, policy: defaultEnginePolicy, inputs: { coverage: { baseline: "available", closedTrades: "available", fees: "available", ledger: "incomplete", openPositions: "unsupported", eodHistory: "available", intradayHistory: "unsupported", sourceReference: "test" }, trades }, ...extra },
  }, makeAccount({ id: A, name: "Eval A" }));
}
function facts(over: Partial<AccountRiskInputs> = {}): AccountRiskInputs {
  return {
    effectiveTradingDay: "2026-10-21", trades, observations: [], ledger: [], account: makeAccount({ id: A, name: "Eval A" }),
    applicableAssignment: { id: "assign-1", accountId: A, rulebookVersionId: VERSION, effectiveFrom: "2026-10-19", effectiveTo: null, programmePhaseId: null, phasePathId: null, accountPhaseEventId: null, assignedAt: "2026-10-19T00:00:00.000Z", assignmentSource: "user" },
    ...over,
  } as unknown as AccountRiskInputs;
}
const ready = <T,>(value: T) => ({ state: "ready" as const, value });
function truth(over: Partial<TruthInput> = {}, r = result()) {
  return deriveRiskTruth({ account, snapshot: ready(snapshot(r)), freshness: ready({ kind: "current" as const }), facts: ready(facts()), ...over });
}

describe("current versus not current", () => {
  it("calls an estimate current only for the same Rust trading day, unchanged inputs, nothing newer and the same version", () => {
    const t = truth();
    expect(t.kind).toBe("current");
    expect(headline(t)).toMatchObject({ category: "Safe", label: "Safe (estimate)", lastRecorded: null });
  });

  it("an unchanged-inputs check for an earlier cutoff is not 'current today'", () => {
    const t = truth({ facts: ready(facts({ effectiveTradingDay: "2026-10-22" })) });
    expect(t).toMatchObject({ kind: "stale", reasons: ["earlier-trading-day"] });
    const h = headline(t);
    expect(h.category).toBe("Unknown");
    expect(h.label).not.toMatch(/Safe/);
    expect(h.lastRecorded).toContain("Safe (estimate) for trading day 2026-10-21");
  });

  it("a trade, checkpoint or ledger movement after the cutoff makes it not current", () => {
    const later = { ...closedTrade(A, 9, "-300", "2026-10-21"), entryAt: "2026-10-21T17:30:00.000Z", exitAt: "2026-10-21T17:45:00.000Z" };
    const obs = { observedAt: "2026-10-21T17:10:00.000Z" } as FinancialObservation;
    const ledger = { effectiveAt: "2026-10-21T18:00:00.000Z" } as AccountRiskInputs["ledger"][number];
    expect(newerThan(result(), facts({ trades: [...trades, later], observations: [obs], ledger: [ledger] }))).toEqual({ trades: 1, checkpoints: 1, ledger: 1 });
    expect(truth({ facts: ready(facts({ trades: [...trades, later] })) })).toMatchObject({ kind: "stale", reasons: ["newer-data"] });
    // An open trade entered after the cutoff counts too.
    const open = { ...later, exitAt: null, pnlStatus: "open" as const };
    expect(newerThan(result(), facts({ trades: [open] })).trades).toBe(1);
  });

  it("changed sources, another rulebook version or none, are each reasons", () => {
    expect(truth({ freshness: ready({ kind: "changed" }) })).toMatchObject({ kind: "stale", reasons: ["sources-changed"] });
    expect(truth({ facts: ready(facts({ applicableAssignment: null })) })).toMatchObject({ kind: "stale", reasons: ["other-rulebook-version"] });
  });

  it("checking, unreadable and failed checks never show the saved status", () => {
    expect(truth({ freshness: { state: "loading" } }).kind).toBe("checking");
    expect(truth({ facts: { state: "loading" } }).kind).toBe("checking");
    expect(headline(truth({ facts: { state: "loading" } }))).toMatchObject({ category: null, label: "Checking…" });
    const failed = truth({ freshness: { state: "error" } });
    expect(failed.kind).toBe("check-failed");
    expect(headline(failed).category).toBe("Unknown");
    expect(truth({ snapshot: { state: "error" } }).kind).toBe("read-failed");
    expect(truth({ snapshot: { state: "loading" } }).kind).toBe("checking");
    expect(headline(truth({ freshness: ready({ kind: "not-engine" }) })).category).toBe("Unknown");
  });

  it("no calculation and a pre-engine record are Unknown, never Safe", () => {
    expect(headline(truth({ snapshot: ready(null) }))).toMatchObject({ category: "Unknown", label: "Unknown" });
    const legacy = snapshot(result());
    const t = deriveRiskTruth({ account, snapshot: ready({ ...legacy, explanation: { note: "legacy" } }), freshness: ready({ kind: "current" }), facts: ready(facts()) });
    expect(t.kind).toBe("legacy");
    expect(headline(t).category).toBe("Unknown");
  });

  it("a recorded Stop stays Stop when not current; time passing never clears it", () => {
    const stop = result({ status: "Stop", reasons: ["loss_threshold_breached"] });
    const h = headline(truth({ facts: ready(facts({ effectiveTradingDay: "2026-10-23" })) }, stop));
    expect(h).toMatchObject({ category: "Stop", status: "danger" });
    expect(h.label).toContain("not current");
    expect(headline(truth({ freshness: { state: "error" } }, stop)).category).toBe("Stop");
  });

  it("shows all four engine categories distinctly when current", () => {
    const seen = (["Safe", "Caution", "Stop", "Unknown"] as const).map(status => headline(truth({}, result({ status, reasons: status === "Safe" ? [] : ["x"] }))));
    expect(seen.map(h => h.category)).toEqual(["Safe", "Caution", "Stop", "Unknown"]);
    expect(new Set(seen.map(h => h.status)).size).toBe(4);
    expect(seen.map(h => h.label)).toEqual(["Safe (estimate)", "Caution (estimate)", "Stop", "Unknown"]);
  });

  it("finished, paused and archived attempts are history, even with a saved Safe", () => {
    for (const over of [{ status: "failed" as const }, { status: "passed" as const }, { status: "paused" as const }, { archivedAt: "2026-10-20T00:00:00.000Z" }]) {
      const t = deriveRiskTruth({ account: { ...account, ...over }, snapshot: ready(snapshot(result())), freshness: ready({ kind: "current" }), facts: ready(facts()) });
      expect(t.kind).toBe("historical");
      expect(headline(t).category).toBeNull();
    }
    const all = [account, toAccountViewModel(makeAccount({ id: "f", name: "F", status: "failed" })), toAccountViewModel(makeAccount({ id: "p", name: "P", status: "paused" }))];
    expect(splitAttempts(all)).toMatchObject({ active: [{ id: A }], history: [{ id: "f" }, { id: "p" }] });
  });

  it("refuses another account's records", () => {
    const other = { ...snapshot(result()), accountId: "acct-b" };
    expect(deriveRiskTruth({ account, snapshot: ready(other), freshness: ready({ kind: "current" }), facts: ready(facts()) }).kind).toBe("read-failed");
    // The snapshot view model refuses a record of another account outright; an engine record inside it naming
    // another account is not used as a status either.
    expect(() => snapshot(result({ accountId: "acct-b" }))).toThrow();
    const own = snapshot(result());
    const crossed = { ...own, explanation: { ...own.explanation, engine: result({ accountId: "acct-b" }) } };
    expect(deriveRiskTruth({ account, snapshot: ready(crossed), freshness: ready({ kind: "current" }), facts: ready(facts()) }).kind).toBe("legacy");
  });
});

describe("metrics", () => {
  const fmt = (v: string | null) => formatMoney(v, { signed: false, currency: "USD" });
  const byKey = (r: EngineResult) => Object.fromEntries(metricsOf(r, "USD", fmt).map(m => [m.key, m]));

  it("keeps a known zero apart from unknown", () => {
    const zero = byKey(result({ rules: [drawdownOutcome({ headroom: "0", state: "breached", reasonCode: "loss_threshold_breached" })] })).drawdown!;
    expect(zero).toMatchObject({ state: "known", value: { kind: "money", amount: "0" } });
    expect(zero.sub).toContain("Limit reached");
    const unknown = byKey(result({ rules: [drawdownOutcome({ headroom: null, state: "unsupported", reasonCode: "unobserved_equity_history" })] })).drawdown!;
    expect(unknown.state).toBe("unsupported");
    expect(unknown.value).toMatchObject({ kind: "unavailable", reason: "Live equity isn't recorded, so equity-based limits can't be checked." });
    const missingFigure = byKey(result({ rules: [drawdownOutcome({ headroom: null })] })).drawdown!;
    expect(missingFigure.state).toBe("unknown");
    expect(byKey(result({ balance: null })).balance!.value).toMatchObject({ kind: "money", amount: null });
    expect(byKey(result({ realizedDayPnl: "0" })).dayPnl!.value).toMatchObject({ amount: "0" });
  });

  it("says when the rulebook has no rule, or several, instead of zero", () => {
    expect(byKey(result()).dailyLoss).toMatchObject({ state: "no-rule", value: { kind: "unavailable" } });
    const two = byKey(result({ rules: [drawdownOutcome({ headroom: "10" }), drawdownOutcome({ headroom: "20", ruleId: "r2", ruleKey: "dd2" })] })).drawdown!;
    expect(two.state).toBe("ambiguous");
  });

  it("maps every engine outcome state without inventing a pass", () => {
    const states = ["unknown", "unsupported", "manual_only", "stale", "conflicting", "not_applicable", "absent", "disabled"] as const;
    const words = states.map(state => byKey(result({ rules: [drawdownOutcome({ headroom: "100", state })] })).drawdown!.state);
    expect(words).toEqual(["unknown", "unsupported", "manual", "stale-source", "conflicting", "not-applicable", "not-applicable", "not-applicable"]);
  });

  it("takes target, daily loss, trading days and consistency from the engine's metrics", () => {
    const m = byKey(result({ rules: [
      { ...drawdownOutcome({ headroom: "1" }), ruleId: "t", ruleKey: "profit_target", ruleType: "profit_target", metrics: { profitTarget: "3000", profit: "2125.5", remaining: "874.5", attained: false } },
      { ...drawdownOutcome({ headroom: "1" }), ruleId: "d", ruleKey: "daily_loss_limit", ruleType: "daily_loss_limit", metrics: { dailyLossLimit: "1000", dailyLossRemaining: "1125.5" } },
      { ...drawdownOutcome({ headroom: "1" }), ruleId: "m", ruleKey: "min_trading_days", ruleType: "min_trading_days", metrics: { tradingDaysCompleted: 2, tradingDaysRequired: 5, attained: false } },
      { ...drawdownOutcome({ headroom: "1" }), ruleId: "c", ruleKey: "consistency", ruleType: "consistency", state: "caution", metrics: { bestDayProfit: "125.5", denominator: "85.5", attained: false } },
    ] }));
    expect(m.target).toMatchObject({ value: { amount: "2125.5" }, sub: "Target $3,000.00 · $874.50 to go." });
    expect(m.dailyLoss).toMatchObject({ value: { amount: "1125.5" }, sub: "Daily limit $1,000.00." });
    expect(m.tradingDays).toMatchObject({ value: { kind: "count", value: 2, unit: "of 5" } });
    expect(m.consistency).toMatchObject({ value: { kind: "text", text: "Needs more profit" } });
    expect(m.equity).toMatchObject({ state: "unsupported" });
  });

  it("lists the calculation's own trades, the trading day's for day figures, never another account's", () => {
    const r = result();
    const s = snapshot(r, { inputs: { trades: [...trades, closedTrade("acct-b", 1, "999", "2026-10-21")] } });
    const metrics = Object.fromEntries(metricsOf(r, "USD", fmt).map(m => [m.key, m]));
    expect(contributingTrades(s.explanation, r, metrics.drawdown!).map(t => t.id)).toEqual([`${A}-t1`, `${A}-t2`]);
    expect(contributingTrades(s.explanation, r, metrics.dayPnl!).map(t => t.id)).toEqual([`${A}-t1`]);
    expect(contributingTrades({}, r, metrics.balance!)).toEqual([]);
    expect(statedCoverage(s.explanation)).toBeNull(); // replaced inputs carry no coverage
    expect(statedCoverage(snapshot(r).explanation)).toEqual({ closedTrades: "available", fees: "available", ledger: "incomplete" });
  });
});

describe("checkpoints and comparisons", () => {
  const obs = (over: Partial<FinancialObservation>): FinancialObservation => ({
    id: "o1", accountId: A, kind: "balance", value: "50100", currency: "USD", basis: "balance", observedAt: "2026-10-21T15:00:00.000Z",
    sourceCategory: "firm_dashboard", sourceReference: "dash", confirmation: "user_confirmed", confidence: "user_reported", validUntil: null,
    actor: "local_user", note: null, recordedAt: "2026-10-21T15:01:00.000Z", effectiveTradingDay: "2026-10-21", timezone: "America/New_York",
    tradingDayResetTime: "17:00", supersedesId: null, correctionReason: null, ...over,
  });

  it("uses checkpoints still in force and flags same-moment disagreements", () => {
    const opening = obs({ id: "open", kind: "opening_balance", value: "50000", observedAt: "2026-10-01T13:00:00.000Z" });
    const unconfirmedOpening = obs({ id: "open2", kind: "opening_balance", value: "49000", observedAt: "2026-10-02T13:00:00.000Z", confirmation: "unconfirmed", confidence: "unknown" });
    const original = obs({ id: "b1", value: "50100" });
    const correction = obs({ id: "b2", value: "50120", supersedesId: "b1", recordedAt: "2026-10-21T15:05:00.000Z" });
    const s = checkpointSummary([opening, unconfirmedOpening, original, correction]);
    expect(s.latest?.id).toBe("b2");
    expect(s.opening?.id).toBe("open");
    expect(s.conflicts).toEqual([]);
    const rival = obs({ id: "b3", value: "50200" });
    expect(checkpointSummary([opening, correction, rival]).conflicts.map(g => g.map(o => o.id))).toEqual([["b2", "b3"]]);
  });

  it("reports the latest unmatched comparison per checkpoint, not superseded ones", () => {
    const o = obs({ id: "b1" });
    const rec = (id: string, status: string, recordedAt: string, observation = o) => ({ id, accountId: A, recordedAt, observation, result: { reconciliationStatus: status } }) as unknown as Reconciliation;
    expect(openDiscrepancies([rec("r1", "matched", "2026-10-21T15:00:00Z"), rec("r2", "mismatched", "2026-10-21T16:00:00Z")], [o]).map(r => r.id)).toEqual(["r2"]);
    expect(openDiscrepancies([rec("r1", "mismatched", "2026-10-21T15:00:00Z"), rec("r2", "matched", "2026-10-21T16:00:00Z")], [o])).toEqual([]);
    expect(openDiscrepancies([rec("r1", "mismatched", "2026-10-21T15:00:00Z")], [o, obs({ id: "b2", supersedesId: "b1" })])).toEqual([]);
  });

  it("parses amounts exactly and refuses rounding", () => {
    expect(parseAmount("50,250.75")).toBe("50250.75");
    expect(parseAmount(" 0 ")).toBe("0");
    expect(parseAmount("-12.500")).toBe("-12.5");
    expect(parseAmount("1.0000001")).toBeNull();
    expect(parseAmount("1e3")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("checkpoint times in the account's zone (DST)", () => {
  const ny = "America/New_York";
  it("converts an ordinary time exactly", () => {
    expect(checkpointInstant("2026-10-21T16:05", ny)).toEqual({ kind: "ok", instant: "2026-10-21T20:05:00.000Z" });
    expect(checkpointInstant("2026-12-21T16:05", ny)).toEqual({ kind: "ok", instant: "2026-12-21T21:05:00.000Z" });
  });
  it("refuses a time skipped by the spring change and one repeated in the autumn", () => {
    expect(checkpointInstant("2026-03-08T02:30", ny).kind).toBe("skipped");
    expect(checkpointInstant("2026-11-01T01:30", ny).kind).toBe("repeated");
    expect(checkpointInstant("2026-11-01T02:30", ny)).toEqual({ kind: "ok", instant: "2026-11-01T07:30:00.000Z" });
    expect(checkpointInstant("not a time", ny).kind).toBe("invalid");
  });
});
