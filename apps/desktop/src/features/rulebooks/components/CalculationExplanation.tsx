// Calculation explanation (Build 19 block F), for the account rulebook page now and Today's drill-down
// later (Build 21). A stored Build 16 calculation is shown as the engine recorded it (EngineResultView)
// and is never presented as current just because it is the latest: its sources are read again for
// its cutoff and compared (isEngineResultCurrent), and an older trading day or another rulebook
// version is said plainly. Snapshots written before Build 16 are shown as recorded, generically.
// "Calculate now" saves a new calculation; earlier ones are kept. React computes nothing.
import type { RulebookVersionDetail } from "@fundedflow/domain";
import type { ReactNode } from "react";

import {
  Badge, Button, Drawer, formatInstant, InlineNotice, MutationFeedback, StateBoundary, StatList, StatusIndicator, type StatusKind,
  UnavailableState, useToast, zonedDay,
} from "../../../design-system";
import { useLatestSnapshot } from "../../insights/hooks/insights";
import type { SnapshotViewModel as Snapshot } from "../../insights/view-models/snapshot";
import { useRulebookVersion } from "../../references/hooks/references";
import { retryRead, toAsyncState, toMutationState } from "../../shared/presentation";
import { recordedEngineResult } from "../api/risk";
import { useCalculateRisk, useCalculationFreshness } from "../hooks/rulebooks";
import { ruleLabel } from "../view-models/compare";
import { notCalculated, versionState } from "../view-models/versions";
import { useCalculationSettings } from "./CalculationSettings";
import { EngineResultView } from "./EngineResultView";

const STATUS: Record<Snapshot["status"], { kind: StatusKind; label: string }> = {
  safe: { kind: "success", label: "Safe (estimate)" },
  caution: { kind: "caution", label: "Caution (estimate)" },
  stop: { kind: "danger", label: "Stop (estimate)" },
  unknown: { kind: "unknown", label: "Unknown" },
  needs_setup: { kind: "unknown", label: "Needs setup" },
};

/** A pre-Build 16 explanation as nested labelled rows; values are shown as recorded. */
function Recorded({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined) return <span className="ds-faint">Not recorded</span>;
  if (typeof value !== "object") return <span className="ds-mono">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="ds-faint">None</span>;
    return <ol className="rb-recorded">{value.map((v, i) => <li key={i}><Recorded value={v} depth={depth + 1} /></li>)}</ol>;
  }
  if (depth > 4) return <span className="ds-mono">{JSON.stringify(value)}</span>;
  return (
    <dl className="rb-recorded">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd><Recorded value={v} depth={depth + 1} /></dd></div>
      ))}
    </dl>
  );
}

function Freshness({ accountId, snapshot, timeZone }: { accountId: string; snapshot: Snapshot; timeZone: string }) {
  const fresh = useCalculationFreshness(accountId, snapshot);
  const today = zonedDay(new Date().toISOString(), timeZone);
  const notToday = snapshot.tradingDay !== today;
  return (
    <div className="rb-freshness" role="status">
      {fresh.data?.kind === "current" && <Badge tone="profit">Sources unchanged for its cutoff</Badge>}
      {fresh.data?.kind === "changed" && <Badge tone="warn">Sources changed since it was calculated</Badge>}
      {fresh.data === undefined && !fresh.error && <span className="ds-faint">Checking its sources…</span>}
      {fresh.error && <span className="ds-faint">Couldn't check its sources</span>}
      {notToday && <Badge>Calculated for {snapshot.tradingDay}, not today ({today})</Badge>}
    </div>
  );
}

export function SnapshotExplanation({ snapshot, current, timeZone, accountId }: {
  snapshot: Snapshot;
  /** The version assigned now, to flag a calculation made with another version. */
  current: RulebookVersionDetail | null;
  timeZone: string;
  accountId: string;
}) {
  const recorded = recordedEngineResult(snapshot.explanation);
  const used = useRulebookVersion(snapshot.rulebookVersionId);
  const otherVersion = current !== null && snapshot.rulebookVersionId !== current.version.id;
  const versionLabel = used.data ? `${used.data.rulebook.displayName} v${used.data.version.versionNumber} (${versionState(used.data).label})` : snapshot.rulebookVersionId ?? "None";
  return (
    <div className="rb-explain">
      <Freshness accountId={accountId} snapshot={snapshot} timeZone={timeZone} />
      {otherVersion && (
        <InlineNotice tone="warning" live="off" title="Calculated with a different rulebook version">
          This was calculated {snapshot.rulebookVersionId ? `with ${versionLabel}` : "without a rulebook"}; the account now uses
          {` ${current.rulebook.displayName} v${current.version.versionNumber}`}. It is shown as recorded and was not recalculated.
        </InlineNotice>
      )}
      {recorded ? (
        <EngineResultView result={recorded.result} mode="recorded" timeZone={timeZone} currency={snapshot.accountCurrency} calculatedAt={snapshot.calculatedAt}
          versionLabel={versionLabel} ruleLabels={Object.fromEntries((used.data?.rules ?? []).map(r => [r.ruleKey, ruleLabel(r)]))} />
      ) : (
        <>
          <StatusIndicator status={STATUS[snapshot.status].kind} label={STATUS[snapshot.status].label} detail="Estimate. Verify with your firm's dashboard." />
          <InlineNotice tone="info" live="off" title="Recorded before the rules engine">This calculation has no structured engine record, so it is shown as it was stored.</InlineNotice>
          <StatList label="Calculation record" items={[
            { label: "Trading day", value: snapshot.tradingDay },
            { label: "Data as of", value: snapshot.dataAsOf ? formatInstant(snapshot.dataAsOf, { timeZone, year: true, zoneName: true }) : <span className="ds-faint">Not recorded</span> },
            { label: "Calculated at", value: formatInstant(snapshot.calculatedAt, { timeZone, year: true, zoneName: true }) },
            { label: "Rulebook version", value: versionLabel },
            { label: "Engine version", value: snapshot.engineVersion },
            { label: "Inputs hash", value: <span className="ds-mono rb-hash">{snapshot.inputsHash}</span> },
          ]} />
          {snapshot.statusReasons.length > 0 && <ul className="rb-plain-list">{snapshot.statusReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          <section aria-labelledby="rb-explain-engine">
            <h3 id="rb-explain-engine" className="ds-label">Recorded explanation</h3>
            <Recorded value={snapshot.explanation} />
          </section>
        </>
      )}
    </div>
  );
}

/** Rules the engine never calculates, so a reader knows they were not part of any figure. */
export function ManualRulesList({ version }: { version: RulebookVersionDetail }) {
  const manual = version.rules.map(r => ({ r, why: notCalculated(r) })).filter(x => x.why !== null);
  if (manual.length === 0) return null;
  return (
    <section aria-labelledby="rb-manual-rules" className="rb-manual">
      <h3 id="rb-manual-rules" className="ds-label">Not part of any calculation</h3>
      <ul className="rb-plain-list">
        {manual.map(({ r, why }) => <li key={r.id}><b>{ruleLabel(r)}</b> <Badge tone="flow">{r.supportStatus === "manual_only" ? "Manual check" : r.supportStatus === "unsupported" ? "Not tracked" : "Needs setup"}</Badge> <span className="ds-faint">{why}</span></li>)}
      </ul>
    </section>
  );
}

/** The explicit "calculate and save" action (also Today's Calculate estimate, Build 21). Never runs on its own. */
export function CalculateNow({ accountId, currency, current, onSaved }: { accountId: string; currency: string; current: RulebookVersionDetail | null; onSaved?: () => void }) {
  const settings = useCalculationSettings(accountId, currency, current);
  const calculate = useCalculateRisk(accountId);
  const toast = useToast();
  const run = async () => {
    try {
      const saved = await calculate.submit({ query: { accountId, asOf: new Date().toISOString(), coverage: settings.coverage }, policy: settings.policy });
      toast.show({ tone: "success", title: "Calculation saved", description: `Status ${saved.status}. Earlier calculations are kept.` });
      onSaved?.();
    } catch { /* MutationFeedback shows it. */ }
  };
  return (
    <section className="ds-card rb-panel" aria-labelledby="rb-calc-now">
      <h3 id="rb-calc-now" className="ds-title">Calculate now</h3>
      <p className="ds-faint">Runs the rules engine on this account's records as of now and saves the result as a new calculation. Nothing else changes.</p>
      {settings.element}
      <div className="rb-actions">
        <Button variant="primary" onClick={run} loading={calculate.isPending} disabled={!calculate.canSubmit || !settings.historyLoaded}>Calculate and save</Button>
      </div>
      <MutationFeedback state={toMutationState(calculate, { success: "Calculation saved." })} />
    </section>
  );
}

export function CalculationExplanation({ accountId, current, timeZone, currency, canCalculate = false }: {
  accountId: string; current: RulebookVersionDetail | null; timeZone: string; currency?: string; canCalculate?: boolean;
}) {
  const latest = useLatestSnapshot(accountId);
  return (
    <div className="rb-explain">
      <StateBoundary state={toAsyncState(latest, { emptyKind: "no-records" })} label="calculation" onRetry={retryRead(latest.refresh)} timeZone={timeZone}
        empty={{ "no-records": (
          <UnavailableState size="compact" title="No calculation recorded"
            reason="Nothing has been calculated for this account yet. Limits, room left and Safe / Stop appear here once a calculation is saved, with its inputs and formula." />
        ) }}>
        {snapshot => snapshot ? <SnapshotExplanation snapshot={snapshot} current={current} timeZone={timeZone} accountId={accountId} /> : null}
      </StateBoundary>
      {current && <ManualRulesList version={current} />}
      {canCalculate && currency && <CalculateNow accountId={accountId} currency={currency} current={current} />}
    </div>
  );
}

/** Today-compatible drawer (Build 21 opens it from a value). */
export function CalculationExplanationDrawer({ open, onOpenChange, accountId, current, timeZone }: {
  open: boolean; onOpenChange: (open: boolean) => void; accountId: string; current: RulebookVersionDetail | null; timeZone: string;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="How this was calculated" description="What the calculation recorded. Nothing here is recalculated." width={560}>
      <CalculationExplanation accountId={accountId} current={current} timeZone={timeZone} />
    </Drawer>
  );
}
