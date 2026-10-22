// Freshness first (Build 21, docs/design/screens/08-today.md): the times behind today's estimate, each labelled,
// because they are not interchangeable. A recent recalculation never makes an old checkpoint look new: the newest
// trade, the newest import, the newest firm checkpoint, the data in the last estimate, when it was calculated and
// the Rust trading day now are shown separately. P0-D05: the last trade, the last import and the check time show in
// the display time zone (Settings → Date and time); the other times and the trading day stay in the account's zone.
import type { FinancialObservation } from "@fundedflow/domain";
import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";

import { Badge, DisclosureCard, formatInstant, formatMoney, InlineNotice, StatList, StatusIndicator, type StatItem } from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import type { ImportViewModel } from "../../imports/view-models/import";
import { displayZoneName, useDisplayTimeZone } from "../../settings/display-time-zone";
import { tradePath, zoneLabel } from "../../journal/components/presentation";
import { reasonText } from "../../rulebooks/view-models/engine-wording";
import type { TodayAccount } from "../hooks/today";
import { checkpointSummary, latestTrade, openDiscrepancies, statedCoverage } from "../view-models/today";

export const CHECKPOINT_KIND: Record<FinancialObservation["kind"], string> = {
  opening_balance: "Opening balance", balance: "Balance", equity: "Equity", intraday_peak: "Intraday peak", eod_settlement: "End-of-day settlement",
};
const SOURCE: Record<FinancialObservation["sourceCategory"], string> = { firm_dashboard: "firm dashboard", statement: "statement", user_entered: "entered by you" };

const faint = (text: string) => <span className="ds-faint">{text}</span>;

// P0-D22: open or closed is one choice for the whole window session. It outlives data refreshes and the remount on
// an account change (the panel is keyed by account), and starts closed. Opening it reads nothing and checks nothing.
let detailsOpen = false;
const openListeners = new Set<() => void>();
const subscribeOpen = (listener: () => void) => { openListeners.add(listener); return () => { openListeners.delete(listener); }; };
const readOpen = () => detailsOpen;
function setDetailsOpen(open: boolean) {
  detailsOpen = open;
  openListeners.forEach(l => l());
}
/** Tests only: back to the first-run state. */
export function resetFreshnessDetails() { detailsOpen = false; }

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
  // The display zone converts the whole instant, date included, with that date's offset. Until the preference is
  // read nothing is converted, so a time never jumps from one zone to another.
  const display = useDisplayTimeZone();
  const shown = (v: string) => display.kind === "resolved" ? formatInstant(v, { timeZone: display.zone, year: true, zoneName: "offset" }) : "…";
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
        : <span>{shown(trade.exitAt ?? trade.entryAt)} · <Link to={tradePath(trade.id)}>{trade.symbol} {trade.exitAt ? "exit" : "entry (open)"}</Link></span>,
    },
    {
      label: "Last import",
      value: importing ? <StatusIndicator status="local" variant="inline" label="Import being saved…" />
        : lastImport === undefined ? faint("Checking…")
        : lastImport === null ? (imports === null ? <StatusIndicator status="unknown" variant="inline" label="Unknown" detail="Import history couldn't be read" /> : faint("No imports yet"))
        : <span>{shown(lastImport.completedAt)} · {lastImport.fileName}{" "}
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

  // Closed, the rows are hidden, so anything in them that changes how the page reads is said under the header.
  const attention: string[] = [];
  if (factsFailed) attention.push("Trades and the trading day couldn't be read");
  if (imports === null) attention.push("Import history couldn't be read");
  else if (!importing && lastImport && lastImport.status === "failed") attention.push("The last import failed");
  if (checkpoints === null && today.observations.error) attention.push("Checkpoints couldn't be read");
  if (facts && result && result.tradingDay !== facts.effectiveTradingDay) attention.push(`The last estimate is for ${result.tradingDay}, not trading day ${facts.effectiveTradingDay}`);

  const open = useSyncExternalStore(subscribeOpen, readOpen, readOpen);
  return (
    <DisclosureCard
      className="td-fresh"
      title="How fresh this is"
      open={open}
      onOpenChange={setDetailsOpen}
      summary={<>Checked against your records at {display.kind === "resolved" ? formatInstant(checkedAt, { timeZone: display.zone, zoneName: "offset" }) : "…"}</>}
      notices={<>
        {!open && attention.length > 0 && (
          <ul className="td-fresh-attention" aria-label="Needs attention">
            {attention.map(a => <li key={a}><StatusIndicator status="unknown" variant="inline" label={a} /></li>)}
          </ul>
        )}
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
      </>}
    >
      <StatList label="Data freshness" items={items} />
      {display.kind === "resolved" && (
        <p className="ds-faint td-fresh-zone">
          Last trade, last import and the check time show in {displayZoneName(display)}
          {display.source === "fallback" ? ", because the saved time zone can't be used" : ""}. Other times and trading days use the account's zone, {zoneLabel(tz)}.{" "}
          <Link to="/settings">Change in Settings</Link>
        </p>
      )}
    </DisclosureCard>
  );
}
