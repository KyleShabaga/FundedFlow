// Catalogue versions, phases and selectable paths (Build 9).
//
// A catalogue version is one captured revision of a programme variant. It owns
// the variant's lifecycle phases (Evaluation, Funded, ...) and each phase's
// optional provider-defined paths (Daily, Flex, ...). Phases and paths only
// *reference* rulebook versions (Build 9.5); no rule values or formulas live
// here.

import { z } from "zod";

import { catalogueId, catalogueInstant, catalogueSlug, providerLabel, windowIsOrdered } from "./fields.js";
import { fieldClaimSchema, verificationStatuses } from "./provenance.js";

export const catalogueVersionCreators = ["manual", "importer"] as const;

export const catalogueVersionSchema = z
  .strictObject({
    id: catalogueId,
    programmeVariantId: catalogueId,
    versionNumber: z.int().min(1),
    revisionLabel: z.string().max(100).nullable(),
    verificationStatus: z.enum(verificationStatuses),
    /** When this revision was captured. Not its effective date. */
    capturedAt: catalogueInstant,
    /** Half-open `[effectiveFrom, effectiveTo)`; unknown bounds stay null. */
    effectiveFrom: catalogueInstant.nullable(),
    effectiveTo: catalogueInstant.nullable(),
    createdBy: z.enum(catalogueVersionCreators),
    importerVersion: z.string().max(100).nullable(),
    verifiedBy: z.string().max(200).nullable(),
    verifiedAt: catalogueInstant.nullable(),
    /** The version this one corrects or replaces, with the reason. */
    supersedesVersionId: catalogueId.nullable(),
    correctionReason: z.string().max(2_000).nullable(),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
    sourceIds: z.array(catalogueId),
    claims: z.array(fieldClaimSchema),
  })
  .superRefine((v, ctx) => {
    if (!windowIsOrdered(v.effectiveFrom, v.effectiveTo)) {
      ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "Must be after effectiveFrom" });
    }
    const reviewed = v.verifiedBy !== null && v.verifiedAt !== null;
    if (v.verificationStatus === "verified" && !reviewed) {
      ctx.addIssue({ code: "custom", path: ["verifiedBy"], message: "Verified versions need a reviewer and time" });
    }
    if ((v.verifiedBy === null) !== (v.verifiedAt === null)) {
      ctx.addIssue({ code: "custom", path: ["verifiedAt"], message: "verifiedBy and verifiedAt go together" });
    }
    if (v.supersedesVersionId !== null && (v.correctionReason === null || v.correctionReason.trim() === "")) {
      ctx.addIssue({ code: "custom", path: ["correctionReason"], message: "A superseding version needs a reason" });
    }
    if (v.supersedesVersionId === v.id) {
      ctx.addIssue({ code: "custom", path: ["supersedesVersionId"], message: "A version cannot supersede itself" });
    }
    if (v.createdBy === "importer" && v.importerVersion === null) {
      ctx.addIssue({ code: "custom", path: ["importerVersion"], message: "Imported versions record the importer version" });
    }
  });
export type CatalogueVersion = z.infer<typeof catalogueVersionSchema>;

/**
 * Normalized programme phase. `paused`, `failed`, `closed` are account record
 * statuses, not phases; `unknown` is never guessed into another value.
 */
export const phaseKeys = ["evaluation", "simulated_funded", "live_funded", "other", "unknown"] as const;
export type PhaseKey = (typeof phaseKeys)[number];

export const programmePhaseSchema = z.strictObject({
  id: catalogueId,
  catalogueVersionId: catalogueId,
  phaseKey: z.enum(phaseKeys),
  /** Exact provider wording ("Evaluation", "Funded"). */
  providerLabel,
  displayOrder: z.int().min(0),
  /** Rulebook version (Build 9.5) that governs this phase; null until known. */
  defaultRulebookVersionId: catalogueId.nullable(),
});
export type ProgrammePhase = z.infer<typeof programmePhaseSchema>;

export const phasePathStatuses = ["active", "inactive", "archived"] as const;

/** A provider-defined selectable option within a phase. Path keys are data, never app enums. */
export const phasePathSchema = z.strictObject({
  id: catalogueId,
  programmePhaseId: catalogueId,
  pathKey: catalogueSlug,
  providerLabel,
  isDefault: z.boolean(),
  displayOrder: z.int().min(0),
  recordStatus: z.enum(phasePathStatuses),
  /** Overrides the phase's default rulebook version when this path's terms differ. */
  rulebookVersionId: catalogueId.nullable(),
});
export type PhasePath = z.infer<typeof phasePathSchema>;

/** The rulebook version that governs a phase, or one of its paths. */
export function effectiveRulebookVersionId(phase: ProgrammePhase, path: PhasePath | null): string | null {
  if (path !== null && path.programmePhaseId !== phase.id) {
    throw new RangeError(`Path ${path.id} does not belong to phase ${phase.id}`);
  }
  return path?.rulebookVersionId ?? phase.defaultRulebookVersionId;
}
