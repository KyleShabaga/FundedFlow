// @vitest-environment jsdom
// The gate polls while the journal opens or upgrades in the background,
// shows a slow upgrade as progress (not a timeout), and shows the known
// versions and an accurate message on failure.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { RuntimeStatus } from "../lib/data/runtime";

const gateway = vi.hoisted(() => ({ status: vi.fn(), retry: vi.fn() }));
vi.mock("../lib/data/runtime", async importOriginal => ({ ...await importOriginal<typeof import("../lib/data/runtime")>(), runtimeGateway: gateway }));

import { MAX_CHECKS, POLL_MS, pollDelay, RuntimeProvider, SLOW_MS } from "../app/RuntimeProvider";
import { RuntimeGate } from "./RuntimeGate";

const base: RuntimeStatus = {
  state: "initializing",
  stage: "migrate",
  schemaVersion: 4,
  supportedSchemaVersion: 10,
  created: false,
  failure: null,
  cleanup: "clear",
};
const ready: RuntimeStatus = { ...base, state: "ready", stage: "ready", schemaVersion: 10 };
const failed: RuntimeStatus = {
  ...base,
  state: "failed",
  schemaVersion: 6,
  failure: {
    category: "migration_failed",
    retryable: true,
    message: "Upgrading your journal stopped at step 7, which was rolled back. Earlier upgrade steps were already saved, so your journal is now at version 6 (it was 4).",
    detail: "migration 7 'map_legacy_catalogue' failed",
    failedMigration: { version: 7, name: "map_legacy_catalogue", fromVersion: 4, reachedVersion: 6 },
  },
};

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows upgrade progress while initializing, backs off past the slow mark, then opens", async () => {
  gateway.status.mockResolvedValue(base);
  render(<RuntimeProvider><RuntimeGate><p>journal</p></RuntimeGate></RuntimeProvider>);
  await tick(0);
  expect(screen.getByRole("status").textContent).toContain("Upgrading your journal");

  await tick(SLOW_MS + 5_500);
  expect(screen.getByText(/taking a while/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  const polls = gateway.status.mock.calls.length;
  expect(polls).toBeGreaterThan(1);
  expect(polls).toBeLessThan(SLOW_MS / POLL_MS);

  gateway.status.mockResolvedValue(ready);
  await tick(pollDelay(polls - 1));
  expect(screen.getByText("journal")).toBeTruthy();
  await tick(POLL_MS * 4);
  expect(gateway.status.mock.calls.length).toBe(polls + 1);
});

it("shows the failure with its versions, and Retry polls the background attempt", async () => {
  gateway.status.mockResolvedValue(failed);
  render(<RuntimeProvider><RuntimeGate><p>journal</p></RuntimeGate></RuntimeProvider>);
  await tick(0);
  expect(screen.getByRole("heading").textContent).toBe("Your journal upgrade didn't finish");
  expect(screen.getByText(/now at version 6 \(it was 4\)/)).toBeTruthy();
  expect(screen.getByText("Journal version 6; this app supports 10. Stage: migrate.")).toBeTruthy();

  gateway.retry.mockResolvedValue({ ...base, stage: "migrate", schemaVersion: 6 });
  gateway.status.mockResolvedValue(ready);
  await act(async () => {
    screen.getByRole("button", { name: "Retry" }).click();
  });
  expect(gateway.retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toContain("Upgrading your journal");
  await tick(POLL_MS);
  expect(screen.getByText("journal")).toBeTruthy();
});

it("offers no retry for a newer journal", async () => {
  gateway.status.mockResolvedValue({
    ...base,
    state: "failed",
    stage: "open",
    schemaVersion: 12,
    failure: { category: "newer_schema", retryable: false, message: "Install the latest version.", detail: "12 > 10", failedMigration: null },
  });
  render(<RuntimeProvider><RuntimeGate><p>journal</p></RuntimeGate></RuntimeProvider>);
  await tick(0);
  expect(screen.getByText("Journal version 12; this app supports 10. Stage: open.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("never treats an unreachable runtime as an empty journal", async () => {
  gateway.status.mockRejectedValue(new Error("no response after 10s"));
  render(<RuntimeProvider><RuntimeGate><p>journal</p></RuntimeGate></RuntimeProvider>);
  await tick(0);
  expect(screen.getByRole("heading").textContent).toBe("FundedFlow couldn't start its local data service");
  expect(screen.queryByText("journal")).toBeNull();
});

it("pauses automatic checks without claiming a running upgrade failed, then Retry can recover", async () => {
  gateway.status.mockResolvedValue(base);
  render(<RuntimeProvider><RuntimeGate><p>journal</p></RuntimeGate></RuntimeProvider>);
  await tick(0);
  for (let index = 0; index < MAX_CHECKS - 1; index++) await tick(pollDelay(index));
  expect(screen.getByRole("heading").textContent).toBe("Local data is still initializing");
  expect(screen.getByText(/Initialization may still be running/)).toBeTruthy();
  expect(screen.queryByText("journal")).toBeNull();
  gateway.retry.mockResolvedValue(ready);
  await act(async () => { screen.getByRole("button", { name: "Retry" }).click(); });
  expect(gateway.retry).toHaveBeenCalledTimes(1);
  expect(screen.getByText("journal")).toBeTruthy();
});

it.each([
  ["pending", "Some deleted files are still on disk", /tries again each time it starts/],
  ["quarantined", "A damaged cleanup record was set aside", /data-controls-quarantine/],
] as const)("keeps a ready journal open and explains %s deletion cleanup", async (cleanup, title, body) => {
  gateway.status.mockResolvedValue({ ...ready, cleanup });
  render(<RuntimeProvider><RuntimeGate><p>journal</p></RuntimeGate></RuntimeProvider>);
  await tick(0);
  expect(screen.getByText("journal")).toBeTruthy();
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.getByText(body)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("shows no cleanup notice when cleanup is clear", async () => {
  gateway.status.mockResolvedValue(ready);
  render(<RuntimeProvider><RuntimeGate><p>journal</p></RuntimeGate></RuntimeProvider>);
  await tick(0);
  expect(screen.getByText("journal")).toBeTruthy();
  expect(screen.queryByText(/still on disk|set aside/)).toBeNull();
});
