import { describe, expect, it } from "vitest";

import {
  catalogueDraftInputSchema,
  catalogueSnapshotSchema,
  offerSelectionInputSchema,
  sourceInputSchema,
} from "../../src/index.js";
import fixture from "../fixtures/catalogue.json" with { type: "json" };

const paths = (r: { error?: { issues: { path: PropertyKey[] }[] } }) => r.error?.issues.map((i) => i.path.join(".")) ?? [];

describe("catalogue snapshot (production read path)", () => {
  it("accepts the exact wire shape Rust loads, sources included", () => {
    const parsed = catalogueSnapshotSchema.safeParse({ graph: fixture.graph, sources: fixture.sources });
    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.graph.catalogueVersions).toHaveLength(2);
  });
});

describe("catalogue draft input", () => {
  const draft = {
    programmeVariantId: "v",
    capturedAt: "2026-10-20T12:00:00Z",
    phases: [{ phaseKey: "evaluation", providerLabel: "Phase 1", displayOrder: 0, paths: [] }],
    offers: [{ billingModel: "one_time", currency: "USD", listPrice: "150", salePrice: "0" }],
  };

  it("accepts known-free ('0') and unknown (absent) prices, and fills defaults", () => {
    const r = catalogueDraftInputSchema.safeParse(draft);
    expect(r.error).toBeUndefined();
    expect(r.data?.sourceIds).toEqual([]);
    expect(r.data?.offers[0]?.resetFee).toBeUndefined();
  });

  it("rejects prices without a currency, negative prices and bad path keys", () => {
    expect(paths(catalogueDraftInputSchema.safeParse({ ...draft, offers: [{ billingModel: "one_time", salePrice: "5" }] }))).toEqual(["offers.0.currency"]);
    expect(catalogueDraftInputSchema.safeParse({ ...draft, offers: [{ billingModel: "one_time", currency: "USD", salePrice: "-1" }] }).success).toBe(false);
    const badPath = { phaseKey: "evaluation", providerLabel: "P", displayOrder: 0, paths: [{ pathKey: "Bad Key", providerLabel: "x", isDefault: true, displayOrder: 0, recordStatus: "active" }] };
    expect(catalogueDraftInputSchema.safeParse({ ...draft, phases: [badPath] }).success).toBe(false);
  });

  it("requires a correction to name both the version and the reason", () => {
    expect(paths(catalogueDraftInputSchema.safeParse({ ...draft, supersedesVersionId: "old" }))).toEqual(["correctionReason"]);
    expect(paths(catalogueDraftInputSchema.safeParse({ ...draft, correctionReason: "typo" }))).toEqual(["supersedesVersionId"]);
    expect(catalogueDraftInputSchema.safeParse({ ...draft, supersedesVersionId: "old", correctionReason: "typo" }).success).toBe(true);
  });
});

describe("source input", () => {
  it("needs a URL or a description, and a well-formed hash", () => {
    expect(sourceInputSchema.safeParse({ sourceType: "official", url: "https://example.test/x" }).success).toBe(true);
    expect(sourceInputSchema.safeParse({ sourceType: "user_manual", descriptor: "Discord announcement" }).success).toBe(true);
    expect(sourceInputSchema.safeParse({ sourceType: "official" }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ sourceType: "official", url: "ftp://x" }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ sourceType: "official", url: "https://x.test", contentHash: "sha256:ABC" }).success).toBe(false);
  });
});

describe("offer selection input", () => {
  it("takes an optional promotion, date and note", () => {
    expect(offerSelectionInputSchema.safeParse({ accountId: "a", commercialOfferId: "o" }).success).toBe(true);
    expect(offerSelectionInputSchema.safeParse({ accountId: "a", commercialOfferId: "o", selectedAt: "yesterday" }).success).toBe(false);
    expect(offerSelectionInputSchema.safeParse({ accountId: "a" }).success).toBe(false);
  });
});
