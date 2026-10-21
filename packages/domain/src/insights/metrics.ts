// Build 23 metric engine: one summary over one set of closed trades of one currency. Every Insights figure (headline
// tiles, calendar cells, breakdown rows, attempt comparisons) is this summary over a subset, so a figure and its
// drill-down always come from the same trade ids. Money is bigint micro-units of Rust-stored values; nothing passes
// through `number`. Rust mirrors this function in src-tauri/src/insights.rs and generates the expected outputs of
// test/fixtures/insights-metrics.json, which both sides run (docs/architecture/packages.md#parity-fixtures).
//
// Definitions (docs/architecture/build-23-insights.md):
// - Eligible: a closed trade with a known net P&L. Unknown P&L is counted and left out, never treated as zero.
// - Outcome from net P&L: win > 0, loss < 0, breakeven = 0.
// - Win rate = wins ÷ eligible (breakevens in the denominator), as the Build 20 Journal defines it. One decimal.
// - Expectancy = sum ÷ eligible (net, or gross for the gross basis); averages are sum ÷ count. Micro-unit rounding.
// - Profit factor = sum of wins ÷ |sum of losses|, two decimals; undefined (N/A) without a loss, never infinity.
// - Average R = mean of the reviews' stored R multiples (each two decimals), two decimals; only trades whose review
//   has a planned risk count, and coverage is reported.
// - Rounding is always half away from zero.

import { isMicros, microsToDecimal, toMicros } from "../primitives/money.js";
import { INSIGHTS_MIN_SAMPLE, type InsightsTrade } from "./contracts.js";

/** Why a metric has no value. Stable codes: the UI words them, tests and parity fixtures compare them. */
export type MetricCode =
  | "no_closed_trades"
  | "pnl_unknown"
  | "no_winners"
  | "no_losers"
  | "no_planned_risk"
  | "below_min_sample"
  | "too_large";

export type Metric<T> =
  | { state: "value"; value: T }
  | { state: "na"; code: MetricCode }
  | { state: "insufficient"; code: "below_min_sample"; have: number; need: number }
  | { state: "unavailable"; code: MetricCode };

export const metricValue = <T>(m: Metric<T>): T | null => (m.state === "value" ? m.value : null);

export interface RatioValue {
  numerator: number;
  denominator: number;
  /** Percent, one decimal, half away from zero ("62.5"). */
  percent: string;
}

export type Outcome = "win" | "loss" | "breakeven" | "unknown";

/** A closed trade: it has an exit and is not open. Open trades are never part of an Insights set. */
export function isClosed(t: Pick<InsightsTrade, "exitAt" | "pnlStatus">): boolean {
  return t.exitAt !== null && t.pnlStatus !== "open";
}

export function outcomeOf(t: Pick<InsightsTrade, "realizedPnl">): Outcome {
  const net = t.realizedPnl === null ? null : toMicros(t.realizedPnl);
  if (net === null) return "unknown";
  return net > 0n ? "win" : net < 0n ? "loss" : "breakeven";
}

export interface Summary {
  /** Closed trades in this set, in report order. Every drill-down of this summary is these ids. */
  tradeIds: string[];
  eligibleIds: string[];
  unknownIds: string[];
  winIds: string[];
  lossIds: string[];
  breakevenIds: string[];
  /** Eligible trades whose review has a planned risk (and so an R multiple). */
  rIds: string[];
  closed: number;
  eligible: number;
  unknownPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** False when some trade's P&L is unknown: sums cover the known trades only. */
  complete: boolean;
  net: Metric<string>;
  gross: Metric<string>;
  /** Fees of the eligible trades, so net = gross − fees holds. */
  fees: Metric<string>;
  winRate: Metric<RatioValue>;
  averageWin: Metric<string>;
  averageLoss: Metric<string>;
  expectancy: Metric<string>;
  expectancyGross: Metric<string>;
  profitFactor: Metric<string>;
  averageR: Metric<string>;
}

const value = <T>(v: T): Metric<T> => ({ state: "value", value: v });
const na = <T>(code: MetricCode): Metric<T> => ({ state: "na", code });
const unavailable = <T>(code: MetricCode): Metric<T> => ({ state: "unavailable", code });
const insufficient = <T>(have: number): Metric<T> => ({ state: "insufficient", code: "below_min_sample", have, need: INSIGHTS_MIN_SAMPLE });

/** a ÷ b rounded half away from zero to an integer (b > 0). */
export function divRound(a: bigint, b: bigint): bigint {
  const abs = a < 0n ? -a : a;
  const q = (abs * 2n + b) / (2n * b);
  return a < 0n ? -q : q;
}

/** n/d as a decimal string with `dp` decimals, half away from zero (d > 0). */
export function ratioText(n: bigint, d: bigint, dp: number): string {
  const scale = 10n ** BigInt(dp);
  const scaled = divRound(n * scale, d);
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const whole = abs / scale;
  const frac = dp === 0 ? "" : (abs % scale).toString().padStart(dp, "0").replace(/0+$/, "");
  return `${neg && abs !== 0n ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);
const money = (m: bigint): Metric<string> => (isMicros(m) ? value(microsToDecimal(m)) : unavailable("too_large"));
const mean = (total: bigint, n: number): Metric<string> => money(divRound(total, BigInt(n)));

/** The summary of closed trades of one currency (open trades in the input are ignored). Order is kept. */
export function summarize(trades: readonly InsightsTrade[]): Summary {
  const closed = trades.filter(isClosed);
  const ids = (list: readonly InsightsTrade[]) => list.map(t => t.id);
  const eligible: { t: InsightsTrade; net: bigint; gross: bigint; fees: bigint }[] = [];
  const unknown: InsightsTrade[] = [];
  for (const t of closed) {
    const net = t.realizedPnl === null ? null : toMicros(t.realizedPnl);
    const gross = t.grossPnl === null ? null : toMicros(t.grossPnl);
    const fees = toMicros(t.fees);
    if (net === null || gross === null || fees === null) unknown.push(t);
    else eligible.push({ t, net, gross, fees });
  }
  const wins = eligible.filter(e => e.net > 0n);
  const losses = eligible.filter(e => e.net < 0n);
  const breakevens = eligible.filter(e => e.net === 0n);
  const withR = eligible.flatMap(e => {
    const r = e.t.review?.plannedRisk != null && e.t.review.rMultiple != null ? toMicros(e.t.review.rMultiple) : null;
    return r === null ? [] : [{ id: e.t.id, r }];
  });

  const n = eligible.length;
  const noneKnown = <T>(): Metric<T> => (closed.length === 0 ? na("no_closed_trades") : unavailable("pnl_unknown"));
  const winSum = sum(wins.map(e => e.net));
  const lossSum = sum(losses.map(e => e.net));

  return {
    tradeIds: ids(closed),
    eligibleIds: eligible.map(e => e.t.id),
    unknownIds: ids(unknown),
    winIds: wins.map(e => e.t.id),
    lossIds: losses.map(e => e.t.id),
    breakevenIds: breakevens.map(e => e.t.id),
    rIds: withR.map(e => e.id),
    closed: closed.length,
    eligible: n,
    unknownPnl: unknown.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    complete: unknown.length === 0,
    net: n ? money(sum(eligible.map(e => e.net))) : noneKnown(),
    gross: n ? money(sum(eligible.map(e => e.gross))) : noneKnown(),
    fees: n ? money(sum(eligible.map(e => e.fees))) : noneKnown(),
    winRate: n
      ? value({ numerator: wins.length, denominator: n, percent: ratioText(BigInt(wins.length) * 100n, BigInt(n), 1) })
      : noneKnown(),
    averageWin: !n ? noneKnown() : wins.length ? mean(winSum, wins.length) : na("no_winners"),
    averageLoss: !n ? noneKnown() : losses.length ? mean(lossSum, losses.length) : na("no_losers"),
    expectancy: !n ? noneKnown() : n < INSIGHTS_MIN_SAMPLE ? insufficient(n) : mean(sum(eligible.map(e => e.net)), n),
    expectancyGross: !n ? noneKnown() : n < INSIGHTS_MIN_SAMPLE ? insufficient(n) : mean(sum(eligible.map(e => e.gross)), n),
    profitFactor: !n
      ? noneKnown()
      : n < INSIGHTS_MIN_SAMPLE
        ? insufficient(n)
        : losses.length === 0
          ? na("no_losers")
          : value(ratioText(winSum, -lossSum, 2)),
    averageR: !n
      ? noneKnown()
      : withR.length === 0
        ? na("no_planned_risk")
        : withR.length < INSIGHTS_MIN_SAMPLE
          ? insufficient(withR.length)
          : value(ratioText(sum(withR.map(e => e.r)), BigInt(withR.length) * 1_000_000n, 2)),
  };
}

/** Add amounts (decimal text) exactly; null when any is unknown or the total is out of range. */
export function addMoney(values: readonly (string | null)[]): string | null {
  let total = 0n;
  for (const v of values) {
    const m = v === null ? null : toMicros(v);
    if (m === null) return null;
    total += m;
  }
  return isMicros(total) ? microsToDecimal(total) : null;
}
