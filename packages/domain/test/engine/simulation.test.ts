// Build 19: simulating a proposed (unpublished) rulebook version against an account's real
// evidence, without weakening active evaluation.
import { describe, expect, it } from "vitest";
import {
  evaluateAccountRisk,
  isEngineResultCurrent,
  simulateRulebookVersion,
  SIMULATION_ASSIGNMENT_PREFIX,
  type AccountRiskInputs,
} from "../../src/index.js";
import { drawdown, id, inputs, instant, policy, trade } from "./fixtures.js";

/** The domain package has no DOM or Node types, so no structuredClone. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A private draft copied from the assigned catalogue version, with a different drawdown amount. */
function privateDraft(i: AccountRiskInputs, amount = "1000") {
  const p = clone(i.rulebookVersions[0]!);
  const versionId = id(900);
  p.rulebook = { ...p.rulebook, id: id(901), ownerAccountId: i.account.id, providerId: null, slug: "own" };
  p.version = { ...p.version, id: versionId, rulebookId: id(901), verificationStatus: "draft", verifiedBy: null, verifiedAt: null, origin: "user_authored" };
  p.rules = p.rules.map((r, n) => ({ ...r, id: id(910 + n), rulebookVersionId: versionId }));
  const dd = p.rules[0]!;
  if (dd.ruleType === "max_drawdown") dd.parameters.amount = { state: "value", value: amount };
  p.applicability = [];
  p.claims = [];
  return p;
}

describe("simulateRulebookVersion", () => {
  it("evaluates an unconfirmed private draft with exact figures, labelled and never active", () => {
    const i = inputs([drawdown()]);
    i.trades = [trade("-500")];
    const before = clone(i);
    const sim = simulateRulebookVersion(i, privateDraft(i), policy(i));
    expect(sim).toMatchObject({ kind: "simulation", proposedVersionId: id(900), replacesAssignmentId: id(30) });
    expect(sim.result.assignmentId).toBe(`${SIMULATION_ASSIGNMENT_PREFIX}${id(900)}`);
    expect(sim.result.assurance).toBe("user_defined_estimate");
    // Static floor = opening 50,000 − 1,000; balance 49,500.
    expect(sim.result.rules[0]!.metrics).toMatchObject({ drawdownFloor: "49000", drawdownHeadroom: "500" });
    expect(sim.result.rules[0]!.assumptions.join(" ")).toMatch(/not confirmed or in use/);
    expect(sim.result.status).toBe("Safe");
    expect(i).toEqual(before);
  });

  it("finds the breach the proposal would cause, from the same history", () => {
    const i = inputs([drawdown()]);
    i.trades = [trade("-1200")];
    expect(evaluateAccountRisk(i, policy(i)).status).toBe("Safe");
    expect(simulateRulebookVersion(i, privateDraft(i), policy(i)).result.status).toBe("Stop");
  });

  it("does not weaken active evaluation: an assigned draft is still refused", () => {
    const i = inputs([drawdown()]);
    const draft = privateDraft(i);
    const assigned = { ...i.assignments[0]!, rulebookVersionId: draft.version.id };
    const active = evaluateAccountRisk({ ...i, assignments: [assigned], applicableAssignment: assigned, rulebookVersions: [draft] }, policy(i));
    expect(active.reasons).toContain("unverified_or_archived_rulebook");
    expect(active.status).toBe("Unknown");
  });

  it("is never provider-verified and never matches a stored active result", () => {
    const i = inputs([drawdown()]);
    const copy = clone(i.rulebookVersions[0]!);
    const sim = simulateRulebookVersion(i, copy, policy(i));
    expect(sim.result.assurance).toBe("unverified");
    const active = evaluateAccountRisk(i, policy(i));
    expect(sim.result.inputsHash).not.toBe(active.inputsHash);
    expect(isEngineResultCurrent(sim.result, i, policy(i))).toBe(false);
  });

  it("does not borrow a phase: a catalogue proposal without an assignment in force stays Unknown", () => {
    const i = inputs([drawdown()]);
    const none = { ...i, assignments: [], applicableAssignment: null, rulebookVersions: [] };
    const sim = simulateRulebookVersion(none, clone(i.rulebookVersions[0]!), policy(i));
    expect(sim.replacesAssignmentId).toBeNull();
    expect(sim.result.reasons).toContain("phase_path_context_unresolved");
    expect(sim.result.status).toBe("Unknown");
  });

  it("refuses to simulate a discarded version or another account's rules", () => {
    const i = inputs([drawdown()]);
    const rejected = privateDraft(i);
    rejected.version.verificationStatus = "rejected";
    expect(simulateRulebookVersion(i, rejected, policy(i)).result.reasons).toContain("unsimulatable_rulebook_version");
    const foreign = privateDraft(i);
    foreign.rulebook.ownerAccountId = id(777);
    expect(simulateRulebookVersion(i, foreign, policy(i)).result.status).toBe("Unknown");
  });

  it("keeps unknown values unknown and is deterministic", () => {
    const i = inputs([drawdown()]);
    const draft = privateDraft(i);
    const dd = draft.rules[0]!;
    if (dd.ruleType === "max_drawdown") dd.parameters.amount = { state: "unknown" };
    dd.supportStatus = "needs_setup";
    const a = simulateRulebookVersion(i, draft, policy(i));
    expect(a.result.status).toBe("Unknown");
    expect(a.result.rules[0]!.metrics).toEqual({});
    expect(JSON.stringify(simulateRulebookVersion(i, draft, policy(i)))).toBe(JSON.stringify(a));
    expect(a.result.asOf).toBe(instant);
  });
});
