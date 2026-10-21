import { it, expect, vi } from "vitest";
import wire from "../../test/fixtures/evidence-wire.json";
import { createTauriRepository } from "./tauri-repository";
import { calculateAndSaveRisk } from "./calculate-risk";
import {
  accountRiskInputsSchema,
  calculateRiskSnapshot,
  defaultEnginePolicy,
  snapshotSchema,
  type Reconciliation,
} from "@fundedflow/domain";

it("uses existing repository reads/writes and freezes reconciliation revisions in snapshot identity", async () => {
  const input = accountRiskInputsSchema.parse(
    wire.find((f) => f.command === "get_account_risk_inputs")!.output,
  );
  const f = {
    input,
    policy: defaultEnginePolicy,
    result: calculateRiskSnapshot(input, defaultEnginePolicy, true),
  };
  let saved: Record<string, unknown> | undefined;
  const invoke = vi.fn(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "get_account_risk_inputs") return f.input;
      if (command === "list_financial_reconciliations") return [];
      if (command === "save_account_snapshot") {
        saved = args.input as Record<string, unknown>;
        return {
          ...saved,
          id: "stored",
          calculatedAt: "2026-10-21T00:00:00.000Z",
        };
      }
      throw Error(command);
    },
  );
  const repo = createTauriRepository(invoke);
  const result = await calculateAndSaveRisk(
    repo,
    {
      accountId: f.input.account.id,
      asOf: f.input.asOf,
      coverage: f.input.coverage as Parameters<
        typeof repo.evidence.inputs
      >[0]["coverage"],
    },
    f.policy,
    true,
  );
  expect(snapshotSchema.parse(result).balance).toBeNull();
  expect(saved?.inputsHash).toBe(f.result.inputsHash);
  expect(invoke.mock.calls.map((c) => c[0])).toEqual([
    "get_account_risk_inputs",
    "list_financial_reconciliations",
    "save_account_snapshot",
  ]);
});
it("unresolved reconciliation gaps force Unknown and do not mutate the fetched input object", async () => {
  const input = accountRiskInputsSchema.parse(
    wire.find((f) => f.command === "get_account_risk_inputs")!.output,
  );
  const f = {
    input,
    policy: defaultEnginePolicy,
    result: calculateRiskSnapshot(input, defaultEnginePolicy, true),
  };
  const baseline = structuredClone(f.input);
  let saved: Record<string, unknown> | undefined;
  const gap = {
    id: "review-id",
    accountId: f.input.account.id,
    observation: { id: f.input.observations[0]!.id },
    request: { asOf: f.input.asOf },
    result: { reconciliationStatus: "mismatched" },
  } as Reconciliation;
  const repo = createTauriRepository(async () => {
    throw Error("unused");
  });
  vi.spyOn(repo.evidence, "inputs").mockResolvedValue(
    f.input as Awaited<ReturnType<typeof repo.evidence.inputs>>,
  );
  vi.spyOn(repo.evidence, "reconciliations").mockResolvedValue([gap]);
  vi.spyOn(repo.evidence, "resolutions").mockResolvedValue([]);
  vi.spyOn(repo.snapshots, "save").mockImplementation(async (input) => {
    saved = input;
    return snapshotSchema.parse({
      ...input,
      id: "stored",
      calculatedAt: f.input.asOf,
    });
  });
  await calculateAndSaveRisk(
    repo,
    {
      accountId: f.input.account.id,
      asOf: f.input.asOf,
      coverage: f.input.coverage as Parameters<
        typeof repo.evidence.inputs
      >[0]["coverage"],
    },
    f.policy,
    true,
  );
  expect(saved?.status).toBe("unknown");
  expect(saved?.inputsHash).not.toBe(f.result.inputsHash);
  expect(f.input).toEqual(baseline);
});
it("a stored result is current against freshly loaded sources with its frozen policy, and not after a new review", async () => {
  const { isEngineResultCurrent } = await import("@fundedflow/domain");
  const { evaluateRisk, loadRiskCalculation } = await import("./calculate-risk");
  const input = accountRiskInputsSchema.parse(
    wire.find((f) => f.command === "get_account_risk_inputs")!.output,
  );
  const review = {
    id: "review-1",
    accountId: input.account.id,
    observation: { id: "not-current" },
    request: { asOf: input.asOf },
    result: { reconciliationStatus: "matched" },
  } as Reconciliation;
  const repo = createTauriRepository(async () => {
    throw Error("unused");
  });
  const reviews: Reconciliation[] = [review];
  vi.spyOn(repo.evidence, "inputs").mockImplementation(async () => structuredClone(input) as never);
  vi.spyOn(repo.evidence, "reconciliations").mockImplementation(async () => reviews);
  vi.spyOn(repo.evidence, "resolutions").mockResolvedValue([]);
  const save = vi.spyOn(repo.snapshots, "save");
  const query = { accountId: input.account.id, asOf: input.asOf, coverage: input.coverage as never };
  const first = await evaluateRisk(repo, query, defaultEnginePolicy);
  expect(save).not.toHaveBeenCalled();
  // The frozen policy already carries the review id; reloading must not duplicate it.
  const again = await loadRiskCalculation(repo, query, first.policy);
  expect(again.policy.reconciliationRevisionIds).toEqual(["review-1"]);
  expect(isEngineResultCurrent(first.result, again.inputs, again.policy)).toBe(true);
  reviews.push({ ...review, id: "review-2" });
  const later = await loadRiskCalculation(repo, query, first.policy);
  expect(isEngineResultCurrent(first.result, later.inputs, later.policy)).toBe(false);
});
