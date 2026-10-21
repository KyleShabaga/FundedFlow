// Build 23 included-trade selector and report. `selectTrades` is the one canonical selection: the closed, active
// (never soft-deleted: Rust leaves those out) trades of exactly the requested attempts that pass the filter, unique by
// trade id, of one currency, in a fixed order. Every group below (periods, weekdays, strategies, tags, symbols,
// attempts) is `summarize` over a subset of that selection, so each figure drills down to exactly its trade ids and
// totals agree with their parts. Pure: the dataset and filter are the only inputs; no clock, no locale.

import { toMicros } from "../primitives/money.js";
import {
  INSIGHTS_SELECTOR_VERSION,
  NO_STRATEGY,
  type InsightsAccount,
  type InsightsBasis,
  type InsightsDataset,
  type InsightsFilter,
  type InsightsTrade,
} from "./contracts.js";
import { isClosed, ratioText, summarize, type Metric, type RatioValue, type Summary } from "./metrics.js";

/* ---------- Calendar arithmetic on YYYY-MM-DD (integers only) ---------- */

/** Days since 1970-01-01 for a proleptic Gregorian date. */
export function dayNumber(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function fromDayNumber(n: number): string {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  return ((((dayNumber(day) + 3) % 7) + 7) % 7) + 1;
}
/** The Monday of the trading day's week (trading days are Monday to Friday, so a week is Monday–Friday). */
export function weekOf(day: string): string {
  return fromDayNumber(dayNumber(day) - (isoWeekday(day) - 1));
}
export const monthOf = (day: string) => day.slice(0, 7);
export const yearOf = (day: string) => day.slice(0, 4);

/* ---------- Selection ---------- */

export interface Exclusions {
  /** Open trades of the selected attempts: never in an Insights set. */
  open: number;
  /** Closed trades the filter leaves out (date, symbol, side, strategy, tag, source). */
  filteredOut: number;
  /** Closed trades in another currency than the one aggregated. */
  otherCurrency: number;
  /** Soft-deleted trades of the selected attempts (Rust never returns them). */
  deleted: number;
}

export interface InsightsSelection {
  version: typeof INSIGHTS_SELECTOR_VERSION;
  /** When the journal was read. */
  dataAsOf: string;
  filter: InsightsFilter;
  /** The requested attempts found in the dataset, in request order. */
  accounts: InsightsAccount[];
  /** Requested ids the dataset does not hold (deleted since, or never existed). */
  missingAccountIds: string[];
  /** Closed trades of the selected attempts that pass the filter, every currency. */
  candidates: InsightsTrade[];
  /** Currencies of the candidates, sorted. */
  currencies: string[];
  /** The aggregated currency: the filter's, or the only one. Null when there is a conflict or nothing selected. */
  currency: string | null;
  /** Candidates span several currencies and none was chosen: money is not aggregated. */
  currencyConflict: boolean;
  /** The included-trade set: candidates of `currency`. Empty on a conflict. */
  trades: InsightsTrade[];
  excluded: Exclusions;
}

/** Report order: trading day, then exit instant, then trade id. Deterministic for equal timestamps. */
export function compareTrades(a: InsightsTrade, b: InsightsTrade): number {
  const key = (t: InsightsTrade) => [t.tradingDay, t.exitAt ?? t.entryAt, t.id] as const;
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
  return 0;
}

export const symbolKey = (t: Pick<InsightsTrade, "symbol" | "symbolRoot">) => t.symbolRoot ?? t.symbol;

function passes(t: InsightsTrade, f: InsightsFilter): boolean {
  if (f.from && t.tradingDay < f.from) return false;
  if (f.to && t.tradingDay > f.to) return false;
  if (f.symbol && symbolKey(t) !== f.symbol) return false;
  if (f.side !== "all" && t.side !== f.side) return false;
  if (f.source !== "all" && t.source !== f.source) return false;
  if (f.strategyId === NO_STRATEGY && t.review?.strategyId) return false;
  if (f.strategyId && f.strategyId !== NO_STRATEGY && t.review?.strategyId !== f.strategyId) return false;
  if (f.tagId && !t.review?.tags.some(tag => tag.tagId === f.tagId)) return false;
  return true;
}

export function selectTrades(dataset: InsightsDataset, filter: InsightsFilter): InsightsSelection {
  const byId = new Map(dataset.accounts.map(a => [a.id, a]));
  const requested = [...new Set(filter.accountIds)];
  const accounts = requested.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const scope = new Map(accounts.map(a => [a.id, a]));
  // Scope is enforced again here: a trade of an attempt that was not requested is never included, and a trade id is
  // counted once (the dataset has one row per trade; a repeated row would be a payload error, not a second trade).
  const unique = new Map<string, InsightsTrade>();
  for (const t of dataset.trades) if (scope.has(t.accountId) && !unique.has(t.id)) unique.set(t.id, t);
  const all = [...unique.values()];
  const closed = all.filter(isClosed);
  const candidates = closed.filter(t => passes(t, filter)).sort(compareTrades);
  const currencyOf = (t: InsightsTrade) => scope.get(t.accountId)!.currency;
  const currencies = [...new Set(candidates.map(currencyOf))].sort();
  const currency = filter.currency ?? (currencies.length === 1 ? currencies[0]! : null);
  const currencyConflict = filter.currency === null && currencies.length > 1;
  const trades = currency === null ? [] : candidates.filter(t => currencyOf(t) === currency);
  return {
    version: INSIGHTS_SELECTOR_VERSION,
    dataAsOf: dataset.generatedAt,
    filter,
    accounts,
    missingAccountIds: requested.filter(id => !byId.has(id)),
    candidates,
    currencies,
    currency,
    currencyConflict,
    trades,
    excluded: {
      open: all.length - closed.length,
      filteredOut: closed.length - candidates.length,
      otherCurrency: currencyConflict ? 0 : candidates.length - trades.length,
      deleted: accounts.reduce((n, a) => n + a.deletedTradeCount, 0),
    },
  };
}

/* ---------- Groups ---------- */

export interface Group {
  key: string;
  label: string;
  summary: Summary;
}

/** Groups trades by one or more keys each (a trade with two tags is in both groups), keys sorted unless `order`. */
export function groupBy(
  trades: readonly InsightsTrade[],
  keys: (t: InsightsTrade) => readonly { key: string; label: string }[],
  order?: (a: string, b: string) => number,
): Group[] {
  const map = new Map<string, { label: string; trades: InsightsTrade[] }>();
  for (const t of trades) {
    for (const { key, label } of keys(t)) {
      const g = map.get(key) ?? { label, trades: [] };
      g.trades.push(t);
      map.set(key, g);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => (order ? order(a, b) : a < b ? -1 : a > b ? 1 : 0))
    .map(([key, g]) => ({ key, label: g.label, summary: summarize(g.trades) }));
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

export type PeriodKind = "day" | "week" | "month" | "year";
const PERIOD: Record<PeriodKind, (day: string) => string> = { day: d => d, week: weekOf, month: monthOf, year: yearOf };
export const byPeriod = (trades: readonly InsightsTrade[], kind: PeriodKind) =>
  groupBy(trades, t => [{ key: PERIOD[kind](t.tradingDay), label: PERIOD[kind](t.tradingDay) }]);

export const byWeekday = (trades: readonly InsightsTrade[]) =>
  groupBy(trades, t => {
    const n = isoWeekday(t.tradingDay);
    return [{ key: String(n), label: WEEKDAYS[n - 1] ?? "Weekend" }];
  });

export const byStrategy = (trades: readonly InsightsTrade[]) =>
  groupBy(trades, t => [t.review?.strategyId ? { key: t.review.strategyId, label: t.review.strategyName ?? "Strategy" } : { key: NO_STRATEGY, label: "No strategy" }]);

export const byTag = (trades: readonly InsightsTrade[], kind: "setup" | "mistake" | "emotion" | "general") =>
  groupBy(trades, t => (t.review?.tags ?? []).filter(tag => tag.kind === kind).map(tag => ({ key: tag.tagId, label: tag.label })));

export const bySymbol = (trades: readonly InsightsTrade[]) => groupBy(trades, t => [{ key: symbolKey(t), label: symbolKey(t) }]);
export const bySide = (trades: readonly InsightsTrade[]) =>
  groupBy(trades, t => [{ key: t.side, label: t.side === "long" ? "Long" : "Short" }]);
export const bySource = (trades: readonly InsightsTrade[]) =>
  groupBy(trades, t => [{ key: t.source, label: t.source === "csv_import" ? "Imported" : "Manual" }]);

/* ---------- Period statistics (best/worst/average month, winning days, …) ---------- */

export const basisAmount = (s: Summary, basis: InsightsBasis): Metric<string> => (basis === "net" ? s.net : s.gross);

export interface PeriodStats {
  /** Periods with at least one closed trade. */
  periods: number;
  /** Periods with at least one known result: the basis of everything below. */
  known: number;
  /** Periods where some trade's P&L is unknown (their sums are partial). */
  incomplete: number;
  winning: Group[];
  losing: Group[];
  flat: Group[];
  best: Group | null;
  worst: Group | null;
  /** Sum of the known periods' amounts ÷ known periods, micro-unit rounding; null without a known period. */
  average: string | null;
  /** Trade ids behind `average` (all trades of the known periods). */
  averageIds: string[];
}

export function periodStats(groups: readonly Group[], basis: InsightsBasis): PeriodStats {
  const known = groups.flatMap(g => {
    const m = basisAmount(g.summary, basis);
    const micros = m.state === "value" ? toMicros(m.value) : null;
    return micros === null ? [] : [{ g, micros }];
  });
  let best: (typeof known)[number] | null = null;
  let worst: (typeof known)[number] | null = null;
  // Ties go to the earliest period (groups are in key order).
  for (const k of known) {
    if (!best || k.micros > best.micros) best = k;
    if (!worst || k.micros < worst.micros) worst = k;
  }
  const total = known.reduce((a, k) => a + k.micros, 0n);
  return {
    periods: groups.length,
    known: known.length,
    incomplete: groups.filter(g => !g.summary.complete).length,
    winning: known.filter(k => k.micros > 0n).map(k => k.g),
    losing: known.filter(k => k.micros < 0n).map(k => k.g),
    flat: known.filter(k => k.micros === 0n).map(k => k.g),
    best: best?.g ?? null,
    worst: worst?.g ?? null,
    average: known.length ? ratioText(total, BigInt(known.length) * 1_000_000n, 6) : null,
    averageIds: known.flatMap(k => k.g.summary.tradeIds),
  };
}

/** Average closed trades per period, one decimal (counts, not money). Null without periods. */
export function tradesPerPeriod(groups: readonly Group[]): string | null {
  if (groups.length === 0) return null;
  const trades = groups.reduce((n, g) => n + g.summary.closed, 0);
  return ratioText(BigInt(trades), BigInt(groups.length), 1);
}

/* ---------- Closed-trade P&L curve ---------- */

export interface CurvePoint {
  tradeId: string;
  tradingDay: string;
  exitAt: string;
  /** This trade's amount in the basis. */
  amount: string;
  /** Running total from 0 at the start of the selection: closed-trade P&L, not an account balance. */
  cumulative: string;
}

/** Known closed trades in exit order (then id), running total from a 0 baseline. Unknown P&L is left out. */
export function closedTradeCurve(trades: readonly InsightsTrade[], basis: InsightsBasis): CurvePoint[] {
  const known = trades
    .filter(t => isClosed(t) && (basis === "net" ? t.realizedPnl : t.grossPnl) !== null)
    .sort((a, b) => (a.exitAt! === b.exitAt! ? (a.id < b.id ? -1 : 1) : a.exitAt! < b.exitAt! ? -1 : 1));
  let running = 0n;
  const out: CurvePoint[] = [];
  for (const t of known) {
    const amount = basis === "net" ? t.realizedPnl! : t.grossPnl!;
    const m = toMicros(amount);
    if (m === null) continue;
    running += m;
    out.push({ tradeId: t.id, tradingDay: t.tradingDay, exitAt: t.exitAt!, amount, cumulative: ratioText(running, 1_000_000n, 6) });
  }
  return out;
}

/* ---------- Attempts (historical and reset comparisons) ---------- */

export interface AttemptRow {
  account: InsightsAccount;
  /** The attempt's own currency: rows are compared side by side, never added across currencies. */
  currency: string;
  summary: Summary;
  /** Distinct trading days with a closed trade in the selection. */
  activeDays: number;
  firstDay: string | null;
  lastDay: string | null;
  /** The user's stated cause when the current status is failed; null is not stated. Never inferred. */
  reportedCause: string | null;
}

/** One row per selected attempt over its filtered closed trades (all currencies: each row is its own currency). */
export function compareAttempts(selection: InsightsSelection): AttemptRow[] {
  return selection.accounts.map(account => {
    const trades = selection.candidates.filter(t => t.accountId === account.id);
    const days = [...new Set(trades.map(t => t.tradingDay))].sort();
    return {
      account,
      currency: account.currency,
      summary: summarize(trades),
      activeDays: days.length,
      firstDay: days[0] ?? null,
      lastDay: days[days.length - 1] ?? null,
      reportedCause: account.status === "failed" && account.statusEvent?.status === "failed" ? account.statusEvent.cause : null,
    };
  });
}

export interface LineageGroup {
  rootId: string;
  /** Attempts of the chain that are in the selection, first attempt first. Always disclosed. */
  attempts: AttemptRow[];
  currencies: string[];
  /** Over all included attempts' trades; null when they hold several currencies. */
  summary: Summary | null;
}

/** Optional lineage grouping: attempts of one reset chain together, each still listed. */
export function groupLineages(rows: readonly AttemptRow[], selection: InsightsSelection): LineageGroup[] {
  const map = new Map<string, AttemptRow[]>();
  for (const r of rows) map.set(r.account.lineageRootId, [...(map.get(r.account.lineageRootId) ?? []), r]);
  return [...map.entries()].map(([rootId, attempts]) => {
    const sorted = [...attempts].sort((a, b) => a.account.attemptNumber - b.account.attemptNumber);
    const currencies = [...new Set(sorted.map(r => r.currency))].sort();
    const ids = new Set(sorted.map(r => r.account.id));
    return {
      rootId,
      attempts: sorted,
      currencies,
      summary: currencies.length === 1 ? summarize(selection.candidates.filter(t => ids.has(t.accountId))) : null,
    };
  });
}

export interface AttemptCohort {
  passed: string[];
  failed: string[];
  /** Active, paused or closed attempts: no pass/fail outcome, left out of the rate. */
  unresolved: string[];
  /** Passed ÷ (passed + failed); N/A without a resolved attempt. User-entered statuses. */
  passRate: Metric<RatioValue>;
}

export function attemptCohort(accounts: readonly InsightsAccount[]): AttemptCohort {
  const passed = accounts.filter(a => a.status === "passed").map(a => a.id);
  const failed = accounts.filter(a => a.status === "failed").map(a => a.id);
  const unresolved = accounts.filter(a => a.status !== "passed" && a.status !== "failed").map(a => a.id);
  const d = passed.length + failed.length;
  return {
    passed,
    failed,
    unresolved,
    passRate: d === 0
      ? { state: "na", code: "no_closed_trades" }
      : { state: "value", value: { numerator: passed.length, denominator: d, percent: ratioText(BigInt(passed.length) * 100n, BigInt(d), 1) } },
  };
}

export interface ReportedReason {
  /** The cause as the user first wrote it; null groups failed attempts with no stated cause. */
  reason: string | null;
  accountIds: string[];
}

/** Failed attempts grouped by the cause the user entered (trimmed, case-insensitive). Most frequent first. */
export function reportedFailureReasons(rows: readonly AttemptRow[]): ReportedReason[] {
  const map = new Map<string, ReportedReason>();
  for (const r of rows.filter(r => r.account.status === "failed")) {
    const text = r.reportedCause?.trim() || null;
    const key = text?.toLowerCase() ?? "";
    const entry = map.get(key) ?? { reason: text, accountIds: [] };
    entry.accountIds.push(r.account.id);
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.accountIds.length - a.accountIds.length || (a.reason ?? "~").localeCompare(b.reason ?? "~"));
}
