import { describe, expect, it } from "vitest";

import {
  UNKNOWN,
  formatInstant,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatTradingDay,
  moneySign,
  sumMoney,
  zonedDay,
  zonedWallTime,
  zonedWallTimeToInstant,
} from "./format";

describe("formatMoney", () => {
  it("signs, groups and pads decimal text", () => {
    expect(formatMoney("1792.68")).toBe("+$1,792.68");
    expect(formatMoney("-275.73")).toBe("−$275.73");
    expect(formatMoney("1234567.5")).toBe("+$1,234,567.50");
    expect(formatMoney("0")).toBe("$0.00");
    expect(formatMoney("-0.004")).toBe("$0.00");
  });

  it("shows unknown as a dash, never as zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("not money")).toBe("—");
  });

  it("rounds half away from zero without floats", () => {
    expect(formatMoney("0.005")).toBe("+$0.01");
    expect(formatMoney("-0.005")).toBe("−$0.01");
    expect(formatMoney("2.675")).toBe("+$2.68"); // 2.675 is 2.67499… as a float
    expect(formatMoney("9007199254740.993")).toBe("+$9,007,199,254,740.99");
  });

  it("supports whole dollars and unsigned amounts", () => {
    expect(formatMoney("6120.4", { dp: 0, signed: false })).toBe("$6,120");
    expect(formatMoney("-6120.5", { dp: 0, signed: false })).toBe("−$6,121");
  });
});

describe("formatMoneyCompact", () => {
  it("abbreviates large amounts", () => {
    expect(formatMoneyCompact("14250")).toBe("+$14.3K");
    expect(formatMoneyCompact("-2100000")).toBe("−$2.1M");
    expect(formatMoneyCompact("999950")).toBe("+$1.0M");
    expect(formatMoneyCompact("812.4")).toBe("+$812");
    expect(formatMoneyCompact("-9999.4")).toBe("−$9,999");
    expect(formatMoneyCompact("0")).toBe("$0");
    expect(formatMoneyCompact(null)).toBe("—");
  });
});

describe("sumMoney", () => {
  it("adds exactly", () => {
    expect(sumMoney(["0.1", "0.2"])).toBe("0.3");
    expect(sumMoney(["26", "-36", "16.5"])).toBe("6.5");
    expect(sumMoney([])).toBe("0");
  });
  it("is unknown when any part is unknown", () => {
    expect(sumMoney(["10", null])).toBeNull();
  });
});

describe("moneySign, formatPercent, formatTradingDay", () => {
  it("classifies", () => {
    expect(moneySign("0.000001")).toBe("profit");
    expect(moneySign("-1")).toBe("loss");
    expect(moneySign("0")).toBe("flat");
    expect(moneySign(null)).toBe("flat");
  });
  it("formats percent", () => {
    expect(formatPercent(7.623)).toBe("+7.62%");
    expect(formatPercent(-1.08)).toBe("−1.08%");
    expect(formatPercent(-0.001)).toBe("0.00%");
    expect(formatPercent(null)).toBe("—");
  });
  it("names a trading day without time zones", () => {
    expect(formatTradingDay("2026-10-19")).toBe("Mon Oct 19");
    expect(formatTradingDay("2026-03-08")).toBe("Sun Mar 8");
  });
});

describe("account time zone helpers", () => {
  it("reads and writes wall-clock times in the account's zone, not the computer's", () => {
    expect(zonedWallTimeToInstant("2026-10-20T20:00", "America/New_York")).toBe("2026-10-21T00:00:00.000Z");
    expect(zonedWallTimeToInstant("2026-01-15T09:30", "America/New_York")).toBe("2026-01-15T14:30:00.000Z");
    expect(zonedWallTimeToInstant("2026-10-20T08:00", "Europe/London")).toBe("2026-10-20T07:00:00.000Z");
    expect(zonedWallTime("2026-10-21T00:00:00.000Z", "America/New_York")).toBe("2026-10-20T20:00");
    expect(zonedWallTime("2026-10-21T00:00:00.000Z", "UTC")).toBe("2026-10-21T00:00");
  });

  it("gives the calendar day in the account's zone", () => {
    expect(zonedDay("2026-10-21T00:00:00.000Z", "America/New_York")).toBe("2026-10-20");
    expect(zonedDay("2026-10-21T00:00:00.000Z", "Asia/Tokyo")).toBe("2026-10-21");
    expect(zonedDay("not a time", "UTC")).toBe(UNKNOWN);
  });

  it("handles daylight-saving changes and bad input", () => {
    // 02:30 does not exist on 2026-03-08 in New York; it resolves after the gap.
    expect(zonedWallTimeToInstant("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedWallTimeToInstant("2026-03-08T03:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 happens twice on 2026-11-01; the earlier (daylight-saving) one is used.
    expect(zonedWallTimeToInstant("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedWallTimeToInstant("2026-11-01T12:00", "America/New_York")).toBe("2026-11-01T17:00:00.000Z");
    expect(zonedWallTimeToInstant("", "UTC")).toBe("");
    expect(zonedWallTimeToInstant("2026-10-20", "UTC")).toBe("");
  });
});

describe("formatInstant", () => {
  it("shows the time in the given zone", () => {
    expect(formatInstant("2026-10-19T20:12:00Z", { timeZone: "America/New_York" })).toBe("Oct 19, 16:12");
    expect(formatInstant("2026-10-19T20:12:00Z", { timeZone: "America/New_York", year: true, zoneName: true })).toBe("Oct 19, 2026, 16:12 EDT");
  });
  it("treats missing and malformed instants as unknown", () => {
    expect(formatInstant(null)).toBe("—");
    expect(formatInstant("yesterday")).toBe("—");
  });
});
