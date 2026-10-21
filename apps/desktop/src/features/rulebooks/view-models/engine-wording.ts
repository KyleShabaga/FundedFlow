// Words for Build 16 engine results (Build 19). Wording only: every value comes from the engine.
import type { EngineResult, RuleOutcomeState } from "@fundedflow/domain";
import type { StatusKind, Tone } from "../../../design-system";

export const RESULT_STATUS: Record<EngineResult["status"], { label: string; kind: StatusKind }> = {
  Safe: { label: "Safe (estimate)", kind: "success" },
  Caution: { label: "Caution (estimate)", kind: "caution" },
  Stop: { label: "Stop", kind: "danger" },
  Unknown: { label: "Unknown", kind: "unknown" },
};

/** What the result can be trusted for. Never "compliant" or "passed". */
export const ASSURANCE: Record<EngineResult["assurance"], string> = {
  user_reported_estimate: "Estimate from verified rules and the balances and history you reported. Verify with your firm's dashboard.",
  user_defined_estimate: "Estimate from your own account rules, not the firm's verified terms.",
  unverified: "The rules are not verified, so this is not a compliance result.",
};

export const OUTCOME: Record<RuleOutcomeState, { label: string; tone: Tone }> = {
  satisfied: { label: "Within limit", tone: "profit" },
  breached: { label: "Breached", tone: "loss" },
  caution: { label: "Caution", tone: "warn" },
  unknown: { label: "Unknown", tone: "neutral" },
  unsupported: { label: "Not supported", tone: "neutral" },
  manual_only: { label: "Manual check", tone: "flow" },
  stale: { label: "Stale", tone: "warn" },
  conflicting: { label: "Conflicting", tone: "loss" },
  not_applicable: { label: "Not applicable", tone: "neutral" },
  absent: { label: "None", tone: "neutral" },
  disabled: { label: "Off", tone: "neutral" },
};

const REASONS: Record<string, string> = {
  missing_opening_baseline: "No confirmed opening balance checkpoint.",
  ambiguous_opening_baseline: "More than one opening balance checkpoint.",
  opening_and_starting_reference_conflict: "The opening checkpoint and the account's starting balance disagree.",
  incomplete_trade_history: "You haven't stated that the trade history is complete.",
  unknown_realized_pnl: "Some trades have no P&L.",
  baseline_open_position_allocation: "A trade was open at the opening checkpoint.",
  historical_checkpoint_conflict: "A recorded balance disagrees with the trades and ledger before it.",
  observed_derived_balance_conflict: "The balance you recorded now disagrees with the trades and ledger.",
  conflicting_observations: "Two checkpoints for the same moment disagree.",
  observation_currency_mismatch: "A checkpoint is in another currency.",
  session_context_changed: "The account's time zone or day start changed after checkpoints were recorded.",
  missing_assignment: "No rulebook assignment covers this day.",
  ambiguous_assignment: "More than one assignment covers this day.",
  missing_or_ambiguous_version: "The assigned version couldn't be identified.",
  unverified_or_archived_rulebook: "The assigned version isn't verified or is archived.",
  unsimulatable_rulebook_version: "This version can't be simulated (discarded, archived or another account's).",
  phase_path_context_unresolved: "The account's programme phase or path isn't recorded, so catalogue rules can't be matched.",
  provider_mismatch: "The rulebook belongs to another provider than the account.",
  ambiguous_or_missing_applicability: "The version doesn't apply to the account's phase and path.",
  rulebook_outside_effective_interval: "The provider-stated dates of this version don't cover the cutoff.",
  conflicting_phase_history: "The account's phase history contradicts itself.",
  historical_or_inactive_account: "The account isn't active, so it isn't evaluated as live.",
  no_material_evaluable_rules: "No rule here can be evaluated.",
  historical_breach_requires_version_policy_review: "An earlier breach was recorded under another version or assignment: review it.",
  prior_breach_source_requires_review: "An earlier breach's sources changed: review it.",
  known_prior_breach_persists: "A breach recorded earlier still stands.",
  unconfirmed_private_rulebook: "Your account rules haven't been confirmed by you.",
  unverified_parameter_claims: "Not every value has a verified source claim.",
  unresolved_or_mismatched_rule_currency: "The currency of the rule amounts isn't stated, or isn't the account's.",
  missing_breach_boundary_policy: "It isn't stated whether touching a limit counts as a breach.",
  unsourced_breach_boundary: "The breach boundary has no verified source.",
  conflicting_rule_claims: "Sources contradict this rule.",
  stale_rule_claims: "A source for this rule is stale.",
  rule_needs_setup: "A value this rule needs is unknown.",
  manual_rule_verification: "You confirm this rule yourself.",
  unsupported_rule: "Recorded, not evaluated.",
  insufficient_rule_evidence: "The evidence this rule needs is missing or incomplete.",
  stale_evidence: "Evidence is stale.",
  conflicting_evidence: "Evidence conflicts.",
  unknown_drawdown_method: "The drawdown method isn't stated.",
  missing_peak_or_settlement_history: "No confirmed end-of-day or peak history.",
  unobserved_equity_history: "Live equity isn't recorded, so equity-based limits can't be checked.",
  ledger_effect_on_risk_floor_unspecified: "Payouts, resets or adjustments are recorded, and how they move the floor isn't stated.",
  ledger_effect_on_daily_loss_unspecified: "Ledger movements today, and how they count isn't stated.",
  ledger_effect_on_target_unspecified: "Ledger movements recorded, and how they count toward the target isn't stated.",
  simultaneous_close_order_unavailable: "Trades closed at the same moment; their order decides the result and isn't known.",
  simultaneous_lock_trigger_order_unavailable: "Whether the lock triggered depends on an unknown order of trades.",
  loss_threshold_breached: "The limit was reached.",
  personal_caution_buffer: "Within your personal caution buffer (your preference, not firm policy).",
  personal_limit_exceeded: "Your personal limit was exceeded.",
  unknown_account_phase: "The account's phase isn't recorded.",
  unknown_lock_policy: "Whether the trail locks isn't stated.",
  unsupported_daily_loss_basis_or_session: "This daily loss basis or session isn't supported.",
  conditional_daily_loss_trigger_unmodeled: "This limit applies only under a condition that isn't modelled.",
  unknown_daily_breach_policy: "Whether the daily limit is hard or soft isn't stated.",
  missing_day_pnl: "Today's P&L is unknown.",
  closed_round_trips_are_not_execution_counts: "Closed trades don't show executions, so this isn't counted.",
  missing_concurrent_execution_history: "Open-position history isn't recorded.",
  payout_waiting_day_and_cycle_semantics_unspecified: "Payout waiting days and cycles aren't modelled.",
  arithmetic_overflow_or_invalid_financial_value: "A value is out of range.",
};

/** A reason code as a sentence. Unmapped codes stay visible, in words, rather than being hidden. */
export function reasonText(code: string): string {
  if (REASONS[code]) return REASONS[code];
  const review = /^reconciliation_review:[^:]+:(\w+)$/.exec(code);
  if (review) return `A balance comparison is ${review[1]} and unresolved.`;
  const text = code.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

/** Metric and operand names as labels. */
export function quantityLabel(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
