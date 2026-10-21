// @vitest-environment jsdom
// Build 15 workflows through the real pages, Build 13 components and Build 14 hooks. The repository is an
// in-memory test store (synthetic data) and the runtime is mocked ready unless a test says otherwise.
import { RepositoryError } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { ACTIVE_ACCOUNT_SETTING } from "./active-account";
import { AccountDetailPage } from "./components/AccountDetailPage";
import { AccountsPage } from "./components/AccountsPage";
import { AccountSwitcher } from "./components/AccountSwitcher";
import { createTestStore, makeAccount } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTestStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const ready = () => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 13, supportedSchemaVersion: 13, created: false, failure: null } } as unknown as RuntimeState;
};
let client: QueryClient;
let location = "";
function Where() {
  location = useLocation().pathname;
  return null;
}
function renderApp(path = "/accounts", extra?: ReactNode) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <AccountSwitcher />
          {extra}
          <Routes>
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ready();
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  holder.store = createTestStore();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

/**
 * Fills the minimum fields. Values are pasted (Build 26.7): typing them key by key cost ~20 ms a key and pushed
 * these tests past 5 s under CPU contention. Per-key field behaviour is covered by the design-system tests.
 */
async function fillMinimumAccount(user: ReturnType<typeof userEvent.setup>, name = "Eval 50K") {
  const dialog = await screen.findByRole("dialog", { name: "Add account" });
  const enter = async (field: HTMLElement, text: string) => { await user.clear(field); await user.click(field); await user.paste(text); };
  await enter(within(dialog).getByRole("textbox", { name: /Account name/ }), name);
  await enter(within(dialog).getByRole("textbox", { name: /Starting balance/ }), "50000");
  await enter(within(dialog).getByRole("combobox", { name: /Time zone/ }), "America/New_York");
  return dialog;
}

describe("first run and onboarding", () => {
  it("shows a first-run empty state and creates the first account with minimum fields, which becomes active", async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByText("Add your first trading account")).toBeTruthy();
    expect(screen.getByText("No account yet · Add one")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Add account" })[0]);
    const dialog = await fillMinimumAccount(user);
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(location).toBe("/accounts/acct-1"));
    const saved = holder.store.accounts.get("acct-1")!;
    expect(saved).toMatchObject({ name: "Eval 50K", startingBalance: "50000", currency: "USD", timezone: "America/New_York", propFirm: null, tradingDayResetTime: "00:00" });
    await waitFor(() => expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-1"));
    expect(await screen.findByRole("heading", { name: "Eval 50K", level: 2 })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Active account").length).toBeGreaterThan(0));
  });

  it("saves a prop account without a firm or rulebook and marks it Needs setup, with risk unknown", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await fillMinimumAccount(user);
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    await screen.findByRole("heading", { name: "Eval 50K", level: 2 });
    expect(await screen.findAllByText("Needs setup")).toBeTruthy();
    expect(screen.getByText("Firm not set")).toBeTruthy();
    expect(screen.getByText("No rulebook")).toBeTruthy();
    expect(screen.getByText("Not calculated yet")).toBeTruthy();
    expect(screen.queryByText(/^Safe$/)).toBeNull();
  });

  it("doesn't ask a personal account for a firm or rulebook", async () => {
    holder.store = createTestStore([makeAccount({ id: "p1", name: "IBKR cash", accountType: "personal" })]);
    renderApp("/accounts/p1");
    await screen.findByRole("heading", { name: "IBKR cash", level: 2 });
    expect(await screen.findByText(/personal, demo and other accounts don't need a firm or rulebook/)).toBeTruthy();
    expect(screen.queryByText("Needs setup")).toBeNull();
  });

  it("shows friendly field errors and a summary for invalid balance, currency and time zone, without saving", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(holder.store.repository.accounts, "create");
    renderApp();
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add account" });
    await user.type(within(dialog).getByRole("textbox", { name: /Starting balance/ }), "1,000");
    const currency = within(dialog).getByRole("combobox", { name: /Currency/ });
    await user.clear(currency);
    await user.type(currency, "XQQ");
    const zone = within(dialog).getByRole("combobox", { name: /Time zone/ });
    await user.clear(zone);
    await user.type(zone, "Mars/Olympus");
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    const summary = await within(dialog).findByRole("alert");
    expect(summary.textContent).toMatch(/Fix 4 problems/);
    expect(within(dialog).getByText("Required")).toBeTruthy();
    expect(within(dialog).getAllByText(/Use a number such as 50000/)).toHaveLength(2); // field and summary
    expect(within(dialog).getAllByText(/XQQ isn't a currency code/)).toHaveLength(2);
    expect(within(dialog).getAllByText(/Use a time zone name such as America\/New_York/)).toHaveLength(2);
    expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: /Account name/ }));
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps entered values after a backend failure and maps its field message", async () => {
    const user = userEvent.setup();
    vi.spyOn(holder.store.repository.accounts, "create").mockRejectedValueOnce(
      new RepositoryError({ kind: "validation", message: "x", issues: [{ field: "timezone", message: "is not a known time zone" }] }),
    );
    renderApp();
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await fillMinimumAccount(user);
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    expect(await within(dialog).findByText("Is not a known time zone")).toBeTruthy();
    expect((within(dialog).getByRole("textbox", { name: /Account name/ }) as HTMLInputElement).value).toBe("Eval 50K");
    expect(within(dialog).getByText(/Time zone is not a known time zone/)).toBeTruthy();
    expect(holder.store.accounts.size).toBe(0);
  });

  it("creates one account when Save is pressed twice", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const original = holder.store.repository.accounts.create;
    const create = vi.spyOn(holder.store.repository.accounts, "create").mockImplementation(input => new Promise(resolve => (release = () => resolve(original(input)))));
    renderApp();
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await fillMinimumAccount(user);
    const save = within(dialog).getByRole("button", { name: "Add account" });
    await user.click(save);
    await user.click(within(dialog).getByRole("button", { name: "Saving…" }));
    await user.keyboard("{Enter}");
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(location).toBe("/accounts/acct-1"));
    expect(holder.store.accounts.size).toBe(1);
  });
});

describe("list, states and selection", () => {
  const seed = () => [
    makeAccount({ id: "a", name: "PA-48213", propFirm: "Apex", broker: "Tradovate", externalRef: "48213" }),
    makeAccount({ id: "b", name: "Combine #2", propFirm: "Topstep", status: "failed" }),
    makeAccount({ id: "c", name: "A very long account name that keeps going well past the width of its column to test truncation", accountType: "personal", currency: "EUR", startingBalance: "12480.55" }),
    makeAccount({ id: "d", name: "Old eval", archivedAt: "2026-10-01T00:00:00.000Z" }),
  ];

  it("lists live accounts by default with status filters, counts and per-currency starting balances", async () => {
    holder.store = createTestStore(seed());
    const user = userEvent.setup();
    renderApp();
    const table = await screen.findByRole("table", { name: "Accounts" });
    expect(within(table).getAllByRole("rowheader").map(r => r.textContent)).toEqual([
      expect.stringContaining("A very long account name"),
      expect.stringContaining("Apex"),
    ]);
    expect(within(table).getByText("€12,480.55")).toBeTruthy();
    expect(within(table).getByText("$50,000.00")).toBeTruthy();
    const filters = screen.getByRole("group", { name: "Show" });
    expect(within(filters).getByRole("button", { name: "Failed 1" })).toBeTruthy();
    await user.click(within(filters).getByRole("button", { name: "Archived 1" }));
    expect(within(screen.getByRole("table", { name: "Accounts" })).getByText("Old eval")).toBeTruthy();
    expect(screen.getByText("Current balance")).toBeTruthy();
    expect(screen.getAllByText(/Currencies are never added together/).length).toBeGreaterThan(0);
  });

  it("searches name, firm and number, and offers to clear a search with no matches", async () => {
    holder.store = createTestStore(seed());
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("table", { name: "Accounts" });
    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "48213");
    expect(within(screen.getByRole("table", { name: "Accounts" })).getAllByRole("rowheader")).toHaveLength(1);
    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "zzz");
    expect(await screen.findByText("No accounts match this search and filter.")).toBeTruthy();
  });

  it("shows an error, never an empty journal, when accounts can't be read", async () => {
    vi.spyOn(holder.store.repository.accounts, "list").mockRejectedValue(new RepositoryError({ kind: "database", message: "SELECT secret" }));
    renderApp();
    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alert.textContent).toContain("could not be completed");
    expect(screen.queryByText("Add your first trading account")).toBeNull();
    expect(document.body.textContent).not.toContain("SELECT");
  });

  it("shows unavailable local data distinctly from no accounts", () => {
    runtime.state = { kind: "unavailable", status: null, reason: "rejected" } as unknown as RuntimeState;
    renderApp();
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.queryByText("Add your first trading account")).toBeNull();
  });

  it("switches the active account by id and keeps each account's data separate", async () => {
    holder.store = createTestStore(seed());
    holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, "a");
    holder.store.tradeCounts.set("a", 3);
    const user = userEvent.setup();
    renderApp("/accounts/a");
    await screen.findByRole("heading", { name: "Apex · PA-48213", level: 2 });
    const switcher = await screen.findByRole("button", { name: /Apex · PA-48213/ });
    await user.click(switcher);
    await user.click(await screen.findByRole("menuitem", { name: /A very long account name/ }));
    await waitFor(() => expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("c"));
    await waitFor(() => expect(screen.getByRole("button", { name: /A very long account name/ })).toBeTruthy());
    // Detail pages read their own account; the other account's trades never show.
    expect(await screen.findByText("Trades")).toBeTruthy();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("reports an archived active account and asks for a new choice instead of keeping it", async () => {
    holder.store = createTestStore(seed());
    holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, "d");
    renderApp();
    expect(await screen.findByRole("button", { name: /Old eval was archived · choose an account/ })).toBeTruthy();
  });
});

describe("editing", () => {
  it("prefills saved values, warns about re-derived trades, and asks before discarding edits", async () => {
    holder.store = createTestStore([makeAccount({ id: "a", name: "PA-48213", propFirm: "Apex", notes: "Keep it small" })]);
    holder.store.tradeCounts.set("a", 12);
    const user = userEvent.setup();
    renderApp("/accounts/a");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit PA-48213" });
    expect((within(dialog).getByRole("textbox", { name: /Notes/ }) as HTMLTextAreaElement).value).toBe("Keep it small");
    expect((within(dialog).getByRole("combobox", { name: /Prop firm/ }) as HTMLInputElement).value).toBe("Apex");
    const zone = within(dialog).getByRole("combobox", { name: /Time zone/ });
    await user.clear(zone);
    await user.type(zone, "Europe/London");
    expect(await within(dialog).findByText(/re-derives the trading day and P&L of 12 recorded trades/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Discard your changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Edit PA-48213" })).toBeTruthy();
    expect((within(dialog).getByRole("combobox", { name: /Time zone/ }) as HTMLInputElement).value).toBe("Europe/London");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(holder.store.accounts.get("a")!.timezone).toBe("Europe/London"));
    expect(await screen.findByText(/Europe\/London \(now/)).toBeTruthy();
  });

  it("makes archived accounts read-only", async () => {
    holder.store = createTestStore([makeAccount({ id: "a", name: "Old", archivedAt: "2026-10-01T00:00:00.000Z" })]);
    renderApp("/accounts/a");
    expect(await screen.findByText("Archived: read-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore from archive" })).toBeTruthy();
  });
});

describe("lifecycle", () => {
  it("marks an account failed with an unknown cause, keeps it, and shows the event", async () => {
    holder.store = createTestStore([makeAccount({ id: "a", name: "Combine" })]);
    const change = vi.spyOn(holder.store.repository.accounts, "changeStatus");
    const user = userEvent.setup();
    renderApp("/accounts/a");
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark failed…" }));
    const dialog = await screen.findByRole("dialog", { name: "Change status of Combine" });
    expect((within(dialog).getByRole("radio", { name: "Failed" }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Mark failed" }));
    await waitFor(() => expect(holder.store.accounts.get("a")!.status).toBe("failed"));
    expect(change.mock.calls[0][1]).toMatchObject({ status: "failed", cause: null, note: null });
    expect(holder.store.accounts.get("a")!.archivedAt).toBeNull();
    expect(await screen.findByText("Failed attempt")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findAllByText("Cause not recorded")).toHaveLength(2); // created active, then failed
  });

  it("archives and restores without deleting, and reports a restore conflict safely", async () => {
    holder.store = createTestStore([
      makeAccount({ id: "a", name: "First", broker: "Tradovate", externalRef: "999" }),
      makeAccount({ id: "b", name: "Second", broker: "Tradovate", externalRef: "999", archivedAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    const user = userEvent.setup();
    renderApp("/accounts/b");
    await user.click(await screen.findByRole("button", { name: "Restore from archive" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Restore Second?" });
    await user.click(within(confirm).getByRole("button", { name: "Restore" }));
    expect(await within(confirm).findByText(/Another active or paused account already uses this broker account number/)).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(holder.store.accounts.get("b")!.archivedAt).not.toBeNull();
  });

  it("archives an account: it leaves the live list and stays browsable", async () => {
    holder.store = createTestStore([makeAccount({ id: "a", name: "First" })]);
    const user = userEvent.setup();
    renderApp("/accounts/a");
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive…" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Archive First?" })).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(holder.store.accounts.get("a")!.archivedAt).not.toBeNull());
    expect(holder.store.accounts.size).toBe(1);
    expect(await screen.findByText("Archived: read-only")).toBeTruthy();
  });
});

describe("new attempt", () => {
  async function walkReset(user: ReturnType<typeof userEvent.setup>, ref = "48213") {
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Start new attempt…" }));
    const dialog = await screen.findByRole("dialog", { name: /Start a new attempt after PA-48213/ });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect((await within(dialog).findAllByText(/Confirm how the previous attempt ended/)).length).toBeGreaterThan(0);
    await user.click(within(dialog).getByRole("radio", { name: "Failed" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.type(within(dialog).getByRole("textbox", { name: /Account number/ }), ref);
    await user.type(within(dialog).getByRole("textbox", { name: /Starting balance/ }), "50000");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(await within(dialog).findByRole("radio", { name: /Decide later/ }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText(/Its trades, imports, journal, history and rulebook evidence are kept/)).toBeTruthy();
    return dialog;
  }

  it("creates a linked attempt with the same broker number, keeps the old one and its records, and shows lineage", async () => {
    holder.store = createTestStore([makeAccount({ id: "a", name: "PA-48213", propFirm: "Apex", externalRef: "48213" })]);
    holder.store.tradeCounts.set("a", 7);
    const user = userEvent.setup();
    renderApp("/accounts/a");
    const dialog = await walkReset(user);
    await user.click(within(dialog).getByRole("button", { name: "Start new attempt" }));
    const done = await screen.findByRole("dialog", { name: "New attempt started" });
    expect(within(done).getByText("PA-48213 · attempt 2")).toBeTruthy();
    const [pred, succ] = [holder.store.accounts.get("a")!, holder.store.accounts.get("acct-1")!];
    expect(pred).toMatchObject({ status: "failed", successorAccountId: "acct-1", externalRef: "48213", archivedAt: null });
    expect(succ).toMatchObject({ predecessorAccountId: "a", externalRef: "48213", startingBalance: "50000", status: "active" });
    expect(holder.store.links[0]).toMatchObject({ priorOutcome: "failed", rulebookDecision: "deferred" });
    await user.click(within(done).getByRole("button", { name: "Use it as the active account" }));
    await waitFor(() => expect(holder.store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-1"));
    await waitFor(() => expect(location).toBe("/accounts/acct-1"));
    await user.click(await screen.findByRole("tab", { name: /Attempts/ }));
    const table = await screen.findByRole("table", { name: "Attempts" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("7")).toBeTruthy(); // the old attempt keeps its trades
  });

  it("keeps the inputs and creates nothing when the reset fails", async () => {
    holder.store = createTestStore([makeAccount({ id: "a", name: "PA-48213", externalRef: "48213" })]);
    vi.spyOn(holder.store.repository.accounts, "resetAttempt").mockRejectedValueOnce(new RepositoryError({ kind: "conflict", message: "already reset" }));
    const user = userEvent.setup();
    renderApp("/accounts/a");
    const dialog = await walkReset(user);
    await user.click(within(dialog).getByRole("button", { name: "Start new attempt" }));
    expect(await within(dialog).findByText(/conflicts with an existing record/)).toBeTruthy();
    expect(holder.store.accounts.size).toBe(1);
    expect(holder.store.accounts.get("a")!.status).toBe("active");
    expect(within(dialog).getByText("PA-48213 · attempt 2")).toBeTruthy();
  });
});
