// Calculation explanation (Build 19 block F), for the account rulebook page now and Today's
// drill-down later (Build 21). It shows what a stored calculation recorded (the engine's own
// explanation, its rulebook and engine versions, inputs hash, data-as-of and calculated-at),
// and nothing it did not record: React never recomputes a figure. Until the rules engine
// (Build 16) writes snapshots there are none, and the panel says so.
import type { RulebookVersionDetail } from "@fundedflow/domain";
import type { ReactNode } from "react";

import { Badge, Drawer, formatInstant, InlineNotice, StateBoundary, StatList, StatusIndicator, type StatusKind, UnavailableState } from "../../../design-system";
import { useLatestSnapshot } from "../../insights/hooks/insights";
import type { SnapshotViewModel as Snapshot } from "../../insights/view-models/snapshot";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { ruleLabel } from "../view-models/compare";
import { notCalculated } from "../view-models/versions";

const STATUS: Record<Snapshot["status"], { kind: StatusKind; label: string }> = {
  safe: { kind: "success", label: "Safe (estimate)" },
  caution: { kind: "caution", label: "Caution (estimate)" },
  stop: { kind: "danger", label: "Stop (estimate)" },
  unknown: { kind: "unknown", label: "Unknown" },
  needs_setup: { kind: "unknown", label: "Needs setup" },
};

/** The engine's explanation JSON as nested labelled rows; values are shown as recorded. */
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

export function SnapshotExplanation({ snapshot, current, timeZone }: {
  snapshot: Snapshot;
  /** The version assigned now, to flag a calculation made with another version. */
  current: RulebookVersionDetail | null;
  timeZone: string;
}) {
  const status = STATUS[snapshot.status];
  const otherVersion = current !== null && snapshot.rulebookVersionId !== current.version.id;
  return (
    <div className="rb-explain">
      <StatusIndicator status={status.kind} label={status.label} detail="Estimate. Verify with your firm's dashboard." />
      {otherVersion && (
        <InlineNotice tone="warning" live="off" title="Calculated with a different rulebook version">
          This was calculated {snapshot.rulebookVersionId ? "with another rulebook version" : "without a rulebook"}; the account now uses
          {` ${current.rulebook.displayName} v${current.version.versionNumber}`}. It is shown as recorded and was not recalculated.
        </InlineNotice>
      )}
      <StatList label="Calculation record" items={[
        { label: "Trading day", value: snapshot.tradingDay },
        { label: "Data as of", value: snapshot.dataAsOf ? formatInstant(snapshot.dataAsOf, { timeZone, year: true, zoneName: true }) : <span className="ds-faint">Not recorded</span> },
        { label: "Calculated at", value: formatInstant(snapshot.calculatedAt, { timeZone, year: true, zoneName: true }) },
        { label: "Rulebook version", value: snapshot.rulebookVersionId ?? <span className="ds-faint">None</span> },
        { label: "Engine version", value: snapshot.engineVersion },
        { label: "Inputs hash", value: <span className="ds-mono rb-hash">{snapshot.inputsHash}</span> },
        { label: "Data source", value: snapshot.dataSource },
        { label: "Fees included", value: snapshot.feesIncluded ? "Yes" : "No" },
        { label: "Unrealized P&L included", value: snapshot.unrealizedIncluded ? "Yes" : "No" },
      ]} />
      {snapshot.statusReasons.length > 0 && (
        <section aria-labelledby="rb-explain-reasons">
          <h3 id="rb-explain-reasons" className="ds-label">Why this status</h3>
          <ul className="rb-plain-list">{snapshot.statusReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </section>
      )}
      <section aria-labelledby="rb-explain-engine">
        <h3 id="rb-explain-engine" className="ds-label">Formula, inputs and contributing records (as the engine recorded them)</h3>
        <Recorded value={snapshot.explanation} />
      </section>
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

export function CalculationExplanation({ accountId, current, timeZone }: { accountId: string; current: RulebookVersionDetail | null; timeZone: string }) {
  const latest = useLatestSnapshot(accountId);
  return (
    <div className="rb-explain">
      <StateBoundary state={toAsyncState(latest, { emptyKind: "no-records" })} label="calculation" onRetry={retryRead(latest.refresh)} timeZone={timeZone}
        empty={{ "no-records": (
          <UnavailableState size="compact" title="No calculation recorded"
            reason="The rules engine isn't connected in this version, so nothing has been calculated for this account. Limits, room left and Safe / Stop appear here only when the engine records them, with its inputs and formula." />
        ) }}>
        {snapshot => snapshot ? <SnapshotExplanation snapshot={snapshot} current={current} timeZone={timeZone} /> : null}
      </StateBoundary>
      {current && <ManualRulesList version={current} />}
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
