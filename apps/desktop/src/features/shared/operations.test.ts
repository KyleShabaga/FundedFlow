import { RepositoryError } from "@fundedflow/domain";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { account, trade, batch, T, deferred } from "./test-fixtures";
import { normalizeError } from "./errors";
import { readOperation, READ_TIMEOUT_MS } from "./operations";
import { readAccounts, createAccount } from "../accounts/api/accounts";
import { readTrades, removeTrade, saveTrade } from "../trades/api/trades";
import { readImportProblemRows } from "../imports/api/imports";

const repo = vi.hoisted(() => ({ accounts: { list: vi.fn(), get: vi.fn(), create: vi.fn() }, trades: { list: vi.fn(), create: vi.fn(), remove: vi.fn() }, imports: { list: vi.fn(), problemRows: vi.fn() } }));
vi.mock("../../lib/data/api", () => ({ repository: repo }));
beforeEach(() => { vi.resetAllMocks(); repo.accounts.get.mockResolvedValue(account); repo.accounts.list.mockResolvedValue([account]); repo.trades.list.mockResolvedValue([trade]); });
afterEach(() => vi.useRealTimers());
it("uses the existing repository, distinguishes empty reads and preserves receipt source/time", async () => {
  const result = await readAccounts("all");
  expect(repo.accounts.list).toHaveBeenCalledWith({ includeArchived: true });
  expect(result.value[0].id).toBe("a"); expect(result.source).toBe("local-repository");
  expect(Date.parse(result.receivedAt)).not.toBeNaN();
  repo.accounts.list.mockResolvedValue([]);
  expect((await readAccounts()).value).toEqual([]);
  repo.accounts.list.mockRejectedValue(new RepositoryError({ kind: "unavailable", message: "private path" }));
  await expect(readAccounts()).rejects.toMatchObject({ category: "unavailable", backendKind: "unavailable" });
});
it.each(["validation", "notFound", "conflict", "database", "unavailable"] as const)("normalizes %s without exposing Rust/SQL/paths", kind => {
  const error = normalizeError(new RepositoryError(kind === "validation"
    ? { kind, message: "secret", issues: [{ field: "name", message: "SQL /private/path" }] }
    : { kind, message: "SQL /private/path" }));
  expect(error.backendKind).toBe(kind); expect(error.message).not.toMatch(/SQL|private/);
  expect(JSON.stringify(error.issues)).not.toMatch(/SQL|private/);
});
it("rejects output drift, invalid inputs and cross-account data instead of manufacturing values", async () => {
  repo.accounts.list.mockResolvedValue([{ ...account, updatedAt: "bad" }]);
  await expect(readAccounts()).rejects.toMatchObject({ category: "invalid-response" });
  await expect(createAccount({} as never)).rejects.toMatchObject({ category: "validation" });
  expect(repo.accounts.create).not.toHaveBeenCalled();
  repo.trades.list.mockResolvedValue([{ ...trade, accountId: "other" }]);
  await expect(readTrades("a")).rejects.toMatchObject({ category: "invalid-response" });
});
it("filters stored trading days without recomputing P&L or silently changing the input period", async () => {
  repo.trades.list.mockResolvedValue([trade, { ...trade, id: "t2", tradingDay: "2026-10-21" }]);
  const result = await readTrades("a", { from: "2026-10-21", to: "2026-10-21", symbol: "MES" });
  expect(result.value.map(value => value.id)).toEqual(["t2"]);
  await expect(readTrades("a", { from: "2026-10-22", to: "2026-10-21" })).rejects.toMatchObject({ category: "validation" });
});
it("checks record and batch ownership before destructive or row-specific commands", async () => {
  await expect(removeTrade("a", "not-owned")).rejects.toMatchObject({ category: "not-found" });
  expect(repo.trades.remove).not.toHaveBeenCalled();
  repo.imports.list.mockResolvedValue([{ ...batch, accountId: "other" }]);
  await expect(readImportProblemRows("a", "b")).rejects.toMatchObject({ category: "invalid-response" });
  expect(repo.imports.problemRows).not.toHaveBeenCalled();
});
it("rechecks readiness after async write preparation and treats malformed write output as uncertain", async () => {
  const input = { accountId: "a", symbol: "MES", side: "long" as const, quantity: "1", entryAt: T, entryPrice: "5000" };
  await expect(saveTrade("a", input, undefined, () => { throw new RepositoryError({ kind: "unavailable", message: "unavailable" }); }))
    .rejects.toMatchObject({ category: "unavailable" });
  expect(repo.trades.create).not.toHaveBeenCalled();
  repo.trades.create.mockResolvedValue({ ...trade, id: "" });
  await expect(saveTrade("a", input)).rejects.toMatchObject({ category: "uncertain-outcome" });
});
it("bounds read consumption, aborts without starting future reads and ignores late responses", async () => {
  vi.useFakeTimers();
  const response = deferred<number>(); const task = vi.fn(() => response.promise);
  const promise = readOperation(task, value => value);
  const rejected = expect(promise).rejects.toMatchObject({ category: "timeout" });
  await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS); await rejected;
  response.resolve(1); await vi.advanceTimersByTimeAsync(0);
  const signal = new AbortController(); signal.abort();
  await expect(readOperation(task, value => value, signal.signal)).rejects.toMatchObject({ category: "cancelled" });
  expect(task).toHaveBeenCalledTimes(1);
});
