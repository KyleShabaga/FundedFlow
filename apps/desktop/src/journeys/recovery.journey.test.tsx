// @vitest-environment jsdom
// Build 26.5 recovery and diagnostics through the real <App />: the RuntimeProvider and runtime gateway answer
// from the Tauri invoke boundary (src/test/boundaries.ts). One route is replaced by a fault injector so a render
// failure can be raised on demand; everything else is real. jsdom evidence only: native startup failures and
// rollback are covered by src-tauri/src/runtime/tests.rs, packaged behaviour by the pending smoke checklist.
import { RepositoryError } from "@fundedflow/domain";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);
// Fault injection: Insights throws while `fault.on` is set, with private-looking text in its message and cause.
const fault = vi.hoisted(() => ({ on: false }));
vi.mock("../features/insights/components/InsightsPage", async importOriginal => {
  const real = await importOriginal<typeof import("../features/insights/components/InsightsPage")>();
  return {
    InsightsPage: () => {
      if (fault.on) {
        throw Object.assign(new TypeError("Cannot read 'pnl' of trade 'ESZ6 +$1,250 note: revenge trade' at C:\\Users\\Jane Trader\\AppData\\Roaming\\com.fundedflow.desktop\\journal.db"),
          { cause: new Error("SELECT * FROM trades WHERE account_id = 'acct-secret-7f3a'; token=sk-live-SECRET") });
      }
      return <real.InsightsPage />;
    },
  };
});

import { COMMAND_TIMEOUT_MS, type RuntimeStatus } from "../lib/data/runtime";
import { createAppStore, makeAccount } from "../test/app-store";
import { boundary, deferredFor, readyStatus } from "../test/boundaries";
import { installBrowserShims, renderApp, resetHarness } from "../test/harness";

beforeAll(installBrowserShims);
beforeEach(() => { fault.on = false; });
afterEach(resetHarness);

const PRIVATE = ["Jane Trader", "C:\\Users", "AppData", "journal.db", "SELECT", "acct-secret", "sk-live", "revenge", "1,250", "ESZ6"];
const expectNoPrivateText = (text: string) => { for (const p of PRIVATE) expect(text, p).not.toContain(p); };
const failedStatus = (category: "data_directory" | "open_failed" | "backup_failed" | "migration_failed" | "newer_schema"): RuntimeStatus => {
  const stage = { data_directory: "data_directory", open_failed: "open", backup_failed: "backup", migration_failed: "migrate", newer_schema: "open" } as const;
  return {
    state: "failed", stage: stage[category], created: false, supportedSchemaVersion: 20,
    schemaVersion: category === "newer_schema" ? 21 : category === "migration_failed" ? 19 : category === "data_directory" ? null : 18,
    failure: {
      category, retryable: category !== "newer_schema", message: "Synthetic failure message.",
      // What native IO/SQLite errors look like: the detail is never shown or copied.
      detail: "Os { code: 5, kind: PermissionDenied } opening C:\\Users\\Jane Trader\\AppData\\Roaming\\com.fundedflow.desktop\\journal.db; SELECT name FROM sqlite_master",
      failedMigration: category === "migration_failed" ? { version: 20, name: "source_fact_immutability", fromVersion: 18, reachedVersion: 19 } : null,
    },
  };
};
const diagnosticsText = () => (document.querySelector(".ds-diagnostics-text")?.textContent ?? "");
const notice = () => screen.getByRole("alert");

describe("startup failures", () => {
  it.each(["data_directory", "open_failed", "backup_failed", "migration_failed"] as const)("%s: explains it, offers Retry, and copies an allowlisted summary", async category => {
    boundary.statusAnswers = [failedStatus(category)];
    renderApp("/accounts", { accounts: [makeAccount({ id: "acct-a", name: "Eval A" })] });
    await waitFor(() => expect(notice().textContent).toContain("Synthetic failure message."));
    expect(within(notice()).getByRole("button", { name: "Retry" })).toBeTruthy();
    const text = diagnosticsText();
    expect(text).toMatch(/^FundedFlow diagnostic summary/);
    expect(text).toContain(`Code: ${category}`);
    expect(text).toMatch(/Incident: FF-[0-9A-F]{12}/);
    expect(text).toContain("FundedFlow version: 0.1.0");
    expect(text).toContain("Supported journal version: 20");
    expect(text).toContain("Screen: accounts");
    if (category === "migration_failed") expect(text).toContain("Failed upgrade step: step 20 (from 18, reached 19)");
    if (category === "data_directory") expect(text).toContain("Journal version: unknown");
    expectNoPrivateText(document.body.textContent ?? "");
    // No route content is mounted and nothing claims an empty journal.
    expect(screen.queryByText(/Add your first trading account/)).toBeNull();
  });

  it("refuses a newer journal: no Retry, reset or downgrade, and the summary says why", async () => {
    boundary.statusAnswers = [failedStatus("newer_schema")];
    renderApp("/");
    await waitFor(() => expect(notice().textContent).toContain("This journal needs a newer FundedFlow"));
    expect(within(notice()).queryByRole("button", { name: /Retry|Reset|Restore|Downgrade/ })).toBeNull();
    expect(diagnosticsText()).toContain("Code: newer_schema");
    expect(diagnosticsText()).toContain("Journal version: 21");
    expect(diagnosticsText()).toContain("Retry allowed: false");
    expect(boundary.invocations).toEqual(["runtime_status"]);
  });

  it("keeps one incident id while the same failure is re-polled, copies it, and survives a clipboard that refuses", async () => {
    boundary.statusAnswers = [failedStatus("open_failed")];
    const { user } = renderApp("/");
    // After userEvent.setup(), which installs its own clipboard stub.
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await waitFor(() => expect(diagnosticsText()).toContain("Code: open_failed"));
    const first = diagnosticsText().match(/FF-[0-9A-F]+/)![0];
    await user.click(screen.getByText("Diagnostic summary"));
    await user.click(screen.getByRole("button", { name: "Copy summary" }));
    expect(writeText).toHaveBeenCalledWith(diagnosticsText());
    expect(await screen.findByText("Copied.")).toBeTruthy();
    // Retry fails the same way: same incident.
    await user.click(within(notice()).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(notice()).getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(diagnosticsText()).toContain(first);
    await user.click(screen.getByRole("button", { name: "Copy summary" }));
    expect(await screen.findByText(/Couldn't copy\. Select the text above/)).toBeTruthy();
    expect(diagnosticsText()).toContain(first);
  });
});

describe("Ready → unavailable → Ready", () => {
  it("keeps navigation and an open form's values, disables saving while unavailable, and saves once after Retry", async () => {
    const store = createAppStore({ accounts: [makeAccount({ id: "acct-a", name: "Eval A" })] });
    const { user } = renderApp("/accounts", store);
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add account" });
    const name = within(dialog).getByRole("textbox", { name: /Account name/ });
    await user.click(name);
    await user.paste("Eval B");
    const balance = within(dialog).getByRole("textbox", { name: /Starting balance/ });
    await user.click(balance);
    await user.paste("50000");
    // The app regains focus and the read-only check finds the journal closed.
    boundary.statusAnswers = [failedStatus("open_failed")];
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.getAllByText(/Your journal couldn't be opened/).length).toBeGreaterThan(0));
    const save = within(dialog).getAllByRole("button", { name: "Add account" }).find(b => b.closest(".ds-dialog-foot"))!;
    expect(save.getAttribute("aria-disabled") === "true" || (save as HTMLButtonElement).disabled).toBe(true);
    await user.click(save);
    expect(store.accounts.size).toBe(1);
    expect((name as HTMLInputElement).value).toBe("Eval B");
    expect(boundary.invocations).not.toContain("retry_runtime");
    // The modal hides the shell's notice, so the form offers the same explicit Retry; values stay.
    expect(within(dialog).getByText("Local data isn't available")).toBeTruthy();
    boundary.statusAnswers = [readyStatus];
    boundary.retryAnswers = [readyStatus];
    await user.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(save.getAttribute("aria-disabled")).toBeNull());
    expect(boundary.invocations.filter(c => c === "retry_runtime")).toHaveLength(1);
    await user.click(save);
    await waitFor(() => expect(store.accounts.size).toBe(2));
  });

  it("runs one retry for rapid Retry presses and overlapping focus checks", async () => {
    boundary.statusAnswers = [failedStatus("open_failed")];
    const { user } = renderApp("/");
    const retry = await screen.findByRole("button", { name: "Retry" });
    const answer = deferredFor<RuntimeStatus>();
    boundary.retryAnswers = [answer.promise];
    await user.click(retry);
    for (let i = 0; i < 3; i++) {
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      const again = screen.queryByRole("button", { name: "Retry" });
      if (again && !(again as HTMLButtonElement).disabled) await user.click(again);
    }
    expect(boundary.invocations.filter(c => c === "retry_runtime")).toHaveLength(1);
    boundary.statusAnswers = [readyStatus];
    await act(async () => answer.resolve(readyStatus));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    expect(boundary.invocations.filter(c => c === "retry_runtime")).toHaveLength(1);
  });
});

describe("timeouts and late answers", () => {
  it("after a timed-out status check, keeps the command locked until it settles and ignores its late answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const stuck = deferredFor<RuntimeStatus>();
    boundary.statusAnswers = [stuck.promise];
    const { user } = renderApp("/", {}, { fakeTimers: true });
    await act(() => vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS + 10));
    await waitFor(() => expect(notice().textContent).toMatch(/did not answer|couldn't start/i));
    expect(diagnosticsText()).toContain("Code: timeout");
    // Retry while the first invoke is still running: refused as pending, no second native call.
    await user.click(within(notice()).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(notice().textContent).toContain("A local data request is still pending"));
    expect(boundary.invocations).toEqual(["runtime_status"]);
    // The late answer is ignored; only a fresh, explicit recovery opens the journal.
    await act(async () => stuck.resolve(readyStatus));
    expect(screen.getByRole("alert").textContent).toContain("still pending");
    boundary.statusAnswers = [readyStatus];
    boundary.retryAnswers = [readyStatus];
    await user.click(within(notice()).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(boundary.invocations.filter(c => c === "retry_runtime")).toHaveLength(1);
  });
});

describe("render failures", () => {
  it("contains a crash, focuses its heading, and shows a summary without the error's text, path, SQL or ids", async () => {
    fault.on = true;
    renderApp("/insights?accounts=acct-secret-7f3a", { accounts: [makeAccount({ id: "acct-secret-7f3a", name: "Jane's revenge account" })] });
    const heading = await screen.findByRole("heading", { name: "FundedFlow couldn't display this screen" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const text = diagnosticsText();
    expect(text).toContain("Code: render_TypeError");
    expect(text).toContain("Screen: insights");
    expect(text).toContain("Local data state: unknown");
    expectNoPrivateText(document.body.textContent ?? "");
    expect(document.body.textContent).not.toContain("Jane's revenge account");
  });

  it("returns to the app without releasing an unconfirmed save or sending it again", async () => {
    const store = createAppStore();
    const { user } = renderApp("/accounts", store);
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    let dialog = await screen.findByRole("dialog", { name: "Add account" });
    for (const [label, text] of [[/Account name/, "Eval 50K"], [/Starting balance/, "50000"]] as const) {
      const field = within(dialog).getByRole("textbox", { name: label });
      await user.click(field);
      await user.paste(text);
    }
    const lost = store.hold("accounts.create");
    await user.click(within(dialog).getAllByRole("button", { name: "Add account" }).find(b => b.closest(".ds-dialog-foot"))!);
    await act(() => lost.fail(new RepositoryError({ kind: "database", message: "x" })));
    await within(dialog).findByText("Couldn't confirm it saved");
    // A different screen crashes; the trader returns to the app.
    fault.on = true;
    window.location.hash = "/insights";
    await user.click(await screen.findByRole("button", { name: "Return to app" }));
    fault.on = false;
    window.location.hash = "/accounts";
    // Wait for Accounts: right after "Return to app" the hash is "/", and Today has its own Add account link.
    await screen.findByRole("heading", { name: "Accounts", level: 1 });
    await user.click((await screen.findAllByRole("button", { name: "Add account" }))[0]);
    dialog = await screen.findByRole("dialog", { name: "Add account" });
    expect(within(dialog).getByText("Couldn't confirm it saved")).toBeTruthy();
    expect(lost.calls).toHaveLength(1);
  });
});
