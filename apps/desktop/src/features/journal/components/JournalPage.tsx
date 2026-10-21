// The Journal (Build 20): the selected account's trades by trading day and as a trade log, and the Library sub-view.
// Trades come from list_trades (Rust-stored values) joined with their review summaries; day groups use the stored
// trading day. Manual trade entry lives here. Each day's daily review (Build 22) opens from By day and the Library;
// aggregate analytics are Build 23.
import { Plus, Upload } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button, EmptyState, InlineNotice, LoadingState, StateBoundary, TabPanel, Tabs } from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useDailyReviewIndex } from "../../daily-reviews/hooks/daily-reviews";
import { useReviewSummaries } from "../../reviews/hooks/reviews";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useTrades } from "../../trades/hooks/trades";
import { ByDayView } from "./ByDayView";
import { joinRows } from "./journal-model";
import { LibraryView } from "./LibraryView";
import { dailyReviewPath } from "../../daily-reviews/view-models/daily-review";
import { JournalAccountGate, tradePath, zoneLabel } from "./presentation";
import { TradeFormDialog } from "./TradeFormDialog";
import { TradeLogView } from "./TradeLogView";
import "./journal.css";

const VIEWS = ["day", "log", "library"] as const;
type View = (typeof VIEWS)[number];

export function JournalPage() {
  // The account is part of the key: switching accounts remounts the views, so no filter, draft or selection of the
  // previous account carries over.
  return <JournalAccountGate>{account => <AccountJournal key={account.id} account={account} />}</JournalAccountGate>;
}

function AccountJournal({ account }: { account: AccountViewModel }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get("view") ?? "") ? (params.get("view") as View) : "day";
  const setView = (v: string) => setParams(p => { const next = new URLSearchParams(p); next.set("view", v); return next; }, { replace: true });
  const trades = useTrades(account.id);
  const summaries = useReviewSummaries(account.id);
  const dailyReviews = useDailyReviewIndex(account.id);
  const reviewsState = dailyReviews.data ?? (dailyReviews.error ? "error" as const : "loading" as const);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => joinRows(trades.data ?? [], summaries.data ?? []), [trades.data, summaries.data]);
  const readOnly = account.archivedAt !== null;

  const addButton = (
    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setAdding(true)} disabled={readOnly} disabledReason={readOnly ? "Archived accounts are read-only" : undefined}>
      Add trade
    </Button>
  );
  const importButton = (
    <Button icon={<Upload size={16} aria-hidden="true" />} onClick={() => navigate("/import", { state: { accountId: account.id } })}>Import trades</Button>
  );

  return (
    <div className="jr-page">
      <div className="jr-head">
        <p className="jr-sub">
          <strong>{account.name}</strong> · times in {zoneLabel(account.timezone)} · trading days start at {account.tradingDayResetTime}
        </p>
        <div className="jr-head-actions">{view !== "library" && <>{importButton}{addButton}</>}</div>
      </div>
      <Tabs label="Journal views" value={view} onValueChange={setView}
        items={[{ value: "day", label: "By day" }, { value: "log", label: "Trade log", count: trades.data?.length }, { value: "library", label: "Library" }]}>
        <TabPanel value="day">
          {trades.data?.length === 0 && (dailyReviews.data?.reviews.length ?? 0) > 0 ? (
            // No trades yet, but reviewed days (no-trade days, or trades not imported yet) still list here.
            <ByDayView rows={[]} account={account} onOpen={t => navigate(tradePath(t.id))} reviews={reviewsState} />
          ) : (
            <TradesBoundary trades={trades} empty={<NoTrades add={addButton} importButton={importButton} review={dailyReviews.data ? <Button onClick={() => navigate(dailyReviewPath(account.id, dailyReviews.data!.currentTradingDay))}>Review today</Button> : null} />}>
              {() => <>{summaries.error && <SummariesNotice />}<ByDayView rows={rows} account={account} onOpen={t => navigate(tradePath(t.id))} reviews={reviewsState} /></>}
            </TradesBoundary>
          )}
        </TabPanel>
        <TabPanel value="log">
          <TradesBoundary trades={trades} empty={<NoTrades add={addButton} importButton={importButton} />}>
            {() => <>{summaries.error && <SummariesNotice />}<TradeLogView rows={rows} account={account} onOpen={t => navigate(tradePath(t.id))} /></>}
          </TradesBoundary>
        </TabPanel>
        <TabPanel value="library">
          <LibraryView account={account} />
        </TabPanel>
      </Tabs>
      <TradeFormDialog account={account} open={adding} onOpenChange={setAdding} onSaved={t => navigate(tradePath(t.id))} />
    </div>
  );
}

function TradesBoundary({ trades, empty, children }: { trades: ReturnType<typeof useTrades>; empty: ReactNode; children: () => ReactNode }) {
  return (
    <StateBoundary state={toAsyncState(trades)} label="trades" onRetry={retryRead(trades.refresh)}
      loading={<LoadingState label="Loading trades" layout="table" rows={6} />} empty={{ "no-records": empty }}>
      {() => children()}
    </StateBoundary>
  );
}

function NoTrades({ add, importButton, review }: { add: ReactNode; importButton: ReactNode; review?: ReactNode }) {
  return (
    <div className="ds-card">
      <EmptyState kind="no-records" title="No trades in this account yet"
        description="Enter a trade by hand, or import your broker's CSV. Either way you can review each trade with notes, tags, a checklist and screenshots. A day's plan and review don't need trades."
        action={<div className="jr-row">{importButton}{add}{review}</div>} />
    </div>
  );
}

function SummariesNotice() {
  return (
    <InlineNotice tone="warning" title="Review details couldn't be loaded">
      Trades are shown without their tags, strategy and review status. Open a trade to see its review, or try again later.
    </InlineNotice>
  );
}
