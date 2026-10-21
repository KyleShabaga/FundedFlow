import type { RuleType, RuleParameters } from "../rulebook/rules.js";
import type { AccountRiskInputs, EvidenceState } from "./contracts.js";

/** Minimum evidence only. Build 16 still validates parameters, applicability and evaluates rules. */
export const ruleEvidenceRequirements = {
  max_drawdown: ["baseline", "closedTrades", "fees", "ledger"],
  daily_loss_limit: ["baseline", "closedTrades", "fees", "ledger"],
  profit_target: ["baseline", "closedTrades", "fees", "ledger"],
  consistency: ["closedTrades", "fees"], min_trading_days: ["closedTrades", "fees"],
  max_position_size: ["openPositions"], max_trades_per_day: ["closedTrades"],
  payout_eligibility: ["baseline", "closedTrades", "fees", "ledger"],
  payout_count_transition: ["ledger"], scaling_plan: ["openPositions", "baseline"],
  trading_restriction: [], manual_check: [], unknown: [],
} as const satisfies Record<RuleType, readonly (keyof AccountRiskInputs["coverage"])[]>;

export function requiredRuleEvidence<T extends RuleType>(type: T, parameters: RuleParameters<T>): string[] {
  const needs: string[] = [...ruleEvidenceRequirements[type]];
  const p = parameters as Record<string, unknown>;
  if (type === "max_drawdown") {
    if (p.method === "end_of_day_trailing") needs.push("eodHistory");
    if (p.method === "intraday_trailing") needs.push("intradayHistory", "openPositions");
    if (p.method === "unknown") needs.push("verified_method");
  }
  if (p.basis === "realized_and_unrealized" || p.basis === "equity") needs.push("openPositions", "current_equity");
  if (p.basis === "unknown") needs.push("verified_basis");
  if (["payout_eligibility", "payout_count_transition", "trading_restriction", "manual_check", "unknown", "scaling_plan"].includes(type)) needs.push("manual_policy_verification");
  if (type === "max_position_size" || type === "max_trades_per_day") needs.push("execution_history");
  return [...new Set(needs)];
}

export function assessRuleEvidence<T extends RuleType>(input: AccountRiskInputs, type: T, parameters: RuleParameters<T>) {
  return requiredRuleEvidence(type, parameters).map(requirement => {
    let state: EvidenceState = requirement in input.coverage && requirement !== "sourceReference" ? input.coverage[requirement as Exclude<keyof typeof input.coverage, "sourceReference">] : "unsupported";
    if (requirement === "manual_policy_verification") state = "manual_verification";
    if (["openPositions", "intradayHistory", "execution_history"].includes(requirement)) state = "unsupported";
    if (requirement === "baseline" && !input.observations.some(o => o.kind === "opening_balance" && o.value !== null && o.confirmation === "user_confirmed" && o.confidence === "user_reported" && o.currency === input.account.currency && Date.parse(o.observedAt) <= Date.parse(input.asOf) && !input.observations.some(r => r.supersedesId === o.id))) state = "missing";
    if (requirement === "eodHistory" && !input.observations.some(o => o.kind === "eod_settlement" && o.value !== null && o.currency === input.account.currency && o.confirmation === "user_confirmed" && o.confidence === "user_reported" && !input.observations.some(r => r.supersedesId === o.id) && Date.parse(o.observedAt) <= Date.parse(input.asOf))) state = "missing";
    if (requirement === "current_equity") {
      const replaced = new Set(input.observations.map(o => o.supersedesId));
      const values = input.observations.filter(o => o.kind === "equity" && o.currency === input.account.currency && !replaced.has(o.id));
      const current = values.filter(o => Date.parse(o.observedAt) === Date.parse(input.asOf) && o.value !== null);
      state = current.length > 1 && new Set(current.map(o => o.value)).size > 1 ? "conflicting"
        : current.length === 0 ? (values.length ? "stale" : "missing")
        : current[0]!.validUntil === null ? "manual_verification"
        : Date.parse(current[0]!.validUntil) < Date.parse(input.asOf) ? "stale"
        : current[0]!.confirmation === "user_confirmed" && current[0]!.confidence === "user_reported" ? "available" : "manual_verification";
    }
    return { requirement, state, reasonCode: `${requirement}_${state}`, nextVerificationAction: state === "available" ? "Verify rule applicability and semantics separately" : `Supply or verify sourced ${requirement}`, sourceSummary: "User-reported input sufficiency only; not provider compliance", asOf: input.asOf };
  });
}
