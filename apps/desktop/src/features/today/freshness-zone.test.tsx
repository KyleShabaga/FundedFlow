// @vitest-environment jsdom
// P0-D05 through the real Today page: the last trade, the last import and the check time follow the display time
// zone (Settings → Date and time); everything in the account's zone, and the stored data, stays as it was.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { ACTIVE_ACCOUNT_SETTING } from "../accounts/active-account";
import { makeAccount } from "../accounts/test-store";
import { closedTrade } from "../rulebooks/test-store";
import { DISPLAY_TIME_ZONE_SETTING } from "../settings/display-time-zone";
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
// 23:13 UTC: already the next day in Tokyo, still the same day in New York (the account's zone).
const NOW = "2026-10-21T23:13:30.000Z";
const IMPORTED = "2026-10-21T23:05:00.000Z";
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
const panel = () => screen.findByRole("region", { name: "How fresh this is" });
const row = (fresh: HTMLElement, label: string) => within(fresh).getByText(label).closest(".ds-stats-row") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  holder.store = createTodayStore([makeAccount({ id: A, name: "Eval A", timezone: "America/New_York" })]);
  holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, A);
  holder.store.trades.set(A, [closedTrade(A, 1, "125.5", "2026-10-21")]); // exit 15:01 UTC
  holder.store.imports.set(A, [{
    id: "batch-1", accountId: A, fileName: "fills.csv", fileSha256: "a".repeat(64), fileSize: 10, sourceFormat: "performance", status: "committed",
    rowCount: 1, importedCount: 1, skippedCount: 0, duplicateCount: 0, failedCount: 0, warningCount: 0, errorSummary: null,
    createdAt: IMPORTED, completedAt: IMPORTED,
  } as never]);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("display time zone on the freshness panel", () => {
  it("converts all three times, dates included, to the chosen zone and updates when the choice changes", async () => {
    holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "Asia/Tokyo" });
    renderToday();
    const fresh = await panel();
    await within(fresh).findByText(/Checked against your records at Oct 22, 08:13 GMT\+9/);
    await waitFor(() => expect(row(fresh, "Last trade recorded").textContent).toContain("Oct 22, 2026, 00:01 GMT+9"));
    expect(row(fresh, "Last import").textContent).toContain("Oct 22, 2026, 08:05 GMT+9");
    // The trading day stays the account's, labelled with the account's zone.
    await waitFor(() => expect(row(fresh, "Trading day now").textContent).toContain("America/New_York"));
    const day = row(fresh, "Trading day now").textContent;
    expect(fresh.textContent).toContain("Last trade, last import and the check time show in Asia/Tokyo.");

    const before = JSON.stringify({ trades: holder.store.trades.get(A), imports: holder.store.imports.get(A) });
    holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "America/Los_Angeles" });
    await act(() => client.invalidateQueries());
    await within(fresh).findByText(/Checked against your records at Oct 21, 16:13 GMT-7/);
    expect(row(fresh, "Last trade recorded").textContent).toContain("Oct 21, 2026, 08:01 GMT-7");
    expect(row(fresh, "Last import").textContent).toContain("Oct 21, 2026, 16:05 GMT-7");
    expect(row(fresh, "Trading day now").textContent).toBe(day);
    // Reformatting is not a new check and changes no stored instant.
    expect(JSON.stringify({ trades: holder.store.trades.get(A), imports: holder.store.imports.get(A) })).toBe(before);
  });

  it("uses the computer's zone when nothing is saved", async () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...original.call(this), timeZone: "Europe/London" };
    });
    renderToday();
    const fresh = await panel();
    await within(fresh).findByText(/Checked against your records at Oct 22, 00:13 GMT\+1/);
    expect(fresh.textContent).toContain("Europe/London (this computer's time zone)");
  });

  it("keeps empty states as they are", async () => {
    holder.store.settings.set(DISPLAY_TIME_ZONE_SETTING, { mode: "zone", zone: "Asia/Tokyo" });
    holder.store.trades.set(A, []);
    holder.store.imports.set(A, []);
    renderToday();
    const fresh = await panel();
    await within(fresh).findByText("No trades yet");
    await within(fresh).findByText("No imports yet");
  });
});
