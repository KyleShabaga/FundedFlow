import { microsToDecimal, toMicros } from "@fundedflow/domain";
import type { ReactNode } from "react";

import { formatMoney, formatPercent, moneySign } from "../format";
import { cx } from "./cx";
import { Badge, Pnl, type Tone } from "./primitives";

/* ---------- RuleMeter ---------- */

/** limit: daily loss, max drawdown. target: profit target. Amounts are decimal text. */
interface MoneyRule {
  kind?: "limit" | "target";
  label: string;
  used: string;
  limit: string;
  note?: string;
  /** Fraction digits for the amounts. Default 0 (whole dollars). */
  dp?: number;
}
/** count: minimum trading days, consistency days. */
interface CountRule {
  kind: "count";
  label: string;
  used: number;
  limit: number;
  unit?: string;
  note?: string;
}
export type RuleMeterProps = MoneyRule | CountRule;
export type RuleState = "ok" | "warn" | "breach" | "progress" | "done";

/** Share of the limit at which a limit rule turns amber. */
export const WARN_AT = 0.7;

/**
 * State of a rule. Money is compared in bigint micro-units: a limit is
 * "warn" from 70% and "breach" at 100%; a target or count is "done" at 100%.
 */
export function ruleState(rule: RuleMeterProps): RuleState {
  if (rule.kind === "count") return rule.used >= rule.limit ? "done" : "progress";
  const used = toMicros(rule.used) ?? 0n;
  const limit = toMicros(rule.limit) ?? 0n;
  if (limit <= 0n) return rule.kind === "target" ? "progress" : "ok";
  if (rule.kind === "target") return used >= limit ? "done" : "progress";
  if (used >= limit) return "breach";
  return used * 10n >= limit * BigInt(WARN_AT * 10) ? "warn" : "ok";
}

function ratio(rule: RuleMeterProps): number {
  if (rule.kind === "count") return rule.limit > 0 ? Math.min(rule.used / rule.limit, 1) : 0;
  const used = toMicros(rule.used) ?? 0n;
  const limit = toMicros(rule.limit) ?? 0n;
  if (limit <= 0n || used <= 0n) return 0;
  if (used >= limit) return 1;
  // Display only: bar width.
  return Number((used * 10_000n) / limit) / 10_000;
}

export function RuleMeter(props: RuleMeterProps) {
  const state = ruleState(props);
  const kind = props.kind ?? "limit";
  let amount: ReactNode;
  let foot: string;
  if (props.kind === "count") {
    const left = Math.max(props.limit - props.used, 0);
    amount = (
      <>
        <b>{props.used}</b> / {props.limit}
      </>
    );
    foot = state === "done" ? "Requirement met" : `${left}${props.unit ? ` ${props.unit}` : ""} to go`;
  } else {
    const dp = props.dp ?? 0;
    const used = toMicros(props.used) ?? 0n;
    const limit = toMicros(props.limit) ?? 0n;
    const leftMicros = limit > used ? limit - used : 0n;
    const fmt = (v: string) => formatMoney(v, { signed: false, dp });
    const left = fmt(microsToDecimal(leftMicros));
    amount = (
      <>
        <b>{fmt(props.used)}</b> / {fmt(props.limit)}
      </>
    );
    foot =
      kind === "target"
        ? state === "done" ? "Target hit" : `${left} to go`
        : state === "breach" ? "Limit breached" : `${left} room left`;
  }
  return (
    <div className={cx("ds-rule", `ds-rule-${state}`)}>
      <div className="ds-rule-head">
        <span className="ds-label">{props.label}</span>
        <span className="ds-rule-amt">{amount}</span>
      </div>
      <div
        className="ds-rule-track"
        role="meter"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio(props) * 100)}
        aria-valuetext={foot}
      >
        <div className="ds-rule-fill" style={{ width: `${(ratio(props) * 100).toFixed(1)}%` }} />
        {kind === "limit" && <div className="ds-rule-tick" style={{ left: `${WARN_AT * 100}%` }} />}
      </div>
      <div className="ds-rule-foot">
        <span className="ds-rule-state">{foot}</span>
        {props.note && <span className="ds-rule-note">{props.note}</span>}
      </div>
    </div>
  );
}

/* ---------- AccountCard ---------- */

export interface AccountCardProps {
  name: string;
  /** Prop firm or broker; its initial stands in for a logo. */
  firm?: string | null;
  /** "$100K". */
  sizeLabel?: string;
  /** Shown as a badge: "Evaluation", "Funded", "Breached"... */
  phase: string;
  phaseTone?: Tone;
  /** Current balance and starting balance as decimal text; null balance is unknown. */
  balance: string | null;
  startingBalance: string;
  /** Most dangerous rule first. */
  rules?: RuleMeterProps[];
  footer?: ReactNode;
  /** Tints the card in loss; a breached account stays visible. */
  breached?: boolean;
  className?: string;
}

export function AccountCard({ name, firm, sizeLabel, phase, phaseTone = "flow", balance, startingBalance, rules = [], footer, breached, className }: AccountCardProps) {
  const bal = balance == null ? null : toMicros(balance);
  const start = toMicros(startingBalance);
  const change = bal != null && start != null ? bal - start : null;
  const changeText = change == null ? null : microsToDecimal(change);
  // Display only: the percentage is a ratio, not stored money.
  const pct = change != null && start ? (Number(change) / Number(start)) * 100 : null;
  return (
    <div className={cx("ds-card", "ds-acct", breached && "is-breached", className)}>
      <div className="ds-acct-head">
        <div className="ds-acct-id">
          <span className="ds-acct-mark" aria-hidden="true">
            {(firm || name).slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div className="ds-acct-firm">
              {firm || name}
              {sizeLabel && <span className="ds-acct-size"> · {sizeLabel}</span>}
            </div>
            {firm && <div className="ds-acct-name">{name}</div>}
          </div>
        </div>
        <Badge tone={phaseTone}>{phase}</Badge>
      </div>
      <div className="ds-acct-bal">
        <span className="ds-num-xl">{formatMoney(balance, { signed: false })}</span>
        <Pnl value={changeText} />
        {pct != null && <span className={cx("ds-acct-pct", `ds-text-${moneySign(changeText)}`)}>{formatPercent(pct)}</span>}
      </div>
      {rules.length > 0 && (
        <div className="ds-acct-rules">
          {rules.map((r) => (
            <RuleMeter key={r.label} {...r} />
          ))}
        </div>
      )}
      {footer != null && <div className="ds-acct-foot">{footer}</div>}
    </div>
  );
}
