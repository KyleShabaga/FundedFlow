// Shared Insights pieces: the props every section receives, the drill-down button every figure is wrapped in, and the
// table of groups (periods, weekdays, symbols, strategies, tags) whose every row opens its contributing trades.
import {
  basisAmount,
  type Group,
  type InsightsBasis,
  type InsightsSelection,
  type Summary,
} from "@fundedflow/domain";
import { type ReactNode, useState } from "react";

import { compareMoney, type DataColumn, DataTable, MetricValueView, type SortState } from "../../../design-system";
import { type Drill, type InsightsState, moneyView, rateView, tradesText } from "../view-models/insights";

export interface SectionProps {
  selection: InsightsSelection;
  /** Summary of the whole included-trade set (one currency). */
  summary: Summary;
  basis: InsightsBasis;
  currency: string | null;
  state: InsightsState;
  update: (patch: Partial<InsightsState>) => void;
  drill: (d: Drill) => void;
}

export const BASIS_LABEL: Record<InsightsBasis, string> = { net: "Net P&L", gross: "Gross P&L" };

/**
 * A figure that opens its contributing trades. With no trades it is plain text: there is nothing to open.
 */
export function DrillButton({ ids, title, basis, drill, children, label }: {
  ids: readonly string[]; title: string; basis?: string; drill: (d: Drill) => void; children: ReactNode; label?: string;
}) {
  if (ids.length === 0) return <span>{children}</span>;
  return (
    <button type="button" className="in-drill-btn" aria-label={label ?? `${title}: view the ${tradesText(ids.length)} behind it`}
      onClick={() => drill({ title, basis, ids })}>
      {children}
    </button>
  );
}

/** A metric's value with its reason (N/A, insufficient, unknown) beside it in small text. */
export function MetricText({ view }: { view: ReturnType<typeof moneyView> }) {
  return (
    <span className="in-metric">
      <MetricValueView value={view.value} />
      {view.reason && <span className="ds-faint in-metric-reason">{view.reason}</span>}
    </span>
  );
}

/** "+$1.2K · 12 trades · 58.3% win", the detail line under a bar or cell. */
export function groupDetail(s: Summary): string {
  const parts = [tradesText(s.closed)];
  if (s.winRate.state === "value") parts.push(`${s.winRate.value.percent}% win`);
  if (s.unknownPnl) parts.push(`${s.unknownPnl} unknown P&L`);
  return parts.join(" · ");
}

/** The basis amount of a group for a bar: null only when no trade in it has a known result. */
export const barValue = (s: Summary, basis: InsightsBasis) => {
  const m = basisAmount(s, basis);
  return m.state === "value" ? m.value : null;
};

export function GroupTable({ label, groups, basis, currency, drill, nameHeader, drillBasis, note }: {
  label: string; groups: readonly Group[]; basis: InsightsBasis; currency: string | null; drill: (d: Drill) => void;
  nameHeader: string; drillBasis: string; note?: ReactNode;
}) {
  const [sort, setSort] = useState<SortState | null>(null);
  const amount = (g: Group) => barValue(g.summary, basis);
  const rows = [...groups];
  if (sort) {
    const dir = sort.direction === "ascending" ? 1 : -1;
    rows.sort((a, b) =>
      sort.columnId === "pnl" ? compareMoney(amount(a), amount(b), sort.direction)
        : sort.columnId === "trades" ? dir * (a.summary.closed - b.summary.closed)
          : dir * a.label.localeCompare(b.label));
  }
  const columns: DataColumn<Group>[] = [
    { id: "name", header: nameHeader, cell: g => g.label, rowHeader: true, sortable: true },
    { id: "trades", header: "Trades", align: "end", cell: g => g.summary.closed, sortable: true, firstDirection: "descending" },
    { id: "known", header: "Known P&L", align: "end", cell: g => (g.summary.unknownPnl ? `${g.summary.eligible} of ${g.summary.closed}` : g.summary.eligible) },
    { id: "win", header: "Win rate", align: "end", cell: g => <MetricText view={rateView(g.summary.winRate)} /> },
    { id: "avg", header: "Avg trade", align: "end", cell: g => <MetricText view={moneyView(basis === "net" ? g.summary.expectancy : g.summary.expectancyGross, currency)} /> },
    { id: "pnl", header: BASIS_LABEL[basis], align: "end", cell: g => <MetricText view={moneyView(basisAmount(g.summary, basis), currency)} />, sortable: true, firstDirection: "descending" },
  ];
  return (
    <div className="in-group-table">
      {note && <p className="ds-faint in-note">{note}</p>}
      <DataTable label={label} columns={columns} rows={rows} getRowId={g => g.key} sort={sort} onSortChange={setSort}
        onRowClick={g => drill({ title: `${label}: ${g.label}`, basis: drillBasis, ids: g.summary.tradeIds })} />
    </div>
  );
}
