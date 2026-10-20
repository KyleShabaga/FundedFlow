// Small SVG charts. Money comes in as decimal text and is converted to
// floats only to place marks (moneyToNumberForDisplay).

import { moneyToNumberForDisplay } from "../format";
import { cx } from "./cx";

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
  const padR = 64;
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
