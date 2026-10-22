// @vitest-environment jsdom
// Build 26 accessibility regression: axe-core over every route of the real <App /> (empty and populated journals,
// validation errors and open overlays, portals included), plus keyboard-only paths through the shell, menus,
// dialogs, tables, metrics and charts. jsdom has no layout, colour or screen reader: contrast, scaling, zoom and
// NVDA/WebView2 reading are manual checks listed in docs/architecture/build-26-accessibility-journeys.md.
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { createAppStore, makeAccount, makeTrade, type AppStoreSeed } from "../test/app-store";
import { expectNoAxeViolations } from "../test/axe";
import { currentPath, installBrowserShims, pageHeading, renderApp, resetHarness } from "../test/harness";

beforeAll(installBrowserShims);
afterEach(resetHarness);

const populated = (): AppStoreSeed => ({
  accounts: [
    makeAccount({ id: "acct-a", name: "Eval A", propFirm: "Example", broker: "Tradovate", externalRef: "48213" }),
    makeAccount({ id: "acct-b", name: "Eval B", currency: "EUR", timezone: "Europe/Berlin" }),
  ],
  trades: [
    makeTrade({ id: "t1", accountId: "acct-a" }),
    makeTrade({ id: "t2", accountId: "acct-a", symbol: "MNQZ6", realizedPnl: "-50", grossPnl: "-46", tradingDay: "2026-10-20", entryAt: "2026-10-20T13:30:00.000Z", exitAt: "2026-10-20T14:00:00.000Z" }),
    makeTrade({ id: "t3", accountId: "acct-a", symbol: "CLZ6", realizedPnl: null, grossPnl: null, pnlStatus: "missing_instrument", tradingDay: "2026-10-20", entryAt: "2026-10-20T15:30:00.000Z", exitAt: "2026-10-20T16:00:00.000Z" }),
  ],
  activeId: "acct-a",
});

/** Text that shows once each route has loaded its data (so axe scans a settled page, not a spinner). */
const routes: [path: string, emptyReady: RegExp, populatedReady: RegExp][] = [
  ["/", /Add an account to see today's risk/, /How fresh this is/],
  ["/journal", /Add an account to start journaling/, /Trades on/],
  ["/journal/trades/t1", /Add an account to start journaling/, /Correction history/],
  ["/journal/days/2026-10-19", /Pick the account to review/, /Before the session/],
  ["/insights", /Add an account to see Insights/, /Closed-trade net P&L/],
  ["/accounts", /Add your first trading account/, /Search accounts/],
  ["/accounts/acct-a", /This record is no longer available/, /Account settings/],
  ["/accounts/acct-a/rulebook", /This record is no longer available/, /Versions of Example 50K/],
  ["/import", /Add an account first/, /Import into/],
  ["/import/history", /Import history is k/, /Import history is k/],
  ["/settings", /No export yet/, /No export yet/],
];

describe("axe: every route, empty and populated", () => {
  it.each(routes)("%s on an empty journal", async (path, ready) => {
    renderApp(path, { accounts: [] });
    await screen.findAllByText(ready);
    await expectNoAxeViolations();
  });

  it.each(routes)("%s with two accounts and trades", async (path, _empty, ready) => {
    renderApp(path, populated());
    await screen.findAllByText(ready);
    await expectNoAxeViolations();
  });
});

describe("axe: validation errors and open overlays (portals included)", () => {
  it("Add account with field errors and its summary", async () => {
    const { user } = renderApp("/accounts", { accounts: [] });
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add account" });
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    await within(dialog).findByText(/before saving/);
    await expectNoAxeViolations();
  });

  it("an account's actions menu, open", async () => {
    const { user } = renderApp("/accounts/acct-a", populated());
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await screen.findAllByRole("menuitem");
    await expectNoAxeViolations();
  });

  it("the header account selector, open", async () => {
    const { user } = renderApp("/journal", populated());
    await user.click(await screen.findByRole("button", { name: /Eval A/ }));
    await screen.findAllByRole("menuitem");
    await expectNoAxeViolations();
  });

  it("the trade form dialog with errors", async () => {
    const { user } = renderApp("/journal", populated());
    await screen.findAllByText(/Trades on/);
    await user.click(screen.getByRole("button", { name: /Add trade/ }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getAllByRole("button").filter(b => (b as HTMLButtonElement).type === "submit")[0];
    await user.click(save);
    await within(dialog).findByText(/before saving/);
    await expectNoAxeViolations();
  });

  it("the Insights contributing-trades drawer", async () => {
    const { user } = renderApp("/insights", populated());
    await screen.findByText(/Closed-trade net P&L/);
    await user.click(screen.getAllByRole("button", { name: /view the \d+ trades? behind it/ })[0]);
    await screen.findByRole("dialog");
    await expectNoAxeViolations();
  });

  it("the permanent-deletion dialog from Settings", async () => {
    const { user } = renderApp("/settings", populated());
    await user.click(await screen.findByRole("button", { name: "Erase entire journal…" }));
    const dialog = await screen.findByRole("dialog", { name: "Erase the entire local journal?" });
    await within(dialog).findByText(/Archives or CSV files you exported yourself are not touched/);
    await expectNoAxeViolations();
  });
});

describe("keyboard: shell", () => {
  it("offers a skip link first, which moves focus to the main content", async () => {
    const { user } = renderApp("/journal", populated());
    await screen.findAllByText(/Trades on/);
    (document.activeElement as HTMLElement | null)?.blur();
    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(document.activeElement).toBe(skip);
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(document.getElementById("main-content"));
  });

  it("moves focus to the page heading after navigation and marks the active section", async () => {
    const { user } = renderApp("/", populated());
    await screen.findByText(/How fresh this is/);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const journal = within(nav).getByRole("link", { name: "Journal" });
    journal.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(currentPath()).toBe("/journal"));
    await waitFor(() => expect(document.activeElement).toBe(pageHeading()));
    expect(pageHeading().textContent).toBe("Journal");
    expect(journal.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
  });

  it("tabs through the sidebar in visual order and toggles it with Ctrl+B", async () => {
    const { user } = renderApp("/accounts", populated());
    await screen.findByText(/Search accounts/);
    (document.activeElement as HTMLElement | null)?.blur();
    await user.tab(); // skip link
    await user.tab();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(document.activeElement).toBe(toggle);
    // Development builds add the Build 26.9 developer actions directly above Settings.
    const devTools = import.meta.env.DEV ? ["Add Fake Data", "Reset All Data"] : [];
    // Each submenu's chevron follows its section link.
    const expected = ["Today", "Journal", "Journal views", "Insights", "Insights views", "Accounts", "Import Wizard", ...devTools, "Settings"];
    const order: string[] = [];
    for (let i = 0; i < expected.length; i++) { await user.tab(); order.push(document.activeElement?.getAttribute("aria-label") ?? ""); }
    expect(order).toEqual(expected);
    await user.tab({ shift: true });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(expected[expected.length - 2]);
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("keyboard: menus and dialogs", () => {
  it("opens an account menu with Enter, moves with arrows, closes with Escape and returns focus", async () => {
    const { user } = renderApp("/accounts/acct-a", populated());
    const trigger = await screen.findByRole("button", { name: "More account actions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(items).toContain(document.activeElement));
    const first = document.activeElement;
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).not.toBe(first);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("goes from a menu item to the destructive dialog by keyboard, traps Tab inside, and returns focus to the menu button", async () => {
    const { user } = renderApp("/accounts/acct-a", populated());
    const trigger = await screen.findByRole("button", { name: "More account actions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findAllByRole("menuitem");
    // End jumps to the last item (the destructive one, kept apart at the bottom); Enter selects it.
    await user.keyboard("{End}");
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/Delete permanently/));
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: /Permanently delete Example · Eval A/ });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Focus never leaves the modal, forwards or backwards.
    const stops = dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex=\"0\"]").length;
    expect(stops).toBeGreaterThan(1);
    for (let i = 0; i <= stops; i++) { await user.tab(); expect(dialog.contains(document.activeElement)).toBe(true); }
    for (let i = 0; i <= stops; i++) { await user.tab({ shift: true }); expect(dialog.contains(document.activeElement)).toBe(true); }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("puts focus on Cancel first in a confirmation, so Enter never confirms by accident", async () => {
    const { store, user } = renderApp("/accounts/acct-a", populated());
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive…" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Archive Eval A?" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(store.accounts.get("acct-a")!.archivedAt).toBeNull();
    expect(confirm.isConnected).toBe(false);
  });

  it("returns focus to a surviving control after the dialog's own action removes its opener", async () => {
    const store = createAppStore(populated());
    const { user } = renderApp("/accounts/acct-a", store);
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive…" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Archive Eval A?" });
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await screen.findByText("Archived: read-only");
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement?.isConnected).toBe(true);
  });
});

describe("keyboard and semantics: data", () => {
  it("sorts the accounts table from the keyboard and exposes the sort state", async () => {
    const { user } = renderApp("/accounts", populated());
    const table = await screen.findByRole("table", { name: "Accounts" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.length).toBeGreaterThan(2);
    const sortable = within(table).getAllByRole("button").find(b => b.closest("th"))!;
    const th = sortable.closest("th")!;
    const before = th.getAttribute("aria-sort");
    sortable.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(th.getAttribute("aria-sort")).not.toBe(before));
    expect(["ascending", "descending"]).toContain(th.getAttribute("aria-sort"));
    // Rows are named by a row header, so a screen reader reads which account a cell belongs to.
    expect(within(table).getAllByRole("rowheader").length).toBeGreaterThan(0);
  });

  it("names Insights metrics with their basis, keeps unknown P&L out of sums and offers a table for the chart", async () => {
    const { user } = renderApp("/insights", populated());
    await screen.findByText(/Closed-trade net P&L/);
    // The unknown-P&L trade is called out, never counted as zero.
    expect(screen.getAllByRole("button", { name: /Trades with an unknown P&L: view the 1 trade behind it/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/never treated as zero/)).toBeTruthy();
    expect(screen.getByText(/2 of 3 closed trades with a known P&L/)).toBeTruthy();
    // The curve has a text alternative and a table view with named columns.
    // Its ending total is formatted money (format.ts), never raw decimal text or a "0" fallback.
    expect(screen.getByRole("img", { name: /^Closed-trade net P&L: 2 trades, ending at [+−]?\$[\d,]+\.\d{2}\. Use the table view/ })).toBeTruthy();
    const asTable = screen.getByRole("button", { name: "Table" });
    await user.click(asTable);
    expect(asTable.getAttribute("aria-pressed")).toBe("true");
    const table = await screen.findByRole("table", { name: "Closed-trade net P&L by trade" });
    expect(within(table).getAllByRole("columnheader").map(h => h.textContent)).toEqual(expect.arrayContaining(["Trading day", "Result", "Running total"]));
  });
});
