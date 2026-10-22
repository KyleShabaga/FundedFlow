// Insights overview (docs/design/screens/07-insights.md): headline metrics, the closed-trade P&L curve, best/worst/
// average month, the Trades and Days-and-months lists, the weekday breakdown and setups/mistakes when recorded.
// Every figure is a summary of a subset of the one included-trade set and opens exactly those trades.
import {
  basisAmount,
  byPeriod,
  byTag,
  byWeekday,
  closedTradeCurve,
  INSIGHTS_MIN_SAMPLE,
  periodStats,
  tradesPerPeriod,
  WEEKDAYS,
  type Group,
} from "@fundedflow/domain";
import { useMemo, useState } from "react";

import { ChartPanel, type DataColumn, DataTable, EquityCurve, formatMoney, MetricCard, MoneyCell, PnlBars, SegmentedControl, StatList } from "../../../design-system";
import { dayLabel, monthLabel, moneyView, numberView, rateView, tradesText } from "../view-models/insights";
import { barValue, BASIS_LABEL, DrillButton, GroupTable, groupDetail, MetricText, type SectionProps } from "./shared";

export function OverviewSection(props: SectionProps) {
  const { selection, summary: s, basis, currency, drill } = props;
  const trades = selection.trades;
  const days = useMemo(() => byPeriod(trades, "day"), [trades]);
  const months = useMemo(() => byPeriod(trades, "month"), [trades]);
  const dayStats = periodStats(days, basis);
  const monthStats = periodStats(months, basis);
  const weekdays = useMemo(() => byWeekday(trades), [trades]);
  const setups = useMemo(() => byTag(trades, "setup"), [trades]);
  const mistakes = useMemo(() => byTag(trades, "mistake"), [trades]);
  const label = BASIS_LABEL[basis];
  const scope = `${label} · selected attempts and filters`;
  const money = (m: Parameters<typeof moneyView>[0], signed = true) => moneyView(m, currency, signed);
  const pnl = money(basisAmount(s, basis));
  const expectancy = money(basis === "net" ? s.expectancy : s.expectancyGross);
  const pf = numberView(s.profitFactor);
  const r = numberView(s.averageR, "R");
  const wr = rateView(s.winRate);
  const view = (n: number) => `View ${tradesText(n)}`;
  // Coverage of the headline sums (P0-D14): in the Net P&L card's "i", and also visible while some P&L is unknown.
  const coverage = s.unknownPnl ? `${s.eligible} of ${s.closed} closed trades with a known P&L` : `${tradesText(s.closed)}, all with a known P&L`;
  const groupDrill = (g: Group | null, what: string, describe: (k: string) => string) =>
    g ? <DrillButton ids={g.summary.tradeIds} title={`${what}: ${describe(g.key)}`} basis={scope} drill={drill}>{describe(g.key)}</DrillButton> : null;

  return (
    <div className="in-section">
      <div className="in-kpis">
        <MetricCard label={label} value={pnl.value} sub={pnl.reason ?? (basis === "net" ? <>After {fmtFees(s, currency)} in fees</> : "Before fees")}
          info={<p>{coverage}</p>} basis={s.unknownPnl ? coverage : undefined}
          action={<DrillButton ids={s.eligibleIds} title={label} basis={scope} drill={drill}>{view(s.eligible)}</DrillButton>} />
        <MetricCard label="Win rate" value={wr.value} sub={s.eligible ? `${s.wins} W · ${s.losses} L · ${s.breakevens} BE` : wr.reason}
          info={<p>Wins ÷ trades with a known result (break-evens count), as in the Journal</p>}
          action={<DrillButton ids={s.eligibleIds} title="Win rate" basis="Wins, losses and break-evens by net P&L" drill={drill}>{view(s.eligible)}</DrillButton>} />
        <MetricCard label="Expectancy" value={expectancy.value} sub={expectancy.reason ?? "Average result per trade"}
          info={<p>{label} ÷ trades with a known result · needs {INSIGHTS_MIN_SAMPLE}</p>}
          action={<DrillButton ids={s.eligibleIds} title="Expectancy" basis={scope} drill={drill}>{view(s.eligible)}</DrillButton>} />
        <MetricCard label="Profit factor" value={pf.value} sub={pf.reason ?? "Winning ÷ losing net P&L"}
          info={<p>Net P&L · needs {INSIGHTS_MIN_SAMPLE} trades and a loss</p>}
          action={<DrillButton ids={[...s.winIds, ...s.lossIds]} title="Profit factor" basis="Winning and losing trades by net P&L" drill={drill}>{view(s.wins + s.losses)}</DrillButton>} />
        <MetricCard label="Average R" value={r.value} sub={r.reason ?? `${s.rIds.length} of ${s.eligible} trades have a planned risk`}
          info={<p>Net P&L ÷ the review's planned risk (1R), only where recorded</p>}
          action={<DrillButton ids={s.rIds} title="Average R" basis="Trades whose review records a planned risk" drill={drill}>{view(s.rIds.length)}</DrillButton>} />
      </div>

      <div className="in-months">
        <MetricCard label="Best month" value={monthStats.best ? moneyView(basisAmount(monthStats.best.summary, basis), currency).value : { kind: "text", text: "N/A" }}
          sub={groupDrill(monthStats.best, "Best month", monthLabel) ?? "No month with a known result"} />
        <MetricCard label="Worst month" value={monthStats.worst ? moneyView(basisAmount(monthStats.worst.summary, basis), currency).value : { kind: "text", text: "N/A" }}
          sub={groupDrill(monthStats.worst, "Worst month", monthLabel) ?? "No month with a known result"} />
        <MetricCard label="Average per month" value={{ kind: "money", amount: monthStats.average, currency }}
          sub={monthStats.known ? <DrillButton ids={monthStats.averageIds} title="Average per month" basis={scope} drill={drill}>{`${monthStats.known} ${monthStats.known === 1 ? "month" : "months"}`}</DrillButton> : "No month with a known result"}
          basis={monthStats.incomplete ? `${monthStats.incomplete} with unknown P&L counted on their known trades` : undefined} />
      </div>

      <CurvePanel {...props} />

      <div className="in-two">
        <section className="ds-card in-card" aria-labelledby="in-trades-h">
          <h3 id="in-trades-h" className="ds-title">Trades</h3>
          <StatList label="Trades" items={[
            { label: "Closed trades", value: <DrillButton ids={s.tradeIds} title="Closed trades" basis={scope} drill={drill}>{s.closed}</DrillButton> },
            { label: "With a known P&L", value: <DrillButton ids={s.eligibleIds} title="Trades with a known P&L" basis={scope} drill={drill}>{s.eligible}</DrillButton> },
            { label: "Unknown P&L (not in sums)", value: <DrillButton ids={s.unknownIds} title="Trades with an unknown P&L" basis="No point value or broker P&L, or another currency" drill={drill}>{s.unknownPnl}</DrillButton> },
            { label: "Winning trades", value: <DrillButton ids={s.winIds} title="Winning trades" basis="Net P&L above zero" drill={drill}>{s.wins}</DrillButton> },
            { label: "Losing trades", value: <DrillButton ids={s.lossIds} title="Losing trades" basis="Net P&L below zero" drill={drill}>{s.losses}</DrillButton> },
            { label: "Break-even trades", value: <DrillButton ids={s.breakevenIds} title="Break-even trades" basis="Net P&L exactly zero" drill={drill}>{s.breakevens}</DrillButton> },
            { label: "Average winning trade", value: <DrillButton ids={s.winIds} title="Average winning trade" basis="Net P&L" drill={drill}><MetricText view={money(s.averageWin)} /></DrillButton> },
            { label: "Average losing trade", value: <DrillButton ids={s.lossIds} title="Average losing trade" basis="Net P&L" drill={drill}><MetricText view={money(s.averageLoss)} /></DrillButton> },
            { label: "Fees", value: <DrillButton ids={s.eligibleIds} title="Fees" basis="Fees of trades with a known P&L, as recorded" drill={drill}><MetricText view={money(s.fees, false)} /></DrillButton> },
            { label: "Profit factor", value: <MetricText view={pf} /> },
          ]} />
        </section>
        <section className="ds-card in-card" aria-labelledby="in-days-h">
          <h3 id="in-days-h" className="ds-title">Days and months</h3>
          <StatList label="Days and months" items={[
            { label: "Trading days", value: <DrillButton ids={s.tradeIds} title="Trading days" basis={scope} drill={drill}>{dayStats.periods}</DrillButton> },
            { label: "Average trades per day", value: tradesPerPeriod(days) },
            { label: "Winning days", value: <DrillButton ids={dayStats.winning.flatMap(g => g.summary.tradeIds)} title="Winning days" basis={scope} drill={drill}>{dayStats.winning.length}</DrillButton> },
            { label: "Losing days", value: <DrillButton ids={dayStats.losing.flatMap(g => g.summary.tradeIds)} title="Losing days" basis={scope} drill={drill}>{dayStats.losing.length}</DrillButton> },
            { label: "Days with an unknown P&L", value: <DrillButton ids={days.filter(g => !g.summary.complete).flatMap(g => g.summary.tradeIds)} title="Days with an unknown P&L" basis={scope} drill={drill}>{dayStats.incomplete}</DrillButton> },
            { label: "Average day", value: <DrillButton ids={dayStats.averageIds} title="Average day" basis={scope} drill={drill}><MoneyCell value={dayStats.average} currency={currency} /></DrillButton> },
            { label: "Best day", value: dayStats.best ? <DrillButton ids={dayStats.best.summary.tradeIds} title={`Best day: ${dayLabel(dayStats.best.key)}`} basis={scope} drill={drill}><MoneyCell value={barValue(dayStats.best.summary, basis)} currency={currency} /> · {dayLabel(dayStats.best.key)}</DrillButton> : null },
            { label: "Worst day", value: dayStats.worst ? <DrillButton ids={dayStats.worst.summary.tradeIds} title={`Worst day: ${dayLabel(dayStats.worst.key)}`} basis={scope} drill={drill}><MoneyCell value={barValue(dayStats.worst.summary, basis)} currency={currency} /> · {dayLabel(dayStats.worst.key)}</DrillButton> : null },
            { label: "Months traded", value: <DrillButton ids={s.tradeIds} title="Months traded" basis={scope} drill={drill}>{monthStats.periods}</DrillButton> },
            { label: "Winning months", value: <DrillButton ids={monthStats.winning.flatMap(g => g.summary.tradeIds)} title="Winning months" basis={scope} drill={drill}>{monthStats.winning.length}</DrillButton> },
            { label: "Losing months", value: <DrillButton ids={monthStats.losing.flatMap(g => g.summary.tradeIds)} title="Losing months" basis={scope} drill={drill}>{monthStats.losing.length}</DrillButton> },
          ]} />
        </section>
      </div>

      <section className="ds-card in-card" aria-labelledby="in-weekday-h">
        <div className="in-card-head">
          <h3 id="in-weekday-h" className="ds-title">By weekday</h3>
          <span className="ds-faint">{label} per trading day of the week (weekend activity counts toward Monday)</span>
        </div>
        <PnlBars label={`${label} by weekday`} currency={currency}
          items={WEEKDAYS.map((name, i) => {
            const g = weekdays.find(w => w.key === String(i + 1));
            return { key: String(i + 1), label: name, value: g ? barValue(g.summary, basis) : null, detail: g ? groupDetail(g.summary) : "No trades" };
          })}
          onSelect={key => { const g = weekdays.find(w => w.key === key); if (g) drill({ title: `By weekday: ${g.label}`, basis: scope, ids: g.summary.tradeIds }); }} />
      </section>

      {(setups.length > 0 || mistakes.length > 0) && (
        <section className="in-card-plain" aria-labelledby="in-tags-h">
          <h3 id="in-tags-h" className="ds-title">Setups and mistakes</h3>
          {setups.length > 0 && <GroupTable label="Setups" nameHeader="Setup" groups={setups} basis={basis} currency={currency} drill={drill} drillBasis={scope} />}
          {mistakes.length > 0 && <GroupTable label="Mistakes" nameHeader="Mistake" groups={mistakes} basis={basis} currency={currency} drill={drill} drillBasis={scope} />}
        </section>
      )}
    </div>
  );
}

function fmtFees(s: SectionProps["summary"], currency: string | null) {
  return <MoneyCell value={s.fees.state === "value" ? s.fees.value : null} currency={currency} signed={false} />;
}

function CurvePanel({ selection, basis, currency, drill }: SectionProps) {
  const [show, setShow] = useState<"chart" | "table">("chart");
  const points = useMemo(() => closedTradeCurve(selection.trades, basis), [selection.trades, basis]);
  const accounts = new Map(selection.accounts.map(a => [a.id, a.name]));
  const trades = new Map(selection.trades.map(t => [t.id, t]));
  const label = basis === "net" ? "Closed-trade net P&L" : "Closed-trade gross P&L";
  const columns: DataColumn<(typeof points)[number]>[] = [
    { id: "n", header: "#", align: "end", cell: p => points.indexOf(p) + 1 },
    { id: "day", header: "Trading day", cell: p => dayLabel(p.tradingDay), rowHeader: true },
    { id: "trade", header: "Trade", cell: p => `${trades.get(p.tradeId)?.symbol ?? ""} · ${accounts.get(trades.get(p.tradeId)?.accountId ?? "") ?? ""}` },
    { id: "amount", header: "Result", align: "end", cell: p => <MoneyCell value={p.amount} currency={currency} /> },
    { id: "cum", header: "Running total", align: "end", cell: p => <MoneyCell value={p.cumulative} currency={currency} /> },
  ];
  return (
    <ChartPanel title={label} minHeight={220}
      subtitle="Running total of known closed-trade results in exit order, from 0 at the start of the selection. Not an account balance, equity or drawdown."
      actions={<>
        <SegmentedControl label="Show the curve as" value={show} onValueChange={setShow} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
        <DrillButton ids={points.map(p => p.tradeId)} title={label} basis="Known closed trades in exit order" drill={drill}>{`View ${tradesText(points.length)}`}</DrillButton>
      </>}
      state={points.length ? { status: "success", data: points } : { status: "empty", kind: "no-records" }}
      empty={{ "no-records": "No closed trade with a known result to draw." }}>
      {data => show === "chart"
        ? <EquityCurve points={data.map(p => p.cumulative)} step label={`${label}: ${data.length} trades, ending at ${formatMoney(data[data.length - 1]?.cumulative ?? null, { currency })}. Use the table view for each point.`} />
        : <DataTable label={`${label} by trade`} columns={columns} rows={data} getRowId={p => p.tradeId}
            onRowClick={p => drill({ title: `${label}: trade ${points.indexOf(p) + 1}`, basis: "One closed trade", ids: [p.tradeId] })} />}
    </ChartPanel>
  );
}
