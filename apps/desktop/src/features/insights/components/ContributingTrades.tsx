// The contributing-trades drawer (Build 23): exactly the trade ids behind the figure that was selected, with their
// totals recomputed by the same summarize() the figure used, so the list and the number always agree. Each row opens
// the trade in the Journal for its own attempt (?account=), never the header's active account.
import { summarize, type InsightsSelection, type InsightsTrade } from "@fundedflow/domain";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Badge, type DataColumn, DataTable, Drawer, EmptyState, formatInstant, InlineNotice, MoneyCell, StatList } from "../../../design-system";
import { SideBadge, STATUS_NOTE, tradePath } from "../../journal/components/presentation";
import { dayLabel, type Drill, moneyView, rateView, tradesText } from "../view-models/insights";

export function ContributingTradesDrawer({ drill, selection, onClose }: { drill: Drill | null; selection: InsightsSelection; onClose: () => void }) {
  return (
    <Drawer open={drill !== null} onOpenChange={open => { if (!open) onClose(); }} width={880}
      title={drill ? `Contributing trades: ${drill.title}` : "Contributing trades"}
      description={drill?.basis ?? "The exact closed trades behind this figure"}>
      {drill && <DrillBody drill={drill} selection={selection} />}
    </Drawer>
  );
}

function DrillBody({ drill, selection }: { drill: Drill; selection: InsightsSelection }) {
  const navigate = useNavigate();
  const location = useLocation();
  const byId = useMemo(() => new Map(selection.candidates.map(t => [t.id, t])), [selection]);
  const accounts = useMemo(() => new Map(selection.accounts.map(a => [a.id, a])), [selection]);
  const trades = drill.ids.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const missing = drill.ids.length - trades.length;
  const s = summarize(trades);
  // Amounts of one drill-down share a currency: a figure is never computed across currencies.
  const currency = trades[0] ? accounts.get(trades[0].accountId)?.currency ?? null : null;
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const open = (t: InsightsTrade) => navigate(tradePath(t.id, t.accountId), { state: { from: "insights", back: location.pathname + location.search } });

  const columns: DataColumn<InsightsTrade>[] = [
    { id: "day", header: "Trading day", cell: t => dayLabel(t.tradingDay), rowHeader: true },
    { id: "account", header: "Account", cell: t => accounts.get(t.accountId)?.name ?? t.accountId },
    { id: "symbol", header: "Symbol", cell: t => <span className="ds-sym">{t.symbol}</span> },
    { id: "side", header: "Side", cell: t => <SideBadge side={t.side} /> },
    { id: "exit", header: "Exit", cell: t => formatInstant(t.exitAt, { timeZone: accounts.get(t.accountId)?.timezone }) },
    { id: "gross", header: "Gross", align: "end", cell: t => <MoneyCell value={t.grossPnl} currency={currency} /> },
    { id: "fees", header: "Fees", align: "end", cell: t => <MoneyCell value={t.fees} currency={currency} signed={false} /> },
    { id: "net", header: "Net", align: "end", cell: t => <MoneyCell value={t.realizedPnl} currency={currency} /> },
    { id: "r", header: "R", align: "end", cell: t => (t.review?.rMultiple != null && t.review.plannedRisk != null ? `${t.review.rMultiple}R` : <span className="ds-faint">—</span>) },
    { id: "status", header: "P&L source", cell: t => (STATUS_NOTE[t.pnlStatus] ? <Badge tone={t.pnlStatus === "reported" ? "flow" : "warn"}>{STATUS_NOTE[t.pnlStatus]}</Badge> : <span className="ds-faint">Calculated</span>) },
  ];

  return (
    <div className="in-drill">
      <StatList label="Totals of these trades" bordered items={[
        { label: "Closed trades", value: { kind: "count", value: s.closed } },
        { label: "With a known P&L", value: { kind: "count", value: s.eligible } },
        ...(s.unknownPnl ? [{ label: "Unknown P&L (left out of sums)", value: { kind: "count" as const, value: s.unknownPnl } }] : []),
        { label: "Net P&L", value: moneyView(s.net, currency).value },
        { label: "Gross P&L", value: moneyView(s.gross, currency).value },
        { label: "Fees", value: moneyView(s.fees, currency, false).value },
        { label: "Win rate", value: rateView(s.winRate).value },
      ]} />
      <p className="ds-faint in-drill-prov">
        {tradesText(trades.length)} · selector {selection.version} · journal read {formatInstant(selection.dataAsOf, { timeZone: selection.accounts[0]?.timezone })} ·
        closed trades only; open and deleted trades are never included.
      </p>
      {missing > 0 && <InlineNotice tone="warning" title="Some trades are no longer in this selection">{tradesText(missing)} changed since this figure was drawn. Close and reopen it to refresh.</InlineNotice>}
      <DataTable label={`Contributing trades: ${drill.title}`} columns={columns} rows={trades.slice((page - 1) * pageSize, page * pageSize)} getRowId={t => t.id}
        onRowClick={open} isRowMuted={t => t.realizedPnl === null}
        pagination={trades.length > pageSize ? { page, pageSize, total: trades.length, onPageChange: setPage } : undefined}
        fallback={trades.length === 0 ? <EmptyState kind="no-records" title="No trades behind this figure" description="Nothing in the current selection contributes to it." /> : undefined} />
    </div>
  );
}
