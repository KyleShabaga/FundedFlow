// Trade log (Build 20): every trade of the account in one sortable, filterable, paged table, with basic KPIs for the
// rows shown. Search covers symbol, notes, strategy and tags. Deleted trades can be listed and restored here.
import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Button,
  DataTable,
  Drawer,
  EmptyState,
  formatInstant,
  formatMoney,
  formatPercent,
  MoneyCell,
  Pnl,
  Popover,
  SearchField,
  SegmentedControl,
  Select,
  type SortState,
  StateBoundary,
  StatTile,
  TextField,
  useToast,
} from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useLibrary } from "../../library/hooks/library";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useDeletedTrades, useRestoreTrade } from "../../trades/hooks/trades";
import { shownNetPnl, type TradeViewModel } from "../../trades/view-models/trade";
import { tradeColumns, UnknownNote } from "./ByDayView";
import { filterRows, isFiltered, NO_FILTERS, page, sortRows, stats, type JournalFilters, type JournalRow, type ResultFilter, type SortColumn } from "./journal-model";
import { FeesNotRecordedBadge, SideBadge, zoneLabel } from "./presentation";

const RESULTS: { value: ResultFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "win", label: "Wins" }, { value: "loss", label: "Losses" },
  { value: "breakeven", label: "Breakeven" }, { value: "open", label: "Open" }, { value: "unknown", label: "Unknown P&L" },
];
const ANY = "__any";

export function TradeLogView({ rows, account, onOpen }: { rows: readonly JournalRow[]; account: AccountViewModel; onOpen: (t: TradeViewModel) => void }) {
  const [filters, setFilters] = useState<JournalFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SortState>({ columnId: "entryAt", direction: "descending" });
  const [pageNumber, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const library = useLibrary();
  const set = <K extends keyof JournalFilters>(key: K, value: JournalFilters[K]) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); };

  const visible = useMemo(() => sortRows(filterRows(rows, filters), sort.columnId as SortColumn, sort.direction), [rows, filters, sort]);
  const counts = useMemo(() => Object.fromEntries(RESULTS.map(r => [r.value, filterRows(rows, { ...filters, result: r.value }).length])), [rows, filters]);
  const s = stats(visible);
  const pages = page(visible, pageNumber, size);
  const filtered = isFiltered(filters);
  const extraFilters = [filters.side !== "all", filters.source !== "all", filters.reviewed !== "all", !!filters.strategyId, !!filters.tagId, !!filters.from, !!filters.to].filter(Boolean).length;
  const strategies = library.data?.strategies ?? [];
  const tags = library.data?.tags ?? [];
  const money = (v: string | null) => (v == null ? null : formatMoney(v, { currency: account.currency }));

  return (
    <div className="jr-log">
      <div className="jr-kpis">
        <StatTile label="Net P&L" value={<Pnl value={s.net} size="m" currency={account.currency} />} sub={`${s.known} closed ${s.known === 1 ? "trade" : "trades"} with a known P&L`} />
        <StatTile label="Win rate" value={s.winRate == null ? "—" : formatPercent(s.winRate, 1).replace("+", "")} sub={`${s.winners} W · ${s.losers} L · ${s.breakeven} BE`} />
        <StatTile label="Profit factor" value={s.profitFactor == null ? "—" : s.profitFactor.toFixed(2)} sub={s.profitFactor == null ? "Needs at least one losing trade" : "Sum of wins ÷ sum of losses"} />
        <StatTile label="Average win / loss" value={<span className="jr-avg"><MoneyCell value={s.averageWin} currency={account.currency} /> / <MoneyCell value={s.averageLoss} currency={account.currency} /></span>} sub="Net, after fees" />
      </div>
      <UnknownNote rows={visible} />
      <DataTable
        label="Trade log"
        columns={tradeColumns(account)}
        rows={pages}
        getRowId={r => r.trade.id}
        sort={sort}
        onSortChange={next => { setSort(next); setPage(1); }}
        onRowClick={r => onOpen(r.trade)}
        isRowMuted={r => r.trade.pnlStatus === "open"}
        toolbar={
          <>
            <SearchField label="Search trades" value={filters.search} onValueChange={v => set("search", v)} placeholder="Symbol, tag, strategy or note" />
            <SegmentedControl<ResultFilter> label="Result" value={filters.result} onValueChange={v => set("result", v)}
              options={RESULTS.map(r => ({ ...r, count: counts[r.value] }))} />
          </>
        }
        actions={
          <>
            <Popover label="More filters" width={320}
              trigger={<Button size="sm" icon={<SlidersHorizontal size={14} aria-hidden="true" />}>Filters{extraFilters ? ` (${extraFilters})` : ""}</Button>}>
              <div className="jr-filter-pop">
                <Select size="sm" label="Side" value={filters.side} onValueChange={v => set("side", v)} options={[{ value: "all", label: "Long and short" }, { value: "long", label: "Long" }, { value: "short", label: "Short" }]} />
                <Select size="sm" label="Source" value={filters.source} onValueChange={v => set("source", v)} options={[{ value: "all", label: "Imported and manual" }, { value: "csv_import", label: "Imported" }, { value: "manual", label: "Manual" }]} />
                <Select size="sm" label="Review" value={filters.reviewed} onValueChange={v => set("reviewed", v)} options={[{ value: "all", label: "Any" }, { value: "reviewed", label: "Reviewed" }, { value: "not-reviewed", label: "Not reviewed" }]} />
                <Select size="sm" label="Strategy" value={filters.strategyId ?? ANY} onValueChange={v => set("strategyId", v === ANY ? null : v)}
                  options={[{ value: ANY, label: "Any strategy" }, ...strategies.map(x => ({ value: x.id, label: x.archived ? `${x.name} (archived)` : x.name }))]} />
                <Select size="sm" label="Tag" value={filters.tagId ?? ANY} onValueChange={v => set("tagId", v === ANY ? null : v)}
                  options={[{ value: ANY, label: "Any tag" }, ...tags.map(x => ({ value: x.id, label: `${x.name} · ${x.kind}${x.archived ? " (archived)" : ""}` }))]} />
                <div className="jr-form-row">
                  <TextField type="date" label="From day" value={filters.from ?? ""} onChange={e => set("from", e.target.value || null)} />
                  <TextField type="date" label="To day" value={filters.to ?? ""} onChange={e => set("to", e.target.value || null)} />
                </div>
              </div>
            </Popover>
            {filtered && <Button size="sm" variant="ghost" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear filters</Button>}
          </>
        }
        fallback={visible.length === 0 ? (
          <EmptyState kind="no-matches" size="compact" description="No trades match these filters."
            action={<Button size="sm" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear filters</Button>} />
        ) : undefined}
        pagination={{ page: pageNumber, pageSize: size, total: visible.length, onPageChange: setPage, pageSizeOptions: [10, 25, 50, 100], onPageSizeChange: n => { setSize(n); setPage(1); } }}
        footer={
          <span className="jr-log-foot">
            Times in {zoneLabel(account.timezone)}.{" "}
            <button type="button" className="jr-link" onClick={() => setDeletedOpen(true)}>Deleted trades</button>
          </span>
        }
      />
      {money(s.net) === null && s.trades > 0 && <p className="ds-faint jr-note">No closed trade here has a known P&amp;L, so no totals are shown.</p>}
      {deletedOpen && <DeletedTrades account={account} onClose={() => setDeletedOpen(false)} />}
    </div>
  );
}

function DeletedTrades({ account, onClose }: { account: AccountViewModel; onClose: () => void }) {
  const deleted = useDeletedTrades(account.id);
  const restore = useRestoreTrade(account.id);
  const toast = useToast();
  const readOnly = account.archivedAt !== null;
  return (
    <Drawer open onOpenChange={o => !o && onClose()} title="Deleted trades" width={640}
      description="Deleted trades are kept with their review and screenshots. Restoring brings one back exactly as it was. Re-importing a deleted trade's CSV row also restores it.">
      <StateBoundary state={toAsyncState(deleted)} label="deleted trades" onRetry={retryRead(deleted.refresh)}
        empty={{ "no-records": <EmptyState kind="no-records" size="compact" title="No deleted trades" description="Trades you delete appear here." /> }}>
        {list => (
          <ul className="jr-deleted">
            {list.map(d => (
              <li key={d.trade.id} className="jr-deleted-row">
                <span className="ds-sym">{d.trade.symbol}</span>
                <SideBadge side={d.trade.side} />
                <span className="ds-faint">{d.trade.tradingDay}</span>
                <MoneyCell value={shownNetPnl(d.trade)} currency={d.trade.currency} />
                <FeesNotRecordedBadge trade={d.trade} />
                <span className="ds-faint">Deleted {formatInstant(d.deletedAt, { timeZone: account.timezone })}</span>
                <Button size="sm" loading={restore.isPending} disabled={readOnly || !restore.canSubmit} disabledReason={readOnly ? "Archived accounts are read-only" : undefined}
                  onClick={() => restore.submit(d.trade.id).then(
                    t => toast.show({ tone: "success", title: `${t.symbol} trade restored` }),
                    error => toast.show((error as { category?: string } | null)?.category === "uncertain-outcome"
                      ? { tone: "warning", title: "The trade may have been restored", description: "No answer came back. Check the deleted trades list; the result is reviewed when you next add or edit a trade in this account, and nothing is sent again until then." }
                      : { tone: "error", title: "The trade wasn't restored", description: "Check the list and try again." }),
                  )}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </StateBoundary>
    </Drawer>
  );
}
