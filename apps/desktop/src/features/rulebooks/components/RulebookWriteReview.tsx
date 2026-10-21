// P0-03: what an uncertain rulebook write is checked against. Draft save, discard, publish, verify, start draft
// and assignment share one lock per account (hooks/rulebooks.ts), so whichever of those screens is open can
// release it: each shows the stored record its own write changes (the version, the rulebook's versions, or the
// account's assignments) plus the account's recorded rulebook activity, which every one of those writes appends to.
// The reads mount with this component; Check result re-reads all of them and a failed read keeps the lock.
import { formatInstant, StatList } from "../../../design-system";
import { useAccountRulebookAssignments, useRulebookVersion, useRulebookVersions } from "../../references/hooks/references";
import { UncertainOutcomeReview, type UncertainWrite } from "../../shared/UncertainOutcomeReview";
import { useRulebookEvents } from "../hooks/rulebooks";
import { EVENT_ACTIONS } from "../view-models/events";
import { versionState } from "../view-models/versions";
import { VersionName } from "./VersionName";

const RECENT = 5;

export function RulebookWriteReview({ write, accountId, timeZone, versionId, rulebookId, assignments = false, onAcknowledged }: {
  write: UncertainWrite;
  accountId: string;
  timeZone: string;
  /** A draft save, discard or publish: that version as stored now. */
  versionId?: string;
  /** A new draft: the versions of the rulebook it was added to (null: the account's own, not created yet). */
  rulebookId?: string | null;
  /** An assignment: the account's assignments as stored now. */
  assignments?: boolean;
  onAcknowledged?: () => void;
}) {
  const events = useRulebookEvents(accountId);
  const version = useRulebookVersion(versionId ?? null);
  const versions = useRulebookVersions(rulebookId ?? null);
  const assigned = useAccountRulebookAssignments(assignments ? accountId : null);
  const reads = [events, ...(versionId ? [version] : []), ...(rulebookId ? [versions] : []), ...(assignments ? [assigned] : [])];
  const at = (instant: string) => formatInstant(instant, { timeZone, year: true, zoneName: true });
  const v = version.data;
  return (
    <UncertainOutcomeReview write={write} what="the rulebook records" onAcknowledged={onAcknowledged}
      reviewReady={reads.every(r => r.data !== undefined && !r.error)}
      readReviewed={() => Promise.all(reads.map(r => r.refresh()))}>
      {versionId && v && (
        <StatList label="The version as saved now" items={[
          { label: "Version", value: `${v.rulebook.displayName} v${v.version.versionNumber}` },
          { label: "State", value: versionState(v).label },
          { label: "Last saved", value: at(v.version.updatedAt) },
          { label: "Rules", value: String(v.rules.length) },
          { label: "Reason for this version", value: v.version.changeReason ?? "None given" },
        ]} />
      )}
      {rulebookId && versions.data && (
        <StatList label="Versions of this rulebook as saved now" items={versions.data.slice(0, RECENT).map(x => ({
          label: `v${x.version.versionNumber}`, value: `${versionState(x).label} · last saved ${at(x.version.updatedAt)}`,
        }))} />
      )}
      {assignments && assigned.data && (assigned.data.length
        ? <StatList label="Assignments as saved now" items={[...assigned.data].reverse().slice(0, RECENT).map(a => ({
          label: `From ${a.effectiveFrom}`, value: <><VersionName id={a.rulebookVersionId} /> · {a.effectiveTo ? `until ${a.effectiveTo}` : "open"} · recorded {at(a.assignedAt)}</>,
        }))} />
        : <p>No rulebook is assigned to this account.</p>)}
      {events.data && (events.data.length
        ? (
          <div>
            <p className="ds-label">Recent rulebook activity for this account, newest first</p>
            <ol className="rb-plain-list" aria-label="Recent rulebook activity">
              {[...events.data].reverse().slice(0, RECENT).map(e => (
                <li key={e.id}><b>{EVENT_ACTIONS[e.action]}</b> {at(e.occurredAt)} · <VersionName id={e.rulebookVersionId} /></li>
              ))}
            </ol>
          </div>
        )
        : <p>No rulebook activity is recorded for this account.</p>)}
    </UncertainOutcomeReview>
  );
}
