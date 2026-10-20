// Rule definitions and their typed parameters (Build 9.5).
//
// One discriminated union over `ruleType`, so every rule's parameters are
// validated by the schema for its type and nothing else. The rules engine
// (Build 16) imports these schemas; it must not redefine them. This module
// holds no formulas: it records what a rule says, not what it computes.
//
// Money is canonical decimal text (stored by Rust as `*_micros`). Values the
// provider has not stated stay `unknown`; enums carry an explicit "unknown"
// member rather than a guess.

import { z } from "zod";

import { catalogueMoney, providerLabel } from "../catalogue/fields.js";
import { phaseKeys } from "../catalogue/versions.js";
import { canonicalDecimal } from "../primitives/money.js";
import { presence } from "./presence.js";

/** Version of the parameter shapes below. Bump it, with a data step, when a shape changes. */
export const RULE_PARAMETER_SCHEMA_VERSION = 1;

const count = z.int().min(0);
const positiveCount = z.int().min(1);

/** A share in (0, 1] as canonical decimal text ("0.5" = 50%). */
export const shareOfOne = z.string().refine((v) => {
  if (canonicalDecimal(v) !== v) return false;
  const n = Number(v);
  return n > 0 && n <= 1;
}, "Use a canonical decimal greater than 0 and at most 1");

/** Root symbol such as "ES" or "MES". */
const symbolRoot = z.string().regex(/^[A-Z0-9]{1,10}$/, "Use an upper-case root symbol such as ES");

const unrealizedBasis = z.enum(["realized", "realized_and_unrealized", "unknown"]);

const profitTarget = z.strictObject({
  amount: presence(catalogueMoney),
  /** What the target is measured against. */
  basis: z.enum(["balance", "equity", "unknown"]),
});

const dailyLossLimit = z.strictObject({
  limit: presence(catalogueMoney),
  basis: unrealizedBasis,
  /** When the day's loss resets: the account's trading day, a provider session, or not stated. */
  resetBasis: z.enum(["account_trading_day", "provider_session", "unknown"]),
  breach: z.enum(["hard", "soft", "unknown"]),
  /** Conditional limits ("DLL below initial trail") are explicit, never inferred. */
  condition: z.enum(["always", "below_initial_trail", "unknown"]),
});

const maxDrawdown = z.strictObject({
  amount: presence(catalogueMoney),
  /** An "EOD" label alone does not establish the method; use "unknown" until confirmed. */
  method: z.enum(["static", "end_of_day_trailing", "intraday_trailing", "unknown"]),
  basis: unrealizedBasis,
  /** Trail lock: once balance reaches `triggerBalance`, the floor stops at `lockedFloor`. */
  lock: presence(z.strictObject({ triggerBalance: catalogueMoney, lockedFloor: catalogueMoney })),
});

/** Minimum trading days, or qualifying profit days when `minDayProfit` is a value. */
const minTradingDays = z.strictObject({
  days: presence(positiveCount),
  minDayProfit: presence(catalogueMoney),
  dayBasis: z.enum(["trading_day", "calendar_day", "unknown"]),
});

const consistency = z.strictObject({
  /** Largest winning day as a share of the denominator. */
  maxBestDayShare: presence(shareOfOne),
  denominator: z.enum(["total_profit", "profit_target", "unknown"]),
  appliesTo: z.enum(["evaluation", "payout", "both", "unknown"]),
});

const positionLimit = z.strictObject({
  /** "mini", "micro" or "any" contract class; `symbolRoot` narrows it to one product. */
  contractClass: z.enum(["mini", "micro", "any"]),
  symbolRoot: symbolRoot.nullable(),
  maxContracts: positiveCount,
});

const maxPositionSize = z.strictObject({
  limits: presence(z.array(positionLimit).min(1)),
  /**
   * How several limits combine. "4 minis OR 40 micros" is not proof of a
   * universal 10:1 equivalence, so `unknown` is the default.
   */
  combination: z.enum(["each", "either", "aggregate_equivalent", "unknown"]),
  microsPerMini: presence(positiveCount),
});

const maxTradesPerDay = z.strictObject({ count: presence(positiveCount) });

const payoutEligibility = z.strictObject({
  initialWaitingDays: presence(count),
  /** Provider wording for the cadence ("every 5 trading days"); not parsed. */
  frequency: presence(z.string().min(1).max(200)),
  minBalance: presence(catalogueMoney),
  minProfit: presence(catalogueMoney),
  perRequestCap: presence(catalogueMoney),
});

const payoutCountTransition = z.strictObject({
  payoutsRequired: presence(positiveCount),
  nextPhase: z.enum([...phaseKeys]),
});

const scalingPlan = z.strictObject({
  /** "Scaling plan: Yes" alone is `offered: value(true)` with an unknown schedule. */
  offered: presence(z.boolean()),
  schedule: presence(z.array(z.strictObject({ balanceAtLeast: catalogueMoney, maxContracts: positiveCount })).min(1)),
});

const tradingRestriction = z.strictObject({
  category: z.enum(["news", "overnight", "weekend", "strategy", "inactivity", "other"]),
  description: z.string().min(1).max(2_000),
});

const manualCheck = z.strictObject({ description: z.string().min(1).max(2_000) });

const unknownRule = z.strictObject({ description: z.string().max(2_000).nullable() });

export const ruleParameterSchemas = {
  profit_target: profitTarget,
  daily_loss_limit: dailyLossLimit,
  max_drawdown: maxDrawdown,
  min_trading_days: minTradingDays,
  consistency,
  max_position_size: maxPositionSize,
  max_trades_per_day: maxTradesPerDay,
  payout_eligibility: payoutEligibility,
  payout_count_transition: payoutCountTransition,
  scaling_plan: scalingPlan,
  trading_restriction: tradingRestriction,
  manual_check: manualCheck,
  unknown: unknownRule,
} as const;

export type RuleType = keyof typeof ruleParameterSchemas;
export const ruleTypes = Object.keys(ruleParameterSchemas) as RuleType[];

/** Rule types that are always confirmed by a person, never calculated. */
export const manualRuleTypes: readonly RuleType[] = ["trading_restriction", "manual_check", "unknown"];

/**
 * What FundedFlow can do with a rule:
 * - `supported`: every value the engine needs is known;
 * - `manual_only`: shown as a checklist item, never treated as compliant;
 * - `unsupported`: recorded but not evaluated;
 * - `needs_setup`: a needed value is still unknown, so the risk status is indeterminate.
 */
export const supportStatuses = ["supported", "manual_only", "unsupported", "needs_setup"] as const;
export type SupportStatus = (typeof supportStatuses)[number];

/** A rule the user keeps beside the provider's terms, never a provider claim. */
export const overrideKinds = ["personal_limit"] as const;

export const ruleKey = z
  .string()
  .max(100)
  .regex(/^[a-z0-9_]+(?::[a-z0-9_]+)*$/, "Use lowercase words joined by ':'");

/**
 * ID of a rulebook version or rule: a UUIDv7 for new records; a converted
 * legacy record keeps its legacy ID, so old references still resolve.
 */
export const rulebookRecordId = z.string().min(1).max(100);

const ruleFields = {
  id: rulebookRecordId,
  rulebookVersionId: rulebookRecordId,
  /** Stable within a version and across versions of one rulebook ("max_drawdown"). */
  ruleKey,
  parameterSchemaVersion: z.literal(RULE_PARAMETER_SCHEMA_VERSION),
  /** Exact provider wording ("Trailing Max Drawdown (EOD)"); null for user-authored rules. */
  providerLabel: providerLabel.nullable(),
  /** The user's own label. */
  displayLabel: z.string().max(200).nullable(),
  /** Source wording the rule was read from. */
  sourceText: z.string().max(2_000).nullable(),
  supportStatus: z.enum(supportStatuses),
  overrideKind: z.enum(overrideKinds).nullable(),
  displayOrder: z.int().min(0),
};

type RuleFields = z.infer<z.ZodObject<typeof ruleFields>>;

export type RuleParameters<T extends RuleType = RuleType> = z.infer<(typeof ruleParameterSchemas)[T]>;
export type RuleDefinition = {
  [T in RuleType]: RuleFields & { ruleType: T; parameters: RuleParameters<T> };
}[RuleType];

export const ruleDefinitionSchema = z.discriminatedUnion(
  "ruleType",
  ruleTypes.map((t) =>
    z.strictObject({ ...ruleFields, ruleType: z.literal(t), parameters: ruleParameterSchemas[t] }),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
) as unknown as z.ZodType<RuleDefinition>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A rule as submitted for a draft; the ID and version are assigned by the adapter. */
export type RuleDefinitionInput = DistributiveOmit<RuleDefinition, "id" | "rulebookVersionId">;

const { id: _id, rulebookVersionId: _version, ...inputFields } = ruleFields;

export const ruleDefinitionInputSchema = z.discriminatedUnion(
  "ruleType",
  ruleTypes.map((t) =>
    z.strictObject({ ...inputFields, ruleType: z.literal(t), parameters: ruleParameterSchemas[t] }),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
) as unknown as z.ZodType<RuleDefinitionInput>;

/** The parameter paths that must be known for a `supported` rule of each type. */
export const requiredValues: Record<RuleType, readonly string[]> = {
  profit_target: ["amount"],
  daily_loss_limit: ["limit"],
  max_drawdown: ["amount", "method"],
  min_trading_days: ["days"],
  consistency: ["maxBestDayShare"],
  max_position_size: ["limits", "combination"],
  max_trades_per_day: ["count"],
  payout_eligibility: [],
  payout_count_transition: ["payoutsRequired"],
  scaling_plan: ["offered", "schedule"],
  trading_restriction: [],
  manual_check: [],
  unknown: [],
};
