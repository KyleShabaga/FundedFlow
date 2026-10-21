import { it, expect, vi } from "vitest";
import { createTauriRepository } from "./tauri-repository";
import { DataControlFailure } from "./data-controls";
it("exposes data controls through the existing repository with explicit native confirmation", async () => {
  const result = {
    operationId: "op",
    state: "cleanup_pending",
    affectedEntities: { accounts: 1 },
  };
  const invoke = vi.fn(async () => result);
  const repo = createTauriRepository(invoke);
  const request = {
    scope: { kind: "account" as const, accountId: "attempt-A" },
    previewToken: "current-hash",
    confirmation: "DELETE ACCOUNT attempt-A",
  };
  expect(await repo.dataControls.deletePermanently(request)).toEqual(result);
  expect(invoke).toHaveBeenCalledWith("permanently_delete_data", { request });
  invoke.mockResolvedValueOnce(null as never);
  await repo.dataControls.retryCleanup();
  expect(invoke).toHaveBeenLastCalledWith("retry_data_cleanup", {});
});
it("preserves stable native errors and blocks missing plaintext consent before invocation", async () => {
  const invoke = vi.fn(async () => {
    throw { code: "stale_preview", message: "Inspect again" };
  });
  const repo = createTauriRepository(invoke);
  await expect(
    repo.dataControls.inspectArchive({ source: "selected.zip" }),
  ).rejects.toMatchObject({
    name: "DataControlFailure",
    error: { code: "stale_preview" },
  });
  try {
    await repo.dataControls.inspectArchive({ source: "selected.zip" });
  } catch (error) {
    expect(error).toBeInstanceOf(DataControlFailure);
  }
  invoke.mockClear();
  expect(() =>
    repo.dataControls.exportArchive({
      destination: "selected.zip",
      acknowledgePlaintext: false,
    } as never),
  ).toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
