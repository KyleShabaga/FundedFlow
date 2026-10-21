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
