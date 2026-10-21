// Build 19 view models: comparison, draft validation, value wording and version states.
import type { RulebookVersionDetail } from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import { catalogueRules } from "./test-store";
import { compareVersions } from "./view-models/compare";
import { formFromDetail, formToUpdate, isDirty, newRule, newRuleKey, validateForm } from "./view-models/draft-form";
import { describeValue, emptyParameters, headlinePresence, RULE_FIELDS } from "./view-models/rule-fields";
import { assignableVersions, notCalculated, versionState } from "./view-models/versions";

const T = "2026-10-20T15:00:00.000Z";
function detail(over: { owner?: string | null; status?: RulebookVersionDetail["version"]["verificationStatus"]; rules?: ReturnType<typeof catalogueRules>; id?: string } = {}): RulebookVersionDetail {
  const id = over.id ?? "v1";
  return {
    rulebook: { id: "rb", providerId: over.owner ? null : "p", ownerAccountId: over.owner ?? null, slug: "rb", displayName: "Book", description: null, recordStatus: "active", createdAt: T, updatedAt: T },
    version: { id, rulebookId: "rb", versionNumber: 1, schemaVersion: 1, verificationStatus: over.status ?? "verified", origin: "catalogue", capturedAt: T, effectiveFrom: null,
      effectiveTo: null, verifiedBy: over.status && over.status !== "verified" ? null : "Reviewer", verifiedAt: over.status && over.status !== "verified" ? null : T,
      userConfirmedAt: null, changeReason: null, supersedesVersionId: null, recordStatus: "active", createdAt: T, updatedAt: T },
    rules: (over.rules ?? catalogueRules()).map((r, i) => ({ ...r, id: `${id}-r${i}`, rulebookVersionId: id })) as RulebookVersionDetail["rules"],
    applicability: [],
    claims: [],
  };
}

describe("compareVersions", () => {
  it("shows field-level changes, additions and removals in words, including unknown values", () => {
    const active = detail();
    const rules = catalogueRules();
    rules[0].parameters = { amount: { state: "unknown" }, basis: "balance" };
    rules.splice(2, 1);
    rules.push({ ...catalogueRules()[0], ruleKey: "profit_target:2", displayLabel: "Personal target", parameters: { amount: { state: "value", value: "1500.5" }, basis: "balance" } } as never);
    const proposed = detail({ id: "v2", status: "draft", rules });
    const c = compareVersions(active, proposed, { currency: "USD" });
    const target = c.rules.find(r => r.ruleKey === "profit_target")!;
    expect(target.kind).toBe("changed");
    expect(target.fields.find(f => f.field === "parameters.amount")).toMatchObject({ before: "$3,000.00", after: "Unknown", kind: "changed" });
    expect(c.rules.find(r => r.ruleKey === "manual_check")!.kind).toBe("removed");
    expect(c.rules.find(r => r.ruleKey === "profit_target:2")!).toMatchObject({ kind: "added", label: "Personal target" });
    expect(c.changeCount).toBe(3);
  });

  it("treats every value as new when no version is in use", () => {
    const c = compareVersions(null, detail(), { currency: "USD" });
    expect(c.rules.every(r => r.kind === "added")).toBe(true);
    expect(c.meta.every(m => m.kind === "added")).toBe(true);
  });

  it("finds no difference between a version and its copy", () => {
    expect(compareVersions(detail(), detail({ id: "copy" }), { currency: "USD" }).changeCount).toBe(0);
  });
});

describe("draft form", () => {
  it("round-trips a version and notices edits", () => {
    const form = formFromDetail(detail({ status: "draft" }));
    expect(formToUpdate(form).rules).toHaveLength(3);
    expect(isDirty(form, formFromDetail(detail({ status: "draft" })))).toBe(false);
    const edited = { ...form, rules: form.rules.slice(1) };
    expect(isDirty(edited, form)).toBe(true);
  });

  it("uses the domain rules: an unknown value needs setup, a superseding draft needs a reason", () => {
    const form = formFromDetail(detail({ status: "draft" }));
    form.rules[1] = { ...form.rules[1], supportStatus: "supported" };
    expect(validateForm(form, { supersedes: true }).map(i => i.field)).toEqual(["changeReason", "rules[1].supportStatus"]);
  });

  it("reports invalid parameters with the backend's paths", () => {
    const form = formFromDetail(detail({ status: "draft" }));
    form.rules[0] = { ...form.rules[0], parameters: { amount: { state: "value", value: "-5" }, basis: "balance" } };
    expect(validateForm(form, { supersedes: false })[0].field).toMatch(/^rules\[0\]\.parameters\.amount/);
  });

  it("starts new rules unknown and needing setup, with unique keys", () => {
    expect(newRuleKey("max_drawdown", ["max_drawdown", "max_drawdown:2"])).toBe("max_drawdown:3");
    const r = newRule("daily_loss_limit", []);
    expect(r).toMatchObject({ supportStatus: "needs_setup", parameters: { limit: { state: "unknown" }, basis: "unknown" } });
    expect(newRule("manual_check", []).supportStatus).toBe("manual_only");
    expect(validateForm({ ...formFromDetail(detail({ status: "draft", rules: [] })), rules: [r] }, { supersedes: false })).toEqual([]);
  });
});

describe("value wording", () => {
  it("never shows an unknown or stated-none limit as zero", () => {
    const amount = RULE_FIELDS.profit_target[0];
    expect(describeValue(amount, { state: "unknown" }, "USD")).toBe("Unknown");
    expect(describeValue(amount, { state: "explicit_none" }, "USD")).toBe("None (stated by the source)");
    expect(describeValue(amount, { state: "value", value: "0" }, "USD")).toBe("$0.00");
    expect(describeValue(amount, { state: "value", value: "1234567.891234" }, "EUR")).toBe("€1,234,567.89");
    expect(headlinePresence("max_drawdown", emptyParameters("max_drawdown") as never)).toBe("unknown");
  });
});

describe("version states", () => {
  it("never styles account rules or unreviewed terms as verified", () => {
    expect(versionState(detail({ owner: "a1", status: "needs_review" })).label).toBe("Account rules (private)");
    expect(versionState(detail({ status: "needs_review" })).label).toBe("Needs review");
    expect(versionState(detail({ status: "stale" })).label).toBe("Stale");
    expect(versionState(detail()).label).toBe("Verified");
  });

  it("marks manual, unsupported and needs-setup rules as not calculated", () => {
    expect(notCalculated({ ruleType: "manual_check", supportStatus: "manual_only" })).toMatch(/not calculated/);
    expect(notCalculated({ ruleType: "max_drawdown", supportStatus: "unsupported" })).toMatch(/not evaluated/);
    expect(notCalculated({ ruleType: "max_drawdown", supportStatus: "needs_setup" })).toMatch(/unknown/);
    expect(notCalculated({ ruleType: "profit_target", supportStatus: "supported" })).toBeNull();
  });

  it("offers only versions the domain lets this account use", () => {
    const list = [detail(), detail({ id: "d", status: "draft" }), detail({ id: "mine", owner: "a1", status: "needs_review" }), detail({ id: "theirs", owner: "a2", status: "needs_review" })];
    expect(assignableVersions(list, "a1").map(d => d.version.id)).toEqual(["v1", "mine"]);
  });
});
