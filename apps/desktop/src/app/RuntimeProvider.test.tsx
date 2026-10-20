// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred, failed, initializing, ready } from "../test/runtime-fixtures";

const bridge = vi.hoisted(() => ({ status: vi.fn(), retry: vi.fn() }));
vi.mock("../lib/data/runtime", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/data/runtime")>(), runtimeGateway: bridge,
}));
import { COMMAND_TIMEOUT_MS, createRuntimeGateway, failureCategories } from "../lib/data/runtime";
import { MAX_CHECKS, RuntimeProvider, pollDelay, useRuntime } from "./RuntimeProvider";

let runtime: ReturnType<typeof useRuntime>;
const transport = vi.fn();
function Probe() {
  runtime = useRuntime();
  return <output aria-label="Runtime state">{runtime.state.kind}</output>;
}
async function tick(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers();
  transport.mockReset().mockResolvedValue(ready);
  const gateway = createRuntimeGateway(transport);
  bridge.status.mockReset().mockImplementation(gateway.status);
  bridge.retry.mockReset().mockImplementation(gateway.retry);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("checks on launch and shares one read-only bridge call under StrictMode", async () => {
  render(<StrictMode><RuntimeProvider><Probe /><Probe /></RuntimeProvider></StrictMode>);
  expect(runtime.state.kind).toBe("checking");
  await tick();
  expect(runtime.state).toEqual({ kind: "ready", status: ready });
  expect(transport.mock.calls).toEqual([["runtime_status"]]);
  await tick(60_000);
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(failureCategories)("models %s without inventing empty or ready data", async category => {
  transport.mockResolvedValue(failed(category));
  render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick();
  expect(runtime.state.kind).toBe(category === "newer_schema" ? "unsupported-schema" : "unavailable");
  expect(runtime.state.status).toEqual(failed(category));
  if (category === "newer_schema") {
    await act(async () => { await runtime.retry(); });
    expect(transport).toHaveBeenCalledTimes(1);
  }
});

it.each(["malformed", "rejected", "timeout"])("maps %s responses to unavailable", async scenario => {
  const response = deferred<unknown>();
  if (scenario === "malformed") transport.mockResolvedValue({ ...ready, failure: failed("open_failed").failure });
  if (scenario === "rejected") transport.mockRejectedValue(new Error("private diagnostics"));
  if (scenario === "timeout") transport.mockReturnValue(response.promise);
  render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick(COMMAND_TIMEOUT_MS);
  expect(runtime.state).toMatchObject({ kind: "unavailable", status: null, reason: scenario === "malformed" ? "invalid-response" : scenario });
  expect(screen.getByLabelText("Runtime state").textContent).toBe("unavailable");
  if (scenario === "timeout") {
    response.resolve(ready);
    await tick();
    expect(runtime.state.kind).toBe("unavailable");
  }
  await tick(60_000);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("backs off finitely, pauses without declaring migration failure, and recovers on explicit Retry", async () => {
  const times: number[] = [];
  transport.mockImplementation(async () => { times.push(Date.now()); return initializing; });
  render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick();
  for (let index = 0; index < MAX_CHECKS - 1; index++) {
    await tick(pollDelay(index) - 1);
    expect(transport).toHaveBeenCalledTimes(index + 1);
    await tick(1);
  }
  expect(transport).toHaveBeenCalledTimes(MAX_CHECKS);
  expect(times.slice(1).map((time, index) => time - times[index])).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  expect(runtime.state).toMatchObject({ kind: "unavailable", reason: "initialization-pending", status: initializing });
  await tick(600_000);
  expect(transport).toHaveBeenCalledTimes(MAX_CHECKS);
  transport.mockResolvedValue(ready);
  await act(async () => { await runtime.retry(); });
  expect(runtime.state.kind).toBe("ready");
  expect(transport.mock.calls[transport.mock.calls.length - 1]).toEqual(["retry_runtime"]);
});

it("deduplicates overlapping checks/retries and uses retry_runtime exactly once per recovery cycle", async () => {
  transport.mockResolvedValue(failed("open_failed"));
  render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick();
  const response = deferred<unknown>();
  transport.mockReturnValueOnce(response.promise).mockResolvedValue(ready);
  let retry!: Promise<void>;
  act(() => {
    retry = runtime.retry();
    expect(runtime.retry()).toBe(retry);
    expect(runtime.check()).toBe(retry);
  });
  expect(runtime.state.kind).toBe("recovering");
  await tick(5_000);
  expect(transport.mock.calls).toEqual([["runtime_status"], ["retry_runtime"]]);
  response.resolve(initializing);
  await tick();
  await tick(500);
  await retry;
  expect(runtime.state.kind).toBe("ready");
  expect(transport.mock.calls).toEqual([["runtime_status"], ["retry_runtime"], ["runtime_status"]]);
});

it("allows a read-only recheck after ready to detect a later failure and recover", async () => {
  render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick();
  transport.mockResolvedValue(failed("migration_failed"));
  await act(async () => { await runtime.check(); });
  expect(runtime.state.kind).toBe("unavailable");
  transport.mockResolvedValue(ready);
  await act(async () => { await runtime.retry(); });
  expect(runtime.state.kind).toBe("ready");
  expect(transport.mock.calls).toEqual([["runtime_status"], ["runtime_status"], ["retry_runtime"]]);
});

it("cancels scheduled checks on unmount and ignores late responses", async () => {
  transport.mockResolvedValue(initializing);
  let view = render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick();
  view.unmount();
  await tick(60_000);
  expect(transport).toHaveBeenCalledTimes(1);
  const response = deferred<unknown>();
  transport.mockReturnValue(response.promise);
  view = render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick();
  view.unmount();
  response.resolve(initializing);
  await tick(60_000);
  expect(transport).toHaveBeenCalledTimes(2);
});

it("blocks Retry behind a timed-out IPC, ignores late success, then allows a fresh recovery", async () => {
  const response = deferred<unknown>();
  transport.mockReturnValueOnce(response.promise).mockResolvedValue(ready);
  render(<RuntimeProvider><Probe /></RuntimeProvider>);
  await tick(COMMAND_TIMEOUT_MS);
  await act(async () => { await runtime.retry(); });
  expect(runtime.state).toMatchObject({ kind: "unavailable", reason: "pending" });
  expect(transport).toHaveBeenCalledTimes(1);
  response.resolve(ready);
  await tick();
  expect(runtime.state.kind).toBe("unavailable");
  await act(async () => { await runtime.retry(); });
  expect(runtime.state.kind).toBe("ready");
  expect(transport.mock.calls).toEqual([["runtime_status"], ["retry_runtime"]]);
});
