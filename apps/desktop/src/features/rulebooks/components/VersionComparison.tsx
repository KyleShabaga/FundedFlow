// Active-versus-proposed comparison (Build 19 block C). A real table per section with a caption,
// column headers and row headers, and the change spelled out in words, so it reads the same
// to a screen reader as it looks. Unchanged rows can be hidden; a change is never hidden.
import { useState } from "react";

import { Badge, Checkbox, EmptyState, type Tone } from "../../../design-system";
import type { ChangeKind, FieldChange, VersionComparison as Comparison } from "../view-models/compare";

const KIND: Record<ChangeKind, { label: string; tone: Tone }> = {
  added: { label: "Added", tone: "profit" },
  removed: { label: "Removed", tone: "loss" },
  changed: { label: "Changed", tone: "warn" },
  unchanged: { label: "Same", tone: "neutral" },
};

export function ChangeBadge({ kind }: { kind: ChangeKind }) {
  return <Badge tone={KIND[kind].tone}>{KIND[kind].label}</Badge>;
}

function Rows({ caption, rows, activeLabel, proposedLabel, showSame }: {
  caption: string; rows: FieldChange[]; activeLabel: string; proposedLabel: string; showSame: boolean;
}) {
  const visible = showSame ? rows : rows.filter(r => r.kind !== "unchanged");
  if (visible.length === 0) return null;
  return (
    <table className="rb-compare-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">{activeLabel}</th>
          <th scope="col">{proposedLabel}</th>
          <th scope="col">Change</th>
        </tr>
      </thead>
      <tbody>
        {visible.map(r => (
          <tr key={r.field} className={`rb-compare-${r.kind}`}>
            <th scope="row">{r.label}</th>
            <td>{r.before ?? <span className="ds-faint">Not in this version</span>}</td>
            <td>{r.after ?? <span className="ds-faint">Not in this version</span>}</td>
            <td><ChangeBadge kind={r.kind} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VersionComparison({ comparison, activeLabel, proposedLabel }: {
  comparison: Comparison; activeLabel: string; proposedLabel: string;
}) {
  const [showSame, setShowSame] = useState(false);
  return (
    <div className="rb-compare">
      <div className="rb-compare-head">
        <p role="status" className="rb-compare-count">
          {comparison.changeCount === 0 ? "No differences from the version in use." : `${comparison.changeCount} difference${comparison.changeCount === 1 ? "" : "s"} from the version in use.`}
        </p>
        <Checkbox label="Show unchanged fields" checked={showSame} onChange={e => setShowSame(e.target.checked)} />
      </div>
      <Rows caption="Version details" rows={comparison.meta} activeLabel={activeLabel} proposedLabel={proposedLabel} showSame={showSame} />
      {comparison.rules.map(rule => (
        <section key={rule.ruleKey} className="rb-compare-rule" aria-label={`${rule.label}: ${KIND[rule.kind].label}`}>
          {(showSame || rule.kind !== "unchanged") && (
            <Rows caption={`${rule.label} (${KIND[rule.kind].label.toLowerCase()})`} rows={rule.fields} activeLabel={activeLabel} proposedLabel={proposedLabel} showSame={showSame || rule.kind !== "changed"} />
          )}
        </section>
      ))}
      {comparison.changeCount === 0 && !showSame && (
        <EmptyState kind="no-matches" size="compact" title="Nothing differs" description="Show unchanged fields to read both versions in full." />
      )}
      <p className="ds-faint rb-footnote">
        Values are what each version states. Unknown, None, Off and Manual check are shown as stated, never as zero. Nothing here is a calculation.
      </p>
    </div>
  );
}
