// Production catalogue operations (Build 9 / 10): reading the catalogue, reviewing
// versions, linking an account to a programme and recording phase history. Shapes
// match apps/desktop/src-tauri/src/store/catalogue.rs. Catalogue *content* arrives
// from importer tooling as new draft versions and is not written from the desktop UI.

import { z } from "zod";

import { commercialOfferSchema, promotionOfferSchema, promotionSchema } from "./offers.js";
import { sourceReferenceSchema } from "./provenance.js";
import { providerSchema, programmeFamilySchema, programmeVariantSchema } from "./providers.js";
import { accountFieldSources, phaseEventSources } from "./lifecycle.js";
import { catalogueVersionSchema, phasePathSchema, programmePhaseSchema, phaseKeys } from "./versions.js";

export const catalogueSnapshotSchema = z.object({
  graph: z.object({
    providers: z.array(providerSchema),
    programmeFamilies: z.array(programmeFamilySchema),
    programmeVariants: z.array(programmeVariantSchema),
    catalogueVersions: z.array(catalogueVersionSchema),
    programmePhases: z.array(programmePhaseSchema),
    phasePaths: z.array(phasePathSchema),
    commercialOffers: z.array(commercialOfferSchema),
    promotions: z.array(promotionSchema),
    promotionOffers: z.array(promotionOfferSchema),
  }),
  sources: z.array(sourceReferenceSchema),
});
export type CatalogueSnapshot = z.infer<typeof catalogueSnapshotSchema>;

export const catalogueTransitionTargets = ["draft", "needs_review", "verified", "stale", "superseded", "rejected"] as const;

export const accountLinkInputSchema = z.strictObject({
  accountId: z.string().min(1),
  programmeVariantId: z.string().min(1).nullish(),
  catalogueVersionId: z.string().min(1).nullish(),
  selectedPhasePathId: z.string().min(1).nullish(),
  sizeSource: z.enum(accountFieldSources),
});
export type AccountLinkInput = z.input<typeof accountLinkInputSchema>;

export const phaseEventInputSchema = z.strictObject({
  accountId: z.string().min(1),
  fromPhase: z.enum(phaseKeys).nullish(),
  toPhase: z.enum(phaseKeys),
  providerLabel: z.string().max(200).nullish(),
  occurredAt: z.iso.datetime({ offset: true }).nullish(),
  /** An entry made by the user is `user_entered`, `imported` or `unknown`. */
  source: z.enum(phaseEventSources).refine((s) => s !== "system" && s !== "catalogue_derived", "Choose user_entered, imported or unknown"),
  note: z.string().max(2_000).nullish(),
  correctionOfEventId: z.string().min(1).nullish(),
  catalogueVersionId: z.string().min(1).nullish(),
  programmePhaseId: z.string().min(1).nullish(),
  phasePathId: z.string().min(1).nullish(),
});
export type PhaseEventInput = z.input<typeof phaseEventInputSchema>;

// ---------------------------------------------------------------------------
// Authoring (Build 9.2): drafts, their child records, sources, corrections
// ---------------------------------------------------------------------------

const instantText = z.iso.datetime({ offset: true });
const price = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter zero or a positive number; leave empty when unknown");

export const sourceInputSchema = z
  .strictObject({
    sourceType: z.enum(["official", "secondary", "user_manual", "unknown"]),
    url: z.string().trim().regex(/^https?:\/\/\S+$/, "Start with http:// or https://").nullish(),
    descriptor: z.string().max(500).nullish(),
    publisher: z.string().max(200).nullish(),
    publishedAt: instantText.nullish(),
    effectiveFrom: instantText.nullish(),
    effectiveTo: instantText.nullish(),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/, "sha256: followed by 64 lower-case hex digits").nullish(),
  })
  .refine((s) => Boolean(s.url) || Boolean(s.descriptor?.trim()), {
    path: ["descriptor"],
    message: "Give a URL or describe where this came from",
  });
export type SourceInput = z.input<typeof sourceInputSchema>;

const claimInputSchema = z.strictObject({
  field: z.string().trim().min(1),
  origin: z.enum(["observed", "provider_stated", "user_entered", "extracted_candidate", "verified_catalogue", "unknown"]),
  sourceId: z.string().min(1).nullish(),
  providerText: z.string().max(2_000).nullish(),
});

const pathInputSchema = z.strictObject({
  pathKey: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lower-case letters, digits and single hyphens"),
  providerLabel: z.string().trim().min(1),
  isDefault: z.boolean(),
  displayOrder: z.int().min(0),
  recordStatus: z.enum(["active", "inactive", "archived"]),
  rulebookVersionId: z.string().min(1).nullish(),
});

const phaseInputSchema = z.strictObject({
  phaseKey: z.enum(phaseKeys),
  providerLabel: z.string().trim().min(1),
  displayOrder: z.int().min(0),
  defaultRulebookVersionId: z.string().min(1).nullish(),
  paths: z.array(pathInputSchema).default([]),
});

const offerInputSchema = z.strictObject({
  phase: z
    .strictObject({ phaseKey: z.enum(phaseKeys), providerLabel: z.string().trim().min(1), pathKey: z.string().nullish() })
    .nullish(),
  billingModel: z.enum(["one_time", "recurring", "unknown"]),
  currency: z.string().regex(/^[A-Z]{3}$/, "A 3-letter code such as USD").nullish(),
  /** Absent means unknown; "0" means known free. */
  listPrice: price.nullish(),
  salePrice: price.nullish(),
  resetFee: price.nullish(),
  activationFee: price.nullish(),
  effectiveFrom: instantText.nullish(),
  effectiveTo: instantText.nullish(),
  sourceIds: z.array(z.string().min(1)).default([]),
});

export const catalogueDraftInputSchema = z
  .strictObject({
    programmeVariantId: z.string().min(1),
    revisionLabel: z.string().max(200).nullish(),
    capturedAt: instantText,
    effectiveFrom: instantText.nullish(),
    effectiveTo: instantText.nullish(),
    /** A correction names the version it supersedes (same variant) and why. */
    supersedesVersionId: z.string().min(1).nullish(),
    correctionReason: z.string().max(500).nullish(),
    sourceIds: z.array(z.string().min(1)).default([]),
    claims: z.array(claimInputSchema).default([]),
    phases: z.array(phaseInputSchema).default([]),
    offers: z.array(offerInputSchema).default([]),
  })
  .superRefine((d, ctx) => {
    const reason = Boolean(d.correctionReason?.trim());
    if (d.supersedesVersionId && !reason) {
      ctx.addIssue({ code: "custom", path: ["correctionReason"], message: "Say why this version corrects the earlier one" });
    }
    if (!d.supersedesVersionId && reason) {
      ctx.addIssue({ code: "custom", path: ["supersedesVersionId"], message: "A correction reason needs the version it corrects" });
    }
    d.offers.forEach((o, i) => {
      const priced = [o.listPrice, o.salePrice, o.resetFee, o.activationFee].some((p) => p != null);
      if (priced && !o.currency) {
        ctx.addIssue({ code: "custom", path: ["offers", i, "currency"], message: "Prices need a currency" });
      }
    });
  });
export type CatalogueDraftInput = z.input<typeof catalogueDraftInputSchema>;

// ---------------------------------------------------------------------------
// Offer and provenance snapshots (Build 9.4)
// ---------------------------------------------------------------------------

export const offerSelectionInputSchema = z.strictObject({
  accountId: z.string().min(1),
  commercialOfferId: z.string().min(1),
  promotionId: z.string().min(1).nullish(),
  /** When the user bought or activated under these terms; defaults to now in Rust. */
  selectedAt: instantText.nullish(),
  note: z.string().max(2_000).nullish(),
});
export type OfferSelectionInput = z.input<typeof offerSelectionInputSchema>;

export const offerSelectionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  catalogueVersionId: z.string(),
  commercialOfferId: z.string(),
  promotionId: z.string().nullable(),
  selectedAt: z.string(),
  recordedAt: z.string(),
  note: z.string().nullable(),
  /** The terms and provenance as they stood when recorded; unknown prices are null, free is "0". */
  terms: z.record(z.string(), z.unknown()),
});
export type OfferSelection = z.infer<typeof offerSelectionSchema>;
