// @vitest-environment jsdom
// P0-D22 through the real Today page: "How fresh this is" starts closed with the check time in its header, opens and
// closes from the header only, keeps the choice through refreshes and account changes, reads nothing when toggled,
// and keeps what needs attention visible while closed.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { ACTIVE_ACCOUNT_SETTING } from "../accounts/active-account";
import { makeAccount } from "../accounts/test-store";
import { closedTrade } from "../rulebooks/test-store";
import { DISPLAY_TIME_ZONE_SETTING } from "../settings/display-time-zone";
import { resetFreshnessDetails } from "./components/FreshnessPanel";
import { TodayPage } from "./components/TodayPage";
import { createTodayStore } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTodayStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const A = "acct-a";
const B = "acct-b";
const NOW = "2026-10-21T18:00:00.000Z";
let client: QueryClient;

function renderToday() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes><Route path="/" element={<TodayPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
const importBatch = (accountId: string, fileName: string, status: "committed" | "failed") => ({
  id: `batch-${accountId}`, accountId, fileName, fileSha256: "a".repeat(64), fileSize: 10, sourceFormat: "performance", status,
  rowCount: 1, importedCount: status === "failed" ? 0 : 1, skippedCount: 0, duplicateCount: 0, failedCount: status === "failed" ? 1 : 0, warningCount: 0,
  errorSummary: null, createdAt: "2026-10-21T17:30:00.000Z", completedAt: "2026-10-21T17:30:01.000Z",
}) as never;
const panel = () => screen.findByRole("region", { name: "How fresh this is" });
const toggleOf = (fresh: HTMLElement) => within(fresh).getByRole("button", { name: /How fresh this is/ });
const bodyOf = (fresh: HTMLElement) => document.getElementById(toggleOf(fresh).getAttribute("aria-controls")!)!;

beforeEach(() => {
  resetFreshnessDetails();
  vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  holder.store = createTodayStore([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })]);
  holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, A);
  holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "America/New_York" });
  holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21")]);
  holder.store.imports.set(A, [importBatch(A, "a-fills.csv", "committed")]);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("collapsible freshness details", () => {
  it("starts closed with the check time in the header, and opens downward from the header button", async () => {
    const user = userEvent.setup();
    renderToday();
    const fresh = await panel();
    const toggle = toggleOf(fresh);
    await waitFor(() => expect(toggle.textContent).toContain("Checked against your records at Oct 21, 14:00 GMT-4"));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(bodyOf(fresh).hasAttribute("inert")).toBe(true);
    // Every detail is still there, only closed: rows, links and missing-data messages.
    expect(bodyOf(fresh).textContent).toContain("Last firm checkpoint");
    expect(bodyOf(fresh).textContent).toContain("None recorded");

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(bodyOf(fresh).hasAttribute("inert")).toBe(false);
    await within(fresh).findByRole("link", { name: /ES exit/ });
    expect(within(fresh).getByText("History completeness")).toBeTruthy();
  });

  it("reads nothing and changes no time when toggled", async () => {
    const user = userEvent.setup();
    renderToday();
    const fresh = await panel();
    await within(fresh).findByText(/a-fills\.csv/);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const header = toggleOf(fresh).textContent;
    const capture = vi.spyOn(holder.store.repository.evidence as unknown as { capture: () => unknown }, "capture");
    const history = vi.spyOn(holder.store.repository.imports, "list");
    vi.setSystemTime(new Date(Date.parse(NOW) + 5 * 60_000));
    await user.click(toggleOf(fresh));
    await user.click(toggleOf(fresh));
    await user.click(toggleOf(fresh));
    expect(client.isFetching()).toBe(0);
    expect(capture).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(toggleOf(fresh).textContent).toBe(header);
  });

  it("keeps the choice through Check again and an account change, without the previous account's details", async () => {
    const user = userEvent.setup();
    holder.store.imports.set(B, [importBatch(B, "b-fills.csv", "committed")]);
    renderToday();
    let fresh = await panel();
    await user.click(toggleOf(fresh));
    vi.setSystemTime(new Date(Date.parse(NOW) + 2 * 60_000));
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(toggleOf(fresh).textContent).toContain("14:02"));
    expect(toggleOf(fresh).getAttribute("aria-expanded")).toBe("true");

    holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, B);
    await act(() => client.invalidateQueries());
    await waitFor(async () => expect((await panel()).textContent).toContain("b-fills.csv"));
    fresh = await panel();
    expect(fresh.textContent).not.toContain("a-fills.csv");
    expect(toggleOf(fresh).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps what needs attention visible while closed", async () => {
    const user = userEvent.setup();
    holder.store.imports.set(A, [importBatch(A, "bad.csv", "failed")]);
    renderToday();
    const fresh = await panel();
    const attention = await within(fresh).findByRole("list", { name: "Needs attention" });
    expect(attention.textContent).toContain("The last import failed");
    expect(bodyOf(fresh).contains(attention)).toBe(false);
    // Open, the row itself says it, so the summary line goes.
    await user.click(toggleOf(fresh));
    expect(within(fresh).queryByRole("list", { name: "Needs attention" })).toBeNull();
    expect(within(bodyOf(fresh)).getByText("Failed")).toBeTruthy();
  });
});
