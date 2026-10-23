// @vitest-environment jsdom
// Previous/Next trade are buttons that navigate in code; with unsaved review edits they ask first, as links do.
// The repository is an in-memory store (test-store.ts).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { JournalPage } from "./components/JournalPage";
import { TradeDetailPage } from "./components/TradeDetailPage";
import { createJournalStore, trade } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createJournalStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

let client: QueryClient;
let location = "";
function Where() {
  const l = useLocation();
  location = l.pathname + l.search;
  return null;
}
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Routes>
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/journal/trades/:tradeId" element={<TradeDetailPage />} />
            <Route path="/accounts" element={<p>Accounts page</p>} />
            <Route path="/import" element={<p>Import page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const A = "acct-a";
const B = "acct-b";
const accounts = () => [makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })];
const seed = () => [
  trade({ id: "t1", accountId: A, symbol: "ESZ6", entryAt: "2026-10-19T13:30:00.000Z", exitAt: "2026-10-19T14:00:00.000Z", tradingDay: "2026-10-19", realizedPnl: "96", grossPnl: "100", fees: "4" }),
  trade({ id: "t2", accountId: A, symbol: "NQZ6", side: "short", entryAt: "2026-10-19T15:00:00.000Z", exitAt: "2026-10-19T15:10:00.000Z", tradingDay: "2026-10-19", realizedPnl: "-54", grossPnl: "-50", fees: "4" }),
  trade({ id: "t3", accountId: A, symbol: "MNQZ6", source: "csv_import", importBatchId: "batch", entryAt: "2026-10-20T13:30:00.000Z", exitAt: "2026-10-20T13:31:00.000Z", tradingDay: "2026-10-20", realizedPnl: "26", grossPnl: "26", fees: "0",
    roundTrip: { buyFillId: "9001", sellFillId: "9002", buyPrice: "24387.25", sellPrice: "24400.25", boughtAt: "2026-10-20T13:30:00.000Z", soldAt: "2026-10-20T13:31:00.000Z",
      boughtAtSource: "10/20/2026 09:30:00", soldAtSource: "10/20/2026 09:31:00", durationSource: "1min", durationSeconds: 60, priceFormat: "-2", priceFormatType: "0", tickSize: "0.25", entryBasis: "buy_first" } }),
  trade({ id: "t4", accountId: A, symbol: "XYZ", entryAt: "2026-10-20T15:00:00.000Z", exitAt: "2026-10-20T15:05:00.000Z", tradingDay: "2026-10-20", realizedPnl: null, grossPnl: null, pnlStatus: "missing_instrument" }),
  // Same instant and symbol in another account: never shown or linked here.
  trade({ id: "tb", accountId: B, symbol: "ESZ6", entryAt: "2026-10-19T13:30:00.000Z", exitAt: "2026-10-19T14:00:00.000Z", tradingDay: "2026-10-19", realizedPnl: "1000" }),
];

beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createJournalStore(accounts(), seed());
  try { sessionStorage.clear(); } catch { /* jsdom has it */ }
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const leavePrompt = () => screen.queryByRole("alertdialog", { name: "Leave without saving the review?" });
const thesis = /^Plan and thesis/;

describe("Previous/Next trade with unsaved review edits", () => {
  for (const button of ["Previous trade", "Next trade"]) {
    it(`asks before ${button} leaves, and Cancel stays with the edits`, async () => {
      const user = userEvent.setup();
      renderAt("/journal/trades/t2");
      const card = await screen.findByRole("region", { name: "Review" });
      await user.type(await within(card).findByLabelText(thesis), "plan");
      await user.click(screen.getByRole("button", { name: button }));
      const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
      expect(location).toBe("/journal/trades/t2");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(leavePrompt()).toBeNull());
      expect(location).toBe("/journal/trades/t2");
      expect((within(card).getByLabelText(thesis) as HTMLTextAreaElement).value).toBe("plan");
    });
  }

  it("leaves on confirm, opens the other trade clean, and keeps the draft for its own trade", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t2");
    let card = await screen.findByRole("region", { name: "Review" });
    await user.type(await within(card).findByLabelText(thesis), "plan");
    await user.click(screen.getByRole("button", { name: "Next trade" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(location).not.toBe("/journal/trades/t2"));
    const other = location;
    card = await screen.findByRole("region", { name: "Review" });
    expect((await within(card).findByLabelText(thesis) as HTMLTextAreaElement).value).toBe("");
    expect(within(card).queryByText("You have unsaved edits from earlier")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Previous trade" }));
    expect(leavePrompt()).toBeNull();
    await waitFor(() => expect(location).toBe("/journal/trades/t2"));
    expect(other).not.toBe(location);
    expect(await screen.findByText("You have unsaved edits from earlier")).toBeTruthy();
  });

  it("moves at once when the review has no unsaved edits", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t2");
    await screen.findByRole("region", { name: "Review" });
    await user.click(screen.getByRole("button", { name: "Next trade" }));
    expect(leavePrompt()).toBeNull();
    await waitFor(() => expect(location).not.toBe("/journal/trades/t2"));
  });
});
