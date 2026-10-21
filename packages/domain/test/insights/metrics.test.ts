import { describe, expect, it } from "vitest";

import { divRound, isClosed, outcomeOf, ratioText, summarize, type InsightsTrade } from "../../src/index.js";
import fixture from "../fixtures/insights-metrics.json" with { type: "json" };

interface Case {
  name: string;
  trades: Partial<InsightsTrade>[];
  summary: Record<string, unknown>;
}

/** Fixture rows carry only the fields the summary reads; the rest are filled with inert values. */
function full(t: Partial<InsightsTrade>): InsightsTrade {
  return {
    id: "?", accountId: "acct", source: "manual", importBatchId: null, symbol: "ESZ6", symbolRoot: "ES", side: "long", quantity: "1",
    entryAt: "2026-10-19T13:00:00.000Z", exitAt: null, tradingDay: "2026-10-19", fees: "0", grossPnl: null, realizedPnl: null,
    reportedPnl: null, pnlStatus: "calculated", updatedAt: "2026-10-19T13:00:00.000Z", ...t,
    review: t.review ? { ...{ reviewed: true, strategyId: null, strategyName: null, tags: [], plannedRiskSource: null, plannedRisk: null, rMultiple: null }, ...t.review } : null,
  };
}

describe("insights-metrics.json parity with Rust", () => {
  it.each(fixture.cases as unknown as Case[])("$name", (c) => {
    // Key order differs between serde_json and JS objects; compare as values.
    expect(JSON.parse(JSON.stringify(summarize(c.trades.map(full))))).toEqual(c.summary);
  });
});

describe("summary rules", () => {
  it("rounds half away from zero, never banker's rounding", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(7n, 2n)).toBe(4n);
    expect(ratioText(1n, 3n, 1)).toBe("0.3");
    expect(ratioText(-1n, 2000n, 2)).toBe("0");
    expect(ratioText(125n, 100n, 1)).toBe("1.3");
  });

  it("classifies outcomes from net P&L, and unknown P&L is not a breakeven", () => {
    expect(outcomeOf({ realizedPnl: "0.000001" })).toBe("win");
    expect(outcomeOf({ realizedPnl: "-0.000001" })).toBe("loss");
    expect(outcomeOf({ realizedPnl: "0" })).toBe("breakeven");
    expect(outcomeOf({ realizedPnl: null })).toBe("unknown");
  });

  it("a gross win can be a net loss after fees", () => {
    const s = summarize([full({ id: "a", exitAt: "2026-10-19T14:00:00.000Z", grossPnl: "2", fees: "4.5", realizedPnl: "-2.5" })]);
    expect(s.losses).toBe(1);
    expect(s.gross).toEqual({ state: "value", value: "2" });
    expect(s.net).toEqual({ state: "value", value: "-2.5" });
  });

  it("an exit without a status of open is closed; open trades are left out entirely", () => {
    expect(isClosed({ exitAt: "2026-10-19T14:00:00.000Z", pnlStatus: "reported" })).toBe(true);
    expect(isClosed({ exitAt: null, pnlStatus: "open" })).toBe(false);
    expect(summarize([full({ id: "o", exitAt: null, pnlStatus: "open" })]).tradeIds).toEqual([]);
  });

  it("every id list partitions the closed trades exactly", () => {
    const c = (fixture.cases as unknown as Case[]).find(x => x.name.startsWith("long and short"))!;
    const s = summarize(c.trades.map(full));
    expect([...s.eligibleIds, ...s.unknownIds].sort()).toEqual([...s.tradeIds].sort());
    expect([...s.winIds, ...s.lossIds, ...s.breakevenIds].sort()).toEqual([...s.eligibleIds].sort());
    expect(s.tradeIds).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
