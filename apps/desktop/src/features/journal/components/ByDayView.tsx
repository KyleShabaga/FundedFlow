// Journal by day (Build 20): one collapsible card per stored trading day, newest first; the latest day open.
// Day figures are display sums of Rust-stored values (format.ts); trades without a known P&L are left out and named.
// Build 22 adds each day's daily review (status, plan adherence, open/start) and days that have a review but no
// trades. Adherence is Rust's and shown apart from P&L; a day's review opens at its account-and-day deep link.
import type { DailyReviewIndex, DailyReviewSummary } from "@fundedflow/domain";
import { ChevronDown, ChevronRight, NotebookPen } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Badge,
  Button,
  type DataColumn,
  DataTable,
  EquityCurve,
  formatMoney,
  formatPercent,
  LabeledValue,
  Pnl,
  UNKNOWN,
} from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import type { TradeViewModel } from "../../trades/view-models/trade";
import { DayChooser } from "../../daily-reviews/components/DayChooser";
import { adherenceShort, dailyReviewPath, statusView } from "../../daily-reviews/view-models/daily-review";
import "../../daily-reviews/components/daily-review.css";
import { cumulative, groupByDay, holdTime, stats, type DayGroup, type JournalRow } from "./journal-model";
import { clock, longDay, NetPnl, ResultBadge, SideBadge, SourceBadge, TagList } from "./presentation";

const FIRST_ROWS = 8;
const DAYS_PER_PAGE = 20;

export function tradeColumns(account: AccountViewModel, options: { day?: boolean } = {}): DataColumn<JournalRow>[] {
  const tz = account.timezone;
  return [
    { id: "result", header: "Result", cell: r => <ResultBadge trade={r.trade} /> },
    { id: "symbol", header: "Symbol", rowHeader: true, sortable: !options.day, cell: r => <span className="ds-sym">{r.trade.symbol}</span> },
    { id: "side", header: "Side", cell: r => <SideBadge side={r.trade.side} /> },
    { id: "source", header: "Source", cell: r => <SourceBadge trade={r.trade} /> },
    ...(options.day ? [] : [{ id: "tradingDay", header: "Day", sortable: true, firstDirection: "descending" as const, cell: (r: JournalRow) => <span className="ds-faint">{r.trade.tradingDay}</span> }]),
    { id: "entryAt", header: options.day ? "Open" : "Entry time", sortable: !options.day, firstDirection: "descending", cell: r => <span className="ds-mono">{clock(r.trade.entryAt, tz)}</span> },
    { id: "exitAt", header: options.day ? "Close" : "Exit time", sortable: !options.day, firstDirection: "descending", cell: r => <span className="ds-mono">{clock(r.trade.exitAt, tz)}</span> },
    { id: "quantity", header: "Qty", align: "end", sortable: !options.day, cell: r => r.trade.quantity },
    { id: "entry", header: "Entry", align: "end", cell: r => r.trade.entryPrice },
    { id: "exit", header: "Exit", align: "end", cell: r => r.trade.exitPrice ?? UNKNOWN },
    ...(options.day ? [{ id: "hold", header: "Hold", align: "end" as const, cell: (r: JournalRow) => holdTime(r.trade) ?? UNKNOWN }] : []),
    { id: "netPnl", header: "Net P&L", align: "end", sortable: !options.day, firstDirection: "descending", cell: r => <NetPnl trade={r.trade} /> },
    { id: "tags", header: "Tags", cell: r => <TagList tags={r.review?.tags ?? []} /> },
    { id: "review", header: "Review", cell: r => (r.review?.reviewed ? <span className="jr-reviewed">Reviewed</span> : <span className="ds-faint">Not yet</span>) },
  ];
}

export function DayStats({ rows, currency }: { rows: readonly JournalRow[]; currency: string }) {
  const s = stats(rows);
  const money = (v: string | null, signed = true) => (v == null ? null : formatMoney(v, { currency, signed }));
  return (
    <div className="jr-stats" role="group" aria-label="Day statistics">
      <LabeledValue label="Trades" value={String(s.trades)} />
      <LabeledValue label="Win rate" value={s.winRate == null ? null : formatPercent(s.winRate, 0).replace("+", "")} />
      <LabeledValue label="Gross P&L" value={money(s.gross)} />
      <LabeledValue label="Fees" value={s.fees != null && s.feesIncomplete
        ? <span className="jr-pnl" title="Some trades here have fees not recorded, so this is only the fees that were recorded.">{money(s.fees, false)} <Badge tone="warn">Incomplete</Badge></span>
        : money(s.fees, false)} />
      <LabeledValue label="Contracts" value={s.contracts} />
      <LabeledValue label="Winners" value={String(s.winners)} />
      <LabeledValue label="Losers" value={String(s.losers)} />
      <LabeledValue label="Profit factor" value={s.profitFactor == null ? null : s.profitFactor.toFixed(2)} />
    </div>
  );
}

export function UnknownNote({ rows }: { rows: readonly JournalRow[] }) {
  const s = stats(rows);
  if (!s.open && !s.unknown && !s.feesNotRecorded) return null;
  const trades = (n: number) => (n === 1 ? "trade" : "trades");
  const parts = [s.open ? `${s.open} open ${trades(s.open)}` : null, s.unknown ? `${s.unknown} ${trades(s.unknown)} without a known P&L` : null].filter(Boolean);
  return (
    <>
      {parts.length > 0 && <p className="ds-faint jr-note">{parts.join(" and ")} {s.open + s.unknown === 1 ? "is" : "are"} not in the P&amp;L figures.</p>}
      {/* TASK-042 (R-NET): totals keep the stored values; trades without recorded fees count before fees. */}
      {s.feesNotRecorded > 0 && <p className="ds-faint jr-note">Includes {s.feesNotRecorded} {trades(s.feesNotRecorded)} with fees not recorded (counted before fees).</p>}
    </>
  );
}

/** The day's review: status, plan adherence (process only) and the action that opens it. Unknown while reviews load. */
function DayReview({ account, day, review, reviews }: { account: AccountViewModel; day: string; review: DailyReviewSummary | null; reviews: ReviewsState }) {
  const navigate = useNavigate();
  const status = statusView(review);
  const action = !review ? "Plan / review day" : review.status === "draft" ? "Continue review" : "Open review";
  return (
    <div className="dr-day-review" role="group" aria-label={`Daily review for ${longDay(day)}`}>
      {reviews === "loading" ? <span className="ds-faint">Review status loading…</span>
        : reviews === "error" ? <span className="ds-faint">Review status unknown</span>
        : <>
            <Badge tone={status.tone}>{review ? `Review: ${status.label}` : "No review"}</Badge>
            {review && <span className="ds-faint">{adherenceShort(review.adherence)}</span>}
            {review?.tradesChanged && <Badge tone="warn">Trades changed since</Badge>}
          </>}
      <Button size="sm" variant="ghost" icon={<NotebookPen size={16} aria-hidden="true" />} onClick={() => navigate(dailyReviewPath(account.id, day))}
        aria-label={`${action}, ${longDay(day)}`}>{action}</Button>
    </div>
  );
}

type ReviewsState = DailyReviewIndex | "loading" | "error";
const reviewFor = (reviews: ReviewsState, day: string) => (typeof reviews === "object" ? reviews.reviews.find(r => r.tradingDay === day) ?? null : null);

/** A day with a review and no trades (a no-trade day, or trades not imported yet). */
function ReviewOnlyDay({ account, review, reviews }: { account: AccountViewModel; review: DailyReviewSummary; reviews: ReviewsState }) {
  return (
    <article className="ds-card jr-day" aria-label={longDay(review.tradingDay)}>
      <div className="dr-day-only">
        <span className="jr-day-date">{longDay(review.tradingDay)}</span>
        <span className="ds-faint">{review.noTradeDay ? "No-trade day" : "No trades recorded"}</span>
      </div>
      <DayReview account={account} day={review.tradingDay} review={review} reviews={reviews} />
    </article>
  );
}

function DayCard({ group, account, open, onToggle, onOpen, reviews }: {
  group: DayGroup; account: AccountViewModel; open: boolean; onToggle: () => void; onOpen: (t: TradeViewModel) => void; reviews: ReviewsState;
}) {
  const panel = useId();
  const [all, setAll] = useState(false);
  const s = stats(group.rows);
  const curve = cumulative(group.rows);
  const shown = all ? group.rows : group.rows.slice(0, FIRST_ROWS);
  const summary = `${s.trades} ${s.trades === 1 ? "trade" : "trades"} · ${s.winRate == null ? "win rate unknown" : `${Math.round(s.winRate)}% win rate`}`;
  return (
    <article className="ds-card jr-day" aria-label={longDay(group.day)}>
      <header className="jr-day-head">
        <button type="button" className="jr-day-toggle" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
          {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          <span className="jr-day-date">{longDay(group.day)}</span>
          <span className="ds-faint jr-day-meta">{summary}</span>
          <span className="ds-sr-only">{open ? ", collapse" : ", expand"}</span>
        </button>
        <Pnl value={s.net} size={open ? "xl" : "m"} currency={account.currency} />
      </header>
      <DayReview account={account} day={group.day} review={reviewFor(reviews, group.day)} reviews={reviews} />
      <div id={panel} hidden={!open} className="jr-day-body">
        {open && (
          <>
            <DayStats rows={group.rows} currency={account.currency} />
            <UnknownNote rows={group.rows} />
            {curve.length >= 2 && <EquityCurve points={["0", ...curve]} step={false} height={120} label={`Cumulative net P&L through ${longDay(group.day)}, ending at ${formatMoney(curve[curve.length - 1], { currency: account.currency })}`} />}
            <DataTable label={`Trades on ${longDay(group.day)}`} columns={tradeColumns(account, { day: true })} rows={shown}
              getRowId={r => r.trade.id} onRowClick={r => onOpen(r.trade)} isRowMuted={r => r.trade.pnlStatus === "open"}
              footer={group.rows.length > FIRST_ROWS ? (
                <Button size="sm" variant="ghost" onClick={() => setAll(v => !v)}>{all ? "Show fewer" : `Show all ${group.rows.length}`}</Button>
              ) : undefined} />
          </>
        )}
      </div>
    </article>
  );
}

export function ByDayView({ rows, account, onOpen, reviews }: { rows: readonly JournalRow[]; account: AccountViewModel; onOpen: (t: TradeViewModel) => void; reviews: ReviewsState }) {
  const navigate = useNavigate();
  const tradeGroups = useMemo(() => groupByDay(rows), [rows]);
  // Days with a review but no trades are listed in date order with the trading days.
  const groups: DayGroup[] = useMemo(() => {
    const extra = typeof reviews === "object" ? reviews.reviews.filter(r => !tradeGroups.some(g => g.day === r.tradingDay)).map(r => ({ day: r.tradingDay, rows: [] })) : [];
    return [...tradeGroups, ...extra].sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [tradeGroups, reviews]);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set(tradeGroups[0] ? [tradeGroups[0].day] : []));
  const [limit, setLimit] = useState(DAYS_PER_PAGE);
  const toggle = (day: string) => setOpenDays(prev => { const next = new Set(prev); if (next.has(day)) next.delete(day); else next.add(day); return next; });
  const shown = groups.slice(0, limit);
  const allOpen = shown.length > 0 && shown.every(g => openDays.has(g.day));
  return (
    <div className="jr-days">
      <div className="jr-days-bar">
        <span className="ds-faint">{groups.length} trading {groups.length === 1 ? "day" : "days"}, newest first. Days are the account's trading days (weekends count toward Monday).</span>
        <div className="jr-row">
          {typeof reviews === "object" && <DayChooser initial={reviews.currentTradingDay} label="Review a day" onChoose={d => navigate(dailyReviewPath(account.id, d))} />}
          <Button size="sm" variant="ghost" onClick={() => setOpenDays(allOpen ? new Set() : new Set(shown.map(g => g.day)))}>{allOpen ? "Collapse all" : "Expand all"}</Button>
        </div>
      </div>
      {shown.map(g => g.rows.length === 0
        ? <ReviewOnlyDay key={g.day} account={account} review={reviewFor(reviews, g.day)!} reviews={reviews} />
        : <DayCard key={g.day} group={g} account={account} open={openDays.has(g.day)} onToggle={() => toggle(g.day)} onOpen={onOpen} reviews={reviews} />)}
      {groups.length > limit && (
        <div className="jr-more"><Button onClick={() => setLimit(l => l + DAYS_PER_PAGE)}>Show {Math.min(DAYS_PER_PAGE, groups.length - limit)} more days</Button></div>
      )}
    </div>
  );
}
