// Synthetic DTOs for Build 14 tests only. Never exported from feature entrypoints.
import type { Account, Trade, JournalEntry, ImportBatch, Snapshot } from "@fundedflow/domain";
export const T = "2026-10-20T15:00:00.000Z";
export const account: Account = { id: "a", name: "Test account", broker: null, propFirm: null, externalRef: null,
  accountType: "evaluation", status: "active", currency: "USD", startingBalance: "9007199254740.993", timezone: "America/New_York",
  tradingDayResetTime: "17:00", notes: null, createdAt: T, updatedAt: T, archivedAt: null, predecessorAccountId: null, successorAccountId: null };
export const trade: Trade = { id: "t", accountId: "a", source: "manual", importBatchId: null, brokerTradeId: null, symbol: "MES", side: "long", quantity: "1",
  entryAt: T, entryPrice: "5000", exitAt: null, exitPrice: null, fees: "0", tradingDay: "2026-10-20", reportedPnl: null,
  grossPnl: null, realizedPnl: null, pnlStatus: "open", notes: null, roundTrip: null, createdAt: T, updatedAt: T };
export const journal: JournalEntry = { id: "j", accountId: "a", tradeId: null, entryAt: T, title: "Test note", body: "", tags: [], createdAt: T, updatedAt: T };
export const batch: ImportBatch = { id: "b", accountId: "a", fileName: "fixture.csv", fileSha256: "0".repeat(64), fileSize: 100, sourceFormat: "generic", status: "committed",
  rowCount: 1, importedCount: 1, skippedCount: 0, duplicateCount: 0, failedCount: 0, warningCount: 0, errorSummary: null, createdAt: T, completedAt: T };
export const snapshot: Snapshot = { id: "s", accountId: "a", rulebookVersionId: null, tradingDay: "2026-10-20", isEndOfDay: true,
  dataAsOf: null, dataSource: "none", calculatedAt: T, engineVersion: "test-engine", inputsHash: "test-hash", feesIncluded: true, unrealizedIncluded: false,
  balance: "0", realizedDayPnl: "0", unrealizedPnl: null, dailyLossLimit: null, dailyLossRemaining: null, drawdownMode: null, highWaterMark: null,
  drawdownFloor: null, drawdownHeadroom: null, drawdownLocked: false, profitTarget: null, tradingDaysCompleted: 0, tradingDaysRequired: null,
  status: "unknown", statusReasons: ["No verified inputs"], explanation: { fixture: true } };
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
