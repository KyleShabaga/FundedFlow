// @vitest-environment jsdom
// The gate polls while the journal opens or upgrades in the background,
// shows a slow upgrade as progress (not a timeout), and shows the known
// versions and an accurate message on failure.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { RuntimeStatus } from "../lib/data/runtime";

const gateway = vi.hoisted(() => ({ status: vi.fn(), retry: vi.fn() }));
vi.mock("../lib/data/runtime", () => ({ runtimeGateway: gateway }));

import { POLL_MS, RuntimeGate, SLOW_MS } from "./RuntimeGate";

const base: RuntimeStatus = {
  state: "initializing",
  stage: "migrate",
  schemaVersion: 4,
  supportedSchemaVersion: 10,
  created: false,
  failure: null,
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

it("shows upgrade progress while initializing, keeps polling past the slow mark, then opens", async () => {
  gateway.status.mockResolvedValue(base);
  render(<RuntimeGate><p>journal</p></RuntimeGate>);
  await tick(0);
  expect(screen.getByRole("status").textContent).toContain("Upgrading your journal");

  await tick(SLOW_MS + POLL_MS);
  expect(screen.getByText(/taking a while/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  const polls = gateway.status.mock.calls.length;
  expect(polls).toBeGreaterThan(SLOW_MS / POLL_MS);

  gateway.status.mockResolvedValue(ready);
  await tick(POLL_MS);
  expect(screen.getByText("journal")).toBeTruthy();
  await tick(POLL_MS * 4);
  expect(gateway.status.mock.calls.length).toBe(polls + 1);
});

it("shows the failure with its versions, and Retry polls the background attempt", async () => {
  gateway.status.mockResolvedValue(failed);
  render(<RuntimeGate><p>journal</p></RuntimeGate>);
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
  render(<RuntimeGate><p>journal</p></RuntimeGate>);
  await tick(0);
  expect(screen.getByText("Journal version 12; this app supports 10. Stage: open.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("never treats an unreachable runtime as an empty journal", async () => {
  gateway.status.mockRejectedValue(new Error("no response after 10s"));
  render(<RuntimeGate><p>journal</p></RuntimeGate>);
  await tick(0);
  expect(screen.getByRole("heading").textContent).toBe("FundedFlow couldn't start its local data service");
  expect(screen.queryByText("journal")).toBeNull();
});
