import { beforeEach, expect, it, vi } from "vitest";
import type { JournalRepository } from "@fundedflow/domain";
import { createTauriRepository } from "../../lib/data/tauri-repository";
import { account, trade } from "./test-fixtures";
import { readTrades } from "../trades/api/trades";
import { readAccount, createAccount } from "../accounts/api/accounts";
const adapter = vi.hoisted(() => ({ current: null as unknown as JournalRepository }));
vi.mock("../../lib/data/api", () => ({ get repository() { return adapter.current; } }));
const invoke = vi.fn();
beforeEach(() => { invoke.mockReset(); adapter.current = createTauriRepository(invoke); });
it("runs feature reads through the existing adapter and real command argument/DTO contracts", async () => {
  invoke.mockImplementation(async (command: string) => command === "get_account" ? account : [trade]);
  const value = (await readTrades("a")).value[0];
  expect(value.id).toBe("t"); expect(value.currency).toBe("USD"); expect(value.realizedPnl).toBeNull();
  expect(invoke.mock.calls).toEqual([["get_account", { id: "a" }], ["list_trades", { accountId: "a" }]]);
});
it("preserves known adapter errors and treats unvalidated write acknowledgements as uncertain", async () => {
  invoke.mockRejectedValue({ kind: "notFound", message: "private native diagnostic" });
  await expect(readAccount("a")).rejects.toMatchObject({ category: "not-found", backendKind: "notFound" });
  invoke.mockResolvedValue({ invalid: "acknowledgement" });
  await expect(createAccount({ name: "Test", accountType: "evaluation", status: "active", currency: "USD", startingBalance: "100", timezone: "UTC", tradingDayResetTime: "00:00" }))
    .rejects.toMatchObject({ category: "uncertain-outcome" });
});
