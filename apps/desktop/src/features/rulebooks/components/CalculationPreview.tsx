// Draft calculation preview (Build 19 block D) on the Build 16 engine. The account's canonical inputs
// are read for an explicit cutoff (read-only), and `simulateRulebookVersion` evaluates the proposed
// version, including valid unsaved edits, as if it governed the account. Nothing is assigned,
// published or saved; the result is labelled a simulation, never the account's status.
import { simulateRulebookVersion, type RulebookSimulation, type RulebookVersionDetail } from "@fundedflow/domain";
import { useMemo, useState } from "react";

import { Button, formatInstant, InlineNotice, StateBoundary, UnavailableState } from "../../../design-system";
import { retryRead, toAsyncState } from "../../shared/presentation";
import { useCalculationInputs } from "../hooks/rulebooks";
import { ruleLabel } from "../view-models/compare";
import { validateForm, type DraftForm } from "../view-models/draft-form";
import { useCalculationSettings } from "./CalculationSettings";
import { EngineResultView } from "./EngineResultView";

const minute = () => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();

/** The version to simulate: the stored one, or with the editor's unsaved edits when they are valid. */
export function proposedVersion(d: RulebookVersionDetail, form: DraftForm | null): { detail: RulebookVersionDetail; usesUnsavedEdits: boolean; editsInvalid: boolean } {
  if (!form) return { detail: d, usesUnsavedEdits: false, editsInvalid: false };
  if (validateForm(form, { supersedes: d.version.supersedesVersionId !== null }).length > 0) return { detail: d, usesUnsavedEdits: false, editsInvalid: true };
  const rules = form.rules.map((r, i) => ({
    ...r,
    id: d.rules.find(s => s.ruleKey === r.ruleKey)?.id ?? `${d.version.id}:unsaved:${i}`,
    rulebookVersionId: d.version.id,
    displayOrder: i,
  })) as RulebookVersionDetail["rules"];
  const ids = new Set(rules.map(r => r.id));
  return {
    detail: {
      ...d,
      version: { ...d.version, changeReason: form.changeReason.trim() || null, effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo, capturedAt: form.capturedAt },
      rules,
      claims: d.claims.filter(c => ids.has(c.ruleDefinitionId)),
    },
    usesUnsavedEdits: true,
    editsInvalid: false,
  };
}

export function CalculationPreview({ accountId, currency, timeZone, version, form }: {
  accountId: string; currency: string; timeZone: string; version: RulebookVersionDetail; form: DraftForm | null;
}) {
  const [asOf, setAsOf] = useState(minute);
  const settings = useCalculationSettings(currency, null, accountId);
  const inputs = useCalculationInputs(accountId, asOf, settings.coverage, settings.policy);
  const proposal = useMemo(() => proposedVersion(version, form), [version, form]);
  const label = `${version.rulebook.displayName} v${version.version.versionNumber}${proposal.usesUnsavedEdits ? " (with your unsaved edits)" : ""}`;
  return (
    <div className="rb-preview">
      <p className="ds-faint">
        Simulates {label} against this account's recorded trades, ledger and checkpoints as of {formatInstant(asOf, { timeZone, zoneName: true })}.{" "}
        <Button size="sm" variant="ghost" onClick={() => setAsOf(minute())}>Use now</Button>
      </p>
      {proposal.editsInvalid && (
        <InlineNotice tone="warning" live="polite" title="Your unsaved edits have errors">The preview uses the saved draft until the edits are valid.</InlineNotice>
      )}
      {settings.element}
      <StateBoundary state={toAsyncState(inputs)} label="calculation preview" onRetry={retryRead(inputs.refresh)} timeZone={timeZone}>
        {loaded => {
          let sim: RulebookSimulation;
          try {
            sim = simulateRulebookVersion(loaded.inputs, proposal.detail, loaded.policy);
          } catch {
            return <UnavailableState size="compact" title="This version can't be previewed" reason="Some of its values aren't valid for a calculation. Fix them in the editor." />;
          }
          const labels = Object.fromEntries(proposal.detail.rules.map(r => [r.ruleKey, ruleLabel(r)]));
          return <EngineResultView result={sim.result} mode="simulation" timeZone={timeZone} currency={currency} ruleLabels={labels} versionLabel={label} />;
        }}
      </StateBoundary>
    </div>
  );
}
