import * as RadixTabs from "@radix-ui/react-tabs";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { formatMoney, formatMoneyCompact, formatPercent, moneySign } from "../format";
import { cx } from "./cx";

/* ---------- Button ---------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** React 19 ref forwarding for recovery and dialog focus management. */
  ref?: Ref<HTMLButtonElement>;
  /** primary: one per view. secondary (default): bordered. ghost: toolbar text. danger: destructive. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  /** Leading icon, 16px, supplied by the caller (lucide-react). */
  icon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={cx("ds-btn", `ds-btn-${variant}`, `ds-btn-${size}`, className)}>
      {icon}
      {children}
    </button>
  );
}

/* ---------- Badge ---------- */

export type Tone = "neutral" | "flow" | "profit" | "loss" | "warn";

export interface BadgeProps {
  tone?: Tone;
  /** outline is reserved for trade side: LONG in profit, SHORT in loss. */
  variant?: "soft" | "outline";
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", variant = "soft", className, children }: BadgeProps) {
  return <span className={cx("ds-badge", `ds-badge-${tone}`, variant === "outline" && "ds-badge-outline", className)}>{children}</span>;
}

/* ---------- Pnl ---------- */

export interface PnlProps {
  /** Canonical decimal text from Rust ("208.38", "-36"); null means unknown and shows "—". */
  value: string | null;
  /** Optional return beside the amount, e.g. 7.62 for +7.62%. */
  percent?: number | null;
  size?: "s" | "m" | "xl";
  /** "+$14.3K" for calendar cells and axes. */
  compact?: boolean;
  symbol?: string;
  className?: string;
}

export function Pnl({ value, percent, size = "m", compact = false, symbol = "$", className }: PnlProps) {
  const sign = moneySign(value);
  return (
    <span className={cx("ds-pnl", `ds-pnl-${sign}`, `ds-pnl-${size}`, value == null && "ds-pnl-unknown", className)}>
      {compact ? formatMoneyCompact(value, symbol) : formatMoney(value, { symbol })}
      {percent != null && <span className="ds-pnl-pct">{formatPercent(percent)}</span>}
    </span>
  );
}

/* ---------- StatTile ---------- */

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** One line that explains the number ("22 W · 14 L"). */
  sub?: ReactNode;
  /** A count or period, top right. */
  aside?: ReactNode;
  /** Colours a plain value. */
  tone?: Exclude<Tone, "neutral">;
  /** A WinGauge or Sparkline on the right. */
  children?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, sub, aside, tone, children, className }: StatTileProps) {
  return (
    <div className={cx("ds-card", "ds-tile", className)}>
      <div className="ds-tile-head">
        <span className="ds-label">{label}</span>
        {aside != null && <span className="ds-tile-aside">{aside}</span>}
      </div>
      <div className="ds-tile-body">
        <div>
          <div className={cx("ds-tile-value", tone && `ds-text-${tone}`)}>{value}</div>
          {sub != null && <div className="ds-tile-sub">{sub}</div>}
        </div>
        {children != null && <div className="ds-tile-viz">{children}</div>}
      </div>
    </div>
  );
}

/* ---------- Tabs (Radix) ---------- */

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  /** TabPanel elements, one per item value. */
  children?: ReactNode;
  className?: string;
}

/** Views of one object: a day (Overview · Notes · Trades), a report. Two to six tabs. */
export function Tabs({ items, value, defaultValue, onValueChange, label, children, className }: TabsProps) {
  return (
    <RadixTabs.Root
      className={cx("ds-tabs-root", className)}
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
    >
      <RadixTabs.List className="ds-tabs" aria-label={label}>
        {items.map((it) => (
          <RadixTabs.Trigger key={it.value} value={it.value} className="ds-tab">
            {it.label}
            {it.count != null && <span className="ds-tab-count">{it.count}</span>}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RadixTabs.Content value={value} className={cx("ds-tab-panel", className)}>
      {children}
    </RadixTabs.Content>
  );
}
