// Historical and reset-attempt comparison (Build 23C). Each selected attempt is compared on its own closed trades, by
// local account id, in its own currency; a reused broker account number never merges attempts. Grouping by reset chain
// is opt-in and always lists the attempts it includes. Statuses and failure reasons are what the user entered: nothing
// here infers a rule breach, violation time, peak balance or firm verdict from closed trades.
import {
  attemptCohort,
  basisAmount,
  compareAttempts,
  groupLineages,
  reportedFailureReasons,
  type AttemptRow,
} from "@fundedflow/domain";
import { useMemo } from "react";

import { Badge, type DataColumn, DataTable, InlineNotice, StatList, Switch } from "../../../design-system";
import { dayLabel, moneyView, numberView, rateView, STATUS_LABEL, tradesText } from "../view-models/insights";
import { BASIS_LABEL, DrillButton, MetricText, type SectionProps } from "./shared";

export function AttemptsSection({ selection, basis, state, update, drill }: SectionProps) {
  const rows = useMemo(() => compareAttempts(selection), [selection]);
  const lineages = useMemo(() => groupLineages(rows, selection), [rows, selection]);
  const cohort = attemptCohort(selection.accounts);
  const reasons = reportedFailureReasons(rows);
  const byAccount = new Map(rows.map(r => [r.account.id, r]));
  const label = BASIS_LABEL[basis];

  const columns: DataColumn<AttemptRow>[] = [
    { id: "name", header: "Attempt", rowHeader: true, cell: r => (
      <span className="in-attempt">
        <span>{r.account.name}</span>
        {(r.account.predecessorAccountId || r.account.successorAccountId) && <Badge variant="outline">Attempt {r.account.attemptNumber}</Badge>}
      </span>
    ) },
    { id: "status", header: "Status", cell: r => (
      <span className="in-attempt">
        <Badge tone={r.account.status === "failed" ? "loss" : r.account.status === "passed" ? "profit" : r.account.status === "active" ? "flow" : "neutral"}>{STATUS_LABEL[r.account.status]}</Badge>
        {r.account.archivedAt && <Badge variant="outline">Archived</Badge>}
      </span>
    ) },
    { id: "number", header: "Broker no.", cell: r => r.account.externalRef ?? <span className="ds-faint">—</span> },
    { id: "trades", header: "Closed trades", align: "end", cell: r => (
      <DrillButton ids={r.summary.tradeIds} title={`${r.account.name}: closed trades`} basis="This attempt only" drill={drill}>{r.summary.closed}</DrillButton>
    ) },
    { id: "days", header: "Days traded", align: "end", cell: r => r.activeDays },
    { id: "range", header: "First – last day", cell: r => (r.firstDay ? `${dayLabel(r.firstDay)} – ${dayLabel(r.lastDay!)}` : <span className="ds-faint">No closed trades</span>) },
    { id: "pnl", header: label, align: "end", cell: r => (
      <DrillButton ids={r.summary.eligibleIds} title={`${r.account.name}: ${label}`} basis={`${label} · this attempt (${r.currency})`} drill={drill}>
        <MetricText view={moneyView(basisAmount(r.summary, basis), r.currency)} />
      </DrillButton>
    ) },
    { id: "win", header: "Win rate", align: "end", cell: r => <MetricText view={rateView(r.summary.winRate)} /> },
    { id: "exp", header: "Expectancy", align: "end", cell: r => <MetricText view={moneyView(basis === "net" ? r.summary.expectancy : r.summary.expectancyGross, r.currency)} /> },
    { id: "pf", header: "Profit factor", align: "end", cell: r => <MetricText view={numberView(r.summary.profitFactor)} /> },
    { id: "reason", header: "Reported reason", cell: r => r.account.status !== "failed" ? <span className="ds-faint">—</span>
      : r.reportedCause ? <span>Reported: “{r.reportedCause.trim()}”</span> : <span className="ds-faint">Not stated</span> },
  ];

  return (
    <div className="in-section">
      <InlineNotice tone="info" title="Closed-trade results, not account outcomes">
        Each attempt is compared on its own closed trades from your journal. Statuses and reasons are the ones you entered;
        FundedFlow does not infer rule breaches, violation times, peak balances or a firm's verdict from closed trades. Trading P&L here is not cash return (challenge fees and payouts are not included).
      </InlineNotice>
      <div className="in-cal-bar">
        <Switch label="Group reset chains" description="Show attempts of the same reset chain together with a combined row. Every attempt stays listed."
          checked={state.lineage} onChange={e => update({ lineage: e.target.checked })} />
      </div>
      {state.lineage ? (
        lineages.map(l => (
          <section key={l.rootId} className="in-card-plain" aria-label={`Reset chain of ${l.attempts[0]?.account.name ?? "attempt"}`}>
            <h3 className="ds-title">Chain: {l.attempts.map(a => a.account.name).join(" → ")}</h3>
            <p className="ds-faint in-note">
              Includes {l.attempts.length === 1 ? "1 selected attempt" : `${l.attempts.length} selected attempts`} ({l.attempts.map(a => `attempt ${a.account.attemptNumber}`).join(", ")}).
              {l.summary ? ` Combined: ${tradesText(l.summary.closed)}.` : ` Not combined: the attempts use ${l.currencies.join(" and ")}, and amounts are never converted.`}
            </p>
            {l.summary && (
              <StatList label="Combined over the listed attempts" bordered items={[
                { label: `Combined ${label.toLowerCase()}`, value: <DrillButton ids={l.summary.eligibleIds} title={`Chain ${l.attempts[0]?.account.name}: ${label}`} basis="All listed attempts of this chain" drill={drill}><MetricText view={moneyView(basisAmount(l.summary, basis), l.currencies[0] ?? null)} /></DrillButton> },
                { label: "Combined win rate", value: <MetricText view={rateView(l.summary.winRate)} /> },
              ]} />
            )}
            <DataTable label={`Attempts of the chain of ${l.attempts[0]?.account.name}`} columns={columns} rows={l.attempts} getRowId={r => r.account.id} />
          </section>
        ))
      ) : (
        <DataTable label="Selected attempts" columns={columns} rows={rows} getRowId={r => r.account.id} />
      )}
      <div className="in-two">
        <section className="ds-card in-card" aria-labelledby="in-cohort-h">
          <h3 id="in-cohort-h" className="ds-title">Pass rate of the selected attempts</h3>
          <StatList label="Pass rate" items={[
            { label: "Passed", value: { kind: "count", value: cohort.passed.length } },
            { label: "Failed", value: { kind: "count", value: cohort.failed.length } },
            { label: "Pass rate (passed ÷ passed and failed)", value: <MetricText view={rateView(cohort.passRate)} /> },
            { label: "Left out: active, paused or closed", value: { kind: "count", value: cohort.unresolved.length } },
          ]} />
          <p className="ds-faint in-note">Only the attempts you selected, with the statuses you entered. Deleted accounts and attempts you did not select are not counted.</p>
        </section>
        <section className="ds-card in-card" aria-labelledby="in-reasons-h">
          <h3 id="in-reasons-h" className="ds-title">Reported failure reasons</h3>
          {reasons.length === 0 ? <p className="ds-faint">No failed attempt is selected.</p> : (
            <ul className="in-reasons">
              {reasons.map(r => {
                const ids = r.accountIds.flatMap(id => byAccount.get(id)?.summary.tradeIds ?? []);
                return (
                  <li key={r.reason ?? "none"}>
                    <span>{r.reason ? `“${r.reason}”` : <span className="ds-faint">Not stated</span>}</span>
                    <span className="ds-faint"> · {r.accountIds.length === 1 ? "1 attempt" : `${r.accountIds.length} attempts`} · </span>
                    <DrillButton ids={ids} title={`Attempts failed for ${r.reason ? `“${r.reason}”` : "an unstated reason"}`} basis="Closed trades of those attempts" drill={drill}>{tradesText(ids.length)}</DrillButton>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="ds-faint in-note">Reasons are your own words from marking the account failed, grouped by identical text.</p>
        </section>
      </div>
    </div>
  );
}
