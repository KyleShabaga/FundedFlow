// Rulebooks, immutable versions, applicability, claims and account
// assignments (Build 9.5). See docs/data-model.md#rulebooks.
//
// Two kinds of rulebook share these shapes:
// - a catalogue rulebook (`ownerAccountId` null) belongs to a provider and is
//   reused by programme phases and paths; a version becomes usable only when
//   a named reviewer verifies it;
// - an account-private rulebook (`ownerAccountId` set) holds rules the user
//   wrote for one account. It is never provider-verified; publishing puts it
//   in use (`needs_review`), and `userConfirmedAt` records the user's own check.
//
// A version is editable only as a never-verified draft. Corrections are new
// versions; publishing new terms never rewrites an account's assignments.

import { z } from "zod";

import { catalogueId, catalogueInstant, catalogueSlug, displayName } from "../catalogue/fields.js";
import { claimOrigins, verificationStatuses } from "../catalogue/provenance.js";
import { RULE_PARAMETER_SCHEMA_VERSION, ruleDefinitionInputSchema, ruleDefinitionSchema, rulebookRecordId } from "./rules.js";

/** Trading day `YYYY-MM-DD` in the account's timezone and reset (see docs/data-model.md#trading-day). */
export const tradingDay = z.iso.date();

export const rulebookRecordStatuses = ["active", "archived"] as const;

export const rulebookSchema = z
  .strictObject({
    id: catalogueId,
    providerId: catalogueId.nullable(),
    /** Set for an account-private rulebook; null for a catalogue rulebook. */
    ownerAccountId: z.string().min(1).nullable(),
    slug: catalogueSlug,
    displayName,
    description: z.string().max(2_000).nullable(),
    recordStatus: z.enum(rulebookRecordStatuses),
    createdAt: catalogueInstant,
    updatedAt: catalogueInstant,
  })
  .refine((r) => r.ownerAccountId !== null || r.providerId !== null, {
    path: ["providerId"],
    message: "A catalogue rulebook belongs to a provider",
  });
export type Rulebook = z.infer<typeof rulebookSchema>;

/** Where a version's content came from. `legacy_*` versions were converted from account-owned rulebooks. */
export const rulebookVersionOrigins = [
  "catalogue",
  "user_authored",
  "legacy_manual",
  "legacy_template",
  "legacy_copied",
] as const;

export const rulebookVersionSchema = z
  .strictObject({
    id: rulebookRecordId,
    rulebookId: catalogueId,
    versionNumber: z.int().min(1),
    /** Version of the rule parameter shapes this version was written with. */
    schemaVersion: z.literal(RULE_PARAMETER_SCHEMA_VERSION),
    verificationStatus: z.enum(verificationStatuses),
    origin: z.enum(rulebookVersionOrigins),
    /** When the terms were captured. Never a substitute for `effectiveFrom`. */
    capturedAt: catalogueInstant,
    /** Provider-stated validity, half-open; null when not stated. */
    effectiveFrom: catalogueInstant.nullable(),
    effectiveTo: catalogueInstant.nullable(),
    verifiedBy: z.string().max(200).nullable(),
    verifiedAt: catalogueInstant.nullable(),
    /** The user's own confirmation of an account-private version. Not provider verification. */
    userConfirmedAt: catalogueInstant.nullable(),
    changeReason: z.string().max(2_000).nullable(),
    supersedesVersionId: rulebookRecordId.nullable(),
    recordStatus: z.enum(rulebookRecordStatuses),
    createdAt: catalogueInstant,
    updatedAt: catalogueInstant,
  })
  .superRefine((v, ctx) => {
    if ((v.verifiedBy === null) !== (v.verifiedAt === null)) {
      ctx.addIssue({ code: "custom", path: ["verifiedAt"], message: "verifiedBy and verifiedAt go together" });
    }
    if (v.verificationStatus === "verified" && v.verifiedBy === null) {
      ctx.addIssue({ code: "custom", path: ["verifiedBy"], message: "Verified versions need a reviewer and time" });
    }
    if (v.supersedesVersionId !== null && v.supersedesVersionId === v.id) {
      ctx.addIssue({ code: "custom", path: ["supersedesVersionId"], message: "A version cannot supersede itself" });
    }
  });
export type RulebookVersion = z.infer<typeof rulebookVersionSchema>;

/**
 * A catalogue rulebook version applies to one phase, or one path of it, of an
 * exact catalogue version. Nothing is inherited across sizes, phases or paths.
 */
export const ruleApplicabilitySchema = z.strictObject({
  id: catalogueId,
  rulebookVersionId: rulebookRecordId,
  catalogueVersionId: catalogueId,
  programmePhaseId: catalogueId,
  phasePathId: catalogueId.nullable(),
});
export type RuleApplicability = z.infer<typeof ruleApplicabilitySchema>;

/** A claim's own review state, independent of the version's publication. */
export const claimStatuses = ["candidate", "verified", "rejected", "stale", "conflicting"] as const;

/** Evidence for one rule, from one source (a `catalogue_sources` row). Claims can conflict. */
export const ruleClaimSchema = z.strictObject({
  id: catalogueId,
  ruleDefinitionId: rulebookRecordId,
  sourceId: catalogueId,
  /** Parameter path the claim supports ("amount"), or null for the whole rule. */
  field: z.string().max(200).nullable(),
  origin: z.enum(claimOrigins),
  providerText: z.string().max(2_000).nullable(),
  claimStatus: z.enum(claimStatuses),
  note: z.string().max(2_000).nullable(),
  reviewedBy: z.string().max(200).nullable(),
  reviewedAt: catalogueInstant.nullable(),
  createdAt: catalogueInstant,
});
export type RuleClaim = z.infer<typeof ruleClaimSchema>;

export const assignmentSources = ["user", "catalogue_selection", "legacy_manual", "legacy_template", "legacy_copied"] as const;

/**
 * Which rulebook version governs an account from a trading day. Half-open
 * `[effectiveFrom, effectiveTo)`; null `effectiveTo` = still in force. An
 * account's assignments never overlap, and a newer version is never switched
 * in automatically.
 */
export const accountRulebookAssignmentSchema = z
  .strictObject({
    id: z.string().min(1),
    accountId: z.string().min(1),
    rulebookVersionId: rulebookRecordId,
    programmePhaseId: catalogueId.nullable(),
    phasePathId: catalogueId.nullable(),
    accountPhaseEventId: catalogueId.nullable(),
    effectiveFrom: tradingDay,
    effectiveTo: tradingDay.nullable(),
    assignedAt: catalogueInstant,
    assignmentSource: z.enum(assignmentSources),
  })
  .refine((a) => a.effectiveTo === null || a.effectiveTo > a.effectiveFrom, {
    path: ["effectiveTo"],
    message: "Must be after effectiveFrom",
  });
export type AccountRulebookAssignment = z.infer<typeof accountRulebookAssignmentSchema>;

/** A version with everything that defines it. */
export const rulebookVersionDetailSchema = z.strictObject({
  rulebook: rulebookSchema,
  version: rulebookVersionSchema,
  rules: z.array(ruleDefinitionSchema),
  applicability: z.array(ruleApplicabilitySchema),
  claims: z.array(ruleClaimSchema),
});
export type RulebookVersionDetail = z.infer<typeof rulebookVersionDetailSchema>;

// ---------------------------------------------------------------------------
// Inputs and results of the repository operations
// ---------------------------------------------------------------------------

export const newRulebookSchema = z.strictObject({
  providerId: catalogueId.nullable(),
  ownerAccountId: z.string().min(1).nullable(),
  slug: catalogueSlug,
  displayName,
  description: z.string().max(2_000).nullable(),
});

/** A new draft: of an existing rulebook, or of a new one. */
export const rulebookDraftInputSchema = z
  .strictObject({
    rulebookId: catalogueId.nullable(),
    newRulebook: newRulebookSchema.nullable(),
    supersedesVersionId: rulebookRecordId.nullable(),
    changeReason: z.string().max(2_000).nullable(),
    capturedAt: catalogueInstant,
    effectiveFrom: catalogueInstant.nullable(),
    effectiveTo: catalogueInstant.nullable(),
    rules: z.array(ruleDefinitionInputSchema),
    applicability: z.array(
      z.strictObject({ catalogueVersionId: catalogueId, programmePhaseId: catalogueId, phasePathId: catalogueId.nullable() }),
    ),
  })
  .refine((d) => (d.rulebookId === null) !== (d.newRulebook === null), {
    path: ["rulebookId"],
    message: "Give either an existing rulebook or a new one",
  });
export type RulebookDraftInput = z.infer<typeof rulebookDraftInputSchema>;

export const assignmentInputSchema = z.strictObject({
  accountId: z.string().min(1),
  rulebookVersionId: rulebookRecordId,
  effectiveFrom: tradingDay,
  programmePhaseId: catalogueId.nullable(),
  phasePathId: catalogueId.nullable(),
  accountPhaseEventId: catalogueId.nullable(),
});
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

export const sourceConflictInputSchema = z.strictObject({
  ruleDefinitionId: rulebookRecordId,
  sourceId: catalogueId,
  field: z.string().max(200).nullable(),
  providerText: z.string().max(2_000).nullable(),
  note: z.string().min(1).max(2_000),
});
export type SourceConflictInput = z.infer<typeof sourceConflictInputSchema>;

export const applicableRulebookQuerySchema = z.strictObject({
  programmePhaseId: catalogueId,
  phasePathId: catalogueId.nullable(),
});
export type ApplicableRulebookQuery = z.infer<typeof applicableRulebookQuerySchema>;

/**
 * - `resolved`: exactly one verified version governs the phase or path;
 * - `unverified`: a bound version is unverified, archived, or belongs to another provider, so it is not used;
 * - `ambiguous`: several verified versions apply; a person must choose;
 * - `none`: nothing is known. Never guessed from display names.
 */
export const applicableRulebookSchema = z.strictObject({
  status: z.enum(["resolved", "unverified", "ambiguous", "none"]),
  rulebookVersionIds: z.array(z.string()),
});
export type ApplicableRulebook = z.infer<typeof applicableRulebookSchema>;

export const draftIssueSchema = z.strictObject({ field: z.string(), message: z.string() });
export type DraftIssue = z.infer<typeof draftIssueSchema>;

// ---------------------------------------------------------------------------
// Build 19: draft editing, guarded writes and the audit log
// ---------------------------------------------------------------------------

/** A draft's new content. Its rulebook, number and the version it supersedes stay. */
export const rulebookDraftUpdateSchema = z.strictObject({
  changeReason: z.string().max(2_000).nullable(),
  capturedAt: catalogueInstant,
  effectiveFrom: catalogueInstant.nullable(),
  effectiveTo: catalogueInstant.nullable(),
  rules: z.array(ruleDefinitionInputSchema),
  applicability: z.array(
    z.strictObject({ catalogueVersionId: catalogueId, programmePhaseId: catalogueId, phasePathId: catalogueId.nullable() }),
  ),
});
export type RulebookDraftUpdate = z.infer<typeof rulebookDraftUpdateSchema>;

/** Who acts and why, for the audit log: a local label, not an authenticated identity. */
export const changeContextSchema = z.strictObject({
  actor: z.string().trim().min(1).max(200),
  reason: z.string().max(2_000).nullable(),
});
export type ChangeContext = z.infer<typeof changeContextSchema>;

/**
 * What the caller saw when deciding to assign: the account's open assignment
 * (null: none). If another assignment is open now, the write is a conflict.
 */
export const assignmentGuardSchema = z.strictObject({
  expectedOpenAssignmentId: z.string().min(1).nullable(),
  actor: z.string().trim().min(1).max(200),
  reason: z.string().max(2_000).nullable(),
});
export type AssignmentGuard = z.infer<typeof assignmentGuardSchema>;

export const rulebookEventActions = [
  "draft_created",
  "draft_saved",
  "draft_discarded",
  "published",
  "verified",
  "assigned",
  "conflict_flagged",
] as const;
export type RulebookEventAction = (typeof rulebookEventActions)[number];

/** One append-only audit row (migration 15). */
export const rulebookEventSchema = z.strictObject({
  id: z.string().min(1),
  rulebookId: catalogueId,
  rulebookVersionId: rulebookRecordId,
  accountId: z.string().min(1).nullable(),
  assignmentId: z.string().min(1).nullable(),
  action: z.enum(rulebookEventActions),
  actor: z.string().min(1),
  reason: z.string().nullable(),
  occurredAt: catalogueInstant,
});
export type RulebookEvent = z.infer<typeof rulebookEventSchema>;

/** Events of one rulebook, or about one account (its assignments and private rulebooks). Exactly one is given. */
export const rulebookEventQuerySchema = z
  .strictObject({ rulebookId: catalogueId.nullable(), accountId: z.string().min(1).nullable() })
  .refine((q) => (q.rulebookId === null) !== (q.accountId === null), {
    path: ["rulebookId"],
    message: "Give either a rulebook or an account",
  });
export type RulebookEventQuery = z.infer<typeof rulebookEventQuerySchema>;
