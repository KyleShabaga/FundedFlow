import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  accountCatalogueLinkSchema,
  accountPhaseEventSchema,
  canTransitionVerification,
  catalogueVersionSchema,
  checkAccountCatalogueLink,
  checkCatalogueGraph,
  checkCatalogueVersionUpdate,
  commercialOfferSchema,
  derivePhaseHistory,
  effectiveRulebookVersionId,
  phasePathSchema,
  programmeFamilySchema,
  programmePhaseSchema,
  programmeVariantSchema,
  promotionOfferSchema,
  promotionSchema,
  providerSchema,
  sourceReferenceSchema,
  type AccountPhaseEvent,
  type CatalogueGraph,
  type CatalogueIssueCode,
} from "../../src/index.js";
import fixture from "../fixtures/catalogue.json" with { type: "json" };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const graphSchemas = {
  providers: providerSchema,
  programmeFamilies: programmeFamilySchema,
  programmeVariants: programmeVariantSchema,
  catalogueVersions: catalogueVersionSchema,
  programmePhases: programmePhaseSchema,
  phasePaths: phasePathSchema,
  commercialOffers: commercialOfferSchema,
  promotions: promotionSchema,
  promotionOffers: promotionOfferSchema,
} satisfies Record<keyof CatalogueGraph, z.ZodType>;

function parseGraph(raw: typeof fixture.graph): CatalogueGraph {
  const entries = Object.entries(graphSchemas).map(([key, schema]) => [
    key,
    (raw[key as keyof CatalogueGraph] as unknown[]).map((r) => schema.parse(r)),
  ]);
  return Object.fromEntries(entries) as unknown as CatalogueGraph;
}

const graph = parseGraph(fixture.graph);
const events = fixture.phaseEvents.map((e) => accountPhaseEventSchema.parse(e));
const codes = (issues: { code: CatalogueIssueCode }[]) => issues.map((i) => i.code);

type MutableGraph = { -readonly [K in keyof CatalogueGraph]: CatalogueGraph[K][number][] };

/** The fixture graph with one edit applied to a deep copy. */
function edited(edit: (g: MutableGraph) => void): CatalogueGraph {
  const g = clone(graph) as MutableGraph;
  edit(g);
  return g;
}

describe("catalogue.json contract fixture", () => {
  it.each(Object.keys(graphSchemas) as (keyof CatalogueGraph)[])("%s parse and re-serialise unchanged", (key) => {
    const raw = fixture.graph[key] as unknown[];
    expect(raw.length).toBeGreaterThan(0);
    for (const record of raw) expect(graphSchemas[key].parse(record)).toEqual(record);
  });

  it("sources, account links and phase events parse unchanged", () => {
    for (const s of fixture.sources) expect(sourceReferenceSchema.parse(s)).toEqual(s);
    for (const l of fixture.accountLinks) expect(accountCatalogueLinkSchema.parse(l)).toEqual(l);
    for (const e of fixture.phaseEvents) expect(accountPhaseEventSchema.parse(e)).toEqual(e);
  });

  it("is a consistent graph", () => {
    expect(checkCatalogueGraph(graph)).toEqual([]);
  });

  it("links every account consistently, including one with no catalogue references", () => {
    for (const raw of fixture.accountLinks) {
      expect(checkAccountCatalogueLink(accountCatalogueLinkSchema.parse(raw), graph)).toEqual([]);
    }
  });

  it("lets two variants of one family hold separate version 1 snapshots", () => {
    const [a, b] = graph.catalogueVersions;
    expect(a?.versionNumber).toBe(1);
    expect(b?.versionNumber).toBe(1);
    expect(a?.programmeVariantId).not.toBe(b?.programmeVariantId);
  });
});

describe("rulebook bindings", () => {
  const phase = (id: string) => graph.programmePhases.find((p) => p.id === id)!;
  const path = (id: string) => graph.phasePaths.find((p) => p.id === id)!;
  const evaluation = phase("01900000-0000-7000-8000-000000000041");
  const funded = phase("01900000-0000-7000-8000-000000000042");

  it("binds Evaluation and each Funded path to its own rulebook version", () => {
    expect(effectiveRulebookVersionId(evaluation, null)).toBe("01900000-0000-7000-8000-0000000000a1");
    expect(effectiveRulebookVersionId(funded, path("01900000-0000-7000-8000-000000000051"))).toBe(
      "01900000-0000-7000-8000-0000000000a2",
    );
    expect(effectiveRulebookVersionId(funded, path("01900000-0000-7000-8000-000000000052"))).toBe(
      "01900000-0000-7000-8000-0000000000a3",
    );
    expect(effectiveRulebookVersionId(funded, null)).toBeNull();
  });

  it("rejects a path from another phase", () => {
    expect(() => effectiveRulebookVersionId(evaluation, path("01900000-0000-7000-8000-000000000051"))).toThrow(RangeError);
  });
});

describe("money and presence semantics", () => {
  const offer = fixture.graph.commercialOffers[0]!;
  const parseOffer = (patch: Record<string, unknown>) => commercialOfferSchema.safeParse({ ...offer, ...patch });

  it("keeps explicit zero distinct from unknown", () => {
    const funded = commercialOfferSchema.parse(fixture.graph.commercialOffers[1]);
    expect(funded.activationFee).toBe("0");
    expect(funded.resetFee).toBeNull();
  });

  it.each(["105.20", "0105.2", "+105.2", "-1", "1.0000001", "1e3", "$105", " 105", "", "9223372036855"])(
    "rejects non-canonical or out-of-range amount %j",
    (v) => {
      expect(parseOffer({ salePrice: v }).success).toBe(false);
    },
  );

  it("rejects numbers for amounts", () => {
    expect(parseOffer({ salePrice: 105.2 }).success).toBe(false);
  });

  it("accepts six decimal places", () => {
    expect(parseOffer({ salePrice: "105.123456" }).success).toBe(true);
  });

  it("rejects rule terms on an offer", () => {
    expect(parseOffer({ maxDrawdown: "2000" }).success).toBe(false);
  });

  it("needs a currency for any amount", () => {
    expect(parseOffer({ currency: null }).success).toBe(false);
  });

  it("needs a phase for a path offer", () => {
    expect(parseOffer({ programmePhaseId: null, phasePathId: "01900000-0000-7000-8000-000000000051" }).success).toBe(false);
  });

  it("bounds promotion percentages", () => {
    const promo = fixture.graph.promotions[0]!;
    const withPercent = (percent: string) => promotionSchema.safeParse({ ...promo, discount: { kind: "percent", percent } });
    expect(withPercent("25").success).toBe(true);
    expect(withPercent("100").success).toBe(true);
    expect(withPercent("0").success).toBe(false);
    expect(withPercent("100.5").success).toBe(false);
  });

  it("does not parse a size amount from the label", () => {
    const variant = programmeVariantSchema.parse(fixture.graph.programmeVariants[1]);
    expect(variant.sizeLabel).toBe("100K");
    expect(variant.sizeAmount).toBeNull();
    expect(programmeVariantSchema.safeParse({ ...variant, sizeAmount: "100000" }).success).toBe(false);
  });

  it("only accepts namespaced metadata keys", () => {
    const variant = fixture.graph.programmeVariants[0]!;
    expect(programmeVariantSchema.safeParse({ ...variant, metadata: { copyTrading: true } }).success).toBe(false);
  });

  it("keeps provider wording verbatim and rejects blank labels", () => {
    const phase = fixture.graph.programmePhases[0]!;
    expect(programmePhaseSchema.parse({ ...phase, providerLabel: "  Evaluation " }).providerLabel).toBe("  Evaluation ");
    expect(programmePhaseSchema.safeParse({ ...phase, providerLabel: "  " }).success).toBe(false);
  });

  it("rejects unknown phase keys instead of guessing", () => {
    const phase = fixture.graph.programmePhases[0]!;
    expect(programmePhaseSchema.safeParse({ ...phase, phaseKey: "funded" }).success).toBe(false);
    expect(programmePhaseSchema.safeParse({ ...phase, phaseKey: "paused" }).success).toBe(false);
  });
});

describe("provenance and verification", () => {
  const version = fixture.graph.catalogueVersions[0]!;

  it("cannot verify without review", () => {
    expect(canTransitionVerification("draft", "verified")).toBe(false);
    expect(canTransitionVerification("needs_review", "verified")).toBe(true);
    expect(canTransitionVerification("superseded", "needs_review")).toBe(false);
    expect(canTransitionVerification("rejected", "verified")).toBe(false);
  });

  it("requires a reviewer for a verified version or source", () => {
    expect(catalogueVersionSchema.safeParse({ ...version, verificationStatus: "verified" }).success).toBe(false);
    expect(
      catalogueVersionSchema.safeParse({
        ...version,
        verificationStatus: "verified",
        verifiedBy: "user",
        verifiedAt: "2026-10-20T08:00:00.000Z",
      }).success,
    ).toBe(true);
    const source = fixture.sources[0]!;
    expect(sourceReferenceSchema.safeParse({ ...source, verificationStatus: "verified" }).success).toBe(false);
  });

  it("requires a reason to supersede", () => {
    const corrected = { ...version, id: "01900000-0000-7000-8000-000000000039", versionNumber: 2 };
    expect(catalogueVersionSchema.safeParse({ ...corrected, supersedesVersionId: version.id }).success).toBe(false);
    expect(
      catalogueVersionSchema.safeParse({ ...corrected, supersedesVersionId: version.id, correctionReason: "Sale price misread" })
        .success,
    ).toBe(true);
  });

  it("requires a source for sourced claims and a URL or descriptor for sources", () => {
    const claim = { field: "listPrice", origin: "extracted_candidate", sourceId: null, providerText: "$146" };
    expect(catalogueVersionSchema.safeParse({ ...version, claims: [claim] }).success).toBe(false);
    expect(sourceReferenceSchema.safeParse({ ...fixture.sources[0], descriptor: null }).success).toBe(false);
  });

  it("rejects effective windows that end before they start", () => {
    expect(
      catalogueVersionSchema.safeParse({
        ...version,
        effectiveFrom: "2026-11-01T00:00:00.000Z",
        effectiveTo: "2026-10-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  describe("version updates", () => {
    const verified = catalogueVersionSchema.parse({
      ...version,
      verificationStatus: "verified",
      verifiedBy: "user",
      verifiedAt: "2026-10-20T08:00:00.000Z",
    });

    it("freezes a verified version's content", () => {
      expect(codes(checkCatalogueVersionUpdate(verified, { ...verified, revisionLabel: "edited" }))).toEqual([
        "verified_version_changed",
      ]);
      expect(codes(checkCatalogueVersionUpdate(verified, { ...verified, claims: [] }))).toEqual(["verified_version_changed"]);
    });

    it("allows a verified version to go stale or be superseded", () => {
      expect(checkCatalogueVersionUpdate(verified, { ...verified, verificationStatus: "stale" })).toEqual([]);
      expect(checkCatalogueVersionUpdate(verified, { ...verified, verificationStatus: "superseded" })).toEqual([]);
    });

    it("ignores key order", () => {
      const reordered = Object.fromEntries(Object.entries(verified).reverse()) as typeof verified;
      expect(checkCatalogueVersionUpdate(verified, reordered)).toEqual([]);
    });

    it("rejects skipping review", () => {
      const draft = graph.catalogueVersions[1]!;
      expect(
        codes(
          checkCatalogueVersionUpdate(draft, {
            ...draft,
            verificationStatus: "verified",
            verifiedBy: "user",
            verifiedAt: "2026-10-20T08:00:00.000Z",
          }),
        ),
      ).toEqual(["invalid_verification_transition"]);
    });

    it("lets a candidate be edited", () => {
      expect(checkCatalogueVersionUpdate(graph.catalogueVersions[0]!, { ...graph.catalogueVersions[0]!, claims: [] })).toEqual(
        [],
      );
    });
  });
});

describe("catalogue graph integrity", () => {
  const [eval50, funded50, eval100] = ["41", "42", "43"].map((n) => `01900000-0000-7000-8000-0000000000${n}`);

  it.each<[string, (g: MutableGraph) => void, CatalogueIssueCode[]]>([
    [
      "duplicate variant slug in a family",
      (g) => {
        g.programmeVariants[1]!.slug = "50k";
      },
      ["duplicate_variant_slug"],
    ],
    [
      "duplicate provider slug",
      (g) => {
        g.providers[1]!.slug = "example-provider";
      },
      ["duplicate_provider_slug"],
    ],
    [
      "duplicate family slug within a provider",
      (g) => {
        g.programmeFamilies[1]!.providerId = g.providers[0]!.id;
      },
      ["duplicate_family_slug"],
    ],
    [
      "duplicate version number for a variant",
      (g) => {
        g.catalogueVersions[1]!.programmeVariantId = g.programmeVariants[0]!.id;
      },
      ["duplicate_version_number"],
    ],
    [
      "variant whose family belongs to another provider",
      (g) => {
        g.programmeVariants[1]!.providerId = g.providers[1]!.id;
      },
      // The variant, and the promotion now linked to another provider's offer.
      ["cross_provider_reference", "cross_provider_reference"],
    ],
    [
      "duplicate phase in a version",
      (g) => {
        g.programmePhases[2]!.catalogueVersionId = g.catalogueVersions[0]!.id;
      },
      ["duplicate_phase"],
    ],
    [
      "two default paths",
      (g) => {
        g.phasePaths[1]!.isDefault = true;
      },
      ["multiple_default_paths"],
    ],
    [
      "duplicate path key",
      (g) => {
        g.phasePaths[1]!.pathKey = "daily";
      },
      ["duplicate_path_key"],
    ],
    [
      "offer phase from another version",
      (g) => {
        g.commercialOffers[0]!.programmePhaseId = eval100!;
      },
      ["offer_phase_outside_version"],
    ],
    [
      "offer path from another phase",
      (g) => {
        g.commercialOffers[0]!.programmePhaseId = eval50!;
        g.commercialOffers[0]!.phasePathId = g.phasePaths[0]!.id;
      },
      ["offer_path_outside_phase"],
    ],
    [
      "promotion of another provider",
      (g) => {
        g.promotions[0]!.providerId = g.providers[1]!.id;
      },
      ["cross_provider_reference", "cross_provider_reference"],
    ],
    [
      "promotion link outside the offer's window",
      (g) => {
        g.promotionOffers[1]!.validFrom = "2026-11-15T00:00:00.000Z";
      },
      ["promotion_offer_window_disjoint"],
    ],
    [
      "duplicate promotion link",
      (g) => {
        g.promotionOffers.push(g.promotionOffers[0]!);
      },
      ["duplicate_promotion_offer"],
    ],
    [
      "dangling phase reference",
      (g) => {
        g.phasePaths[0]!.programmePhaseId = "01900000-0000-7000-8000-0000000000ff";
      },
      ["missing_reference"],
    ],
    [
      "duplicate id",
      (g) => {
        g.programmePhases.push(g.programmePhases[0]!);
      },
      ["duplicate_id", "duplicate_phase"],
    ],
    [
      "superseding a version of another variant",
      (g) => {
        g.catalogueVersions[1]!.supersedesVersionId = g.catalogueVersions[0]!.id;
      },
      ["superseded_version_outside_variant"],
    ],
  ])("reports %s", (_name, edit, expected) => {
    expect(codes(checkCatalogueGraph(edited(edit)))).toEqual(expected);
  });

  it("allows the funded phase offer to bind a path of its own phase", () => {
    const g = edited((g) => {
      g.commercialOffers[1]!.phasePathId = g.phasePaths[1]!.id;
    });
    expect(g.commercialOffers[1]!.programmePhaseId).toBe(funded50);
    expect(checkCatalogueGraph(g)).toEqual([]);
  });
});

describe("account catalogue links", () => {
  const base = accountCatalogueLinkSchema.parse(fixture.accountLinks[1]);
  const check = (patch: Partial<typeof base>) => codes(checkAccountCatalogueLink({ ...base, ...patch }, graph));

  it("rejects a variant from another provider", () => {
    expect(check({ providerId: "01900000-0000-7000-8000-000000000002" })).toEqual(["account_variant_outside_provider"]);
  });

  it("rejects a version of another variant", () => {
    expect(check({ catalogueVersionId: "01900000-0000-7000-8000-000000000032", selectedPhasePathId: null })).toEqual([
      "account_version_outside_variant",
    ]);
  });

  it("rejects a path outside the selected version", () => {
    expect(
      check({
        programmeVariantId: "01900000-0000-7000-8000-000000000022",
        catalogueVersionId: "01900000-0000-7000-8000-000000000032",
      }),
    ).toEqual(["account_path_outside_version"]);
  });

  it("reports missing references", () => {
    expect(check({ selectedPhasePathId: "01900000-0000-7000-8000-0000000000ff" })).toEqual(["missing_reference"]);
  });

  it("requires the parent chain of references", () => {
    expect(accountCatalogueLinkSchema.safeParse({ ...base, providerId: null }).success).toBe(false);
    expect(accountCatalogueLinkSchema.safeParse({ ...base, programmeVariantId: null }).success).toBe(false);
    expect(accountCatalogueLinkSchema.safeParse({ ...base, parentAccountId: base.accountId }).success).toBe(false);
  });

  it("keeps an account's version when a newer catalogue version is added", () => {
    const g = edited((g) => {
      g.catalogueVersions.push({
        ...g.catalogueVersions[0]!,
        id: "01900000-0000-7000-8000-000000000039",
        versionNumber: 2,
        supersedesVersionId: g.catalogueVersions[0]!.id,
        correctionReason: "Price change",
      });
    });
    expect(checkCatalogueGraph(g)).toEqual([]);
    expect(checkAccountCatalogueLink(base, g)).toEqual([]);
    expect(base.catalogueVersionId).toBe("01900000-0000-7000-8000-000000000031");
  });
});

describe("phase history", () => {
  const account = "01900000-0000-7000-8000-000000000081";
  const event = (patch: Partial<AccountPhaseEvent>): AccountPhaseEvent => ({ ...events[0]!, ...patch });

  it("derives the current phase, applying corrections without deleting history", () => {
    const before = clone(events);
    const history = derivePhaseHistory(account, events);
    expect(history.currentPhase).toBe("simulated_funded");
    expect(history.effective.map((e) => e.id.slice(-2))).toEqual(["b1", "b3"]);
    expect(history.issues).toEqual([]);
    expect(events).toEqual(before);
  });

  it("orders by recording time, not input order", () => {
    expect(derivePhaseHistory(account, [...events].reverse()).currentPhase).toBe("simulated_funded");
  });

  it("is unknown with no events", () => {
    expect(derivePhaseHistory(account, [])).toEqual({ currentPhase: "unknown", effective: [], issues: [] });
  });

  it("reports a contradictory transition but still applies it", () => {
    const wrong = event({
      id: "01900000-0000-7000-8000-0000000000b4",
      fromPhase: "evaluation",
      toPhase: "live_funded",
      recordedAt: "2026-10-12T09:00:00.000Z",
      occurredAt: null,
      correctionOfEventId: null,
    });
    const history = derivePhaseHistory(account, [...events, wrong]);
    expect(history.currentPhase).toBe("live_funded");
    expect(history.issues).toEqual([
      { code: "contradictory_transition", eventId: wrong.id, expectedFrom: "simulated_funded", fromPhase: "evaluation" },
    ]);
  });

  it("reports events of other accounts, duplicates and bad correction targets", () => {
    const foreign = event({ id: "01900000-0000-7000-8000-0000000000c1", accountId: "other" });
    const dangling = event({
      id: "01900000-0000-7000-8000-0000000000c2",
      fromPhase: "evaluation",
      recordedAt: "2026-10-02T00:00:00.000Z",
      occurredAt: null,
      correctionOfEventId: "01900000-0000-7000-8000-0000000000ff",
    });
    const history = derivePhaseHistory(account, [events[0]!, events[0]!, foreign, dangling]);
    expect(history.issues.map((i) => i.code)).toEqual(["duplicate_event_id", "foreign_account", "unknown_correction_target"]);
    expect(history.currentPhase).toBe("evaluation");
  });

  it("reports a correction of a later event", () => {
    const early = event({
      id: "01900000-0000-7000-8000-0000000000c3",
      fromPhase: "evaluation",
      recordedAt: "2026-10-02T00:00:00.000Z",
      occurredAt: null,
      correctionOfEventId: events[2]!.id,
    });
    expect(derivePhaseHistory(account, [...events, early]).issues.map((i) => i.code)).toContain("correction_target_not_earlier");
  });

  it("reports occurrence times that go backwards", () => {
    const late = event({
      id: "01900000-0000-7000-8000-0000000000c4",
      fromPhase: "simulated_funded",
      toPhase: "live_funded",
      occurredAt: "2026-09-01T00:00:00.000Z",
      recordedAt: "2026-10-15T00:00:00.000Z",
      correctionOfEventId: null,
    });
    expect(derivePhaseHistory(account, [...events, late]).issues).toEqual([{ code: "occurred_out_of_order", eventId: late.id }]);
  });

  it("rejects record statuses as phases", () => {
    for (const toPhase of ["paused", "failed", "closed", "archived"]) {
      expect(accountPhaseEventSchema.safeParse({ ...fixture.phaseEvents[0], toPhase }).success).toBe(false);
    }
  });
});
