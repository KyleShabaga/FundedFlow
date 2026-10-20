// Field schemas shared by the catalogue contracts (Build 9).
//
// Catalogue DTOs are new wire shapes, so they are stricter than the legacy
// account/trade contracts: IDs are UUIDs, money must already be canonical
// decimal text, and provider wording is kept verbatim (never trimmed or
// re-cased) so it can be audited against the source.

import { z } from "zod";

import { canonicalDecimal, microsToDecimal, toMicros } from "../primitives/money.js";

/** App-generated UUID (UUIDv7 in Stage 1). Labels and slugs are never identifiers. */
export const catalogueId = z.uuid();

/** Stable internal slug: lowercase ASCII words joined by single hyphens. */
export const catalogueSlug = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens");

/** Exact provider wording ("Evaluation", "50K FLEX", "Daily"). Stored verbatim. */
export const providerLabel = z
  .string()
  .max(200)
  .refine((v) => v.trim().length > 0, "Required");

/** Human display name chosen by FundedFlow or the user. */
export const displayName = z
  .string()
  .max(200)
  .refine((v) => v.trim().length > 0, "Required");

/** ISO 4217-style upper-case code. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter code such as USD");

/** UTC or offset ISO 8601 instant. */
export const catalogueInstant = z.iso.datetime({ offset: true });

/**
 * A non-negative money amount as canonical decimal text ("146", "105.2", "0").
 * It must already be canonical and fit in i64 micro-units, so Rust stores it as
 * `*_micros` without rounding. "0" is an explicit known zero (free / no fee);
 * `null` beside it in a DTO means unknown.
 */
export const catalogueMoney = z.string().refine((v) => {
  if (canonicalDecimal(v) !== v) return false;
  const micros = toMicros(v);
  // Round-tripping through micro-units rejects anything toMicros would round.
  return micros !== null && micros >= 0n && microsToDecimal(micros) === v;
}, "Use a canonical non-negative amount with at most 6 decimal places");

/** Half-open validity window `[from, to)`; either bound may be unknown. */
export function windowIsOrdered(from: string | null, to: string | null): boolean {
  return from === null || to === null || Date.parse(to) > Date.parse(from);
}
