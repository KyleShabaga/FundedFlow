// @vitest-environment jsdom
// TASK-021: Today names the rulebook in force on Rust's trading day (`list_account_freshness`), never the calendar
// day, and says Unknown when that day can't be read. Freshness rows are fixed in the test boundary.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { boundary, freshnessRow, resetBoundaries } from "../../test/boundaries";
import { ACTIVE_ACCOUNT_SETTING } from "../accounts/active-account";
import { makeAccount } from "../accounts/test-store";
import { TodayPage } from "./components/TodayPage";
import { createTodayStore } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTodayStore> }));
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
let client: QueryClient;
function renderToday() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="*" element={<p>Elsewhere</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function fresh(now: string, assignedFrom: string) {
  vi.useFakeTimers({ now: new Date(now), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  resetBoundaries();
  holder.store = createTodayStore([makeAccount({ id: A, name: "Eval A", propFirm: "Example" })]);
  holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, A);
  await holder.store.repository.rulebooks.assign(
    { accountId: A, rulebookVersionId: holder.store.verifiedVersionId, effectiveFrom: assignedFrom, programmePhaseId: null, phasePathId: null, accountPhaseEventId: null },
    { expectedOpenAssignmentId: null, actor: "local_user", reason: "Start" },
  );
}
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const accountCard = () => screen.findByRole("region", { name: "Example · Eval A" });

describe("Today's rulebook follows Rust's trading day", () => {
  it("Friday 22:30Z, after the 17:00 New York reset: the rulebook from Monday 2026-10-26 is named, with no setup warning", async () => {
    await fresh("2026-10-23T22:30:00.000Z", "2026-10-26");
    // Rust: after Friday's reset the trading day is Monday.
    boundary.freshness.table = [{ from: "2026-10-23T21:00:00.000Z", answer: [freshnessRow(A, "2026-10-26", "2026-10-26T21:00:00.000Z")] }];
    renderToday();
    const card = await accountCard();
    expect(await within(card).findByText(/Example 50K/)).toBeTruthy();
    expect(within(card).queryByText("Not set up")).toBeNull();
    expect(within(card).queryByText(/No rulebook/)).toBeNull();
  });

  it("when the trading day can't be read, the rulebook is Unknown, never a calendar-day guess", async () => {
    await fresh("2026-10-21T15:00:00.000Z", "2026-10-19");
    boundary.freshness.table = [{ from: "2000-01-01T00:00:00.000Z", answer: new Error("unavailable") }];
    renderToday();
    const card = await accountCard();
    await waitFor(() => expect(within(card).getByText("Unknown")).toBeTruthy());
    expect(within(card).queryByText(/Example 50K/)).toBeNull();
    expect(within(card).queryByText("Not set up")).toBeNull();
  });
});
