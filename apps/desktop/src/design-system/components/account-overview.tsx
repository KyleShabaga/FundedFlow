// Account overview card (Build 18.5): one account attempt at a glance. Identity and status first, then the one
// figure to act on (drawdown headroom) beside balance and floor, at most two progress bars, a few rule lines and
// a footer with last activity and an explicit details action. Structure only: every value, label and provenance
// arrives formatted from the feature, and nothing here calculates money.
import { toMicros } from "@fundedflow/domain";
import type { ReactNode } from "react";

import { cx } from "./cx";
import { MetricValueView, type MetricValue } from "./data";
import { Badge, type Tone } from "./primitives";

/* ---------- ProgressMeter ---------- */

export interface ProgressMeterProps {
  label: string;
  /** Decimal text supplied by the caller (an engine figure); only value ÷ max sets the bar width. */
  value: string;
  max: string;
  tone?: "flow" | "profit" | "warn" | "loss";
  /** What the bar shows, read by screen readers: "$1,200 of $2,500 left". */
  valueText: string;
  /** One short line beside the amounts: "Floor $48,000", "$1,800 to go". */
  note?: ReactNode;
}

/** Bar width only, compared in micro-units. Negative or unknown is empty, over the maximum is full. */
export function meterFraction(value: string, max: string): number {
  const v = toMicros(value);
  const m = toMicros(max);
  if (v == null || m == null || m <= 0n || v <= 0n) return 0;
  if (v >= m) return 1;
  // Display only: bar width.
  return Number((v * 10_000n) / m) / 10_000;
}

/** A compact bar for a figure the caller already has both amounts for. It states no verdict of its own. */
export function ProgressMeter({ label, value, max, tone = "flow", valueText, note }: ProgressMeterProps) {
  const pct = Math.round(meterFraction(value, max) * 100);
  return (
    <div className={cx("ds-pmeter", `ds-pmeter-${tone}`)}>
      <div className="ds-pmeter-head">
        <span className="ds-pmeter-label">{label}</span>
        <span className="ds-mono ds-pmeter-value">{valueText}</span>
      </div>
      <div className="ds-pmeter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={valueText}>
        <div className="ds-pmeter-fill" style={{ width: `${pct}%` }} />
      </div>
      {note != null && <span className="ds-pmeter-note">{note}</span>}
    </div>
  );
}

/* ---------- AccountOverviewCard ---------- */

export interface OverviewFigureProps {
  label: string;
  value: MetricValue;
  /** Where the value comes from ("Confirmed by you", "Not current"), as text plus tone. */
  provenance?: { label: string; tone: Tone } | null;
  /** As-of time, basis or why it is missing. */
  note?: ReactNode;
}

export interface AccountOverviewCardProps {
  /** Id for the title, so the card (an article) is named by it. */
  titleId: string;
  /** Heading level of the title in the page outline. */
  headingLevel?: 2 | 3 | 4;
  /** One character standing in for a logo. */
  mark: string;
  /** Prop firm, or "Personal · no firm". */
  eyebrow: string;
  title: string;
  /** Masked broker number ("••••4821"). */
  reference?: string | null;
  /** Type, phase and attempt, already joined or as nodes. */
  meta: ReactNode;
  /** Lifecycle, archived, setup and active badges. */
  badges: ReactNode;
  /** The figure to act on, shown largest. */
  primary: OverviewFigureProps;
  figures: readonly OverviewFigureProps[];
  /** At most two ProgressMeters. */
  meters?: ReactNode;
  rules?: readonly { label: string; value: ReactNode; muted?: boolean }[];
  /** "Last traded …" line. */
  activity: ReactNode;
  /** The details action first, then any secondary actions. */
  actions: ReactNode;
  tint?: "loss" | "muted" | null;
  selected?: boolean;
  className?: string;
}

function Figure({ figure, primary }: { figure: OverviewFigureProps; primary?: boolean }) {
  return (
    <div className={cx("ds-aoc-figure", primary && "is-primary")}>
      <span className="ds-label">{figure.label}</span>
      <span className="ds-aoc-value">
        <MetricValueView value={figure.value} />
      </span>
      {figure.provenance && (
        <span className="ds-aoc-prov">
          <Badge tone={figure.provenance.tone}>{figure.provenance.label}</Badge>
        </span>
      )}
      {figure.note != null && <span className="ds-aoc-note">{figure.note}</span>}
    </div>
  );
}

/**
 * Scan order: identity and status, headroom (with balance and floor), bars, rule lines, activity and actions.
 * In a narrow card (container query) the rule lines and secondary figures fold away; identity, status, the
 * primary figure and the details action always stay.
 */
export function AccountOverviewCard({
  titleId, headingLevel = 3, mark, eyebrow, title, reference, meta, badges, primary, figures, meters, rules = [], activity, actions, tint, selected, className,
}: AccountOverviewCardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <article className={cx("ds-card", "ds-aoc", tint && `is-${tint}`, selected && "is-selected", className)} aria-labelledby={titleId}>
      <header className="ds-aoc-head">
        <span className="ds-aoc-mark" aria-hidden="true">{mark}</span>
        <div className="ds-aoc-id">
          <span className="ds-aoc-eyebrow">{eyebrow}</span>
          <Heading id={titleId} className="ds-aoc-title">
            <span className="ds-aoc-name">{title}</span>
            {reference && <span className="ds-aoc-ref"><span className="ds-sr-only">, account number ending </span>{reference}</span>}
          </Heading>
          <span className="ds-aoc-meta">{meta}</span>
        </div>
        <div className="ds-aoc-badges">{badges}</div>
      </header>
      <div className="ds-aoc-figures">
        <Figure figure={primary} primary />
        {figures.map(f => <Figure key={f.label} figure={f} />)}
      </div>
      {meters != null && <div className="ds-aoc-meters">{meters}</div>}
      {rules.length > 0 && (
        <dl className="ds-aoc-rules">
          {rules.map(r => (
            <div key={r.label} className={cx("ds-aoc-rule", r.muted && "is-muted")}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <footer className="ds-aoc-foot">
        <span className="ds-aoc-activity">{activity}</span>
        <div className="ds-aoc-actions">{actions}</div>
      </footer>
    </article>
  );
}
