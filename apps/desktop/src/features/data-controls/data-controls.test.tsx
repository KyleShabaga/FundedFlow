// @vitest-environment jsdom
// Build 25 Settings data controls through the real page, design-system components and the Build 24 DTOs.
// Native outputs come from the Rust-generated wire fixture; the repository is the in-memory account test store
// plus fake data-control commands, and the runtime is mocked.
import type { ArchiveRestorePreview, PermanentDeletionPreview } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { DataControlFailure } from "../../lib/data/data-controls";
import { createTestStore, makeAccount } from "../accounts/test-store";
import { accountMenu } from "../accounts/components/AccountActions";
import { DataControlProblem, LAST_EXPORT_SETTING, type FilePicker } from "./api/data-controls";
import { DataControlsPage } from "./components/DataControlsPage";
import { resetDataControlLock } from "./hooks/data-controls";
import { primeAccepted } from "../../test/legal";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn(), retry: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTestStore> & { repository: Record<string, unknown> } }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

// Shapes follow the Rust-generated packages/domain/test/fixtures/data-controls-wire.json (desktop code may not import it).
const ZERO = "0".repeat(64);
const restorePreview: ArchiveRestorePreview = {
  state: "validated",
  archiveSha256: ZERO,
  previewToken: "restore-token",
  requiredConfirmation: "REPLACE ENTIRE JOURNAL",
  requiredFreeBytes: 1090519040,
  replacedEntities: { accounts: 2, trades: 4, instruments: 16 },
  warnings: [],
  manifest: {
    format: "fundedflow-journal", formatVersion: 1, schemaVersion: 3, producerVersion: "0.1.0", createdAt: "2026-10-20T00:00:00.000Z",
    exportId: "export", protection: "plaintext", accountIds: ["a1", "a2", "a3"], attachments: [],
    entities: { accounts: 3, account_status_events: 3, trades: 12, import_rows: 5, instruments: 16 },
    financialEncoding: "sqlite-i64-micros-and-exact-decimal-text;JSON-integers-as-text",
    timeEncoding: "stored-UTC-instants;account-IANA-zone-and-reset;stored-trading-day",
    entries: [{ path: "journal.sqlite", bytes: 0, sha256: ZERO }], maxEntryBytes: 67108864, maxTotalBytes: 268435456, maxEntries: 4096,
  },
};
const journalPreview: PermanentDeletionPreview = {
  scope: { kind: "journal" }, accountName: null, affectedEntities: { instruments: 16 }, attachments: [], linkedAccountIds: [], blockers: [],
  previewToken: "delete-token", requiredConfirmation: "ERASE ENTIRE JOURNAL", localRecoveryCopies: 0,
  warnings: ["External/user-exported backups remain untouched; this is not a forensic secure-erase guarantee."],
};
const restoreResult = { operationId: "op", state: "restart_required", safetyBackupId: "safety" };
const SHA = "a".repeat(64);
const accountPreview = (over: Partial<PermanentDeletionPreview> = {}): PermanentDeletionPreview => ({
  ...journalPreview,
  scope: { kind: "account", accountId: "acct-a" },
  accountName: "Eval A",
  requiredConfirmation: "DELETE ACCOUNT acct-a",
  affectedEntities: { accounts: 1, trades: 12, journal_entries: 2, attachments: 1, audit_events: 0 },
  attachments: [{ id: "att", storageKey: "k", byteSize: 2048, sha256: SHA }],
  ...over,
});

const ready = () => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 18, supportedSchemaVersion: 18, created: false, failure: null } } as unknown as RuntimeState;
};
let client: QueryClient;
let controls: Record<string, ReturnType<typeof vi.fn>>;
let picker: { save: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> };

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/settings"]}>
          <DataControlsPage picker={picker as unknown as FilePicker} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ready();
  resetDataControlLock();
  primeAccepted();
  runtime.check.mockReset().mockResolvedValue(undefined);
  runtime.retry.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createTestStore([
    makeAccount({ id: "acct-a", name: "Eval A", status: "failed" }),
    makeAccount({ id: "acct-b", name: "Eval B" }),
  ]) as typeof holder.store;
  controls = {
    exportArchive: vi.fn().mockResolvedValue({ operationId: "op", state: "completed", bytes: 4096, sha256: SHA, plaintext: true }),
    exportCsv: vi.fn().mockResolvedValue({ operationId: "op", state: "completed", bytes: 512, sha256: SHA, plaintext: true }),
    inspectArchive: vi.fn().mockResolvedValue(restorePreview),
    restoreArchive: vi.fn().mockResolvedValue(restoreResult),
    previewDeletion: vi.fn().mockImplementation(async ({ scope }) => (scope.kind === "journal" ? journalPreview : accountPreview())),
    deletePermanently: vi.fn().mockResolvedValue({ operationId: "op", state: "completed", affectedEntities: {} }),
    retryCleanup: vi.fn().mockResolvedValue(undefined),
  };
  holder.store.repository.dataControls = controls;
  picker = { save: vi.fn().mockResolvedValue("C:\\Users\\me\\Backups\\fundedflow-2026-10-21.ffj.zip"), open: vi.fn().mockResolvedValue("C:\\Users\\me\\Backups\\old.ffj.zip") };
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

/**
 * Replaces the confirmation phrase in one paste, as the Data controls journeys do. The phrase is the subject, not
 * its keystrokes: typed key by key, each phrase cost ~0.7–1.3 s and pushed these tests past 5 s under CPU load.
 */
async function typePhrase(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, text: string) {
  const box = within(dialog).getByRole("textbox", { name: /Type the confirmation/ });
  await user.clear(box);
  await user.click(box);
  await user.paste(text);
}

describe("data information and export", () => {
  it("describes local storage, recovery copies and unencrypted exports", async () => {
    renderPage();
    expect(screen.getByText(/storage, sharing and deletion limits/)).toBeTruthy();
    expect(screen.getByText("FundedFlow keeps pre-upgrade database copies and pre-restore safety copies. These are not a substitute for independent full backups.")).toBeTruthy();
    expect(screen.getByText(/Not encrypted\. Anyone who can open the file/)).toBeTruthy();
    expect(await screen.findByText("No export yet")).toBeTruthy();
    expect(screen.getByText("18 (backup format 1)")).toBeTruthy();
  });

  it("requires the plaintext acknowledgement before opening the save dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    expect(screen.getByText("Confirm that you understand the file is not encrypted.")).toBeTruthy();
    expect(picker.save).not.toHaveBeenCalled();
    expect(controls.exportArchive).not.toHaveBeenCalled();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    const user = userEvent.setup();
    picker.save.mockResolvedValue(null);
    renderPage();
    await user.click(screen.getByRole("checkbox", { name: /not encrypted/ }));
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    await waitFor(() => expect(picker.save).toHaveBeenCalledWith("archive", expect.stringMatching(/^fundedflow-\d{4}-\d{2}-\d{2}\.ffj\.zip$/)));
    expect(controls.exportArchive).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing was exported/)).toBeNull();
  });

  it("exports a full backup, shows only the file name and remembers the outcome without the path", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("checkbox", { name: /not encrypted/ }));
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    expect(await screen.findByText("Saved fundedflow-2026-10-21.ffj.zip")).toBeTruthy();
    expect(controls.exportArchive).toHaveBeenCalledWith({ destination: "C:\\Users\\me\\Backups\\fundedflow-2026-10-21.ffj.zip", acknowledgePlaintext: true });
    expect(screen.queryByText(/Users\\me/)).toBeNull();
    await waitFor(() => expect(holder.store.settings.get(LAST_EXPORT_SETTING)).toMatchObject({ kind: "archive", scope: "journal", bytes: 4096, sha256: SHA }));
    expect(JSON.stringify(holder.store.settings.get(LAST_EXPORT_SETTING))).not.toContain("Backups");
    expect(screen.getByText(/^Full backup · .* · 4\.0 KB$/)).toBeTruthy();
  });

  it("exports trade CSV for one chosen account", async () => {
    const user = userEvent.setup();
    picker.save.mockResolvedValue("C:\\out\\trades.csv");
    renderPage();
    await user.click(screen.getByRole("radio", { name: /Trade CSV/ }));
    await user.click(screen.getByRole("combobox", { name: /Accounts/ }));
    await user.click(await screen.findByRole("option", { name: "Eval B" }));
    await user.click(screen.getByRole("checkbox", { name: /not encrypted/ }));
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    await waitFor(() => expect(controls.exportCsv).toHaveBeenCalledWith({ destination: "C:\\out\\trades.csv", accountId: "acct-b", acknowledgePlaintext: true }));
    expect(picker.save).toHaveBeenCalledWith("csv", expect.stringMatching(/\.csv$/));
  });

  it("explains a native failure by its stable code", async () => {
    const user = userEvent.setup();
    controls.exportArchive.mockRejectedValue(new DataControlFailure({ code: "missing_attachment", message: "native text" }));
    renderPage();
    await user.click(screen.getByRole("checkbox", { name: /not encrypted/ }));
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    expect(await screen.findByText(/A screenshot or file the journal refers to is missing/)).toBeTruthy();
    expect(screen.queryByText("native text")).toBeNull();
  });

  it("says which limit was exceeded and by how much", async () => {
    const user = userEvent.setup();
    controls.exportArchive.mockRejectedValue(new DataControlFailure({
      code: "limit_exceeded",
      message: "native text",
      detail: "database pages: 70254592 bytes, limit 67108864 bytes",
    }));
    renderPage();
    await user.click(screen.getByRole("checkbox", { name: /not encrypted/ }));
    await user.click(screen.getByRole("button", { name: "Choose location and export…" }));
    expect(await screen.findByText(
      "This is larger than the supported archive limits. Over the limit: database pages: 70254592 bytes, limit 67108864 bytes.",
    )).toBeTruthy();
  });

  it("disables every data action while an export runs and rejects a second press", async () => {
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    controls.exportArchive.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPage();
    await user.click(screen.getByRole("checkbox", { name: /not encrypted/ }));
    const button = screen.getByRole("button", { name: "Choose location and export…" });
    await user.click(button);
    await screen.findByText(/Other data actions wait/);
    const running = screen.getByRole("button", { name: /Exporting/ });
    expect(running.getAttribute("aria-disabled")).toBe("true");
    await user.click(running);
    expect((screen.getByRole("button", { name: "Choose backup to restore…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Erase entire journal…" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ operationId: "op", state: "completed", bytes: 1, sha256: SHA, plaintext: true });
    await screen.findByText(/^Saved /);
    expect(controls.exportArchive).toHaveBeenCalledTimes(1);
  });
});

describe("restore", () => {
  it("shows an invalid archive as rejected and never offers the replace action", async () => {
    const user = userEvent.setup();
    controls.inspectArchive.mockRejectedValue(new DataControlFailure({ code: "unsupported_version", message: "x" }));
    renderPage();
    await user.click(screen.getByRole("button", { name: "Choose backup to restore…" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace the journal with this archive?" });
    expect(await within(dialog).findByText("This archive can't be restored")).toBeTruthy();
    expect(within(dialog).getByText(/can't read safely/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Replace entire journal" })).toBeNull();
    expect(controls.restoreArchive).not.toHaveBeenCalled();
  });

  it("previews the archive, requires the exact phrase, then installs through the runtime and only then reports success", async () => {
    const user = userEvent.setup();
    runtime.retry.mockImplementation(async () => { ready(); });
    renderPage();
    await user.click(screen.getByRole("button", { name: "Choose backup to restore…" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace the journal with this archive?" });
    expect(await within(dialog).findByText("Checksums, version and contents verified")).toBeTruthy();
    expect(within(dialog).getByText("old.ffj.zip")).toBeTruthy();
    expect(within(dialog).getByText("3 (upgraded to 18 when installed)")).toBeTruthy();
    expect(within(dialog).getByText("Not encrypted (plain ZIP)")).toBeTruthy();
    expect(within(dialog).getByText(/3 accounts, including archived, failed and passed attempts/)).toBeTruthy();
    const replace = within(dialog).getByRole("button", { name: "Replace entire journal" }) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
    await typePhrase(user, dialog, "replace entire journal");
    expect(replace.disabled).toBe(true);
    await typePhrase(user, dialog, "REPLACE ENTIRE JOURNAL");
    expect(replace.disabled).toBe(false);
    await user.click(replace);
    await waitFor(() => expect(controls.restoreArchive).toHaveBeenCalledWith({
      source: "C:\\Users\\me\\Backups\\old.ffj.zip", previewToken: restorePreview.previewToken, confirmation: "REPLACE ENTIRE JOURNAL",
    }));
    expect(runtime.retry).toHaveBeenCalledTimes(1);
    // Any in-flight status check settles first, so the retry really runs retry_runtime.
    expect(runtime.check.mock.invocationCallOrder[0]).toBeLessThan(runtime.retry.mock.invocationCallOrder[0]);
    expect(await screen.findByRole("dialog", { name: "Journal restored" })).toBeTruthy();
  });

  it("reports an interrupted install instead of success when the runtime doesn't come back", async () => {
    const user = userEvent.setup();
    runtime.retry.mockImplementation(async () => {
      runtime.state = { kind: "unavailable", status: null, reason: "runtime-failed" } as unknown as RuntimeState;
    });
    renderPage();
    await user.click(screen.getByRole("button", { name: "Choose backup to restore…" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace the journal with this archive?" });
    await within(dialog).findByText("Checksums, version and contents verified");
    await typePhrase(user, dialog, "REPLACE ENTIRE JOURNAL");
    await user.click(within(dialog).getByRole("button", { name: "Replace entire journal" }));
    expect(await screen.findByRole("dialog", { name: "The restore didn't finish installing" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Journal restored" })).toBeNull();
  });
});

describe("permanent deletion", () => {
  async function openAccountDeletion(user: ReturnType<typeof userEvent.setup>) {
    renderPage();
    await user.click(await screen.findByRole("combobox", { name: /^Account/ }));
    await user.click(await screen.findByRole("option", { name: /Eval A · Failed/ }));
    await user.click(screen.getByRole("button", { name: "Delete account permanently…" }));
    return screen.findByRole("dialog", { name: "Permanently delete Eval A?" });
  }

  it("blocks a linked account: names it, explains why and offers no confirmation", async () => {
    const user = userEvent.setup();
    controls.previewDeletion.mockResolvedValue(accountPreview({ blockers: ["linked_attempts"], linkedAccountIds: ["acct-b"] }));
    const dialog = await openAccountDeletion(user);
    expect(await within(dialog).findByText("This account can't be deleted on its own")).toBeTruthy();
    expect(within(dialog).getByText(/linked to an earlier or later attempt/)).toBeTruthy();
    expect(within(dialog).getByText("acct-a")).toBeTruthy();
    expect(within(dialog).getByText("acct-b")).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: /Type the confirmation/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete account permanently" })).toBeNull();
    expect(controls.deletePermanently).not.toHaveBeenCalled();
  });

  it("deletes one account only after its exact ID phrase, with counts from the native preview", async () => {
    const user = userEvent.setup();
    const dialog = await openAccountDeletion(user);
    expect(await within(dialog).findByText("What will be deleted")).toBeTruthy();
    expect(within(dialog).getByText("Trades").nextSibling?.textContent).toBe("12");
    expect(within(dialog).getByText(/1 screenshot or file \(2\.0 KB\) removed from disk/)).toBeTruthy();
    expect(within(dialog).getByText(/Failed/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Delete account permanently" }) as HTMLButtonElement;
    await typePhrase(user, dialog, "ERASE ENTIRE JOURNAL");
    expect(confirm.disabled).toBe(true);
    await typePhrase(user, dialog, "DELETE ACCOUNT acct-a");
    await user.click(confirm);
    await waitFor(() => expect(controls.deletePermanently).toHaveBeenCalledWith({
      scope: { kind: "account", accountId: "acct-a" }, previewToken: journalPreview.previewToken, confirmation: "DELETE ACCOUNT acct-a",
    }));
    expect(await screen.findByText("Eval A was permanently deleted")).toBeTruthy();
  });

  it("keeps the dialog open with a plain message when the data changed after the preview", async () => {
    const user = userEvent.setup();
    controls.deletePermanently.mockRejectedValue(new DataControlFailure({ code: "stale_preview", message: "x" }));
    const dialog = await openAccountDeletion(user);
    await within(dialog).findByText("What will be deleted");
    await typePhrase(user, dialog, "DELETE ACCOUNT acct-a");
    await user.click(within(dialog).getByRole("button", { name: "Delete account permanently" }));
    expect(await within(dialog).findByText(/Your data changed after this preview/)).toBeTruthy();
  });

  it("erases the whole journal through a separate flow and phrase, and offers file-cleanup retry", async () => {
    const user = userEvent.setup();
    controls.deletePermanently.mockResolvedValue({ operationId: "op", state: "cleanup_pending", affectedEntities: {} });
    renderPage();
    await user.click(screen.getByRole("button", { name: "Erase entire journal…" }));
    const dialog = await screen.findByRole("dialog", { name: "Erase the entire local journal?" });
    expect(within(dialog).getByText(/removes every account, trade, note/)).toBeTruthy();
    expect(await within(dialog).findByText(/Archives or CSV files you exported yourself are not touched/)).toBeTruthy();
    expect(within(dialog).getByText("ERASE ENTIRE JOURNAL")).toBeTruthy();
    await typePhrase(user, dialog, "ERASE ENTIRE JOURNAL");
    await user.click(within(dialog).getByRole("button", { name: "Erase entire journal" }));
    const pending = await screen.findByRole("dialog", { name: "Deleted, but some files are still on disk" });
    expect(controls.previewDeletion).toHaveBeenCalledWith({ scope: { kind: "journal" } });
    await user.click(within(pending).getByRole("button", { name: "Retry file cleanup" }));
    await waitFor(() => expect(controls.retryCleanup).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("File cleanup finished")).toBeTruthy();
  });
});

describe("native file chooser and cleanup failures (Build 26)", () => {
  it("does nothing when the restore chooser is cancelled", async () => {
    const user = userEvent.setup();
    picker.open.mockResolvedValue(null);
    renderPage();
    await user.click(screen.getByRole("button", { name: "Choose backup to restore…" }));
    await waitFor(() => expect(picker.open).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(controls.inspectArchive).not.toHaveBeenCalled();
    expect(screen.queryByText("No archive was opened")).toBeNull();
  });

  it("explains a restore chooser that can't open, without inspecting anything", async () => {
    const user = userEvent.setup();
    picker.open.mockRejectedValue(new DataControlProblem("dialog"));
    renderPage();
    await user.click(screen.getByRole("button", { name: "Choose backup to restore…" }));
    expect(await screen.findByText("No archive was opened")).toBeTruthy();
    expect(screen.getByText("The file chooser couldn't open.")).toBeTruthy();
    expect(controls.inspectArchive).not.toHaveBeenCalled();
  });

  it("keeps cleanup pending visible when the cleanup retry fails, and never claims the files are gone", async () => {
    const user = userEvent.setup();
    controls.deletePermanently.mockResolvedValue({ operationId: "op", state: "cleanup_pending", affectedEntities: {} });
    controls.retryCleanup.mockRejectedValue(new DataControlFailure({ code: "io", message: "C:\\Users\\me\\AppData\\locked.png" }));
    renderPage();
    await user.click(screen.getByRole("button", { name: "Erase entire journal…" }));
    const dialog = await screen.findByRole("dialog", { name: "Erase the entire local journal?" });
    await within(dialog).findByText(/Archives or CSV files you exported yourself are not touched/);
    await typePhrase(user, dialog, "ERASE ENTIRE JOURNAL");
    await user.click(within(dialog).getByRole("button", { name: "Erase entire journal" }));
    const pending = await screen.findByRole("dialog", { name: "Deleted, but some files are still on disk" });
    await user.click(within(pending).getByRole("button", { name: "Retry file cleanup" }));
    expect(await within(pending).findByText(/couldn't be read or written/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Deleted, but some files are still on disk" })).toBeTruthy();
    expect(screen.queryByText("File cleanup finished")).toBeNull();
    expect(document.body.textContent).not.toContain("locked.png");
  });
});

describe("account menu", () => {
  it("offers permanent deletion separately from archiving, for live and archived accounts", () => {
    const open = vi.fn();
    const base = { open, activate: vi.fn(), activeId: null, onOpen: vi.fn(), tradeCount: 0 };
    const live = accountMenu(makeAccount({ id: "a", name: "A" }) as never, base).map(e => ("label" in e ? e.label : "—"));
    expect(live.slice(-2)).toEqual(["Archive…", "Delete permanently…"]);
    const archived = accountMenu(makeAccount({ id: "a", name: "A", archivedAt: "2026-10-20T15:00:00.000Z" }) as never, base).map(e => ("label" in e ? e.label : "—"));
    expect(archived).toContain("Restore from archive");
    expect(archived).toContain("Delete permanently…");
  });
});
