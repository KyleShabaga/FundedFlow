// Cross-record integrity rules for the catalogue (Build 9).
//
// The Zod schemas validate one record at a time. These checks validate a set
// of related records: the uniqueness, ownership and immutability rules that the
// SQLite schema (Build 10) enforces with UNIQUE, composite foreign keys and
// triggers. Rust stays the authority at write time; these give the UI and
// fixtures the same answers. Each issue has a stable `code`.

import type { AccountCatalogueLink } from "./lifecycle.js";
import type { CommercialOffer, Promotion, PromotionOffer } from "./offers.js";
import type { Provider, ProgrammeFamily, ProgrammeVariant } from "./providers.js";
import type { CatalogueVersion, PhasePath, ProgrammePhase } from "./versions.js";
import { canTransitionVerification, type VerificationStatus } from "./provenance.js";

export interface CatalogueGraph {
  providers: readonly Provider[];
  programmeFamilies: readonly ProgrammeFamily[];
  programmeVariants: readonly ProgrammeVariant[];
  catalogueVersions: readonly CatalogueVersion[];
  programmePhases: readonly ProgrammePhase[];
  phasePaths: readonly PhasePath[];
  commercialOffers: readonly CommercialOffer[];
  promotions: readonly Promotion[];
  promotionOffers: readonly PromotionOffer[];
}

export const catalogueIssueCodes = [
  "duplicate_id",
  "duplicate_provider_slug",
  "duplicate_family_slug",
  "duplicate_variant_slug",
  "duplicate_version_number",
  "duplicate_phase",
  "duplicate_path_key",
  "multiple_default_paths",
  "missing_reference",
  "cross_provider_reference",
  "offer_phase_outside_version",
  "offer_path_outside_phase",
  "superseded_version_outside_variant",
  "duplicate_promotion_offer",
  "promotion_offer_window_disjoint",
  "account_variant_outside_provider",
  "account_version_outside_variant",
  "account_path_outside_version",
  "verified_version_changed",
  "invalid_verification_transition",
] as const;
export type CatalogueIssueCode = (typeof catalogueIssueCodes)[number];

export interface CatalogueIssue {
  code: CatalogueIssueCode;
  /** ID of the record the issue is reported on. */
  recordId: string;
  /** The other record involved, when there is one. */
  relatedId?: string;
}

function indexById<T extends { id: string }>(records: readonly T[], issues: CatalogueIssue[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of records) {
    if (map.has(r.id)) issues.push({ code: "duplicate_id", recordId: r.id });
    else map.set(r.id, r);
  }
  return map;
}

/** Reports the first record of each repeated key as `relatedId`. */
function checkUnique<T extends { id: string }>(
  records: readonly T[],
  key: (r: T) => string,
  code: CatalogueIssueCode,
  issues: CatalogueIssue[],
): void {
  const first = new Map<string, string>();
  for (const r of records) {
    const k = key(r);
    const existing = first.get(k);
    if (existing === undefined) first.set(k, r.id);
    else issues.push({ code, recordId: r.id, relatedId: existing });
  }
}

/** Two half-open windows with unknown (open) bounds overlap unless one ends before the other starts. */
function windowsOverlap(aFrom: string | null, aTo: string | null, bFrom: string | null, bTo: string | null): boolean {
  const endsBefore = (to: string | null, from: string | null) => to !== null && from !== null && Date.parse(to) <= Date.parse(from);
  return !endsBefore(aTo, bFrom) && !endsBefore(bTo, aFrom);
}

export function checkCatalogueGraph(graph: CatalogueGraph): CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  const providers = indexById(graph.providers, issues);
  const families = indexById(graph.programmeFamilies, issues);
  const variants = indexById(graph.programmeVariants, issues);
  const versions = indexById(graph.catalogueVersions, issues);
  const phases = indexById(graph.programmePhases, issues);
  const paths = indexById(graph.phasePaths, issues);
  const offers = indexById(graph.commercialOffers, issues);
  const promotions = indexById(graph.promotions, issues);
  const missing = (recordId: string, relatedId: string) => issues.push({ code: "missing_reference", recordId, relatedId });

  // Uniqueness, matching the planned UNIQUE constraints. Labels compare as stored.
  checkUnique(graph.providers, (p) => p.slug, "duplicate_provider_slug", issues);
  checkUnique(graph.programmeFamilies, (f) => `${f.providerId}\u0000${f.slug}`, "duplicate_family_slug", issues);
  checkUnique(graph.programmeVariants, (v) => `${v.programmeFamilyId}\u0000${v.slug}`, "duplicate_variant_slug", issues);
  checkUnique(graph.catalogueVersions, (v) => `${v.programmeVariantId}\u0000${v.versionNumber}`, "duplicate_version_number", issues);
  checkUnique(graph.programmePhases, (p) => `${p.catalogueVersionId}\u0000${p.phaseKey}\u0000${p.providerLabel}`, "duplicate_phase", issues);
  checkUnique(graph.phasePaths, (p) => `${p.programmePhaseId}\u0000${p.pathKey}`, "duplicate_path_key", issues);
  checkUnique(graph.phasePaths.filter((p) => p.isDefault), (p) => p.programmePhaseId, "multiple_default_paths", issues);
  checkUnique(
    graph.promotionOffers.map((l) => ({ ...l, id: l.promotionId })),
    (l) => `${l.promotionId}\u0000${l.commercialOfferId}`,
    "duplicate_promotion_offer",
    issues,
  );

  for (const f of graph.programmeFamilies) if (!providers.has(f.providerId)) missing(f.id, f.providerId);

  for (const v of graph.programmeVariants) {
    const family = families.get(v.programmeFamilyId);
    if (!providers.has(v.providerId)) missing(v.id, v.providerId);
    if (family === undefined) missing(v.id, v.programmeFamilyId);
    else if (family.providerId !== v.providerId) issues.push({ code: "cross_provider_reference", recordId: v.id, relatedId: family.id });
  }

  for (const v of graph.catalogueVersions) {
    if (!variants.has(v.programmeVariantId)) missing(v.id, v.programmeVariantId);
    if (v.supersedesVersionId !== null) {
      const prior = versions.get(v.supersedesVersionId);
      if (prior === undefined) missing(v.id, v.supersedesVersionId);
      else if (prior.programmeVariantId !== v.programmeVariantId) {
        issues.push({ code: "superseded_version_outside_variant", recordId: v.id, relatedId: prior.id });
      }
    }
  }

  for (const p of graph.programmePhases) if (!versions.has(p.catalogueVersionId)) missing(p.id, p.catalogueVersionId);
  for (const p of graph.phasePaths) if (!phases.has(p.programmePhaseId)) missing(p.id, p.programmePhaseId);

  for (const o of graph.commercialOffers) {
    if (!versions.has(o.catalogueVersionId)) missing(o.id, o.catalogueVersionId);
    if (o.programmePhaseId !== null) {
      const phase = phases.get(o.programmePhaseId);
      if (phase === undefined) missing(o.id, o.programmePhaseId);
      else if (phase.catalogueVersionId !== o.catalogueVersionId) {
        issues.push({ code: "offer_phase_outside_version", recordId: o.id, relatedId: phase.id });
      }
    }
    if (o.phasePathId !== null) {
      const path = paths.get(o.phasePathId);
      if (path === undefined) missing(o.id, o.phasePathId);
      else if (path.programmePhaseId !== o.programmePhaseId) {
        issues.push({ code: "offer_path_outside_phase", recordId: o.id, relatedId: path.id });
      }
    }
  }

  const offerProvider = (o: CommercialOffer) => {
    const variantId = versions.get(o.catalogueVersionId)?.programmeVariantId;
    return variantId === undefined ? undefined : variants.get(variantId)?.providerId;
  };
  for (const p of graph.promotions) if (!providers.has(p.providerId)) missing(p.id, p.providerId);
  for (const link of graph.promotionOffers) {
    const promotion = promotions.get(link.promotionId);
    const offer = offers.get(link.commercialOfferId);
    if (promotion === undefined) missing(link.commercialOfferId, link.promotionId);
    if (offer === undefined) missing(link.promotionId, link.commercialOfferId);
    if (promotion === undefined || offer === undefined) continue;
    const provider = offerProvider(offer);
    if (provider !== undefined && provider !== promotion.providerId) {
      issues.push({ code: "cross_provider_reference", recordId: promotion.id, relatedId: offer.id });
    }
    const windows: [string | null, string | null][] = [
      [link.validFrom, link.validTo],
      [promotion.validFrom, promotion.validTo],
      [offer.effectiveFrom, offer.effectiveTo],
    ];
    const compatible = windows.every(([af, at], i) => windows.slice(i + 1).every(([bf, bt]) => windowsOverlap(af, at, bf, bt)));
    if (!compatible) issues.push({ code: "promotion_offer_window_disjoint", recordId: promotion.id, relatedId: offer.id });
  }

  return issues;
}

/** Checks an account's catalogue references against the catalogue it points into. */
export function checkAccountCatalogueLink(link: AccountCatalogueLink, graph: CatalogueGraph): CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  const find = <T extends { id: string }>(records: readonly T[], id: string | null) =>
    id === null ? null : (records.find((r) => r.id === id) ?? undefined);
  const missing = (relatedId: string) => issues.push({ code: "missing_reference", recordId: link.accountId, relatedId });

  const provider = find(graph.providers, link.providerId);
  const variant = find(graph.programmeVariants, link.programmeVariantId);
  const version = find(graph.catalogueVersions, link.catalogueVersionId);
  const path = find(graph.phasePaths, link.selectedPhasePathId);
  if (provider === undefined) missing(link.providerId ?? "");
  if (variant === undefined) missing(link.programmeVariantId ?? "");
  if (version === undefined) missing(link.catalogueVersionId ?? "");
  if (path === undefined) missing(link.selectedPhasePathId ?? "");

  if (variant && variant.providerId !== link.providerId) {
    issues.push({ code: "account_variant_outside_provider", recordId: link.accountId, relatedId: variant.id });
  }
  if (version && version.programmeVariantId !== link.programmeVariantId) {
    issues.push({ code: "account_version_outside_variant", recordId: link.accountId, relatedId: version.id });
  }
  if (path) {
    const phase = graph.programmePhases.find((p) => p.id === path.programmePhaseId);
    if (phase?.catalogueVersionId !== link.catalogueVersionId) {
      issues.push({ code: "account_path_outside_version", recordId: link.accountId, relatedId: path.id });
    }
  }
  return issues;
}

/** Statuses a version can only have reached through review; its content is then frozen. */
const FROZEN_STATUSES: ReadonlySet<VerificationStatus> = new Set(["verified", "stale", "superseded", "rejected"]);

/** JSON text with object keys sorted, so key order does not affect comparison. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Checks an update to a catalogue version. Once reviewed (verified, stale,
 * superseded or rejected) or ever verified, a version is immutable apart from its status, and a
 * status change must follow `canTransitionVerification`. A correction is a new
 * version with `supersedesVersionId`, never an edit.
 */
export function checkCatalogueVersionUpdate(before: CatalogueVersion, after: CatalogueVersion): CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  if (before.verificationStatus !== after.verificationStatus && !canTransitionVerification(before.verificationStatus, after.verificationStatus)) {
    issues.push({ code: "invalid_verification_transition", recordId: after.id });
  }
  // A version that was ever verified keeps verifiedAt, so it stays frozen even in a status a migration-6
  // database could have reopened it to.
  if (FROZEN_STATUSES.has(before.verificationStatus) || before.verifiedAt !== null) {
    const content = (v: CatalogueVersion) => stableJson({ ...v, verificationStatus: null });
    if (content(before) !== content(after)) issues.push({ code: "verified_version_changed", recordId: after.id });
  }
  return issues;
}
