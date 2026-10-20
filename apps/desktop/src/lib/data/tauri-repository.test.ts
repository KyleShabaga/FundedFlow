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
    expect(await repo.accounts.update("a1", input)).toEqual(account);
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
