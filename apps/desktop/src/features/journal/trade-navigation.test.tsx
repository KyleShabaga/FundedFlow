// @vitest-environment jsdom
// B02: Previous/Next trade onto a trade that is not cached yet. While it loads the page keeps a stable shell (back link,
// disabled actions, one loading status) and shows nothing of the trade it came from; late answers never replace the
// trade asked for last. The repository is the in-memory store (test-store.ts); trades.detail can be held pending.
import { RepositoryError } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
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
/** Route-level navigation while the page's own buttons are disabled (rapid clicks that beat a slow load). */
function Go() {
  const navigate = useNavigate();
  return <>{["t1", "t2", "t3", "t4"].map(id => <button key={id} type="button" onClick={() => navigate(`/journal/trades/${id}`)}>go {id}</button>)}</>;
}
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Go />
          <Routes>
            <Route path="/journal/trades/:tradeId" element={<TradeDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const A = "acct-a";
const accounts = () => [makeAccount({ id: A, name: "Eval A" })];
const seed = () => [
  trade({ id: "t1", accountId: A, symbol: "ESZ6", entryAt: "2026-10-19T13:30:00.000Z", exitAt: "2026-10-19T14:00:00.000Z", tradingDay: "2026-10-19", realizedPnl: "96", grossPnl: "100", fees: "4" }),
  trade({ id: "t2", accountId: A, symbol: "NQZ6", side: "short", entryAt: "2026-10-19T15:00:00.000Z", exitAt: "2026-10-19T15:10:00.000Z", tradingDay: "2026-10-19", realizedPnl: "-54", grossPnl: "-50", fees: "4" }),
  trade({ id: "t3", accountId: A, symbol: "MNQZ6", entryAt: "2026-10-20T13:30:00.000Z", exitAt: "2026-10-20T13:31:00.000Z", tradingDay: "2026-10-20", realizedPnl: "26", grossPnl: "26", fees: "0" }),
  trade({ id: "t4", accountId: A, symbol: "XYZ", entryAt: "2026-10-20T15:00:00.000Z", exitAt: "2026-10-20T15:05:00.000Z", tradingDay: "2026-10-20", realizedPnl: null, grossPnl: null, pnlStatus: "missing_instrument" }),
];
const SYMBOL = { t1: "ESZ6", t2: "NQZ6", t3: "MNQZ6", t4: "XYZ" } as const;

/** Ids whose next trades.detail call is held; `held` settles it (resolve delegates to the real store). */
let holding: Set<string>;
let held: Map<string, { resolve: () => void; reject: (e: unknown) => void }>;
const hold = (...ids: string[]) => ids.forEach(id => holding.add(id));
const settle = async (id: string, error?: unknown) => {
  const h = held.get(id);
  if (!h) throw new Error(`no held read for ${id}`);
  held.delete(id);
  await act(async () => { if (error) h.reject(error); else h.resolve(); });
};

beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createJournalStore(accounts(), seed());
  holding = new Set();
  held = new Map();
  const trades = holder.store.repository.trades;
  const real = trades.detail;
  vi.spyOn(trades, "detail").mockImplementation((accountId: string, tradeId: string) => {
    if (!holding.delete(tradeId)) return real(accountId, tradeId);
    return new Promise((resolve, reject) => held.set(tradeId, { resolve: () => resolve(real(accountId, tradeId)), reject }));
  });
  try { sessionStorage.clear(); } catch { /* jsdom has it */ }
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const heading = (symbol: string) => screen.queryByRole("heading", { level: 2, name: symbol });
const shown = async (id: keyof typeof SYMBOL, n: number) => {
  expect(await screen.findByRole("heading", { level: 2, name: SYMBOL[id] })).toBeTruthy();
  expect(screen.getByText(`Trade ${n} of 4`)).toBeTruthy();
  expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
};
const loadingStatus = () => screen.queryByText("Loading the trade")?.closest("[role=status]") ?? null;
const disabled = (name: string) => {
  const b = screen.getByRole("button", { name, hidden: true });
  return b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true";
};
const ACTIONS = ["Previous trade", "Next trade", "Correct trade", "Delete"];
/** The B02 contract while a trade loads: shell kept, actions disabled, one loading status, no identity from any trade. */
function expectLoadingShell() {
  expect(screen.getAllByRole("link", { name: "Journal" }).length).toBeGreaterThan(0);
  expect(loadingStatus()).toBeTruthy();
  for (const id of Object.keys(SYMBOL) as (keyof typeof SYMBOL)[]) expect(heading(SYMBOL[id])).toBeNull();
  expect(screen.queryByText(/^Trade \d of 4$/)).toBeNull();
  expect(screen.getByRole("article", { name: "Loading the trade" })).toBeTruthy();
  for (const name of ACTIONS) expect(disabled(name), `${name} disabled while loading`).toBe(true);
}

describe("Trade detail navigation (B02)", () => {
  it("keeps a stable, identity-free loading shell when Previous trade opens an uncached trade", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t3");
    await shown("t3", 3);
    hold("t2");
    await user.click(screen.getByRole("button", { name: "Previous trade" }));
    expect(location).toBe("/journal/trades/t2");
    await waitFor(() => expect(held.has("t2")).toBe(true));
    expect(heading("MNQZ6")).toBeNull();
    expect(screen.queryByText("Trade 3 of 4")).toBeNull();
    expect(screen.queryByText("+$26.00")).toBeNull();
    expectLoadingShell();
    await settle("t2");
    await shown("t2", 2);
    expect(loadingStatus()).toBeNull();
  });

  it("shows the trade asked for last when the earlier request answers late", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t3");
    await shown("t3", 3);
    hold("t2", "t1");
    await user.click(screen.getByRole("button", { name: "go t2" }));
    await waitFor(() => expect(held.has("t2")).toBe(true));
    await user.click(screen.getByRole("button", { name: "go t1" }));
    await waitFor(() => expect(held.has("t1")).toBe(true));
    expect(location).toBe("/journal/trades/t1");
    await settle("t1");
    await shown("t1", 1);
    await settle("t2");
    await shown("t1", 1);
    expect(heading("NQZ6")).toBeNull();
    expect(screen.queryByText("Trade 2 of 4")).toBeNull();
  });

  it("keeps loading the trade asked for last when the earlier request answers first", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t3");
    await shown("t3", 3);
    hold("t2", "t1");
    await user.click(screen.getByRole("button", { name: "go t2" }));
    await waitFor(() => expect(held.has("t2")).toBe(true));
    await user.click(screen.getByRole("button", { name: "go t1" }));
    await waitFor(() => expect(held.has("t1")).toBe(true));
    await settle("t2");
    expect(heading("NQZ6")).toBeNull();
    expect(screen.queryByText("Trade 2 of 4")).toBeNull();
    expectLoadingShell();
    await settle("t1");
    await shown("t1", 1);
    expect(heading("NQZ6")).toBeNull();
  });

  it("ends on the last requested trade after rapid Previous/Next, and a cached revisit shows at once", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t3");
    await shown("t3", 3);
    await user.click(screen.getByRole("button", { name: "Previous trade" }));
    await shown("t2", 2);
    // t3 is cached: no loading status in between.
    await user.click(screen.getByRole("button", { name: "Next trade" }));
    expect(loadingStatus()).toBeNull();
    expect(heading("MNQZ6")).toBeTruthy();
    expect(screen.getByText("Trade 3 of 4")).toBeTruthy();
    // t4 is not cached and stays pending; a quick jump back to cached t2 wins.
    hold("t4");
    await user.click(screen.getByRole("button", { name: "Next trade" }));
    await waitFor(() => expect(held.has("t4")).toBe(true));
    expectLoadingShell();
    await user.click(screen.getByRole("button", { name: "go t2" }));
    expect(loadingStatus()).toBeNull();
    expect(heading("NQZ6")).toBeTruthy();
    await settle("t4");
    await shown("t2", 2);
    expect(heading("XYZ")).toBeNull();
    expect(location).toBe("/journal/trades/t2");
  });

  it("disables Previous on the first trade and Next on the last", async () => {
    renderAt("/journal/trades/t1");
    await shown("t1", 1);
    expect(disabled("Previous trade")).toBe(true);
    expect(disabled("Next trade")).toBe(false);
    cleanup();
    renderAt("/journal/trades/t4");
    await shown("t4", 4);
    expect(disabled("Previous trade")).toBe(false);
    expect(disabled("Next trade")).toBe(true);
  });

  it("shows a retryable error inside the shell when the trade fails to load, with nothing of the previous trade", async () => {
    const user = userEvent.setup();
    renderAt("/journal/trades/t3");
    await shown("t3", 3);
    hold("t2");
    await user.click(screen.getByRole("button", { name: "Previous trade" }));
    await waitFor(() => expect(held.has("t2")).toBe(true));
    // useFeatureQuery retries an "unexpected" read once by itself (500 ms); fail that attempt too.
    const failure = () => new RepositoryError({ kind: "database", message: "disk busy" });
    hold("t2");
    await settle("t2", failure());
    await waitFor(() => expect(held.has("t2")).toBe(true), { timeout: 2000 });
    await settle("t2", failure());
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("The data request could not be completed.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Journal" }).length).toBeGreaterThan(0);
    expect(heading("MNQZ6")).toBeNull();
    expect(screen.queryByText("Trade 3 of 4")).toBeNull();
    hold("t2");
    await user.click(retry);
    await waitFor(() => expect(held.has("t2")).toBe(true));
    await settle("t2");
    await shown("t2", 2);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
