// @vitest-environment jsdom
// TASK-022: with unsaved daily review edits, Back/Forward (the History API, as Alt+← and mouse back use) and buttons
// that navigate in code (Manage accounts, Quick Import, a trades-table row) ask first. These run under the app's
// real HashRouter, because the guard has to get ahead of the router's own popstate listener; the editor must stay the
// same mounted element while the dialog is open. The repository is the in-memory journal store (test-store.ts).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, type NavigateFunction, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PageHeader } from "../../app/AppShell";
import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { warmUp } from "../../test/warm-up";
import { makeAccount } from "../accounts/test-store";
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

const A = "acct-a";
const day = `/journal/days/2026-10-19?account=${A}`;
let navigate: NavigateFunction;
function Nav() {
  navigate = useNavigate();
  return null;
}
function renderApp() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HashRouter>
          <Nav />
          <PageHeader title="Journal" />
          <Routes>
            <Route path="/earlier" element={<p>Earlier page</p>} />
            <Route path="/later" element={<p>Later page</p>} />
            <Route path="/journal/days/:tradingDay" element={<DailyReviewPage />} />
            <Route path="/journal/trades/:tradeId" element={<p>Trade page</p>} />
            <Route path="/accounts" element={<p>Accounts page</p>} />
            <Route path="/import/quick" element={<p>Quick import page</p>} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

let client: QueryClient;
function fresh() {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 18, supportedSchemaVersion: 18, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createJournalStore([makeAccount({ id: A, name: "Eval A" })], [
    trade({ id: "t1", accountId: A, symbol: "ESZ6", tradingDay: "2026-10-19", realizedPnl: "96" }),
  ]);
  try { sessionStorage.clear(); } catch { /* jsdom has it */ }
}
beforeEach(() => {
  fresh();
  // Every test starts on a router-owned "/earlier" entry; the router writes its index on mount.
  window.history.pushState(null, "", "#/earlier");
});
beforeAll(async () => {
  fresh();
  window.location.hash = day;
  await warmUp(renderApp, () => screen.findByRole("form", { name: "Daily review" }));
  client.clear();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const idx = () => (window.history.state as { idx?: number } | null)?.idx;
const here = () => window.location.hash.slice(1);
const prompt = () => screen.queryByRole("alertdialog", { name: "Leave without saving the review?" });
const focus = () => within(screen.getByRole("form", { name: "Daily review" })).getByLabelText(/Focus for the session/) as HTMLTextAreaElement;

/** Opens the day from "/earlier" through the router (so the day's entry carries the router's index) and edits it. */
async function dirtyDay(user: ReturnType<typeof userEvent.setup>) {
  act(() => navigate(day));
  await screen.findByRole("form", { name: "Daily review" });
  await user.click(focus());
  await user.paste("draft text");
  return focus();
}

/** Traverses history the way Alt+← / mouse back do, and waits for the jsdom task that fires popstate. */
async function traverse(delta: number) {
  await act(async () => { window.history.go(delta); });
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
}

describe("history navigation with unsaved daily review edits (TASK-022)", () => {
  it("asks on Back; Stay keeps the same editor, its text and the history, and Back asks again", async () => {
    const user = userEvent.setup();
    renderApp();
    const editor = await dirtyDay(user);
    const before = { idx: idx(), length: window.history.length };
    await traverse(-1);
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    // The editor never unmounted: same element, same text, while the dialog is open.
    expect(focus()).toBe(editor);
    expect(editor.value).toBe("draft text");
    await waitFor(() => expect(idx()).toBe(before.idx));
    expect(here()).toBe(day);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(focus()).toBe(editor);
    expect(editor.value).toBe("draft text");
    expect({ idx: idx(), length: window.history.length }).toEqual(before);
    expect(here()).toBe(day);
    await traverse(-1);
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).toBeTruthy();
    expect(focus()).toBe(editor);
  });

  it("asks on Forward, and Stay leaves the history unchanged", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => navigate(day));
    await screen.findByRole("form", { name: "Daily review" });
    act(() => navigate("/later"));
    await screen.findByText("Later page");
    await traverse(-1);
    await screen.findByRole("form", { name: "Daily review" });
    await user.click(focus());
    await user.paste("draft text");
    const editor = focus();
    const before = { idx: idx(), length: window.history.length };
    await traverse(1);
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    expect(focus()).toBe(editor);
    await waitFor(() => expect(idx()).toBe(before.idx));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect({ idx: idx(), length: window.history.length }).toEqual(before);
    expect(focus()).toBe(editor);
    expect(editor.value).toBe("draft text");
    expect(screen.queryByText("Later page")).toBeNull();
  });

  it("completes the Back on Leave: previous entry, no new entry, asked once", async () => {
    const user = userEvent.setup();
    renderApp();
    await dirtyDay(user);
    const before = { idx: idx()!, length: window.history.length };
    await traverse(-1);
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    await waitFor(() => expect(idx()).toBe(before.idx));
    await user.click(within(dialog).getByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Earlier page")).toBeTruthy();
    expect(here()).toBe("/earlier");
    expect(idx()).toBe(before.idx - 1);
    expect(window.history.length).toBe(before.length);
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(prompt()).toBeNull();
    expect(screen.getByText("Earlier page")).toBeTruthy();
  });

  it("known gap (TASK-022 step 3): an entry without the router's history.state.idx goes through without a prompt", async () => {
    const user = userEvent.setup();
    // "/earlier" (from beforeEach) and the day are written outside the router, so neither carries an index; the
    // router then indexes the day's entry when it mounts, and "/earlier" stays without one.
    window.history.pushState(null, "", `#${day}`);
    renderApp();
    await screen.findByRole("form", { name: "Daily review" });
    await user.click(focus());
    await user.paste("draft text");
    await traverse(-1);
    expect(await screen.findByText("Earlier page")).toBeTruthy();
    expect(idx()).toBeUndefined();
    expect(prompt()).toBeNull();
  });
});

describe("code navigation with unsaved daily review edits (TASK-022)", () => {
  it("asks before 'Manage accounts' in the account selector", async () => {
    const user = userEvent.setup();
    renderApp();
    const editor = await dirtyDay(user);
    await user.click(await screen.findByRole("button", { name: /Eval A/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Manage accounts" }));
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).toBeTruthy();
    expect(here()).toBe(day);
    expect(focus()).toBe(editor);
  });

  it("asks before Quick Import, and Leave opens it", async () => {
    const user = userEvent.setup();
    renderApp();
    const editor = await dirtyDay(user);
    const length = window.history.length;
    await user.click(screen.getByRole("button", { name: "Quick Import" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    expect(here()).toBe(day);
    expect(focus()).toBe(editor);
    await user.click(within(dialog).getByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Quick import page")).toBeTruthy();
    expect(window.history.length).toBe(length + 1);
  });

  it("asks before a trades-table row opens the trade", async () => {
    const user = userEvent.setup();
    renderApp();
    const editor = await dirtyDay(user);
    await user.click(within(screen.getByRole("table", { name: /Trades on/ })).getByText("ESZ6"));
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving the review?" })).toBeTruthy();
    expect(here()).toBe(day);
    expect(focus()).toBe(editor);
    expect(screen.queryByText("Trade page")).toBeNull();
  });
});
