// @vitest-environment jsdom
// Build 26 cross-feature journeys: account setup, active-account selection, rulebook assignment and attempt
// lineage, through the real <App /> routes and providers. Only the repository, the Tauri runtime bridge and the
// native file dialog are fakes (src/test/boundaries.ts); see docs/architecture/build-26-accessibility-journeys.md.
import { RepositoryError } from "@fundedflow/domain";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { ACTIVE_ACCOUNT_SETTING } from "../features/accounts/active-account";
import { createAppStore, makeAccount, makeTrade } from "../test/app-store";
import { currentPath, installBrowserShims, renderApp, resetHarness, warmUpApp } from "../test/harness";

beforeAll(installBrowserShims);
beforeAll(warmUpApp);
afterEach(resetHarness);

const nav = () => screen.getByRole("navigation", { name: "Primary navigation" });
/**
 * Replaces a field's value in one paste: per-keystroke field behaviour is the Accounts feature tests' job, and
 * typing key by key cost ~0.3–0.8 s a field under CPU load.
 */
const fill = async (user: ReturnType<typeof renderApp>["user"], field: HTMLElement, text: string) => {
  await user.clear(field);
  await user.click(field);
  await user.paste(text);
};
const risk = () => screen.getByRole("region", { name: "Risk estimate" });

describe("first run to a configured account", () => {
  it("creates the first account from Accounts, makes it active, and shows Today as Unknown with setup needed", async () => {
    const { store, user } = renderApp("/");
    // Today on an empty journal: no figures, a way to add an account.
    expect(await screen.findByText("Add an account to see today's risk")).toBeTruthy();
    expect(screen.queryByText(/\$\d/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(currentPath()).toBe("/accounts"));

    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add account" });
    // Pasted, not typed key by key: each keystroke into the zone combobox re-filters the zone list (slow in jsdom
    // on a busy runner).
    await fill(user, within(dialog).getByRole("textbox", { name: /Account name/ }), "Eval 50K");
    await fill(user, within(dialog).getByRole("textbox", { name: /Starting balance/ }), "50000");
    await fill(user, within(dialog).getByRole("combobox", { name: /Time zone/ }), "America/New_York");
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(currentPath()).toBe("/accounts/acct-1"));
    await waitFor(() => expect(store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-1"));
    // The header selector everywhere names the new active account.
    expect(await screen.findByRole("button", { name: /Eval 50K/ })).toBeTruthy();

    // Today: incomplete setup is Unknown, never Safe, and says what is missing.
    await user.click(within(nav()).getByRole("link", { name: "Today" }));
    await waitFor(() => expect(within(risk()).getByRole("status").textContent).toContain("Unknown"));
    expect(within(risk()).queryByText(/Safe/)).toBeNull();
    expect(screen.getByText("Setup needed for limits")).toBeTruthy();
  });

  it("assigns a verified rulebook version to the new account; Today names it but stays Unknown until a calculation", async () => {
    const { store, user } = renderApp("/accounts/acct-1/rulebook", { accounts: [makeAccount({ id: "acct-1", name: "Eval 50K" })] });
    await screen.findByText("No rulebook assigned");
    await screen.findByRole("table", { name: "Versions of Example 50K" });
    await user.click(screen.getAllByRole("button", { name: "Assign a version…" })[0]);
    const assign = await screen.findByRole("dialog", { name: "Assign a rulebook version" });
    const day = within(assign).getByLabelText(/First trading day/);
    await fill(user, day, "2026-10-19");
    // The button names the typed day once React has rendered the input; wait for it rather than assume it.
    await user.click(await within(assign).findByRole("button", { name: /Assign from 2026-10-19/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(store.today.assignments).toHaveLength(1);
    expect(await screen.findByRole("region", { name: "In force today" })).toBeTruthy();

    // Back on Today the rulebook is named, but with nothing calculated the status stays Unknown.
    await user.click(within(nav()).getByRole("link", { name: "Today" }));
    await waitFor(() => expect(within(risk()).getByRole("status").textContent).toContain("Unknown"));
    expect(within(risk()).queryByText(/Safe/)).toBeNull();
  });

  it("keeps the typed values after a rejected save, then creates exactly one account on a double press", async () => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add account" });
    await fill(user, within(dialog).getByRole("textbox", { name: /Account name/ }), "Eval 50K");
    await fill(user, within(dialog).getByRole("textbox", { name: /Starting balance/ }), "50000");
    const rejected = store.hold("accounts.create");
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    await act(() => rejected.fail(new RepositoryError({ kind: "validation", message: "invalid", issues: [{ field: "name", message: "An account with this name already exists" }] })));
    // The repository's field error is linked to its input, listed in an announced summary, and focus moves to it.
    const name = within(dialog).getByRole("textbox", { name: /Account name/ });
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toContain("An account with this name already exists");
    const summary = within(dialog).getAllByRole("alert").find(a => a.textContent?.includes("An account with this name already exists"))!;
    expect(within(summary).getByRole("link", { name: /already exists/ }).getAttribute("href")).toBe(`#${name.id}`);
    expect((within(dialog).getByRole("textbox", { name: /Account name/ }) as HTMLInputElement).value).toBe("Eval 50K");
    expect((within(dialog).getByRole("textbox", { name: /Starting balance/ }) as HTMLInputElement).value).toBe("50000");
    expect(store.accounts.size).toBe(0);

    // Corrected and pressed twice while the save is pending: one account.
    await user.type(within(dialog).getByRole("textbox", { name: /Account name/ }), " B");
    const pending = store.hold("accounts.create");
    const save = within(dialog).getByRole("button", { name: "Add account" });
    await user.click(save);
    await user.click(save);
    await act(() => pending.release());
    await waitFor(() => expect(currentPath()).toBe("/accounts/acct-1"));
    expect(pending.calls).toHaveLength(1);
    expect([...store.accounts.values()].map(a => a.name)).toEqual(["Eval 50K B"]);
  });

  it("after an uncertain save, keeps the values, never resends, and offers Check result instead of Retry", async () => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add account" });
    await fill(user, within(dialog).getByRole("textbox", { name: /Account name/ }), "Eval 50K");
    await fill(user, within(dialog).getByRole("textbox", { name: /Starting balance/ }), "50000");
    const lost = store.hold("accounts.create");
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    await act(() => lost.fail(new RepositoryError({ kind: "database", message: "disk I/O error at C:\journal.db" })));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Couldn't confirm it saved");
    expect(alert.textContent).not.toContain("journal.db");
    expect(within(alert).queryByRole("button", { name: /Try again|Retry/ })).toBeNull();
    expect((within(dialog).getByRole("textbox", { name: /Account name/ }) as HTMLInputElement).value).toBe("Eval 50K");
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    expect(lost.calls).toHaveLength(1);
    // Checking and releasing the lock: uncertain-writes.journey.test.tsx (Build 26.6).
    expect(within(alert).getByRole("button", { name: "Check result" })).toBeTruthy();
  });
});

describe("active account and late responses", () => {
  const two = () => createAppStore({
    accounts: [makeAccount({ id: "acct-a", name: "Eval A" }), makeAccount({ id: "acct-b", name: "Eval B" })],
    trades: [
      makeTrade({ id: "ta", accountId: "acct-a", symbol: "MESZ6" }),
      makeTrade({ id: "tb", accountId: "acct-b", symbol: "MNQZ6" }),
    ],
    activeId: "acct-a",
  });

  it("never shows the previous account's trades when its read resolves after switching", async () => {
    const store = two();
    const slowA = store.hold("trades.list", ([accountId]) => accountId === "acct-a");
    const { user } = renderApp("/journal", store);
    await waitFor(() => expect(slowA.calls).toHaveLength(1));
    // Switch while A's read is still pending.
    await user.click(await screen.findByRole("button", { name: /Eval A/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Eval B/ }));
    await waitFor(() => expect(store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-b"));
    expect(await screen.findByText("MNQZ6")).toBeTruthy();
    // A's answer arrives last; it must not replace or join B's list.
    await act(() => slowA.release());
    expect(screen.queryByText("MESZ6")).toBeNull();
    expect(screen.getByText("MNQZ6")).toBeTruthy();
  });

  it("reports an archived or deleted active account instead of silently switching to another", async () => {
    const store = createAppStore({
      accounts: [makeAccount({ id: "acct-a", name: "Eval A", archivedAt: "2026-10-01T00:00:00.000Z" }), makeAccount({ id: "acct-b", name: "Eval B" })],
      activeId: "acct-a",
    });
    renderApp("/journal", store);
    expect(await screen.findByRole("button", { name: /Eval A was archived · choose an account/ })).toBeTruthy();
    expect(store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-a");
    expect(screen.queryByText(/Eval B/)).toBeNull();
  });
});
