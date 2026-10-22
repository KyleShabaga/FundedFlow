// Small SVG charts. Money comes in as decimal text and is converted to
// floats only to place marks (moneyToNumberForDisplay).

import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

import { currencySymbol, formatInstant, formatMoney, formatMoneyCompact, moneySign, moneyToNumberForDisplay } from "../format";
import { type AsyncState, type EmptyKind, hasData, LoadingState, StateBoundary } from "./async-states";
import { cx } from "./cx";
import type { HeadingLevel } from "./primitives";

/* ---------- WinGauge ---------- */

export interface WinGaugeProps {
  wins: number;
  losses: number;
  /** Excluded from the rate, shown in the legend. */
  breakeven?: number;
  /** Width in px. Default 132. */
  width?: number;
}

export function WinGauge({ wins, losses, breakeven = 0, width = 132 }: WinGaugeProps) {
  const decided = wins + losses;
  const rate = decided ? wins / decided : 0;
  const C = Math.PI * 44;
  const arc = "M10 56 A44 44 0 0 1 98 56";
  return (
    <div className="ds-gauge">
      <svg viewBox="0 0 108 62" width={width} role="img" aria-label={`${(rate * 100).toFixed(1)}% win rate`}>
        <path d={arc} className="ds-gauge-loss" strokeDasharray={`${C} ${C}`} />
        {wins > 0 && <path d={arc} className="ds-gauge-win" strokeDasharray={`${Math.max(C * rate - 1.5, 0)} ${C}`} />}
      </svg>
      <div className="ds-gauge-val">{decided ? `${(rate * 100).toFixed(1)}%` : "—"}</div>
      <div className="ds-gauge-legend">
        <span className="ds-text-profit">{wins}W</span>
        {breakeven > 0 && <span>{breakeven}BE</span>}
        <span className="ds-text-loss">{losses}L</span>
      </div>
    </div>
  );
}

/* ---------- Sparkline ---------- */

export function Sparkline({ values, width = 120, height = 28 }: { values: (string | null)[]; width?: number; height?: number }) {
  const v = values.map(moneyToNumberForDisplay).filter((x): x is number => x != null);
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const d = v.map((x, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * width).toFixed(1)} ${(2 + (1 - (x - lo) / span) * (height - 4)).toFixed(1)}`).join("");
  const tone = v[v.length - 1] < v[0] ? "loss" : "profit";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true" className={cx("ds-spark", `ds-spark-${tone}`)}>
      <path d={d} />
    </svg>
  );
}

/* ---------- EquityCurve ---------- */

export interface EquityCurveProps {
  /** Balances (or cumulative P&L) in order, as decimal text. */
  points: string[];
  /** Drawdown floor: one value (static) or one per point (trailing). Dashed in loss. */
  floor?: string | string[] | null;
  /** Pass balance. Dashed in profit. */
  target?: string | null;
  height?: number;
  /** Steps by default: a balance changes per trade, not continuously. */
  step?: boolean;
  floorLabel?: string;
  targetLabel?: string;
  /** Accessible description of the chart. */
  label: string;
}

/** Pixel width beside the plot for the floor and target labels. */
const EQ_LABEL_GUTTER = 64;

export function EquityCurve({ points, floor, target, height = 200, step = true, floorLabel = "Max DD", targetLabel = "Target", label }: EquityCurveProps) {
  // The plot spans the whole viewBox and the SVG stretches to the card. The
  // floor and target labels get a fixed pixel gutter beside it, only when shown,
  // so the line reaches the card's edge at any width.
  const W = 640;
  const padY = 12;
  const pts = points.map(moneyToNumberForDisplay).map((x) => x ?? 0);
  const floorArr = floor == null ? null : (Array.isArray(floor) ? floor : pts.map(() => floor)).map((x) => moneyToNumberForDisplay(x) ?? 0);
  const tgt = target == null ? null : moneyToNumberForDisplay(target);
  if (pts.length === 0) return null;
  const all = [...pts, ...(floorArr ?? []), ...(tgt == null ? [] : [tgt])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.06;
  lo -= pad;
  hi += pad;
  const gutter = floorArr || tgt != null ? EQ_LABEL_GUTTER : 0;
  const iw = W;
  const ih = height - padY * 2;
  const X = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * iw : 0);
  const Y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * ih;
  const path = (arr: number[], stepped: boolean) =>
    arr.map((v, i) => (i === 0 ? `M${X(0).toFixed(1)} ${Y(v).toFixed(1)}` : stepped ? `H${X(i).toFixed(1)}V${Y(v).toFixed(1)}` : `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)).join("");
  const line = path(pts, step);
  const last = pts[pts.length - 1];
  return (
    <div className="ds-eq" style={{ ["--ds-eq-gutter" as string]: `${gutter}px` }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label}>
        <path d={`${line}V${height - padY}H0Z`} className="ds-eq-area" />
        <path d={line} className="ds-eq-line" />
        {floorArr && <path d={path(floorArr, true)} className="ds-eq-floor" />}
        {tgt != null && <line x1={0} x2={iw} y1={Y(tgt)} y2={Y(tgt)} className="ds-eq-target" />}
      </svg>
      {/* Labels and the end dot are HTML so the stretched SVG does not distort them. */}
      <span className="ds-eq-dot" style={{ left: `calc(${X(pts.length - 1) / W} * (100% - ${gutter}px))`, top: `${(Y(last) / height) * 100}%` }} />
      {floorArr && (
        <span className="ds-eq-lbl ds-eq-lbl-loss" style={{ top: `${(Y(floorArr[floorArr.length - 1]) / height) * 100}%` }}>
          {floorLabel}
        </span>
      )}
      {tgt != null && (
        <span className="ds-eq-lbl ds-eq-lbl-profit" style={{ top: `${(Y(tgt) / height) * 100}%` }}>
          {targetLabel}
        </span>
      )}
    </div>
  );
}

/* ---------- PnlBars ---------- */

export interface BarItem {
  key: string;
  label: string;
  /** Decimal text; null draws no bar and reads "P&L unknown". */
  value: string | null;
  /** One short line after the value ("12 trades · 58.3% win"). */
  detail?: string;
}

export interface PnlBarsProps {
  items: readonly BarItem[];
  /** Accessible name of the list ("Net P&L by weekday"). */
  label: string;
  /** Makes each row a button (drill-down to the trades behind it). */
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
  /** ISO 4217 code of the amounts. */
  currency?: string | null;
  /** Scroll inside the card past this height (long period lists). */
  maxHeight?: number;
}

/**
 * Diverging horizontal bars around zero, one labelled row per item, with the
 * exact signed amount as text beside every bar. The rows are the chart's text
 * alternative: each reads its label, amount and detail, and with `onSelect`
 * each is a button. Bar lengths are drawing only (moneyToNumberForDisplay).
 */
export function PnlBars({ items, label, onSelect, selectedKey, currency, maxHeight }: PnlBarsProps) {
  const nums = items.map((it) => moneyToNumberForDisplay(it.value));
  const max = Math.max(0, ...nums.map((n) => (n == null ? 0 : Math.abs(n)))) || 1;
  return (
    <ul className="ds-bars" aria-label={label} style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      {items.map((it, i) => {
        const n = nums[i];
        const sign = it.value == null ? null : moneySign(it.value);
        const pct = n == null ? 0 : (Math.abs(n) / max) * 50;
        const amount = formatMoney(it.value, { signed: true, currency });
        const name = `${it.label}: ${it.value == null ? "P&L unknown" : amount}${it.detail ? `, ${it.detail}` : ""}`;
        const content = (
          <>
            <span className="ds-bars-label">{it.label}</span>
            <span className="ds-bars-track" aria-hidden="true">
              <span className="ds-bars-axis" />
              {n != null && n !== 0 && (
                <span className={cx("ds-bars-bar", `is-${sign}`)} style={sign === "loss" ? { right: "50%", width: `${pct}%` } : { left: "50%", width: `${pct}%` }} />
              )}
            </span>
            <span className={cx("ds-bars-value", "ds-mono", sign && `ds-text-${sign}`)}>{amount}</span>
            {it.detail && <span className="ds-bars-detail ds-faint">{it.detail}</span>}
          </>
        );
        return (
          <li key={it.key}>
            {onSelect ? (
              <button type="button" className={cx("ds-bars-row", "is-clickable", selectedKey === it.key && "is-selected")} aria-label={name}
                aria-pressed={selectedKey !== undefined ? selectedKey === it.key : undefined} onClick={() => onSelect(it.key)}>
                {content}
              </button>
            ) : (
              <div className="ds-bars-row" role="group" aria-label={name}>
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- RunningTotalChart ---------- */

/** How a RunningTotalChart joins its observed points. */
export type CurveStyle = "step" | "smooth";

export interface RunningTotalPoint {
  key: string;
  /** Running total after this point, as decimal text. */
  value: string;
  /** Context in the tooltip ("Trade 12 · ES · Thu, Aug 20, 2026"). */
  label: string;
  /** A second tooltip line ("Result +$12.50"). */
  detail?: string;
}

export interface RunningTotalChartProps {
  /** Observed points in order, equally spaced. The chart draws the zero start before the first. */
  points: readonly RunningTotalPoint[];
  /** ISO 4217 code of the amounts: named in the Y-axis title and used for the symbol. */
  currency?: string | null;
  /** Y-axis title without the currency ("Cumulative net P&L"). */
  yTitle: string;
  /** X-axis title matching the spacing ("Closed trades (exit order)"). */
  xTitle: string;
  /** Tooltip context of the zero start. */
  startLabel?: string;
  /** Steps by default: a running total changes at each point, not in between. */
  curve?: CurveStyle;
  /** Total height in px, axes included. Default 240. */
  height?: number;
  /** Accessible name of the chart. */
  label: string;
}

/** The smallest round step at or above `raw`: 1, 2, 2.5 or 5 times a power of ten. Whole-number steps skip 2.5 below 10. */
export function niceStep(raw: number, integer = false): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const nice = integer && power < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = (nice.find((m) => m * power >= raw - power * 1e-9) ?? 10) * power;
  return integer ? Math.max(1, Math.round(step)) : step;
}

/** Round ticks covering lo..hi (zero always inside), about `count` of them. */
export function valueTicks(lo: number, hi: number, count: number): { ticks: number[]; step: number } {
  let a = Math.min(lo, 0);
  let b = Math.max(hi, 0);
  if (a === b) b = 1;
  const step = niceStep((b - a) / Math.max(1, count));
  a = Math.floor(a / step) * step;
  b = Math.ceil(b / step) * step;
  const ticks: number[] = [];
  for (let i = 0; a + i * step <= b + step / 1e6; i++) ticks.push(Number((a + i * step).toFixed(10)));
  return { ticks, step };
}

/**
 * SVG path through the points. "step" holds each value until the next point; "smooth" is a monotone cubic
 * (Steffen's method, as d3's curveMonotoneX): every control point stays within its segment's values, so the curve
 * never rises above or dips below the two observations it joins.
 */
export function curvePath(xs: readonly number[], ys: readonly number[], curve: CurveStyle): string {
  const f = (n: number) => Number(n.toFixed(2));
  if (xs.length === 0) return "";
  let d = `M${f(xs[0])} ${f(ys[0])}`;
  if (curve === "step") {
    for (let i = 1; i < xs.length; i++) d += `H${f(xs[i])}V${f(ys[i])}`;
    return d;
  }
  if (xs.length === 2) return `${d}L${f(xs[1])} ${f(ys[1])}`;
  const n = xs.length;
  const slope = (i: number) => (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1);
  const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const t: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1];
    const h1 = xs[i + 1] - xs[i];
    const s0 = slope(i - 1);
    const s1 = slope(i);
    const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
    t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  t[0] = (3 * slope(0) - t[1]) / 2;
  t[n - 1] = (3 * slope(n - 2) - t[n - 2]) / 2;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    d += `C${f(xs[i] + dx)} ${f(ys[i] + dx * t[i])} ${f(xs[i + 1] - dx)} ${f(ys[i + 1] - dx * t[i + 1])} ${f(xs[i + 1])} ${f(ys[i + 1])}`;
  }
  return d;
}

/** Decimal places that write every multiple of `step` exactly (2.5 needs one, 0.25 two). */
const stepDecimals = (step: number) => {
  for (let d = 0; d < 6; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) return d;
  return 6;
};

/** Tick value as decimal text for format.ts (the tick is a drawing position, not a stored amount). */
const tickText = (v: number, step: number) => v.toFixed(stepDecimals(step));

/**
 * A running total with labelled axes: equally spaced observations on X (with their count as ticks), the amount on Y
 * with a zero line, and a tooltip on hover or keyboard focus that reads the observed point, never a value sampled
 * along the line. Tick density follows the measured width. Amounts are converted to floats only to place marks.
 */
export function RunningTotalChart({ points, currency, yTitle, xTitle, startLabel = "Start", curve = "step", height = 240, label }: RunningTotalChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setMeasured(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setMeasured(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = measured || 640;
  const all = [{ key: "start", value: "0", label: startLabel } as RunningTotalPoint, ...points];
  const values = all.map((p) => moneyToNumberForDisplay(p.value) ?? 0);
  const n = all.length - 1;
  const symbol = currency !== undefined ? currencySymbol(currency) : "$";
  const top = 10;
  const bottom = 44;
  const plotH = Math.max(40, height - top - bottom);
  const y = valueTicks(Math.min(...values), Math.max(...values), Math.max(2, Math.floor(plotH / 44)));
  // Whole steps read compact ("+$2.5K"); a step with decimals keeps them exactly, at least cents ("+$7.50", "+$0.25").
  const yLabels = y.ticks.map((v) => (Number.isInteger(y.step) ? formatMoneyCompact(tickText(v, y.step), symbol) : formatMoney(tickText(v, y.step), { currency, dp: Math.max(2, stepDecimals(y.step)) })));
  const left = 22 + Math.max(...yLabels.map((s) => s.length)) * 6.8 + 8;
  const right = 14;
  const plotW = Math.max(40, width - left - right);
  const lo = y.ticks[0];
  const hi = y.ticks[y.ticks.length - 1];
  const X = (i: number) => left + (n ? (i / n) * plotW : plotW / 2);
  const Y = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const xStep = niceStep(n / Math.max(1, Math.floor(plotW / 64)), true);
  const xTicks: number[] = [];
  for (let i = 0; i <= n; i += xStep) xTicks.push(i);
  const xs = all.map((_, i) => X(i));
  const ys = values.map(Y);
  const line = curvePath(xs, ys, curve);
  const zero = Y(0);
  const yAxisTitle = currency ? `${yTitle} (${currency})` : yTitle;
  const point = active == null ? null : all[active];
  const describe = (i: number) => {
    const p = all[i];
    return `${p.label}${p.detail ? `, ${p.detail}` : ""}, running total ${formatMoney(p.value, { currency })}`;
  };
  const nearest = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    return Math.min(n, Math.max(0, Math.round(((clientX - box.left - left) / plotW) * n)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = active ?? n;
    const next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? n : e.key === "PageUp" ? at + 10 : e.key === "PageDown" ? at - 10 : null;
    if (next == null) {
      if (e.key === "Escape") setActive(null);
      return;
    }
    e.preventDefault();
    setActive(Math.min(n, Math.max(0, next)));
  };
  const tipLeft = active == null ? 0 : xs[active];
  return (
    <div
      ref={ref}
      className="ds-rt"
      style={{ height }}
      role="group"
      aria-roledescription="chart"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? n)}
      onBlur={() => setActive(null)}
      onPointerMove={(e) => setActive(nearest(e.clientX))}
      onPointerLeave={() => {
        if (document.activeElement !== ref.current) setActive(null);
      }}
    >
      <svg width={width} height={height} aria-hidden="true" className="ds-rt-svg">
        {y.ticks.map((v, i) => (
          <g key={v}>
            {v !== 0 && <line x1={left} x2={left + plotW} y1={Y(v)} y2={Y(v)} className="ds-rt-grid" />}
            <text x={left - 8} y={Y(v)} className="ds-rt-tick" textAnchor="end" dominantBaseline="middle">
              {yLabels[i]}
            </text>
          </g>
        ))}
        <path d={`${line}V${zero}H${xs[0]}Z`} className="ds-rt-area" />
        <line x1={left} x2={left + plotW} y1={zero} y2={zero} className="ds-rt-zero" />
        <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} className="ds-rt-axis" />
        {xTicks.map((i) => (
          <g key={i}>
            <line x1={X(i)} x2={X(i)} y1={top + plotH} y2={top + plotH + 4} className="ds-rt-axis" />
            <text x={X(i)} y={top + plotH + 16} className="ds-rt-tick" textAnchor="middle">
              {i}
            </text>
          </g>
        ))}
        <path d={line} className="ds-rt-line" />
        {active != null && <line x1={xs[active]} x2={xs[active]} y1={top} y2={top + plotH} className="ds-rt-cursor" />}
        <circle cx={xs[n]} cy={ys[n]} r={4} className="ds-rt-end" />
        {active != null && <circle cx={xs[active]} cy={ys[active]} r={4.5} className="ds-rt-active" />}
        <text x={left + plotW / 2} y={height - 6} className="ds-rt-title" textAnchor="middle">
          {xTitle}
        </text>
        <text transform={`translate(12 ${top + plotH / 2}) rotate(-90)`} className="ds-rt-title" textAnchor="middle" dominantBaseline="middle">
          {yAxisTitle}
        </text>
      </svg>
      {point && active != null && (
        <div className={cx("ds-rt-tip", tipLeft > width / 2 && "is-left")} style={{ left: tipLeft, top: Math.max(0, Math.min(ys[active] - 24, top + plotH - 64)) }} aria-hidden="true">
          <div className="ds-rt-tip-label">{point.label}</div>
          {point.detail && <div className="ds-faint">{point.detail}</div>}
          <div>
            Running total <span className={cx("ds-mono", `ds-text-${moneySign(point.value)}`)}>{formatMoney(point.value, { currency })}</span>
          </div>
        </div>
      )}
      <span className="ds-sr-only" aria-live="polite">
        {active != null ? describe(active) : ""}
      </span>
    </div>
  );
}

/* ---------- ChartPanel ---------- */

export interface ChartPanelProps<T> {
  title: string;
  subtitle?: ReactNode;
  /** Controls beside the title (basis tabs, range). */
  actions?: ReactNode;
  /** The chart's data state; the chart renders only for data states. */
  state: AsyncState<T>;
  /** Draws the chart from data. Keep it to the design-system charts (no market data here). */
  children: (data: T) => ReactNode;
  /** Account zone for the "As of" line and stale notice. */
  timeZone?: string;
  /** Empty copy per kind ("No trades in this range"). */
  empty?: Partial<Record<EmptyKind, ReactNode>>;
  onRetry?: () => void;
  /** Minimum body height so loading, empty and chart states keep the same size. Default 200. */
  minHeight?: number;
  /** Level of the title in the page outline. 2 when the panel is a page's top-level section. */
  headingLevel?: HeadingLevel;
  className?: string;
}

/**
 * Card around a chart: title, subtitle, data timestamp and the loading,
 * empty, error and stale fallbacks of StateBoundary. Live charting
 * (TradingView, market data) is a P2 card, not this wrapper.
 */
export function ChartPanel<T>({ title, subtitle, actions, state, children, timeZone, empty, onRetry, minHeight = 200, headingLevel = 3, className }: ChartPanelProps<T>) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const asOf = hasData(state) ? (state.asOf ?? null) : undefined;
  return (
    <section className={cx("ds-card", "ds-chart-panel", className)} aria-labelledby={headingId}>
      <header className="ds-chart-head">
        <div>
          <Heading id={headingId} className="ds-title ds-chart-title">
            {title}
          </Heading>
          {subtitle != null && <p className="ds-faint ds-chart-sub">{subtitle}</p>}
        </div>
        <div className="ds-chart-meta">
          {asOf != null && state.status !== "stale" && <span className="ds-faint">As of {formatInstant(asOf, { timeZone })}</span>}
          {actions}
        </div>
      </header>
      <div className="ds-chart-body" style={{ minHeight }}>
        <StateBoundary state={state} label={title.toLowerCase()} empty={empty} onRetry={onRetry} timeZone={timeZone} loading={<LoadingState label={`Loading ${title.toLowerCase()}`} layout="panel" />}>
          {(data) => children(data)}
        </StateBoundary>
      </div>
    </section>
  );
}
