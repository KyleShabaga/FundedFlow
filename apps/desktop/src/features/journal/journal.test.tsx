// @vitest-environment jsdom
// Build 20 journeys through the real Journal, Trade detail and Library pages, Build 13 components and Build 14 hooks.
// The repository is an in-memory store (test-store.ts); persistence, P&L and snapshots are tested in Rust.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { JournalPage } from "./components/JournalPage";
import { TradeDetailPage } from "./components/TradeDetailPage";
import { createJournalStore, pngBytes, trade } from "./test-store";

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
    roundTrip: { buyFillId: "9001", sellFillId: "9002", buyPrice: "29774.25", sellPrice: "29787.25", boughtAt: "2026-10-20T13:30:00.000Z", soldAt: "2026-10-20T13:31:00.000Z",
      boughtAtSource: "10/20/2026 09:30:00", soldAtSource: "10/20/2026 09:31:00", durationSource: "1min", durationSeconds: 60, priceFormat: "-2", priceFormatType: "0", tickSize: "0.25", entryBasis: "buy_first" } }),
  trade({ id: "t4", accountId: A, symbol: "XYZ", entryAt: "2026-10-20T15:00:00.000Z", exitAt: "2026-10-20T15:05:00.000Z", tradingDay: "2026-10-20", realizedPnl: null, grossPnl: null, pnlStatus: "missing_instrument" }),
  // Same instant and symbol in another account: never shown or linked here.
  trade({ id: "tb", accountId: B, symbol: "ESZ6", entryAt: "2026-10-19T13:30:00.000Z", exitAt: "2026-10-19T14:00:00.000Z", tradingDay: "2026-10-19", realizedPnl: "1000" }),
];

beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
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

async function chooseOption(user: ReturnType<typeof userEvent.setup>, label: RegExp | string, option: RegExp | string, scope: HTMLElement = document.body) {
  await user.click(within(scope).getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("Journal", () => {
  it("asks for an account instead of guessing one", async () => {
    holder.store = createJournalStore(accounts(), seed(), null);
    renderAt("/journal");
    expect(await screen.findByText("Choose an account")).toBeTruthy();
  });

  it("groups by stored trading day with the latest day open, and leaves unknown P&L out of sums", async () => {
    const user = userEvent.setup();
    renderAt("/journal");
    const latest = await screen.findByRole("article", { name: "Tue, Oct 20, 2026" });
    const earlier = screen.getByRole("article", { name: "Mon, Oct 19, 2026" });
    const toggle = (day: HTMLElement) => within(day).getAllByRole("button")[0];
    expect(toggle(latest).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(earlier).getAttribute("aria-expanded")).toBe("false");
    // Oct 20: +26 known, one trade with no instrument named and left out.
    expect(within(latest).getByText("1 trade without a known P&L is not in the P&L figures.", { exact: false })).toBeTruthy();
    const table = within(latest).getByRole("table", { name: /Trades on/ });
    expect(within(table).getByText("Imported")).toBeTruthy();
    expect(within(table).getByText("Manual")).toBeTruthy();
    expect(within(table).getByText("No instrument")).toBeTruthy();
    await user.click(toggle(earlier));
    expect(toggle(earlier).getAttribute("aria-expanded")).toBe("true");
    const day19 = within(earlier).getByRole("table", { name: /Trades on/ });
    expect(within(day19).getAllByRole("row")).toHaveLength(3); // header + 2 trades of account A only
    expect(within(earlier).getByText("+$42.00")).toBeTruthy(); // 96 − 54, exact
  });

  it("filters, searches, sorts and pages the trade log, and opens a trade from the keyboard", async () => {
    const user = userEvent.setup();
    renderAt("/journal?view=log");
    const table = await screen.findByRole("table", { name: "Trade log" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /^Losses/ }));
    expect(within(screen.getByRole("table", { name: "Trade log" })).getAllByRole("row")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search trades" }), "mnq");
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Trade log" })).getAllByRole("row")).toHaveLength(2));
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    // Sort by net P&L, largest first; unknown P&L sorts last.
    await user.click(screen.getByRole("button", { name: "Net P&L" }));
    const symbols = () => within(screen.getByRole("table", { name: "Trade log" })).getAllByRole("rowheader").map(c => c.textContent);
    await waitFor(() => expect(symbols()[0]).toBe("ESZ6"));
    expect(symbols()[symbols().length - 1]).toBe("XYZ");
    const row = within(screen.getByRole("table", { name: "Trade log" })).getByRole("rowheader", { name: "NQZ6" }).closest("tr")!;
    row.focus();
    await user.keyboard("{Enter}");
    expect(location).toBe("/journal/trades/t2");
  });

  it("adds a manual trade without any import, in the account's time zone, and opens it for review", async () => {
    const user = userEvent.setup();
    renderAt("/journal");
    await user.click(await screen.findByRole("button", { name: "Add trade" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a manual trade" });
    await user.type(within(dialog).getByLabelText(/^Symbol/), "esz6");
    fireEvent.change(within(dialog).getByLabelText(/^Entry time/), { target: { value: "2026-10-21T09:30" } });
    await user.type(within(dialog).getByLabelText(/^Entry price/), "5000");
    fireEvent.change(within(dialog).getByLabelText(/^Exit time/), { target: { value: "2026-10-21T09:45" } });
    await user.type(within(dialog).getByLabelText(/^Exit price/), "5004");
    await user.type(within(dialog).getByLabelText(/^Fees/), "4.12");
    await user.click(within(dialog).getByRole("button", { name: "Add trade" }));
    await waitFor(() => expect(location).toMatch(/^\/journal\/trades\/trade-/));
    const create = holder.store.calls.find(c => c.method === "trades.create")!.args[0] as Record<string, unknown>;
    // 09:30 New York (EDT) is 13:30 UTC; P&L is left to the backend.
    expect(create).toMatchObject({ accountId: A, symbol: "ESZ6", entryAt: "2026-10-21T13:30:00.000Z", exitAt: "2026-10-21T13:45:00.000Z", fees: "4.12" });
    expect(create).not.toHaveProperty("grossPnl");
    expect(await screen.findByRole("heading", { name: "ESZ6" })).toBeTruthy();
  });

  it("asks before discarding a dirty trade form", async () => {
    const user = userEvent.setup();
    renderAt("/journal");
    await user.click(await screen.findByRole("button", { name: "Add trade" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a manual trade" });
    await user.type(within(dialog).getByLabelText(/^Symbol/), "ES");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alertdialog", { name: "Discard this trade?" })).toBeTruthy();
  });
});

describe("Trade detail", () => {
  it("shows stored values, import provenance and source fills read only, with previous and next", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t3");
    expect(await screen.findByRole("heading", { name: "MNQZ6" })).toBeTruthy();
    const summary = screen.getByLabelText("Trade summary");
    expect(within(summary).getAllByText("+$26.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Source fills" })).toBeTruthy();
    expect(screen.getByText(/10\/20\/2026 09:30:00/)).toBeTruthy();
    expect(screen.getByText("Original CSV row (unchanged)")).toBeTruthy();
    expect(screen.queryByText(/candle/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Previous trade" }));
    await waitFor(() => expect(location).toBe("/journal/trades/t2"));
  });

  it("never shows another account's trade", async () => {
    renderAt("/journal/trades/tb");
    expect(await screen.findByText("This trade isn't in the selected account")).toBeTruthy();
  });

  it("corrects a trade against the revision it opened", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    await user.click(await screen.findByRole("button", { name: "Correct trade" }));
    const dialog = await screen.findByRole("dialog", { name: /Correct ESZ6 trade/ });
    const fees = within(dialog).getByLabelText(/^Fees/);
    await user.clear(fees);
    await user.type(fees, "6");
    await user.type(within(dialog).getByLabelText(/^Reason/), "statement");
    await user.click(within(dialog).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Correct ESZ6/ })).toBeNull());
    const [, input, options] = holder.store.calls.find(c => c.method === "trades.update")!.args as [string, Record<string, unknown>, Record<string, unknown>];
    expect(options).toEqual({ expectedUpdatedAt: "2026-10-20T15:00:00.000Z", reason: "statement" });
    // Untouched times keep the stored instant exactly.
    expect(input.entryAt).toBe("2026-10-19T13:30:00.000Z");
    expect(await screen.findByText("“statement”")).toBeTruthy();
  });
});

describe("Review", () => {
  async function seedLibrary() {
    const lib = holder.store.repository.library;
    const s = await lib.saveStrategy(null, { name: "ORB", description: null });
    const setup = await lib.saveTag(null, { name: "Opening drive", kind: "setup" });
    const mistake = await lib.saveTag(null, { name: "Chased", kind: "mistake" });
    const c = await lib.saveChecklist(null, { name: "ORB entry", scope: "trade", strategyId: s.id, description: null, items: [{ label: "Waited for range" }, { label: "Stop below range" }] });
    return { s, setup, mistake, c };
  }

  it("saves notes, rating, strategy, checklist answers and tags, with process and outcome apart", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    renderAt("/journal/trades/t1");
    const card = await screen.findByRole("region", { name: "Review" });
    await within(card).findByRole("combobox", { name: "Strategy" });
    await chooseOption(user, "Strategy", "ORB", card);
    await chooseOption(user, "Checklist", "ORB entry", card);
    const first = within(card).getByRole("group", { name: "Waited for range" });
    await user.click(within(first).getByRole("radio", { name: "Followed" }));
    await user.click(within(within(card).getByRole("group", { name: "Stop below range" })).getByRole("radio", { name: "Missed" }));
    await user.click(within(within(card).getByRole("group", { name: "Mistakes" })).getByRole("button", { name: "Chased" }));
    await user.click(within(within(card).getByRole("group", { name: "Execution rating" })).getByRole("radio", { name: "4" }));
    await user.type(within(card).getByLabelText(/^Notes and reflection/), "Entered late.");
    await user.click(within(card).getByRole("checkbox", { name: /Reviewed/ }));
    await user.click(within(card).getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(holder.store.reviews.get("t1")?.revision).toBe(1));
    const saved = holder.store.calls.find(c => c.method === "reviews.save")!.args[0] as Record<string, unknown>;
    expect(saved).toMatchObject({ accountId: A, tradeId: "t1", expectedRevision: null, executionRating: 4, reviewed: true, reflection: "Entered late." });
    expect((saved.checklistResults as unknown[]).length).toBe(2);
    expect(await within(card).findByText("1 of 2 checklist items followed")).toBeTruthy();
    expect(within(card).getByText("Outcome")).toBeTruthy();
  });

  it("shows the label a review recorded after the strategy is renamed", async () => {
    const { s } = await seedLibrary();
    await holder.store.repository.reviews.save({ accountId: A, tradeId: "t1", expectedRevision: null, strategyId: s.id, checklistId: null, reviewed: true, tagIds: [], checklistResults: [] });
    await holder.store.repository.library.saveStrategy(s.id, { name: "Opening range breakout", description: null });
    renderAt("/journal/trades/t1");
    expect(await screen.findByText("Recorded as “ORB”; now called “Opening range breakout”.")).toBeTruthy();
  });

  it("reports a stale review as a conflict and keeps the edits", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    const card = await screen.findByRole("region", { name: "Review" });
    await user.type(await within(card).findByLabelText(/^Notes and reflection/), "mine");
    // Someone else saves first.
    await act(() => holder.store.repository.reviews.save({ accountId: A, tradeId: "t1", expectedRevision: null, reflection: "theirs", reviewed: false, tagIds: [], checklistResults: [] }));
    await user.click(within(card).getByRole("button", { name: "Save review" }));
    expect(await within(card).findByText("This review changed after you opened it")).toBeTruthy();
    expect(holder.store.reviews.get("t1")?.reflection).toBe("theirs");
  });

  it("asks before leaving with unsaved review edits", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    const card = await screen.findByRole("region", { name: "Review" });
    await user.type(await within(card).findByLabelText(/^Plan and thesis/), "plan");
    await user.click(screen.getAllByRole("link", { name: "Journal" })[0]);
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).toBeTruthy();
    expect(location).toBe("/journal/trades/t1");
  });
});

describe("Screenshots", () => {
  it("attaches a picked image, shows it, and reports a rejected file without touching the notes", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    const card = await screen.findByRole("region", { name: "Review" });
    await user.type(await within(card).findByLabelText(/^Notes and reflection/), "keep me");
    const input = card.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([pngBytes(1)], "entry.png", { type: "image/png" }));
    expect(await within(card).findByRole("img", { name: "Screenshot entry.png" })).toBeTruthy();
    // A file whose bytes aren't an image is refused by the backend; the notes stay.
    await user.upload(input, new File([new Uint8Array([1, 2, 3])], "fake.png", { type: "image/png" }));
    expect(await within(card).findByText("Some images weren't attached")).toBeTruthy();
    expect((within(card).getByLabelText(/^Notes and reflection/) as HTMLTextAreaElement).value).toBe("keep me");
    // Over 10 MB is refused before reading.
    await user.upload(input, new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }));
    expect(await within(card).findByText(/huge\.png: It is 10 MB; screenshots can be at most 10 MB\./)).toBeTruthy();
  });

  it("shows a missing file as missing, not as a broken journal", async () => {
    await holder.store.repository.reviews.addScreenshot({ accountId: A, tradeId: "t1", fileName: "a.png", dataBase64: "iVBORw0KGgoAAAA" });
    const [id] = [...holder.store.files.keys()];
    holder.store.files.get(id)!.status = "missing";
    renderAt("/journal/trades/t1");
    expect(await screen.findByRole("img", { name: /a\.png: The image file is missing/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Summary" })).toBeTruthy();
  });
});

describe("Library", () => {
  it("is a Journal sub-view that creates playbooks and archives tags without deleting them", async () => {
    const user = userEvent.setup();
    await holder.store.repository.library.saveTag(null, { name: "FOMO", kind: "emotion" });
    renderAt("/journal?view=library&section=playbooks");
    await user.click(await screen.findByRole("button", { name: "New playbook" }));
    const dialog = await screen.findByRole("dialog", { name: "New playbook" });
    await user.type(within(dialog).getByLabelText(/^Name/), "VWAP pullback");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("VWAP pullback")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Tags/ }));
    const mindset = await screen.findByRole("region", { name: "Mindset" });
    await user.click(within(mindset).getByRole("button", { name: "Archive" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(holder.store.tags.get([...holder.store.tags.keys()][0])!.archived).toBe(true));
    expect(holder.store.tags.size).toBe(1);
  });

  it("edits a checklist's items in order and archives removed items", async () => {
    const user = userEvent.setup();
    const c = await holder.store.repository.library.saveChecklist(null, { name: "Entry", scope: "trade", description: null, items: [{ label: "One" }, { label: "Two" }] });
    renderAt("/journal?view=library&section=templates");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Entry" });
    await user.click(within(dialog).getByRole("button", { name: "Move item 2 up" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove item 2" }));
    await user.click(within(dialog).getByRole("button", { name: "Save checklist" }));
    await waitFor(() => expect(holder.store.checklists.get(c.id)!.items.filter(i => !i.archived).map(i => i.label)).toEqual(["Two"]));
    expect(holder.store.checklists.get(c.id)!.items.find(i => i.label === "One")!.archived).toBe(true);
  });
});
