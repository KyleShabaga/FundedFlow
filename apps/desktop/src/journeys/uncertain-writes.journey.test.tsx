// @vitest-environment jsdom
// Build 26.6 journeys: releasing an uncertain write lock only after the trader has checked what is stored.
// Through the real <App />; the store's holds decide whether the write happened and when its answer comes.
import { RepositoryError } from "@fundedflow/domain";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { WRITE_TIMEOUT_MS } from "../features/shared/submissions";
import { createAppStore, makeAccount, makeTrade, type AppStore } from "../test/app-store";
import { installBrowserShims, renderApp, resetHarness, warmUpApp } from "../test/harness";

beforeAll(installBrowserShims);
beforeAll(warmUpApp);
afterEach(resetHarness);

const lostAnswer = () => new RepositoryError({ kind: "database", message: "disk I/O error" });
type User = ReturnType<typeof renderApp>["user"];

async function startAdd(user: User, name = "Eval 50K") {
  await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
  const dialog = await screen.findByRole("dialog", { name: "Add account" });
  const fill = async (label: RegExp, text: string) => {
    const field = within(dialog).getByRole("textbox", { name: label });
    await user.clear(field);
    await user.click(field);
    await user.paste(text);
  };
  await fill(/Account name/, name);
  await fill(/Starting balance/, "50000");
  return dialog;
}
/** Submits once and makes the answer uncertain; `happened` decides whether the account was really created. */
async function uncertainCreate(store: AppStore, user: User, dialog: HTMLElement, happened: boolean) {
  const hold = store.hold("accounts.create");
  await user.click(within(dialog).getByRole("button", { name: "Add account" }));
  await act(() => (happened ? hold.lose(lostAnswer()) : hold.fail(lostAnswer())));
  await within(dialog).findByText("Couldn't confirm it saved");
  return hold;
}
const saveButton = (dialog: HTMLElement) => within(dialog).getAllByRole("button", { name: "Add account" }).find(b => b.closest(".ds-dialog-foot"))!;

describe("uncertain account create", () => {
  it("when it did not save: Check result shows no such account, and saving resumes only after the trader acknowledges", async () => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    const dialog = await startAdd(user);
    const first = await uncertainCreate(store, user, dialog, false);
    // Locked: pressing save sends nothing.
    await user.click(saveButton(dialog));
    expect(first.calls).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Check result" }));
    expect(await within(dialog).findByText("No account named “Eval 50K” is in your journal.")).toBeTruthy();
    // Reviewing alone doesn't unlock, and nothing was resent.
    expect(saveButton(dialog).getAttribute("aria-disabled") === "true" || (saveButton(dialog) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(dialog).queryByText(/Check (your accounts|result)/)).toBeNull());
    expect(store.accounts.size).toBe(0);
    // The values are still there; the trader chooses to save again, once.
    expect((within(dialog).getByRole("textbox", { name: /Account name/ }) as HTMLInputElement).value).toBe("Eval 50K");
    await user.click(saveButton(dialog));
    await waitFor(() => expect(store.accounts.size).toBe(1));
  });

  it("when it did save: Check result lists the account, so the trader can close without creating a second one", async () => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    const dialog = await startAdd(user);
    await uncertainCreate(store, user, dialog, true);
    expect(store.accounts.size).toBe(1);
    await user.click(within(dialog).getByRole("button", { name: "Check result" }));
    const saved = (await within(dialog).findByLabelText("Accounts with this name"));
    expect(within(saved).getByText("Eval 50K")).toBeTruthy();
    expect(screen.queryByText(/Eval 50K added/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "I've checked; allow saving again" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(store.accounts.size).toBe(1);
  });

  it("keeps the lock across closing and reopening the form", async () => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    let dialog = await startAdd(user);
    const first = await uncertainCreate(store, user, dialog, false);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const discard = screen.queryByRole("alertdialog");
    if (discard) await user.click(within(discard).getAllByRole("button").slice(-1)[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add account" })).toBeNull());
    // A fresh form still knows the earlier save is unconfirmed.
    dialog = await startAdd(user, "Another");
    expect(within(dialog).getByText("Couldn't confirm it saved")).toBeTruthy();
    await user.click(saveButton(dialog));
    expect(first.calls).toHaveLength(1);
  });

  it.each([true, false])("a form reopened during the uncertain save reviews the name that was sent, not its own field (saved: %s)", async happened => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    const dialog = await startAdd(user);
    const first = await uncertainCreate(store, user, dialog, happened);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const discard = screen.queryByRole("alertdialog");
    if (discard) await user.click(within(discard).getAllByRole("button").slice(-1)[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add account" })).toBeNull());
    // Reopened with an empty name field: the review still checks "Eval 50K".
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const again = await screen.findByRole("dialog", { name: "Add account" });
    expect((within(again).getByRole("textbox", { name: /Account name/ }) as HTMLInputElement).value).toBe("");
    await user.click(within(again).getByRole("button", { name: "Check result" }));
    if (happened) {
      const saved = await within(again).findByLabelText("Accounts with this name");
      expect(within(saved).getByText("Eval 50K")).toBeTruthy();
    } else {
      expect(await within(again).findByText("No account named “Eval 50K” is in your journal.")).toBeTruthy();
    }
    expect(within(again).queryByText("No account named “” is in your journal.")).toBeNull();
    await user.click(within(again).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(again).queryByText("Couldn't confirm it saved")).toBeNull());
    expect(first.calls).toHaveLength(1);
    expect(store.accounts.size).toBe(happened ? 1 : 0);
  });

  it("keeps the lock when the check itself fails, and lets the trader check again", async () => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    const dialog = await startAdd(user);
    const first = await uncertainCreate(store, user, dialog, false);
    // The re-read fails (and so does the one automatic read retry): still locked, nothing resent.
    const reads = store.hold("accounts.list");
    await user.click(within(dialog).getByRole("button", { name: "Check result" }));
    await waitFor(() => expect(reads.calls).toHaveLength(1));
    const retried = store.hold("accounts.list");
    await act(() => reads.fail(new RepositoryError({ kind: "database", message: "busy" })));
    await waitFor(() => expect(retried.calls).toHaveLength(1));
    await act(() => retried.fail(new RepositoryError({ kind: "database", message: "busy" })));
    expect(await within(dialog).findByText("Couldn't check your accounts")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "I've checked; allow saving again" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Check again" }));
    expect(await within(dialog).findByRole("button", { name: "I've checked; allow saving again" })).toBeTruthy();
    expect(first.calls).toHaveLength(1);
  });

  it("can't be acknowledged while the original request is still running after its timeout, and a late answer claims nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const store = createAppStore();
    const { user } = renderApp("/accounts", store, { fakeTimers: true });
    const dialog = await startAdd(user);
    const slow = store.hold("accounts.create");
    await user.click(saveButton(dialog));
    await act(() => vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 10));
    expect(await within(dialog).findByText("Couldn't confirm it saved")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Check result" }));
    const ack = await within(dialog).findByRole("button", { name: "I've checked; allow saving again" });
    expect(ack.getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog).getByText(/The original request is still running/)).toBeTruthy();
    await user.click(ack);
    expect(slow.calls).toHaveLength(1);
    // The late answer is a success, but it never turns into a success message or a second write.
    await act(() => slow.release());
    expect(screen.queryByText(/Eval 50K added/)).toBeNull();
    // Once it has settled, the trader may acknowledge after checking.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "I've checked; allow saving again" }).getAttribute("aria-disabled")).toBeNull());
    expect(store.accounts.size).toBe(1);
  });
});

describe("uncertain manual trade", () => {
  it("shows the account's saved trades with that symbol, and the trade lock is released only after review", async () => {
    const store = createAppStore({ accounts: [makeAccount({ id: "acct-a", name: "Eval A" })], activeId: "acct-a" });
    const { user } = renderApp("/journal", store);
    await user.click((await screen.findAllByRole("button", { name: /Add trade/ }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add a manual trade" });
    const fill = async (label: RegExp, text: string) => { const f = within(dialog).getByLabelText(label); await user.clear(f); await user.click(f); await user.paste(text); };
    await fill(/^Symbol/, "MESZ6");
    await fill(/^Entry time/, "2026-10-19T09:30");
    await fill(/^Entry price/, "5000");
    const hold = store.hold("trades.create");
    await user.click(within(dialog).getByRole("button", { name: "Add trade" }));
    await act(() => hold.lose(lostAnswer()));
    await user.click(await within(dialog).findByRole("button", { name: "Check result" }));
    expect(await within(dialog).findByLabelText("Saved MESZ6 trades")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "I've checked; allow saving again" })).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect([...store.trades.values()].filter(r => r.trade.symbol === "MESZ6")).toHaveLength(1);
  });
});

describe("lock scope", () => {
  it("an uncertain status change locks that account's writes only, and is released after review", async () => {
    const store = createAppStore({
      accounts: [makeAccount({ id: "acct-a", name: "Eval A" }), makeAccount({ id: "acct-b", name: "Eval B" })],
      trades: [makeTrade({ id: "t1", accountId: "acct-b" })],
    });
    const { user } = renderApp("/accounts/acct-a", store);
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark failed…" }));
    const dialog = await screen.findByRole("dialog", { name: "Change status of Eval A" });
    const hold = store.hold("accounts.changeStatus");
    await user.click(within(dialog).getByRole("button", { name: "Mark failed" }));
    await act(() => hold.lose(lostAnswer()));
    await within(dialog).findByText("Couldn't confirm it saved");
    await user.click(within(dialog).getByRole("button", { name: "Check result" }));
    const saved = (await within(dialog).findByLabelText("The account as saved now"));
    expect(within(saved).getByText("Failed")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Another account's writes are not blocked by Eval A's lock.
    window.location.hash = "/accounts/acct-b";
    await screen.findByRole("heading", { name: "Eval B", level: 2 });
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark failed…" }));
    const other = await screen.findByRole("dialog", { name: "Change status of Eval B" });
    await user.click(within(other).getByRole("button", { name: "Mark failed" }));
    await waitFor(() => expect(store.accounts.get("acct-b")!.status).toBe("failed"));
  });
});
