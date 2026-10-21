// Insights calendar (docs/design/screens/04-calendar.md): Net P&L / Trades / Win rate, month navigation with the
// MonthYearPicker, the Monday–Friday grid with week totals, the selected day or week, and yearly performance. Every
// cell is a summary of the included trades of that stored trading day (each account's own day rule), and opens them.
// A day with an unknown P&L shows a dash and no tint. Daily reviews (Build 22) are linked as process context only.
import { addMoney, basisAmount, byPeriod, monthOf, summarize, type Group, type InsightsAccount } from "@fundedflow/domain";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  type CalendarDay,
  type CalendarDisplay,
  formatMoneyCompact,
  currencySymbol,
  moneySign,
  MonthYearPicker,
  type MonthSummary,
  Pnl,
  PnlCalendar,
  SegmentedControl,
  StatList,
  UNKNOWN,
  zonedDay,
} from "../../../design-system";
import { useDailyReviewIndex } from "../../daily-reviews/hooks/daily-reviews";
import { dailyReviewPath } from "../../daily-reviews/view-models/daily-review";
import { dayLabel, monthLabel, moneyView, rateView, tradesText } from "../view-models/insights";
import { barValue, BASIS_LABEL, DrillButton, MetricText, type SectionProps } from "./shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CalendarSection(props: SectionProps) {
  const { selection, basis, currency, state, update, drill } = props;
  const trades = selection.trades;
  const days = useMemo(() => byPeriod(trades, "day"), [trades]);
  const months = useMemo(() => byPeriod(trades, "month"), [trades]);
  const byDay = useMemo(() => new Map(days.map(g => [g.key, g])), [days]);
  const byMonth = useMemo(() => new Map(months.map(g => [g.key, g])), [months]);
  // "Today" for navigation only: the current calendar month in the first selected account's zone.
  const zone = selection.accounts[0]?.timezone ?? "UTC";
  const todayDay = zonedDay(new Date().toISOString(), zone);
  const today = { year: Number(todayDay.slice(0, 4)), month: Number(todayDay.slice(5, 7)) };
  const shown = state.month ?? (months.length ? months[months.length - 1]!.key : todayDay.slice(0, 7));
  const year = Number(shown.slice(0, 4));
  const month = Number(shown.slice(5, 7));
  const [week, setWeek] = useState<{ n: number; days: string[] } | null>(null);
  const scope = `${BASIS_LABEL[basis]} · selected attempts and filters`;

  const cells: Record<string, CalendarDay> = {};
  for (const g of days) {
    cells[g.key] = {
      // Unknown when any trade of the day has an unknown P&L: shown as a dash with no tint.
      pnl: g.summary.complete ? barValue(g.summary, basis) : null,
      trades: g.summary.closed,
      winRate: g.summary.winRate.state === "value" ? g.summary.winRate.value.percent : null,
    };
  }
  const pickerMonths: Record<string, MonthSummary> = {};
  for (const g of months) pickerMonths[g.key] = { pnl: g.summary.complete ? barValue(g.summary, basis) : null, trades: g.summary.closed };
  const monthGroup = byMonth.get(shown) ?? null;
  const go = (y: number, m: number) => { setWeek(null); update({ month: `${y}-${String(m).padStart(2, "0")}`, day: null }); };
  const selectedDay = state.day && monthOf(state.day) === shown ? state.day : null;
  const weekTrades = week ? trades.filter(t => week.days.includes(t.tradingDay)) : [];

  return (
    <div className="in-section">
      <div className="in-cal-bar">
        <SegmentedControl<CalendarDisplay> label="Calendar cells show" value={state.display} onValueChange={display => update({ display })}
          options={[{ value: "pnl", label: BASIS_LABEL[basis] }, { value: "trades", label: "Trades" }, { value: "winRate", label: "Win rate" }]} />
        <span className="ds-faint">Trading days run Monday to Friday in each account's zone; weekend activity counts toward Monday.</span>
      </div>
      <div className="in-cal">
        <PnlCalendar year={year} month={month} days={cells} today={todayDay} currency={currency} display={state.display}
          selectedDay={selectedDay} onSelectDay={d => { setWeek(null); update({ day: d }); }}
          selectedWeek={week?.n ?? null} onSelectWeek={(wdays, n) => { update({ day: null }); setWeek({ n, days: wdays }); }}
          title={<MonthYearPicker value={{ year, month }} today={today} months={pickerMonths} currency={currency} minYear={Math.min(today.year - 10, ...months.map(g => Number(g.key.slice(0, 4))))}
            onChange={v => go(v.year, v.month)} />}
          summary={<MonthSummaryLine group={monthGroup} basis={basis} currency={currency} drill={drill} label={monthLabel(shown)} scope={scope} />} />
        <aside className="ds-card in-cal-side" aria-label="Selected period">
          {week ? (
            <PeriodPanel title={`Week ${week.n} of ${monthLabel(shown)}`} trades={weekTrades} {...props} scope={scope} />
          ) : selectedDay ? (
            <PeriodPanel title={dayLabel(selectedDay)} trades={byDay.get(selectedDay) ? trades.filter(t => t.tradingDay === selectedDay) : []} day={selectedDay} {...props} scope={scope} />
          ) : (
            <p className="ds-faint">Choose a day or a week to see its trades. Every cell opens the trades it was added up from.</p>
          )}
        </aside>
      </div>
      <YearlyTable months={byMonth} basis={basis} currency={currency} onMonth={go} drill={drill} scope={scope} />
    </div>
  );
}

function MonthSummaryLine({ group, basis, currency, drill, label, scope }: { group: Group | null; basis: SectionProps["basis"]; currency: string | null; drill: SectionProps["drill"]; label: string; scope: string }) {
  if (!group) return <span className="ds-faint">No closed trades this month</span>;
  const s = group.summary;
  return (
    <span className="in-cal-sum">
      <DrillButton ids={s.tradeIds} title={label} basis={scope} drill={drill} label={`${label}: view the ${tradesText(s.closed)}`}>
        <Pnl value={s.complete ? barValue(s, basis) : null} currency={currency} />
      </DrillButton>
      <span className="ds-faint"> · {tradesText(s.closed)}{s.unknownPnl ? ` · ${s.unknownPnl} with unknown P&L` : ""}</span>
    </span>
  );
}

function PeriodPanel({ title, trades, day, selection, basis, currency, drill, scope }: SectionProps & { title: string; trades: SectionProps["selection"]["trades"]; day?: string; scope: string }) {
  const s = summarize(trades);
  const accounts = selection.accounts.filter(a => trades.some(t => t.accountId === a.id));
  if (trades.length === 0) {
    return (
      <div className="in-period">
        <h3 className="ds-title">{title}</h3>
        <p className="ds-faint">No closed trades in this selection. A day without trades has no P&L; it is not a zero day.</p>
        {day && selection.accounts.length <= 5 && selection.accounts.map(a => <DayReviewLink key={a.id} account={a} day={day} />)}
      </div>
    );
  }
  return (
    <div className="in-period">
      <h3 className="ds-title">{title}</h3>
      <StatList label={`${title} summary`} bordered items={[
        { label: BASIS_LABEL[basis], value: <MetricText view={moneyView(basisAmount(s, basis), currency)} /> },
        { label: "Trades", value: { kind: "count", value: s.closed } },
        ...(s.unknownPnl ? [{ label: "Unknown P&L (not in the sum)", value: { kind: "count" as const, value: s.unknownPnl } }] : []),
        { label: "Win rate", value: <MetricText view={rateView(s.winRate)} /> },
        { label: "Fees", value: <MetricText view={moneyView(s.fees, currency, false)} /> },
        { label: accounts.length === 1 ? "Account" : "Accounts", value: accounts.map(a => a.name).join(", ") },
      ]} />
      <DrillButton ids={s.tradeIds} title={title} basis={scope} drill={drill}>{`View ${tradesText(s.closed)}`}</DrillButton>
      {day && accounts.map(a => <DayReviewLink key={a.id} account={a} day={day} />)}
    </div>
  );
}

/** The day in the Journal's daily review for one attempt, with its review status (process context, Build 22). */
function DayReviewLink({ account, day }: { account: InsightsAccount; day: string }) {
  const index = useDailyReviewIndex(account.id);
  const review = index.data?.reviews.find(r => r.tradingDay === day) ?? null;
  const status = index.data === undefined ? (index.error ? "review status unavailable" : "checking review…")
    : review ? (review.status === "completed" ? "review completed" : "review draft") : "not reviewed";
  return (
    <p className="in-review-link">
      <Link to={dailyReviewPath(account.id, day)}>Open {account.name} for this day in the Journal</Link>
      <span className="ds-faint"> · {status}</span>
    </p>
  );
}

function YearlyTable({ months, basis, currency, onMonth, drill, scope }: { months: Map<string, Group>; basis: SectionProps["basis"]; currency: string | null; onMonth: (y: number, m: number) => void; drill: SectionProps["drill"]; scope: string }) {
  const years = [...new Set([...months.keys()].map(k => Number(k.slice(0, 4))))].sort((a, b) => b - a);
  const symbol = currencySymbol(currency);
  if (years.length === 0) return null;
  return (
    <section className="ds-card in-card" aria-labelledby="in-yearly-h">
      <div className="in-card-head">
        <h3 id="in-yearly-h" className="ds-title">Yearly performance</h3>
        <span className="ds-faint">Months are the sum of their days. Choose a month to show it; choose a year total to see its trades.</span>
      </div>
      <div className="in-yearly-scroll">
        <table className="ds-table in-yearly">
          <caption className="ds-sr-only">{BASIS_LABEL[basis]} and trades per month and year</caption>
          <thead><tr><th scope="col">Year</th>{MONTHS.map(m => <th key={m} scope="col">{m}</th>)}<th scope="col">Total</th></tr></thead>
          <tbody>
            {years.map(y => {
              const inYear = [...months.values()].filter(g => g.key.startsWith(`${y}-`));
              const ids = inYear.flatMap(g => g.summary.tradeIds);
              const complete = inYear.every(g => g.summary.complete);
              // A year is the sum of its months; one month with an unknown P&L makes it unknown.
              const sum = complete ? addMoney(inYear.map(g => barValue(g.summary, basis))) : null;
              return (
                <tr key={y}>
                  <th scope="row">{y}</th>
                  {MONTHS.map((name, i) => {
                    const g = months.get(`${y}-${String(i + 1).padStart(2, "0")}`);
                    const v = g ? (g.summary.complete ? barValue(g.summary, basis) : null) : null;
                    return (
                      <td key={name} className="num">
                        {g ? (
                          <button type="button" className="in-cell-btn" onClick={() => onMonth(y, i + 1)}
                            aria-label={`Show ${name} ${y}: ${v === null ? "P&L unknown" : formatMoneyCompact(v, symbol)}, ${tradesText(g.summary.closed)}`}>
                            <span className={v === null ? "ds-faint" : `ds-text-${sign(v)}`}>{v === null ? UNKNOWN : formatMoneyCompact(v, symbol)}</span>
                            <span className="ds-faint in-cell-sub">{g.summary.closed}</span>
                          </button>
                        ) : <span className="ds-faint">{UNKNOWN}</span>}
                      </td>
                    );
                  })}
                  <td className="num">
                    <DrillButton ids={ids} title={`Year ${y}`} basis={scope} drill={drill} label={`Year ${y}: ${sum === null ? "P&L unknown" : formatMoneyCompact(sum, symbol)}, view the ${tradesText(ids.length)}`}>
                      <span className={sum === null ? "ds-faint" : `ds-text-${sign(sum)}`}>{sum === null ? UNKNOWN : formatMoneyCompact(sum, symbol)}</span>
                    </DrillButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const sign = (v: string) => moneySign(v);
