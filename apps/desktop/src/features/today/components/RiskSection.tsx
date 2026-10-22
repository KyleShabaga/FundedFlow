// The selected account's estimate (Build 21): the headline status, then each figure the last saved Build 16
// calculation recorded, each opening its own explanation (formula, operands, missing inputs, sources, contributing
// trades, rulebook and engine versions, limitations). Values are the engine's; a figure from an estimate that is not
// current is marked "Not current" and the headline is Unknown (a recorded Stop stays Stop).
import { Calculator, FileText, Info } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  Badge, Button, Dialog, Drawer, formatInstant, formatMoney, InlineNotice, MetricCard, MetricValueView, StatList, StatusIndicator,
} from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { tradePath } from "../../journal/components/presentation";
import { useRulebookVersion } from "../../references/hooks/references";
import { CalculateNow, CalculationExplanationDrawer } from "../../rulebooks/components/CalculationExplanation";
import { RuleResult } from "../../rulebooks/components/EngineResultView";
import { ruleLabel } from "../../rulebooks/view-models/compare";
import { versionState } from "../../rulebooks/view-models/versions";
import type { RulebookVersionDetail, EngineResult } from "@fundedflow/domain";
import type { SnapshotViewModel } from "../../insights/view-models/snapshot";
import type { TodayAccount } from "../hooks/today";
import { contributingTrades, metricsOf, metricStateWord, STALE_TEXT, type RiskTruth, type TodayMetric } from "../view-models/today";

export const DISCLAIMER = "Estimate. Verify with your firm's dashboard.";

function useVersionLabel(id: string | null) {
  const v = useRulebookVersion(id);
  if (id === null) return "No rulebook";
  return v.data ? `${v.data.rulebook.displayName} v${v.data.version.versionNumber} (${versionState(v.data).label})` : "Rulebook version " + id.slice(0, 8);
}

export function RiskSection({ account, today, current }: {
  account: AccountViewModel;
  today: TodayAccount;
  /** The rulebook version in force now, for the calculation's backing claims. */
  current: RulebookVersionDetail | null;
}) {
  const [calculating, setCalculating] = useState(false);
  const [fullRecord, setFullRecord] = useState(false);
  const { truth, headline: h } = today;
  const recorded = truth.kind === "current" || truth.kind === "stale" || truth.kind === "check-failed" ? truth : null;
  const snapshot = today.snapshot.data ?? null;
  return (
    <section className="ds-card td-panel td-risk" aria-labelledby="td-risk-title">
      <div className="td-panel-head">
        <h2 id="td-risk-title" className="ds-title">Risk estimate</h2>
        <div className="td-actions">
          {snapshot && <Button size="sm" variant="ghost" icon={<FileText size={16} aria-hidden="true" />} onClick={() => setFullRecord(true)}>Full calculation record</Button>}
          <Button size="sm" variant="primary" icon={<Calculator size={16} aria-hidden="true" />} onClick={() => setCalculating(true)}>Calculate estimate</Button>
        </div>
      </div>
      {/* Polite, so a status change after a recalculation or switch is announced once without stealing focus. */}
      <div className="td-headline" role="status" aria-live="polite">
        <StatusIndicator status={h.status} label={h.label} className="td-status" />
        <p className="td-headline-detail">{h.detail}</p>
        {h.lastRecorded && <p className="ds-faint td-headline-detail">{h.lastRecorded}</p>}
      </div>
      {truth.kind === "stale" && (
        <InlineNotice tone="warning" live="off" title="The last estimate is not current">
          <ul className="td-list">{truth.reasons.map(r => <li key={r}>{STALE_TEXT[r]}</li>)}</ul>
          Calculate again to get an estimate for now. The old one is kept as it was.
        </InlineNotice>
      )}
      {truth.kind === "none" && (
        <p className="ds-faint">Limits, room left and a status appear once you calculate an estimate; until then every figure is Unknown.</p>
      )}
      {truth.kind === "read-failed" && <InlineNotice tone="error" title="The last estimate couldn't be read">Nothing is shown in its place. Try again from the recovery controls, or calculate a new estimate.</InlineNotice>}
      {truth.kind === "legacy" && <InlineNotice tone="info" live="off" title="Recorded before the rules engine">The last calculation has no engine record, so it gives no status. Open the full record to see it as stored, or calculate a new estimate.</InlineNotice>}
      {recorded && <Metrics account={account} truth={recorded} snapshot={recorded.snapshot} />}
      <p className="td-disclaimer"><Info size={14} aria-hidden="true" /> {DISCLAIMER} Not live: built from closed trades and checkpoints you recorded, not from your broker.</p>
      <Dialog open={calculating} onOpenChange={setCalculating} size="lg" title="Calculate estimate"
        description="Runs the rules engine on this account's records as of now and saves a new estimate. Earlier estimates are kept.">
        <CalculateNow accountId={account.id} currency={account.currency} current={current} timeZone={account.timezone} onSaved={() => setCalculating(false)} />
      </Dialog>
      {snapshot && <CalculationExplanationDrawer open={fullRecord} onOpenChange={setFullRecord} accountId={account.id} current={current} timeZone={account.timezone} />}
    </section>
  );
}

type Recorded = Extract<RiskTruth, { kind: "current" | "stale" | "check-failed" }>;

function Metrics({ account, truth, snapshot }: { account: AccountViewModel; truth: Recorded; snapshot: SnapshotViewModel }) {
  const [open, setOpen] = useState<TodayMetric["key"] | null>(null);
  const fmt = (v: string | null) => formatMoney(v, { signed: false, currency: account.currency, dp: 2 });
  const metrics = metricsOf(truth.result, account.currency, fmt);
  const notCurrent = truth.kind !== "current";
  const selected = metrics.find(m => m.key === open) ?? null;
  return (
    <>
      <div className="td-metrics" role="list" aria-label="Estimated figures">
        {metrics.map(m => {
          const word = metricStateWord(m.state);
          return (
            <div role="listitem" key={m.key} className="td-metric">
              <MetricCard label={m.label} value={m.value} stale={notCurrent} asOf={truth.result.asOf} timeZone={account.timezone} sub={m.sub} basis={m.basis}
                action={<>
                  {word && <Badge tone={m.state === "conflicting" ? "loss" : m.state === "manual" ? "flow" : "neutral"}>{word}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setOpen(m.key)} aria-label={`How ${m.label.toLowerCase()} is calculated`}>Explain</Button>
                </>} />
            </div>
          );
        })}
      </div>
      <Drawer open={selected !== null} onOpenChange={o => { if (!o) setOpen(null); }} width={560}
        title={selected ? `${selected.label}: how it's calculated` : "How it's calculated"} description="As the saved calculation recorded it. Nothing here is recalculated.">
        {selected && <MetricExplanation account={account} truth={truth} snapshot={snapshot} metric={selected} />}
      </Drawer>
    </>
  );
}

function MetricExplanation({ account, truth, snapshot, metric }: { account: AccountViewModel; truth: Recorded; snapshot: SnapshotViewModel; metric: TodayMetric }) {
  const r: EngineResult = truth.result;
  const tz = account.timezone;
  const at = (v: string | null) => formatInstant(v, { timeZone: tz, year: true, zoneName: true });
  const version = useRulebookVersion(r.rulebookVersionId);
  const versionLabel = useVersionLabel(r.rulebookVersionId);
  const rule = metric.outcome ? version.data?.rules.find(x => x.ruleKey === metric.outcome!.ruleKey) : undefined;
  const trades = contributingTrades(snapshot.explanation, r, metric);
  const word = metricStateWord(metric.state);
  return (
    <div className="td-explain">
      {truth.kind === "current"
        ? <InlineNotice tone="info" live="off" title="Current estimate">For trading day {r.tradingDay}, with this account's records as of {at(r.asOf)}. {DISCLAIMER}</InlineNotice>
        : <InlineNotice tone="warning" live="off" title="Not current">
            {truth.kind === "stale" ? truth.reasons.map(x => STALE_TEXT[x]).join(" ") : "Its sources couldn't be checked again."} This is what the calculation recorded then.
          </InlineNotice>}
      <div className="td-explain-value">
        <span className="ds-label">{metric.label}</span>
        <span className="ds-num-xl"><MetricValueView value={metric.value} /></span>
        {word && <Badge>{word}</Badge>}
        {metric.sub && <span className="ds-faint">{metric.sub}</span>}
      </div>
      <p><span className="ds-label">Basis</span> {metric.basis}</p>
      {metric.outcome
        ? <RuleResult outcome={metric.outcome} label={rule ? ruleLabel(rule) : metric.outcome.ruleKey} currency={account.currency} />
        : metric.ruleType === null
          ? null
          : <p className="ds-faint">{metric.state === "no-rule" ? "The rulebook used has no rule of this kind, so there is nothing to measure." : "More than one rule of this kind was evaluated; open the full calculation record to see each."}</p>}
      <section aria-labelledby="td-contrib">
        <h3 id="td-contrib" className="ds-label">{metric.key === "dayPnl" || metric.key === "dailyLoss" ? `Trades on trading day ${r.tradingDay}` : "Closed trades in this calculation"} ({trades.length})</h3>
        {metric.key === "equity" ? <p className="ds-faint">None: open positions aren't recorded.</p>
          : trades.length === 0 ? <p className="ds-faint">None recorded in this calculation.</p>
          : (
            <ul className="td-list td-trades">
              {trades.slice(0, 50).map(t => (
                <li key={t.id}>
                  <Link to={tradePath(t.id)}>{t.symbol} {t.side}</Link>
                  <span className="ds-faint"> · {t.tradingDay} · exit {formatInstant(t.exitAt, { timeZone: tz })}</span>
                  <span className="ds-mono"> {t.realizedPnl === null ? "Unknown P&L" : formatMoney(t.realizedPnl, { currency: account.currency })}</span>
                </li>
              ))}
              {trades.length > 50 && <li className="ds-faint">and {trades.length - 50} more; see the Journal.</li>}
            </ul>
          )}
        <p className="ds-faint">As the calculation recorded them. A trade corrected since shows its current version when opened.</p>
      </section>
      <StatList label="Calculation basis" items={[
        { label: "Cutoff (as of)", value: at(r.asOf) },
        { label: "Newest data used", value: r.dataAsOf ? at(r.dataAsOf) : "No records" },
        { label: "Calculated at", value: at(snapshot.calculatedAt) },
        { label: "Trading day", value: r.tradingDay },
        { label: "Rulebook version", value: versionLabel },
        { label: "Engine", value: r.engineVersion },
        { label: "Inputs hash", value: <span className="ds-mono td-hash">{r.inputsHash}</span> },
      ]} />
      <section aria-labelledby="td-limits">
        <h3 id="td-limits" className="ds-label">Limitations</h3>
        <ul className="td-list ds-faint">
          {r.assumptions.map(a => <li key={a}>{a}</li>)}
          <li>Unrealized P&L, live peak equity and intraday trailing drawdown are not known from closed-trade exports.</li>
          <li>{DISCLAIMER}</li>
        </ul>
      </section>
      <p className="td-actions-left">
        <Link to={`/accounts/${encodeURIComponent(account.id)}/rulebook`}>Review rulebook</Link>
        <Link to="/journal?view=log">View trades</Link>
      </p>
    </div>
  );
}
