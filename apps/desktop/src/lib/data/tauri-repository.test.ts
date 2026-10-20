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
