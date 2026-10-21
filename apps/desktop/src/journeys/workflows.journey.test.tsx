// @vitest-environment jsdom
// Build 26 cross-feature journeys through the real <App />: CSV import into Journal/Today/Insights, Today's risk
// after a Journal correction, attempt lineage, Insights drill-down into the Journal and back, and the daily review.
// Feature-level states (every Today status, review conflicts, import parsing) stay in each feature's own tests; these
// assert what only shows across routes: invalidation, account/attempt isolation and preserved context. Native
// rules (duplicate detection per attempt, trading-day and DST derivation, stored P&L) are inherited from the Rust
// tests and goldens, not proven by these fakes.
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { RepositoryError } from "@fundedflow/domain";
import { ACTIVE_ACCOUNT_SETTING } from "../features/accounts/active-account";
import { goldenCase } from "../features/imports/test-store";
import { drawdownOutcome } from "../features/today/test-store";
import { createAppStore, makeAccount, makeTrade, type AppStore } from "../test/app-store";
import { currentPath, installBrowserShims, renderApp, resetHarness } from "../test/harness";

beforeAll(installBrowserShims);
afterEach(resetHarness);

const nav = () => screen.getByRole("navigation", { name: "Primary navigation" });
const go = async (user: ReturnType<typeof renderApp>["user"], section: string) => user.click(within(nav()).getByRole("link", { name: section }));
const risk = () => screen.getByRole("region", { name: "Risk estimate" });
const headline = async () => (await within(risk()).findByRole("status")).textContent ?? "";
const NOW = "2026-10-21T18:00:00.000Z";
const CUTOFF = "2026-10-21T17:00:00.000Z";

async function assignCatalogue(store: AppStore, accountId: string) {
  await store.today.repository.rulebooks.assign(
    { accountId, rulebookVersionId: store.today.verifiedVersionId, effectiveFrom: "2026-10-19", programmePhaseId: null, phasePathId: null, accountPhaseEventId: null },
    { expectedOpenAssignmentId: null, actor: "local_user", reason: "Start" },
  );
}
/** A saved Safe estimate at the cutoff; its inputs hash is the real engine's for the store's current trades. */
async function saveSafe(store: AppStore, accountId: string) {
  const ids = [...store.trades.values()].filter(r => r.trade.accountId === accountId).map(r => r.trade.id);
  return store.today.saveEstimate(accountId, CUTOFF, r => ({ ...r, status: "Safe", reasons: [], balance: "52125.5", rules: [drawdownOutcome({ headroom: "2125.5", sourceReferences: ids })] }));
}

describe("import to every view", () => {
  it("imports a CSV into the active attempt, and Journal, Today and Insights show it without a reload", async () => {
    const store = createAppStore({ accounts: [makeAccount({ id: "acct-a", name: "Eval A" })], activeId: "acct-a" });
    const { user } = renderApp("/journal", store);
    // Warm the caches with the empty account.
    expect(await screen.findByText(/No trades in this account yet/)).toBeTruthy();
    await go(user, "Insights");
    expect(await screen.findByText(/No closed trades in these attempts/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Import CSV" }));
    await waitFor(() => expect(currentPath()).toBe("/import"));
    const golden = goldenCase("generic-fees-and-duplicate");
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File([golden.request.content], "statement.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: "Check the file" }));
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    await user.click(await screen.findByRole("button", { name: "Continue with 1 trade" }));
    await user.click(await screen.findByRole("button", { name: "Import 1 trade into Eval A" }));
    expect(await screen.findByRole("heading", { name: "Imported 1 trade into Eval A" })).toBeTruthy();
    expect(store.imports.repository.commit).toHaveBeenCalledTimes(1);
    expect(store.imports.repository.commit.mock.calls[0][0]).toMatchObject({ accountId: "acct-a" });

    await go(user, "Journal");
    expect(await screen.findByText("MNQZ6")).toBeTruthy();
    await go(user, "Insights");
    expect(await screen.findByText(/Eval A · 1 trade included/)).toBeTruthy();
    await go(user, "Today");
    const fresh = await screen.findByRole("region", { name: "How fresh this is" });
    expect(await within(fresh).findByText(/statement\.csv|1 trade/)).toBeTruthy();
  });

  it("after a lost commit answer keeps the file and context, never imports again by itself, and adds no trades", async () => {
    const store = createAppStore({ accounts: [makeAccount({ id: "acct-a", name: "Eval A" })], activeId: "acct-a" });
    const { user } = renderApp("/import", store);
    const golden = goldenCase("generic-fees-and-duplicate");
    await screen.findByRole("combobox", { name: "Import into" });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File([golden.request.content], "statement.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: "Check the file" }));
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    await user.click(await screen.findByRole("button", { name: "Continue with 1 trade" }));
    const lost = store.hold("imports.commit");
    await user.click(await screen.findByRole("button", { name: "Import 1 trade into Eval A" }));
    await act(() => lost.fail(new RepositoryError({ kind: "database", message: "connection reset" })));
    expect(await screen.findByRole("heading", { name: "Couldn't confirm the import finished" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again|Import 1 trade/ })).toBeNull();
    expect(lost.calls).toHaveLength(1);
    expect(store.trades.size).toBe(0);
    // The safe way on is the same attempt's history, not a resend.
    await user.click(screen.getByRole("button", { name: "Check import history" }));
    await waitFor(() => expect(currentPath()).toBe("/import/history"));
    expect(lost.calls).toHaveLength(1);
    await go(user, "Journal");
    expect(await screen.findByText(/No trades in this account yet/)).toBeTruthy();
  });

  it("imports into the chosen attempt when an earlier attempt reuses the account number, and never shows it on the other", async () => {
    const store = createAppStore({
      accounts: [
        makeAccount({ id: "acct-1", name: "PA-1", broker: "Tradovate", externalRef: "999", status: "failed", successorAccountId: "acct-2" }),
        makeAccount({ id: "acct-2", name: "PA-1 retry", broker: "Tradovate", externalRef: "999", predecessorAccountId: "acct-1" }),
      ],
      trades: [makeTrade({ id: "old", accountId: "acct-1", symbol: "MESZ6" })],
      activeId: "acct-2",
    });
    const { user } = renderApp("/import", store);
    expect(await screen.findByText("Another account uses the same account number")).toBeTruthy();
    const golden = goldenCase("generic-fees-and-duplicate");
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File([golden.request.content], "statement.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: "Check the file" }));
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    await user.click(await screen.findByRole("button", { name: "Continue with 1 trade" }));
    await user.click(await screen.findByRole("button", { name: "Import 1 trade into PA-1 retry" }));
    await screen.findByRole("heading", { name: "Imported 1 trade into PA-1 retry" });
    // Duplicate checks are per attempt (native); the frontend sends and stores the chosen attempt only.
    expect(store.imports.previews.every(p => p.accountId === "acct-2")).toBe(true);
    expect([...store.trades.values()].filter(r => r.trade.accountId === "acct-2").map(r => r.trade.symbol)).toEqual(["MNQZ6"]);
    await go(user, "Journal");
    expect(await screen.findByText("MNQZ6")).toBeTruthy();
    expect(screen.queryByText("MESZ6")).toBeNull();
  });
});

describe("Today's risk across features", () => {
  it("a Safe estimate stops being Safe once a trade before its cutoff is corrected in the Journal", async () => {
    vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
    const store = createAppStore({
      accounts: [makeAccount({ id: "acct-a", name: "Eval A", propFirm: "Example" })],
      trades: [makeTrade({ id: "t1", accountId: "acct-a", tradingDay: "2026-10-20", entryAt: "2026-10-20T14:00:00.000Z", exitAt: "2026-10-20T14:30:00.000Z" })],
      activeId: "acct-a",
    });
    await assignCatalogue(store, "acct-a");
    await saveSafe(store, "acct-a");
    const { user } = renderApp("/", store);
    await waitFor(async () => expect(await headline()).toContain("Safe (estimate)"));

    window.location.hash = "/journal/trades/t1";
    await user.click(await screen.findByRole("button", { name: "Correct trade" }));
    const dialog = await screen.findByRole("dialog", { name: /Correct ESZ6 trade/ });
    const fees = within(dialog).getByLabelText(/^Fees/);
    await user.clear(fees);
    await user.type(fees, "9");
    await user.type(within(dialog).getByLabelText(/^Reason/), "statement");
    await user.click(within(dialog).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await go(user, "Today");
    await waitFor(async () => expect(await headline()).toMatch(/^Unknown/));
    expect(within(risk()).getByText(/have changed since it was calculated/)).toBeTruthy();
    expect(within(risk()).queryByText(/^Safe/)).toBeNull();
  });
});

describe("Today's statuses are words with an icon", () => {
  it.each([
    ["Caution", "Caution (estimate)"],
    ["Stop", "Stop"],
  ] as const)("renders a saved %s estimate as its label and icon, never as Safe", async (status, label) => {
    vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
    const store = createAppStore({
      accounts: [makeAccount({ id: "acct-a", name: "Eval A", propFirm: "Example" })],
      trades: [makeTrade({ id: "t1", accountId: "acct-a", tradingDay: "2026-10-20", entryAt: "2026-10-20T14:00:00.000Z", exitAt: "2026-10-20T14:30:00.000Z" })],
    });
    await assignCatalogue(store, "acct-a");
    await store.today.saveEstimate("acct-a", CUTOFF, r => ({ ...r, status, reasons: ["loss_threshold_breached"], balance: "50100",
      rules: [drawdownOutcome({ headroom: status === "Stop" ? "0" : "150", state: status === "Stop" ? "breached" : "caution", reasonCode: status === "Stop" ? "loss_threshold_breached" : "near_limit" })] }));
    renderApp("/", store);
    await waitFor(async () => expect(await headline()).toContain(label));
    const badge = within(risk()).getByText(label).closest(".ds-status") as HTMLElement;
    expect(badge.querySelector("svg")).toBeTruthy();
    expect(within(risk()).queryByText(/^Safe/)).toBeNull();
  });

  it("with a rulebook but no trades and nothing calculated, is Unknown and shows no $0.00", async () => {
    vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
    const store = createAppStore({ accounts: [makeAccount({ id: "acct-a", name: "Eval A", propFirm: "Example" })] });
    await assignCatalogue(store, "acct-a");
    renderApp("/", store);
    await waitFor(async () => expect(await headline()).toContain("Unknown"));
    expect(within(risk()).queryByText("$0.00")).toBeNull();
    expect(within(risk()).queryByText(/Safe/)).toBeNull();
  });
});

describe("attempt lineage", () => {
  it("fails an attempt, starts a linked one with the same number, and the new attempt shows no carried-over risk or trades", async () => {
    vi.useFakeTimers({ now: new Date(NOW), shouldAdvanceTime: true, toFake: ["Date"] });
    const store = createAppStore({
      accounts: [makeAccount({ id: "acct-a", name: "PA-48213", propFirm: "Example", externalRef: "48213" })],
      trades: [makeTrade({ id: "t1", accountId: "acct-a", tradingDay: "2026-10-20", entryAt: "2026-10-20T14:00:00.000Z", exitAt: "2026-10-20T14:30:00.000Z" })],
      activeId: "acct-a",
    });
    await assignCatalogue(store, "acct-a");
    await saveSafe(store, "acct-a");
    const { user } = renderApp("/", store);
    await waitFor(async () => expect(await headline()).toContain("Safe (estimate)"));

    window.location.hash = "/accounts/acct-a";
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Start new attempt…" }));
    const dialog = await screen.findByRole("dialog", { name: /Start a new attempt after PA-48213/ });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(await within(dialog).findByRole("radio", { name: "Failed" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    for (const [label, text] of [[/Account number/, "48213"], [/Starting balance/, "50000"]] as const) {
      await user.click(within(dialog).getByRole("textbox", { name: label }));
      await user.paste(text);
    }
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(await within(dialog).findByRole("radio", { name: /Decide later/ }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Start new attempt" }));
    const done = await screen.findByRole("dialog", { name: "New attempt started" });
    await user.click(within(done).getByRole("button", { name: "Use it as the active account" }));
    await waitFor(() => expect(store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-1"));

    // Distinct local ids for the same provider number; the old attempt and its trade are kept.
    expect(store.accounts.get("acct-a")).toMatchObject({ status: "failed", successorAccountId: "acct-1", externalRef: "48213" });
    expect(store.accounts.get("acct-1")).toMatchObject({ predecessorAccountId: "acct-a", externalRef: "48213" });
    expect(store.trades.get("t1")?.trade.accountId).toBe("acct-a");

    await go(user, "Today");
    await waitFor(async () => expect(await headline()).toContain("Unknown"));
    expect(screen.queryByText(/Safe \(estimate\)/)).toBeNull();
    expect(screen.queryByText("$2,125.50")).toBeNull();
    await go(user, "Journal");
    expect(await screen.findByText(/No trades in this account yet/)).toBeTruthy();
    expect(screen.queryByText("ESZ6")).toBeNull();
  });
});

describe("attempt history", () => {
  it("archives a failed attempt read-only and restores it from the archive, keeping its id, link and trades", async () => {
    const store = createAppStore({
      accounts: [
        makeAccount({ id: "acct-a", name: "PA-1", externalRef: "48213", status: "failed", successorAccountId: "acct-b" }),
        makeAccount({ id: "acct-b", name: "PA-1 retry", externalRef: "48213", predecessorAccountId: "acct-a" }),
      ],
      trades: [makeTrade({ id: "t1", accountId: "acct-a" })],
      activeId: "acct-b",
    });
    const { user } = renderApp("/accounts/acct-a", store);
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive…" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Archive PA-1?" })).getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Archived: read-only")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore from archive" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Restore PA-1?" })).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(store.accounts.get("acct-a")!.archivedAt).toBeNull());
    expect(store.accounts.get("acct-a")).toMatchObject({ status: "failed", successorAccountId: "acct-b" });
    expect(store.trades.get("t1")?.trade.accountId).toBe("acct-a");
    // Restoring history doesn't make it the active attempt.
    expect(store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-b");
  });
});

describe("trade review to the Journal", () => {
  it("keeps the review's edits after a failed save, then saves and the Journal list shows it reviewed", async () => {
    const store = createAppStore({ accounts: [makeAccount({ id: "acct-a", name: "Eval A" })], trades: [makeTrade({ id: "t1", accountId: "acct-a" })], activeId: "acct-a" });
    const { user } = renderApp("/journal", store);
    const day = await screen.findByRole("table", { name: /Trades on/ });
    expect(within(day).getByText("Not yet")).toBeTruthy();
    await user.click(within(day).getByRole("rowheader", { name: /ESZ6/ }));
    await waitFor(() => expect(currentPath()).toBe("/journal/trades/t1"));
    const review = await screen.findByRole("form", { name: "Trade review" });
    await user.click(within(review).getByRole("checkbox", { name: /Reviewed/ }));
    const failing = store.hold("reviews.save");
    await user.click(within(review).getByRole("button", { name: "Save review" }));
    await act(() => failing.fail(new RepositoryError({ kind: "validation", message: "invalid", issues: [{ field: "thesis", message: "Too long" }] })));
    expect((within(review).getByRole("checkbox", { name: /Reviewed/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(review).getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(store.journal.reviews.get("t1")?.reviewedAt).not.toBeNull());
    await go(user, "Journal");
    expect(await within(await screen.findByRole("table", { name: /Trades on|Trade log/ })).findByText("Reviewed")).toBeTruthy();
  });
});

describe("Insights drill-down and back", () => {
  it("keeps the URL filters and exact contributing trades through the trade page and back", async () => {
    const store = createAppStore({
      accounts: [makeAccount({ id: "acct-a", name: "Eval A" }), makeAccount({ id: "acct-b", name: "Eval B" })],
      trades: [
        makeTrade({ id: "a1", accountId: "acct-a", realizedPnl: "96", grossPnl: "100" }),
        makeTrade({ id: "a2", accountId: "acct-a", symbol: "MNQZ6", realizedPnl: "-46", grossPnl: "-40", tradingDay: "2026-10-20", entryAt: "2026-10-20T13:30:00.000Z", exitAt: "2026-10-20T14:00:00.000Z" }),
        makeTrade({ id: "b1", accountId: "acct-b", symbol: "CLZ6", realizedPnl: "500", grossPnl: "500" }),
      ],
      activeId: "acct-a",
    });
    const { user } = renderApp("/insights?accounts=acct-a&basis=gross&section=overview", store);
    const gross = (await screen.findByText("Gross P&L", { selector: ".ds-label" })).closest(".ds-metric") as HTMLElement;
    await user.click(within(gross).getByRole("button", { name: /view the 2 trades/ }));
    const drawer = await screen.findByRole("dialog", { name: /Gross P&L/ });
    const table = within(drawer).getByRole("table");
    const symbols = within(table).getAllByRole("rowheader").map(r => r.textContent);
    expect(symbols).toHaveLength(2);
    expect(within(table).queryByText(/CLZ6/)).toBeNull();
    await user.click(within(table).getAllByRole("rowheader")[0]!);
    await waitFor(() => expect(currentPath()).toMatch(/^\/journal\/trades\/a[12]\?account=acct-a$/));
    await user.click(await screen.findByRole("link", { name: "Back to Insights" }));
    await waitFor(() => expect(currentPath()).toBe("/insights?accounts=acct-a&basis=gross&section=overview"));
    expect(await screen.findByText("Gross P&L", { selector: ".ds-label" })).toBeTruthy();
  });
});

describe("daily review from Today and back", () => {
  it("opens the active account's trading day from Today, shows its trades in the account's zone across the DST change, and links to a trade", async () => {
    // 2026-10-26: Berlin has left summer time (UTC+1), New York hasn't (UTC-4).
    vi.useFakeTimers({ now: new Date("2026-10-26T18:00:00.000Z"), shouldAdvanceTime: true, toFake: ["Date"] });
    const store = createAppStore({
      accounts: [makeAccount({ id: "acct-eu", name: "Eurex", timezone: "Europe/Berlin", tradingDayResetTime: "00:00", currency: "EUR" })],
      trades: [makeTrade({ id: "fdax", accountId: "acct-eu", symbol: "FDAXZ6", tradingDay: "2026-10-26", entryAt: "2026-10-26T08:00:00.000Z", exitAt: "2026-10-26T08:30:00.000Z" })],
      activeId: "acct-eu",
      currentDay: "2026-10-26",
    });
    const { user } = renderApp("/", store);
    await user.click(await screen.findByRole("button", { name: /Review session/ }));
    await waitFor(() => expect(currentPath()).toBe("/journal/days/2026-10-26?account=acct-eu"));
    const trades = await screen.findByRole("table", { name: /Trades on Mon, Oct 26, 2026/ });
    // 08:00 UTC is 09:00 in Berlin after the change (it would be 10:00 before it).
    expect(within(trades).getByText(/09:00/)).toBeTruthy();
    await user.click(within(trades).getByRole("rowheader", { name: /FDAXZ6/ }));
    await waitFor(() => expect(currentPath()).toBe("/journal/trades/fdax"));
    expect(await screen.findByText(/FDAXZ6/)).toBeTruthy();
  });
});
