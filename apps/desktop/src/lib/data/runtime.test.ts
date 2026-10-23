import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupStates, COMMAND_TIMEOUT_MS, createRuntimeGateway, failureCategories, runtimeStatusSchema } from "./runtime";
import { deferred, failed, initializing, ready } from "../../test/runtime-fixtures";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("sends only the read-only status and explicit initialization command, validating both replies", async () => {
  const transport = vi.fn().mockResolvedValueOnce(initializing).mockResolvedValueOnce(ready);
  const gateway = createRuntimeGateway(transport);
  expect(await gateway.status()).toEqual(initializing);
  expect(await gateway.retry()).toEqual(ready);
  expect(transport.mock.calls).toEqual([["runtime_status"], ["retry_runtime"]]);
});

it.each(failureCategories)("accepts the backend's %s failure contract", category => {
  expect(runtimeStatusSchema.parse(failed(category))).toEqual(failed(category));
});

it("accepts a non-retryable data_folder_link failure at the data-folder stage (TASK-018)", () => {
  const status = { ...failed("data_folder_link"), schemaVersion: null };
  expect(status.stage).toBe("data_directory");
  expect(status.failure?.retryable).toBe(false);
  expect(runtimeStatusSchema.parse(status)).toEqual(status);
});

it.each([
  null, {}, { ...ready, state: "unknown" }, { ...ready, stage: "unknown" },
  { ...ready, schemaVersion: -1 }, { ...ready, schemaVersion: null },
  { ...ready, schemaVersion: 14 }, { ...ready, failure: failed("open_failed").failure },
  { ...ready, stage: "open" }, { ...initializing, failure: failed("open_failed").failure },
  { ...failed("open_failed"), failure: null },
  { ...failed("open_failed"), stage: "migrate" },
  { ...failed("open_failed"), created: true },
  { ...failed("migration_failed"), failure: { ...failed("migration_failed").failure, failedMigration: null } },
  { ...failed("newer_schema"), failure: { ...failed("newer_schema").failure, retryable: true } },
  // TASK-018: a linked data folder fails at the data-folder stage and is never retryable.
  { ...failed("data_folder_link"), failure: { ...failed("data_folder_link").failure, retryable: true } },
  { ...failed("data_folder_link"), stage: "open" },
  { ...ready, cleanup: undefined }, { ...ready, cleanup: "unknown" }, { ...ready, cleanup: null },
])("rejects malformed or contradictory status %j for both commands", async reply => {
  const gateway = createRuntimeGateway(vi.fn().mockResolvedValue(reply));
  await expect(gateway.status()).rejects.toMatchObject({ kind: "invalid-response" });
  await expect(gateway.retry()).rejects.toMatchObject({ kind: "invalid-response" });
});

it("maps bridge rejections and synchronous throws without leaking their details", async () => {
  for (const transport of [vi.fn().mockRejectedValue("private SQL details"), vi.fn(() => { throw new Error("private path"); })]) {
    const gateway = createRuntimeGateway(transport);
    await expect(gateway.status()).rejects.toMatchObject({ kind: "rejected", message: "The local runtime command could not be completed." });
    await expect(gateway.retry()).rejects.toMatchObject({ kind: "rejected" });
  }
});

it("coalesces same-command requests and blocks a different command until settlement", async () => {
  const response = deferred<unknown>();
  const transport = vi.fn().mockReturnValue(response.promise);
  const gateway = createRuntimeGateway(transport);
  const first = gateway.status();
  expect(gateway.status()).toBe(first);
  await expect(gateway.retry()).rejects.toMatchObject({ kind: "pending" });
  response.resolve(ready);
  expect(await first).toEqual(ready);
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(["status", "retry"] as const)("bounds %s without overlapping the uncancellable IPC or applying late results", async method => {
  const response = deferred<unknown>();
  const transport = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue(ready);
  const gateway = createRuntimeGateway(transport);
  const first = gateway[method]();
  const rejected = expect(first).rejects.toMatchObject({ kind: "timeout" });
  await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS);
  await rejected;
  await expect(gateway.status()).rejects.toMatchObject({ kind: "pending" });
  await expect(gateway.retry()).rejects.toMatchObject({ kind: "pending" });
  expect(transport).toHaveBeenCalledTimes(1);
  response.resolve(ready);
  await vi.advanceTimersByTimeAsync(0);
  expect(await gateway.retry()).toEqual(ready);
  expect(transport.mock.calls[1]).toEqual(["retry_runtime"]);
});

it.each(cleanupStates)("accepts a ready journal whose deletion cleanup is %s, and any state with it", cleanup => {
  for (const status of [{ ...ready, cleanup }, { ...initializing, cleanup }, { ...failed("open_failed"), cleanup }]) {
    expect(runtimeStatusSchema.parse(status)).toEqual(status);
  }
});
