import { describe, expect, it } from "vitest";
import fixture from "./fixtures/reconciliation.json" with { type: "json" };
import { compareFinancialEvidence, observationSchema, reconciliationRequestSchema, tradeSchema, ledgerEntrySchema, riskMoney,
  observationInputSchema, ruleTypes, requiredRuleEvidence, ruleEvidenceRequirements, ledgerEntryInputSchema } from "../src/index.js";

describe("Rust reconciliation parity", () => {
  for (const f of fixture) it(f.name, () => {
    const result = compareFinancialEvidence(reconciliationRequestSchema.parse(f.request), observationSchema.parse(f.observation),
      observationSchema.parse(f.baseline), f.trades.map(t => tradeSchema.parse(t)), f.ledger.map(e => ledgerEntrySchema.parse(e)), f.superseded);
    expect(result).toEqual(f.expected);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result).not.toHaveProperty("riskStatus");
  });
});

it("validates exact signed i64 financial boundaries and canonical null/zero separately", () => {
  for (const value of ["0", "-0.000001", "9223372036854.775807", "-9223372036854.775808"]) expect(riskMoney.safeParse(value).success).toBe(true);
  for (const value of ["NaN", "1.0", "-0", "1e3", "0.0000001", "9223372036854.775808", "-9223372036854.775809"]) expect(riskMoney.safeParse(value).success).toBe(false);
  expect(observationSchema.parse({ ...fixture[0]!.observation, value: null }).value).toBeNull();
  expect(observationSchema.safeParse({ ...fixture[0]!.observation, confirmation: "broker_verified" }).success).toBe(false);
});
it("ledger validation uses exact primitives without losing legacy rounded-small-amount semantics", () => {
  const input = { accountId: "a", kind: "payout", amount: "-0.0000001", effectiveAt: "2026-10-19T00:00:00Z" };
  expect(ledgerEntryInputSchema.safeParse(input).success).toBe(true); // existing Rust rounds this to zero
  for (const amount of ["0", "-0", "0.000001", "9223372036854.775808"]) expect(ledgerEntryInputSchema.safeParse({ ...input, amount }).success).toBe(false);
});
it("enumerates all existing Build 9.5 families without redefining rules", () => {
  expect(Object.keys(ruleEvidenceRequirements).sort()).toEqual([...ruleTypes].sort());
  const common = { amount: { state: "unknown" }, method: "intraday_trailing", basis: "realized_and_unrealized", lock: { state: "unknown" } } as const;
  expect(requiredRuleEvidence("max_drawdown", common)).toEqual(expect.arrayContaining(["intradayHistory", "openPositions", "current_equity"]));
  expect(requiredRuleEvidence("max_drawdown", { ...common, method: "end_of_day_trailing" })).toContain("eodHistory");
  expect(requiredRuleEvidence("manual_check", { description: "Review dashboard" })).toContain("manual_policy_verification");
});
it("detects competing source observations independently of journal variance", () => {
  const f=fixture[0]!;
  const o=observationSchema.parse(f.observation);
  expect(compareFinancialEvidence(reconciliationRequestSchema.parse(f.request),o,observationSchema.parse(f.baseline),[],[],[],[{ ...o,id:"other",value:"1" }]).reconciliationStatus).toBe("conflicting");
});

it("returns unavailable money rather than throwing on malformed legacy financial records", () => {
  const f=fixture[0]!;
  const result=compareFinancialEvidence(reconciliationRequestSchema.parse(f.request),observationSchema.parse(f.observation),observationSchema.parse(f.baseline),
    f.trades.map(t=>tradeSchema.parse({...t,realizedPnl:"invalid legacy amount"})),[]);
  expect(result.reconciliationStatus).toBe("unsupported");expect(result.difference).toBeNull();
});

it("records sourced EOD equity and balance peaks without conflating their basis", () => {
  const {id: _id,recordedAt: _recordedAt,effectiveTradingDay: _day,timezone: _zone,tradingDayResetTime: _reset,supersedesId: _supersedes,correctionReason: _reason,...input}=observationSchema.parse(fixture[0]!.observation);
  expect(observationInputSchema.safeParse({...input,kind:"eod_settlement",basis:"equity"}).success).toBe(true);
  expect(observationInputSchema.safeParse({...input,kind:"intraday_peak",basis:"balance"}).success).toBe(true);
  expect(observationInputSchema.safeParse({...input,kind:"balance",basis:"equity"}).success).toBe(false);
});
