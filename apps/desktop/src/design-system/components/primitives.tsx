import * as RadixTabs from "@radix-ui/react-tabs";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, type Ref, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { currencySymbol, formatMoney, formatMoneyCompact, formatPercent, moneySign } from "../format";
import { cx } from "./cx";
import { Select } from "./forms";

/* ---------- Button ---------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** React 19 ref forwarding for recovery and dialog focus management. */
  ref?: Ref<HTMLButtonElement>;
  /** primary: one per view. secondary (default): bordered. ghost: toolbar text. danger: destructive. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  /** Leading icon, 16px, supplied by the caller (lucide-react). */
  icon?: ReactNode;
  /**
   * Busy: shows a spinner, sets aria-busy and ignores clicks so a submit
   * cannot run twice. The button keeps focus (it is aria-disabled, not
   * disabled), so keyboard users do not lose their place.
   */
  loading?: boolean;
  /**
   * Why the action is unavailable. With `disabled`, the button stays
   * focusable (aria-disabled) and the reason is its description.
   */
  disabledReason?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  disabledReason,
  disabled,
  className,
  children,
  type = "button",
  onClick,
  "aria-describedby": describedBy,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const softDisabled = loading || (disabled && disabledReason != null);
  const inert = softDisabled || disabled;
  return (
    <>
      <button
        {...rest}
        type={type}
        disabled={disabled && !softDisabled}
        aria-disabled={softDisabled || undefined}
        aria-busy={loading || undefined}
        aria-describedby={cx(describedBy, disabled && disabledReason != null && reasonId) || undefined}
        title={disabled && disabledReason ? disabledReason : rest.title}
        onClick={(e) => {
          if (inert) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        className={cx("ds-btn", `ds-btn-${variant}`, `ds-btn-${size}`, softDisabled && "is-inert", loading && "is-loading", className)}
      >
        {loading ? <LoaderCircle size={16} className="ds-spin" aria-hidden="true" /> : icon}
        {children}
      </button>
      {disabled && disabledReason != null && (
        <span id={reasonId} className="ds-sr-only">
          {disabledReason}
        </span>
      )}
    </>
  );
}

/* ---------- IconButton ---------- */

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  ref?: Ref<HTMLButtonElement>;
  /** Accessible name; also the hover title. Required: the button has no text. */
  label: string;
  /** 16px lucide icon, marked aria-hidden by the caller. */
  icon: ReactNode;
  variant?: "secondary" | "ghost";
  size?: "md" | "sm";
}

/** Square icon-only button (32 px, 28 px small): previous/next, row menus, close. */
export function IconButton({ label, icon, variant = "secondary", size = "md", className, type = "button", title, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-label={label} title={title ?? label} className={cx("ds-icon-btn", `ds-icon-btn-${variant}`, `ds-icon-btn-${size}`, className)}>
      {icon}
    </button>
  );
}

/* ---------- DisclosureButton ---------- */

export interface DisclosureButtonProps extends Omit<ButtonProps, "aria-expanded" | "aria-controls" | "loading"> {
  /** Whether the region it shows is open; drawn as a pressed style and a turned chevron, and read as aria-expanded. */
  expanded: boolean;
  /** Id of the region it shows and hides. */
  controls: string;
  /** Active items behind it ("Filters · 3"); 0 or null shows none. */
  count?: number | null;
  /** Screen-reader words for the count, e.g. "3 filters applied". Default: "<n> active". */
  countLabel?: (count: number) => string;
}

/**
 * A button that shows and hides a region elsewhere in the layout (P0-D18), for when a native Disclosure's summary
 * can't sit apart from its body, such as a Filters action in a toolbar with its panel below. The caller keeps the
 * state and renders the region with the matching id.
 */
export function DisclosureButton({ expanded, controls, count, countLabel, className, children, ...rest }: DisclosureButtonProps) {
  const shown = count != null && count > 0 ? count : null;
  return (
    <Button {...rest} aria-expanded={expanded} aria-controls={controls} className={cx("ds-disclosure-btn", expanded && "is-expanded", className)}>
      {children}
      {shown !== null && (
        <>
          <span className="ds-disclosure-count" aria-hidden="true">· {shown}</span>
          <span className="ds-sr-only">, {countLabel ? countLabel(shown) : `${shown} active`}</span>
        </>
      )}
      <ChevronDown size={14} className="ds-disclosure-chevron" aria-hidden="true" />
    </Button>
  );
}

/* ---------- SegmentedControl ---------- */

export interface SegmentOption<V extends string = string> {
  value: V;
  label: string;
  /** Shown in mono beside the label ("Errors 1"); null hides it. */
  count?: number | null;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string = string> {
  /** Accessible name for the group ("Status", "Show"); also the dropdown's visible label when it folds. */
  label: string;
  options: readonly SegmentOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /**
   * When the buttons don't fit the width they can take (Build 26.85): "menu" (default) swaps them for a labelled
   * dropdown with the same options, counts and selection; "scroll" keeps the buttons and scrolls them sideways.
   */
  overflow?: "menu" | "scroll";
  className?: string;
}

/** Flex items that don't grow are as wide as their content, so their width says nothing about the room available. */
function isContentSized(el: HTMLElement) {
  const style = getComputedStyle(el);
  if (style.display.startsWith("inline")) return true;
  const parent = el.parentElement && getComputedStyle(el.parentElement).display;
  return (parent === "flex" || parent === "inline-flex") && (parseFloat(style.flexGrow) || 0) === 0;
}

/**
 * The row a control can take: the nearest ancestor whose width doesn't depend on its content (a wrapping toolbar
 * gives an item a line of its own, so that row's content width is the most it can get).
 */
function roomFor(box: HTMLElement): HTMLElement | null {
  let el = box.parentElement;
  while (el?.parentElement && isContentSized(el)) el = el.parentElement;
  return el;
}

/**
 * Whether a row of buttons still fits the row it sits in (Build 26.85). The buttons' natural width is read from the
 * visible group, or, while folded, from an inert hidden copy, so new counts never unfold the control to measure it.
 * Nothing is decided until both widths are known, so without layout (tests, a hidden tab) the buttons stay.
 */
function useFitsWidth(enabled: boolean, signature: string) {
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const [folded, setFolded] = useState(false);
  const check = useCallback(() => {
    const room = box.current && roomFor(box.current);
    if (!enabled || !room || !measure.current) return;
    const needed = measure.current.scrollWidth;
    const style = getComputedStyle(room);
    const available = room.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    if (needed <= 0 || available <= 0) return;
    const next = needed > available;
    setFolded(previous => {
      // Focus on the buttons, the dropdown or its open list moves to what replaces them, so a resize never drops it.
      const active = document.activeElement;
      if (previous !== next && (box.current?.contains(active) || active?.closest("[role=listbox]"))) refocus.current = true;
      return next;
    });
  }, [enabled]);
  useLayoutEffect(check, [check, folded, signature]);
  useEffect(() => {
    const room = box.current && roomFor(box.current);
    if (!enabled || !room || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => check());
    observer.observe(room);
    return () => observer.disconnect();
  }, [enabled, check]);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    box.current?.querySelector<HTMLElement>('[aria-pressed="true"], [role="combobox"], button:not([tabindex="-1"])')?.focus();
  }, [folded]);
  return { box, measure, folded: enabled && folded };
}

/**
 * A filter or view switch inside one screen (Table/Cards, All/Errors). Buttons
 * with aria-pressed, unlike Tabs, because they change the content in place
 * rather than switching panels. When the buttons no longer fit they become a
 * labelled dropdown (overflow="menu"); the caller owns the value, so the
 * selection survives every switch.
 */
export function SegmentedControl<V extends string>({ label, options, value, onValueChange, overflow = "menu", className }: SegmentedControlProps<V>) {
  const optionText = (o: SegmentOption<V>) => (o.count != null ? `${o.label} (${o.count})` : o.label);
  const fit = useFitsWidth(overflow === "menu", options.map(optionText).join("|"));
  const buttons = (inert: boolean) => options.map((o) => (
    <button
      key={o.value}
      type="button"
      className="ds-tab"
      data-state={o.value === value ? "active" : "inactive"}
      aria-pressed={inert ? undefined : o.value === value}
      tabIndex={inert ? -1 : undefined}
      disabled={o.disabled}
      onClick={inert ? undefined : () => onValueChange(o.value)}
    >
      {o.label}
      {o.count != null && <> <span className="ds-tab-count">{o.count}</span></>}
    </button>
  ));
  return (
    <div ref={fit.box} className={cx("ds-seg-fit", fit.folded && "is-folded")}>
      {fit.folded ? (
        <>
          <Select<V> label={label} size="sm" className={cx("ds-seg-select", className)} value={value} onValueChange={onValueChange}
            options={options.map(o => ({ value: o.value, label: optionText(o), disabled: o.disabled }))} />
          {/* Measures the buttons while they're folded away; hidden from every user and input. */}
          <div ref={fit.measure} className="ds-tabs ds-seg ds-seg-measure" aria-hidden="true" inert>{buttons(true)}</div>
        </>
      ) : (
        <div ref={fit.measure} role="group" aria-label={label} className={cx("ds-tabs", "ds-seg", className)}>{buttons(false)}</div>
      )}
    </div>
  );
}

/** Heading level of a titled design-system section in the page outline (the page title is the shell's h1). */
export type HeadingLevel = 2 | 3 | 4;

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
  /** ISO 4217 code of the account; sets the symbol. Prefer it over `symbol`. */
  currency?: string | null;
  className?: string;
}

export function Pnl({ value, percent, size = "m", compact = false, symbol: symbolProp = "$", currency, className }: PnlProps) {
  const sign = moneySign(value);
  const symbol = currency !== undefined ? currencySymbol(currency) : symbolProp;
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

/**
 * One tab's content. `keepMounted` keeps it in the page (hidden) while another tab is shown, so a
 * form inside keeps its unsaved state across tab switches. `heading` adds a visually hidden h2 (usually
 * the tab's label) when the panel's own sections use h3 titles, so the page outline doesn't skip a level.
 */
export function TabPanel({ value, children, className, keepMounted, heading }: { value: string; children: ReactNode; className?: string; keepMounted?: boolean; heading?: string }) {
  return (
    <RadixTabs.Content value={value} forceMount={keepMounted ? true : undefined} className={cx("ds-tab-panel", keepMounted && "ds-tab-panel-kept", className)}>
      {heading && <h2 className="ds-sr-only">{heading}</h2>}
      {children}
    </RadixTabs.Content>
  );
}
