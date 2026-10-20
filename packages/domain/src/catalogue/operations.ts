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
