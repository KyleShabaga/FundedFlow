// Effective-dated assignment of a version to this account attempt (Build 19 block E). The trader
// confirms the day, the version and the reason; the write names the open assignment this dialog
// saw, so a change made elsewhere meanwhile is a conflict, not a silent reassignment. Earlier
// days keep their version, and stored calculations are never rewritten.
import type { AccountRulebookAssignment, RulebookVersionDetail } from "@fundedflow/domain";
import { useState } from "react";

import { Button, Dialog, InlineNotice, MutationFeedback, Select, Textarea, TextField, zonedDay } from "../../../design-system";
import { fieldErrors, toMutationState } from "../../shared/presentation";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useAssignRulebookVersion } from "../hooks/rulebooks";
import { applicabilityText, catalogueNames, openAssignment, versionState } from "../view-models/versions";

const NO_PHASE = "__account__";
const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

export function AssignDialog({ open, onOpenChange, account, assignments, candidates, names, initialVersionId, onAssigned }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountViewModel;
  assignments: readonly AccountRulebookAssignment[];
  /** Versions the domain says this account may use (`canAssign`). */
  candidates: readonly RulebookVersionDetail[];
  names: ReturnType<typeof catalogueNames>;
  initialVersionId?: string | null;
  onAssigned?: (assignment: AccountRulebookAssignment) => void;
}) {
  const assign = useAssignRulebookVersion(account.id);
  const today = zonedDay(new Date().toISOString(), account.timezone);
  const latest = assignments.reduce<string | null>((m, a) => (m === null || a.effectiveFrom > m ? a.effectiveFrom : m), null);
  const open_ = openAssignment(assignments);
  const [versionId, setVersionId] = useState<string>(initialVersionId && candidates.some(c => c.version.id === initialVersionId) ? initialVersionId : candidates[0]?.version.id ?? "");
  const chosen = candidates.find(c => c.version.id === versionId) ?? null;
  const [where, setWhere] = useState<string>(NO_PHASE);
  const [day, setDay] = useState(latest !== null && latest >= today ? "" : today);
  const [reason, setReason] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  const errors = fieldErrors(assign.error);
  const phaseOptions = [
    { value: NO_PHASE, label: "This account only (no catalogue phase)" },
    ...(chosen?.applicability ?? []).map(a => ({ value: `${a.programmePhaseId}|${a.phasePathId ?? ""}`, label: applicabilityText(names, a.programmePhaseId, a.phasePathId) })),
  ];
  const submit = async () => {
    setLocal(null);
    if (!chosen) return setLocal("Choose a version.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setLocal("Choose the first trading day.");
    if (isWeekend(day)) return setLocal("Trading days run Monday to Friday: choose a weekday.");
    if (latest !== null && day <= latest) return setLocal(`The account already has a rulebook from ${latest}. Choose a later day.`);
    const [phase, path] = where === NO_PHASE ? [null, null] : where.split("|");
    try {
      const result = await assign.submit({
        input: { accountId: account.id, rulebookVersionId: chosen.version.id, effectiveFrom: day, programmePhaseId: phase || null, phasePathId: path || null, accountPhaseEventId: null },
        guard: { expectedOpenAssignmentId: open_?.id ?? null, actor: "local_user", reason: reason.trim() || null },
      });
      onAssigned?.(result);
      onOpenChange(false);
    } catch { /* MutationFeedback shows it. */ }
  };
  const state = toMutationState(assign, { success: "Rulebook assigned." });
  const conflict = assign.error?.category === "conflict";
  return (
    <Dialog open={open} onOpenChange={o => { if (!assign.isPending) { assign.reset(); onOpenChange(o); } }} dismissible={!assign.isPending} hideClose={assign.isPending}
      title="Assign a rulebook version" description="Choose the version and the first trading day it governs this account."
      footer={<>
        <Button onClick={() => onOpenChange(false)} disabled={assign.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={assign.isPending} disabled={!chosen || !assign.canSubmit}>{day ? `Assign from ${day}` : "Assign"}</Button>
      </>}>
      {candidates.length === 0 ? (
        <InlineNotice tone="info" live="off" title="No version can be assigned yet">
          A catalogue version must be verified, and account rules must be published, before they can govern an account.
        </InlineNotice>
      ) : (
        <div className="rb-form">
          <Select label="Version" options={candidates.map(c => ({ value: c.version.id, label: `${c.rulebook.displayName} · v${c.version.versionNumber} · ${versionState(c).label}` }))}
            value={versionId} onValueChange={v => { setVersionId(v); setWhere(NO_PHASE); }} error={errors.rulebookVersionId} />
          {chosen && chosen.applicability.length > 0 && (
            <Select label="Applies to" description="The catalogue phase or path this account is in. Rules are never borrowed from another phase."
              options={phaseOptions} value={where} onValueChange={setWhere} error={errors.programmePhaseId} />
          )}
          <TextField label="First trading day" type="date" value={day} onChange={e => setDay(e.target.value)} min={latest ?? undefined}
            description={`In ${account.timezone}. ${latest ? `After ${latest}, the latest assignment.` : "Days before it have no rulebook."}`} error={errors.effectiveFrom} />
          <Textarea label="Reason" optional rows={2} value={reason} onChange={e => setReason(e.target.value)} description="Kept in the rulebook history." />
          {chosen && (
            <InlineNotice tone="info" live="off" title="What changes">
              From {day || "the chosen day"}, {account.name} uses {chosen.rulebook.displayName} v{chosen.version.versionNumber}
              {open_ ? "; the current assignment ends that day. Earlier days keep their version." : "."} Stored calculations are not rewritten.
              {chosen.rulebook.ownerAccountId !== null && " These are your own rules: results based on them are estimates, never the firm's verified terms."}
            </InlineNotice>
          )}
          {local && <InlineNotice tone="error" title="Check the assignment">{local}</InlineNotice>}
          <MutationFeedback state={state} />
          {conflict && <p className="ds-faint">Someone changed this account's rulebook in another window. Close this dialog to see the current assignments, then try again.</p>}
        </div>
      )}
    </Dialog>
  );
}
