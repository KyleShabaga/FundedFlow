import { expect, it } from "vitest";
import { account, batch, journal, snapshot, trade } from "./test-fixtures";
import { decimalText, instant, moneyText } from "./contracts";
import { toAccountViewModel } from "../accounts/view-models/account";
import { toTradeViewModel } from "../trades/view-models/trade";
import { toJournalViewModel } from "../journal/view-models/journal";
import { toImportViewModel } from "../imports/view-models/import";
import { toSnapshotViewModel } from "../insights/view-models/snapshot";
import { getCapability } from "./capabilities";

it("preserves decimal precision, nulls, zero, stored timestamps and financial basis", () => {
  expect(toAccountViewModel(account).startingBalance).toBe("9007199254740.993");
  expect(toAccountViewModel(account).riskEligible).toBe(true);
  expect(toAccountViewModel({ ...account, archivedAt: account.updatedAt }).riskEligible).toBe(false);
  const vm = toTradeViewModel(trade, account);
  expect(vm.fees).toBe("0"); expect(vm.realizedPnl).toBeNull(); expect(vm.reportedPnl).toBeNull();
  expect(vm.calculationBasis).toEqual({ authority: "rust-stored", version: null, net: "after-fees", gross: "before-fees" });
  expect(toJournalViewModel(journal, account).entryAt).toBe(journal.entryAt);
  const risk = toSnapshotViewModel(snapshot, account);
  expect(risk.status).toBe("unknown"); expect(risk.dailyLossRemaining).toBeNull(); expect(risk.balance).toBe("0");
  expect(risk.currency).toBeNull(); expect(risk.accountCurrency).toBe("USD");
  expect(risk.dataAsOf).toBeNull(); expect(risk.calculatedAt).toBe(snapshot.calculatedAt);
  expect(risk.provenance).toBe("persisted-snapshot-not-live");
});
it.each(["0.0000001", "9223372036854.775808", "1e3", "1,000", "1.00", "-0", " "])("rejects invalid or inexact persisted money %s", value => {
  expect(moneyText.safeParse(value).success).toBe(false);
});
it("accepts high precision prices and preserves explicit offsets without re-deriving a trading day", () => {
  expect(decimalText.parse("0.0000001")).toBe("0.0000001");
  const offset = "2026-10-20T08:00:00-07:00";
  expect(instant.parse(offset)).toBe(offset);
  expect(instant.safeParse("2026-10-20T08:00:00").success).toBe(false);
  expect(toTradeViewModel({ ...trade, entryAt: offset, tradingDay: "2026-10-21" }, account).tradingDay).toBe("2026-10-21");
});
it("rejects unknown statuses, missing values, invalid times, dates and cross-account mappings", () => {
  expect(() => toAccountViewModel({ ...account, status: "safe" })).toThrow();
  expect(() => toAccountViewModel({ ...account, startingBalance: undefined })).toThrow();
  expect(() => toAccountViewModel({ ...account, timezone: "Unknown/Zone" })).toThrow();
  expect(() => toTradeViewModel({ ...trade, tradingDay: "2026-02-30" }, account)).toThrow();
  expect(() => toJournalViewModel({ ...journal, createdAt: "yesterday" }, account)).toThrow();
  expect(() => toTradeViewModel(trade, { ...account, id: "other" })).toThrow();
  expect(() => toSnapshotViewModel(snapshot, { ...account, id: "other" })).toThrow();
});
it("sanitizes stored import diagnostics and exposes unsupported capabilities without data", () => {
  const failed = toImportViewModel({ ...batch, status: "failed", errorSummary: "SQL /private/path" });
  expect(failed.failureMessage).toContain("not completed"); expect(failed).not.toHaveProperty("errorSummary");
  const capability = getCapability("insights-aggregates");
  expect(capability.available).toBe(false); expect(capability).not.toHaveProperty("data");
  // Build 22 implemented daily reviews, so their placeholder capability is gone.
  expect(() => getCapability("structured-reviews" as never)).toThrow();
});
it("keeps a Build 16 engine snapshot's unknown balance, day P&L, day count and lock state as null, never zero or false", () => {
  const unknown = { ...snapshot, balance: null, realizedDayPnl: null, tradingDaysCompleted: null, drawdownLocked: null };
  const risk = toSnapshotViewModel(unknown, account);
  expect([risk.balance, risk.realizedDayPnl, risk.tradingDaysCompleted, risk.drawdownLocked]).toEqual([null, null, null, null]);
});
