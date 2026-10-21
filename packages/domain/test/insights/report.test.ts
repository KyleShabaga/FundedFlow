// Golden selection/report tests over a synthetic journal: one active attempt, two historical attempts of the same
// reset chain (one failed with a stated cause, one passed and archived) that reuse the broker account number, and an
// unrelated EUR account. Trading days are given as Rust stores them (zone, reset, weekend roll already applied).
import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTER,
  NO_STRATEGY,
  attemptCohort,
  byPeriod,
  bySide,
  byStrategy,
  bySymbol,
  byTag,
  byWeekday,
  closedTradeCurve,
  compareAttempts,
  dayNumber,
  fromDayNumber,
  groupLineages,
  insightsDatasetSchema,
  isoWeekday,
  periodStats,
  reportedFailureReasons,
  selectTrades,
  summarize,
  toMicros,
  tradesPerPeriod,
  weekOf,
  type Group,
  type InsightsAccount,
  type InsightsDataset,
  type InsightsFilter,
  type InsightsTrade,
} from "../../src/index.js";

const T = "2026-01-05T00:00:00.000Z";
function account(over: Partial<InsightsAccount> & Pick<InsightsAccount, "id">): InsightsAccount {
  return {
    name: over.id, broker: "Tradovate", propFirm: "Topstep", externalRef: "TOP-1", accountType: "evaluation", status: "active", archivedAt: null,
    currency: "USD", timezone: "America/New_York", tradingDayResetTime: "17:00", createdAt: T, lineageRootId: over.id, attemptNumber: 1,
    predecessorAccountId: null, successorAccountId: null, statusEvent: null, deletedTradeCount: 0, committedImportCount: 0, failedImportCount: 0,
    lastImportAt: null, ...over,
  };
}
let seq = 0;
function trade(accountId: string, tradingDay: string, net: string | null, over: Partial<InsightsTrade> = {}): InsightsTrade {
  seq += 1;
  const fees = over.fees ?? "2";
  const gross = net === null ? null : String(Number(net) + Number(fees)); // test data only: whole/half amounts
  return {
    id: over.id ?? `t${String(seq).padStart(3, "0")}`, accountId, source: "csv_import", importBatchId: "b1", symbol: "MNQZ6", symbolRoot: "MNQ", side: "long",
    quantity: "1", entryAt: `${tradingDay}T14:00:00.000Z`, exitAt: `${tradingDay}T14:30:00.000Z`, tradingDay, fees, grossPnl: gross, realizedPnl: net,
    reportedPnl: null, pnlStatus: net === null ? "missing_instrument" : "calculated", updatedAt: T, review: null, ...over,
  };
}

const ATTEMPT1 = "eval-1";
const ATTEMPT2 = "eval-2";
const ACTIVE = "eval-3";
const EUR = "eur-1";
const setup = { reviewed: true, strategyId: "s-orb", strategyName: "Opening range", tags: [{ tagId: "g-orb", label: "ORB", kind: "setup" as const, currentLabel: null, archived: false }], plannedRisk: "100", plannedRiskSource: "entered" as const, rMultiple: "1.5" };
const mistake = { reviewed: true, strategyId: null, strategyName: null, tags: [{ tagId: "m-fomo", label: "FOMO", kind: "mistake" as const, currentLabel: null, archived: false }], plannedRisk: null, plannedRiskSource: null, rMultiple: null };

const dataset: InsightsDataset = insightsDatasetSchema.parse({
  contractVersion: 1,
  generatedAt: "2026-10-20T15:00:00.000Z",
  accounts: [
    account({ id: ATTEMPT1, name: "50K eval #1", status: "failed", successorAccountId: ATTEMPT2, deletedTradeCount: 1,
      statusEvent: { status: "failed", effectiveAt: "2026-09-30T21:00:00.000Z", cause: "Daily loss limit ", note: null } }),
    account({ id: ATTEMPT2, name: "50K eval #2", status: "passed", archivedAt: "2026-10-10T00:00:00.000Z", lineageRootId: ATTEMPT1, attemptNumber: 2,
      predecessorAccountId: ATTEMPT1, successorAccountId: ACTIVE, statusEvent: { status: "passed", effectiveAt: "2026-10-09T21:00:00.000Z", cause: null, note: null } }),
    account({ id: ACTIVE, name: "50K eval #3", lineageRootId: ATTEMPT1, attemptNumber: 3, predecessorAccountId: ATTEMPT2 }),
    account({ id: EUR, name: "EUR personal", externalRef: "EU-9", currency: "EUR", timezone: "Europe/Berlin", tradingDayResetTime: "00:00", accountType: "personal" }),
  ],
  trades: [
    // Attempt 1 (failed): September, the same CSV rows as attempt 2 imported into a different attempt.
    trade(ATTEMPT1, "2026-09-28", "100", { id: "a1-1", review: setup }),
    trade(ATTEMPT1, "2026-09-28", "-300", { id: "a1-2", side: "short", review: mistake }),
    trade(ATTEMPT1, "2026-09-29", "0", { id: "a1-3" }),
    trade(ATTEMPT1, "2026-09-30", "-450", { id: "a1-4", review: mistake }),
    // Attempt 2 (passed, archived): October, same broker account number TOP-1.
    trade(ATTEMPT2, "2026-10-05", "100", { id: "a2-1", review: setup }),
    trade(ATTEMPT2, "2026-10-06", "250", { id: "a2-2", review: setup }),
    trade(ATTEMPT2, "2026-10-09", "-50", { id: "a2-3", symbol: "ESZ6", symbolRoot: "ES", side: "short" }),
    // Active attempt: a Friday-after-reset trade stored on Monday, an unknown P&L, an open trade.
    trade(ACTIVE, "2026-10-19", "75.5", { id: "a3-1", exitAt: "2026-10-16T21:30:00.000Z" }),
    trade(ACTIVE, "2026-10-19", null, { id: "a3-2", symbol: "XYZ", symbolRoot: null }),
    trade(ACTIVE, "2026-10-20", null, { id: "a3-3", exitAt: null, pnlStatus: "open", source: "manual", importBatchId: null }),
    trade(ACTIVE, "2026-10-20", "-20.25", { id: "a3-4", source: "manual", importBatchId: null }),
    // EUR account on the same days: never added to USD.
    trade(EUR, "2026-10-19", "40", { id: "e-1" }),
    trade(EUR, "2026-10-20", "-10", { id: "e-2" }),
  ],
});

const filter = (over: Partial<InsightsFilter> = {}): InsightsFilter => ({ ...EMPTY_FILTER, accountIds: [ATTEMPT1, ATTEMPT2, ACTIVE], ...over });
const ids = (g: readonly Group[]) => Object.fromEntries(g.map(x => [x.key, x.summary.tradeIds]));
const netOf = (g: Group) => (g.summary.net.state === "value" ? g.summary.net.value : null);
const total = (groups: readonly Group[]) => groups.reduce((a, g) => a + (toMicros(netOf(g) ?? "0") ?? 0n), 0n);

describe("calendar arithmetic", () => {
  it("round-trips day numbers and finds weekdays and Monday weeks across years", () => {
    for (const d of ["1970-01-01", "2000-02-29", "2026-11-01", "2026-12-31", "2027-01-01", "2100-03-01"]) expect(fromDayNumber(dayNumber(d))).toBe(d);
    expect(isoWeekday("2026-10-19")).toBe(1);
    expect(isoWeekday("2026-10-23")).toBe(5);
    expect(isoWeekday("2026-10-25")).toBe(7);
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
    expect(weekOf("2026-10-23")).toBe("2026-10-19");
  });
});

describe("selectTrades", () => {
  it("includes exactly the requested attempts' closed trades, in report order, with every exclusion counted", () => {
    const s = selectTrades(dataset, filter());
    expect(s.currency).toBe("USD");
    expect(s.trades.map(t => t.id)).toEqual(["a1-1", "a1-2", "a1-3", "a1-4", "a2-1", "a2-2", "a2-3", "a3-1", "a3-2", "a3-4"]);
    expect(s.excluded).toEqual({ open: 1, filteredOut: 0, otherCurrency: 0, deleted: 1 });
    expect(s.dataAsOf).toBe("2026-10-20T15:00:00.000Z");
  });

  it("never merges attempts that reuse a broker account number", () => {
    const one = selectTrades(dataset, filter({ accountIds: [ATTEMPT2] }));
    expect(one.trades.map(t => t.id)).toEqual(["a2-1", "a2-2", "a2-3"]);
    expect(one.trades.every(t => t.accountId === ATTEMPT2)).toBe(true);
  });

  it("refuses to add currencies: a mixed selection must choose one", () => {
    const mixed = selectTrades(dataset, filter({ accountIds: [ACTIVE, EUR] }));
    expect(mixed.currencyConflict).toBe(true);
    expect(mixed.currencies).toEqual(["EUR", "USD"]);
    expect(mixed.trades).toEqual([]);
    const eur = selectTrades(dataset, filter({ accountIds: [ACTIVE, EUR], currency: "EUR" }));
    expect(eur.trades.map(t => t.id)).toEqual(["e-1", "e-2"]);
    expect(eur.excluded.otherCurrency).toBe(3);
  });

  it("filters by trading day, symbol root, side, source, strategy (and none) and tag", () => {
    const pick = (over: Partial<InsightsFilter>) => selectTrades(dataset, filter(over)).trades.map(t => t.id);
    expect(pick({ from: "2026-10-01", to: "2026-10-09" })).toEqual(["a2-1", "a2-2", "a2-3"]);
    expect(pick({ symbol: "ES" })).toEqual(["a2-3"]);
    expect(pick({ symbol: "XYZ" })).toEqual(["a3-2"]);
    expect(pick({ side: "short" })).toEqual(["a1-2", "a2-3"]);
    expect(pick({ source: "manual" })).toEqual(["a3-4"]);
    expect(pick({ strategyId: "s-orb" })).toEqual(["a1-1", "a2-1", "a2-2"]);
    expect(pick({ strategyId: NO_STRATEGY })).toHaveLength(7);
    expect(pick({ tagId: "m-fomo" })).toEqual(["a1-2", "a1-4"]);
    const none = selectTrades(dataset, filter({ from: "2027-01-01" }));
    expect(none.trades).toEqual([]);
    expect(none.excluded.filteredOut).toBe(10);
    expect(summarize(none.trades).net).toEqual({ state: "na", code: "no_closed_trades" });
  });

  it("names requested attempts that no longer exist and ignores trades of unrequested ones", () => {
    const s = selectTrades(dataset, filter({ accountIds: ["gone", ACTIVE] }));
    expect(s.missingAccountIds).toEqual(["gone"]);
    expect(s.accounts.map(a => a.id)).toEqual([ACTIVE]);
    expect(s.trades.every(t => t.accountId === ACTIVE)).toBe(true);
  });

  it("counts a repeated trade row once", () => {
    const dup = { ...dataset, trades: [...dataset.trades, dataset.trades[0]!] };
    expect(selectTrades(dup, filter()).trades.filter(t => t.id === "a1-1")).toHaveLength(1);
  });
});

describe("groups agree with the total and drill down to exact ids", () => {
  const s = selectTrades(dataset, filter());
  const whole = summarize(s.trades);

  it("headline", () => {
    expect(whole.net).toEqual({ state: "value", value: "-294.75" });
    expect(whole.unknownIds).toEqual(["a3-2"]);
    expect(whole.winRate).toEqual({ state: "value", value: { numerator: 4, denominator: 9, percent: "44.4" } });
    expect(whole.averageR).toEqual({ state: "insufficient", code: "below_min_sample", have: 3, need: 5 });
  });

  it.each(["day", "week", "month", "year"] as const)("%s buckets partition the selection", kind => {
    const groups = byPeriod(s.trades, kind);
    expect(groups.flatMap(g => g.summary.tradeIds).sort()).toEqual([...whole.tradeIds].sort());
    expect(total(groups)).toBe(toMicros(whole.net.state === "value" ? whole.net.value : "x"));
  });

  it("day, week and month keys use the stored trading day", () => {
    expect(ids(byPeriod(s.trades, "day"))["2026-10-19"]).toEqual(["a3-1", "a3-2"]);
    expect(Object.keys(ids(byPeriod(s.trades, "week")))).toEqual(["2026-09-28", "2026-10-05", "2026-10-19"]);
    expect(Object.keys(ids(byPeriod(s.trades, "month")))).toEqual(["2026-09", "2026-10"]);
  });

  it("a day with an unknown P&L is incomplete, so the calendar shows a dash for it", () => {
    const day = byPeriod(s.trades, "day").find(g => g.key === "2026-10-19")!;
    expect(day.summary.complete).toBe(false);
    expect(day.summary.net).toEqual({ state: "value", value: "75.5" });
  });

  it("weekday, side and symbol groups partition; strategies include 'No strategy'", () => {
    for (const groups of [byWeekday(s.trades), bySide(s.trades), bySymbol(s.trades), byStrategy(s.trades)]) {
      expect(groups.flatMap(g => g.summary.tradeIds).sort()).toEqual([...whole.tradeIds].sort());
    }
    expect(ids(byWeekday(s.trades))["1"]).toEqual(["a1-1", "a1-2", "a2-1", "a3-1", "a3-2"]);
    expect(byStrategy(s.trades).map(g => g.label)).toEqual(["No strategy", "Opening range"]);
  });

  it("tag groups list only tagged trades (a trade may be in several)", () => {
    expect(ids(byTag(s.trades, "setup"))).toEqual({ "g-orb": ["a1-1", "a2-1", "a2-2"] });
    expect(ids(byTag(s.trades, "mistake"))).toEqual({ "m-fomo": ["a1-2", "a1-4"] });
    expect(byTag(s.trades, "emotion")).toEqual([]);
  });

  it("best, worst and average month with their trades", () => {
    const stats = periodStats(byPeriod(s.trades, "month"), "net");
    expect(stats.best?.key).toBe("2026-10");
    expect(stats.worst?.key).toBe("2026-09");
    expect(stats.average).toBe("-147.375");
    expect(stats.averageIds).toHaveLength(10);
    expect(stats.incomplete).toBe(1);
    expect(tradesPerPeriod(byPeriod(s.trades, "day"))).toBe("1.3"); // 10 trades over 8 days = 1.25, half away from zero
  });

  it("the closed-trade curve starts from zero and leaves unknown P&L out", () => {
    const curve = closedTradeCurve(s.trades, "net");
    expect(curve.map(p => p.tradeId)).toEqual(["a1-1", "a1-2", "a1-3", "a1-4", "a2-1", "a2-2", "a2-3", "a3-1", "a3-4"]);
    expect(curve.at(-1)?.cumulative).toBe("-294.75");
    expect(curve[0]?.cumulative).toBe("100");
    expect(closedTradeCurve(s.trades, "gross").at(-1)?.cumulative).toBe("-276.75");
  });
});

describe("attempt comparison", () => {
  const s = selectTrades(dataset, filter({ accountIds: [ATTEMPT1, ATTEMPT2, ACTIVE, EUR] , currency: "USD" }));
  const rows = compareAttempts(s);

  it("keeps each attempt's own trades, currency and stated cause", () => {
    expect(rows.map(r => [r.account.id, r.summary.tradeIds.length, r.currency, r.activeDays])).toEqual([
      [ATTEMPT1, 4, "USD", 3], [ATTEMPT2, 3, "USD", 3], [ACTIVE, 3, "USD", 2], [EUR, 2, "EUR", 2],
    ]);
    expect(rows[0]!.summary.net).toEqual({ state: "value", value: "-650" });
    expect(rows[0]!.reportedCause).toBe("Daily loss limit ");
    expect(rows[1]!.reportedCause).toBeNull();
    expect(rows[0]!.firstDay).toBe("2026-09-28");
  });

  it("groups a reset chain only on request, disclosing every attempt, and refuses mixed currencies", () => {
    const lineages = groupLineages(rows, s);
    const chain = lineages.find(l => l.rootId === ATTEMPT1)!;
    expect(chain.attempts.map(a => a.account.attemptNumber)).toEqual([1, 2, 3]);
    expect(chain.summary?.net).toEqual({ state: "value", value: "-294.75" });
    const odd = groupLineages([{ ...rows[3]!, account: { ...rows[3]!.account, lineageRootId: ATTEMPT1 } }, rows[0]!], s);
    expect(odd[0]!.summary).toBeNull();
  });

  it("pass rate uses resolved attempts only; reasons are the user's words, grouped", () => {
    const cohort = attemptCohort(s.accounts);
    expect(cohort).toMatchObject({ passed: [ATTEMPT2], failed: [ATTEMPT1], unresolved: [ACTIVE, EUR] });
    expect(cohort.passRate).toEqual({ state: "value", value: { numerator: 1, denominator: 2, percent: "50" } });
    expect(attemptCohort([]).passRate.state).toBe("na");
    const extra = { ...rows[0]!, account: { ...rows[0]!.account, id: "x" }, reportedCause: "daily loss limit" };
    const none = { ...rows[0]!, account: { ...rows[0]!.account, id: "y" }, reportedCause: null };
    expect(reportedFailureReasons([rows[0]!, extra, none, rows[1]!])).toEqual([
      { reason: "Daily loss limit", accountIds: [ATTEMPT1, "x"] },
      { reason: null, accountIds: ["y"] },
    ]);
  });
});
