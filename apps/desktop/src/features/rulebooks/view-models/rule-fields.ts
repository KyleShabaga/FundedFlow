// How each Build 9.5 rule type's parameters are labelled, edited and shown (Build 19).
//
// This is presentation metadata only. The shapes are validated by the domain's
// `ruleDefinitionInputSchema` (packages/domain/src/rulebook/rules.ts); nothing
// here re-declares what is valid or computes anything from a rule.
import { phaseKeys, presenceStates, type PresenceState, type RuleType } from "@fundedflow/domain";
import { formatMoney } from "../../../design-system/format";

export type FieldSpec =
  | { kind: "money"; key: string; label: string }
  | { kind: "count"; key: string; label: string; min: 0 | 1; unit?: string }
  | { kind: "share"; key: string; label: string }
  | { kind: "text"; key: string; label: string }
  | { kind: "boolean"; key: string; label: string }
  | { kind: "enum"; key: string; label: string; options: readonly string[] }
  | { kind: "lock"; key: string; label: string }
  | { kind: "limits"; key: string; label: string }
  | { kind: "schedule"; key: string; label: string }
  | { kind: "description"; key: string; label: string; nullable: boolean };

const basis = ["realized", "realized_and_unrealized", "unknown"] as const;

export const RULE_FIELDS: Record<RuleType, readonly FieldSpec[]> = {
  profit_target: [
    { kind: "money", key: "amount", label: "Target" },
    { kind: "enum", key: "basis", label: "Measured on", options: ["balance", "equity", "unknown"] },
  ],
  daily_loss_limit: [
    { kind: "money", key: "limit", label: "Limit" },
    { kind: "enum", key: "basis", label: "Counts", options: basis },
    { kind: "enum", key: "resetBasis", label: "Resets on", options: ["account_trading_day", "provider_session", "unknown"] },
    { kind: "enum", key: "breach", label: "On breach", options: ["hard", "soft", "unknown"] },
    { kind: "enum", key: "condition", label: "Applies", options: ["always", "below_initial_trail", "unknown"] },
  ],
  max_drawdown: [
    { kind: "money", key: "amount", label: "Drawdown" },
    { kind: "enum", key: "method", label: "Method", options: ["static", "end_of_day_trailing", "intraday_trailing", "unknown"] },
    { kind: "enum", key: "basis", label: "Counts", options: basis },
    { kind: "lock", key: "lock", label: "Trail lock" },
  ],
  min_trading_days: [
    { kind: "count", key: "days", label: "Days", min: 1, unit: "days" },
    { kind: "money", key: "minDayProfit", label: "Qualifying day profit" },
    { kind: "enum", key: "dayBasis", label: "Day counted as", options: ["trading_day", "calendar_day", "unknown"] },
  ],
  consistency: [
    { kind: "share", key: "maxBestDayShare", label: "Best day at most" },
    { kind: "enum", key: "denominator", label: "Share of", options: ["total_profit", "profit_target", "unknown"] },
    { kind: "enum", key: "appliesTo", label: "Applies to", options: ["evaluation", "payout", "both", "unknown"] },
  ],
  max_position_size: [
    { kind: "limits", key: "limits", label: "Contract limits" },
    { kind: "enum", key: "combination", label: "Limits combine", options: ["each", "either", "aggregate_equivalent", "unknown"] },
    { kind: "count", key: "microsPerMini", label: "Micros per mini", min: 1 },
  ],
  max_trades_per_day: [{ kind: "count", key: "count", label: "Trades per day", min: 1, unit: "trades" }],
  payout_eligibility: [
    { kind: "count", key: "initialWaitingDays", label: "Initial waiting days", min: 0, unit: "days" },
    { kind: "text", key: "frequency", label: "Payout cadence (provider wording)" },
    { kind: "money", key: "minBalance", label: "Minimum balance" },
    { kind: "money", key: "minProfit", label: "Minimum profit" },
    { kind: "money", key: "perRequestCap", label: "Cap per request" },
  ],
  payout_count_transition: [
    { kind: "count", key: "payoutsRequired", label: "Payouts required", min: 1 },
    { kind: "enum", key: "nextPhase", label: "Then moves to", options: phaseKeys },
  ],
  scaling_plan: [
    { kind: "boolean", key: "offered", label: "Scaling plan offered" },
    { kind: "schedule", key: "schedule", label: "Schedule" },
  ],
  trading_restriction: [
    { kind: "enum", key: "category", label: "Category", options: ["news", "overnight", "weekend", "strategy", "inactivity", "other"] },
    { kind: "description", key: "description", label: "What is restricted", nullable: false },
  ],
  manual_check: [{ kind: "description", key: "description", label: "What to check", nullable: false }],
  unknown: [{ kind: "description", key: "description", label: "What the rule says", nullable: true }],
};

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  profit_target: "Profit target",
  daily_loss_limit: "Daily loss limit",
  max_drawdown: "Maximum drawdown",
  min_trading_days: "Minimum trading days",
  consistency: "Consistency",
  max_position_size: "Maximum position size",
  max_trades_per_day: "Maximum trades per day",
  payout_eligibility: "Payout eligibility",
  payout_count_transition: "Payouts before next phase",
  scaling_plan: "Scaling plan",
  trading_restriction: "Trading restriction",
  manual_check: "Manual check",
  unknown: "Unrecognised rule",
};

export const PRESENCE_LABELS: Record<PresenceState, string> = {
  unknown: "Unknown",
  explicit_none: "None (stated by the source)",
  disabled: "Off",
  not_applicable: "Not applicable",
  value: "Value",
};
export const PRESENCE_OPTIONS = presenceStates.map(state => ({ value: state, label: PRESENCE_LABELS[state] }));

const ENUM_LABELS: Record<string, string> = {
  unknown: "Unknown (not stated)",
  realized: "Realized P&L",
  realized_and_unrealized: "Realized and unrealized",
  account_trading_day: "Account trading day",
  provider_session: "Provider session",
  below_initial_trail: "Below the initial trail",
  end_of_day_trailing: "End-of-day trailing",
  intraday_trailing: "Intraday trailing",
  trading_day: "Trading days",
  calendar_day: "Calendar days",
  total_profit: "Total profit",
  profit_target: "Profit target",
  aggregate_equivalent: "Aggregate equivalent",
  simulated_funded: "Simulated funded",
  live_funded: "Live funded",
};
export const enumLabel = (value: string) => ENUM_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");

/** Parameters for a new rule: every stated value unknown, every enum "unknown" where it has one. */
export function emptyParameters(type: RuleType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RULE_FIELDS[type]) {
    if (f.kind === "enum") out[f.key] = f.options.includes("unknown") ? "unknown" : f.options[f.options.length - 1];
    else if (f.kind === "description") out[f.key] = f.nullable ? null : "";
    else out[f.key] = { state: "unknown" };
  }
  return out;
}

type Presence = { state: PresenceState; value?: unknown };
const isPresence = (v: unknown): v is Presence => typeof v === "object" && v !== null && "state" in v;

/** The presence state of a parameter, or null when the parameter is not tagged. */
export function presenceOf(value: unknown): PresenceState | null {
  return isPresence(value) ? value.state : null;
}

/**
 * The rule's headline presence for RuleStateBadge: unknown when any required
 * value is unknown, otherwise the state of the first tagged value.
 */
export function headlinePresence(type: RuleType, parameters: Record<string, unknown>): PresenceState {
  const tagged = RULE_FIELDS[type].map(f => presenceOf(parameters[f.key])).filter((s): s is PresenceState => s !== null);
  if (tagged.length === 0) return "value";
  return tagged.includes("unknown") ? "unknown" : tagged[0];
}

/** One parameter as text, for overviews and comparisons. Money is formatted exactly (format.ts). */
export function describeValue(spec: FieldSpec, raw: unknown, currency: string | null): string {
  const money = (v: unknown) => (typeof v === "string" ? formatMoney(v, { signed: false, currency, dp: 2 }) : "—");
  if (spec.kind === "enum") return typeof raw === "string" ? enumLabel(raw) : "—";
  if (spec.kind === "description") return typeof raw === "string" && raw.trim() !== "" ? raw : "Not described";
  if (!isPresence(raw)) return "—";
  if (raw.state !== "value") return PRESENCE_LABELS[raw.state];
  const v = raw.value;
  switch (spec.kind) {
    case "money":
      return money(v);
    case "count":
      return typeof v === "number" ? `${v.toLocaleString("en-US")}${spec.unit ? ` ${spec.unit}` : ""}` : "—";
    case "share":
      // Display only: the share stays canonical decimal text in storage.
      return typeof v === "string" ? `${v} (${(Number(v) * 100).toLocaleString("en-US", { maximumFractionDigits: 4 })}%)` : "—";
    case "text":
      return typeof v === "string" ? `“${v}”` : "—";
    case "boolean":
      return v === true ? "Yes" : v === false ? "No" : "—";
    case "lock": {
      const lock = v as { triggerBalance?: unknown; lockedFloor?: unknown } | undefined;
      return `Floor locks at ${money(lock?.lockedFloor)} once the balance reaches ${money(lock?.triggerBalance)}`;
    }
    case "limits":
      return Array.isArray(v)
        ? v.map((l: { contractClass?: string; symbolRoot?: string | null; maxContracts?: number }) =>
          `${l.maxContracts ?? "?"} ${l.symbolRoot ?? ""}${l.symbolRoot ? " " : ""}${l.contractClass === "any" ? "contracts" : `${l.contractClass}s`}`.trim()).join("; ")
        : "—";
    case "schedule":
      return Array.isArray(v)
        ? v.map((s: { balanceAtLeast?: unknown; maxContracts?: number }) => `from ${money(s.balanceAtLeast)}: ${s.maxContracts ?? "?"} contracts`).join("; ")
        : "—";
  }
}
