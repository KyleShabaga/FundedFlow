// @vitest-environment jsdom
// Build 15 screens over the real Tauri adapter (including Build 15.5's widened JournalRepository) and the real
// Rust command payloads recorded in src/test/fixtures/command-wire.json. Only `invoke` is faked: it answers each
// command from the fixture's fresh journal, so the adapter's Zod validation and Build 14's mappers both run.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { createTauriRepository } from "../../lib/data/tauri-repository";
import wire from "../../test/fixtures/command-wire.json";
import { ACTIVE_ACCOUNT_SETTING } from "./active-account";
import { AccountDetailPage } from "./components/AccountDetailPage";
import { AccountsPage } from "./components/AccountsPage";
import { AccountSwitcher } from "./components/AccountSwitcher";

type PerAccount = (typeof wire.journals.fresh.perAccount)[number];
const journal = wire.journals.fresh;
const per = (id: unknown): PerAccount => {
  const found = journal.perAccount.find(p => p.accountId === id);
  if (!found) throw { kind: "notFound", message: "no account" };
  return found;
};

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), repository: null as unknown }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return bridge.repository; } }));

let settings: Record<string, unknown>;
async function answer(command: string, args: Record<string, unknown> = {}) {
  switch (command) {
    case "list_accounts": return args.includeArchived ? journal.accounts : journal.accounts.filter(a => a.archivedAt === null);
    case "get_account": {
      const a = journal.accounts.find(x => x.id === args.id);
      if (!a) throw { kind: "notFound", message: "no account" };
      return a;
    }
    case "get_account_history": return per(args.id).history;
    case "get_account_lineage": return per(args.id).lineage;
    case "list_csv_imports": return per(args.accountId).imports;
    case "list_account_rulebook_assignments": return [];
    case "get_setting": return String(args.key) in settings ? { key: args.key, value: settings[args.key as string], updatedAt: "2026-01-01T00:00:00.000Z" } : null;
    case "set_setting":
      settings[args.key as string] = args.value;
      return { key: args.key, value: args.value, updatedAt: "2026-01-01T00:00:00.000Z" };
    case "get_catalogue": throw { kind: "notFound", message: "no catalogue" };
    default: throw new Error(`unexpected command ${command}`);
  }
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

let client: QueryClient;
beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 14, supportedSchemaVersion: 14, created: false, failure: null } } as unknown as RuntimeState;
  settings = {};
  bridge.invoke.mockReset().mockImplementation(answer);
  bridge.repository = createTauriRepository(bridge.invoke as never);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AccountSwitcher />
          <Routes>
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Build 15 on real Rust payloads through the merged adapter", () => {
  it("exposes the Build 15.5 evidence capability without changing the account operations", () => {
    const repository = createTauriRepository(bridge.invoke as never);
    expect(Object.keys(repository.evidence).sort()).toEqual(
      ["capture", "correct", "correctLedger", "create", "get", "inputs", "ledgerHistory", "list", "reconcile", "reconciliations", "removeLedger", "resolutions", "resolve"],
    );
    expect(typeof repository.accounts.resetAttempt).toBe("function");
  });

  it("lists live, failed and archived attempts from real payloads with Rust's net P&L", async () => {
    const user = userEvent.setup();
    renderAt("/accounts");
    const table = await screen.findByRole("table", { name: "Accounts" });
    expect(within(table).getAllByRole("rowheader").map(r => r.textContent)).toEqual([expect.stringContaining("Eval 50K attempt 2")]);
    const filters = screen.getByRole("group", { name: "Show" });
    await user.click(within(filters).getByRole("button", { name: "All 3" }));
    expect(within(screen.getByRole("table", { name: "Accounts" })).getAllByRole("rowheader")).toHaveLength(3);
    await user.click(within(filters).getByRole("button", { name: "Archived 1" }));
    expect(within(screen.getByRole("table", { name: "Accounts" })).getByText("Euro account")).toBeTruthy();
    expect(screen.getByText("€50,000.00")).toBeTruthy();
    // Every read went through commands Rust registers; nothing else was called.
    const commands = new Set(bridge.invoke.mock.calls.map(c => c[0]));
    for (const c of commands) expect(["list_accounts", "get_account", "get_account_history", "get_account_lineage", "list_csv_imports", "list_account_rulebook_assignments", "get_setting", "get_catalogue"]).toContain(c);
  });

  it("shows a reset predecessor's history and lineage, and chooses an active account by id", async () => {
    const user = userEvent.setup();
    const failed = journal.accounts.find(a => a.name === "Eval 50K")!;
    renderAt(`/accounts/${failed.id}`);
    expect(await screen.findByText("Failed attempt")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Attempts/ }));
    const attempts = await screen.findByRole("table", { name: "Attempts" });
    expect(within(attempts).getAllByRole("row")).toHaveLength(3);
    expect(within(attempts).getByText("Eval 50K attempt 2")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /Choose an account/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Eval 50K attempt 2/ }));
    const successor = journal.accounts.find(a => a.name === "Eval 50K attempt 2")!;
    await waitFor(() => expect(settings[ACTIVE_ACCOUNT_SETTING]).toBe(successor.id));
    expect(bridge.invoke).toHaveBeenCalledWith("set_setting", { key: ACTIVE_ACCOUNT_SETTING, value: successor.id });
  });
});
