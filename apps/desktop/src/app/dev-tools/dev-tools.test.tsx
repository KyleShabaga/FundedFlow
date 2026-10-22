// @vitest-environment jsdom
// Build 26.9 developer tools: sidebar placement and gating, Add Fake Data and Reset All Data dialogs.
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../features/accounts/components/AccountsPage", () => ({ AccountsPage: () => <h2>Accounts page</h2> }));
vi.mock("../../features/journal/components/JournalPage", () => ({ JournalPage: () => <h2>Journal page</h2> }));
vi.mock("../../features/daily-reviews/components/DailyReviewPage", () => ({ DailyReviewPage: () => <h2>Daily review</h2> }));
vi.mock("../../features/today/components/TodayPage", () => ({ TodayPage: () => <h2>Today page</h2> }));
vi.mock("../../features/insights/components/InsightsPage", () => ({ InsightsPage: () => <h2>Insights page</h2> }));
vi.mock("../../features/accounts/components/AccountSwitcher", () => ({ AccountSwitcher: () => null }));
vi.mock("../../features/data-controls/components/DataControlsPage", () => ({ DataControlsPage: () => <h2>Settings page</h2> }));

import { ToastProvider } from "../../design-system";
import { featureKeys } from "../../features/shared/query-keys";
import DevSidebarTools from "./DevSidebarTools";
import { primeAccepted } from "../../test/legal";

const ready = { state: "ready", stage: "ready", schemaVersion: 20, supportedSchemaVersion: 20, created: false, failure: null };
const TEST_DIR = "/work/.dev-journal/com.fundedflow.desktop";
const status = (over: Record<string, unknown> = {}) => ({
  isolated: true, dataDir: TEST_DIR, defaultDataDir: "/home/dev/.local/share/com.fundedflow.desktop", problem: null,
  envVar: "FUNDEDFLOW_DEV_DATA_DIR", defaultSeed: 2609, lastReset: null,
  presets: [{ id: "ui_smoke", scenarios: ["happy_path"], windowDays: 120 }, { id: "stress", scenarios: ["happy_path", "stress"], windowDays: 180 }],
  ...over,
});
const report = {
  preset: "ui_smoke", seed: 2609, anchorDay: "2026-10-21", skipped: [], totalAccounts: 2, totalTrades: 130,
  accounts: [
    { scenario: "happy_path", accountId: "a1", name: "DEMO · Evaluation 50K (on track)", status: "active", archived: false, trades: 122, winners: 60, losers: 55, breakeven: 7, tradingDays: 51, startingBalance: "50000", endingBalance: "51598.77", netPnl: "1598.77", fees: "200", drawdownFloor: "49598.77", importBatches: 0, rejectedImportRows: 0, journalEntries: 9, tradeReviews: 44, dailyReviews: 9, observations: 1, covers: [] },
    { scenario: "archived", accountId: "a2", name: "DEMO · Evaluation 25K (closed and archived)", status: "closed", archived: true, trades: 8, winners: 4, losers: 4, breakeven: 0, tradingDays: 5, startingBalance: "25000", endingBalance: "25010", netPnl: "10", fees: "10", drawdownFloor: "23500", importBatches: 0, rejectedImportRows: 0, journalEntries: 0, tradeReviews: 0, dailyReviews: 0, observations: 1, covers: [] },
  ],
};
const preview = {
  dataDir: TEST_DIR, scope: "All local journal data: accounts, trades, imports, journal entries, rulebooks, catalogue edits, settings, snapshots and app-data attachments.",
  counts: { accounts: 7, archivedAccounts: 1, trades: 532, importBatches: 2, journalEntries: 49, tradeReviews: 153, dailyReviews: 13, rulebooks: 5, observations: 9, snapshots: 0 },
  backupPattern: `${TEST_DIR}.backup-<timestamp>-<id>`, tool: "/work/scripts/reset-test-data.mjs", toolOutput: "Preview only.", cli: `node scripts/reset-test-data.mjs --all --yes --data-dir "${TEST_DIR}"`,
};

type Handler = (args?: Record<string, unknown>) => unknown;
function route(handlers: Record<string, Handler>) {
  invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command];
    if (!handler) return ready;
    return handler(args);
  });
}
const calls = (command: string) => invoke.mock.calls.filter(([c]) => c === command);

function renderTools(collapsed = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const journalReads = vi.fn(async () => "journal");
  function JournalProbe() {
    useQuery({ queryKey: featureKeys.accountList("live"), queryFn: journalReads });
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <JournalProbe />
        <DevSidebarTools collapsed={collapsed} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { journalReads };
}

beforeEach(() => {
  primeAccepted();
  window.location.hash = "/";
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  invoke.mockReset();
  route({ dev_tools_status: () => status() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("puts Add Fake Data and Reset All Data directly above Settings in the sidebar footer", async () => {
  const { default: App } = await import("../../App");
  (await import("../../test/legal")).primeAccepted(); // the module instance this App reads
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Primary navigation" });
  const group = await within(nav).findByRole("group", { name: "Developer tools" });
  const footer = nav.querySelector(".shell-nav-footer")!;
  const controls = [...footer.querySelectorAll("a, button")].map(el => el.getAttribute("aria-label"));
  expect(controls).toEqual(["Add Fake Data", "Reset All Data", "Settings"]);
  expect(footer.contains(group)).toBe(true);
  // Not part of the scrolling main navigation.
  expect(nav.querySelector(".shell-nav-main")!.contains(group)).toBe(false);
  // No native call until the desktop webview or a dialog asks for it.
  expect(calls("dev_tools_status")).toHaveLength(0);
});

it("keeps icon-only controls named and tooltipped when the sidebar is collapsed, and reachable by keyboard", async () => {
  const user = userEvent.setup();
  renderTools(true);
  const add = screen.getByRole("button", { name: "Add Fake Data" });
  expect(add.querySelector(".ds-sr-only")?.textContent).toBe("Add Fake Data");
  await user.tab();
  expect(document.activeElement).toBe(add);
  expect((await screen.findByRole("tooltip")).textContent).toContain("Add Fake Data");
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset All Data" }));
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog", { name: "Reset All Data" })).toBeTruthy();
});

it("is absent from production builds", async () => {
  vi.stubEnv("DEV", false);
  vi.resetModules();
  const { default: App } = await import("../../App");
  (await import("../../test/legal")).primeAccepted(); // the module instance this App reads
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Primary navigation" });
  await screen.findByRole("heading", { name: "Today page" });
  expect(within(nav).queryByRole("group", { name: "Developer tools" })).toBeNull();
  expect(within(nav).queryByRole("button", { name: "Add Fake Data" })).toBeNull();
  expect(within(nav).queryByRole("button", { name: "Reset All Data" })).toBeNull();
  expect(invoke.mock.calls.some(([c]) => String(c).startsWith("dev_"))).toBe(false);
});

it("seeds the default UI Smoke preset into the shown test journal, once, and refreshes journal reads", async () => {
  const user = userEvent.setup();
  let finish!: (value: unknown) => void;
  route({ dev_tools_status: () => status(), dev_seed_fake_data: () => new Promise(resolve => { finish = resolve; }) });
  const { journalReads } = renderTools();
  await waitFor(() => expect(journalReads).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Add Fake Data" }));
  const dialog = await screen.findByRole("dialog", { name: "Add Fake Data" });
  expect((await within(dialog).findByTestId("dev-target-dir")).textContent).toBe(TEST_DIR);
  expect(within(dialog).getByText(/DEMO \/ TEST DATA/)).toBeTruthy();
  expect((within(dialog).getByRole("radio", { name: /UI Smoke/ }) as HTMLInputElement).checked).toBe(true);
  const generate = within(dialog).getByRole("button", { name: "Generate" });
  await user.click(generate);
  // Busy: a second click does nothing and the dialog cannot be dismissed.
  fireEvent.click(within(dialog).getByRole("button", { name: /Generating/ }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Add Fake Data" })).toBeTruthy();
  expect(within(dialog).getByRole("status").textContent).toMatch(/Generating accounts/);
  expect(calls("dev_seed_fake_data")).toEqual([["dev_seed_fake_data", { options: { preset: "ui_smoke", seed: 2609 } }]]);
  await act(async () => finish(report));
  expect(await within(dialog).findByText("Created 2 accounts and 130 trades")).toBeTruthy();
  expect(within(dialog).getByText(/closed and archived/)).toBeTruthy();
  await waitFor(() => expect(journalReads).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Fake data added")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Fake Data" })).toBeNull());
});

it("sends the chosen preset and seed and reports a refusal without claiming changes", async () => {
  const user = userEvent.setup();
  route({
    dev_tools_status: () => status(),
    dev_seed_fake_data: () => Promise.reject({ kind: "conflict", message: "this test journal already has every requested scenario (happy_path). Nothing was added." }),
  });
  renderTools();
  await user.click(screen.getByRole("button", { name: "Add Fake Data" }));
  const dialog = await screen.findByRole("dialog", { name: "Add Fake Data" });
  await within(dialog).findByTestId("dev-target-dir");
  await user.click(within(dialog).getByRole("radio", { name: /Stress \/ Edge Cases/ }));
  await user.type(within(dialog).getByRole("textbox", { name: /Seed/ }), "42");
  await user.click(within(dialog).getByRole("button", { name: "Generate" }));
  expect(await within(dialog).findByText(/already has every requested scenario/)).toBeTruthy();
  expect(within(dialog).getByText("Nothing was added")).toBeTruthy();
  expect(calls("dev_seed_fake_data")[0][1]).toEqual({ options: { preset: "stress", seed: 42 } });
  await user.clear(within(dialog).getByRole("textbox", { name: /Seed/ }));
  await user.type(within(dialog).getByRole("textbox", { name: /Seed/ }), "-1");
  expect(within(dialog).getByRole("button", { name: "Generate" }).getAttribute("aria-disabled")).toBe("true");
});

it("refuses to seed without an isolated test journal and explains how to start one", async () => {
  const user = userEvent.setup();
  route({ dev_tools_status: () => status({ isolated: false, dataDir: null }) });
  renderTools();
  await user.click(screen.getByRole("button", { name: "Add Fake Data" }));
  const dialog = await screen.findByRole("dialog", { name: "Add Fake Data" });
  expect(await within(dialog).findByText("Isolated test journal required")).toBeTruthy();
  expect(within(dialog).getByText(/npm run dev:test-journal/)).toBeTruthy();
  const generate = within(dialog).getByRole("button", { name: "Generate" });
  expect(generate.getAttribute("aria-disabled")).toBe("true");
  await user.click(generate);
  expect(calls("dev_seed_fake_data")).toHaveLength(0);
});

it("previews the reset, requires typing RESET exactly, and cancels without acting", async () => {
  const user = userEvent.setup();
  route({ dev_tools_status: () => status(), dev_reset_preview: () => preview });
  renderTools();
  await user.click(screen.getByRole("button", { name: "Reset All Data" }));
  const dialog = await screen.findByRole("dialog", { name: "Reset All Data" });
  expect(await within(dialog).findByText("This erases the whole test journal")).toBeTruthy();
  expect(within(dialog).getByTestId("dev-target-dir").textContent).toBe(TEST_DIR);
  await within(dialog).findByText("What will be erased", { exact: false }).catch(() => null);
  expect(within(dialog).getByText("532")).toBeTruthy();
  expect(within(dialog).getAllByText(new RegExp(preview.backupPattern.replace(/[.*+?^${}()|[\]\\<>]/g, "\\$&"))).length).toBeGreaterThan(0);
  expect(within(dialog).getByText(/reset-test-data.mjs --all --yes/)).toBeTruthy();
  const reset = within(dialog).getByRole("button", { name: "Reset" });
  expect(reset.getAttribute("aria-disabled")).toBe("true");
  const field = within(dialog).getByRole("textbox", { name: /Type RESET to confirm/ });
  await user.type(field, "reset");
  expect(reset.getAttribute("aria-disabled")).toBe("true");
  await user.click(reset);
  expect(calls("dev_reset_handoff")).toHaveLength(0);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reset All Data" })).toBeNull());
  expect(calls("dev_reset_handoff")).toHaveLength(0);
  // Reopening starts from an empty confirmation and a fresh preview.
  await user.click(screen.getByRole("button", { name: "Reset All Data" }));
  const again = await screen.findByRole("dialog", { name: "Reset All Data" });
  expect((within(again).getByRole("textbox", { name: /Type RESET/ }) as HTMLInputElement).value).toBe("");
  expect(calls("dev_reset_preview").length).toBe(2);
});

it("hands the reset off after RESET and explains that FundedFlow closes", async () => {
  const user = userEvent.setup();
  route({
    dev_tools_status: () => status(),
    dev_reset_preview: () => preview,
    dev_reset_handoff: () => ({ dataDir: TEST_DIR, report: `${TEST_DIR}.dev-reset.json`, log: "/work/.dev-journal/com.fundedflow.desktop.dev-reset.log", reopen: "npm run dev:test-journal" }),
  });
  renderTools();
  await user.click(screen.getByRole("button", { name: "Reset All Data" }));
  const dialog = await screen.findByRole("dialog", { name: "Reset All Data" });
  await within(dialog).findByText("532");
  await user.type(within(dialog).getByRole("textbox", { name: /Type RESET to confirm/ }), "RESET");
  await user.click(within(dialog).getByRole("button", { name: "Reset" }));
  expect(await within(dialog).findByText("FundedFlow is closing to finish the reset")).toBeTruthy();
  expect(calls("dev_reset_handoff")).toEqual([["dev_reset_handoff", { confirmation: "RESET" }]]);
  // Once handed off, the dialog cannot be dismissed into a closed journal.
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Reset All Data" })).toBeTruthy();
});

it("shows a refused preview and a failed handoff as nothing reset", async () => {
  const user = userEvent.setup();
  route({ dev_tools_status: () => status(), dev_reset_preview: () => Promise.reject({ kind: "conflict", message: "the reset tool refused the preview: Reset refused: Data directory must be a real directory, not a file or symlink." }) });
  renderTools();
  await user.click(screen.getByRole("button", { name: "Reset All Data" }));
  let dialog = await screen.findByRole("dialog", { name: "Reset All Data" });
  expect(await within(dialog).findByText(/must be a real directory/)).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Reset" }).getAttribute("aria-disabled")).toBe("true");
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

  route({ dev_tools_status: () => status(), dev_reset_preview: () => preview, dev_reset_handoff: () => Promise.reject({ kind: "conflict", message: "The reset helper could not start (not found). Nothing was reset." }) });
  await user.click(screen.getByRole("button", { name: "Reset All Data" }));
  dialog = await screen.findByRole("dialog", { name: "Reset All Data" });
  await within(dialog).findByText("532");
  await user.type(within(dialog).getByRole("textbox", { name: /Type RESET to confirm/ }), "RESET");
  await user.click(within(dialog).getByRole("button", { name: "Reset" }));
  expect(await within(dialog).findByText("Nothing was reset")).toBeTruthy();
  expect(within(dialog).getByText(/helper could not start/)).toBeTruthy();
});

it("reports the last reset's backup once after restart and clears the report", async () => {
  vi.stubGlobal("isTauri", true);
  route({
    dev_tools_status: () => status({ lastReset: { status: "completed", requestedAt: "a", finishedAt: "b", dataDir: TEST_DIR, backup: `${TEST_DIR}.backup-2026-10-21`, message: "All active journal data reset.", log: null } }),
    dev_dismiss_reset_report: () => null,
  });
  renderTools();
  expect(await screen.findByText("Test journal reset")).toBeTruthy();
  expect(screen.getByText(/backup-2026-10-21/)).toBeTruthy();
  await waitFor(() => expect(calls("dev_dismiss_reset_report")).toHaveLength(1));
});
