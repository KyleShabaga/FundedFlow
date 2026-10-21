// Build 18.5 account overview card model: the nine card examples on synthetic records. Every amount asserted here is
// an engine or checkpoint value passed through unchanged; the model never adds, subtracts or invents one.
import {
  defaultEnginePolicy, ENGINE_VERSION, type AccountPhaseEvent, type EngineResult, type FinancialObservation, type RulebookVersionDetail,
} from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import { formatMoney } from "../../design-system";
import { toSnapshotViewModel } from "../insights/view-models/snapshot";
import { closedTrade } from "../rulebooks/test-store";
import { drawdownOutcome } from "../today/test-store";
import type { RiskTruth } from "../today/view-models/today";
import { makeAccount } from "./test-store";
import { toAccountViewModel, type AccountViewModel } from "./view-models/account";
import { maskReference, overviewModel, type OverviewInput, type OverviewRecords } from "./view-models/overview";

const A = "acct-a";
const fmt = (v: string | null) => formatMoney(v, { signed: false, currency: "USD", dp: 2 });
const when = (at: string) => `at ${at}`;
const account = (over: Parameters<typeof makeAccount>[0] extends infer P ? Partial<P> : never = {}) =>
  toAccountViewModel(makeAccount({ id: A, name: "PA-48213", propFirm: "Apex", externalRef: "APX-0048213", ...over }));

function result(over: Partial<EngineResult> = {}): EngineResult {
  return {
    accountId: A, rulebookVersionId: "v1", assignmentId: "as1", programmePhaseId: null, phasePathId: null, engineVersion: ENGINE_VERSION,
    tradingDay: "2026-10-21", asOf: "2026-10-21T17:00:00.000Z", dataAsOf: "2026-10-21T15:01:00.000Z", inputsHash: "h",
    status: "Safe", assurance: "user_reported_estimate", reasons: [], rules: [drawdownOutcome({ headroom: "1500", floor: "48500" })],
    tradingDaysCompleted: 2, balance: "50000", realizedDayPnl: "0", sourceReferences: [], assumptions: [], ...over,
  };
}
function current(r = result(), coverage: Record<string, string> = { baseline: "available", closedTrades: "available", fees: "available", ledger: "available", openPositions: "unsupported", eodHistory: "available", intradayHistory: "unsupported", sourceReference: "t" }): RiskTruth {
  const snapshot = toSnapshotViewModel({
    id: "s1", accountId: A, rulebookVersionId: r.rulebookVersionId, tradingDay: r.tradingDay, isEndOfDay: false, dataAsOf: r.dataAsOf, dataSource: "manual",
    calculatedAt: "2026-10-21T17:00:05.000Z", engineVersion: r.engineVersion, inputsHash: r.inputsHash, feesIncluded: true, unrealizedIncluded: false,
    balance: r.balance, realizedDayPnl: r.realizedDayPnl, unrealizedPnl: null, dailyLossLimit: null, dailyLossRemaining: null, drawdownMode: null,
    highWaterMark: null, drawdownFloor: null, drawdownHeadroom: null, drawdownLocked: null, profitTarget: null, tradingDaysCompleted: 2,
    tradingDaysRequired: null, status: r.status.toLowerCase(), statusReasons: ["x"], explanation: { engine: r, policy: defaultEnginePolicy, inputs: { coverage } },
  }, makeAccount({ id: A, name: "PA-48213" }));
  return { kind: "current", snapshot, result: r };
}

const rule = (ruleType: string, parameters: Record<string, unknown>) => ({ id: `r-${ruleType}`, rulebookVersionId: "v1", ruleKey: ruleType, ruleType, parameters });
function version(...rules: ReturnType<typeof rule>[]): OverviewInput["version"] {
  return { state: "ready", value: { rulebook: { displayName: "Apex 50K" }, version: { id: "v1" }, rules, applicability: [], claims: [] } as unknown as RulebookVersionDetail };
}
const DD = rule("max_drawdown", { amount: { state: "value", value: "2000" }, method: "end_of_day_trailing", basis: "realized", lock: { state: "unknown" } });
const TARGET = rule("profit_target", { amount: { state: "value", value: "3000" }, basis: "balance" });
const CONSISTENCY = rule("consistency", { maxBestDayShare: { state: "value", value: "0.3" }, denominator: "total_profit", appliesTo: "evaluation" });
const assigned = { kind: "assigned", assignment: { rulebookVersionId: "v1" } } as unknown as OverviewInput["rulebook"];

function records(over: Partial<OverviewRecords> = {}): OverviewInput["records"] {
  return { state: "ready", value: { trades: [], observations: [], phaseHistory: [], ...over } };
}
const phase = (toPhase: AccountPhaseEvent["toPhase"]): AccountPhaseEvent => ({
  id: `ph-${toPhase}`, accountId: A, fromPhase: null, toPhase, providerLabel: null, occurredAt: "2026-10-01T00:00:00.000Z", recordedAt: "2026-10-01T00:00:00.000Z",
  source: "user", actor: "user", note: null, correctionOfEventId: null, catalogueVersionId: null, programmePhaseId: null, phasePathId: null,
} as unknown as AccountPhaseEvent);
const checkpoint = (over: Partial<FinancialObservation> = {}): FinancialObservation => ({
  id: "obs-1", accountId: A, kind: "balance", value: "50210.25", currency: "USD", basis: "balance", observedAt: "2026-10-20T21:00:00.000Z",
  sourceCategory: "firm_dashboard", sourceReference: "dashboard", confirmation: "user_confirmed", confidence: "user_reported", validUntil: null,
  actor: "me", note: null, recordedAt: "2026-10-20T21:05:00.000Z", effectiveTradingDay: "2026-10-20", timezone: "America/New_York",
  tradingDayResetTime: "17:00", supersedesId: null, correctionReason: null, ...over,
});

function model(over: Partial<OverviewInput> & { account?: AccountViewModel } = {}) {
  return overviewModel({
    account: account(), activeId: null, attempt: { number: 1, of: 1 }, setup: [], rulebook: assigned, version: version(DD, TARGET, CONSISTENCY),
    truth: { kind: "none" }, records: records(), fmt, when, ...over,
  });
}
const row = (m: ReturnType<typeof model>, key: string) => m.rules.find(r => r.key === key);

describe("account overview card model", () => {
  it("no trades: says so, and never presents the starting balance as today's balance", () => {
    const m = model();
    expect(m.lastTraded).toEqual({ kind: "none" });
    expect(m.balance.value).toMatchObject({ kind: "unavailable" });
    expect(m.balance.provenance).toEqual({ label: "Not available", tone: "neutral" });
    expect(row(m, "start")).toMatchObject({ label: "Started with", value: "$50,000.00", muted: true });
    expect(m.headroom.value.kind).toBe("unavailable");
    expect(m.headroom.provenance?.label).toBe("Not calculated");
  });

  it("fully known evaluation: identity, phase, engine headroom and floor, one drawdown bar and target progress", () => {
    const target = { ruleId: "r-t", ruleKey: "profit_target", ruleType: "profit_target" as const, state: "satisfied" as const, reasonCode: "in_progress",
      metrics: { profit: "1200", profitTarget: "3000", remaining: "1800", attained: false }, formula: "", operands: {}, sourceReferences: [], missingInputs: [], evidence: [], assumptions: [] };
    const trade = closedTrade(A, 3, "200", "2026-10-21");
    const m = model({ truth: current(result({ rules: [drawdownOutcome({ headroom: "1500", floor: "48500" }), target] })), records: records({ trades: [trade], phaseHistory: [phase("evaluation")] }), activeId: A });
    expect(m.identity).toMatchObject({ eyebrow: "Apex", title: "PA-48213", reference: "••••8213", type: "Evaluation", phase: null, attempt: null });
    // A recorded phase that differs from the type is shown; a missing one is said to be missing.
    expect(model({ records: records({ phaseHistory: [phase("simulated_funded")] }) }).identity.phase).toBe("Phase: Simulated funded");
    expect(model().identity.phase).toBe("Phase not recorded");
    expect(m.status).toMatchObject({ lifecycle: { label: "Active" }, archived: false, setup: "complete", active: true, history: false });
    expect(m.headroom).toMatchObject({ value: { kind: "money", amount: "1500" }, provenance: { label: "Current estimate" } });
    expect(m.floor.value).toMatchObject({ kind: "money", amount: "48500" });
    expect(m.balance).toMatchObject({ label: "Estimated balance", value: { amount: "50000" }, provenance: { label: "From your records" } });
    expect(m.meters.map(x => x.label)).toEqual(["Drawdown headroom", "Profit target progress"]);
    expect(m.meters[0]).toMatchObject({ value: "1500", max: "2000" });
    expect(row(m, "drawdown")?.value).toBe("$2,000.00 · End-of-day trailing");
    expect(row(m, "target")?.value).toBe("$3,000.00 · $1,800.00 to go");
    expect(m.lastTraded).toMatchObject({ kind: "at", at: trade.exitAt });
  });

  it("funded account without a profit target: no target row or bar, the source's 'none' kept distinct", () => {
    const funded = account({ accountType: "sim_funded" });
    const none = rule("profit_target", { amount: { state: "explicit_none" }, basis: "balance" });
    expect(row(model({ account: funded, version: version(DD) }), "target")).toBeUndefined();
    expect(row(model({ account: funded, version: version(DD, none) }), "target")).toMatchObject({ value: "None for this phase (stated by the source)", muted: true });
    const na = rule("profit_target", { amount: { state: "not_applicable" }, basis: "balance" });
    expect(row(model({ account: funded, version: version(DD, na) }), "target")).toBeUndefined();
    // The engine resolved the assigned version for this phase and found the target not applicable.
    const notApplicable = { ruleId: "r-t", ruleKey: "profit_target", ruleType: "profit_target" as const, state: "not_applicable" as const, reasonCode: "x", metrics: {}, formula: "", operands: {}, sourceReferences: [], missingInputs: [], evidence: [], assumptions: [] };
    const m = model({ account: funded, truth: current(result({ rules: [drawdownOutcome({ headroom: "1500" }), notApplicable] })) });
    expect(row(m, "target")).toBeUndefined();
    expect(m.meters).toHaveLength(1);
  });

  it("unknown consistency: threshold shown, result not invented", () => {
    const unknown = { ruleId: "r-c", ruleKey: "consistency", ruleType: "consistency" as const, state: "unknown" as const, reasonCode: "missing_day_pnl", metrics: {}, formula: "", operands: {}, sourceReferences: [], missingInputs: [], evidence: [], assumptions: [] };
    const m = model({ truth: current(result({ rules: [drawdownOutcome({ headroom: "1500" }), unknown] })) });
    expect(row(m, "consistency")).toMatchObject({ value: expect.stringMatching(/Best day at most .*30%.* · result unknown/), muted: true });
    const stated = rule("consistency", { maxBestDayShare: { state: "unknown" }, denominator: "unknown", appliesTo: "unknown" });
    expect(row(model({ version: version(DD, stated) }), "consistency")).toMatchObject({ value: "Unknown", muted: true });
  });

  it("missing rulebook: needs setup for a prop account, not needed for a personal one, never zero", () => {
    const m = model({ rulebook: { kind: "none" }, version: { state: "loading" }, setup: [{ key: "rulebook", label: "No rulebook", detail: "" }] });
    expect(m.status.setup).toBe("needs");
    expect(m.headroom.provenance).toEqual({ label: "Needs setup", tone: "warn" });
    expect(row(m, "rulebook")?.value).toBe("Needs setup: no rulebook assigned");
    expect(m.rules.some(r => r.key === "drawdown")).toBe(false);
  });

  it("stale or partial balance: a confirmed checkpoint with trades after it, and stated-incomplete coverage", () => {
    const after = { ...closedTrade(A, 4, "-50", "2026-10-21"), exitAt: "2026-10-21T15:00:00.000Z" };
    const m = model({ records: records({ observations: [checkpoint()], trades: [after] }) });
    expect(m.balance).toMatchObject({ label: "Last confirmed balance", value: { amount: "50210.25" }, provenance: { label: "Confirmed by you" } });
    expect(m.balance.note).toContain("1 trade since, not included");
    const unconfirmed = model({ records: records({ observations: [checkpoint({ confirmation: "unconfirmed", sourceCategory: "user_entered" })] }) });
    expect(unconfirmed.balance).toMatchObject({ label: "Last reported balance", provenance: { label: "Not confirmed", tone: "warn" } });
    const partial = model({ truth: current(result(), { baseline: "available", closedTrades: "incomplete", fees: "available", ledger: "incomplete", openPositions: "unsupported", eodHistory: "available", intradayHistory: "unsupported", sourceReference: "t" }) });
    expect(partial.balance.note).toContain("closed trades, deposits and withdrawals stated incomplete");
    // A saved estimate that isn't current shows no figures, only why.
    const stale = current() as Extract<RiskTruth, { kind: "current" }>;
    const notCurrent = model({ truth: { kind: "stale", snapshot: stale.snapshot, result: result(), reasons: ["newer-data"], newer: { trades: 1, checkpoints: 0, ledger: 0 } } });
    expect(notCurrent.headroom.value.kind).toBe("unavailable");
    expect(notCurrent.headroom.provenance).toEqual({ label: "Not current", tone: "warn" });
    expect(notCurrent.meters).toEqual([]);
    const stop = model({ truth: { kind: "stale", snapshot: stale.snapshot, result: result({ status: "Stop" }), reasons: ["newer-data"], newer: { trades: 1, checkpoints: 0, ledger: 0 } } });
    expect(stop.headroom.provenance).toEqual({ label: "Stop · not current", tone: "loss" });
  });

  it("personal, firm-less account", () => {
    const m = model({ account: account({ propFirm: null, accountType: "personal", externalRef: null }), rulebook: { kind: "none" }, version: { state: "loading" }, setup: [] });
    expect(m.identity).toMatchObject({ eyebrow: "Personal · no firm", reference: null, type: "Personal", phase: null });
    expect(model({ account: account({ propFirm: null, accountType: "demo" }), rulebook: { kind: "none" }, version: { state: "loading" } }).identity.eyebrow).toBe("No firm");
    expect(row(m, "rulebook")?.value).toBe("No rulebook (not needed for this account)");
    expect(m.headroom.provenance?.label).toBe("No rulebook");
  });

  it("archived or failed attempts are history: separate badges, tinted, no risk figures", () => {
    const failed = model({ account: account({ status: "failed" }), truth: { kind: "historical" } });
    expect(failed.status).toMatchObject({ lifecycle: { label: "Failed", tone: "loss" }, archived: false, history: true });
    expect(failed.tint).toBe("loss");
    expect(failed.headroom.provenance?.label).toBe("History only");
    const archived = model({ account: account({ archivedAt: "2026-10-01T00:00:00.000Z" }), truth: { kind: "historical" } });
    expect(archived.status).toMatchObject({ lifecycle: { label: "Active" }, archived: true });
    expect(archived.tint).toBe("muted");
  });

  it("reset attempts with the same broker number stay apart by attempt and status", () => {
    const one = model({ account: account({ id: A, status: "failed" }), attempt: { number: 1, of: 2 }, truth: { kind: "historical" } });
    const two = model({ account: account({ id: "acct-b" }), attempt: { number: 2, of: 2 }, records: records() });
    expect(one.identity.reference).toBe(two.identity.reference);
    expect(one.identity.attempt).toBe("Attempt 1 of 2");
    expect(two.identity.attempt).toBe("Attempt 2 of 2");
    expect(one.status.lifecycle.label).not.toBe(two.status.lifecycle.label);
  });

  it("masks broker numbers and never shows ids", () => {
    expect(maskReference("APX-0048213")).toBe("••••8213");
    expect(maskReference("777")).toBe("777");
    expect(maskReference("  ")).toBeNull();
    const m = model();
    expect(JSON.stringify(m.identity)).not.toContain(A);
  });

  it("while records load it says so instead of guessing", () => {
    const m = model({ records: { state: "loading" }, truth: { kind: "checking" } });
    expect(m.lastTraded).toEqual({ kind: "checking" });
    expect(m.identity.phase).toBe("Phase: checking…");
    expect(m.headroom.value).toEqual({ kind: "text", text: null });
  });
});
