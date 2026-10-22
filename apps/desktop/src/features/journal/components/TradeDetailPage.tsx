// Trade detail (Build 20): the stored round trip, exact gross/fees/net and how the P&L was found, import provenance
// with the original CSV cells and source fills (read only), correction history, previous/next trade, and the review
// with screenshots. There is no price chart: FundedFlow has no market data in V1 (candles are Builds 42–43), and a
// round trip is not an execution record, so nothing is reconstructed or drawn from invented prices.
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  formatInstant,
  formatMoney,
  LoadingState,
  Pnl,
  Skeleton,
  StateBoundary,
  StatList,
  TextField,
  UNKNOWN,
  useToast,
  zonedDay,
} from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useGuardedNavigate } from "../../shared/hooks/use-leave-guard";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useRemoveTrade, useRestoreTrade, useTradeRecord } from "../../trades/hooks/trades";
import type { TradeRecordView } from "../../trades/api/trades";
import { holdTime } from "./journal-model";
import { clock, JournalAccountGate, longDay, tradePath, ResultBadge, SideBadge, SourceBadge, STATUS_EXPLANATION, zoneLabel } from "./presentation";
import { ReviewCard } from "./ReviewCard";
import { TradeFormDialog } from "./TradeFormDialog";
import "./journal.css";

export function TradeDetailPage() {
  const { tradeId = "" } = useParams();
  const [params] = useSearchParams();
  const accountId = params.get("account");
  // ?account= names the attempt explicitly (Insights drill-downs across attempts); otherwise the active account.
  if (accountId) return <NamedAccountTrade accountId={accountId} tradeId={tradeId} />;
  return <JournalAccountGate>{account => <AccountTrade key={account.id} account={account} tradeId={tradeId} />}</JournalAccountGate>;
}

function NamedAccountTrade({ accountId, tradeId }: { accountId: string; tradeId: string }) {
  const { state, accounts } = useActiveAccount();
  if (state.kind === "loading") return <LoadingState label="Loading accounts" layout="lines" rows={4} />;
  if (state.kind === "error") return <ErrorState scope="route" title="Accounts couldn't be loaded" message="The trade needs to know which account it belongs to. Use the recovery controls, then try again." />;
  const account = (accounts ?? []).find(a => a.id === accountId);
  if (!account) {
    return (
      <div className="jr-page">
        <div className="ds-card">
          <EmptyState kind="no-matches" title="This account isn't in the journal" description="It may have been deleted. Nothing was changed." />
        </div>
      </div>
    );
  }
  return <AccountTrade key={account.id} account={account} tradeId={tradeId} named />;
}

const PNL_SOURCE: Record<string, string> = {
  calculated: "Calculated from prices × quantity × point value",
  reported: "Broker-reported (point value unknown)",
  open: "Open: no P&L yet",
  missing_instrument: "Unknown: no point value or broker P&L",
  currency_mismatch: "Unknown: instrument in another currency",
};
const CORRECTION_LABEL = { edit: "Corrected", delete: "Deleted", restore: "Restored", import_restore: "Restored by a re-import" } as const;
const FIELD_LABEL: Record<string, string> = {
  symbol: "Symbol", side: "Side", quantity: "Quantity", entryAt: "Entry time", entryPrice: "Entry price", exitAt: "Exit time",
  exitPrice: "Exit price", fees: "Fees", tradingDay: "Trading day", reportedPnl: "Broker P&L", grossPnl: "Gross P&L",
  realizedPnl: "Net P&L", pnlStatus: "P&L source", notes: "Notes",
};

// The page stays mounted across previous/next (keyed on the account only), so the back link and layout never blank
// out. The record query is keyed per trade: an uncached trade reads as loading (never the previous trade's values),
// and a late response for a trade no longer shown only fills its own cache entry.
function AccountTrade({ account, tradeId, named = false }: { account: AccountViewModel; tradeId: string; named?: boolean }) {
  const record = useTradeRecord(account.id, tradeId);
  const location = useLocation();
  const back = (location.state as { from?: string; back?: string } | null)?.from === "insights" ? (location.state as { back?: string }).back ?? "/insights" : null;
  return (
    <div className="jr-page">
      {back
        ? <Link to={back} className="jr-back"><ArrowLeft size={16} aria-hidden="true" />Back to Insights</Link>
        : <Link to="/journal?view=log" className="jr-back"><ArrowLeft size={16} aria-hidden="true" />Journal</Link>}
      {named && <p className="jr-sub">Trade of <strong>{account.name}</strong>{account.archivedAt ? " (archived, read-only)" : ""}</p>}
      {record.error?.category === "not-found" && record.data === undefined ? (
        <div className="ds-card">
          <EmptyState kind="no-matches" title={named ? "This trade isn't in this account" : "This trade isn't in the selected account"}
            description="It may have been deleted, or it belongs to another account. Trades are never matched across accounts." />
        </div>
      ) : (
        <StateBoundary state={toAsyncState(record)} label="trade" scope="route" onRetry={retryRead(record.refresh)}
          loading={<TradeLoading />}>
          {r => <TradeView key={r.trade.id} account={account} record={r} named={named} />}
        </StateBoundary>
      )}
    </div>
  );
}

// Stands in for TradeView with the same header, actions and two columns, so the page keeps its shape while the next
// trade loads. Nothing in it belongs to a trade: no symbol, position or P&L until the record arrives.
function TradeLoading() {
  return (
    <article className="jr-detail" aria-busy="true" aria-label="Loading the trade">
      <header className="jr-detail-head">
        <Skeleton width={240} height={14} />
        <div className="jr-detail-title"><Skeleton width={180} height={28} /></div>
        {/* Placeholders that hold the actions' place; hidden from assistive tech, which hears the loading status. */}
        <div className="jr-detail-actions" aria-hidden="true">
          <Button size="sm" icon={<ChevronLeft size={14} aria-hidden="true" />} disabled>Previous trade</Button>
          <Button size="sm" icon={<ChevronRight size={14} aria-hidden="true" />} disabled>Next trade</Button>
          <Button size="sm" icon={<Pencil size={14} aria-hidden="true" />} disabled>Correct trade</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} disabled>Delete</Button>
        </div>
      </header>
      <div className="jr-detail-grid">
        <div className="jr-detail-main"><div className="ds-card"><LoadingState label="Loading the trade" layout="panel" /></div></div>
        <div className="jr-detail-side"><div className="ds-card jr-section">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} width={i === 7 ? "60%" : "100%"} />)}
        </div></div>
      </div>
    </article>
  );
}

function TradeView({ account, record, named = false }: { account: AccountViewModel; record: TradeRecordView; named?: boolean }) {
  const navigate = useNavigate();
  // Previous/Next ask first while the review has unsaved edits, as links do.
  const go = useGuardedNavigate();
  const toast = useToast();
  const t = record.trade;
  const tz = account.timezone;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const remove = useRemoveTrade(account.id, t.id);
  const restore = useRestoreTrade(account.id);
  const readOnly = account.archivedAt !== null;
  const at = (instant: string | null) => (instant ? `${zonedDay(instant, tz)} ${clock(instant, tz)}` : UNKNOWN);
  const money = (v: string | null, signed = true) => (v == null ? null : formatMoney(v, { currency: t.currency, signed }));

  return (
    <article className="jr-detail" aria-labelledby="jr-trade-title">
      <header className="jr-detail-head">
        <nav aria-label="Breadcrumb" className="jr-crumbs">
          <Link to="/journal">Journal</Link> / <span>{longDay(t.tradingDay)}</span> / <span aria-current="page">Trade {record.position} of {record.total}</span>
        </nav>
        <div className="jr-detail-title">
          <h2 id="jr-trade-title" className="ds-sym">{t.symbol}</h2>
          <SideBadge side={t.side} />
          <ResultBadge trade={t} />
          <SourceBadge trade={t} />
          <Pnl value={t.realizedPnl} size="xl" currency={t.currency} />
        </div>
        <div className="jr-detail-actions">
          <Button size="sm" icon={<ChevronLeft size={14} aria-hidden="true" />} disabled={!record.previousTradeId}
            onClick={() => record.previousTradeId && go(tradePath(record.previousTradeId, named ? account.id : undefined))}>Previous trade</Button>
          <Button size="sm" icon={<ChevronRight size={14} aria-hidden="true" />} disabled={!record.nextTradeId}
            onClick={() => record.nextTradeId && go(tradePath(record.nextTradeId, named ? account.id : undefined))}>Next trade</Button>
          <Button size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing(true)} disabled={readOnly} disabledReason={readOnly ? "Archived accounts are read-only" : undefined}>Correct trade</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setDeleting(true)} disabled={readOnly} disabledReason={readOnly ? "Archived accounts are read-only" : undefined}>Delete</Button>
        </div>
      </header>

      <div className="jr-detail-grid">
        <div className="jr-detail-main">
          <ReviewCard key={`${account.id}:${t.id}`} account={account} trade={t} />
        </div>
        <aside className="jr-detail-side" aria-label="Trade facts">
          <section className="ds-card jr-section" aria-labelledby="jr-summary">
            <h3 id="jr-summary">Summary</h3>
            <StatList label="Trade summary" items={[
              { label: "Account", value: account.name },
              { label: "Trading day", value: `${t.tradingDay} (${longDay(t.tradingDay)})` },
              { label: "Quantity", value: t.quantity },
              { label: "Entry", value: `${t.entryPrice} at ${at(t.entryAt)}` },
              { label: "Exit", value: t.exitPrice ? `${t.exitPrice} at ${at(t.exitAt)}` : "Open" },
              { label: "Hold", value: holdTime(t) },
              { label: "Gross P&L", value: money(t.grossPnl) },
              { label: "Fees", value: money(t.fees, false) },
              { label: "Net P&L", value: money(t.realizedPnl) },
              { label: "P&L source", value: PNL_SOURCE[t.pnlStatus] },
              ...(t.reportedPnl != null && t.pnlStatus !== "reported" ? [{ label: "Broker P&L (as given)", value: money(t.reportedPnl) }] : []),
            ]} />
            <p className="ds-faint jr-note">{STATUS_EXPLANATION[t.pnlStatus]} Times are in {zoneLabel(tz)}.</p>
            {t.notes && <p className="jr-trade-notes"><span className="ds-label">Trade notes</span>{t.notes}</p>}
          </section>

          {record.importSource && (
            <section className="ds-card jr-section" aria-labelledby="jr-source">
              <h3 id="jr-source">Import source</h3>
              <StatList label="Import source" items={[
                { label: "File", value: record.importSource.fileName },
                { label: "Imported", value: formatInstant(record.importSource.importedAt, { timeZone: tz, year: true, zoneName: true }) },
                { label: "Format", value: record.importSource.sourceFormat === "performance" ? "Performance (paired fills)" : "Generic trade CSV" },
                { label: "Line in file", value: record.importSource.lineNumber == null ? null : String(record.importSource.lineNumber) },
                { label: "File times read in", value: record.importSource.sourceTimezone },
              ]} />
              {record.importSource.rawCells && (
                <details className="jr-raw">
                  <summary>Original CSV row (unchanged)</summary>
                  <dl className="ds-stats">
                    {record.importSource.rawCells.map((cell, i) => (
                      <div key={i} className="ds-stats-row"><dt>{record.importSource!.headers[i] ?? `Column ${i + 1}`}</dt><dd className="ds-mono">{cell === "" ? <span className="ds-faint">empty</span> : cell}</dd></div>
                    ))}
                  </dl>
                </details>
              )}
            </section>
          )}

          {t.roundTrip && (
            <section className="ds-card jr-section" aria-labelledby="jr-fills">
              <h3 id="jr-fills">Source fills</h3>
              <p className="ds-faint jr-note">The buy and sell fill this round trip was made from, exactly as exported. Read only; FundedFlow does not rebuild trades from executions.</p>
              <StatList label="Source fills" items={[
                { label: "Opened by", value: t.roundTrip.entryBasis === "sell_first" ? "Sell fill (short)" : t.roundTrip.entryBasis === "buy_first" ? "Buy fill (long)" : "Both fills at the same second (taken as long)" },
                { label: "Buy fill", value: `${t.roundTrip.buyPrice} · ${t.roundTrip.boughtAtSource}${t.roundTrip.buyFillId ? ` · id ${t.roundTrip.buyFillId}` : ""}` },
                { label: "Sell fill", value: `${t.roundTrip.sellPrice} · ${t.roundTrip.soldAtSource}${t.roundTrip.sellFillId ? ` · id ${t.roundTrip.sellFillId}` : ""}` },
                { label: "Duration (export)", value: t.roundTrip.durationSource },
                { label: "Tick size", value: t.roundTrip.tickSize },
                { label: "Price format", value: t.roundTrip.priceFormat == null ? null : `${t.roundTrip.priceFormat}${t.roundTrip.priceFormatType ? ` (type ${t.roundTrip.priceFormatType})` : ""}` },
              ]} />
            </section>
          )}

          <section className="ds-card jr-section" aria-labelledby="jr-history">
            <h3 id="jr-history">Correction history</h3>
            {record.corrections.length === 0 ? (
              <p className="ds-faint">{t.source === "manual" ? "Entered by hand; not corrected since." : "As imported; not corrected since."}</p>
            ) : (
              <ol className="jr-history">
                {record.corrections.map(c => (
                  <li key={c.id}>
                    <span className="jr-history-head">
                      <Badge tone={c.kind === "delete" ? "warn" : "neutral"}>{CORRECTION_LABEL[c.kind]}</Badge>
                      <span className="ds-faint">{formatInstant(c.correctedAt, { timeZone: tz, year: true })}</span>
                    </span>
                    {c.reason && <span>“{c.reason}”</span>}
                    {c.changedFields.length > 0 && (
                      <ul className="jr-history-changes">
                        {c.changedFields.map(f => (
                          <li key={f}><span className="ds-label">{FIELD_LABEL[f] ?? f}</span> <span className="ds-mono">{show(c.before?.[f])} → {show(c.after?.[f])}</span></li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      <TradeFormDialog account={account} trade={t} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog open={deleting} onOpenChange={o => { setDeleting(o); if (!o) setReason(""); }} title={`Delete this ${t.symbol} trade?`} confirmLabel="Delete trade" busyLabel="Deleting…"
        onConfirm={async () => {
          await remove.submit(reason.trim() || null);
          setDeleting(false);
          navigate("/journal?view=log");
          toast.show({
            tone: "success", title: `${t.symbol} trade deleted`, description: "Its review and screenshots are kept.",
            action: { label: "Undo", onClick: () => void restore.submit(t.id).then(() => navigate(tradePath(t.id)), () => toast.show({ tone: "error", title: "The trade wasn't restored" })) },
          });
        }}>
        <p>It leaves the journal, its day totals and risk figures. Its review, checklist answers and screenshots are kept, and it can be restored from Deleted trades in the trade log{t.source === "csv_import" ? " or by re-importing its CSV row" : ""}.</p>
        <TextField label="Reason" optional value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder="Entered twice" />
      </ConfirmDialog>
    </article>
  );
}

function show(v: unknown): string {
  return v == null || v === "" ? UNKNOWN : String(v);
}
