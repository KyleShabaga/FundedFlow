import type { LedgerEntry } from "../contracts/ledger.js";
import type { Trade } from "../contracts/trades.js";
import { isMicros, microsToDecimal, toMicros } from "../primitives/money.js";
import { riskMoney } from "./contracts.js";
import type { FinancialObservation, ReconciliationRequest, ReconciliationResult } from "./contracts.js";

/** Same explicit instant only. No inferred tolerance, current clock, FX or balancing entry. */
export function compareFinancialEvidence(request: ReconciliationRequest, observation: FinancialObservation,
  baseline: FinancialObservation, trades: readonly Trade[], ledger: readonly LedgerEntry[], supersededIds: readonly string[] = [], observations: readonly FinancialObservation[] = []): ReconciliationResult {
  const result: ReconciliationResult = {
    reconciliationStatus: "incomplete", difference: null, derivedBalance: null, asOf: request.asOf,
    freshness: "unknown", reasonCode: "missing_inputs", nextVerificationAction: "Verify source and complete interval history",
    sourceSummary: "User-reported evidence compared with journal bookkeeping; no official compliance determination",
    missingInputs: [], sourceReferences: [baseline.id, observation.id, baseline.sourceReference, observation.sourceReference, request.coverage.sourceReference],
  };
  const fail = (status: ReconciliationResult["reconciliationStatus"], reason: string) => ({ ...result, reconciliationStatus: status, reasonCode: reason });
  if (observation.id !== request.observationId || baseline.id !== request.baselineObservationId ||
      [observation, baseline, ...trades, ...ledger].some(v => v.accountId !== request.accountId))
    return fail("unsupported", "account_or_identity_mismatch");
  if (observation.currency !== baseline.currency) return fail("unsupported", "currency_mismatch");
  if (observation.basis !== "balance" || baseline.basis !== "balance" || baseline.kind !== "opening_balance" ||
      !["balance", "eod_settlement"].includes(observation.kind)) return fail("unsupported", "unsupported_basis");
  if ([baseline.id, observation.id].some(id => supersededIds.includes(id))) return fail("conflicting", "superseded_source");
  if ([baseline, observation].some(target => observations.some(o => o.accountId === request.accountId && o.currency === target.currency &&
      o.basis === target.basis && o.kind === target.kind && !supersededIds.includes(o.id) &&
      Date.parse(o.observedAt) === Date.parse(target.observedAt) && o.value !== target.value))) return fail("conflicting", "conflicting_source_records");
  const at = Date.parse(request.asOf), start = Date.parse(baseline.observedAt);
  if (Date.parse(observation.observedAt) !== at || start > at || Date.parse(request.evaluatedAt) < at) return fail("unsupported", "noncomparable_time");
  if (observation.validUntil !== null && Date.parse(observation.validUntil) < Date.parse(request.evaluatedAt)) {
    result.freshness = "stale"; return fail("stale", "expired_observation");
  }
  result.freshness = observation.validUntil === null ? "unknown" : "current";
  if (observation.validUntil === null) result.missingInputs.push("freshness_policy");
  for (const key of ["baseline", "closedTrades", "fees", "ledger"] as const) {
    const state = request.coverage[key];
    if (state === "conflicting") return fail("conflicting", `${key}_conflicting`);
    if (state === "stale") return fail("stale", `${key}_stale`);
    if (state !== "available") result.missingInputs.push(key);
  }
  if (baseline.confirmation !== "user_confirmed" || observation.confirmation !== "user_confirmed") result.missingInputs.push("user_confirmation");
  if (baseline.confidence !== "user_reported" || observation.confidence !== "user_reported") result.missingInputs.push("confidence");
  if (baseline.value === null || observation.value === null) result.missingInputs.push("observation_value");
  if ([baseline.value, observation.value].some(v => v !== null && !riskMoney.safeParse(v).success)) return fail("unsupported", "invalid_money");
  let total = baseline.value === null ? 0n : toMicros(baseline.value)!;
  for (const t of trades) {
    const end = t.exitAt === null ? null : Date.parse(t.exitAt);
    if (end !== null && end > start && end <= at) {
      result.sourceReferences.push(t.id, ...(t.importBatchId === null ? [] : [t.importBatchId]));
      if (t.realizedPnl === null) result.missingInputs.push(`pnl:${t.id}`);
      else { const m = toMicros(t.realizedPnl); if (m === null || !riskMoney.safeParse(t.realizedPnl).success) return fail("unsupported", "invalid_money"); total += m; } // Rust net P&L already includes trade fees.
    }
    // A trade spanning the baseline requires a settlement allocation we do not have.
    if (Date.parse(t.entryAt) <= start && (end === null || end > start)) result.missingInputs.push(`baseline_position:${t.id}`);
  }
  for (const e of ledger) if (Date.parse(e.effectiveAt) > start && Date.parse(e.effectiveAt) <= at) {
    result.sourceReferences.push(e.id);
    if (e.affectsBalance) { const m = toMicros(e.amount); if (m === null || !riskMoney.safeParse(e.amount).success) return fail("unsupported", "invalid_money"); total += m; }
  }
  if (result.missingInputs.length) return result;
  const difference = toMicros(observation.value!)! - total;
  if (!isMicros(total) || !isMicros(difference)) return fail("unsupported", "arithmetic_overflow");
  return { ...result, derivedBalance: microsToDecimal(total), difference: microsToDecimal(difference),
    reconciliationStatus: difference === 0n ? "matched" : "mismatched", reasonCode: difference === 0n ? "exact_match" : "variance_requires_review",
    nextVerificationAction: difference === 0n ? "Retain evidence; review rule-specific requirements separately" : "Review missing trades, fees and movements; do not auto-balance" };
}
