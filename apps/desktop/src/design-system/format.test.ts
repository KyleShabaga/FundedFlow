import { describe, expect, it } from "vitest";

import { formatMoney, formatMoneyCompact, formatPercent, formatTradingDay, moneySign, sumMoney } from "./format";

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
