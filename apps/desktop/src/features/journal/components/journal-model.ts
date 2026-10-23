// Journal screen model (Build 20): joins trades with their review summaries, filters, sorts, pages and groups them by
// the stored trading day, and adds up display statistics. Every sum goes through format.ts (bigint micro-units);
// unknown P&L is left out of sums and counted, never treated as zero. Stored P&L and trading days come from Rust.
import { durationSecondsValue, microsToDecimal, toMicros, type ReviewSummary } from "@fundedflow/domain";
import { compareMoney, moneySign, moneyToNumberForDisplay, sumMoney } from "../../../design-system";
import type { TradeViewModel } from "../../trades/view-models/trade";

export interface JournalRow {
  trade: TradeViewModel;
  review: ReviewSummary | null;
}

export type ResultFilter = "all" | "win" | "loss" | "breakeven" | "open" | "unknown";
export interface JournalFilters {
  search: string;
  result: ResultFilter;
  side: "all" | "long" | "short";
  source: "all" | "manual" | "csv_import";
  reviewed: "all" | "reviewed" | "not-reviewed";
  strategyId: string | null;
  tagId: string | null;
  /** Trading days, inclusive. */
  from: string | null;
  to: string | null;
}
export const NO_FILTERS: JournalFilters = { search: "", result: "all", side: "all", source: "all", reviewed: "all", strategyId: null, tagId: null, from: null, to: null };

export function joinRows(trades: readonly TradeViewModel[], summaries: readonly ReviewSummary[]): JournalRow[] {
  const byTrade = new Map(summaries.map(s => [s.tradeId, s]));
  return trades.map(trade => ({ trade, review: byTrade.get(trade.id) ?? null }));
}

export function resultOf(trade: TradeViewModel): Exclude<ResultFilter, "all"> {
  if (trade.pnlStatus === "open") return "open";
  if (trade.realizedPnl == null) return "unknown";
  const sign = moneySign(trade.realizedPnl);
  return sign === "profit" ? "win" : sign === "loss" ? "loss" : "breakeven";
}

export function filterRows(rows: readonly JournalRow[], f: JournalFilters): JournalRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter(({ trade, review }) => {
    if (f.result !== "all" && resultOf(trade) !== f.result) return false;
    if (f.side !== "all" && trade.side !== f.side) return false;
    if (f.source !== "all" && trade.source !== f.source) return false;
    if (f.reviewed === "reviewed" && !review?.reviewed) return false;
    if (f.reviewed === "not-reviewed" && review?.reviewed) return false;
    if (f.strategyId && review?.strategyId !== f.strategyId) return false;
    if (f.tagId && !review?.tags.some(t => t.tagId === f.tagId)) return false;
    if (f.from && trade.tradingDay < f.from) return false;
    if (f.to && trade.tradingDay > f.to) return false;
    if (q) {
      const text = [trade.symbol, trade.notes ?? "", review?.notes ?? "", review?.strategyName ?? "", ...(review?.tags.map(t => t.label) ?? [])].join("\n").toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });
}

export function isFiltered(f: JournalFilters): boolean {
  return JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
}

export type SortColumn = "entryAt" | "exitAt" | "symbol" | "netPnl" | "quantity" | "tradingDay";
export function sortRows(rows: readonly JournalRow[], column: SortColumn, direction: "ascending" | "descending"): JournalRow[] {
  const dir = direction === "ascending" ? 1 : -1;
  const text = (a: string | null, b: string | null) => (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
  const compare = (a: JournalRow, b: JournalRow): number => {
    switch (column) {
      case "netPnl": return compareMoney(a.trade.realizedPnl, b.trade.realizedPnl, direction);
      // Quantities are exact decimal text; compare them as money-shaped decimals.
      case "quantity": return compareMoney(a.trade.quantity, b.trade.quantity, direction);
      case "symbol": return dir * a.trade.symbol.localeCompare(b.trade.symbol);
      case "exitAt": return a.trade.exitAt == null || b.trade.exitAt == null ? (a.trade.exitAt == null ? 1 : 0) - (b.trade.exitAt == null ? 1 : 0) : dir * text(a.trade.exitAt, b.trade.exitAt);
      case "tradingDay": return dir * text(a.trade.tradingDay, b.trade.tradingDay);
      default: return dir * text(a.trade.entryAt, b.trade.entryAt);
    }
  };
  // Ties keep entry order and then id, so equal timestamps sort the same way every time.
  return [...rows].sort((a, b) => compare(a, b) || text(a.trade.entryAt, b.trade.entryAt) || text(a.trade.id, b.trade.id));
}

export function page<T>(rows: readonly T[], pageNumber: number, size: number): T[] {
  return rows.slice((pageNumber - 1) * size, pageNumber * size);
}

export interface DayGroup {
  day: string;
  rows: JournalRow[];
}
/** Groups by the stored trading day (never the local date), newest day first; trades in entry order within a day. */
export function groupByDay(rows: readonly JournalRow[]): DayGroup[] {
  const map = new Map<string, JournalRow[]>();
  for (const row of rows) map.set(row.trade.tradingDay, [...(map.get(row.trade.tradingDay) ?? []), row]);
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, list]) => ({ day, rows: sortRows(list, "entryAt", "ascending") }));
}

export interface Stats {
  trades: number;
  /** Closed trades with a known net P&L: the basis of every money figure and ratio below. */
  known: number;
  open: number;
  /** Closed trades whose P&L is unknown (no instrument, currency mismatch), left out of the sums. */
  unknown: number;
  winners: number;
  losers: number;
  breakeven: number;
  net: string | null;
  gross: string | null;
  fees: string | null;
  /**
   * TASK-042 (R-NET): closed trades with a known P&L whose fees were not recorded. The sums above keep their stored
   * values (gross − 0), so these trades are counted before fees; views say so beside the totals.
   */
  feesNotRecorded: number;
  /** Some trade here has fees not recorded, so `fees` is a lower bound, not the total (null when none is recorded). */
  feesIncomplete: boolean;
  contracts: string | null;
  /** Winners ÷ known, as a percentage; null with no known trades. Display only. */
  winRate: number | null;
  /** Sum of wins ÷ |sum of losses|; null without losses. Display only. */
  profitFactor: number | null;
  averageWin: string | null;
  averageLoss: string | null;
}

function divide(total: string | null, n: number): string | null {
  const micros = total == null || n === 0 ? null : toMicros(total);
  if (micros == null) return null;
  // Exact to the micro-unit, rounding half away from zero (bigint, never number).
  const abs = micros < 0n ? -micros : micros;
  const q = (abs * 2n + BigInt(n)) / (2n * BigInt(n));
  return microsToDecimal(micros < 0n ? -q : q);
}

export function stats(rows: readonly JournalRow[]): Stats {
  const trades = rows.map(r => r.trade);
  const known = trades.filter(t => t.pnlStatus !== "open" && t.realizedPnl != null);
  const results = known.map(resultOf);
  const wins = known.filter((_, i) => results[i] === "win");
  const losses = known.filter((_, i) => results[i] === "loss");
  const winSum = sumMoney(wins.map(t => t.realizedPnl));
  const lossSum = sumMoney(losses.map(t => t.realizedPnl));
  const winN = moneyToNumberForDisplay(winSum);
  const lossN = moneyToNumberForDisplay(lossSum);
  return {
    trades: trades.length,
    known: known.length,
    open: trades.filter(t => t.pnlStatus === "open").length,
    unknown: trades.filter(t => t.pnlStatus !== "open" && t.realizedPnl == null).length,
    winners: wins.length,
    losers: losses.length,
    breakeven: results.filter(r => r === "breakeven").length,
    net: known.length ? sumMoney(known.map(t => t.realizedPnl)) : null,
    gross: known.length ? sumMoney(known.map(t => t.grossPnl)) : null,
    // Unknown, not $0.00, when no trade here has recorded fees (TASK-042).
    fees: trades.some(t => t.feesRecorded) ? sumMoney(trades.map(t => t.fees)) : null,
    feesNotRecorded: known.filter(t => !t.feesRecorded).length,
    feesIncomplete: trades.some(t => !t.feesRecorded),
    contracts: trades.length ? sumMoney(trades.map(t => t.quantity)) : null,
    winRate: known.length ? (wins.length / known.length) * 100 : null,
    profitFactor: losses.length && winN != null && lossN != null && lossN !== 0 ? winN / Math.abs(lossN) : null,
    averageWin: divide(winSum, wins.length),
    averageLoss: divide(lossSum, losses.length),
  };
}

/** Cumulative net P&L after each closed trade with known P&L, in entry order (for EquityCurve). */
export function cumulative(rows: readonly JournalRow[]): string[] {
  const out: string[] = [];
  let running: string | null = "0";
  for (const { trade } of sortRows(rows, "entryAt", "ascending")) {
    if (trade.pnlStatus === "open" || trade.realizedPnl == null) continue;
    running = sumMoney([running, trade.realizedPnl]);
    if (running != null) out.push(running);
  }
  return out;
}

/** "45s", "1m 17s", "2h 05m": the time between entry and exit, or the export's duration for paired fills. */
export function holdTime(trade: TradeViewModel): string | null {
  // An export's duration can exceed 2^53 - 1 seconds, so it arrives as a decimal string there (P0-04); count exactly.
  const exported = trade.roundTrip?.durationSeconds;
  const measured = trade.exitAt ? Math.round((Date.parse(trade.exitAt) - Date.parse(trade.entryAt)) / 1000) : null;
  const seconds = exported != null ? durationSecondsValue(exported) : measured != null && Number.isFinite(measured) ? BigInt(measured) : null;
  if (seconds == null || seconds < 0n) return null;
  if (seconds < 60n) return `${seconds}s`;
  const m = seconds / 60n;
  if (m < 60n) return `${m}m ${String(seconds % 60n).padStart(2, "0")}s`;
  const h = m / 60n;
  return h < 24n ? `${h}h ${String(m % 60n).padStart(2, "0")}m` : `${h / 24n}d ${h % 24n}h`;
}
