// @vitest-environment jsdom
// NA-3 first-run privacy notice and agreement through the real <App />. The per-install acceptance file is
// answered at the Tauri invoke boundary (`boundary.legal`), as Rust's get/record_legal_acceptance would; a
// reopen re-runs main.tsx's preload against it. Closing the window is faked at its import. The Rust side
// (atomic write; corrupt or missing file reads as "not accepted") is covered by src-tauri/src/legal.rs tests.
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);
const close = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close }) }));

import { CURRENT_LEGAL_DOCUMENTS, currentAcceptance } from "../legal";
import { preloadLegalAcceptance, primeLegalAcceptance } from "../lib/data/legal";
import { archivePreview, createAppStore, makeAccount, makeTrade } from "../test/app-store";
import { expectNoAxeViolations } from "../test/axe";
import { boundary, initializingStatus, readyStatus } from "../test/boundaries";
import { installBrowserShims, renderApp, resetHarness } from "../test/harness";
import { ACCEPTED_AT, acceptedRecord } from "../test/legal";
import { failed } from "../test/runtime-fixtures";

beforeAll(installBrowserShims);
beforeEach(() => {
  close.mockReset().mockResolvedValue(undefined);
  primeLegalAcceptance(null); // First launch unless a test says otherwise.
});
afterEach(resetHarness);

const [privacy, agreement] = CURRENT_LEGAL_DOCUMENTS;
const gate = () => screen.getByRole("main", { name: /Before you start|has changed/ });
const nav = () => screen.queryByRole("navigation", { name: "Primary navigation" });
const store1 = () => createAppStore({ accounts: [makeAccount({ id: "acct-a", name: "Eval A" })], trades: [makeTrade({ id: "ta", accountId: "acct-a", symbol: "MESZ6" })] });

/** Closes the app and starts it again the way main.tsx does: preload the record, then render. */
async function reopen(path: string, store: ReturnType<typeof createAppStore>) {
  cleanup();
  await preloadLegalAcceptance();
  return renderApp(path, store);
}

describe("first launch", () => {
  it("shows only the agreement screen, focused, with the privacy summary and both draft documents", async () => {
    const store = store1();
    const listAccounts = vi.spyOn((store.repository as unknown as { accounts: { list: () => unknown } }).accounts, "list");
    const { user } = renderApp("/", store);
    const main = gate();
    const title = within(main).getByRole("heading", { level: 1, name: "Before you start" });
    expect(document.activeElement).toBe(title);
    // No app content, navigation or journal reads before acceptance.
    expect(nav()).toBeNull();
    expect(screen.queryByText("MESZ6")).toBeNull();
    expect(listAccounts).not.toHaveBeenCalled();
    expect(within(main).getByText(/keeps your journal only on this computer/)).toBeTruthy();
    expect(within(main).getByText("Draft documents")).toBeTruthy();
    // Headings: h1, then h2 sections; documents open as h3 articles with h4 sections.
    expect(within(main).getAllByRole("heading", { level: 2 }).map(h => h.textContent)).toEqual(["Your privacy", "Documents"]);
    for (const doc of [privacy, agreement]) {
      const summary = within(main).getByText(`Read the ${doc.title.replace(" (draft)", "").toLowerCase()}`);
      expect(summary.closest("summary")!.textContent).toContain(`(draft, version ${doc.version})`);
      await user.click(summary);
      const article = within(main).getByRole("article", { name: doc.title });
      expect(within(article).getByText("Draft")).toBeTruthy();
      expect(within(article).getByText(new RegExp(`Version ${doc.version.replace(/\./g, "\\.")}`))).toBeTruthy();
    }
    // Keyboard only: from the title, Tab reaches the expanders, then Decline, then Accept.
    title.focus();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) { await user.tab(); order.push(document.activeElement!.textContent ?? ""); }
    expect(order).toEqual([expect.stringMatching(/^Read the privacy notice/), expect.stringMatching(/^Read the user agreement/), "Decline and close", "Accept and continue"]);
    await expectNoAxeViolations();
  });

  it("Accept stores the current versions and digests, opens the app, and a reopen goes straight in", async () => {
    const store = store1();
    const { user } = renderApp("/", store);
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeTruthy();
    expect(nav()).toBeTruthy();
    expect(boundary.legal.record).toEqual({ documents: currentAcceptance(), acceptedAt: boundary.legal.now });
    expect(boundary.invocations.filter(c => c === "record_legal_acceptance")).toHaveLength(1);

    await reopen("/journal", store);
    expect(await screen.findByText("MESZ6")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Before you start" })).toBeNull();
  });

  it("Decline closes the window without writing a record or any journal data", async () => {
    const store = store1();
    const listAccounts = vi.spyOn((store.repository as unknown as { accounts: { list: () => unknown } }).accounts, "list");
    const { user } = renderApp("/", store);
    await user.click(screen.getByRole("button", { name: "Decline and close" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(boundary.legal.record).toBeNull();
    expect(boundary.invocations).not.toContain("record_legal_acceptance");
    expect(listAccounts).not.toHaveBeenCalled();
    expect(store.accounts.size).toBe(1);
    // Still nothing but the agreement while the window closes.
    expect(nav()).toBeNull();
  });

  it("if the window can't close, says so and still offers both choices", async () => {
    close.mockRejectedValue(new Error("not allowed"));
    const { user } = renderApp("/");
    await user.click(screen.getByRole("button", { name: "Decline and close" }));
    expect(await screen.findByText("FundedFlow couldn't close itself")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Accept and continue" }) as HTMLButtonElement).disabled).toBe(false);
    expect(nav()).toBeNull();
  });

  it("never traps: if the record can't be saved the app opens for this session and asks again next launch", async () => {
    boundary.legal.writeError = new Error("disk full");
    const store = store1();
    const { user } = renderApp("/", store);
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeTruthy();
    expect(await screen.findByText("Your answer couldn't be saved")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByText(/This session only/)).toBeTruthy();

    boundary.legal.writeError = null;
    await reopen("/", store);
    expect(gate()).toBeTruthy();
  });

  it("works while the journal is failing to open: accept needs no journal, then recovery is shown", async () => {
    boundary.statusAnswers = [failed("open_failed")];
    const { user } = renderApp("/");
    expect(gate()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your journal couldn't be opened" })).toBeTruthy();
    expect(boundary.legal.record).not.toBeNull();
  });

  it("treats a record this build can't read as no record", async () => {
    boundary.legal.record = { documents: "garbage", acceptedAt: 7 } as never;
    await preloadLegalAcceptance();
    renderApp("/");
    expect(within(gate()).getByRole("heading", { level: 1, name: "Before you start" })).toBeTruthy();
  });
});

describe("a later launch", () => {
  it("asks again after a version change, names what changed, and keeps the other document's acceptance", async () => {
    const older = currentAcceptance().map(d => (d.id === privacy.id ? { ...d, version: "0.0.9-draft", digest: "e".repeat(64) } : d));
    boundary.legal.record = acceptedRecord(older);
    const store = store1();
    await reopen("/", store);
    const main = gate();
    expect(within(main).getByRole("heading", { level: 1, name: "The privacy notice or agreement has changed" })).toBeTruthy();
    expect(within(main).getByText(`Updated since you last accepted: ${privacy.title} (version ${privacy.version}).`)).toBeTruthy();
    expect(nav()).toBeNull();
    await act(async () => { screen.getByRole("button", { name: "Accept and continue" }).click(); });
    expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeTruthy();
    expect(boundary.legal.record!.documents).toEqual(currentAcceptance());
  });

  it("a reinstall that kept the app-data folder keeps the record: no prompt for the same versions", async () => {
    boundary.legal.record = acceptedRecord();
    await reopen("/", store1());
    expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Before you start" })).toBeNull();
  });
});

describe("the record belongs to this install, not the journal", () => {
  beforeEach(() => {
    boundary.legal.record = acceptedRecord();
    primeLegalAcceptance(acceptedRecord());
  });

  it("erasing the journal keeps it: no prompt, and Settings still shows the acceptance", async () => {
    const store = store1();
    const { user } = renderApp("/settings", store);
    await user.click(await screen.findByRole("button", { name: "Erase entire journal…" }));
    const dialog = await screen.findByRole("dialog", { name: "Erase the entire local journal?" });
    const box = within(dialog).getByRole("textbox", { name: /Type the confirmation/ });
    await user.click(box);
    await user.paste("ERASE ENTIRE JOURNAL");
    await user.click(within(dialog).getByRole("button", { name: "Erase entire journal" }));
    await waitFor(() => expect(store.accounts.size).toBe(0));
    expect(screen.queryByRole("heading", { name: "Before you start" })).toBeNull();
    expect(boundary.legal.record).toEqual(acceptedRecord());
    await reopen("/settings", store);
    expect(await screen.findByRole("heading", { level: 2, name: "Privacy & legal" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Before you start" })).toBeNull();
  });

  it("restoring an archive from another install keeps this install's record", async () => {
    const store = store1();
    const BACKUP = "D:\\Other PC\\fundedflow.ffj.zip";
    store.archives.set(BACKUP, archivePreview({ accountIds: ["acct-old"], entities: { accounts: 1, trades: 0 } }));
    store.stageRestore({ accounts: [makeAccount({ id: "acct-old", name: "Other install" })], trades: [] });
    const { user } = renderApp("/settings", store);
    boundary.dialog.open.push(BACKUP);
    await user.click(await screen.findByRole("button", { name: "Choose backup to restore…" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace the journal with this archive?" });
    await within(dialog).findByText("Checksums, version and contents verified");
    boundary.statusAnswers = [readyStatus];
    boundary.retryAnswers = [initializingStatus];
    boundary.onRetry = () => store.installStaged();
    const box = within(dialog).getByRole("textbox", { name: /Type the confirmation/ });
    await user.click(box);
    await user.paste("REPLACE ENTIRE JOURNAL");
    await user.click(within(dialog).getByRole("button", { name: "Replace entire journal" }));
    expect(await screen.findByRole("dialog", { name: "Journal restored" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Before you start" })).toBeNull();
    expect(boundary.legal.record).toEqual(acceptedRecord());
    await reopen("/accounts", store);
    expect(await screen.findByText(/Other install/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Before you start" })).toBeNull();
  });
});

describe("Settings → Privacy & legal", () => {
  it("shows the summary, the accepted versions and date, both documents and the licence, with no axe violations", async () => {
    boundary.legal.record = acceptedRecord();
    primeLegalAcceptance(acceptedRecord());
    const { user } = renderApp("/settings", store1());
    const heading = await screen.findByRole("heading", { level: 2, name: "Privacy & legal" });
    const section = heading.closest("section")!;
    expect(within(section).getByText(/keeps your journal only on this computer/)).toBeTruthy();
    const list = section.querySelector<HTMLElement>("dl[aria-label='Accepted documents']")!;
    expect(within(list).getAllByText(`Version ${privacy.version} · Draft dated October 21, 2026`)).toHaveLength(2);
    expect(within(list).getByText(agreement.title)).toBeTruthy();
    expect(within(list).getByText(/Oct 21, 2026/)).toBeTruthy();
    expect(ACCEPTED_AT).toBe("2026-10-21T18:00:00.000Z");
    // The static local-only paragraph is gone: the wording lives here once.
    expect(screen.getAllByText(/keeps your journal only on this computer/)).toHaveLength(1);
    for (const name of [/^Read the privacy notice/, /^Read the user agreement/, /^Licence and third-party notices/]) {
      await user.click(within(section).getByText(name));
    }
    expect(within(section).getByRole("article", { name: privacy.title })).toBeTruthy();
    expect(within(section).getByText("Copyright (c) 2026 Kyle Shabaga. All rights reserved.")).toBeTruthy();
    expect(within(section).getByText("Not included in this build yet.")).toBeTruthy();
    await expectNoAxeViolations();
  });
});
