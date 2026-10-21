// Starting a draft (Build 19 block B). A draft is always a new version: published and historical
// versions are copied, never edited. Two targets:
// - the account's own rules (a private rulebook; created on first use), which are never verified;
// - a correction to a catalogue rulebook, which a named reviewer must verify before any account uses it.
import type { Rulebook, RulebookDraftInput, RulebookVersionDetail } from "@fundedflow/domain";
import { useState } from "react";

import { Button, Dialog, InlineNotice, MutationFeedback, RadioGroup, Textarea, TextField } from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useRulebookVersions } from "../../references/hooks/references";
import { fieldErrors, toMutationState } from "../../shared/presentation";
import { useCreateRulebookDraft } from "../hooks/rulebooks";
import { RulebookWriteReview } from "./RulebookWriteReview";

type Target = "account" | "catalogue";

/** The newest published version of a rulebook, which a new draft supersedes. */
function latestPublished(versions: readonly RulebookVersionDetail[] | undefined): RulebookVersionDetail | null {
  return (versions ?? []).find(v => v.version.verificationStatus !== "draft" && v.version.verificationStatus !== "rejected") ?? null;
}

export function StartDraftDialog({ open, onOpenChange, account, source, privateRulebook, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountViewModel;
  /** The version to copy; null starts from no rules. */
  source: RulebookVersionDetail | null;
  /** This account's own rulebook, if it has one. */
  privateRulebook: Rulebook | null;
  onCreated: (draft: RulebookVersionDetail) => void;
}) {
  const create = useCreateRulebookDraft(account.id);
  const catalogueSource = source !== null && source.rulebook.ownerAccountId === null;
  const [target, setTarget] = useState<Target>("account");
  const [name, setName] = useState(`${account.name} rules`);
  const [reason, setReason] = useState("");
  const own = useRulebookVersions(privateRulebook?.id ?? null);
  const base = target === "catalogue" ? source : latestPublished(own.data);
  const needsReason = base !== null;
  const errors = fieldErrors(create.error);
  const [local, setLocal] = useState<string | null>(null);
  const waiting = privateRulebook !== null && own.data === undefined && target === "account";

  const submit = async () => {
    setLocal(null);
    if (needsReason && reason.trim() === "") return setLocal("Say what you are changing and why: a new version of existing rules needs a reason.");
    if (target === "account" && !privateRulebook && name.trim() === "") return setLocal("Name your rules.");
    // With no version chosen, a new draft of the account's rules starts from its newest version.
    const from = source ?? base;
    const rules = (from?.rules ?? []).map(({ id: _id, rulebookVersionId: _v, ...r }) => r);
    const input: RulebookDraftInput = {
      rulebookId: target === "catalogue" ? source!.rulebook.id : privateRulebook?.id ?? null,
      newRulebook: target === "account" && !privateRulebook
        ? { providerId: source?.rulebook.providerId ?? null, ownerAccountId: account.id, slug: `account-${account.id.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase()}-${Date.now().toString(36)}`, displayName: name.trim(), description: null }
        : null,
      supersedesVersionId: base?.version.id ?? null,
      changeReason: reason.trim() || (source ? `Copied from ${source.rulebook.displayName} v${source.version.versionNumber}` : null),
      capturedAt: from?.version.capturedAt ?? new Date().toISOString(),
      effectiveFrom: from?.version.effectiveFrom ?? null,
      effectiveTo: from?.version.effectiveTo ?? null,
      rules,
      applicability: target === "catalogue" ? source!.applicability.map(a => ({ catalogueVersionId: a.catalogueVersionId, programmePhaseId: a.programmePhaseId, phasePathId: a.phasePathId })) : [],
    };
    try {
      onCreated(await create.submit({ input, reason: reason.trim() || null }));
    } catch { /* MutationFeedback shows it. */ }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!create.isPending) { create.reset(); onOpenChange(o); } }} dismissible={!create.isPending}
      title={source ? `Start a draft from ${source.rulebook.displayName} v${source.version.versionNumber}` : "Start your own rules"}
      description="A draft is a new version. The version you start from stays exactly as it is."
      footer={<>
        <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!create.canSubmit || waiting}>Create draft</Button>
      </>}>
      <div className="rb-form">
        {catalogueSource && (
          <RadioGroup<Target> label="Where the draft goes" name="rb-target" value={target} onValueChange={setTarget} options={[
            { value: "account", label: privateRulebook ? `My rules for this account (${privateRulebook.displayName})` : "My own rules for this account", description: "Private to this account and never verified. Use it to keep your own limits." },
            { value: "catalogue", label: `A correction to ${source!.rulebook.displayName}`, description: "Shared catalogue terms. A named reviewer must verify it before any account can use it." },
          ]} />
        )}
        {target === "account" && !privateRulebook && (
          <TextField label="Name" value={name} onChange={e => setName(e.target.value)} error={errors["newRulebook.displayName"]} />
        )}
        <Textarea label="What changes and why" rows={3} optional={!needsReason} value={reason} onChange={e => setReason(e.target.value)} error={errors.changeReason}
          description={needsReason ? `Required: this supersedes v${base!.version.versionNumber}.` : "Kept in the rulebook history."} />
        {base && <p className="ds-faint">The new draft will supersede {base.rulebook.displayName} v{base.version.versionNumber} once it is published. Until then nothing changes.</p>}
        {source && source.version.verificationStatus === "stale" && (
          <InlineNotice tone="warning" live="off" title="Starting from a stale version">A source contradicts this version. Check the conflicting claims while you edit.</InlineNotice>
        )}
        {local && <InlineNotice tone="error" title="Check the draft">{local}</InlineNotice>}
        {create.outcome === "uncertain-outcome"
          ? <RulebookWriteReview write={create} accountId={account.id} timeZone={account.timezone}
            rulebookId={target === "catalogue" ? source!.rulebook.id : privateRulebook?.id ?? null} />
          : <MutationFeedback state={toMutationState(create, { success: "Draft created." })} />}
      </div>
    </Dialog>
  );
}
