// @vitest-environment jsdom
// TASK-021: the version "in force today", the "not today" badge and the assignment default follow Rust's trading
// day (`list_account_freshness` `currentTradingDay`), never the calendar day, and are Unknown when it can't be read.
// Freshness rows are fixed per `asOf` in the test boundary; nothing here computes a trading day.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import type { AccountFreshnessInputs } from "../../lib/data/freshness";
import { boundary, deferredFor, freshnessRow, resetBoundaries, type FreshnessEntry } from "../../test/boundaries";
import { makeAccount } from "../accounts/test-store";
import { RulebookPage } from "./components/RulebookPage";
import { createRulebookStore } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createRulebookStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));
vi.mock("../../lib/data/freshness", async importOriginal => ({ ...(await importOriginal<object>()), freshnessGateway: (await import("../../test/boundaries")).freshnessGatewayMock }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const A = "acct-a";
/** What Rust reports for this America/New_York account (17:00 reset): Friday's reset opens Monday. Fixed rows. */
const DAYS: [from: string, day: string, next: string][] = [
  ["2026-10-20T21:00:00.000Z", "2026-10-21", "2026-10-21T21:00:00.000Z"],
  ["2026-10-21T21:00:00.000Z", "2026-10-22", "2026-10-22T21:00:00.000Z"],
  ["2026-10-22T21:00:00.000Z", "2026-10-23", "2026-10-23T21:00:00.000Z"],
  ["2026-10-23T21:00:00.000Z", "2026-10-26", "2026-10-26T21:00:00.000Z"],
];
const rustDays = (): FreshnessEntry[] => DAYS.map(([from, day, next]) => ({ from, answer: [freshnessRow(A, day, next)] }));

let client: QueryClient;
function renderRulebook() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/accounts/${A}/rulebook`]}>
          <Routes>
            <Route path="/accounts/:accountId/rulebook" element={<RulebookPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function fresh(now: string, timers: "date" | "all" = "date") {
  vi.useFakeTimers({ now: new Date(now), shouldAdvanceTime: true, toFake: timers === "all" ? ["setTimeout", "clearTimeout", "Date"] : ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 15, supportedSchemaVersion: 15, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  resetBoundaries();
  boundary.freshness.table = rustDays();
  holder.store = createRulebookStore([makeAccount({ id: A, name: "Eval A", propFirm: "Example" })]);
}
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function assignFrom(day: string) {
  await holder.store.repository.rulebooks.assign(
    { accountId: A, rulebookVersionId: holder.store.verifiedVersionId, effectiveFrom: day, programmePhaseId: null, phasePathId: null, accountPhaseEventId: null },
    { expectedOpenAssignmentId: null, actor: "local_user", reason: "Start" },
  );
}
/** A stored pre-engine calculation for `tradingDay`, with the version in force. */
function storedCalculation(tradingDay: string) {
  const snapshot = {
    id: "s1", accountId: A, rulebookVersionId: holder.store.verifiedVersionId, tradingDay, isEndOfDay: false, dataAsOf: "2026-10-23T20:00:00.000Z",
    dataSource: "csv_import", calculatedAt: "2026-10-23T20:30:00.000Z", engineVersion: "engine-test-1", inputsHash: "sha256:abc", feesIncluded: true,
    unrealizedIncluded: false, balance: "50125.5", realizedDayPnl: "125.5", unrealizedPnl: null, dailyLossLimit: null, dailyLossRemaining: null,
    drawdownMode: null, highWaterMark: null, drawdownFloor: null, drawdownHeadroom: null, drawdownLocked: false, profitTarget: null,
    tradingDaysCompleted: 1, tradingDaysRequired: null, status: "unknown", statusReasons: [], explanation: { formula: "recorded" },
  };
  holder.store.repository.snapshots.latest = async () => snapshot as never;
}
const inForce = () => screen.findByRole("region", { name: "In force today" });

describe("the version in force today is the one for Rust's trading day", () => {
  for (const [when, now] of [["Friday 22:30Z, after the 17:00 New York reset", "2026-10-23T22:30:00.000Z"], ["Saturday noon", "2026-10-24T16:00:00.000Z"]] as const) {
    it(`${when}: an assignment from Monday 2026-10-26 is in force, and a calculation for Monday is not flagged`, async () => {
      fresh(now);
      await assignFrom("2026-10-26");
      storedCalculation("2026-10-26");
      const user = userEvent.setup();
      renderRulebook();
      expect(await inForce()).toBeTruthy();
      expect(screen.queryByText("No rulebook in force today")).toBeNull();
      await user.click(screen.getByRole("tab", { name: "Calculation" }));
      expect(await screen.findByText("Recorded before the rules engine")).toBeTruthy();
      expect(screen.queryByText(/not today/)).toBeNull();
    });
  }

  it("a calculation for Friday, seen after Friday's reset, is flagged against Monday", async () => {
    fresh("2026-10-23T22:30:00.000Z");
    await assignFrom("2026-10-19");
    storedCalculation("2026-10-23");
    const user = userEvent.setup();
    renderRulebook();
    await user.click(await screen.findByRole("tab", { name: "Calculation" }));
    expect(await screen.findByText("Calculated for 2026-10-23, not today (2026-10-26)")).toBeTruthy();
  });

  it("re-reads at the trading-day boundary without a focus event: in force and the badge follow the new day", async () => {
    fresh("2026-10-23T20:59:30.000Z", "all");
    await assignFrom("2026-10-26");
    storedCalculation("2026-10-26");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderRulebook();
    expect(await screen.findByText("No rulebook in force today")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Calculation" }));
    expect(await screen.findByText("Calculated for 2026-10-26, not today (2026-10-23)")).toBeTruthy();
    const reads = boundary.freshness.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(31_000)); // past Friday 21:00Z, with no focus or visibility event
    await waitFor(() => expect(boundary.freshness.calls.length).toBeGreaterThan(reads));
    expect(Date.parse(boundary.freshness.calls[boundary.freshness.calls.length - 1])).toBeGreaterThanOrEqual(Date.parse("2026-10-23T21:00:00.000Z"));
    expect(await inForce()).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/not today/)).toBeNull());
  });

  it("re-reads when an answer sent before the boundary arrives after it, still holding the old day", async () => {
    fresh("2026-10-23T20:59:59.000Z", "all");
    const late = deferredFor<AccountFreshnessInputs[]>();
    boundary.freshness.table = [
      { from: "2000-01-01T00:00:00.000Z", answer: late.promise },
      { from: "2026-10-23T21:00:00.000Z", answer: [freshnessRow(A, "2026-10-26", "2026-10-26T21:00:00.000Z")] },
    ];
    await assignFrom("2026-10-26");
    renderRulebook();
    await waitFor(() => expect(boundary.freshness.calls).toHaveLength(1)); // asked at 20:59:59, before Friday's reset
    await act(() => vi.advanceTimersByTimeAsync(5_000)); // the answer is still on its way at 21:00:04
    await act(async () => { late.resolve([freshnessRow(A, "2026-10-23", "2026-10-23T21:00:00.000Z")]); });
    expect(await screen.findByText("No rulebook in force today")).toBeTruthy();
    // No focus or visibility event: the hook sees the row's boundary has passed and reads again.
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await waitFor(() => expect(boundary.freshness.calls.length).toBeGreaterThan(1));
    expect(await inForce()).toBeTruthy();
  });

  it("when the trading day can't be read, in force and the badge are Unknown, with no calendar-day fallback", async () => {
    fresh("2026-10-21T15:00:00.000Z");
    boundary.freshness.table = [{ from: "2000-01-01T00:00:00.000Z", answer: new Error("unavailable") }];
    await assignFrom("2026-10-19");
    storedCalculation("2026-10-20");
    const user = userEvent.setup();
    renderRulebook();
    expect(await screen.findByText("In force today: Unknown", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "In force today" })).toBeNull();
    expect(screen.queryByText("No rulebook in force today")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Calculation" }));
    expect(await screen.findByText("Today's trading day unknown")).toBeTruthy();
    // The calendar day here is 2026-10-21; it is never shown as "today".
    expect(screen.queryByText(/not today/)).toBeNull();
    expect(screen.queryByText(/2026-10-21/)).toBeNull();
  });
});

describe("assigning a version", () => {
  it("on a Saturday defaults the first trading day to Rust's Monday, and still refuses a Saturday", async () => {
    fresh("2026-10-24T16:00:00.000Z");
    const user = userEvent.setup();
    renderRulebook();
    await screen.findByText("No rulebook assigned");
    await screen.findByRole("table", { name: "Versions of Example 50K" });
    await user.click(screen.getAllByRole("button", { name: "Assign a version…" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Assign a rulebook version" });
    const day = within(dialog).getByLabelText(/First trading day/) as HTMLInputElement;
    await waitFor(() => expect(day.value).toBe("2026-10-26"));
    expect(day.type).toBe("date");
    await user.clear(day);
    await user.click(day);
    await user.paste("2026-10-24");
    await user.click(within(dialog).getByRole("button", { name: /Assign from 2026-10-24/ }));
    expect(await within(dialog).findByText(/Trading days run Monday to Friday: choose a weekday/)).toBeTruthy();
    expect(holder.store.assignments).toHaveLength(0);
  });
});
