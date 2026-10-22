// Freshness first (Build 21, docs/design/screens/08-today.md): the times behind today's estimate, each labelled,
// because they are not interchangeable. A recent recalculation never makes an old checkpoint look new: the newest
// trade, the newest import, the newest firm checkpoint, the data in the last estimate, when it was calculated and
// the Rust trading day now are shown separately, in the account's zone.
import type { FinancialObservation } from "@fundedflow/domain";
import { Link } from "react-router-dom";

import { Badge, formatInstant, formatMoney, InlineNotice, StatList, StatusIndicator, type StatItem } from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import type { ImportViewModel } from "../../imports/view-models/import";
import { tradePath, zoneLabel } from "../../journal/components/presentation";
import { reasonText } from "../../rulebooks/view-models/engine-wording";
import type { TodayAccount } from "../hooks/today";
import { checkpointSummary, latestTrade, openDiscrepancies, statedCoverage } from "../view-models/today";

export const CHECKPOINT_KIND: Record<FinancialObservation["kind"], string> = {
  opening_balance: "Opening balance", balance: "Balance", equity: "Equity", intraday_peak: "Intraday peak", eod_settlement: "End-of-day settlement",
};
const SOURCE: Record<FinancialObservation["sourceCategory"], string> = { firm_dashboard: "firm dashboard", statement: "statement", user_entered: "entered by you" };

const faint = (text: string) => <span className="ds-faint">{text}</span>;

export function FreshnessPanel({ account, today, imports, importing, checkedAt }: {
  account: AccountViewModel;
  today: TodayAccount;
  /** Import history; undefined while loading, null when it couldn't be read. */
  imports: ImportViewModel[] | null | undefined;
  /** An import for this account is being saved right now (this window). */
  importing: boolean;
  checkedAt: string;
}) {
  const tz = account.timezone;
  const at = (v: string | null | undefined) => formatInstant(v, { timeZone: tz, year: true, zoneName: true });
  const facts = today.facts.data?.inputs;
  const factsFailed = today.facts.error !== null && facts === undefined;
  const snapshot = today.snapshot.data ?? null;
  const result = today.truth.kind === "current" || today.truth.kind === "stale" || today.truth.kind === "check-failed" ? today.truth.result : null;

  const trade = facts ? latestTrade(facts.trades) : undefined;
  const lastImport = imports ? imports.reduce<ImportViewModel | null>((a, b) => (a === null || b.completedAt > a.completedAt ? b : a), null) : imports;
  const observations = today.observations.data;
  const checkpoints = observations ? checkpointSummary(observations) : null;
  const discrepancies = observations && today.reconciliations.data ? openDiscrepancies(today.reconciliations.data, observations) : [];
  const coverage = snapshot ? statedCoverage(snapshot.explanation) : null;
  const complete = coverage ? Object.values(coverage).every(v => v === "available") : null;

  const items: StatItem[] = [
    {
      label: "Last trade recorded",
      value: trade === undefined ? (factsFailed ? <StatusIndicator status="unknown" variant="inline" label="Unknown" detail="Trades couldn't be read" /> : faint("Checking…"))
        : trade === null ? faint("No trades yet")
        : <span>{at(trade.exitAt ?? trade.entryAt)} · <Link to={tradePath(trade.id)}>{trade.symbol} {trade.exitAt ? "exit" : "entry (open)"}</Link></span>,
    },
    {
      label: "Last import",
      value: importing ? <StatusIndicator status="local" variant="inline" label="Import being saved…" />
        : lastImport === undefined ? faint("Checking…")
        : lastImport === null ? (imports === null ? <StatusIndicator status="unknown" variant="inline" label="Unknown" detail="Import history couldn't be read" /> : faint("No imports yet"))
        : <span>{at(lastImport.completedAt)} · {lastImport.fileName}{" "}
            {lastImport.status === "failed" ? <Badge tone="loss">Failed</Badge>
              : lastImport.importedCount === 0 ? <Badge tone="warn">No new trades ({lastImport.duplicateCount} duplicates)</Badge>
              : <Badge tone="flow">{lastImport.importedCount} added</Badge>}</span>,
    },
    {
      label: "Last firm checkpoint",
      value: checkpoints === null ? (today.observations.error ? <StatusIndicator status="unknown" variant="inline" label="Unknown" detail="Checkpoints couldn't be read" /> : faint("Checking…"))
        : checkpoints.latest === null ? faint("None recorded")
        : <span>
            {CHECKPOINT_KIND[checkpoints.latest.kind]} {formatMoney(checkpoints.latest.value, { signed: false, currency: checkpoints.latest.currency })} at {at(checkpoints.latest.observedAt)}
            {" · "}{SOURCE[checkpoints.latest.sourceCategory]}{" "}
            {checkpoints.latest.confirmation === "user_confirmed" ? <Badge>Confirmed by you</Badge> : <Badge tone="warn">Not confirmed</Badge>}
          </span>,
    },
    { label: "Newest data in last estimate", value: snapshot ? (snapshot.dataAsOf ? at(snapshot.dataAsOf) : faint("No records")) : faint("No estimate saved") },
    {
      label: "Last estimate calculated",
      value: snapshot ? <span>{at(snapshot.calculatedAt)}{result ? <span className="ds-faint"> · cutoff {at(result.asOf)}</span> : null}</span> : faint("Never"),
    },
    {
      label: "Trading day now",
      value: facts ? <span>{facts.effectiveTradingDay} <span className="ds-faint">· days start {account.tradingDayResetTime}, {zoneLabel(tz)}</span>
          {result && result.tradingDay !== facts.effectiveTradingDay && <> <Badge tone="warn">Last estimate is for {result.tradingDay}</Badge></>}</span>
        : factsFailed ? <StatusIndicator status="unknown" variant="inline" label="Unknown" detail="The trading day couldn't be worked out" /> : faint("Checking…"),
    },
    {
      label: "History completeness",
      value: complete === null ? faint("Not stated") : complete ? <span>Stated complete for the last estimate <span className="ds-faint">(by you, not verified)</span></span>
        : <span>Not stated complete <span className="ds-faint">(trades, fees or ledger may be missing)</span></span>,
    },
  ];

  return (
    <section className="ds-card td-panel td-fresh" aria-labelledby="td-fresh-title">
      <div className="td-panel-head">
        <h2 id="td-fresh-title" className="ds-title">How fresh this is</h2>
        <span className="ds-faint">Checked against your records at {formatInstant(checkedAt, { timeZone: tz, zoneName: true })}</span>
      </div>
      <StatList label="Data freshness" items={items} />
      {checkpoints && checkpoints.conflicts.length > 0 && (
        <InlineNotice tone="warning" title="Checkpoints disagree">
          {checkpoints.conflicts.length === 1 ? "Two checkpoints" : `${checkpoints.conflicts.length} sets of checkpoints`} for the same moment have different values, so balances that use them are Unknown. Record a correction with the figure from the firm's dashboard.
        </InlineNotice>
      )}
      {discrepancies.map(d => (
        <InlineNotice key={d.id} tone="error" title={d.result.reconciliationStatus === "mismatched" ? "Your records differ from the firm's figure" : `Comparison ${d.result.reconciliationStatus}`}>
          {d.result.reconciliationStatus === "mismatched" && d.result.difference !== null
            ? `At ${at(d.result.asOf)} the firm showed ${formatMoney(d.observation.value, { signed: false, currency: d.observation.currency })}; your trades and ledger give ${formatMoney(d.result.derivedBalance, { signed: false, currency: d.observation.currency })} (difference ${formatMoney(d.result.difference, { currency: d.observation.currency })}). `
            : `${reasonText(d.result.reasonCode)} `}
          {d.result.nextVerificationAction}. Nothing was adjusted.
        </InlineNotice>
      ))}
    </section>
  );
}
