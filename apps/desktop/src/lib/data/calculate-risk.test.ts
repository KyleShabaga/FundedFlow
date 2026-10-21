import { it, expect, vi } from "vitest";
import wire from "../../test/fixtures/evidence-wire.json";
import { createTauriRepository } from "./tauri-repository";
import { calculateAndSaveRisk, evaluateRisk } from "./calculate-risk";
import {
  accountRiskInputsSchema,
  canonicalEngineJson,
  defaultEnginePolicy,
  snapshotSchema,
  type EnginePolicy,
} from "@fundedflow/domain";

const nativeInputs = () => wire.find((f) => f.command === "get_account_risk_inputs")!.output as Record<string, unknown>;
const fingerprint = "a".repeat(64);

it("P0-02: native inputs survive the domain schema unchanged, so native can compare a frozen calculation with its sources", () => {
  // Promotion compares canonical(frozen inputs) with canonical(native re-read). The frozen inputs are what the engine
  // parsed, so parsing must not add, drop or reshape anything the native payload carries.
  const raw = nativeInputs();
  expect(canonicalEngineJson(accountRiskInputsSchema.parse(structuredClone(raw)))).toBe(canonicalEngineJson(raw));
});

it("captures every source with one native read and promotes with one native write", async () => {
  const input = accountRiskInputsSchema.parse(nativeInputs());
  const captured = { inputs: input, reconciliationRevisionIds: ["review-1", "resolution-1"], priorBreaches: [], sourceFingerprint: fingerprint };
  let promoted: Record<string, unknown> | undefined;
  const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === "capture_account_risk") return captured;
    if (command === "promote_account_risk") {
      promoted = args.input as Record<string, unknown>;
      return { ...promoted, id: "stored", calculatedAt: "2026-10-21T00:00:00.000Z" };
    }
    throw Error(command);
  });
  const repo = createTauriRepository(invoke);
  // Whatever a caller's policy carried for these sources is replaced by what native captured.
  const stalePolicy: EnginePolicy = { ...defaultEnginePolicy, reconciliationRevisionIds: ["from-a-cached-read"],
    priorBreaches: [{ accountId: input.account.id, rulebookVersionId: "v", assignmentId: "a", ruleKey: "k", observedAt: input.asOf, sourceReferences: ["s"] }] };
  const result = await calculateAndSaveRisk(repo, { accountId: input.account.id, asOf: input.asOf, coverage: input.coverage as never }, stalePolicy, false);
  expect(snapshotSchema.parse(result).id).toBe("stored");
  expect(invoke.mock.calls.map((c) => c[0])).toEqual(["capture_account_risk", "promote_account_risk"]);
  const policy = (promoted!.explanation as { policy: EnginePolicy }).policy;
  expect([...policy.reconciliationRevisionIds].sort()).toEqual(["resolution-1", "review-1"]);
  expect(policy.priorBreaches).toEqual([]);
  expect(canonicalEngineJson((promoted!.explanation as { inputs: unknown }).inputs)).toBe(canonicalEngineJson(input));
});

it("a native capture's unresolved review forces Unknown, and the captured object is not mutated", async () => {
  const input = accountRiskInputsSchema.parse(nativeInputs());
  const withGap = { ...input, missingInputs: [...input.missingInputs, "reconciliation_review:review-id:mismatched"] };
  const baseline = structuredClone(withGap);
  const repo = createTauriRepository(async () => { throw Error("unused"); });
  vi.spyOn(repo.evidence, "capture").mockResolvedValue({ inputs: withGap, reconciliationRevisionIds: ["review-id"], priorBreaches: [], sourceFingerprint: fingerprint });
  const promote = vi.spyOn(repo.snapshots, "promote").mockImplementation(async (s) => snapshotSchema.parse({ ...s, id: "stored", calculatedAt: input.asOf }));
  const save = vi.spyOn(repo.snapshots, "save");
  await calculateAndSaveRisk(repo, { accountId: input.account.id, asOf: input.asOf, coverage: input.coverage as never }, defaultEnginePolicy, true);
  expect(promote.mock.calls[0]![0].status).toBe("unknown");
  expect(save).not.toHaveBeenCalled();
  expect(withGap).toEqual(baseline);
});

it("a preview evaluates the captured sources and writes nothing", async () => {
  const input = accountRiskInputsSchema.parse(nativeInputs());
  const repo = createTauriRepository(async () => { throw Error("unused"); });
  vi.spyOn(repo.evidence, "capture").mockResolvedValue({ inputs: input, reconciliationRevisionIds: [], priorBreaches: [], sourceFingerprint: fingerprint });
  const promote = vi.spyOn(repo.snapshots, "promote");
  const save = vi.spyOn(repo.snapshots, "save");
  const preview = await evaluateRisk(repo, { accountId: input.account.id, asOf: input.asOf, coverage: input.coverage as never }, defaultEnginePolicy);
  expect(preview.result.accountId).toBe(input.account.id);
  expect(promote).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("refuses sources that belong to another account attempt", async () => {
  const input = accountRiskInputsSchema.parse(nativeInputs());
  const repo = createTauriRepository(async () => { throw Error("unused"); });
  vi.spyOn(repo.evidence, "capture").mockResolvedValue({ inputs: input, reconciliationRevisionIds: [], priorBreaches: [], sourceFingerprint: fingerprint });
  await expect(evaluateRisk(repo, { accountId: "another-attempt", asOf: input.asOf, coverage: input.coverage as never }, defaultEnginePolicy))
    .rejects.toMatchObject({ error: { kind: "validation" } });
});
