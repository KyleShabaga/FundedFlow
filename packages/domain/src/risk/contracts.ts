import { z } from "zod";
import { canonicalDecimal, microsToDecimal, toMicros } from "../primitives/money.js";
import { accountSchema } from "../contracts/accounts.js";
import { tradeSchema } from "../contracts/trades.js";
import { ledgerEntrySchema } from "../contracts/ledger.js";
import { applicableRulebookSchema, accountRulebookAssignmentSchema, rulebookVersionDetailSchema } from "../rulebook/versions.js";
import { accountPhaseEventSchema, accountCatalogueLinkSchema } from "../catalogue/lifecycle.js";

/** New evidence boundaries require canonical, exact i64 micro-unit values; no rounding on entry. */
export const riskMoney = z.string().refine(v => {
  const m = toMicros(v);
  return m !== null && canonicalDecimal(v) === v && microsToDecimal(m) === v;
}, "Use canonical decimal text exact to six places within i64 micro-units");
export const evidenceStateSchema = z.enum(["available", "missing", "incomplete", "stale", "conflicting", "unsupported", "manual_verification"]);
export type EvidenceState = z.infer<typeof evidenceStateSchema>;
export const observationKinds = ["opening_balance", "balance", "equity", "intraday_peak", "eod_settlement"] as const;
const id = z.string().min(1).max(200);
const instant = z.iso.datetime({ offset: true });
export const observationInputSchema = z.strictObject({
  accountId: id,
  kind: z.enum(observationKinds),
  value: riskMoney.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  basis: z.enum(["balance", "equity"]),
  observedAt: instant,
  sourceCategory: z.enum(["firm_dashboard", "user_entered", "statement"]),
  sourceReference: z.string().trim().min(1).max(2000),
  confirmation: z.enum(["unconfirmed", "user_confirmed"]),
  confidence: z.enum(["unknown", "user_reported"]),
  validUntil: instant.nullable(),
  actor: z.string().trim().min(1).max(200),
  note: z.string().max(20000).nullable(),
}).superRefine((v, c) => {
  if ((v.kind === "equity" && v.basis !== "equity") || (["opening_balance", "balance"].includes(v.kind) && v.basis !== "balance"))
    c.addIssue({ code: "custom", path: ["basis"], message: "Observation kind and basis disagree" });
  if (v.validUntil !== null && Date.parse(v.validUntil) < Date.parse(v.observedAt))
    c.addIssue({ code: "custom", path: ["validUntil"], message: "Must not precede observation" });
});
export type ObservationInput = z.infer<typeof observationInputSchema>;
export const correctionMetadataSchema = z.strictObject({ actor: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(2000) });
export const observationCorrectionSchema = z.strictObject({ replacement: observationInputSchema, reason: z.string().trim().min(1).max(2000) });
export type ObservationCorrection = z.infer<typeof observationCorrectionSchema>;
export const observationSchema = z.strictObject({
  ...observationInputSchema.shape,
  id, recordedAt: instant, effectiveTradingDay: z.iso.date(),
  timezone: z.string().min(1), tradingDayResetTime: z.string(),
  supersedesId: id.nullable(), correctionReason: z.string().nullable(),
});
export type FinancialObservation = z.infer<typeof observationSchema>;
export const ledgerRevisionSchema = z.strictObject({
  id, entryId: id, accountId: id, operation: z.enum(["baseline", "create", "update", "remove"]),
  entry: ledgerEntrySchema, deleted: z.boolean(), recordedAt: instant,
  actor: z.string(), reason: z.string(), supersedesId: id.nullable(),
});
export type LedgerRevision = z.infer<typeof ledgerRevisionSchema>;

/** Evidence coverage is an explicit assertion, never inferred from absence of rows. */
export const coverageSchema = z.strictObject({
  baseline: evidenceStateSchema, closedTrades: evidenceStateSchema, fees: evidenceStateSchema,
  ledger: evidenceStateSchema, openPositions: evidenceStateSchema,
  eodHistory: evidenceStateSchema, intradayHistory: evidenceStateSchema,
  sourceReference: z.string().min(1).max(2000),
});
export const accountRiskInputsSchema = z.strictObject({
  schemaVersion: z.literal(1), account: accountSchema, asOf: instant, effectiveTradingDay: z.iso.date(),
  observations: z.array(observationSchema), trades: z.array(tradeSchema), ledger: z.array(ledgerEntrySchema),
  ledgerHistory: z.array(ledgerRevisionSchema), phaseHistory: z.array(accountPhaseEventSchema),
  catalogueLink: accountCatalogueLinkSchema, assignments: z.array(accountRulebookAssignmentSchema),
  rulebookVersions: z.array(rulebookVersionDetailSchema),
  applicableAssignment: accountRulebookAssignmentSchema.nullable(),
  applicableRulebook: applicableRulebookSchema.nullable(),
  coverage: coverageSchema, missingInputs: z.array(z.string()),
}).superRefine((v, c) => {
  if (v.applicableAssignment !== null && (v.applicableAssignment.accountId !== v.account.id || !v.rulebookVersions.some(r => r.version.id === v.applicableAssignment!.rulebookVersionId))) c.addIssue({ code: "custom", path: ["applicableAssignment"], message: "Assignment must belong to the attempt and reference an included immutable version" });
  if (v.catalogueLink.accountId !== v.account.id) c.addIssue({ code: "custom", path: ["catalogueLink"], message: "Different account attempt" });
  for (const key of ["observations", "trades", "ledger", "ledgerHistory", "phaseHistory", "assignments"] as const)
    v[key].forEach((r, i) => { if (r.accountId !== v.account.id) c.addIssue({ code: "custom", path: [key, i, "accountId"], message: "Different account attempt" }); });
});
export const riskInputsQuerySchema = z.strictObject({ accountId: id, asOf: instant, coverage: coverageSchema });
export type RiskInputsQuery = z.infer<typeof riskInputsQuerySchema>;
export type AccountRiskInputs = z.infer<typeof accountRiskInputsSchema>;

export const reconciliationRequestSchema = z.strictObject({
  accountId: id, observationId: id, baselineObservationId: id,
  asOf: instant, evaluatedAt: instant, coverage: coverageSchema,
});
export type ReconciliationRequest = z.infer<typeof reconciliationRequestSchema>;
export const reconciliationStatuses = ["matched", "mismatched", "incomplete", "conflicting", "stale", "unsupported"] as const;
export const reconciliationResultSchema = z.strictObject({
  reconciliationStatus: z.enum(reconciliationStatuses), difference: riskMoney.nullable(), derivedBalance: riskMoney.nullable(),
  asOf: instant, freshness: z.enum(["current", "stale", "unknown"]),
  reasonCode: z.string(), nextVerificationAction: z.string(), sourceSummary: z.string(),
  missingInputs: z.array(z.string()), sourceReferences: z.array(z.string()),
});
export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;
export const reconciliationSchema = z.strictObject({
  id, accountId: id, recordedAt: instant, request: reconciliationRequestSchema,
  observation: observationSchema, baseline: observationSchema,
  trades: z.array(tradeSchema), ledger: z.array(ledgerEntrySchema), ledgerHistory: z.array(ledgerRevisionSchema),
  result: reconciliationResultSchema,
  supersededIds: z.array(z.string()), observations: z.array(observationSchema),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;
export const reconciliationResolutionInputSchema = z.strictObject({
  ...correctionMetadataSchema.shape, status: z.enum(["reviewed", "dismissed", "unresolved"]),
});
export type ReconciliationResolutionInput = z.infer<typeof reconciliationResolutionInputSchema>;
export const reconciliationResolutionSchema = z.strictObject({
  ...reconciliationResolutionInputSchema.shape, id, reconciliationId: id, recordedAt: instant,
});
export type ReconciliationResolution = z.infer<typeof reconciliationResolutionSchema>;
