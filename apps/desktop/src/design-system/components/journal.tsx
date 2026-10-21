import type { Trade } from "@fundedflow/domain";
import type { ReactNode } from "react";

import { currencySymbol, formatMoney, formatMoneyCompact, formatTradingDay, moneySign, sumMoney, UNKNOWN } from "../format";
import { Sparkline } from "./charts";
import { cx } from "./cx";
import { Badge, Pnl, type Tone } from "./primitives";

/* ---------- PnlCalendar ---------- */

export interface CalendarDay {
  /** Net P&L for the trading day as decimal text; null when any trade's P&L is unknown. */
  pnl: string | null;
  trades: number;
  /** Win rate as percent text ("62.5"), for `display="winRate"`; null when no trade has a known result. */
  winRate?: string | null;
}

/** What the day and week cells lead with. P&L tints apply in every mode. */
export type CalendarDisplay = "pnl" | "trades" | "winRate";

export interface PnlCalendarProps {
  year: number;
  /** 1-12. */
  month: number;
  /** Keyed by trading day, "YYYY-MM-DD". */
  days: Record<string, CalendarDay>;
  /** "YYYY-MM-DD"; outlined in flow. */
  today?: string;
  /** Opens that day's journal. */
  onSelectDay?: (day: string) => void;
  /** "YYYY-MM-DD"; ringed and pressed (the day shown in a side panel). */
  selectedDay?: string | null;
  /** Makes each week total a button; receives the week's in-month trading days and its 1-based number. */
  onSelectWeek?: (days: string[], week: number) => void;
  /** Number (1-based) of the selected week, ringed and pressed. */
  selectedWeek?: number | null;
  display?: CalendarDisplay;
  /** Replaces the month title (for example with a MonthYearPicker). */
  title?: ReactNode;
  /** Replaces the month summary on the right. */
  summary?: ReactNode;
  /**
   * Trading days are Monday to Friday (weekend activity rolls to Monday, see
   * docs/data-model.md#trading-day), so weekends are hidden by default.
   */
  showWeekends?: boolean;
  /** ISO 4217 code of the account. */
  currency?: string | null;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const tradesText = (n: number) => (n === 1 ? "1 trade" : `${n} trades`);

/** Weeks (Monday first) of a month as trading-day keys, null outside the month. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (first + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= count; d++) cells.push(`${year}-${pad2(month)}-${pad2(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function PnlCalendar({
  year, month, days, today, onSelectDay, selectedDay, onSelectWeek, selectedWeek, display = "pnl", title, summary, showWeekends = false, currency,
}: PnlCalendarProps) {
  const symbol = currencySymbol(currency);
  const cols = showWeekends ? 7 : 5;
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].slice(0, cols);
  const weeks = monthWeeks(year, month)
    .map((w) => w.slice(0, cols))
    .filter((w) => w.some(Boolean));
  const inMonth = Object.keys(days).filter((k) => k.startsWith(`${year}-${pad2(month)}-`));
  const monthTotal = sumMoney(inMonth.map((k) => days[k].pnl));
  const monthTrades = inMonth.reduce((n, k) => n + days[k].trades, 0);
  const lead = (info: CalendarDay) =>
    display === "trades" ? String(info.trades) : display === "winRate" ? (info.winRate == null ? UNKNOWN : `${info.winRate}%`) : formatMoneyCompact(info.pnl, symbol);
  const second = (info: CalendarDay) => (display === "pnl" ? tradesText(info.trades) : formatMoneyCompact(info.pnl, symbol));
  return (
    <div className={cx("ds-card", "ds-cal")} style={{ ["--ds-cal-cols" as string]: cols }}>
      <div className="ds-cal-head">
        {title ?? (
          <span className="ds-title">
            {MONTH_NAMES[month - 1]} {year}
          </span>
        )}
        {summary ?? (
          <span className="ds-cal-sum">
            <Pnl value={inMonth.length ? monthTotal : "0"} currency={currency} />
            <span className="ds-faint"> · {monthTrades} trades</span>
          </span>
        )}
      </div>
      <div className="ds-cal-row ds-cal-dow" aria-hidden="true">
        {[...dow, "Week"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {weeks.map((week, wi) => {
        const traded = week.filter((d): d is string => !!d && !!days[d]);
        const wkTotal = sumMoney(traded.map((d) => days[d].pnl));
        const wkTrades = traded.reduce((n, d) => n + days[d].trades, 0);
        const wkSign = traded.length > 0 && wkTotal != null ? moneySign(wkTotal) : null;
        const wkLabel = `Week ${wi + 1}: ${traded.length ? `${wkTotal == null ? "P&L unknown" : formatMoneyCompact(wkTotal, symbol)}, ${tradesText(wkTrades)}` : "no trades"}`;
        const wkBody = (
          <>
            <span className="ds-cal-date">Week {wi + 1}</span>
            <span className="ds-cal-pnl">{traded.length ? (display === "trades" ? String(wkTrades) : formatMoneyCompact(wkTotal, symbol)) : UNKNOWN}</span>
            {traded.length > 0 && <span className="ds-cal-trades">{display === "trades" ? formatMoneyCompact(wkTotal, symbol) : tradesText(wkTrades)}</span>}
          </>
        );
        const wkCls = cx("ds-cal-week", wkSign && `ds-cal-week-${wkSign}`, onSelectWeek && "is-clickable", selectedWeek === wi + 1 && "is-selected");
        return (
          <div className="ds-cal-row" key={wi}>
            {week.map((d, ci) => {
              if (!d) return <div key={ci} className="ds-cal-day is-out" />;
              const info = days[d];
              // An unknown day (some trade without a known P&L) shows a dash and no tint.
              const sign = info && info.pnl != null ? moneySign(info.pnl) : null;
              const rate = display === "winRate" && info ? `, win rate ${info.winRate == null ? "unknown" : `${info.winRate}%`}` : "";
              const label = `${formatTradingDay(d)}: ${info ? `${info.pnl == null ? "P&L unknown" : formatMoneyCompact(info.pnl, symbol)}, ${tradesText(info.trades)}${rate}` : "no trades"}`;
              const selected = selectedDay === d;
              const cls = cx("ds-cal-day", info && sign && `ds-cal-${sign}`, today === d && "is-today", onSelectDay && "is-clickable", selected && "is-selected");
              const body = (
                <>
                  <span className="ds-cal-date">{Number(d.slice(8))}</span>
                  {info && <span className="ds-cal-pnl">{lead(info)}</span>}
                  {info && <span className="ds-cal-trades">{second(info)}</span>}
                </>
              );
              return onSelectDay ? (
                <button key={ci} type="button" className={cls} aria-label={label} aria-pressed={selectedDay !== undefined ? selected : undefined} onClick={() => onSelectDay(d)}>
                  {body}
                </button>
              ) : (
                <div key={ci} className={cls} aria-label={label} role="group">
                  {body}
                </div>
              );
            })}
            {onSelectWeek ? (
              <button type="button" className={wkCls} aria-label={wkLabel} aria-pressed={selectedWeek !== undefined ? selectedWeek === wi + 1 : undefined}
                onClick={() => onSelectWeek(week.filter((d): d is string => !!d), wi + 1)}>
                {wkBody}
              </button>
            ) : (
              <div className={wkCls}>{wkBody}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- DayCard ---------- */

export interface DayCardProps {
  /** Trading day, "YYYY-MM-DD". */
  day: string;
  trades: number;
  pnl: string | null;
  /** 0-100, or null when no trade was decided. */
  winRate?: number | null;
  /** Cumulative P&L through the day, as decimal text. */
  spark?: (string | null)[];
  active?: boolean;
  onClick?: () => void;
  /** ISO 4217 code of the account. */
  currency?: string | null;
}

export function DayCard({ day, trades, pnl, winRate, spark = [], active, onClick, currency }: DayCardProps) {
  return (
    <button type="button" className={cx("ds-day", active && "is-on")} aria-pressed={active} onClick={onClick}>
      <span className="ds-day-row">
        <span className="ds-day-date">{formatTradingDay(day)}</span>
        <span className="ds-faint">{trades === 1 ? "1 trade" : `${trades} trades`}</span>
      </span>
      <span className="ds-day-row">
        <Pnl value={pnl} currency={currency} />
        {winRate != null && <span className="ds-faint">{Math.round(winRate)}% win</span>}
      </span>
      <Sparkline values={spark} />
    </button>
  );
}

/* ---------- TradeTable ---------- */

export interface TradeTableProps {
  /** Trades exactly as list_trades returns them. */
  trades: Trade[];
  /** IANA zone for entry times; the account's timezone. Default: the computer's. */
  timeZone?: string;
  onRowClick?: (trade: Trade) => void;
  selectedId?: string | null;
  /** Accessible name for the table. */
  label: string;
  /** ISO 4217 code of the trades' account. */
  currency?: string | null;
}

const STATUS_TEXT: Record<Trade["pnlStatus"], string | null> = {
  calculated: null,
  reported: "Broker P&L",
  open: "Open",
  missing_instrument: "No instrument",
  currency_mismatch: "Currency mismatch",
};

/** WIN / LOSS / BE from net P&L; OPEN with no exit; "—" when P&L is unknown. */
export function tradeResult(t: Trade): { text: string; tone: Tone } {
  if (t.pnlStatus === "open") return { text: "Open", tone: "warn" };
  if (t.realizedPnl == null) return { text: UNKNOWN, tone: "neutral" };
  const s = moneySign(t.realizedPnl);
  return s === "profit" ? { text: "Win", tone: "profit" } : s === "loss" ? { text: "Loss", tone: "loss" } : { text: "BE", tone: "neutral" };
}

export function TradeTable({ trades, timeZone, onRowClick, selectedId, label, currency }: TradeTableProps) {
  const time = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  return (
    <div className="ds-card ds-table-card">
      <table className="ds-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Result</th>
            <th scope="col">Side</th>
            <th scope="col">Symbol</th>
            <th scope="col">Day</th>
            <th scope="col">Entry</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Entry price</th>
            <th scope="col" className="num">Exit price</th>
            <th scope="col" className="num">Fees</th>
            <th scope="col" className="num">Net P&amp;L</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const r = tradeResult(t);
            const status = STATUS_TEXT[t.pnlStatus];
            return (
              <tr
                key={t.id}
                className={cx(selectedId === t.id && "is-on", onRowClick && "is-clickable")}
                onClick={onRowClick ? () => onRowClick(t) : undefined}
                onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(t)) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-selected={onRowClick ? selectedId === t.id : undefined}
              >
                <td>
                  <Badge tone={r.tone}>{r.text}</Badge>
                </td>
                <td>
                  <Badge tone={t.side === "short" ? "loss" : "profit"} variant="outline">
                    {t.side}
                  </Badge>
                </td>
                <td className="ds-sym">{t.symbol}</td>
                <td className="ds-faint">{formatTradingDay(t.tradingDay)}</td>
                <td className="ds-faint">{time.format(new Date(t.entryAt))}</td>
                <td className="num">{t.quantity}</td>
                <td className="num">{t.entryPrice}</td>
                <td className="num">{t.exitPrice ?? UNKNOWN}</td>
                <td className="num">{formatMoney(t.fees, { signed: false, currency })}</td>
                <td className="num">
                  <Pnl value={t.realizedPnl} size="s" currency={currency} />
                </td>
                <td>{status && <Badge tone={t.pnlStatus === "reported" ? "flow" : "warn"}>{status}</Badge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
