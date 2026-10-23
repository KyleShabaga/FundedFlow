// @vitest-environment jsdom
// B03: after a successful review save the form is clean and unguarded, even though the backend canonicalises what it
// stores; edits made while a save is in flight, and failed saves, stay dirty and guarded. The fake save below
// canonicalises decimals and tag order the way Rust does (store/reviews.rs); test-store.ts itself does not.
import { RepositoryError, type ReviewInput, type TradeReview } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const A = "acct-a";
const seed = () => [
  trade({ id: "t1", accountId: A, symbol: "ESZ6", entryAt: "2026-10-19T13:30:00.000Z", exitAt: "2026-10-19T14:00:00.000Z", tradingDay: "2026-10-19", realizedPnl: "96", grossPnl: "100", fees: "4" }),
  trade({ id: "t2", accountId: A, symbol: "NQZ6", side: "short", entryAt: "2026-10-19T15:00:00.000Z", exitAt: "2026-10-19T15:10:00.000Z", tradingDay: "2026-10-19", realizedPnl: "-54", grossPnl: "-50", fees: "4" }),
];

// Rust's canonical decimal text: no leading "+", no trailing zeros after the point, no trailing ".".
const canonicalDecimal = (s: string | null) => {
  if (s === null) return null;
  let v = s.trim().replace(/^\+/, "");
  if (v.includes(".")) v = v.replace(/0+$/, "").replace(/\.$/, "");
  return v;
};
const KIND_ORDER = ["setup", "mistake", "emotion", "general"];
function canonicalise(r: TradeReview) {
  r.plannedEntryPrice = canonicalDecimal(r.plannedEntryPrice);
  r.plannedStopPrice = canonicalDecimal(r.plannedStopPrice);
  r.plannedTargetPrice = canonicalDecimal(r.plannedTargetPrice);
  r.plannedRisk = canonicalDecimal(r.plannedRisk);
  r.tags = [...r.tags].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label));
  return r;
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

type Reviews = ReturnType<typeof createJournalStore>["repository"]["reviews"];
let realSave: Reviews["save"];
let realGet: Reviews["get"];
beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createJournalStore([makeAccount({ id: A, name: "Eval A" })], seed());
  const reviews = holder.store.repository.reviews;
  realSave = reviews.save;
  realGet = reviews.get;
  reviews.save = async (input: ReviewInput) => {
    const saved = await realSave(input);
    canonicalise(holder.store.reviews.get(input.tradeId)!);
    return canonicalise(saved);
  };
  try { sessionStorage.clear(); } catch { /* jsdom has it */ }
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const draftKey = (tradeId: string) => `fundedflow.tradeReview.${A}.${tradeId}`;
const card = () => screen.findByRole("region", { name: "Review" });
const field = (c: HTMLElement, label: RegExp) => within(c).getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const entry = /^Planned entry/;
const reflection = /^Notes and reflection/;
const leavePrompt = () => screen.queryByRole("alertdialog", { name: "Leave without saving the review?" });
const journalLink = () => screen.getAllByRole("link", { name: "Journal" })[0];
async function fill(user: ReturnType<typeof userEvent.setup>, c: HTMLElement, price: string, text: string) {
  await user.type(await within(c).findByLabelText(entry), price);
  await user.type(field(c, reflection), text);
}
async function saveAndWait(user: ReturnType<typeof userEvent.setup>, c: HTMLElement) {
  await user.click(within(c).getByRole("button", { name: "Save review" }));
  expect(await screen.findByText("Review saved")).toBeTruthy();
}
async function seedTags() {
  const setup = await holder.store.repository.library.saveTag(null, { name: "Opening drive", kind: "setup" });
  const mistake = await holder.store.repository.library.saveTag(null, { name: "Chased", kind: "mistake" });
  return { setup, mistake };
}

describe("Review save guard (B03)", () => {
  it("is clean after a save whose stored values were canonicalised, and leaves without asking", async () => {
    const user = userEvent.setup();
    await seedTags();
    renderAt("/journal/trades/t1");
    const c = await card();
    await fill(user, c, "100.50", "Entered late.");
    // Clicked mistake first, so the stored order (setup, mistake) differs from the typed one.
    await user.click(within(within(c).getByRole("group", { name: "Mistakes" })).getByRole("button", { name: "Chased" }));
    await user.click(within(within(c).getByRole("group", { name: "Setup" })).getByRole("button", { name: "Opening drive" }));
    await saveAndWait(user, c);
    await waitFor(() => expect(within(c).queryByText("Unsaved changes")).toBeNull());
    expect(holder.store.reviews.get("t1")?.plannedEntryPrice).toBe("100.5");
    expect(sessionStorage.getItem(draftKey("t1"))).toBeNull();
    await user.click(journalLink());
    expect(leavePrompt()).toBeNull();
    await waitFor(() => expect(location).toBe("/journal?view=log"));
  });

  it("canonicalises a leading plus and trailing point in planned risk without leaving the form dirty", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    const c = await card();
    await user.type(await within(c).findByLabelText(/^Planned risk/), "+5.");
    await saveAndWait(user, c);
    await waitFor(() => expect(within(c).queryByText("Unsaved changes")).toBeNull());
    expect(holder.store.reviews.get("t1")?.plannedRisk).toBe("5");
    await user.click(journalLink());
    expect(leavePrompt()).toBeNull();
  });

  it("does not ask to leave when the refetch after the save is slow", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    const c = await card();
    await fill(user, c, "100.50", "slow refetch");
    const slow = deferred<void>();
    holder.store.repository.reviews.get = async (accountId, tradeId) => { await slow.promise; return realGet(accountId, tradeId); };
    await user.click(within(c).getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(holder.store.reviews.get("t1")?.revision).toBe(1));
    // The mutation waits for its invalidation, so it is still saving until the read lands.
    expect(within(c).getByRole("button", { name: /Saving/ })).toBeTruthy();
    await act(async () => slow.resolve());
    expect(await screen.findByText("Review saved")).toBeTruthy();
    await waitFor(() => expect(within(c).queryByText("Unsaved changes")).toBeNull());
    await user.click(journalLink());
    expect(leavePrompt()).toBeNull();
    await waitFor(() => expect(location).toBe("/journal?view=log"));
  });

  describe("edits made while a save is pending stay dirty and guarded", () => {
    async function editDuringSave(seedExisting: boolean) {
      const user = userEvent.setup();
      if (seedExisting) await holder.store.repository.reviews.save({ accountId: A, tradeId: "t1", expectedRevision: null, reflection: "first", reviewed: false, tagIds: [], checklistResults: [] });
      renderAt("/journal/trades/t1");
      const c = await card();
      await user.type(await within(c).findByLabelText(entry), "100.50");
      const gate = deferred<void>();
      const wrapped = holder.store.repository.reviews.save;
      holder.store.repository.reviews.save = async input => { await gate.promise; return wrapped(input); };
      await user.click(within(c).getByRole("button", { name: "Save review" }));
      expect(await within(c).findByRole("button", { name: /Saving/ })).toBeTruthy();
      await user.type(field(c, reflection), " more");
      const typed = seedExisting ? "first more" : " more";
      await act(async () => gate.resolve());
      expect(await screen.findByText("Review saved")).toBeTruthy();
      await waitFor(() => expect(holder.store.reviews.get("t1")?.revision).toBe(seedExisting ? 2 : 1));
      expect(field(c, reflection).value).toBe(typed);
      expect(within(c).getByText("Unsaved changes")).toBeTruthy();
      await user.click(journalLink());
      expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).toBeTruthy();
      expect(location).toBe("/journal/trades/t1");
      expect(field(c, reflection).value).toBe(typed);
    }
    it("on a new review (revision null to 1)", () => editDuringSave(false));
    it("on an existing review (revision 1 to 2)", () => editDuringSave(true));
  });

  it("keeps the draft and stays dirty when the save fails", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    const c = await card();
    await fill(user, c, "100.50", "keep me");
    holder.store.repository.reviews.save = async () => { throw new RepositoryError({ kind: "validation", message: "refused", issues: [{ field: "reflection", message: "refused" }] }); };
    await user.click(within(c).getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(within(c).queryByRole("button", { name: /Saving/ })).toBeNull());
    expect(screen.queryByText("Review saved")).toBeNull();
    expect(field(c, reflection).value).toBe("keep me");
    expect(field(c, entry).value).toBe("100.50");
    expect(within(c).getByText("Unsaved changes")).toBeTruthy();
    expect(sessionStorage.getItem(draftKey("t1"))).not.toBeNull();
    await user.click(journalLink());
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).toBeTruthy();
  });

  it("resets to what is stored when a newer revision is saved elsewhere", async () => {
    await holder.store.repository.reviews.save({ accountId: A, tradeId: "t1", expectedRevision: null, reflection: "mine", reviewed: false, tagIds: [], checklistResults: [] });
    renderAt("/journal/trades/t1");
    const c = await card();
    await waitFor(() => expect(field(c, reflection).value).toBe("mine"));
    await act(() => holder.store.repository.reviews.save({ accountId: A, tradeId: "t1", expectedRevision: 1, reflection: "theirs", plannedEntryPrice: "200.0", reviewed: false, tagIds: [], checklistResults: [] }));
    await act(() => client.invalidateQueries());
    await waitFor(() => expect(field(c, reflection).value).toBe("theirs"));
    expect(field(c, entry).value).toBe("200");
    expect(within(c).queryByText("Unsaved changes")).toBeNull();
  });

  it("does not offer stale edits to restore after a successful save", async () => {
    const user = userEvent.setup();
    const view = renderAt("/journal/trades/t1");
    const c = await card();
    await fill(user, c, "100.50", "saved");
    await saveAndWait(user, c);
    await waitFor(() => expect(within(c).queryByText("Unsaved changes")).toBeNull());
    view.unmount();
    renderAt("/journal/trades/t1");
    const again = await card();
    await waitFor(() => expect(field(again, reflection).value).toBe("saved"));
    expect(within(again).queryByText("You have unsaved edits from earlier")).toBeNull();
    expect(within(again).queryByText("Unsaved changes")).toBeNull();
  });

  it("never carries one trade's review or draft to the next trade", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t1");
    let c = await card();
    await fill(user, c, "100.50", "saved on t1");
    await saveAndWait(user, c);
    await user.type(field(c, reflection), " draft");
    await user.click(screen.getByRole("button", { name: "Next trade" }));
    // Previous/Next are buttons, not links; confirm the leave prompt if the page asks.
    const prompt = leavePrompt();
    if (prompt) await user.click(within(prompt).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(location).toBe("/journal/trades/t2"));
    expect(await screen.findByRole("heading", { name: "NQZ6" })).toBeTruthy();
    c = await card();
    await waitFor(() => expect(within(c).getByLabelText(entry)).toBeTruthy());
    expect(field(c, entry).value).toBe("");
    expect(field(c, reflection).value).toBe("");
    expect(within(c).queryByText("Unsaved changes")).toBeNull();
    expect(within(c).queryByText("You have unsaved edits from earlier")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Previous trade" }));
    await waitFor(() => expect(location).toBe("/journal/trades/t1"));
    expect(await screen.findByRole("heading", { name: "ESZ6" })).toBeTruthy();
    c = await card();
    expect(await within(c).findByText("You have unsaved edits from earlier")).toBeTruthy();
    expect(field(c, entry).value).toBe("100.5");
    await user.click(within(c).getByRole("button", { name: "Restore them" }));
    expect(field(c, reflection).value).toBe("saved on t1 draft");
  });

  it("shows the saved, canonical values when the trade is opened again", async () => {
    const user = userEvent.setup();
    const view = renderAt("/journal/trades/t1");
    const c = await card();
    await fill(user, c, "100.50", "persisted");
    await saveAndWait(user, c);
    view.unmount();
    client.clear();
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    renderAt("/journal/trades/t1");
    const again = await card();
    await waitFor(() => expect(field(again, entry).value).toBe("100.5"));
    expect(field(again, reflection).value).toBe("persisted");
    expect(within(again).queryByText("Unsaved changes")).toBeNull();
  });
});
