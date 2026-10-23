// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RuntimeState } from "../../app/RuntimeProvider";
import { RepositoryError, type AccountInput } from "@fundedflow/domain";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { account, trade, batch, T, deferred } from "./test-fixtures";
import { featureKeys as keys } from "./query-keys";
import { useAccounts, useAccount, useCreateAccount } from "../accounts/hooks/accounts";
import { useCreateTrade } from "../trades/hooks/trades";
import { useCommitCsvImport, useCsvPreview } from "../imports/hooks/imports";

const runtime = vi.hoisted(() => ({ state: { kind: "checking" } as RuntimeState, check: vi.fn() }));
const repo = vi.hoisted(() => ({ accounts: { list: vi.fn(), get: vi.fn(), create: vi.fn() }, trades: { create: vi.fn() }, imports: { commit: vi.fn(), preview: vi.fn() } }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ repository: repo }));
let client: QueryClient;
const input: AccountInput = { name: "Test account", accountType: "evaluation", status: "active", currency: "USD", startingBalance: "100", timezone: "America/New_York", tradingDayResetTime: "17:00" };
const csv = { accountId: "a", fileName: "test.csv", timezone: "UTC", content: "Symbol,Qty\nMES,1" };
const ready = () => { runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 13, supportedSchemaVersion: 13, created: false, failure: null, cleanup: "clear" } }; };
function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
beforeEach(() => {
  vi.resetAllMocks(); ready(); runtime.check.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  repo.accounts.list.mockResolvedValue([account]); repo.accounts.get.mockResolvedValue(account); repo.accounts.create.mockResolvedValue(account);
  repo.trades.create.mockResolvedValue(trade); repo.imports.commit.mockResolvedValue(batch);
});
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); vi.restoreAllMocks(); });

it("separates initial loading, successful records and valid empty results", async () => {
  const response = deferred<unknown>(); repo.accounts.list.mockReturnValue(response.promise);
  const { result } = renderHook(() => useAccounts(), { wrapper: Wrapper });
  expect(result.current.isInitialLoading).toBe(true); expect(result.current.isEmpty).toBeNull();
  await act(async () => { response.resolve([]); });
  await waitFor(() => expect(result.current.isEmpty).toBe(true));
  expect(result.current.data).toEqual([]); expect(result.current.error).toBeNull(); expect(result.current.observedAt).not.toBeNull();
});
it.each(["unavailable", "unsupported-schema", "checking", "recovering"] as const)("gates %s without false empty results or background calls", async kind => {
  runtime.state = { kind } as RuntimeState;
  const { result } = renderHook(() => useAccounts(), { wrapper: Wrapper });
  const pending = kind === "checking" || kind === "recovering";
  // Startup checks and recovery retries read as loading; only settled failures are unavailable.
  expect(result.current.isEmpty).toBeNull(); expect(result.current.isInitialLoading).toBe(pending);
  expect(result.current.isRuntimePending).toBe(pending);
  expect(result.current.isUnavailable).toBe(!pending); expect(result.current.isUsable).toBe(false);
  expect(result.current.error === null).toBe(pending);
  expect(result.current.isUnsupported).toBe(kind === "unsupported-schema");
  await expect(result.current.refresh()).rejects.toMatchObject({ category: "unavailable" });
  expect(repo.accounts.list).not.toHaveBeenCalled();
});
it("never turns a rejected read into empty and does not retry known operation errors", async () => {
  repo.accounts.list.mockRejectedValue(new RepositoryError({ kind: "notFound", message: "private" }));
  const { result } = renderHook(() => useAccounts(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.error?.category).toBe("not-found"));
  expect(result.current.isEmpty).toBeNull(); expect(result.current.data).toBeUndefined(); expect(repo.accounts.list).toHaveBeenCalledTimes(1);
});
it("retains and labels previous data after refresh failure, without calling it empty/current", async () => {
  repo.accounts.list.mockResolvedValue([]);
  const { result } = renderHook(() => useAccounts(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isEmpty).toBe(true));
  const observed = result.current.observedAt;
  repo.accounts.list.mockRejectedValue(new RepositoryError({ kind: "conflict", message: "refresh failed" }));
  await act(async () => { await expect(result.current.refresh()).rejects.toMatchObject({ category: "conflict" }); });
  await waitFor(() => expect(result.current.staleReason).toBe("refresh-error"));
  expect(result.current.data).toEqual([]); expect(result.current.isEmpty).toBeNull(); expect(result.current.isUsable).toBe(false);
  expect(result.current.observedAt).toBe(observed);
});
it("invalidates retained data on runtime loss and refreshes it when readiness returns", async () => {
  const { result, rerender } = renderHook(() => useAccounts(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.data?.[0].id).toBe("a"));
  runtime.state = { kind: "unavailable", status: null, reason: "rejected" };
  rerender();
  expect(result.current.staleReason).toBe("runtime"); expect(result.current.isEmpty).toBeNull(); expect(result.current.isUsable).toBe(false);
  expect(repo.accounts.list).toHaveBeenCalledTimes(1);
  repo.accounts.list.mockResolvedValue([]); ready(); rerender();
  await waitFor(() => expect(result.current.isEmpty).toBe(true)); expect(repo.accounts.list).toHaveBeenCalledTimes(2);
});
it("cancels consumption across account switches and never caches the old account as the new one", async () => {
  const old = deferred<unknown>(); repo.accounts.get.mockImplementation((id: string) => id === "a" ? old.promise : Promise.resolve({ ...account, id }));
  const { result, rerender } = renderHook(({ id }) => useAccount(id), { initialProps: { id: "a" }, wrapper: Wrapper });
  rerender({ id: "b" });
  await waitFor(() => expect(result.current.data?.id).toBe("b"));
  await act(async () => { old.resolve(account); });
  expect(result.current.data?.id).toBe("b"); expect(client.getQueryData(keys.detail("a"))).toBeUndefined();
});
it("allows local queries and writes when the browser reports offline", async () => {
  onlineManager.setOnline(false);
  const read = renderHook(() => useAccounts(), { wrapper: Wrapper });
  await waitFor(() => expect(read.result.current.data).toBeDefined());
  const write = renderHook(() => useCreateAccount(), { wrapper: Wrapper });
  await act(async () => { await write.result.current.submit(input); });
  expect(repo.accounts.create).toHaveBeenCalledTimes(1);
});
it("blocks duplicate submissions across hook instances before React can render pending", async () => {
  const response = deferred<unknown>(); repo.accounts.create.mockReturnValue(response.promise);
  const first = renderHook(() => useCreateAccount(), { wrapper: Wrapper });
  const second = renderHook(() => useCreateAccount(), { wrapper: Wrapper });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = first.result.current.submit(input);
    await expect(first.result.current.submit(input)).rejects.toMatchObject({ category: "duplicate-submission" });
    await expect(second.result.current.submit(input)).rejects.toMatchObject({ category: "duplicate-submission" });
  });
  expect(repo.accounts.create).toHaveBeenCalledTimes(1);
  await act(async () => { response.resolve(account); await pending; });
  await waitFor(() => expect(first.result.current.outcome).toBe("confirmed-success"));
});
it("invalidates only affected resources after confirmed writes, not on validation failures", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useCreateTrade("a"), { wrapper: Wrapper });
  const tradeInput = { accountId: "a", symbol: "MES", side: "long" as const, quantity: "1", entryAt: T, entryPrice: "5000" };
  await act(async () => { await result.current.submit(tradeInput); });
  expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toContainEqual(keys.tradesRoot("a"));
  expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).not.toContainEqual(keys.tradesRoot("b"));
  invalidate.mockClear();
  await act(async () => { await expect(result.current.submit({ ...tradeInput, accountId: "b" })).rejects.toMatchObject({ category: "validation" }); });
  expect(invalidate).not.toHaveBeenCalled(); expect(repo.trades.create).toHaveBeenCalledTimes(1);
});
it("rechecks runtime readiness after async preparation before sending the native mutation", async () => {
  const response = deferred<unknown>(); repo.accounts.get.mockReturnValue(response.promise);
  const { result, rerender } = renderHook(() => useCreateTrade("a"), { wrapper: Wrapper });
  let pending!: Promise<unknown>;
  await act(async () => { pending = result.current.submit({ accountId: "a", symbol: "MES", side: "long", quantity: "1", entryAt: T, entryPrice: "5000" }); });
  runtime.state = { kind: "unavailable", status: null, reason: "rejected" }; rerender();
  await act(async () => { response.resolve(account); await expect(pending).rejects.toMatchObject({ category: "unavailable" }); });
  expect(repo.trades.create).not.toHaveBeenCalled();
});
it("keeps malformed/unconfirmed mutations locked after feedback reset until explicit record review", async () => {
  repo.accounts.create.mockResolvedValue({ ...account, id: "" });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useCreateAccount(), { wrapper: Wrapper });
  await act(async () => { await expect(result.current.submit(input)).rejects.toMatchObject({ category: "uncertain-outcome" }); });
  await waitFor(() => expect(result.current.outcome).toBe("uncertain-outcome"));
  expect(invalidate).not.toHaveBeenCalled();
  act(() => result.current.reset());
  expect(result.current.canSubmit).toBe(false);
  await expect(result.current.submit(input)).rejects.toMatchObject({ category: "uncertain-outcome" });
  expect(repo.accounts.create).toHaveBeenCalledTimes(1);
  await act(async () => { await result.current.acknowledgeUncertainOutcome({ recordsReviewed: true }); });
  expect(result.current.canSubmit).toBe(true); expect(invalidate).toHaveBeenCalled();
});
it("reports a persisted failed import as confirmed-failure and invalidates history, never trade data", async () => {
  repo.imports.commit.mockResolvedValue({ ...batch, status: "failed", errorSummary: "private database path" });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useCommitCsvImport("a"), { wrapper: Wrapper });
  await act(async () => { await result.current.submit(csv); });
  await waitFor(() => expect(result.current.outcome).toBe("confirmed-failure"));
  expect(result.current.data?.failureMessage).toContain("not completed");
  expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toContainEqual(keys.imports("a"));
  expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).not.toContainEqual(keys.tradesRoot("a"));
  expect(repo.imports.commit).toHaveBeenCalledTimes(1);
});
it("keeps CSV preview separate from commits and cancels consumption on unmount", async () => {
  const response = deferred<unknown>(); repo.imports.preview.mockReturnValue(response.promise);
  const { result, unmount } = renderHook(() => useCsvPreview(), { wrapper: Wrapper });
  let pending!: Promise<unknown>;
  await act(async () => { pending = result.current.preview(csv); });
  unmount();
  await expect(pending).rejects.toMatchObject({ category: "cancelled" });
  response.resolve({});
  expect(repo.imports.commit).not.toHaveBeenCalled();
  expect(client.getQueryCache().getAll()).toEqual([]);
});

it("distinguishes background refreshing from initial loading and keeps the original observation time", async () => {
  const { result } = renderHook(() => useAccounts(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  const observed = result.current.observedAt;
  const response = deferred<unknown>(); repo.accounts.list.mockReturnValue(response.promise);
  let refresh!: Promise<void>;
  await act(async () => { refresh = result.current.refresh(); });
  await waitFor(() => expect(result.current.isRefreshing).toBe(true)); expect(result.current.isInitialLoading).toBe(false);
  expect(result.current.observedAt).toBe(observed);
  await act(async () => { response.resolve([]); await refresh; });
  await waitFor(() => expect(result.current.isEmpty).toBe(true));
});
it("retries an unexpected safe read only once, without retrying mutations", async () => {
  repo.accounts.list.mockRejectedValue(new RepositoryError({ kind: "database", message: "temporary read error" }));
  const { result } = renderHook(() => useAccounts(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.error?.category).toBe("unexpected"), { timeout: 3000 });
  expect(repo.accounts.list).toHaveBeenCalledTimes(2);
  repo.accounts.create.mockRejectedValue(new RepositoryError({ kind: "conflict", message: "existing account" }));
  const write = renderHook(() => useCreateAccount(), { wrapper: Wrapper });
  await act(async () => { await expect(write.result.current.submit(input)).rejects.toMatchObject({ category: "conflict" }); });
  expect(repo.accounts.create).toHaveBeenCalledTimes(1);
});
it("does not display a previous account's mutation result after the bound account changes", async () => {
  const { result, rerender } = renderHook(({ id }) => useCreateTrade(id), { wrapper: Wrapper, initialProps: { id: "a" } });
  await act(async () => { await result.current.submit({ accountId: "a", symbol: "MES", side: "long", quantity: "1", entryAt: T, entryPrice: "5000" }); });
  await waitFor(() => expect(result.current.outcome).toBe("confirmed-success"));
  rerender({ id: "b" });
  expect(result.current.data).toBeUndefined(); expect(result.current.outcome).toBe("idle");
});
