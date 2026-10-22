// Small SVG charts. Money comes in as decimal text and is converted to
// floats only to place marks (moneyToNumberForDisplay).

import { type ReactNode, useId } from "react";

import { formatInstant, formatMoney, moneySign, moneyToNumberForDisplay } from "../format";
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

export function EquityCurve({ points, floor, target, height = 200, step = true, floorLabel = "Max DD", targetLabel = "Target", label }: EquityCurveProps) {
  const W = 640;
  const padY = 12;
  const pts = points.map(moneyToNumberForDisplay).map((x) => x ?? 0);
  const floorArr = floor == null ? null : (Array.isArray(floor) ? floor : pts.map(() => floor)).map((x) => moneyToNumberForDisplay(x) ?? 0);
  const tgt = target == null ? null : moneyToNumberForDisplay(target);
  // The right gutter holds the floor and target labels; without them the line runs to the edge.
  const padR = floorArr || tgt != null ? 64 : 0;
  if (pts.length === 0) return null;
  const all = [...pts, ...(floorArr ?? []), ...(tgt == null ? [] : [tgt])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.06;
  lo -= pad;
  hi += pad;
  const iw = W - padR;
  const ih = height - padY * 2;
  const X = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * iw : 0);
  const Y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * ih;
  const path = (arr: number[], stepped: boolean) =>
    arr.map((v, i) => (i === 0 ? `M${X(0).toFixed(1)} ${Y(v).toFixed(1)}` : stepped ? `H${X(i).toFixed(1)}V${Y(v).toFixed(1)}` : `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)).join("");
  const line = path(pts, step);
  const last = pts[pts.length - 1];
  return (
    <div className="ds-eq">
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label}>
        <path d={`${line}V${height - padY}H0Z`} className="ds-eq-area" />
        <path d={line} className="ds-eq-line" />
        {floorArr && <path d={path(floorArr, true)} className="ds-eq-floor" />}
        {tgt != null && <line x1={0} x2={iw} y1={Y(tgt)} y2={Y(tgt)} className="ds-eq-target" />}
      </svg>
      {/* Labels and the end dot are HTML so the stretched SVG does not distort them. */}
      <span className="ds-eq-dot" style={{ left: `${(X(pts.length - 1) / W) * 100}%`, top: `${(Y(last) / height) * 100}%` }} />
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
