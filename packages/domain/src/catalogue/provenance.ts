// Source provenance and verification state for catalogue data (Build 9).
//
// Every catalogue claim starts as a candidate. Only an explicit transition by
// a named reviewer makes it `verified`, and a verified record is immutable: a
// correction is a new record that supersedes it.

import { z } from "zod";

import { catalogueId, catalogueInstant, windowIsOrdered } from "./fields.js";

export const verificationStatuses = ["draft", "needs_review", "verified", "stale", "superseded", "rejected"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

/** Allowed verification transitions. `superseded` and `rejected` are final. */
const VERIFICATION_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  draft: ["needs_review", "rejected"],
  needs_review: ["draft", "verified", "rejected"],
  verified: ["stale", "superseded"],
  stale: ["needs_review", "verified", "superseded"],
  superseded: [],
  rejected: [],
};

export function canTransitionVerification(from: VerificationStatus, to: VerificationStatus): boolean {
  return VERIFICATION_TRANSITIONS[from].includes(to);
}

/** Statuses a newly captured or extracted record may start in. It can never start verified. */
export const candidateVerificationStatuses = ["draft", "needs_review"] as const;

/** How a value came to be known. Extracted candidates are not verified catalogue values. */
export const claimOrigins = [
  "observed",
  "provider_stated",
  "user_entered",
  "extracted_candidate",
  "verified_catalogue",
  "unknown",
] as const;
export type ClaimOrigin = (typeof claimOrigins)[number];

/** Official provider material vs secondary sources vs manual entry. */
export const sourceTypes = ["official", "secondary", "user_manual", "unknown"] as const;

export const sourceReferenceSchema = z
  .strictObject({
    id: catalogueId,
    sourceType: z.enum(sourceTypes),
    /** Page the claim was read from; null for a manual source. */
    url: z.url({ protocol: /^https?$/ }).nullable(),
    /** Manual-source descriptor ("Support chat, 2026-10-19") when there is no URL. */
    descriptor: z.string().max(500).nullable(),
    publisher: z.string().max(200).nullable(),
    /** When FundedFlow retrieved or recorded it. Never a substitute for `effectiveFrom`. */
    capturedAt: catalogueInstant,
    /** Publication date stated by the source, if any. */
    publishedAt: catalogueInstant.nullable(),
    effectiveFrom: catalogueInstant.nullable(),
    effectiveTo: catalogueInstant.nullable(),
    /** Change detection only; a hash is not evidence that the content is accurate. */
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
    importerVersion: z.string().max(100).nullable(),
    verificationStatus: z.enum(verificationStatuses),
    reviewedBy: z.string().max(200).nullable(),
    reviewedAt: catalogueInstant.nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.url === null && (s.descriptor === null || s.descriptor.trim() === "")) {
      ctx.addIssue({ code: "custom", path: ["descriptor"], message: "A source needs a URL or a descriptor" });
    }
    if (!windowIsOrdered(s.effectiveFrom, s.effectiveTo)) {
      ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "Must be after effectiveFrom" });
    }
    if (s.verificationStatus === "verified" && (s.reviewedBy === null || s.reviewedAt === null)) {
      ctx.addIssue({ code: "custom", path: ["reviewedBy"], message: "Verified sources need a reviewer and time" });
    }
  });
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

/**
 * Provenance of one field of a catalogue record, for records whose fields come
 * from different sources. `field` names a DTO field ("salePrice",
 * "phases[1].providerLabel"); `providerText` keeps the exact wording read.
 */
export const fieldClaimSchema = z
  .strictObject({
    field: z.string().min(1).max(200),
    origin: z.enum(claimOrigins),
    sourceId: catalogueId.nullable(),
    providerText: z.string().max(2_000).nullable(),
  })
  .refine((c) => c.origin === "unknown" || c.origin === "user_entered" || c.sourceId !== null, {
    path: ["sourceId"],
    message: "A sourced claim needs a sourceId",
  });
export type FieldClaim = z.infer<typeof fieldClaimSchema>;
