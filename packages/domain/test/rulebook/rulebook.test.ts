import { describe, expect, it } from "vitest";

import {
  accountRulebookAssignmentSchema,
  canAssign,
  checkPublish,
  checkRuleDefinitions,
  effectiveRulebookVersionId,
  phasePathSchema,
  programmePhaseSchema,
  ruleApplicabilitySchema,
  ruleClaimSchema,
  ruleDefinitionInputSchema,
  ruleDefinitionSchema,
  rulebookDraftInputSchema,
  rulebookSchema,
  rulebookVersionSchema,
  shareOfOne,
  type RuleDefinition,
  type RuleDefinitionInput,
  type RulebookVersionDetail,
} from "../../src/index.js";
import catalogue from "../fixtures/catalogue.json" with { type: "json" };
import fixture from "../fixtures/rulebook.json" with { type: "json" };
import legacyConversionJson from "../fixtures/rulebook-legacy-conversion.json" with { type: "json" };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type ConvertedRule = { ruleKey: string; supportStatus: string; overrideKind: string | null; providerLabel: string | null; ruleType: string };
const legacyConversion = legacyConversionJson as unknown as { versionId: string; rules: ConvertedRule[] }[];
const rulebook = rulebookSchema.parse(fixture.rulebooks[0]);
const versions = fixture.versions.map((v) => rulebookVersionSchema.parse(v));
const rules = fixture.rules.map((r) => ruleDefinitionSchema.parse(r));
const applicability = fixture.applicability.map((a) => ruleApplicabilitySchema.parse(a));
const claims = fixture.claims.map((c) => ruleClaimSchema.parse(c));
const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const rulesOf = (v: number) => rules.filter((r) => r.rulebookVersionId === id(v));
const rule = (v: number, key: string) => rulesOf(v).find((r) => r.ruleKey === key)!;
const input = ({ id: _i, rulebookVersionId: _v, ...rest }: RuleDefinition) => rest;

function detail(v: number, edit: (d: RulebookVersionDetail) => void = () => {}): RulebookVersionDetail {
  const d = clone({
    rulebook,
    version: versions.find((x) => x.id === id(v))!,
    rules: rulesOf(v),
    applicability: applicability.filter((a) => a.rulebookVersionId === id(v)),
    claims: claims.filter((c) => rulesOf(v).some((r) => r.id === c.ruleDefinitionId)),
  });
  edit(d);
  return d;
}

describe("rulebook fixture", () => {
  it("parses, and its rules pass the publish checks", () => {
    expect(rules).toHaveLength(15);
    for (const v of [0xa1, 0xa2, 0xa3]) expect(checkRuleDefinitions(rulesOf(v).map(input))).toEqual([]);
  });

  it("is the rulebook the catalogue fixture's phase and paths reference", () => {
    const phases = catalogue.graph.programmePhases.map((p) => programmePhaseSchema.parse(p));
    const paths = catalogue.graph.phasePaths.map((p) => phasePathSchema.parse(p));
    const evaluation = phases.find((p) => p.id === id(0x41))!;
    const funded = phases.find((p) => p.id === id(0x42))!;
    expect(effectiveRulebookVersionId(evaluation, null)).toBe(id(0xa1));
    expect(effectiveRulebookVersionId(funded, paths.find((p) => p.pathKey === "daily")!)).toBe(id(0xa2));
    expect(effectiveRulebookVersionId(funded, paths.find((p) => p.pathKey === "flex")!)).toBe(id(0xa3));
    // Each version also states its own applicability, phase and path exactly.
    expect(applicability.map((a) => [a.rulebookVersionId, a.programmePhaseId, a.phasePathId])).toEqual([
      [id(0xa1), id(0x41), null],
      [id(0xa2), id(0x42), id(0x51)],
      [id(0xa3), id(0x42), id(0x52)],
    ]);
  });
});

describe("rule values", () => {
  it("compares consistency shares exactly at one without floating-point rounding", () => {
    for (const value of ["1", "0.5", "0.9999999999999999999999999999", "0.0000000000000000000000000001"]) {
      expect(shareOfOne.safeParse(value).success, value).toBe(true);
    }
    for (const value of ["1.0000000000000000000000000001", "0", "-0.5", "1.1", "1.0", "01", "1e-1"]) {
      expect(shareOfOne.safeParse(value).success, value).toBe(false);
    }
  });

  it("keeps evaluation and funded terms apart", () => {
    expect(rule(0xa1, "daily_loss_limit").parameters).toMatchObject({ limit: { state: "disabled" }, condition: "always" });
    expect(rule(0xa2, "daily_loss_limit").parameters).toMatchObject({
      limit: { state: "explicit_none" },
      condition: "below_initial_trail",
    });
    expect(rule(0xa3, "daily_loss_limit").parameters).toMatchObject({ limit: { state: "unknown" } });
    expect(rulesOf(0xa1).some((r) => r.ruleType === "payout_count_transition")).toBe(false);
    expect(rule(0xa2, "payout_count_transition").parameters).toEqual({
      payoutsRequired: { state: "value", value: 5 },
      nextPhase: "live_funded",
    });
  });

  it("distinguishes OFF, NONE, not applicable, unknown and an explicit zero", () => {
    const base = fixture.rules.find((r) => r.id === id(0x102))!;
    const limit = (value: unknown) => ({ ...base, parameters: { ...base.parameters, limit: value } });
    const states = ["disabled", "explicit_none", "not_applicable", "unknown"].map((state) =>
      ruleDefinitionSchema.parse(limit({ state })),
    );
    expect(new Set(states.map((r) => JSON.stringify(r.parameters)))).toHaveProperty("size", 4);
    const zero = ruleDefinitionSchema.parse(limit({ state: "value", value: "0" }));
    expect(zero.parameters).toMatchObject({ limit: { state: "value", value: "0" } });
    // A bare null, a number or a non-canonical amount is never accepted as a value.
    for (const bad of [null, 0, { state: "value", value: 0 }, { state: "value", value: "1,000" }, { state: "none" }]) {
      expect(ruleDefinitionSchema.safeParse(limit(bad)).success).toBe(false);
    }
  });

  it("keeps a mixed mini/micro capacity unresolved until confirmed", () => {
    const r = rule(0xa1, "max_position_size");
    expect(r.parameters).toMatchObject({ combination: "unknown", microsPerMini: { state: "unknown" } });
    expect(r.supportStatus).toBe("needs_setup");
    expect(checkRuleDefinitions([{ ...input(r), supportStatus: "supported" }])).toHaveLength(1);
  });

  it("records qualifying profit days, payout waiting days and a scaling plan without its schedule", () => {
    expect(rule(0xa2, "min_trading_days").parameters).toEqual({
      days: { state: "value", value: 5 },
      minDayProfit: { state: "value", value: "150" },
      dayBasis: "unknown",
    });
    expect(rule(0xa2, "payout_eligibility").parameters).toMatchObject({ initialWaitingDays: { state: "value", value: 5 } });
    expect(rule(0xa2, "scaling_plan")).toMatchObject({ supportStatus: "needs_setup", parameters: { schedule: { state: "unknown" } } });
  });

  it("rejects parameters of another type, unknown keys and a stale schema version", () => {
    const pt = fixture.rules.find((r) => r.id === id(0x101))!;
    expect(ruleDefinitionSchema.safeParse({ ...pt, ruleType: "max_drawdown" }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...pt, parameters: { ...pt.parameters, extra: 1 } }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...pt, parameterSchemaVersion: 2 }).success).toBe(false);
    expect(ruleDefinitionInputSchema.safeParse(input(rule(0xa1, "profit_target"))).success).toBe(true);
  });
});

describe("checkRuleDefinitions", () => {
  const pt = input(rule(0xa1, "profit_target"));

  it("never presents an unknown value as supported", () => {
    const unknown = { ...pt, parameters: { amount: { state: "unknown" }, basis: "unknown" } } as RuleDefinitionInput;
    expect(checkRuleDefinitions([unknown]).map((i) => i.field)).toEqual(["rules[0].supportStatus"]);
    expect(checkRuleDefinitions([{ ...unknown, supportStatus: "needs_setup" } as RuleDefinitionInput])).toEqual([]);
  });

  it("keeps manual rules manual, keys unique and personal limits free of provider wording", () => {
    const news = input(rule(0xa3, "news"));
    expect(checkRuleDefinitions([{ ...news, supportStatus: "supported" }])).toHaveLength(1);
    expect(checkRuleDefinitions([pt, pt]).map((i) => i.message)).toEqual(["Duplicate rule key 'profit_target'"]);
    expect(checkRuleDefinitions([{ ...pt, overrideKind: "personal_limit" }])).toHaveLength(1);
  });
});

describe("publishing and assignment", () => {
  it("verifies a catalogue version only with a reviewer, an applicability row and no conflicts", () => {
    expect(checkPublish(detail(0xa1), "kyle")).toEqual([]);
    expect(checkPublish(detail(0xa1), null).map((i) => i.field)).toEqual(["reviewer"]);
    expect(checkPublish(detail(0xa1, (d) => (d.applicability = [])), "kyle").map((i) => i.field)).toEqual([
      "applicability",
    ]);
    const conflicted = detail(0xa1, (d) => (d.claims[0]!.claimStatus = "conflicting"));
    expect(checkPublish(conflicted, "kyle").map((i) => i.field)).toEqual(["claims"]);
  });

  it("publishes a draft without a reviewer, and never re-publishes a verified version", () => {
    const draft = detail(0xa1, (d) => (d.version.verificationStatus = "draft"));
    expect(checkPublish(draft, null)).toEqual([]);
    expect(checkPublish(draft, "kyle").map((i) => i.field)).toEqual(["reviewer"]);
    const verified = detail(0xa1, (d) => (d.version.verificationStatus = "verified"));
    expect(checkPublish(verified, "kyle").map((i) => i.field)).toEqual(["verificationStatus"]);
  });

  it("assigns catalogue versions only once verified, and private versions only to their own account", () => {
    const v = versions[0]!;
    expect(canAssign(rulebook, v, "acc-1")).toBe(false);
    expect(canAssign(rulebook, { ...v, verificationStatus: "verified" }, "acc-1")).toBe(true);
    const own = { ...rulebook, ownerAccountId: "acc-1" };
    expect(canAssign(own, v, "acc-1")).toBe(true);
    expect(canAssign(own, v, "acc-2")).toBe(false);
    expect(canAssign(own, { ...v, verificationStatus: "draft" }, "acc-1")).toBe(false);
    expect(canAssign(own, { ...v, recordStatus: "archived" }, "acc-1")).toBe(false);
    const privateWithPhase = detail(0xa1, (d) => {
      d.rulebook.ownerAccountId = "acc-1";
      d.version.verificationStatus = "draft";
    });
    expect(checkPublish(privateWithPhase, null).map((i) => i.field)).toEqual(["applicability"]);
  });

  it("validates assignment intervals and draft inputs", () => {
    const a = {
      id: "as1", accountId: "acc-1", rulebookVersionId: id(0xa1), programmePhaseId: null, phasePathId: null,
      accountPhaseEventId: null, effectiveFrom: "2026-10-01", effectiveTo: null, assignedAt: "2026-10-01T00:00:00.000Z",
      assignmentSource: "user",
    };
    expect(accountRulebookAssignmentSchema.safeParse(a).success).toBe(true);
    expect(accountRulebookAssignmentSchema.safeParse({ ...a, effectiveTo: "2026-10-01" }).success).toBe(false);
    const draft = {
      rulebookId: id(0x90), newRulebook: null, supersedesVersionId: id(0xa1), changeReason: "price change",
      capturedAt: "2026-10-20T00:00:00.000Z", effectiveFrom: null, effectiveTo: null,
      rules: [input(rule(0xa1, "profit_target"))], applicability: [],
    };
    expect(rulebookDraftInputSchema.safeParse(draft).success).toBe(true);
    expect(rulebookDraftInputSchema.safeParse({ ...draft, rulebookId: null }).success).toBe(false);
  });
});

describe("legacy conversion (Rust migration 10)", () => {
  // Written by db/legacy_rulebook_tests.rs from the converted v8 legacy-rules journal.
  it("produces rules the Zod contracts accept and the publish checks pass", () => {
    const converted = legacyConversion.flatMap((v) => v.rules.map((r) => ruleDefinitionSchema.parse(r)));
    expect(converted).toHaveLength(18);
    for (const v of legacyConversion) {
      const parsed = v.rules.map((r) => input(ruleDefinitionSchema.parse(r)));
      expect(checkRuleDefinitions(parsed)).toEqual([]);
    }
  });

  it("keeps unknown legacy values unknown and personal limits as overrides", () => {
    const all = legacyConversion.flatMap((v) => v.rules);
    expect(all.filter((r) => r.supportStatus === "needs_setup").map((r) => r.ruleKey)).toEqual([
      "max_drawdown",
      "daily_loss_limit",
    ]);
    expect(all.filter((r) => r.overrideKind === "personal_limit").every((r) => r.providerLabel === null)).toBe(true);
    expect(all.some((r) => r.ruleType === "unknown")).toBe(false);
  });
});
