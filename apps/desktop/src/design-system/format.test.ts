import { describe, expect, it } from "vitest";

import {
  UNKNOWN,
  compareMoney,
  currencySymbol,
  formatBytes,
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
  isSupportedTimeZone,
  supportedTimeZones,
  timeZoneDisplayName,
  zoneOffsetLabel,
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

describe("display time zones (P0-D05)", () => {
  it("converts the whole instant, date included, when the zone crosses midnight", () => {
    // 23:13 UTC on Oct 21 is already Oct 22 in London (BST) and still Oct 21 in New York.
    expect(formatInstant("2026-10-21T23:13:00.000Z", { timeZone: "Europe/London", year: true, zoneName: "offset" })).toBe("Oct 22, 2026, 00:13 GMT+1");
    expect(formatInstant("2026-10-21T23:13:00.000Z", { timeZone: "America/New_York", year: true, zoneName: "offset" })).toBe("Oct 21, 2026, 19:13 GMT-4");
    expect(formatInstant("2026-10-21T23:13:00.000Z", { timeZone: "UTC", year: true, zoneName: "offset" })).toBe("Oct 21, 2026, 23:13 GMT");
  });
  it("uses each instant's own daylight-saving offset, across the transition itself", () => {
    expect(zoneOffsetLabel("2026-01-15T12:00:00.000Z", "Europe/London")).toBe("GMT");
    expect(zoneOffsetLabel("2026-07-15T12:00:00.000Z", "Europe/London")).toBe("GMT+1");
    // London springs forward at 01:00 UTC on 2026-03-29.
    expect(formatInstant("2026-03-29T00:59:00.000Z", { timeZone: "Europe/London", zoneName: "offset" })).toBe("Mar 29, 00:59 GMT");
    expect(formatInstant("2026-03-29T01:00:00.000Z", { timeZone: "Europe/London", zoneName: "offset" })).toBe("Mar 29, 02:00 GMT+1");
    // New York falls back at 06:00 UTC on 2026-11-01: 01:30 happens twice, with different offsets.
    expect(formatInstant("2026-11-01T05:30:00.000Z", { timeZone: "America/New_York", zoneName: "offset" })).toBe("Nov 1, 01:30 GMT-4");
    expect(formatInstant("2026-11-01T06:30:00.000Z", { timeZone: "America/New_York", zoneName: "offset" })).toBe("Nov 1, 01:30 GMT-5");
  });
  it("formats fractional-hour zones", () => {
    expect(formatInstant("2026-10-21T20:00:00.000Z", { timeZone: "Asia/Kolkata", year: true, zoneName: "offset" })).toBe("Oct 22, 2026, 01:30 GMT+5:30");
    expect(zoneOffsetLabel("2026-10-21T20:00:00.000Z", "Asia/Kathmandu")).toBe("GMT+5:45");
    expect(zoneOffsetLabel("bad", "UTC")).toBe("—");
  });
  it("accepts named zones only", () => {
    expect(isSupportedTimeZone("Europe/London")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
    expect(isSupportedTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isSupportedTimeZone("+01:00")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone(42)).toBe(false);
  });
  it("names zones as people read them, with IANA's current names", () => {
    expect(timeZoneDisplayName("America/New_York")).toBe("America/New York");
    expect(timeZoneDisplayName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(timeZoneDisplayName("Europe/Kiev")).toBe("Europe/Kyiv");
  });
  it("lists supported zones, sorted and including UTC", () => {
    const zones = supportedTimeZones();
    expect(zones).toContain("UTC");
    expect(zones).toContain("Europe/London");
    expect([...zones].sort()).toEqual(zones);
    expect(zones.every(isSupportedTimeZone)).toBe(true);
  });
});

describe("currency", () => {
  it("prefixes by currency code and never falls back to a dollar for other codes", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol(null)).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("CAD")).toBe("CA$");
    expect(currencySymbol("CHF")).toBe("CHF ");
    expect(currencySymbol("XQQ")).not.toContain("$");
    expect(formatMoney("-412.5", { currency: "EUR" })).toBe("−€412.50");
    expect(formatMoney("1000", { currency: "CHF", signed: false })).toBe("CHF 1,000.00");
    expect(formatMoney(null, { currency: "EUR" })).toBe(UNKNOWN);
  });
});

describe("compareMoney", () => {
  it("orders exactly and keeps unknown last in both directions", () => {
    const values = ["10", null, "-2.5", "9007199254740.993", "0"];
    expect([...values].sort((a, b) => compareMoney(a, b))).toEqual(["-2.5", "0", "10", "9007199254740.993", null]);
    expect([...values].sort((a, b) => compareMoney(a, b, "descending"))).toEqual(["9007199254740.993", "10", "0", "-2.5", null]);
    expect(compareMoney("9007199254740.993", "9007199254740.992")).toBe(1);
  });
});

describe("formatBytes", () => {
  it("scales by 1024 and keeps unknown as unknown", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12.3 * 1024 * 1024)).toBe("12 MB");
    expect(formatBytes(1090519040)).toBe("1.0 GB");
    expect(formatBytes(null)).toBe(UNKNOWN);
    expect(formatBytes(-1)).toBe(UNKNOWN);
  });
});
