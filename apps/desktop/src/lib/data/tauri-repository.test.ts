import { describe, expect, it } from "vitest";

import { RepositoryError } from "./schemas";
import { type Invoke, createTauriRepository } from "./tauri-repository";

function fake(reply: (command: string) => unknown) {
  const calls: [string, Record<string, unknown>][] = [];
  const invoke: Invoke = async (command, args) => {
    calls.push([command, args]);
    return reply(command);
  };
  return { repo: createTauriRepository(invoke), calls };
}

const account = {
  id: "a1",
  name: "Eval",
  broker: null,
  propFirm: null,
  externalRef: null,
  accountType: "evaluation",
  status: "active",
  currency: "USD",
  startingBalance: "50000",
  timezone: "America/New_York",
  tradingDayResetTime: "17:00",
  notes: null,
  createdAt: "2026-10-19T14:30:00.000Z",
  updatedAt: "2026-10-19T14:30:00.000Z",
};

describe("Tauri JournalRepository adapter", () => {
  // The command names and argument keys are the IPC contract with commands.rs.
  it("sends each call to the same command with the same arguments", async () => {
    const { repo, calls } = fake((command) => (command.startsWith("list_") ? [] : null));
    await repo.accounts.list();
    await repo.accounts.archive("a1");
    await repo.trades.list("a1");
    await repo.trades.remove("t1");
    await repo.journal.list("a1");
    await repo.journal.remove("j1");
    await repo.imports.list("a1");
    await repo.imports.problemRows("b1");
    expect(calls).toEqual([
      ["list_accounts", {}],
      ["archive_account", { id: "a1" }],
      ["list_trades", { accountId: "a1" }],
      ["delete_trade", { id: "t1" }],
      ["list_journal_entries", { accountId: "a1" }],
      ["delete_journal_entry", { id: "j1" }],
      ["list_csv_imports", { accountId: "a1" }],
      ["list_csv_import_problem_rows", { batchId: "b1" }],
    ]);
  });

  it("sends account lifecycle calls to the commands in commands.rs", async () => {
    const { repo, calls } = fake((command) => {
      switch (command) {
        case "list_accounts":
        case "list_active_accounts":
        case "get_account_lineage":
          return [];
        case "get_account":
        case "restore_account":
        case "change_account_status":
          return account;
        case "get_account_history":
          return { statusEvents: [], archiveEvents: [] };
        case "reset_account_attempt":
          return {
            predecessor: account, successor: { ...account, id: "a2", predecessorAccountId: "a1" },
            link: {
              predecessorAccountId: "a1", successorAccountId: "a2", priorOutcome: "failed", effectiveAt: "2026-10-20T19:00:00.000Z",
              reason: null, source: "user_entered", rulebookDecision: "deferred", createdAt: "2026-10-20T19:00:00.000Z",
            },
            rulebookAssignment: null,
          };
        default:
          return {
            accountId: "a1", accountName: "Eval", trades: 0, deletedTrades: 0, journalEntries: 0, importBatches: 0,
            statusEvents: 1, rulebookAssignments: 0, privateRulebooks: 0, snapshots: 0, ledgerEntries: 0, phaseEvents: 0,
            linkedAttempts: [], blockers: ["not available"],
          };
      }
    });
    await repo.accounts.list({ includeArchived: true });
    await repo.accounts.listActive();
    await repo.accounts.get("a1");
    await repo.accounts.restore("a1");
    await repo.accounts.changeStatus("a1", { status: "failed", cause: "Hit the daily limit" });
    await repo.accounts.history("a1");
    await repo.accounts.lineage("a1");
    await repo.accounts.previewDeletion("a1");
    const reset = await repo.accounts.resetAttempt({
      predecessorAccountId: "a1", priorOutcome: "failed", effectiveAt: "2026-10-20T15:00:00-04:00", source: "user_entered",
      name: "Attempt 2", startingBalance: "50000", rulebook: { kind: "decideLater" },
    });
    expect(reset.successor.predecessorAccountId).toBe("a1");
    expect(calls.map(([c]) => c)).toEqual([
      "list_accounts", "list_active_accounts", "get_account", "restore_account", "change_account_status",
      "get_account_history", "get_account_lineage", "preview_account_deletion", "reset_account_attempt",
    ]);
    expect(calls[0]?.[1]).toEqual({ includeArchived: true });
    expect(calls[4]?.[1]).toMatchObject({ id: "a1", input: { status: "failed", cause: "Hit the daily limit" } });
    expect(calls[8]?.[1]).toMatchObject({ input: { priorOutcome: "failed", rulebook: { kind: "decideLater" } } });
  });

  it("rejects a reset without a confirmed outcome before invoking anything", async () => {
    const { repo, calls } = fake(() => null);
    expect(() =>
      repo.accounts.resetAttempt({
        predecessorAccountId: "a1", effectiveAt: "2026-10-20T15:00:00-04:00", source: "user_entered", name: "x",
        startingBalance: "50000", rulebook: { kind: "decideLater" },
      } as never),
    ).toThrow(/priorOutcome/);
    expect(calls).toEqual([]);
  });

  it("sends Build 10 repository calls to the commands in commands.rs", async () => {
    const snapshot = {
      id: "s1", accountId: "a1", rulebookVersionId: null, tradingDay: "2026-10-19", isEndOfDay: true, dataAsOf: null,
      dataSource: "manual", calculatedAt: "2026-10-19T21:00:00.000Z", engineVersion: "1", inputsHash: "h",
      feesIncluded: true, unrealizedIncluded: false, balance: "50000", realizedDayPnl: "0", unrealizedPnl: null,
      dailyLossLimit: null, dailyLossRemaining: null, drawdownMode: null, highWaterMark: null, drawdownFloor: null,
      drawdownHeadroom: null, drawdownLocked: false, profitTarget: null, tradingDaysCompleted: 0,
      tradingDaysRequired: null, status: "unknown", statusReasons: ["no rulebook"], explanation: { note: "x" },
    };
    const ledger = {
      id: "l1", accountId: "a1", kind: "payout", amount: "-100", affectsBalance: true,
      effectiveAt: "2026-10-19T21:30:00.000Z", tradingDay: "2026-10-20", note: null,
      createdAt: "2026-10-19T21:30:00.000Z", updatedAt: "2026-10-19T21:30:00.000Z",
    };
    const { repo, calls } = fake((command) => {
      switch (command) {
        case "get_setting": return null;
        case "set_setting": return { key: "ui.theme", value: { mode: "dark" }, updatedAt: "2026-10-19T21:30:00.000Z" };
        case "list_settings": case "list_ledger_entries": case "list_account_snapshots": case "list_account_phase_events": return [];
        case "create_ledger_entry": return ledger;
        case "get_ledger_balance_adjustment": return "-100";
        case "save_account_snapshot": return snapshot;
        case "get_latest_account_snapshot": return null;
        case "get_catalogue":
          return { graph: { providers: [], programmeFamilies: [], programmeVariants: [], catalogueVersions: [], programmePhases: [], phasePaths: [], commercialOffers: [], promotions: [], promotionOffers: [] }, sources: [] };
        default: return null;
      }
    });
    expect(await repo.settings.get("ui.theme")).toBeNull();
    expect((await repo.settings.set("ui.theme", { mode: "dark" })).value).toEqual({ mode: "dark" });
    await repo.settings.list();
    await repo.settings.remove("ui.theme");
    expect(() => repo.settings.set("Bad Key", 1)).toThrow(/lower-case/);
    await repo.ledger.list("a1");
    await repo.ledger.create({ accountId: "a1", kind: "payout", amount: "-100", effectiveAt: "2026-10-19T17:30:00-04:00" });
    expect(await repo.ledger.balanceAdjustment("a1")).toBe("-100");
    await repo.ledger.remove("l1");
    const saved = await repo.snapshots.save({
      accountId: "a1", tradingDay: "2026-10-19", isEndOfDay: true, dataSource: "manual", engineVersion: "1", inputsHash: "h",
      feesIncluded: true, unrealizedIncluded: false, balance: "50000", realizedDayPnl: "0", drawdownLocked: false,
      tradingDaysCompleted: 0, status: "unknown", statusReasons: ["no rulebook"], explanation: { note: "x" },
    });
    expect(saved.unrealizedPnl).toBeNull();
    await repo.snapshots.list("a1", { from: "2026-10-01", endOfDayOnly: true });
    expect(await repo.snapshots.latest("a1")).toBeNull();
    await repo.catalogue.load();
    // The reply is not a version, so parsing rejects it; only the command and arguments matter here.
    await repo.catalogue.transitionVersion("v1", "verified", "Kyle").catch(() => undefined);
    await repo.catalogue.listPhaseEvents("a1");
    expect(calls.map(([c]) => c)).toEqual([
      "get_setting", "set_setting", "list_settings", "remove_setting", "list_ledger_entries", "create_ledger_entry",
      "get_ledger_balance_adjustment", "delete_ledger_entry", "save_account_snapshot", "list_account_snapshots",
      "get_latest_account_snapshot", "get_catalogue", "transition_catalogue_version", "list_account_phase_events",
    ]);
    expect(calls[9]?.[1]).toEqual({ accountId: "a1", from: "2026-10-01", to: null, endOfDayOnly: true });
    expect(calls[12]?.[1]).toEqual({ id: "v1", to: "verified", reviewer: "Kyle" });
  });

  it("sends rulebook calls to the commands in commands.rs", async () => {
    const { repo, calls } = fake((command) =>
      command.startsWith("list_") || command === "validate_rulebook_draft"
        ? []
        : command === "get_applicable_rulebook"
          ? { status: "none", rulebookVersionIds: [] }
          : null,
    );
    const phase = "01900000-0000-7000-8000-000000000041";
    await repo.rulebooks.list(null);
    await repo.rulebooks.list("a1");
    await repo.rulebooks.listVersions("rb1");
    await repo.rulebooks.getApplicable({ programmePhaseId: phase, phasePathId: null });
    await repo.rulebooks.validateDraft("v1");
    await repo.rulebooks.listAssignments("a1");
    expect(calls).toEqual([
      ["list_rulebooks", { accountId: null }],
      ["list_rulebooks", { accountId: "a1" }],
      ["list_rulebook_versions", { rulebookId: "rb1" }],
      ["get_applicable_rulebook", { query: { programmePhaseId: phase, phasePathId: null } }],
      ["validate_rulebook_draft", { id: "v1" }],
      ["list_account_rulebook_assignments", { accountId: "a1" }],
    ]);
    // Inputs are validated before invoking.
    const bad = await Promise.resolve()
      .then(() => repo.rulebooks.assign({ accountId: "a1", rulebookVersionId: "v1", effectiveFrom: "10/01/2026" } as never))
      .catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(RepositoryError);
    expect(calls).toHaveLength(6);
  });

  it("wraps inputs as { id, input } and parses the response", async () => {
    const { repo, calls } = fake(() => account);
    const input = {
      name: "Eval",
      accountType: "evaluation",
      status: "active",
      currency: "USD",
      startingBalance: "50000",
      timezone: "America/New_York",
      tradingDayResetTime: "17:00",
    } as const;
    expect(await repo.accounts.update("a1", input)).toEqual({
      ...account, archivedAt: null, predecessorAccountId: null, successorAccountId: null,
    });
    expect(calls[0]?.[0]).toBe("update_account");
    expect(Object.keys(calls[0]?.[1] ?? {})).toEqual(["id", "input"]);
  });

  it("rejects invalid input before invoking", async () => {
    const { repo, calls } = fake(() => null);
    const err = await repo.trades.remove("t1").then(() => repo.journal.create({} as never)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as RepositoryError).error.kind).toBe("validation");
    expect(calls.map(([c]) => c)).toEqual(["delete_trade"]);
  });

  it("turns command errors into RepositoryError", async () => {
    const invoke: Invoke = () => Promise.reject({ kind: "notFound", message: "trade 't1' was not found" });
    const err = await createTauriRepository(invoke).trades.remove("t1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as RepositoryError).error).toEqual({ kind: "notFound", message: "trade 't1' was not found" });
  });

  it("fails loudly on payload drift", async () => {
    const { repo } = fake(() => [{ ...account, startingBalance: 50000 }]);
    await expect(repo.accounts.list()).rejects.toThrow();
  });
});
