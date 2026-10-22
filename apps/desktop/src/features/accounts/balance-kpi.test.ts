// NA-4: the Accounts "Current balance" KPI. Totals are exact (bigint micro-units), one per currency, only over
// balances Today calls current; unknown is — and never zero.
import { describe, expect, it } from "vitest";

import { currentBalanceKpi } from "./view-models/balance-kpi";

const usd = (amount: string) => ({ amount, currency: "USD" });

describe("Current balance KPI", () => {
  it("is — when no live account has a current balance, and says how many were looked at", () => {
    expect(currentBalanceKpi([null, null, null])).toEqual({
      value: { kind: "unavailable", reason: "None of the 3 live accounts has a current estimate. Calculate on Today; each account shows its checkpoints." },
      sub: "0 of 3 live accounts · none current",
    });
    expect(currentBalanceKpi([null]).value).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("The live account has no current estimate.") });
    expect(currentBalanceKpi([]).value).toEqual({ kind: "unavailable", reason: "No live accounts." });
  });

  it("waits while any account is still being checked", () => {
    expect(currentBalanceKpi([usd("1"), undefined]).value).toEqual({ kind: "text", text: null });
  });

  it("one currency: the exact total of current balances, with stale or unknown ones counted out", () => {
    expect(currentBalanceKpi([usd("50000.10"), usd("0.000001"), null])).toEqual({
      value: { kind: "money", amount: "50000.100001", currency: "USD", signed: false },
      sub: "2 of 3 live accounts · current estimates",
    });
  });

  it("several currencies: one total each, never added together", () => {
    const kpi = currentBalanceKpi([usd("100"), { amount: "12480.55", currency: "EUR" }, usd("50.5"), null]);
    expect(kpi.value).toEqual({ kind: "text", text: "€12,480.55 · $150.50" });
    expect(kpi.sub).toBe("3 of 4 live accounts · each currency totalled on its own");
  });
});
