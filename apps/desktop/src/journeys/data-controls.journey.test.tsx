// @vitest-environment jsdom
// Build 26 journeys over the Build 24/25 data controls through the real <App />: the real RuntimeProvider (runtime
// commands answered at the Tauri invoke boundary), the native file dialog plugin faked at its import, and the
// in-memory app store standing in for Rust. These prove the frontend's safety and cache behaviour only. Archive
// integrity, transactional deletion and restart persistence are native evidence (src-tauri data_controls tests);
// a packaged-app restore/delete run needs a verified disposable profile and is pending (see the Build 26 handoff).
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { ACTIVE_ACCOUNT_SETTING } from "../features/accounts/active-account";
import { LAST_EXPORT_SETTING } from "../features/data-controls/api/data-controls";
import { DataControlFailure } from "../lib/data/data-controls";
import { archivePreview, createAppStore, makeAccount, makeTrade } from "../test/app-store";
import { boundary, initializingStatus, readyStatus } from "../test/boundaries";
import { currentPath, installBrowserShims, renderApp, resetHarness } from "../test/harness";
import { deferred } from "../test/runtime-fixtures";

beforeAll(installBrowserShims);
afterEach(resetHarness);

const BACKUP = "C:\\Users\\trader\\Backups\\fundedflow-2026-10-21.ffj.zip";
const store2 = () => createAppStore({
  accounts: [
    makeAccount({ id: "acct-a", name: "Eval A", propFirm: "Example" }),
    makeAccount({ id: "acct-b", name: "Eval B" }),
  ],
  trades: [
    makeTrade({ id: "ta", accountId: "acct-a", symbol: "MESZ6" }),
    makeTrade({ id: "tb", accountId: "acct-b", symbol: "MNQZ6" }),
  ],
  activeId: "acct-b",
});
const nav = () => screen.getByRole("navigation", { name: "Primary navigation" });
/** Replaces the confirmation text in one input event (pasted), so the many wrong-phrase checks stay quick. */
const typePhrase = async (user: ReturnType<typeof renderApp>["user"], dialog: HTMLElement, text: string) => {
  const box = within(dialog).getByRole("textbox", { name: /Type the confirmation/ });
  await user.clear(box);
  await user.click(box);
  await user.paste(text);
};

describe("export", () => {
  it("asks for plaintext consent, does nothing on Cancel, then saves a full backup and remembers it without the path", async () => {
    const store = store2();
    const { user } = renderApp("/settings", store);
    const exportButton = await screen.findByRole("button", { name: "Choose location and export…" });
    // No consent: the native chooser never opens.
    await user.click(exportButton);
    expect(screen.getByText("Confirm that you understand the file is not encrypted.")).toBeTruthy();
    expect(boundary.dialog.calls).toHaveLength(0);
    // Consent, then Cancel in the native chooser: nothing is exported and nothing claims it was.
    await user.click(screen.getByRole("checkbox", { name: /not encrypted/ }));
    boundary.dialog.save.push(null);
    await user.click(exportButton);
    await waitFor(() => expect(boundary.dialog.calls).toHaveLength(1));
    expect(boundary.dialog.calls[0].options).toMatchObject({ defaultPath: expect.stringMatching(/^fundedflow-\d{4}-\d{2}-\d{2}\.ffj\.zip$/) });
    expect(store.dataControlCalls).toEqual([]);
    expect(screen.queryByText(/^Saved fundedflow/)).toBeNull();
    expect(screen.queryByText("Nothing was exported")).toBeNull();
    // Chosen location: exported, file name only, metadata without the folder.
    boundary.dialog.save.push(BACKUP);
    await user.click(exportButton);
    expect(await screen.findByText("Saved fundedflow-2026-10-21.ffj.zip")).toBeTruthy();
    expect(store.dataControlCalls).toEqual([{ method: "exportArchive", request: { destination: BACKUP, acknowledgePlaintext: true } }]);
    expect(document.body.textContent).not.toContain("Users\\trader");
    await waitFor(() => expect(store.settings.get(LAST_EXPORT_SETTING)).toMatchObject({ kind: "archive", scope: "journal", bytes: 4096 }));
    expect(JSON.stringify(store.settings.get(LAST_EXPORT_SETTING))).not.toContain("Backups");
    // No overwrite claim, and the CSV option says it isn't a backup.
    expect(screen.getByText(/never overwrites an existing file/)).toBeTruthy();
    expect(screen.getByText(/It can't be restored and isn't a backup/)).toBeTruthy();
  });

  it("explains a chooser that can't open and a failed export, with no success and no path", async () => {
    const store = store2();
    const { user } = renderApp("/settings", store);
    await user.click(await screen.findByRole("checkbox", { name: /not encrypted/ }));
    boundary.dialog.save.push(new Error("dialog plugin missing"));
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    expect(await screen.findByText("The file chooser couldn't open.")).toBeTruthy();
    expect(store.dataControlCalls).toEqual([]);
    const failing = store.hold("dataControls.exportArchive");
    boundary.dialog.save.push(BACKUP);
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    // Busy: one operation, no invented percentage.
    expect(await screen.findByText(/Other data actions wait until this finishes/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+ ?%/);
    await act(() => failing.fail(new DataControlFailure({ code: "insufficient_space", message: "native: 12 bytes free on C:\\" })));
    expect(await screen.findByText(/There isn't enough free disk space/)).toBeTruthy();
    expect(screen.queryByText(/^Saved fundedflow/)).toBeNull();
    expect(document.body.textContent).not.toContain("bytes free");
  });
});

describe("restore", () => {
  async function openRestore(user: ReturnType<typeof renderApp>["user"]) {
    boundary.dialog.open.push(BACKUP);
    await user.click(await screen.findByRole("button", { name: "Choose backup to restore…" }));
    return screen.findByRole("dialog", { name: "Replace the journal with this archive?" });
  }

  it("rejects an invalid archive and never offers to replace", async () => {
    const store = store2();
    store.archives.set(BACKUP, new DataControlFailure({ code: "integrity", message: "x" }));
    const { user } = renderApp("/settings", store);
    const dialog = await openRestore(user);
    expect(await within(dialog).findByText("This archive can't be restored")).toBeTruthy();
    expect(within(dialog).getByText(/don't match its checksums/)).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: /Type the confirmation/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Replace entire journal" })).toBeNull();
    expect(store.dataControlCalls.map(c => c.method)).toEqual(["inspectArchive"]);
  });

  it("refuses Cancel, a wrong phrase and a stale preview without restoring anything", async () => {
    const store = store2();
    store.archives.set(BACKUP, archivePreview({ accountIds: ["acct-old"] }));
    const { user } = renderApp("/settings", store);
    let dialog = await openRestore(user);
    await within(dialog).findByText("Checksums, version and contents verified");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openRestore(user);
    await within(dialog).findByText("Checksums, version and contents verified");
    const replace = within(dialog).getByRole("button", { name: "Replace entire journal" }) as HTMLButtonElement;
    for (const wrong of ["replace entire journal", "REPLACE ENTIRE JOURNAL ", "ERASE ENTIRE JOURNAL"]) {
      await typePhrase(user, dialog, wrong);
      expect(replace.disabled).toBe(true);
    }
    // The journal changes after the preview (another window): the backend refuses the stale token.
    store.touch();
    await typePhrase(user, dialog, "REPLACE ENTIRE JOURNAL");
    await user.click(replace);
    expect(await within(dialog).findByText(/Your data changed after this preview/)).toBeTruthy();
    expect(boundary.invocations).not.toContain("retry_runtime");
    expect(screen.queryByRole("dialog", { name: "Journal restored" })).toBeNull();
    expect(store.accounts.has("acct-a")).toBe(true);
  });

  it("reports success only once the runtime is Ready on the restored journal, and every view shows the restored data", async () => {
    const store = store2();
    store.archives.set(BACKUP, archivePreview({ accountIds: ["acct-old"], entities: { accounts: 1, trades: 1 } }));
    store.stageRestore({
      accounts: [makeAccount({ id: "acct-old", name: "Restored attempt" })],
      trades: [makeTrade({ id: "t-old", accountId: "acct-old", symbol: "CLZ6" })],
    });
    const { user } = renderApp("/journal", store);
    // Warm every cache first.
    expect(await screen.findByText("MNQZ6")).toBeTruthy();
    await user.click(within(nav()).getByRole("link", { name: "Accounts" }));
    expect(await within(await screen.findByRole("table", { name: "Accounts" })).findByText(/Eval B/)).toBeTruthy();
    await user.click(within(nav()).getByRole("link", { name: "Settings" }));

    const dialog = await openRestore(user);
    await within(dialog).findByText("Checksums, version and contents verified");
    expect(within(dialog).getByText(/1 account, including archived, failed and passed attempts/)).toBeTruthy();
    // The runtime: still Ready for the check, then installing on retry until the test lets it finish.
    const install = deferred<typeof readyStatus>();
    boundary.statusAnswers = [readyStatus, install.promise];
    boundary.retryAnswers = [initializingStatus];
    boundary.onRetry = () => store.installStaged();
    await typePhrase(user, dialog, "REPLACE ENTIRE JOURNAL");
    await user.click(within(dialog).getByRole("button", { name: "Replace entire journal" }));
    expect(await screen.findByRole("dialog", { name: "Installing the restored journal…" })).toBeTruthy();
    // restart_required is not success: no success dialog, no toast, while the runtime is still installing.
    expect(screen.queryByRole("dialog", { name: "Journal restored" })).toBeNull();
    expect(screen.queryByText("Journal restored")).toBeNull();
    await act(async () => install.resolve(readyStatus));
    const done = await screen.findByRole("dialog", { name: "Journal restored" });
    expect(store.dataControlCalls.filter(c => c.method === "restoreArchive")).toHaveLength(1);
    expect(boundary.invocations.filter(c => c === "retry_runtime")).toHaveLength(1);
    await user.click(within(done).getAllByRole("button", { name: "Close" }).slice(-1)[0]!);

    // Every warmed view now reads the restored journal; nothing comes back from the cache.
    await user.click(within(nav()).getByRole("link", { name: "Accounts" }));
    const table = await screen.findByRole("table", { name: "Accounts" });
    expect(await within(table).findByText(/Restored attempt/)).toBeTruthy();
    expect(within(table).queryByText(/Eval B/)).toBeNull();
    expect(await screen.findByRole("button", { name: /Chosen account is gone · choose another/ })).toBeTruthy();
    // The stored active account no longer exists: the trader is asked to choose, not switched silently.
    expect(store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe("acct-b");
    await user.click(within(nav()).getByRole("link", { name: "Journal" }));
    await waitFor(() => expect(screen.queryByText("MNQZ6")).toBeNull());
    expect(screen.queryByText("MESZ6")).toBeNull();
  });

  it("shows an install failure, keeps the dialog honest and never submits the restore again", async () => {
    const store = store2();
    store.archives.set(BACKUP, archivePreview());
    const { user } = renderApp("/settings", store);
    const dialog = await openRestore(user);
    await within(dialog).findByText("Checksums, version and contents verified");
    boundary.statusAnswers = [readyStatus];
    boundary.retryAnswers = [{ ...initializingStatus, state: "failed", stage: "migrate", failure: { category: "migration_failed", retryable: true, message: "Install failed", detail: "x", failedMigration: null } }];
    await typePhrase(user, dialog, "REPLACE ENTIRE JOURNAL");
    await user.click(within(dialog).getByRole("button", { name: "Replace entire journal" }));
    expect(await screen.findByRole("dialog", { name: "The restore didn't finish installing" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Journal restored" })).toBeNull();
    expect(store.dataControlCalls.filter(c => c.method === "restoreArchive")).toHaveLength(1);
    // The recovery banner offers Retry; the restore itself is not resubmitted from here.
    expect(screen.getAllByRole("button", { name: /Retry/ }).length).toBeGreaterThan(0);
  });
});

describe("permanent deletion", () => {
  async function openFromAccounts(user: ReturnType<typeof renderApp>["user"], name: RegExp) {
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete permanently…" }));
    return screen.findByRole("dialog", { name });
  }

  it("from Accounts: exact ID phrase, Cancel and the journal phrase refused, then deletes only that account and every view forgets it", async () => {
    const store = store2();
    const { user } = renderApp("/journal", store);
    expect(await screen.findByText("MNQZ6")).toBeTruthy();
    window.location.hash = "/accounts/acct-b";
    let dialog = await openFromAccounts(user, /Permanently delete Eval B\?/);
    await within(dialog).findByText("What will be deleted");
    expect(within(dialog).getByText("acct-b")).toBeTruthy();
    expect(within(dialog).getByText("DELETE ACCOUNT acct-b")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(store.dataControlCalls.map(c => c.method)).toEqual(["previewDeletion"]);

    dialog = await openFromAccounts(user, /Permanently delete Eval B\?/);
    await within(dialog).findByText("What will be deleted");
    const confirm = within(dialog).getByRole("button", { name: "Delete account permanently" }) as HTMLButtonElement;
    for (const wrong of ["ERASE ENTIRE JOURNAL", "DELETE ACCOUNT acct-a", "delete account acct-b"]) {
      await typePhrase(user, dialog, wrong);
      expect(confirm.disabled).toBe(true);
    }
    await typePhrase(user, dialog, "DELETE ACCOUNT acct-b");
    await user.click(confirm);
    await waitFor(() => expect(currentPath()).toBe("/accounts"));
    expect(await screen.findByText("Eval B was permanently deleted")).toBeTruthy();
    expect(store.dataControlCalls.filter(c => c.method === "deletePermanently")).toEqual([
      { method: "deletePermanently", request: { scope: { kind: "account", accountId: "acct-b" }, previewToken: expect.any(String), confirmation: "DELETE ACCOUNT acct-b" } },
    ]);
    expect(store.accounts.has("acct-a")).toBe(true);
    // Accounts, the header selector and the Journal: no trace of the deleted account from the cache.
    const table = await screen.findByRole("table", { name: "Accounts" });
    await waitFor(() => expect(within(table).queryByText(/Eval B/)).toBeNull());
    expect(within(table).getByText(/Eval A/)).toBeTruthy();
    // It was the active account: the selector says so instead of silently picking Eval A.
    expect(await screen.findByRole("button", { name: /Chosen account is gone · choose another/ })).toBeTruthy();
    await user.click(within(nav()).getByRole("link", { name: "Journal" }));
    await waitFor(() => expect(screen.queryByText("MNQZ6")).toBeNull());
  });

  it("never deletes from a stale preview and keeps the dialog open with a plain reason", async () => {
    const store = store2();
    const { user } = renderApp("/accounts/acct-b", store);
    const dialog = await openFromAccounts(user, /Permanently delete Eval B\?/);
    await within(dialog).findByText("What will be deleted");
    store.touch();
    await typePhrase(user, dialog, "DELETE ACCOUNT acct-b");
    await user.click(within(dialog).getByRole("button", { name: "Delete account permanently" }));
    expect(await within(dialog).findByText(/Your data changed after this preview/)).toBeTruthy();
    expect(store.accounts.has("acct-b")).toBe(true);
    expect(store.dataControlCalls.filter(c => c.method === "deletePermanently")).toHaveLength(1);
  });

  it("keeps linked attempts and native blockers non-bypassable, and offers Archive instead", async () => {
    const store = createAppStore({
      accounts: [
        makeAccount({ id: "acct-1", name: "PA-1", externalRef: "48213", status: "failed", successorAccountId: "acct-2" }),
        makeAccount({ id: "acct-2", name: "PA-1 retry", externalRef: "48213", predecessorAccountId: "acct-1" }),
        makeAccount({ id: "acct-3", name: "Shared rules" }),
      ],
      activeId: "acct-2",
    });
    store.blocked.set("acct-3", ["immutable_shared_rulebook_history"]);
    const { user } = renderApp("/accounts/acct-1", store);
    let dialog = await openFromAccounts(user, /Permanently delete PA-1\?/);
    expect(await within(dialog).findByText("This account can't be deleted on its own")).toBeTruthy();
    expect(within(dialog).getByText("acct-2")).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: /Type the confirmation/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete account permanently" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Archive instead" }));
    const archive = await screen.findByRole("alertdialog", { name: /Archive PA-1\?/ });
    await user.click(within(archive).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(store.accounts.get("acct-1")!.archivedAt).not.toBeNull());
    // The neighbouring attempt is untouched: still linked, not archived, not deleted.
    expect(store.accounts.get("acct-2")).toMatchObject({ predecessorAccountId: "acct-1", archivedAt: null });

    window.location.hash = "/accounts/acct-3";
    await screen.findByRole("heading", { name: "Shared rules", level: 2 });
    dialog = await openFromAccounts(user, /Permanently delete Shared rules\?/);
    expect(await within(dialog).findByText(/rulebook history is recorded on a rulebook it shares/)).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: /Type the confirmation/ })).toBeNull();
    expect(store.dataControlCalls.filter(c => c.method === "deletePermanently")).toHaveLength(0);
  });

  it("runs one data operation at a time across Settings and Accounts", async () => {
    const store = store2();
    const exporting = store.hold("dataControls.exportArchive");
    const { user } = renderApp("/settings", store);
    await user.click(await screen.findByRole("checkbox", { name: /not encrypted/ }));
    boundary.dialog.save.push(BACKUP);
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    await screen.findByText(/Other data actions wait until this finishes/);
    expect((screen.getByRole("button", { name: "Erase entire journal…" }) as HTMLButtonElement).disabled).toBe(true);
    // Another entry point, same lock.
    window.location.hash = "/accounts/acct-b";
    const dialog = await openFromAccounts(user, /Permanently delete Eval B\?/);
    await within(dialog).findByText("What will be deleted");
    await typePhrase(user, dialog, "DELETE ACCOUNT acct-b").catch(() => {});
    const confirm = within(dialog).queryByRole("button", { name: "Delete account permanently" }) as HTMLButtonElement | null;
    expect(confirm === null || confirm.disabled).toBe(true);
    expect(store.dataControlCalls.filter(c => c.method === "deletePermanently")).toHaveLength(0);
    await act(() => exporting.release());
    await waitFor(() => expect((within(dialog).getByRole("textbox", { name: /Type the confirmation/ }) as HTMLInputElement).disabled).toBe(false));
  });

  it("erases the journal with its own phrase, says file cleanup is pending without claiming full removal, and retries cleanup", async () => {
    const store = store2();
    store.setDeletionOutcome("cleanup_pending");
    const { user } = renderApp("/settings", store);
    await user.click(await screen.findByRole("button", { name: "Erase entire journal…" }));
    const dialog = await screen.findByRole("dialog", { name: "Erase the entire local journal?" });
    expect(await within(dialog).findByText(/Archives or CSV files you exported yourself are not touched/)).toBeTruthy();
    const erase = within(dialog).getByRole("button", { name: "Erase entire journal" }) as HTMLButtonElement;
    await typePhrase(user, dialog, "DELETE ACCOUNT acct-a");
    expect(erase.disabled).toBe(true);
    await typePhrase(user, dialog, "ERASE ENTIRE JOURNAL");
    await user.click(erase);
    const pending = await screen.findByRole("dialog", { name: "Deleted, but some files are still on disk" });
    expect(within(pending).getByText("The deletion is saved; file cleanup didn't finish")).toBeTruthy();
    expect(screen.queryByText("The local journal was erased")).toBeNull();
    expect(store.accounts.size).toBe(0);
    await user.click(within(pending).getByRole("button", { name: "Retry file cleanup" }));
    expect(await screen.findByText("File cleanup finished")).toBeTruthy();
    expect(store.cleanupPending).toBe(false);
    // The empty journal is visible everywhere.
    await user.click(within(nav()).getByRole("link", { name: "Today" }));
    expect(await screen.findByText("Add an account to see today's risk")).toBeTruthy();
  });
});
