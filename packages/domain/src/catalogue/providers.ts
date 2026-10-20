// Provider (prop firm) and programme catalogue DTOs (Build 9).
//
// provider → programme family → programme variant. A variant is the stable
// "50K product" identity across its lifecycle phases; what it offers at a point
// in time lives in a catalogue version (versions.ts). Nothing is inherited
// implicitly from a parent: every variant states its own attributes.

import { z } from "zod";

import { catalogueId, catalogueInstant, catalogueMoney, catalogueSlug, currencyCode, displayName, providerLabel } from "./fields.js";

/** Record status of a catalogue entry. Says nothing about a provider's legitimacy. */
export const catalogueRecordStatuses = ["active", "inactive", "archived", "unknown"] as const;
export type CatalogueRecordStatus = (typeof catalogueRecordStatuses)[number];

export const providerSchema = z.strictObject({
  id: catalogueId,
  slug: catalogueSlug,
  displayName,
  /** Alternate spellings, matched case-insensitively when finding a provider by name. */
  aliases: z.array(z.string().min(1).max(200)).max(20),
  websiteUrl: z.url({ protocol: /^https?$/ }).nullable(),
  jurisdiction: z.string().max(100).nullable(),
  notes: z.string().max(20_000).nullable(),
  recordStatus: z.enum(catalogueRecordStatuses),
  createdAt: catalogueInstant,
  updatedAt: catalogueInstant,
  archivedAt: catalogueInstant.nullable(),
});
export type Provider = z.infer<typeof providerSchema>;

/** Normalized programme category. Matches the legacy `programmes.programme_type` values plus `unknown`. */
export const programmeCategories = ["evaluation_to_funded", "instant_funding", "other", "unknown"] as const;
export type ProgrammeCategory = (typeof programmeCategories)[number];

export const programmeFamilySchema = z.strictObject({
  id: catalogueId,
  providerId: catalogueId,
  slug: catalogueSlug,
  displayName,
  /** Provider wording for the family, kept beside the normalized category. */
  providerLabel: providerLabel.nullable(),
  description: z.string().max(2_000).nullable(),
  category: z.enum(programmeCategories),
  recordStatus: z.enum(catalogueRecordStatuses),
  createdAt: catalogueInstant,
  updatedAt: catalogueInstant,
});
export type ProgrammeFamily = z.infer<typeof programmeFamilySchema>;

/**
 * Provider-specific descriptive attributes, under namespaced keys
 * ("platform.copy_trading"). Never rule terms, prices or anything calculated.
 */
export const variantMetadataSchema = z.record(
  z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/, "Use a namespaced key such as platform.copy_trading"),
  z.union([z.string().max(500), z.boolean(), z.null()]),
);

export const programmeVariantSchema = z
  .strictObject({
    id: catalogueId,
    providerId: catalogueId,
    programmeFamilyId: catalogueId,
    slug: catalogueSlug,
    displayName,
    providerLabel: providerLabel.nullable(),
    /** Size as the provider writes it ("50K"). Never parsed into an amount. */
    sizeLabel: z.string().max(50).nullable(),
    /** Numeric size, only when a source states it explicitly. */
    sizeAmount: catalogueMoney.nullable(),
    sizeCurrency: currencyCode.nullable(),
    /** Platform names, descriptive only; integrations have their own contract. */
    platforms: z.array(z.string().min(1).max(100)).max(50),
    metadata: variantMetadataSchema,
    recordStatus: z.enum(catalogueRecordStatuses),
    createdAt: catalogueInstant,
    updatedAt: catalogueInstant,
  })
  .refine((v) => (v.sizeAmount === null) === (v.sizeCurrency === null), {
    path: ["sizeCurrency"],
    message: "sizeAmount and sizeCurrency go together",
  });
export type ProgrammeVariant = z.infer<typeof programmeVariantSchema>;
