// @vitest-environment jsdom
// Build 22 journeys through the real daily review screen, Journal By day and Library, Build 13 components and Build 14
// hooks. The repository is the in-memory journal store with the daily-review fake (test-store.ts); persistence,
// trading days, session windows and adherence are tested in Rust (store/daily_review_tests.rs).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { JournalPage } from "../journal/components/JournalPage";
import { createJournalStore, trade } from "../journal/test-store";
import { DailyReviewPage } from "./components/DailyReviewPage";

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
            <Route path="/journal/days/:tradingDay" element={<DailyReviewPage />} />
            <Route path="/journal/trades/:tradeId" element={<p>Trade page</p>} />
            <Route path="/accounts" element={<p>Accounts page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
const dayPath = (day: string, account = A) => `/journal/days/${day}?account=${account}`;

const A = "acct-a";
const B = "acct-b";
const accounts = () => [makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })];
const seed = () => [
  trade({ id: "t1", accountId: A, symbol: "ESZ6", tradingDay: "2026-10-19", realizedPnl: "96" }),
  trade({ id: "t2", accountId: A, symbol: "NQZ6", entryAt: "2026-10-19T15:00:00.000Z", exitAt: "2026-10-19T15:10:00.000Z", tradingDay: "2026-10-19", realizedPnl: "-54" }),
  trade({ id: "t3", accountId: A, symbol: "MNQZ6", entryAt: "2026-10-20T13:30:00.000Z", exitAt: "2026-10-20T13:31:00.000Z", tradingDay: "2026-10-20", realizedPnl: "26" }),
  trade({ id: "t4", accountId: A, symbol: "XYZ", entryAt: "2026-10-20T15:00:00.000Z", exitAt: "2026-10-20T15:05:00.000Z", tradingDay: "2026-10-20", realizedPnl: null, grossPnl: null, pnlStatus: "missing_instrument" }),
  // Same date, other account: never shown or linked under A.
  trade({ id: "tb", accountId: B, symbol: "ESZ6", tradingDay: "2026-10-19", realizedPnl: "1000" }),
];

beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 18, supportedSchemaVersion: 18, created: false, failure: null } } as unknown as RuntimeState;
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

const form = () => screen.getByRole("form", { name: "Daily review" });
const field = (label: RegExp) => within(form()).getByLabelText(label);
async function dailyChecklist() {
  return holder.store.repository.library.saveChecklist(null, {
    name: "Session rules", scope: "daily", items: [{ label: "Wrote a plan" }, { label: "Max two trades" }, { label: "No news trades" }],
  });
}

describe("daily review", () => {
  it("starts, saves as draft, resumes after a restart, completes and reopens a review with the keyboard", async () => {
    const user = userEvent.setup();
    const view = renderAt(dayPath("2026-10-19"));
    expect(await screen.findByRole("heading", { name: /Daily review · Mon, Oct 19, 2026/ })).toBeTruthy();
    expect(await screen.findByText("Not started")).toBeTruthy();
    expect(screen.getByText("No review yet")).toBeTruthy();

    await user.click(field(/Focus for the session/));
    await user.keyboard("Only A+ setups");
    expect(within(form()).getByText("Unsaved changes")).toBeTruthy();
    await user.click(within(form()).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByText("Draft")).toBeTruthy());
    expect(holder.store.daily.calls.filter(c => c.method === "save")).toHaveLength(1);

    // Restart: a new query cache over the same store reads the saved draft back.
    view.unmount();
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    renderAt(dayPath("2026-10-19"));
    expect(await screen.findByDisplayValue("Only A+ setups")).toBeTruthy();

    await user.click(field(/Key lesson/));
    await user.keyboard("Wait for the retest");
    const complete = within(form()).getByRole("button", { name: "Complete review" });
    complete.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getAllByText("Completed").length).toBeGreaterThan(0));
    const saved = holder.store.daily.calls.filter(c => c.method === "save").slice(-1)[0].args[0] as { action: string; expectedRevision: number };
    expect(saved).toMatchObject({ action: "complete", expectedRevision: 1 });

    await user.click(within(form()).getByRole("button", { name: "Reopen as draft" }));
    await waitFor(() => expect(screen.getByText("Draft")).toBeTruthy());
    expect(screen.getByDisplayValue("Wait for the retest")).toBeTruthy();
    await user.click(screen.getByText(/History/));
    expect(screen.getByText(/Reopened as draft/)).toBeTruthy();
  });

  it("never shares a review between two accounts on the same date, and says when the selection differs", async () => {
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-19", expectedRevision: null, plan: {}, reflection: { keyLesson: "A's lesson" }, noTradeDay: false, answers: [], action: "save" });
    renderAt(dayPath("2026-10-19", B));
    expect(await screen.findByText("Not started")).toBeTruthy();
    expect(screen.queryByDisplayValue("A's lesson")).toBeNull();
    // A is the selected account; this page is B's and says so.
    expect(screen.getByText("This review isn't for the selected account")).toBeTruthy();
    const trades = screen.getByRole("table", { name: /Trades on/ });
    expect(within(trades).getAllByRole("row")).toHaveLength(2); // header + B's one trade
  });

  it("shows process adherence apart from the outcome, and unanswered or not-applicable items never count as missed", async () => {
    const checklist = await dailyChecklist();
    const user = userEvent.setup();
    renderAt(dayPath("2026-10-19"));
    await screen.findByRole("form", { name: "Daily review" });
    await user.click(within(form()).getByRole("combobox", { name: /Daily checklist/ }));
    await user.click(await screen.findByRole("option", { name: "Session rules" }));
    const answer = async (item: string, result: string) => user.click(within(screen.getByRole("radiogroup", { name: new RegExp(item) })).getByRole("radio", { name: result }));
    await answer("Wrote a plan", "Followed");
    await answer("Max two trades", "Missed");
    await answer("No news trades", "Not applicable");
    await user.click(within(form()).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByText("1 of 2 applicable items followed (50%)")).toBeTruthy());
    // The day lost money and the process is 50%: they are separate facts, and neither is firm compliance.
    expect(screen.getByText(/not a check of your prop firm's rules/)).toBeTruthy();
    expect(holder.store.daily.reviews.get(`${A}|2026-10-19`)!.checklist!.id).toBe(checklist.id);

    // Only not-applicable answers: Unknown, never 100%.
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-16", expectedRevision: null, plan: {}, reflection: {}, noTradeDay: false,
      checklistId: checklist.id, answers: [{ itemId: checklist.items[2].id, result: "not_applicable" }], action: "save" });
    cleanup();
    renderAt(dayPath("2026-10-16"));
    expect(await screen.findByText("Unknown: only not-applicable answers")).toBeTruthy();
  });

  it("reviews a day with no trades as an explicit no-trade day, never a zero-P&L session", async () => {
    const user = userEvent.setup();
    renderAt(dayPath("2026-10-16"));
    await screen.findByRole("form", { name: "Daily review" });
    expect(screen.getAllByText("No trades recorded").length).toBeGreaterThan(0);
    expect(screen.getByText(/a missing import is not a no-trade day/)).toBeTruthy();
    await user.click(within(form()).getByRole("checkbox", { name: /I didn't trade this day/ }));
    await user.click(within(form()).getByRole("button", { name: "Complete review" }));
    await waitFor(() => expect(screen.getByText("No-trade day (by choice)")).toBeTruthy());
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    const summary = screen.getByRole("region", { name: "Day summary" });
    expect(within(summary).queryByText(/\$0\.00/)).toBeNull();
  });

  it("states unknown P&L instead of zeroing it, and keeps trades read-only links", async () => {
    const user = userEvent.setup();
    renderAt(dayPath("2026-10-20"));
    const summary = await screen.findByRole("region", { name: "Day summary" });
    expect(within(summary).getByText(/1 of 2 trades with a known P&L; 1 without a known P&L left out/)).toBeTruthy();
    expect(within(form()).getByRole("checkbox", { name: /I didn't trade this day/ }).hasAttribute("disabled")).toBe(true);
    await user.click(within(screen.getByRole("table", { name: /Trades on/ })).getByText("MNQZ6"));
    expect(location).toBe("/journal/trades/t3");
  });

  it("keeps the text after a failed save and saves it on retry", async () => {
    const user = userEvent.setup();
    renderAt(dayPath("2026-10-19"));
    await screen.findByRole("form", { name: "Daily review" });
    holder.store.daily.failing.add("save");
    await user.click(field(/Mistakes/));
    await user.keyboard("Chased the open");
    await user.click(within(form()).getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("It isn't certain the review was saved")).toBeTruthy();
    expect(screen.getByDisplayValue("Chased the open")).toBeTruthy();
    expect(holder.store.daily.reviews.size).toBe(0);
    holder.store.daily.failing.delete("save");
    await user.click(screen.getByRole("button", { name: "Check the stored review" }));
    await waitFor(() => expect(screen.queryByText("It isn't certain the review was saved")).toBeNull());
    expect(screen.getByDisplayValue("Chased the open")).toBeTruthy();
    await user.click(within(form()).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(holder.store.daily.reviews.size).toBe(1));
    expect(screen.getByDisplayValue("Chased the open")).toBeTruthy();
  });

  it("reports a conflict without losing edits, and offers them back after reloading", async () => {
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-19", expectedRevision: null, plan: { focus: "v1" }, reflection: {}, noTradeDay: false, answers: [], action: "save" });
    const user = userEvent.setup();
    renderAt(dayPath("2026-10-19"));
    await screen.findByDisplayValue("v1");
    // Another window saves revision 2.
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-19", expectedRevision: 1, plan: { focus: "other window" }, reflection: {}, noTradeDay: false, answers: [], action: "save" });
    await user.click(field(/Key lesson/));
    await user.keyboard("mine");
    await user.click(within(form()).getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("This review changed after you opened it")).toBeTruthy();
    expect(screen.getByDisplayValue("mine")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reload the review" }));
    expect(await screen.findByDisplayValue("other window")).toBeTruthy();
    expect(screen.getByText("You have unsaved edits from earlier")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore them" }));
    expect(screen.getByDisplayValue("mine")).toBeTruthy();
  });

  it("asks before leaving with unsaved edits, including day navigation", async () => {
    const user = userEvent.setup();
    renderAt(dayPath("2026-10-19"));
    await screen.findByRole("form", { name: "Daily review" });
    await user.click(field(/Focus for the session/));
    await user.keyboard("draft text");
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" }).catch(() => screen.findByRole("dialog", { name: "Leave without saving the review?" }))).toBeTruthy();
    expect(location).toBe(dayPath("2026-10-19"));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(location).toBe(dayPath("2026-10-20")));
    // The edits were kept for this window and are offered back.
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByText("You have unsaved edits from earlier")).toBeTruthy();
  });

  it("is read-only for an archived account", async () => {
    holder.store = createJournalStore([makeAccount({ id: A, name: "Old", archivedAt: "2026-10-20T00:00:00.000Z" }), makeAccount({ id: B, name: "Eval B" })], seed(), B);
    renderAt(dayPath("2026-10-19"));
    expect(await screen.findByText("This account is archived, so its reviews are read-only.")).toBeTruthy();
    expect(within(form()).getByRole("button", { name: "Complete review" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("lets a future day take a plan only", async () => {
    renderAt(dayPath("2026-10-21"));
    expect(await screen.findByText(/This trading day hasn't started/)).toBeTruthy();
    expect((field(/Key lesson/) as HTMLTextAreaElement).disabled).toBe(true);
    expect((field(/Focus for the session/) as HTMLTextAreaElement).disabled).toBe(false);
    expect(within(form()).getByRole("button", { name: "Complete review" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("refuses a weekend or malformed day instead of guessing one", async () => {
    renderAt(dayPath("2026-10-18"));
    expect(await screen.findByText("That isn't a trading day")).toBeTruthy();
  });

  it("shows trades changed since the review, and accepts the current trades without touching the text", async () => {
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-19", expectedRevision: null, plan: {}, reflection: { keyLesson: "kept" }, noTradeDay: false, answers: [], action: "save" });
    holder.store.all.get("t2")!.deletedAt = "2026-10-20T10:00:00.000Z";
    const user = userEvent.setup();
    renderAt(dayPath("2026-10-19"));
    expect(await screen.findByText("The day's trades changed since this review was saved")).toBeTruthy();
    expect(screen.getByText(/was deleted/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use the current trades" }));
    await waitFor(() => expect(screen.queryByText("The day's trades changed since this review was saved")).toBeNull());
    expect(screen.getByDisplayValue("kept")).toBeTruthy();
  });
});

describe("entry points", () => {
  it("shows each day's review status and adherence in By day and opens the same review", async () => {
    const checklist = await dailyChecklist();
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-19", expectedRevision: null, plan: {}, reflection: {}, noTradeDay: false,
      checklistId: checklist.id, answers: [{ itemId: checklist.items[0].id, result: "followed" }, { itemId: checklist.items[1].id, result: "missed" }], action: "complete" });
    // A no-trade day with a review is listed too.
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-16", expectedRevision: null, plan: {}, reflection: {}, noTradeDay: true, answers: [], action: "complete" });
    const user = userEvent.setup();
    renderAt("/journal?view=day");
    const monday = await screen.findByRole("group", { name: "Daily review for Mon, Oct 19, 2026" });
    expect(within(monday).getByText("Review: Completed")).toBeTruthy();
    expect(within(monday).getByText("Plan adherence 50% · 1/2")).toBeTruthy();
    const tuesday = screen.getByRole("group", { name: "Daily review for Tue, Oct 20, 2026" });
    expect(within(tuesday).getByText("No review")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Daily review for Fri, Oct 16, 2026" })).toBeTruthy();
    await user.click(within(monday).getByRole("button", { name: "Open review, Mon, Oct 19, 2026" }));
    expect(location).toBe(dayPath("2026-10-19"));
  });

  it("picks any weekday, including one without trades, from By day", async () => {
    const user = userEvent.setup();
    renderAt("/journal?view=day");
    const chooser = await screen.findByRole("form", { name: "Review a day" });
    const input = within(chooser).getByLabelText("Review a day");
    await user.clear(input);
    await user.type(input, "2026-10-17");
    await user.click(within(chooser).getByRole("button", { name: "Open" }));
    expect(within(chooser).getByText(/Choose a weekday/)).toBeTruthy();
    await user.clear(input);
    await user.type(input, "2026-10-14");
    await user.click(within(chooser).getByRole("button", { name: "Open" }));
    expect(location).toBe(dayPath("2026-10-14"));
  });

  it("lists daily reviews in the Library with resume and edit, and keeps earlier day notes apart", async () => {
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-19", expectedRevision: null, plan: { focus: "x" }, reflection: {}, noTradeDay: false, answers: [], action: "save" });
    await holder.store.repository.dailyReviews.save({ accountId: A, tradingDay: "2026-10-16", expectedRevision: null, plan: {}, reflection: { keyLesson: "Patience" }, noTradeDay: true, answers: [], action: "complete" });
    await holder.store.repository.dailyReviews.save({ accountId: B, tradingDay: "2026-10-19", expectedRevision: null, plan: {}, reflection: { keyLesson: "B only" }, noTradeDay: false, answers: [], action: "complete" });
    const user = userEvent.setup();
    renderAt("/journal?view=library&section=daily");
    const list = await screen.findByRole("list", { name: "Daily reviews" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).queryByText(/B only/)).toBeNull();
    expect(within(list).getByText("Patience")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Drafts/ }));
    expect(within(screen.getByRole("list", { name: "Daily reviews" })).getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Resume draft, Mon, Oct 19, 2026" }));
    expect(location).toBe(dayPath("2026-10-19"));
  });
});
