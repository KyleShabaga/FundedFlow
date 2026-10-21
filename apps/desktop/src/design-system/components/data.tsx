// Data display: DataTable, MetricCard, LabeledValue, StatList, Stepper and
// MonthYearPicker. Values are rendered only as supplied: null is "—" with an
// accessible "Unknown", never zero. Sorting, filtering and paging are
// controlled by the caller; the table shows the affordances and reports
// requests.

import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type RefObject, useId, useRef, useState } from "react";

import { formatInstant, formatMoney, formatPercent, moneySign, sumMoney, UNKNOWN } from "../format";
import { cx } from "./cx";
import { Checkbox, Select } from "./forms";
import { OverlayClose, Popover } from "./overlays";
import { Button, type HeadingLevel, IconButton } from "./primitives";

/* ---------- Unknown ---------- */

/** "—" for an unknown value, read as "Unknown" by screen readers. */
export function UnknownValue({ label = "Unknown" }: { label?: string }) {
  return (
    <span className="ds-unknown" title={label}>
      <span aria-hidden="true">{UNKNOWN}</span>
      <span className="ds-sr-only">{label}</span>
    </span>
  );
}

/* ---------- MetricValue ---------- */

/** What a metric shows. Each kind formats its own type; there is no implicit conversion to zero. */
export type MetricValue =
  | { kind: "money"; amount: string | null; signed?: boolean; dp?: number; symbol?: string; /** ISO 4217 code; sets the symbol. */ currency?: string | null }
  | { kind: "percent"; value: number | null; dp?: number }
  | { kind: "count"; value: number | null; unit?: string }
  | { kind: "text"; text: string | null }
  | { kind: "unavailable"; reason: string };

/** Renders a MetricValue: money signed and toned, unknown as "—". */
export function MetricValueView({ value }: { value: MetricValue }) {
  switch (value.kind) {
    case "money": {
      if (value.amount == null) return <UnknownValue />;
      const signed = value.signed ?? true;
      return (
        <span className={cx("ds-mono", signed && `ds-text-${moneySign(value.amount)}`)}>
          {formatMoney(value.amount, { signed, dp: value.dp, symbol: value.symbol, currency: value.currency })}
        </span>
      );
    }
    case "percent":
      return value.value == null ? <UnknownValue /> : <span className="ds-mono">{formatPercent(value.value, value.dp)}</span>;
    case "count":
      return value.value == null ? (
        <UnknownValue />
      ) : (
        <span className="ds-mono">
          {value.value.toLocaleString("en-US")}
          {value.unit ? <span className="ds-metric-unit"> {value.unit}</span> : null}
        </span>
      );
    case "text":
      return value.text == null ? <UnknownValue /> : <span>{value.text}</span>;
    case "unavailable":
      return <UnknownValue label={`Unavailable: ${value.reason}`} />;
  }
}

/* ---------- MetricCard ---------- */

export interface MetricCardProps {
  label: string;
  value: MetricValue;
  /** One line that explains the number ("22 W · 14 L", "After $125.40 in fees"). */
  sub?: ReactNode;
  /** What it is calculated from ("Realized · this account · all time"). */
  basis?: ReactNode;
  /** When the value was calculated (ISO instant), shown in the account zone. */
  asOf?: string | null;
  timeZone?: string;
  /** Marks the value as not confirmed current. Shown as text, not only colour. */
  stale?: boolean;
  /** Detail action: "How is this calculated?" opening a Drawer. */
  action?: ReactNode;
  /** A WinGauge or Sparkline on the right. */
  children?: ReactNode;
  className?: string;
}

/**
 * A KPI tile with its basis and timestamp. Builds on StatTile's layout; use
 * StatTile for plain values without those. An unavailable value shows its
 * reason in place of the sub line.
 */
export function MetricCard({ label, value, sub, basis, asOf, timeZone, stale, action, children, className }: MetricCardProps) {
  return (
    <div className={cx("ds-card", "ds-tile", "ds-metric", stale && "is-stale", className)}>
      <div className="ds-tile-head">
        <span className="ds-label">{label}</span>
        {action != null && <span className="ds-metric-action">{action}</span>}
      </div>
      <div className="ds-tile-body">
        <div className="ds-metric-main">
          <div className="ds-tile-value">
            <MetricValueView value={value} />
          </div>
          {value.kind === "unavailable" ? <div className="ds-tile-sub">{value.reason}</div> : sub != null && <div className="ds-tile-sub">{sub}</div>}
        </div>
        {children != null && <div className="ds-tile-viz">{children}</div>}
      </div>
      {(basis != null || asOf !== undefined || stale) && (
        <div className="ds-metric-foot">
          {basis != null && <span>{basis}</span>}
          {asOf !== undefined && <span>As of {formatInstant(asOf, { timeZone })}</span>}
          {stale && <span className="ds-text-warn">Not current</span>}
        </div>
      )}
    </div>
  );
}

/* ---------- LabeledValue ---------- */

export interface LabeledValueProps {
  label: string;
  /** A MetricValue, or any node. null is unknown. */
  value: MetricValue | ReactNode | null;
  /** stacked: label over value. inline: side by side. */
  layout?: "stacked" | "inline";
  className?: string;
}

function isMetricValue(v: unknown): v is MetricValue {
  return typeof v === "object" && v != null && "kind" in v && typeof (v as { kind: unknown }).kind === "string" && !("$$typeof" in v);
}

/** One label and its value, for detail headers and summary rows. */
export function LabeledValue({ label, value, layout = "stacked", className }: LabeledValueProps) {
  return (
    <div className={cx("ds-lv", `ds-lv-${layout}`, className)}>
      <span className="ds-label">{label}</span>
      <span className="ds-lv-value">{value == null ? <UnknownValue /> : isMetricValue(value) ? <MetricValueView value={value} /> : value}</span>
    </div>
  );
}

/* ---------- StatList ---------- */

export interface StatItem {
  label: string;
  /** MetricValue for numbers (mono, signed money); a node for text; null for unknown. */
  value: MetricValue | ReactNode | null;
}

export interface StatListProps {
  items: readonly StatItem[];
  /** Accessible name when several lists share a view. */
  label?: string;
  /** Draw the bordered box (selected-day panel). */
  bordered?: boolean;
  className?: string;
}

/** Label and value rows as a description list (Reports, selected-day panel). */
export function StatList({ items, label, bordered, className }: StatListProps) {
  return (
    <dl className={cx("ds-stats", bordered && "is-bordered", className)} aria-label={label}>
      {items.map((it) => (
        <div key={it.label} className="ds-stats-row">
          <dt>{it.label}</dt>
          <dd className={cx(isMetricValue(it.value) && it.value.kind !== "text" && "ds-mono")}>
            {it.value == null ? <UnknownValue /> : isMetricValue(it.value) ? <MetricValueView value={it.value} /> : it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Stepper ---------- */

export interface StepperProps {
  /** Accessible name of the list ("Import steps"). */
  label: string;
  steps: readonly { label: string }[];
  /** Index of the current step (0-based). Steps before it are done. */
  current: number;
  className?: string;
}

/** Numbered steps: done (check), current (aria-current="step"), upcoming. Used by Import. */
export function Stepper({ label, steps, current, className }: StepperProps) {
  return (
    <ol aria-label={label} className={cx("ds-stepper", className)} style={{ ["--ds-steps" as string]: steps.length }}>
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={s.label} className={cx("ds-step", `is-${state}`)} aria-current={state === "current" ? "step" : undefined}>
            <span className="ds-step-mark" aria-hidden="true">
              {state === "done" ? <Check size={14} /> : i + 1}
            </span>
            <span className="ds-step-text">
              <span className="ds-faint">Step {i + 1}</span>
              <span className="ds-step-label">{s.label}</span>
              <span className="ds-sr-only">{state === "done" ? ", completed" : state === "current" ? ", current" : ", not started"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- DataTable ---------- */

export type SortDirection = "ascending" | "descending";
export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface DataColumn<T> {
  id: string;
  /** Header text. Also the accessible name of the sort button. */
  header: string;
  /** Hide the header text visually (actions column). */
  hideHeader?: boolean;
  cell: (row: T) => ReactNode;
  /** end: numbers, right-aligned in mono. */
  align?: "start" | "end";
  sortable?: boolean;
  /** First direction when this column becomes the sort. Default ascending (descending suits money and dates). */
  firstDirection?: SortDirection;
  /** CSS width ("44px", "20%"). */
  width?: string;
  /** Row header cell (the identifying column: account, symbol). One per table. */
  rowHeader?: boolean;
}

export interface DataTablePagination {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Total rows across pages, or null when unknown (the pager then shows only previous/next). */
  total: number | null;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;
}

export interface DataTableProps<T> {
  /** Accessible name of the table and its region. */
  label: string;
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  /** Names a row for its checkbox ("Select Apex $100K"). */
  getRowLabel?: (row: T) => string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** Controlled selection. Adds a checkbox column with select-all for the visible rows. */
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void };
  /** Left side of the toolbar: SearchField, SegmentedControl filters. */
  toolbar?: ReactNode;
  /** Right side of the toolbar: Columns menu, export. */
  actions?: ReactNode;
  /** Shown in the toolbar in place of `actions` while rows are selected. */
  bulkActions?: (selectedIds: string[]) => ReactNode;
  onRowClick?: (row: T) => void;
  /** Highlights a row (the one open in a detail panel). */
  activeRowId?: string | null;
  /** Dims a row (skipped import rows). */
  isRowMuted?: (row: T) => boolean;
  pagination?: DataTablePagination;
  /** Extra footer text, left ("1 archived"). */
  footer?: ReactNode;
  /**
   * Shown in place of the rows: a LoadingState, EmptyState or ErrorState.
   * Toolbar and headers stay so the layout does not jump.
   */
  fallback?: ReactNode;
  /** Marks the table busy (initial load or refresh). */
  busy?: boolean;
  /** Level of the table's (visually hidden) heading in the page outline. 2 when the table is a page's top-level section. */
  headingLevel?: HeadingLevel;
  className?: string;
}

function pageWindow(page: number, pages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * Card with toolbar, sticky header, sortable headers (aria-sort, one sort at a
 * time), row selection, numeric alignment and a pager. Scrolls sideways inside
 * the card when narrow. Clickable rows take focus and open with Enter.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  getRowId,
  getRowLabel,
  sort,
  onSortChange,
  selection,
  toolbar,
  actions,
  bulkActions,
  onRowClick,
  activeRowId,
  isRowMuted,
  pagination,
  footer,
  fallback,
  busy,
  headingLevel = 3,
  className,
}: DataTableProps<T>) {
  const Heading = `h${headingLevel}` as const;
  const ids = rows.map(getRowId);
  const selectedVisible = selection ? ids.filter((id) => selection.selected.has(id)) : [];
  const allSelected = ids.length > 0 && selectedVisible.length === ids.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;
  const selectedCount = selection?.selected.size ?? 0;
  const colCount = columns.length + (selection ? 1 : 0);
  const headingId = useId();

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    selection.onChange(next);
  };
  const toggleOne = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  const requestSort = (col: DataColumn<T>) => {
    if (!onSortChange) return;
    const direction: SortDirection =
      sort?.columnId === col.id ? (sort.direction === "ascending" ? "descending" : "ascending") : (col.firstDirection ?? "ascending");
    onSortChange({ columnId: col.id, direction });
  };
  const rowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row);
    }
  };

  const showToolbar = toolbar != null || actions != null || (selection && bulkActions);
  const pages = pagination && pagination.total != null ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : null;
  const first = pagination ? (pagination.page - 1) * pagination.pageSize + 1 : 1;
  const last = pagination ? first + rows.length - 1 : rows.length;

  return (
    <section className={cx("ds-dt-card", className)} aria-labelledby={headingId}>
      <Heading id={headingId} className="ds-sr-only">
        {label}
      </Heading>
      {showToolbar && (
        <div className="ds-dt-toolbar">
          <div className="ds-dt-tools">{toolbar}</div>
          <div className="ds-dt-tools">
            {selection && bulkActions && selectedCount > 0 ? (
              <>
                <span className="ds-dt-selcount" role="status">
                  {selectedCount} selected
                </span>
                {bulkActions(Array.from(selection.selected))}
              </>
            ) : (
              actions
            )}
          </div>
        </div>
      )}
      <div className="ds-dt-scroll" tabIndex={0} role="group" aria-label={`${label}, scrolls sideways`}>
        <table className="ds-dt" aria-label={label} aria-busy={busy || undefined} aria-rowcount={pagination?.total ?? undefined}>
          <thead>
            <tr>
              {selection && (
                <th scope="col" className="ds-dt-check">
                  <Checkbox label={`Select all ${label.toLowerCase()} on this page`} hideLabel checked={allSelected} indeterminate={someSelected} onChange={toggleAll} disabled={rows.length === 0} />
                </th>
              )}
              {columns.map((col) => {
                const sorted = sort?.columnId === col.id ? sort.direction : undefined;
                const SortIcon = sorted === "ascending" ? ArrowUp : sorted === "descending" ? ArrowDown : ChevronsUpDown;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cx(col.align === "end" && "num", sorted && "is-sorted")}
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={col.sortable ? (sorted ?? "none") : undefined}
                  >
                    {col.sortable && onSortChange ? (
                      <button type="button" className="ds-dt-sort" onClick={() => requestSort(col)}>
                        <span className={cx(col.hideHeader && "ds-sr-only")}>{col.header}</span>
                        <SortIcon size={14} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className={cx("ds-dt-th", col.hideHeader && "ds-sr-only")}>{col.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {fallback != null ? (
              <tr className="ds-dt-fallback">
                <td colSpan={colCount}>{fallback}</td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = getRowId(row);
                const checked = selection?.selected.has(id) ?? false;
                return (
                  <tr
                    key={id}
                    className={cx(onRowClick && "is-clickable", (checked || activeRowId === id) && "is-on", isRowMuted?.(row) && "is-muted")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => rowKey(e, row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-selected={selection ? checked : undefined}
                  >
                    {selection && (
                      <td className="ds-dt-check" onClick={(e) => e.stopPropagation()}>
                        <Checkbox label={`Select ${getRowLabel ? getRowLabel(row) : id}`} hideLabel checked={checked} onChange={() => toggleOne(id)} />
                      </td>
                    )}
                    {columns.map((col) =>
                      col.rowHeader ? (
                        <th key={col.id} scope="row" className={cx("ds-dt-rowhead", col.align === "end" && "num")}>
                          {col.cell(row)}
                        </th>
                      ) : (
                        <td key={col.id} className={cx(col.align === "end" && "num")}>
                          {col.cell(row)}
                        </td>
                      ),
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {(pagination || footer != null) && (
        <div className="ds-dt-foot">
          <span>
            {pagination && rows.length > 0 && fallback == null
              ? `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")}${pagination.total != null ? ` of ${pagination.total.toLocaleString("en-US")}` : ""}`
              : null}
            {pagination && rows.length > 0 && fallback == null && footer != null ? " · " : null}
            {footer}
          </span>
          {pagination && (
            <div className="ds-dt-pagectl">
              {pagination.onPageSizeChange && (
                <Select
                  label="Rows per page"
                  hideLabel
                  size="sm"
                  className="ds-dt-pagesize"
                  value={String(pagination.pageSize)}
                  onValueChange={(v) => pagination.onPageSizeChange!(Number(v))}
                  options={(pagination.pageSizeOptions ?? [10, 25, 50]).map((n) => ({ value: String(n), label: String(n) }))}
                />
              )}
              <nav className="ds-pager" aria-label={`${label} pages`}>
                <IconButton size="sm" label="Previous page" icon={<ChevronLeft size={14} aria-hidden="true" />} disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(pagination.page - 1)} />
                {pages != null &&
                  pageWindow(pagination.page, pages).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={cx("ds-pager-page", p === pagination.page && "is-on")}
                      aria-current={p === pagination.page ? "page" : undefined}
                      aria-label={`Page ${p}`}
                      onClick={() => pagination.onPageChange(p)}
                    >
                      {p}
                    </button>
                  ))}
                <IconButton
                  size="sm"
                  label="Next page"
                  icon={<ChevronRight size={14} aria-hidden="true" />}
                  disabled={pages != null ? pagination.page >= pages : rows.length < pagination.pageSize}
                  onClick={() => pagination.onPageChange(pagination.page + 1)}
                />
              </nav>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- MonthYearPicker ---------- */

export interface YearMonth {
  year: number;
  /** 1-12. */
  month: number;
}

export interface MonthSummary {
  /** Net P&L for the month as decimal text; null when any part is unknown. */
  pnl: string | null;
  trades: number;
}

export interface MonthYearPickerProps {
  value: YearMonth;
  onChange: (value: YearMonth) => void;
  /** The current month in the account's zone. Later months cannot be picked. */
  today: YearMonth;
  /** Keyed "YYYY-MM". Months missing here had no trades and are dimmed. */
  months: Readonly<Record<string, MonthSummary>>;
  /**
   * Year-to-date P&L per year, from Rust when available. Without it the
   * picker sums the supplied months for display; an unknown month makes the
   * year unknown.
   */
  yearPnl?: Readonly<Record<number, string | null>>;
  /** Earliest pickable year. Default: today's year minus 10. */
  minYear?: number;
  /** ISO 4217 code of the account. */
  currency?: string | null;
  className?: string;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const cmp = (a: YearMonth, b: YearMonth) => a.year * 12 + a.month - (b.year * 12 + b.month);
const shift = (v: YearMonth, by: number): YearMonth => {
  const n = v.year * 12 + (v.month - 1) + by;
  return { year: Math.floor(n / 12), month: (n % 12) + 1 };
};

/**
 * Month title with previous/next and Today, opening a popover with a year
 * stepper (year-to-date P&L) and twelve P&L-tinted months. The current month
 * is ringed, future months are disabled, months without trades are dimmed.
 * Arrow keys move between months.
 */
export function MonthYearPicker({ value, onChange, today, months, yearPnl, minYear, currency, className }: MonthYearPickerProps) {
  const lowest = minYear ?? today.year - 10;
  const grid = useRef<HTMLDivElement>(null);
  const atMax = cmp(value, today) >= 0;
  const atMin = cmp(value, { year: lowest, month: 1 }) <= 0;
  return (
    <div className={cx("ds-myp", className)}>
      <IconButton label="Previous month" icon={<ChevronLeft size={16} aria-hidden="true" />} disabled={atMin} onClick={() => onChange(shift(value, -1))} />
      <Popover
        label="Choose month and year"
        width={380}
        trigger={
          <button type="button" className="ds-myp-title">
            {MONTH_LONG[value.month - 1]} {value.year}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        }
      >
        <YearGrid value={value} onChange={onChange} today={today} months={months} yearPnl={yearPnl} lowest={lowest} grid={grid} currency={currency} />
      </Popover>
      <IconButton label="Next month" icon={<ChevronRight size={16} aria-hidden="true" />} disabled={atMax} onClick={() => onChange(shift(value, 1))} />
      <Button size="sm" onClick={() => onChange(today)} disabled={cmp(value, today) === 0}>
        Today
      </Button>
    </div>
  );
}

function YearGrid({ value, onChange, today, months, yearPnl, lowest, grid, currency }: Omit<MonthYearPickerProps, "minYear" | "className"> & { lowest: number; grid: RefObject<HTMLDivElement | null> }) {
  // The shown year is local to the popover; it starts at the picked month's year each time it opens.
  const [year, setYear] = useState(value.year);
  const ytd = yearPnl && year in yearPnl ? yearPnl[year] : sumYear(months, year);
  const moveFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
    if (delta == null) return;
    const buttons = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    for (let i = at + delta; i >= 0 && i < buttons.length; i += delta) {
      if (!buttons[i].disabled) {
        buttons[i].focus();
        return;
      }
    }
  };
  return (
    <div className="ds-myp-pop">
      <div className="ds-myp-year">
        <IconButton label="Previous year" icon={<ChevronLeft size={16} aria-hidden="true" />} disabled={year <= lowest} onClick={() => setYear(year - 1)} />
        <div className="ds-myp-yearval" aria-live="polite">
          <span className="ds-myp-yearnum">{year}</span>
          <span className="ds-mono ds-myp-ytd">
            {ytd == null ? <UnknownValue /> : <span className={`ds-text-${moneySign(ytd)}`}>{formatMoney(ytd, { dp: 0, currency })}</span>} <span className="ds-faint">YTD</span>
          </span>
        </div>
        <IconButton label="Next year" icon={<ChevronRight size={16} aria-hidden="true" />} disabled={year >= today.year} onClick={() => setYear(year + 1)} />
      </div>
      <div className="ds-myp-grid" ref={grid} onKeyDown={moveFocus} role="group" aria-label={`Months of ${year}`}>
        {MONTH_SHORT.map((name, i) => {
          const m = i + 1;
          const info = months[key(year, m)];
          const future = cmp({ year, month: m }, today) > 0;
          const on = value.year === year && value.month === m;
          const sign = info?.pnl != null ? moneySign(info.pnl) : null;
          const amount = info ? (info.pnl == null ? "unknown P&L" : formatMoney(info.pnl, { dp: 0, currency })) : "no trades";
          return (
            <OverlayClose asChild key={name}>
              <button
                type="button"
                className={cx("ds-myp-month", sign && `is-${sign}`, !info && "is-quiet", on && "is-on")}
                disabled={future}
                aria-pressed={on}
                aria-label={`${MONTH_LONG[i]} ${year}, ${amount}${future ? ", not yet" : ""}`}
                onClick={() => onChange({ year, month: m })}
              >
                <span className="ds-myp-mname">{name}</span>
                <span className="ds-mono ds-myp-mpnl">{info ? info.pnl == null ? UNKNOWN : formatMoney(info.pnl, { dp: 0, currency }) : UNKNOWN}</span>
              </button>
            </OverlayClose>
          );
        })}
      </div>
      <p className="ds-faint ds-myp-note">Months without trades are dimmed; future months can't be picked.</p>
    </div>
  );
}

function sumYear(months: Readonly<Record<string, MonthSummary>>, year: number): string | null | undefined {
  const inYear = Object.keys(months).filter((k) => k.startsWith(`${year}-`));
  if (inYear.length === 0) return undefined;
  return sumMoney(inYear.map((k) => months[k].pnl));
}

/* ---------- formatting helpers re-exported for cells ---------- */

/** Money cell for DataTable: signed, toned, unknown as "—". */
export function MoneyCell({ value, signed = true, currency }: { value: string | null; signed?: boolean; /** ISO 4217 code of the row's account. */ currency?: string | null }) {
  return <MetricValueView value={{ kind: "money", amount: value, signed, currency }} />;
}
