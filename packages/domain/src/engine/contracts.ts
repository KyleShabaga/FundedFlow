import { z } from "zod";
import { riskMoney } from "../risk/contracts.js";
import { ruleTypes, type RuleType } from "../rulebook/rules.js";
export const ENGINE_VERSION = "fundedflow-risk/1";
export const ruleOutcomeStates = [
  "satisfied",
  "breached",
  "caution",
  "unknown",
  "unsupported",
  "manual_only",
  "stale",
  "conflicting",
  "not_applicable",
  "absent",
  "disabled",
] as const;
export type RuleOutcomeState = (typeof ruleOutcomeStates)[number];
/** Boundary is an explicit calculation policy; never silently infer provider semantics. */
export const enginePolicySchema = z.strictObject({
  ruleCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  ruleCurrencySourceClaimIds: z.array(z.string()),
  boundary: z.enum(["touch_is_breach", "below_is_breach"]).nullable(),
  boundarySourceClaimIds: z.array(z.string()),
  reconciliationRevisionIds: z.array(z.string()),
  personalCautionHeadroom: riskMoney.nullable(),
  priorBreaches: z.array(
    z.strictObject({
      accountId: z.string(),
      rulebookVersionId: z.string(),
      assignmentId: z.string(),
      ruleKey: z.string(),
      observedAt: z.iso.datetime({ offset: true }),
      sourceReferences: z.array(z.string()).min(1),
    }),
  ),
});
export type EnginePolicy = z.infer<typeof enginePolicySchema>;
export const ruleOutcomeSchema = z.strictObject({
  ruleId: z.string(),
  ruleKey: z.string(),
  ruleType: z.enum(ruleTypes as [RuleType, ...RuleType[]]),
  state: z.enum(ruleOutcomeStates),
  reasonCode: z.string(),
  metrics: z.record(
    z.string(),
    z.union([riskMoney, z.boolean(), z.number().int(), z.null()]),
  ),
  formula: z.string(),
  operands: z.record(z.string(), z.union([riskMoney, z.null()])),
  sourceReferences: z.array(z.string()),
  missingInputs: z.array(z.string()),
  evidence: z.array(
    z.strictObject({
      requirement: z.string(),
      state: z.string(),
      reasonCode: z.string(),
      nextVerificationAction: z.string(),
      sourceSummary: z.string(),
      asOf: z.string(),
    }),
  ),
  assumptions: z.array(z.string()),
});
export type RuleOutcome = z.infer<typeof ruleOutcomeSchema>;
export const engineResultSchema = z.strictObject({
  accountId: z.string(),
  rulebookVersionId: z.string().nullable(),
  assignmentId: z.string().nullable(),
  programmePhaseId: z.string().nullable(),
  phasePathId: z.string().nullable(),
  engineVersion: z.literal(ENGINE_VERSION),
  tradingDay: z.string(),
  asOf: z.string(),
  dataAsOf: z.string().nullable(),
  inputsHash: z.string(),
  status: z.enum(["Safe", "Caution", "Stop", "Unknown"]),
  assurance: z.enum([
    "user_reported_estimate",
    "user_defined_estimate",
    "unverified",
  ]),
  reasons: z.array(z.string()),
  rules: z.array(ruleOutcomeSchema),
  tradingDaysCompleted: z.int().min(0).nullable(),
  balance: riskMoney.nullable(),
  realizedDayPnl: riskMoney.nullable(),
  sourceReferences: z.array(z.string()),
  assumptions: z.array(z.string()),
});
export type EngineResult = z.infer<typeof engineResultSchema>;
export const defaultEnginePolicy: EnginePolicy = Object.freeze({
  ruleCurrency: null,
  ruleCurrencySourceClaimIds: Object.freeze([]) as unknown as string[],
  boundary: null,
  boundarySourceClaimIds: Object.freeze([]) as unknown as string[],
  personalCautionHeadroom: null,
  reconciliationRevisionIds: Object.freeze([]) as unknown as string[],
  priorBreaches: Object.freeze([]) as unknown as EnginePolicy["priorBreaches"],
});
