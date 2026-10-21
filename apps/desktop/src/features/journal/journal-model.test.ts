import type { ReviewSummary } from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import { makeAccount } from "../accounts/test-store";
import { toTradeViewModel } from "../trades/view-models/trade";
import { cumulative, filterRows, groupByDay, holdTime, joinRows, NO_FILTERS, sortRows, stats } from "./components/journal-model";
import { trade } from "./test-store";

const account = makeAccount({ id: "a", name: "A" });
const vm = (over: Parameters<typeof trade>[0]) => toTradeViewModel(trade(over), account);
const rows = (trades: ReturnType<typeof vm>[], summaries: ReviewSummary[] = []) => joinRows(trades, summaries);

describe("journal model", () => {
  const t = [
    vm({ id: "w1", accountId: "a", realizedPnl: "100.1", grossPnl: "104.1", fees: "4", quantity: "2", tradingDay: "2026-10-19", entryAt: "2026-10-19T13:00:00.000Z" }),
    vm({ id: "l1", accountId: "a", realizedPnl: "-50.05", grossPnl: "-46.05", fees: "4", tradingDay: "2026-10-19", entryAt: "2026-10-19T14:00:00.000Z" }),
    vm({ id: "be", accountId: "a", realizedPnl: "0", grossPnl: "4", fees: "4", tradingDay: "2026-10-20", entryAt: "2026-10-20T13:00:00.000Z" }),
    vm({ id: "op", accountId: "a", exitAt: null, exitPrice: null, realizedPnl: null, grossPnl: null, pnlStatus: "open", tradingDay: "2026-10-20", entryAt: "2026-10-20T14:00:00.000Z" }),
    vm({ id: "un", accountId: "a", realizedPnl: null, grossPnl: null, pnlStatus: "missing_instrument", tradingDay: "2026-10-20", entryAt: "2026-10-20T15:00:00.000Z" }),
  ];

  it("adds exact sums of known P&L only and counts what is left out", () => {
    const s = stats(rows(t));
    expect(s).toMatchObject({ trades: 5, known: 3, open: 1, unknown: 1, winners: 1, losers: 1, breakeven: 1, net: "50.05", gross: "62.05", fees: "20", contracts: "6" });
    expect(s.winRate).toBeCloseTo(33.333, 2);
    expect(s.profitFactor).toBeCloseTo(2, 2);
    expect(s.averageWin).toBe("100.1");
    expect(s.averageLoss).toBe("-50.05");
    const none = stats(rows([t[3], t[4]]));
    expect([none.net, none.winRate, none.profitFactor]).toEqual([null, null, null]);
  });

  it("averages exactly with rounding half away from zero", () => {
    const thirds = [1, 2, 3].map(n => vm({ id: `x${n}`, accountId: "a", realizedPnl: "-0.000001", grossPnl: "-0.000001", fees: "0" }));
    thirds.push(vm({ id: "x4", accountId: "a", realizedPnl: "-0.000002", grossPnl: "-0.000002", fees: "0" }));
    // −0.000005 / 4 = −0.00000125 → −0.000001
    expect(stats(rows(thirds)).averageLoss).toBe("-0.000001");
  });

  it("groups by the stored trading day, newest day first, trades in entry order", () => {
    const groups = groupByDay(rows([...t].reverse()));
    expect(groups.map(g => g.day)).toEqual(["2026-10-20", "2026-10-19"]);
    expect(groups[1].rows.map(r => r.trade.id)).toEqual(["w1", "l1"]);
  });

  it("filters by result, source, tag, strategy, review and search text", () => {
    const summaries: ReviewSummary[] = [{ tradeId: "l1", reviewed: true, strategyId: "s1", strategyName: "ORB", tags: [{ tagId: "g1", label: "Chased", kind: "mistake", currentLabel: null, archived: false }],
      executionRating: 2, adherence: { followed: 1, missed: 1, notApplicable: 0 }, screenshotCount: 0, notes: "late entry" }];
    const r = rows(t, summaries);
    const ids = (f: Partial<typeof NO_FILTERS>) => filterRows(r, { ...NO_FILTERS, ...f }).map(x => x.trade.id);
    expect(ids({ result: "loss" })).toEqual(["l1"]);
    expect(ids({ result: "unknown" })).toEqual(["un"]);
    expect(ids({ tagId: "g1" })).toEqual(["l1"]);
    expect(ids({ strategyId: "s1" })).toEqual(["l1"]);
    expect(ids({ reviewed: "not-reviewed" })).toHaveLength(4);
    expect(ids({ search: "LATE" })).toEqual(["l1"]);
    expect(ids({ search: "chased" })).toEqual(["l1"]);
    expect(ids({ from: "2026-10-20" })).toEqual(["be", "op", "un"]);
  });

  it("sorts money exactly with unknown last, and breaks ties by entry then id", () => {
    const sorted = sortRows(rows(t), "netPnl", "descending").map(x => x.trade.id);
    expect(sorted.slice(0, 3)).toEqual(["w1", "be", "l1"]);
    expect(sorted.slice(3).sort()).toEqual(["op", "un"]);
    const same = [vm({ id: "b", accountId: "a" }), vm({ id: "a", accountId: "a" })];
    expect(sortRows(rows(same), "entryAt", "ascending").map(x => x.trade.id)).toEqual(["a", "b"]);
  });

  it("builds the cumulative curve from known closed trades only", () => {
    expect(cumulative(rows(t))).toEqual(["100.1", "50.05", "50.05"]);
  });

  it("formats hold time from the export's duration or the instants", () => {
    expect(holdTime(vm({ id: "h", accountId: "a", entryAt: "2026-10-19T13:00:00.000Z", exitAt: "2026-10-19T13:01:17.000Z" }))).toBe("1m 17s");
    expect(holdTime(vm({ id: "o", accountId: "a", exitAt: null, exitPrice: null, realizedPnl: null, grossPnl: null, pnlStatus: "open" }))).toBeNull();
  });
});
