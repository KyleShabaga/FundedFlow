// @vitest-environment jsdom
// TASK-024: a write whose outcome is unknown (no answer came back) is never reported as a definite failure. Here: a
// deleted trade's Restore (Journal → Deleted trades), the Undo after deleting a trade, and the daily review's
// "Select <account>" (an active-account switch, locked until FundedFlow restarts). Definite failures keep their
// wording. The repository is the in-memory journal store (test-store.ts, synthetic trades).
import { RepositoryError } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { DailyReviewPage } from "../daily-reviews/components/DailyReviewPage";
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

const A = "acct-a";
const B = "acct-b";
let client: QueryClient;
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/journal/trades/:tradeId" element={<TradeDetailPage />} />
            <Route path="/journal/days/:tradingDay" element={<DailyReviewPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
/** The store, with `active` as the selected account. */
function seed(active: string) {
  holder.store = createJournalStore([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })], [
    trade({ id: "t1", accountId: A, symbol: "ESZ6", tradingDay: "2026-10-19", realizedPnl: "96" }),
    trade({ id: "t2", accountId: A, symbol: "NQZ6", entryAt: "2026-10-19T15:00:00.000Z", exitAt: "2026-10-19T15:10:00.000Z", tradingDay: "2026-10-19", realizedPnl: "-54" }),
  ], active);
}
beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 18, supportedSchemaVersion: 18, created: false, failure: null, cleanup: "clear" } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  seed(A);
  try { sessionStorage.clear(); } catch { /* jsdom has it */ }
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const uncertain = () => new RepositoryError({ kind: "database", message: "no answer" });
const definite = () => new RepositoryError({ kind: "notFound", message: "gone" });
async function toast(title: string) {
  const el = (await screen.findByText(title)).closest(".ds-toast") as HTMLElement;
  return { el, tone: ["warning", "error", "success", "info"].find(t => el.classList.contains(`ds-notice-${t}`)) };
}
const TRADE_TITLE = "The trade may have been restored";
/** The settings port (the journal store has it at run time; its declared type leaves it out). */
const settings = () => (holder.store.repository as unknown as { settings: { set: (key: string, value: unknown) => Promise<unknown> } }).settings;

describe("restoring a deleted trade with no answer (TASK-024)", () => {
  async function restoreFromLog(user: ReturnType<typeof userEvent.setup>) {
    await holder.store.repository.trades.remove("t1");
    renderAt("/journal?view=log");
    await user.click(await screen.findByRole("button", { name: "Deleted trades" }));
    const drawer = await screen.findByRole("dialog", { name: "Deleted trades" });
    await user.click(await within(drawer).findByRole("button", { name: "Restore" }));
  }

  it("Deleted trades → Restore: says it may have been restored, where to check and where it is reviewed, as a warning", async () => {
    vi.spyOn(holder.store.repository.trades, "restore").mockRejectedValue(uncertain());
    const user = userEvent.setup();
    await restoreFromLog(user);
    const shown = await toast(TRADE_TITLE);
    expect(shown.tone).toBe("warning");
    const text = shown.el.textContent ?? "";
    expect(text).toMatch(/No answer came back/);
    expect(text).toMatch(/Check the deleted trades list/);
    expect(text).toMatch(/add or edit a trade in this account/);
    expect(screen.queryByText("The trade wasn't restored")).toBeNull();
  });

  it("Deleted trades → Restore: a definite failure keeps its wording, as an error", async () => {
    vi.spyOn(holder.store.repository.trades, "restore").mockRejectedValue(definite());
    const user = userEvent.setup();
    await restoreFromLog(user);
    expect((await toast("The trade wasn't restored")).tone).toBe("error");
    expect(screen.queryByText(TRADE_TITLE)).toBeNull();
  });

  for (const [name, error, title, tone] of [
    ["says it may have been restored, as a warning", uncertain, TRADE_TITLE, "warning"],
    ["keeps the definite wording, as an error", definite, "The trade wasn't restored", "error"],
  ] as const) {
    it(`Undo after deleting a trade, with ${error === uncertain ? "no answer" : "a definite failure"}: ${name}`, async () => {
      vi.spyOn(holder.store.repository.trades, "restore").mockRejectedValue(error());
      const user = userEvent.setup();
      renderAt("/journal/trades/t1");
      await user.click(await screen.findByRole("button", { name: "Delete" }));
      await user.click(within(await screen.findByRole("alertdialog", { name: "Delete this ESZ6 trade?" })).getByRole("button", { name: "Delete trade" }));
      await user.click(within((await toast("ESZ6 trade deleted")).el).getByRole("button", { name: "Undo" }));
      expect((await toast(title)).tone).toBe(tone);
      if (error === uncertain) expect((await toast(title)).el.textContent).toMatch(/Check the trade log/);
    });
  }
});

describe("the daily review's account switch with no answer (TASK-024)", () => {
  const day = `/journal/days/2026-10-19?account=${A}`;
  // The selection is B, so A's review offers "Select Eval A". Each test seeds B before spying on the store.
  beforeEach(() => seed(B));
  async function select(user: ReturnType<typeof userEvent.setup>) {
    renderAt(day);
    await user.click(await screen.findByRole("button", { name: "Select Eval A" }));
  }

  it("says the switch may have happened and is locked until a restart, as a warning", async () => {
    vi.spyOn(settings(), "set").mockRejectedValue(uncertain());
    const user = userEvent.setup();
    await select(user);
    const shown = await toast("The active account may have changed");
    expect(shown.tone).toBe("warning");
    expect(shown.el.textContent).toContain("Switching is locked until you restart FundedFlow; check the active account after reopening it.");
    expect(screen.queryByText("The account wasn't switched")).toBeNull();
  });

  it("a definite failure keeps its wording, as an error", async () => {
    vi.spyOn(settings(), "set").mockRejectedValue(new RepositoryError({ kind: "unavailable", message: "closed" }));
    const user = userEvent.setup();
    await select(user);
    await waitFor(() => expect(screen.getByText("The account wasn't switched")).toBeTruthy());
    expect((await toast("The account wasn't switched")).tone).toBe("error");
  });
});
