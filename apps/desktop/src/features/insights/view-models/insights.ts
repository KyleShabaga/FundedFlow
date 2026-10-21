// Insights screen state (Build 23). Everything a user chooses lives in the URL (/insights?accounts=…&section=…), so
// leaving for a trade and coming back restores the same selection, and nothing is kept in a second store. The
// figures come from @fundedflow/domain (selectTrades, summarize and the group helpers); this file only words them.
import {
  EMPTY_FILTER,
  NO_STRATEGY,
  type InsightsBasis,
  type InsightsFilter,
  type Metric,
  type MetricCode,
  type RatioValue,
} from "@fundedflow/domain";
import type { CalendarDisplay, MetricValue } from "../../../design-system";
import type { PeriodKind } from "@fundedflow/domain";

export const SECTIONS = ["overview", "calendar", "breakdowns", "tags", "attempts"] as const;
export type Section = (typeof SECTIONS)[number];
export const LIST_STATUSES = ["active", "paused", "passed", "failed", "closed"] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

export interface InsightsState {
  /** Explicit attempts; null means not chosen yet (the active account is used). */
  accounts: string[] | null;
  section: Section;
  basis: InsightsBasis;
  filter: Omit<InsightsFilter, "accountIds">;
  /** "YYYY-MM" shown in the calendar; null follows the latest traded month. */
  month: string | null;
  day: string | null;
  display: CalendarDisplay;
  period: Exclude<PeriodKind, "year">;
  /** Account picker list: which statuses to show, and whether archived attempts are offered. */
  statuses: ListStatus[];
  archived: boolean;
  /** Attempts grouped by reset chain (opt-in). */
  lineage: boolean;
}

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
const day = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
const text = (value: string | null) => (value && value.trim() ? value : null);

export function parseInsightsParams(p: URLSearchParams): InsightsState {
  const accounts = p.get("accounts");
  const statuses = p.get("status");
  return {
    accounts: accounts === null ? null : accounts.split(",").filter(Boolean),
    section: pick(p.get("section"), SECTIONS, "overview"),
    basis: pick(p.get("basis"), ["net", "gross"] as const, "net"),
    filter: {
      ...EMPTY_FILTER,
      from: day(p.get("from")),
      to: day(p.get("to")),
      symbol: text(p.get("symbol")),
      side: pick(p.get("side"), ["all", "long", "short"] as const, "all"),
      strategyId: text(p.get("strategy")),
      tagId: text(p.get("tag")),
      source: pick(p.get("source"), ["all", "manual", "csv_import"] as const, "all"),
      currency: text(p.get("currency")),
    },
    month: p.get("month")?.match(/^\d{4}-\d{2}$/) ? p.get("month") : null,
    day: day(p.get("day")),
    display: pick(p.get("show"), ["pnl", "trades", "winRate"] as const, "pnl"),
    period: pick(p.get("period"), ["day", "week", "month"] as const, "day"),
    statuses: statuses === null ? [...LIST_STATUSES] : statuses.split(",").filter((s): s is ListStatus => (LIST_STATUSES as readonly string[]).includes(s)),
    archived: p.get("archived") === "1",
    lineage: p.get("lineage") === "1",
  };
}

/** Writes only what differs from the defaults, so a plain /insights stays plain. */
export function toInsightsParams(s: InsightsState): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: string | null, fallback: string | null = null) => { if (v !== null && v !== fallback) p.set(k, v); };
  if (s.accounts !== null) p.set("accounts", s.accounts.join(","));
  set("section", s.section, "overview");
  set("basis", s.basis, "net");
  set("from", s.filter.from);
  set("to", s.filter.to);
  set("symbol", s.filter.symbol);
  set("side", s.filter.side, "all");
  set("strategy", s.filter.strategyId);
  set("tag", s.filter.tagId);
  set("source", s.filter.source, "all");
  set("currency", s.filter.currency);
  set("month", s.month);
  set("day", s.day);
  set("show", s.display, "pnl");
  set("period", s.period, "day");
  if (s.statuses.length !== LIST_STATUSES.length) p.set("status", s.statuses.join(","));
  if (s.archived) p.set("archived", "1");
  if (s.lineage) p.set("lineage", "1");
  return p;
}

export const isFiltered = (f: InsightsState["filter"]) =>
  f.from !== null || f.to !== null || f.symbol !== null || f.side !== "all" || f.strategyId !== null || f.tagId !== null || f.source !== "all";

/** Plain words for every reason a metric has no value. */
export const METRIC_REASON: Record<MetricCode, string> = {
  no_closed_trades: "No closed trades in this selection",
  pnl_unknown: "Every trade here has an unknown P&L",
  no_winners: "No winning trades",
  no_losers: "No losing trades, so it is undefined (not infinite)",
  no_planned_risk: "No trade here has a planned risk in its review",
  below_min_sample: "Too few trades for a stable figure",
  too_large: "The total is too large to show exactly",
};

export interface MetricView {
  value: MetricValue;
  /** Why there is no value, or null. */
  reason: string | null;
}

/** A money metric for MetricCard / StatList: the amount, "N/A", "Insufficient data" or "Unknown" with its reason. */
export function moneyView(m: Metric<string>, currency: string | null, signed = true): MetricView {
  switch (m.state) {
    case "value":
      return { value: { kind: "money", amount: m.value, currency, signed }, reason: null };
    case "na":
      return { value: { kind: "text", text: "N/A" }, reason: METRIC_REASON[m.code] };
    case "insufficient":
      return { value: { kind: "text", text: "Insufficient data" }, reason: `${METRIC_REASON[m.code]}: ${m.have} of ${m.need} needed` };
    case "unavailable":
      return { value: { kind: "text", text: "Unknown" }, reason: METRIC_REASON[m.code] };
  }
}

/** A plain decimal metric (profit factor, average R) with an optional suffix ("R"). */
export function numberView(m: Metric<string>, suffix = ""): MetricView {
  if (m.state === "value") return { value: { kind: "text", text: `${m.value}${suffix}` }, reason: null };
  return moneyView(m, null);
}

export function rateView(m: Metric<RatioValue>): MetricView {
  if (m.state === "value") return { value: { kind: "text", text: `${m.value.percent}%` }, reason: `${m.value.numerator} of ${m.value.denominator}` };
  return moneyView(m as Metric<string>, null);
}

/** "Mon, Oct 19, 2026" from a trading day (calendar arithmetic only, no local clock). */
export function dayLabel(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y!, m! - 1, dd!)));
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
export const weekLabel = (monday: string) => `Week of ${dayLabel(monday)}`;
export function periodLabel(kind: PeriodKind, key: string): string {
  return kind === "day" ? dayLabel(key) : kind === "week" ? weekLabel(key) : kind === "month" ? monthLabel(key) : key;
}

export const tradesText = (n: number) => (n === 1 ? "1 trade" : `${n} trades`);
export const STATUS_LABEL: Record<ListStatus, string> = { active: "Active", paused: "Paused", passed: "Passed", failed: "Failed", closed: "Closed" };
export { NO_STRATEGY };

/** What a drill-down opens: a title, how it was produced, and exactly these trade ids. */
export interface Drill {
  title: string;
  /** "Net P&L · Selected filters", shown under the title. */
  basis?: string;
  ids: readonly string[];
}
