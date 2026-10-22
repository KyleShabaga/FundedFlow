// @vitest-environment jsdom
// Build 23 journeys through the real Insights page, Trade detail and Build 13/14 pieces. The repository is the Journal
// in-memory store with the Insights dataset fake (test-store.ts); SQL, trading days and R derivation are tested in Rust
// and the metric definitions by the Rust-generated parity fixture.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { TradeDetailPage } from "../journal/components/TradeDetailPage";
import { createJournalStore, trade } from "../journal/test-store";
import { featureKeys } from "../shared/query-keys";
import { useRemoveTrade } from "../trades/hooks/trades";
import { InsightsPage } from "./components/InsightsPage";

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
function RemoveButton({ accountId, tradeId }: { accountId: string; tradeId: string }) {
  const remove = useRemoveTrade(accountId, tradeId);
  return <button type="button" onClick={() => void remove.submit(null)}>Delete trade for test</button>;
}
function renderAt(path: string, extra?: React.ReactNode) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          {extra}
          <Routes>
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/journal/trades/:tradeId" element={<TradeDetailPage />} />
            <Route path="/journal/days/:tradingDay" element={<p>Daily review page</p>} />
            <Route path="/accounts" element={<p>Accounts page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Attempt 1 failed (stated cause), attempt 2 passed and archived, attempt 3 active; all share broker number TOP-1.
const A1 = "acct-1";
const A2 = "acct-2";
const A3 = "acct-3";
const EUR = "acct-eur";
const accounts = () => [
  makeAccount({ id: A1, name: "Eval #1", status: "failed", externalRef: "TOP-1", successorAccountId: A2 }),
  makeAccount({ id: A2, name: "Eval #2", status: "passed", externalRef: "TOP-1", archivedAt: "2026-10-10T00:00:00.000Z", predecessorAccountId: A1, successorAccountId: A3 }),
  makeAccount({ id: A3, name: "Eval #3", externalRef: "TOP-1", predecessorAccountId: A2 }),
  makeAccount({ id: EUR, name: "Euro account", currency: "EUR", timezone: "Europe/Berlin", tradingDayResetTime: "00:00" }),
];
const t = (id: string, accountId: string, day: string, net: string | null, over: Parameters<typeof trade>[0] extends infer _ ? Partial<Parameters<typeof trade>[0]> : never = {}) =>
  trade({ id, accountId, tradingDay: day, entryAt: `${day}T13:30:00.000Z`, exitAt: `${day}T14:00:00.000Z`, realizedPnl: net,
    grossPnl: net === null ? null : String(Number(net) + 4), fees: "4", pnlStatus: net === null ? "missing_instrument" : "calculated", ...over });
const seed = () => [
  t("a1-1", A1, "2026-09-28", "100"),
  t("a1-2", A1, "2026-09-29", "-300", { side: "short" }),
  t("a2-1", A2, "2026-10-05", "100"),
  t("a2-2", A2, "2026-10-06", "250"),
  t("a3-1", A3, "2026-10-19", "96"),
  t("a3-2", A3, "2026-10-19", "-54", { symbol: "NQZ6" }),
  t("a3-3", A3, "2026-10-20", null, { symbol: "XYZ" }),
  t("a3-4", A3, "2026-10-20", "26", { source: "csv_import", importBatchId: "b" }),
  t("a3-open", A3, "2026-10-21", null, { exitAt: null, exitPrice: null, pnlStatus: "open" }),
  t("e-1", EUR, "2026-10-19", "40"),
];

beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 18, supportedSchemaVersion: 18, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createJournalStore(accounts(), seed(), A3);
  holder.store.causes.set(A1, "Daily loss limit");
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const drawer = () => screen.findByRole("dialog", { name: /^Contributing trades/ });
const rowsOf = (dialog: HTMLElement) => within(within(dialog).getByRole("table")).getAllByRole("row").slice(1);

describe("Insights", () => {
  it("asks for an account when the journal has none", async () => {
    holder.store = createJournalStore([], [], null);
    renderAt("/insights");
    expect(await screen.findByText("Add an account to see Insights")).toBeTruthy();
  });

  it("asks which accounts to analyse instead of guessing when none is active", async () => {
    holder.store = createJournalStore(accounts(), seed(), null);
    renderAt("/insights");
    expect(await screen.findByText("Choose the accounts to analyse")).toBeTruthy();
    expect(holder.store.insights.calls).toHaveLength(0);
  });

  it("defaults to the active attempt and shows exact closed-trade metrics with N/A and insufficient states", async () => {
    renderAt("/insights");
    const net = (await screen.findByText("Net P&L", { selector: ".ds-label" })).closest(".ds-metric") as HTMLElement;
    // Active attempt only: 96 − 54 + 26 = 68; the unknown and open trades are left out.
    expect(within(net).getByText("+$68.00")).toBeTruthy();
    expect(within(net).getByText("3 of 4 closed trades with a known P&L")).toBeTruthy();
    expect(holder.store.insights.calls[0]).toEqual({ accountIds: [A3] });
    const winRate = screen.getByText("Win rate", { selector: ".ds-label" }).closest(".ds-metric") as HTMLElement;
    expect(within(winRate).getByText("66.7%")).toBeTruthy();
    const pf = screen.getByText("Profit factor", { selector: ".ds-label" }).closest(".ds-metric") as HTMLElement;
    expect(within(pf).getByText("Insufficient data")).toBeTruthy();
    const r = screen.getByText("Average R", { selector: ".ds-label" }).closest(".ds-metric") as HTMLElement;
    expect(within(r).getByText("N/A")).toBeTruthy();
    expect(screen.getByText("1 trade with an unknown P&L")).toBeTruthy();
    expect(screen.getByText(/1 open left out/)).toBeTruthy();
  });

  it("opens exactly the contributing trades of a figure, with totals that match it, from the keyboard", async () => {
    const user = userEvent.setup();
    renderAt("/insights");
    const net = (await screen.findByText("Net P&L", { selector: ".ds-label" })).closest(".ds-metric") as HTMLElement;
    const open = within(net).getByRole("button", { name: /Net P&L: view the 3 trades/ });
    open.focus();
    await user.keyboard("{Enter}");
    const dialog = await drawer();
    expect(rowsOf(dialog).map(r => within(r).getByRole("rowheader").textContent)).toEqual(["Mon, Oct 19, 2026", "Mon, Oct 19, 2026", "Tue, Oct 20, 2026"]);
    expect(within(within(dialog).getByRole("table")).getAllByText("Eval #3")).toHaveLength(3);
    // The drawer's totals are recomputed from these exact trades and match the figure.
    const totals = dialog.querySelector("dl[aria-label=\"Totals of these trades\"]") as HTMLElement;
    expect(within(totals).getByText("+$68.00")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(open);
  });

  it("leads with the section tabs, above the account, basis and filters, and keeps the URL in charge (P0-D16)", async () => {
    const user = userEvent.setup();
    renderAt("/insights?basis=gross&section=calendar");
    const tabs = await screen.findByRole("tablist", { name: "Insights sections" });
    const filters = await screen.findByRole("region", { name: "Filters" });
    const basis = screen.getByRole("group", { name: "P&L basis" });
    expect(tabs.compareDocumentPosition(basis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("tablist", { name: "Insights sections" })).toHaveLength(1);
    expect(within(tabs).getByRole("tab", { name: "Calendar" }).getAttribute("aria-selected")).toBe("true");
    await user.click(within(tabs).getByRole("tab", { name: "Attempts" }));
    // The section changes; the basis and other choices stay in the URL.
    expect(location).toContain("section=attempts");
    expect(location).toContain("basis=gross");
  });

  it("switches to gross P&L and keeps the choice in the URL", async () => {
    const user = userEvent.setup();
    renderAt("/insights");
    await screen.findAllByText("+$68.00");
    await user.click(screen.getByRole("button", { name: "Gross P&L" }));
    const gross = (await screen.findByText("Gross P&L", { selector: ".ds-label" })).closest(".ds-metric") as HTMLElement;
    expect(within(gross).getByText("+$80.00")).toBeTruthy(); // 100 − 50 + 30
    expect(location).toContain("basis=gross");
  });

  it("compares failed, passed (archived) and active attempts that reuse a broker number, without inferring outcomes", async () => {
    const user = userEvent.setup();
    renderAt(`/insights?accounts=${A1},${A2},${A3}&section=attempts`);
    const table = await screen.findByRole("table", { name: "Selected attempts" });
    const row = (name: string) => within(table).getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;
    expect(within(row("Eval #1")).getByText("Failed")).toBeTruthy();
    expect(within(row("Eval #1")).getByText("Reported: “Daily loss limit”")).toBeTruthy();
    expect(within(row("Eval #2")).getByText("Archived")).toBeTruthy();
    expect(within(row("Eval #2")).getAllByText("TOP-1")).toHaveLength(1);
    expect(within(row("Eval #1")).getByText("−$200.00")).toBeTruthy();
    expect(within(row("Eval #2")).getByText("+$350.00")).toBeTruthy();
    const cohort = screen.getByRole("region", { name: "Pass rate of the selected attempts" });
    expect(within(cohort).getByText("50%")).toBeTruthy(); // 1 passed of 2 resolved; the active attempt is left out
    await user.click(within(row("Eval #2")).getByRole("button", { name: /Eval #2: closed trades/ }));
    const dialog = await drawer();
    expect(rowsOf(dialog)).toHaveLength(2);
    expect(within(dialog).queryByText("Eval #1")).toBeNull();
  });

  it("groups reset chains only when asked and lists every included attempt", async () => {
    const user = userEvent.setup();
    renderAt(`/insights?accounts=${A1},${A2}&section=attempts`);
    await screen.findByRole("table", { name: "Selected attempts" });
    await user.click(screen.getByRole("switch", { name: /Group reset chains/ }));
    expect(await screen.findByText("Chain: Eval #1 → Eval #2")).toBeTruthy();
    expect(screen.getByText(/attempt 1, attempt 2/)).toBeTruthy();
    expect(location).toContain("lineage=1");
  });

  it("never adds currencies: a mixed selection asks for one currency", async () => {
    renderAt(`/insights?accounts=${A3},${EUR}`);
    expect(await screen.findByText("These attempts use different currencies")).toBeTruthy();
    expect(screen.getByText("Choose a currency")).toBeTruthy();
    cleanup();
    renderAt(`/insights?accounts=${A3},${EUR}&currency=EUR`);
    const net = (await screen.findByText("Net P&L", { selector: ".ds-label" })).closest(".ds-metric") as HTMLElement;
    expect(within(net).getByText("+€40.00")).toBeTruthy();
  });

  it("separates no closed trades from filters that exclude everything", async () => {
    const user = userEvent.setup();
    renderAt(`/insights?from=2027-01-04`);
    expect(await screen.findByText("No closed trades match these filters")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" }).slice(-1)[0]!);
    expect((await screen.findAllByText("+$68.00")).length).toBeGreaterThan(0);
    holder.store = createJournalStore([makeAccount({ id: "empty", name: "Empty" })], [], "empty");
    cleanup();
    client.clear();
    renderAt("/insights");
    expect(await screen.findByText("No closed trades in these attempts")).toBeTruthy();
  });

  it("calendar: an unknown day shows a dash, a selected day links to its daily review, a week opens its trades", async () => {
    const user = userEvent.setup();
    renderAt("/insights?section=calendar");
    const unknownDay = await screen.findByRole("button", { name: /Tue Oct 20: P&L unknown, 2 trades/ });
    expect(unknownDay.className).not.toMatch(/ds-cal-(profit|loss)/);
    await user.click(screen.getByRole("button", { name: /Mon Oct 19: \+\$42, 2 trades/ }));
    expect(location).toContain("day=2026-10-19");
    const panel = screen.getByRole("complementary", { name: "Selected period" });
    expect(within(panel).getByText("Mon, Oct 19, 2026")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /Open Eval #3 for this day in the Journal/ }).getAttribute("href")).toBe(`/journal/days/2026-10-19?account=${A3}`);
    await user.click(screen.getByRole("button", { name: /^Week 4:/ }));
    await user.click(within(panel).getByRole("button", { name: /view the 4 trades/ }));
    expect(rowsOf(await drawer())).toHaveLength(4);
  });

  it("opens a drilled trade of an archived attempt in the Journal and comes back to the same Insights view", async () => {
    const user = userEvent.setup();
    renderAt(`/insights?accounts=${A2}&basis=gross&section=overview`);
    const net = (await screen.findByText("Gross P&L", { selector: ".ds-label" })).closest(".ds-metric") as HTMLElement;
    await user.click(within(net).getByRole("button", { name: /view the 2 trades/ }));
    const dialog = await drawer();
    await user.click(within(rowsOf(dialog)[0]!).getByRole("rowheader"));
    await waitFor(() => expect(location).toBe(`/journal/trades/a2-1?account=${A2}`));
    expect(await screen.findByText(/archived, read-only/)).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Back to Insights" }));
    await waitFor(() => expect(location).toBe(`/insights?accounts=${A2}&basis=gross&section=overview`));
  });

  it("refreshes after a trade is deleted, and a daily-review write does not reread trade data", async () => {
    const user = userEvent.setup();
    renderAt("/insights", <RemoveButton accountId={A3} tradeId="a3-4" />);
    await screen.findAllByText("+$68.00");
    const before = holder.store.insights.calls.length;
    await act(async () => { await client.invalidateQueries({ queryKey: featureKeys.dailyReviewsAll }); });
    expect(holder.store.insights.calls.length).toBe(before);
    await user.click(screen.getByRole("button", { name: "Delete trade for test" }));
    expect((await screen.findAllByText("+$42.00")).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 deleted left out/)).toBeTruthy();
  });

  it("follows the active account when none is chosen explicitly, without reusing another account's results", async () => {
    renderAt("/insights");
    await screen.findAllByText("+$68.00");
    holder.store.base.settings.set("accounts.active_account_id", EUR);
    await act(async () => { await client.invalidateQueries({ queryKey: featureKeys.settings }); });
    expect((await screen.findAllByText("+€40.00")).length).toBeGreaterThan(0);
    expect(holder.store.insights.calls[holder.store.insights.calls.length - 1]).toEqual({ accountIds: [EUR] });
  });

  it("shows a load failure with retry, never zeros", async () => {
    holder.store.insights.fail();
    renderAt("/insights");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});

describe("Insights metric info (P0-D14)", () => {
  const card = async (label: string) => (await screen.findByText(label, { selector: ".ds-label" })).closest(".ds-metric") as HTMLElement;
  const info = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
    await user.click(within(await card(label)).getByRole("button", { name: `About ${label}` }));
    return screen.findByRole("dialog", { name: `About ${label}` });
  };

  it("puts each headline explanation behind an info button and drops the empty footers", async () => {
    const user = userEvent.setup();
    renderAt("/insights");
    for (const label of ["Net P&L", "Win rate", "Expectancy", "Profit factor", "Average R"]) {
      expect(within(await card(label)).getByRole("button", { name: `About ${label}` })).toBeTruthy();
    }
    for (const label of ["Win rate", "Expectancy", "Profit factor", "Average R"]) expect((await card(label)).querySelector(".ds-metric-foot")).toBeNull();

    expect((await info(user, "Win rate")).textContent).toBe("About Win rateWins ÷ trades with a known result (break-evens count), as in the Journal");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(within(await card("Win rate")).getByRole("button", { name: "About Win rate" }));

    expect((await info(user, "Expectancy")).textContent).toContain("Net P&L ÷ trades with a known result · needs 5");
    await user.keyboard("{Escape}");
    expect((await info(user, "Profit factor")).textContent).toContain("Net P&L · needs 5 trades and a loss");
    await user.keyboard("{Escape}");
    expect((await info(user, "Average R")).textContent).toContain("Net P&L ÷ the review's planned risk (1R), only where recorded");
    await user.keyboard("{Escape}");
    // The reason for N/A stays on the card, not only in the popup.
    expect(within(await card("Average R")).getByText("No trade here has a planned risk in its review")).toBeTruthy();
  });

  it("keeps partial coverage visible on the Net P&L card and repeats it in the info", async () => {
    const user = userEvent.setup();
    renderAt("/insights");
    const net = await card("Net P&L");
    expect(within(net.querySelector(".ds-metric-foot") as HTMLElement).getByText("3 of 4 closed trades with a known P&L")).toBeTruthy();
    expect((await info(user, "Net P&L")).textContent).toContain("3 of 4 closed trades with a known P&L");
  });

  it("drops the Net P&L footer when every trade has a known P&L, keeping the count in the info", async () => {
    const user = userEvent.setup();
    renderAt(`/insights?accounts=${A2}`);
    const net = await card("Net P&L");
    await waitFor(() => expect(within(net).getByText("+$350.00")).toBeTruthy());
    expect(net.querySelector(".ds-metric-foot")).toBeNull();
    expect((await info(user, "Net P&L")).textContent).toContain("2 trades, all with a known P&L");
    await user.click(within(screen.getByRole("group", { name: "P&L basis" })).getByRole("button", { name: "Gross P&L" }));
    expect((await info(user, "Expectancy")).textContent).toContain("Gross P&L ÷ trades with a known result");
  });
});
