// One rulebook version for one account (Build 19 blocks B–E): its rules, and for a draft the editor,
// a comparison with the version in use, a simulated calculation preview (Build 16 engine) and review/publish. Published versions
// are read-only; starting a draft copies them. Every write names the revision it was made from.
import { ruleTypes, type RulebookVersionDetail, type RuleType } from "@fundedflow/domain";
import { ArrowLeft, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  Badge, Button, Checkbox, ConfirmDialog, focusFirstInvalid, formatInstant, InlineNotice, MutationFeedback, Select, StateBoundary,
  StatList, TabPanel, Tabs, Textarea, TextField, UnavailableState, useToast, ValidationSummary,
} from "../../../design-system";
import { useRulebookVersion } from "../../references/hooks/references";
import { isWindowClose, useLeave } from "../../shared/hooks/use-leave-guard";
import { retryRead, toAsyncState, toMutationState } from "../../shared/presentation";
import { useDiscardRulebookDraft, usePublishIssues, usePublishRulebookVersion, useSaveRulebookDraft } from "../hooks/rulebooks";
import { compareVersions, type ComparableVersion } from "../view-models/compare";
import { formFromDetail, formToUpdate, isDirty, newRule, validateForm, type DraftForm, type FormIssue } from "../view-models/draft-form";
import { RULE_TYPE_LABELS } from "../view-models/rule-fields";
import { applicabilityText, assignableVersions, isEditable, versionState } from "../view-models/versions";
import { AssignDialog } from "./AssignDialog";
import { useAccountRulebookContext, type AccountRulebookContext } from "./context";
import { CalculationPreview } from "./CalculationPreview";
import { RulebookWriteReview } from "./RulebookWriteReview";
import { RuleCard } from "./RuleCard";
import { fieldIdFor } from "./RuleParameterFields";
import { StartDraftDialog } from "./StartDraftDialog";
import { forgetEdits, keepEdits, keptEdits, useLeaveGuard } from "./unsaved";
import { VersionComparison } from "./VersionComparison";
import "./rulebooks.css";

const toDay = (instant: string | null) => (instant ? instant.slice(0, 10) : "");
const fromDay = (day: string) => (day ? `${day}T00:00:00.000Z` : null);

function VersionFacts({ d, ctx }: { d: RulebookVersionDetail; ctx: AccountRulebookContext }) {
  const tz = ctx.timeZone;
  const at = (v: string | null) => (v ? formatInstant(v, { timeZone: tz, year: true, zoneName: true }) : <span className="ds-faint">Not stated</span>);
  const provider = ctx.names.provider(d.rulebook.providerId);
  return (
    <StatList label="Version details" items={[
      { label: "Provider", value: provider ?? (d.rulebook.providerId ? <span className="ds-faint">Not in the catalogue</span> : <span className="ds-faint">None (your own rules)</span>) },
      { label: "Rulebook", value: d.rulebook.displayName },
      { label: "Version", value: `v${d.version.versionNumber}` },
      { label: "State", value: <><Badge tone={versionState(d).tone}>{versionState(d).label}</Badge> <span className="ds-faint">{versionState(d).detail}</span></> },
      { label: "Applies to", value: d.applicability.length === 0 ? "This account only" : d.applicability.map(a => applicabilityText(ctx.names, a.programmePhaseId, a.phasePathId)).join("; ") },
      { label: "Provider-stated from", value: at(d.version.effectiveFrom) },
      { label: "Provider-stated until", value: at(d.version.effectiveTo) },
      { label: "Terms captured", value: at(d.version.capturedAt) },
      { label: "Verified", value: d.version.verifiedBy ? `${d.version.verifiedBy}, ${formatInstant(d.version.verifiedAt!, { timeZone: tz, year: true })}` : <span className="ds-faint">Not verified</span> },
      { label: "Reason for this version", value: d.version.changeReason ?? <span className="ds-faint">None given</span> },
      { label: "Last saved", value: at(d.version.updatedAt) },
    ]} />
  );
}

function asComparable(d: RulebookVersionDetail, form: DraftForm | null): ComparableVersion {
  if (!form) return d;
  return { ...d, version: { ...d.version, changeReason: form.changeReason || null, effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo, capturedAt: form.capturedAt }, rules: form.rules };
}

function ComparePanel({ d, form, ctx }: { d: RulebookVersionDetail; form: DraftForm | null; ctx: AccountRulebookContext }) {
  const active = ctx.currentVersion.data ?? null;
  const base = useRulebookVersion(d.version.supersedesVersionId);
  const [against, setAgainst] = useState<"active" | "base">(active ? "active" : "base");
  const other = against === "active" ? active : base.data ?? null;
  if (active?.version.id === d.version.id && !form) return <InlineNotice tone="info" live="off" title="This is the version in use">Nothing to compare: this account uses this version today.</InlineNotice>;
  const comparison = compareVersions(other, asComparable(d, form), {
    currency: ctx.account.data?.currency ?? null,
    applicability: a => applicabilityText(ctx.names, a.programmePhaseId, a.phasePathId),
    sources: (x, key) => {
      const claims = (x.claims ?? []).filter(c => x.rules.some(r => r.ruleKey === key && r.id === c.ruleDefinitionId));
      return claims.length === 0 ? "None recorded" : claims.map(c => `${ctx.names.source(c.sourceId)?.label ?? "Source"} (${c.claimStatus})`).join("; ");
    },
  });
  const options = [
    ...(active ? [{ value: "active" as const, label: `In use: ${active.rulebook.displayName} v${active.version.versionNumber}` }] : []),
    ...(d.version.supersedesVersionId ? [{ value: "base" as const, label: `The version it replaces${base.data ? `: v${base.data.version.versionNumber}` : ""}` }] : []),
  ];
  return (
    <div className="rb-form">
      {options.length > 1 && <Select label="Compare with" options={options} value={against} onValueChange={setAgainst} />}
      {!other && <InlineNotice tone="info" live="off" title="No version in use">This account has no rulebook today, so every value is new.</InlineNotice>}
      <VersionComparison comparison={comparison}
        activeLabel={other ? `v${other.version.versionNumber} (${against === "active" ? "in use" : "replaced"})` : "In use: none"}
        proposedLabel={`v${d.version.versionNumber}${form ? " (with your edits)" : ""}`} />
    </div>
  );
}

function DraftEditor({ d, ctx, onDirtyChange, onForm }: {
  d: RulebookVersionDetail; ctx: AccountRulebookContext; onDirtyChange: (dirty: boolean) => void; onForm: (form: DraftForm) => void;
}) {
  const accountId = ctx.account.data!.id;
  const save = useSaveRulebookDraft(accountId);
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const [baseline, setBaseline] = useState(() => ({ form: formFromDetail(d), revision: d.version.updatedAt }));
  const [form, setForm] = useState<DraftForm>(baseline.form);
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [kept, setKept] = useState(() => keptEdits(d.version.id, d.version.updatedAt));
  const [addType, setAddType] = useState<RuleType | "">("");
  const dirty = isDirty(form, baseline.form);
  useEffect(() => { onDirtyChange(dirty); onForm(form); }, [dirty, form, onDirtyChange, onForm]);
  useEffect(() => { if (dirty) keepEdits(d.version.id, baseline.revision, form); }, [dirty, form, d.version.id, baseline.revision]);
  const errors = Object.fromEntries([...issues, ...(save.error?.issues ?? [])].map(i => [i.field, i.message]));
  const conflict = save.error?.category === "conflict";
  const newer = d.version.updatedAt !== baseline.revision;
  const currency = ctx.account.data!.currency;

  const setRule = (i: number, rule: DraftForm["rules"][number]) => setForm(f => ({ ...f, rules: f.rules.map((r, j) => (j === i ? rule : r)) }));
  const move = (i: number, delta: -1 | 1) => setForm(f => {
    const rules = [...f.rules];
    const [r] = rules.splice(i, 1);
    rules.splice(i + delta, 0, r);
    return { ...f, rules };
  });
  const submit = async () => {
    const found = validateForm(form, { supersedes: d.version.supersedesVersionId !== null });
    setIssues(found);
    if (found.length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(root.current));
      return;
    }
    try {
      const saved = await save.submit({ id: d.version.id, expectedUpdatedAt: baseline.revision, input: formToUpdate(form), reason: form.changeReason || null });
      const next = formFromDetail(saved);
      setBaseline({ form: next, revision: saved.version.updatedAt });
      setForm(next);
      forgetEdits(d.version.id);
      toast.show({ tone: "success", title: "Draft saved", description: `v${saved.version.versionNumber} is still a draft: nothing is in use until it is published.` });
    } catch { /* Shown below; edits stay in the form. */ }
  };
  // After an uncertain save is reviewed: if the stored draft is exactly these edits, it did save, so it becomes
  // the baseline. Otherwise the edits stay unsaved in the form (a newer stored draft shows the conflict notice).
  const reviewed = () => {
    if (isDirty(form, formFromDetail(d))) return;
    setBaseline({ form: formFromDetail(d), revision: d.version.updatedAt });
    forgetEdits(d.version.id);
  };
  const reloadSaved = () => {
    const next = formFromDetail(d);
    setBaseline({ form: next, revision: d.version.updatedAt });
    setForm(next);
    setIssues([]);
    save.reset();
    forgetEdits(d.version.id);
  };
  const issueList = issues.map(i => ({ fieldId: fieldIdFor(i.field), message: i.field.startsWith("rules[") ? `Rule ${Number(/\d+/.exec(i.field)![0]) + 1}: ${i.message}` : i.message }));
  return (
    <div className="rb-editor" ref={root}>
      {kept && kept.sameRevision && (
        <InlineNotice tone="warning" title="Unsaved edits from earlier" live="polite" actions={<>
          <Button size="sm" onClick={() => { setForm(kept.form); setKept(null); }}>Restore them</Button>
          <Button size="sm" variant="ghost" onClick={() => { forgetEdits(d.version.id); setKept(null); }}>Discard them</Button>
        </>}>You left this draft with unsaved edits ({formatInstant(kept.keptAt, { timeZone: ctx.timeZone })}). They were kept in this window only.</InlineNotice>
      )}
      {kept && !kept.sameRevision && (
        <InlineNotice tone="info" title="Earlier edits not restored" onDismiss={() => { forgetEdits(d.version.id); setKept(null); }}>
          You had unsaved edits, but this draft was saved elsewhere since, so they were set aside rather than mixed in.
        </InlineNotice>
      )}
      {(conflict || (newer && dirty)) && save.outcome !== "uncertain-outcome" && (
        <InlineNotice tone="error" title="This draft changed somewhere else" actions={<Button size="sm" onClick={reloadSaved}>Load the saved draft (drops your edits)</Button>}>
          It was saved, published or discarded in another window after you opened it, so your edits weren't saved over it. Your edits are still here.
        </InlineNotice>
      )}
      {issues.length > 0 && <ValidationSummary issues={issueList} />}
      <section className="ds-card rb-panel" aria-labelledby="rb-draft-details">
        <h2 id="rb-draft-details" className="ds-title">Draft details</h2>
        <Textarea id="rb-changeReason" label="What changes and why" rows={2} optional={d.version.supersedesVersionId === null} value={form.changeReason}
          onChange={e => setForm(f => ({ ...f, changeReason: e.target.value }))} error={errors.changeReason} />
        <div className="rb-inline-fields">
          <TextField id="rb-effectiveFrom" type="date" label="Provider-stated from" optional value={toDay(form.effectiveFrom)}
            description="When the firm says these terms start (stored as 00:00 UTC). Not the day this account starts using them."
            onChange={e => setForm(f => ({ ...f, effectiveFrom: fromDay(e.target.value) }))} error={errors.effectiveFrom} />
          <TextField id="rb-effectiveTo" type="date" label="Provider-stated until" optional value={toDay(form.effectiveTo)}
            onChange={e => setForm(f => ({ ...f, effectiveTo: fromDay(e.target.value) }))} error={errors.effectiveTo} />
        </div>
      </section>
      {form.rules.length === 0 && <p className="ds-faint">No rules yet. Add the rules your firm states; leave values Unknown until you know them.</p>}
      {form.rules.map((rule, i) => (
        <RuleCard key={`${rule.ruleKey}-${i}`} rule={rule} index={i} count={form.rules.length} currency={currency} names={ctx.names}
          claims={d.claims.filter(c => d.rules.find(r => r.id === c.ruleDefinitionId)?.ruleKey === rule.ruleKey)}
          editor={{ onChange: r => setRule(i, r), onRemove: () => setForm(f => ({ ...f, rules: f.rules.filter((_, j) => j !== i) })), onMove: delta => move(i, delta), errors, disabled: save.isPending }} />
      ))}
      <div className="rb-add-rule">
        <Select<RuleType> label="Add a rule" size="sm" placeholder="Choose a rule type…" value={addType || undefined} onValueChange={setAddType}
          options={ruleTypes.map(t => ({ value: t, label: RULE_TYPE_LABELS[t] }))} />
        <Button icon={<Plus size={16} aria-hidden="true" />} disabled={!addType || save.isPending} onClick={() => {
          if (!addType) return;
          setForm(f => ({ ...f, rules: [...f.rules, newRule(addType, f.rules.map(r => r.ruleKey))] }));
          setAddType("");
        }}>Add rule</Button>
      </div>
      <footer className="rb-save-bar" aria-label="Save draft">
        <span role="status" className="ds-faint">{save.isPending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>
        {save.outcome === "uncertain-outcome"
          ? <RulebookWriteReview write={save} accountId={accountId} timeZone={ctx.timeZone} versionId={d.version.id} onAcknowledged={reviewed} />
          : <MutationFeedback state={toMutationState(save, { success: "Draft saved.", fieldId: fieldIdFor })} />}
        <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => { setForm(baseline.form); setIssues([]); forgetEdits(d.version.id); }}>Undo changes</Button>
        <Button variant="primary" loading={save.isPending} disabled={!dirty || !save.canSubmit} onClick={submit}>Save draft</Button>
      </footer>
    </div>
  );
}

function PublishPanel({ d, ctx, dirty, onPublished }: { d: RulebookVersionDetail; ctx: AccountRulebookContext; dirty: boolean; onPublished: (d: RulebookVersionDetail) => void }) {
  const accountId = ctx.account.data!.id;
  const publish = usePublishRulebookVersion(accountId);
  const discard = useDiscardRulebookDraft(accountId);
  const issues = usePublishIssues(d.version.id, d.version.updatedAt);
  const navigate = useNavigate();
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [confirm, setConfirm] = useState<"publish" | "verify" | "discard" | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const privateBook = d.rulebook.ownerAccountId !== null;
  const status = d.version.verificationStatus;
  const describe = (e: unknown) => (e as { category?: string; message?: string })?.category === "conflict"
    ? "It changed since you opened it, or a newer version was published. Reload the page, then start again from the newest version."
    : (e as { category?: string })?.category === "uncertain-outcome"
      ? "No answer came back, so it may have been saved. Close this and check the version on this page before trying again; nothing is sent again."
      : (e as { message?: string })?.message ?? "It didn't finish. Check the version before trying again.";
  const run = async (reviewerName: string | null) => {
    const result = await publish.submit({ id: d.version.id, reviewer: reviewerName, expectedUpdatedAt: d.version.updatedAt, reason: reason.trim() || null });
    onPublished(result);
  };
  // A publish or discard that did save makes this version read-only, so its review must stay reachable here too.
  const review = publish.outcome === "uncertain-outcome"
    ? <RulebookWriteReview write={publish} accountId={accountId} timeZone={ctx.timeZone} versionId={d.version.id} />
    : null;
  if (status !== "draft" && !(status === "needs_review" && !privateBook)) {
    return <div className="rb-form">{review}<InlineNotice tone="info" live="off" title={versionState(d).label}>{versionState(d).detail} Published versions can't be changed: start a draft to propose a new one.</InlineNotice></div>;
  }
  return (
    <div className="rb-form">
      {review}
      {dirty && <InlineNotice tone="warning" live="polite" title="Save your edits first">The checks and publishing use the saved draft, not unsaved edits.</InlineNotice>}
      <StateBoundary state={toAsyncState(issues)} label="publish checks" onRetry={retryRead(issues.refresh)}>
        {found => {
          const blocking = found.filter(i => i.field !== "reviewer");
          return blocking.length > 0
            ? <ValidationSummary title="Fix these before publishing" issues={blocking.map(i => ({ fieldId: undefined, message: `${i.field}: ${i.message}` }))} />
            : <InlineNotice tone="success" live="off" title="Ready">The saved draft passes every publish check.</InlineNotice>;
        }}
      </StateBoundary>
      {status === "draft" && (
        <section className="ds-card rb-panel" aria-labelledby="rb-publish-title">
          <h2 id="rb-publish-title" className="ds-title">Publish v{d.version.versionNumber}</h2>
          <p>{privateBook
            ? "Publishing freezes these rules as your account rules. They can then be assigned to this account from a trading day you choose. They are never shown as the firm's verified terms."
            : "Publishing freezes this version and sends it for review. It can't be assigned until a named reviewer verifies it against the source."}</p>
          <Textarea label="Note for the history" optional rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          <Checkbox label={privateBook ? "These are my rules for this account, and I understand this version can't be edited after it is published" : "I understand this version can't be edited after it is published"}
            checked={understood} onChange={e => setUnderstood(e.target.checked)} />
          <div className="rb-actions">
            <Button variant="danger" onClick={() => setConfirm("discard")} disabled={!discard.canSubmit}>Discard draft…</Button>
            <Button variant="primary" disabled={dirty || !understood || !publish.canSubmit || (issues.data?.some(i => i.field !== "reviewer") ?? true)} onClick={() => setConfirm("publish")}>Publish…</Button>
          </div>
        </section>
      )}
      {status === "needs_review" && !privateBook && (
        <section className="ds-card rb-panel" aria-labelledby="rb-verify-title">
          <h2 id="rb-verify-title" className="ds-title">Verify v{d.version.versionNumber}</h2>
          <p>Verifying records that a named person checked every rule against the provider's published source. It is a statement by that person, not an automatic check.</p>
          <TextField label="Reviewer" value={reviewer} onChange={e => setReviewer(e.target.value)} description="The person who checked it. Kept with the version." />
          <Checkbox label="Every rule matches the cited sources, and no source claim conflicts" checked={understood} onChange={e => setUnderstood(e.target.checked)} />
          <Textarea label="Note for the history" optional rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          <div className="rb-actions">
            <Button variant="primary" disabled={!understood || reviewer.trim() === "" || !publish.canSubmit} onClick={() => setConfirm("verify")}>Mark verified…</Button>
          </div>
        </section>
      )}
      {!review && <MutationFeedback state={toMutationState(publish, { success: "Published." })} />}
      <ConfirmDialog open={confirm === "publish"} onOpenChange={o => !o && setConfirm(null)} tone="neutral" title={`Publish ${d.rulebook.displayName} v${d.version.versionNumber}?`}
        confirmLabel="Publish" busyLabel="Publishing…" describeError={describe} onConfirm={() => run(null)}>
        {privateBook ? "It becomes your account rules, confirmed by you, and can be assigned to this account. Calculations with it are your own estimates. " : "It goes to review and can't be assigned yet. "}
        It can't be edited afterwards; the version it replaces stays in the history.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "verify"} onOpenChange={o => !o && setConfirm(null)} tone="neutral" title={`Mark v${d.version.versionNumber} verified by ${reviewer.trim()}?`}
        confirmLabel="Mark verified" busyLabel="Saving…" describeError={describe} onConfirm={() => run(reviewer.trim())}>
        Accounts can then be assigned this version. A version it replaces becomes superseded; accounts already using that keep it until you assign another one.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "discard"} onOpenChange={o => !o && setConfirm(null)} title={`Discard draft v${d.version.versionNumber}?`}
        confirmLabel="Discard draft" busyLabel="Discarding…" describeError={describe} onConfirm={async () => {
          if (discardReason.trim() === "") throw new Error("Say why you're discarding it.");
          await discard.submit({ id: d.version.id, expectedUpdatedAt: d.version.updatedAt, reason: discardReason.trim() });
          forgetEdits(d.version.id);
          navigate(`/accounts/${encodeURIComponent(accountId)}/rulebook`);
        }}>
        <p>The draft is kept in the history as discarded and can't be published. Nothing in use changes.</p>
        <Textarea label="Why" rows={2} value={discardReason} onChange={e => setDiscardReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

function VersionView({ d, ctx }: { d: RulebookVersionDetail; ctx: AccountRulebookContext }) {
  const navigate = useNavigate();
  const toast = useToast();
  const account = ctx.account.data!;
  const editable = isEditable(d) && account.archivedAt === null;
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [tab, setTab] = useState("rules");
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [assigning, setAssigning] = useState<RulebookVersionDetail | null>(null);
  useLeaveGuard(dirty, setLeaveTo);
  const leave = useLeave();
  const state = versionState(d);
  const candidates = useMemo(() => assignableVersions([d, ...(ctx.currentVersion.data ? [ctx.currentVersion.data] : [])], account.id), [d, ctx.currentVersion.data, account.id]);
  const back = `/accounts/${encodeURIComponent(account.id)}/rulebook`;
  return (
    <>
      <header className="rb-head">
        <div>
          <h2 className="rb-title">{d.rulebook.displayName} · v{d.version.versionNumber}</h2>
          <div className="acct-badges">
            <Badge tone={state.tone}>{state.label}</Badge>
            {ctx.currentVersion.data?.version.id === d.version.id && <span className="acct-active-pill">In use today</span>}
            <span className="ds-faint">for {account.name}</span>
          </div>
        </div>
        <div className="acct-head-actions">
          {!editable && account.archivedAt === null && <Button onClick={() => setStarting(true)}>Start a draft from this version</Button>}
          {!editable && candidates.some(c => c.version.id === d.version.id) && ctx.currentVersion.data?.version.id !== d.version.id && (
            <Button variant="primary" onClick={() => setAssigning(d)}>Assign to this account…</Button>
          )}
        </div>
      </header>
      {account.archivedAt !== null && <InlineNotice tone="info" live="off" title="Archived account: read-only">Restore the account to edit or assign its rulebook.</InlineNotice>}
      {d.version.verificationStatus === "stale" && <InlineNotice tone="warning" live="off" title="A source contradicts this version">See the conflicting claims under Rules. Start a draft to correct it.</InlineNotice>}
      <Tabs label="Version sections" value={tab} onValueChange={setTab} items={[
        { value: "rules", label: editable ? "Edit rules" : "Rules" },
        { value: "compare", label: "Compare" },
        { value: "preview", label: "Preview" },
        { value: "publish", label: editable ? "Review and publish" : "Status" },
        { value: "details", label: "Details" },
      ]}>
        <TabPanel value="rules" keepMounted={editable}>
          {editable
            ? <DraftEditor d={d} ctx={ctx} onDirtyChange={setDirty} onForm={setForm} />
            : <div className="rb-editor">{d.rules.map((r, i) => (
              <RuleCard key={r.id} rule={r as never} index={i} count={d.rules.length} currency={account.currency} names={ctx.names} claims={d.claims.filter(c => c.ruleDefinitionId === r.id)} />
            ))}{d.rules.length === 0 && <p className="ds-faint">This version has no rules.</p>}</div>}
        </TabPanel>
        <TabPanel value="compare"><ComparePanel d={d} form={editable ? form : null} ctx={ctx} /></TabPanel>
        <TabPanel value="preview">
          <CalculationPreview accountId={account.id} currency={account.currency} timeZone={account.timezone} version={d} form={editable ? form : null} />
        </TabPanel>
        <TabPanel value="publish">
          <PublishPanel d={d} ctx={ctx} dirty={dirty} onPublished={result => {
            toast.show({ tone: "success", title: `v${result.version.versionNumber}: ${versionState(result).label}` });
            setTab("publish");
            if (assignableVersions([result], account.id).length > 0) setAssigning(result);
          }} />
        </TabPanel>
        <TabPanel value="details"><VersionFacts d={d} ctx={ctx} /></TabPanel>
      </Tabs>
      <ConfirmDialog open={leaveTo !== null} onOpenChange={o => !o && setLeaveTo(null)} tone="neutral" title="Leave without saving?"
        confirmLabel="Leave" onConfirm={async () => { const to = leaveTo!; setDirty(false); setLeaveTo(null); leave(to); }}>
        {isWindowClose(leaveTo)
          ? "Your edits aren't saved. Closing the window discards them; they can't be restored later."
          : "Your edits aren't saved. They are kept in this window and offered back when you reopen this draft."}
      </ConfirmDialog>
      {starting && <StartDraftDialog open onOpenChange={setStarting} account={account} source={d} privateRulebook={ctx.privateRulebook}
        onCreated={draft => { setStarting(false); navigate(`/accounts/${encodeURIComponent(account.id)}/rulebook/versions/${encodeURIComponent(draft.version.id)}`); }} />}
      {assigning && ctx.assignments.data && (
        <AssignDialog open onOpenChange={o => !o && setAssigning(null)} account={account} assignments={ctx.assignments.data} names={ctx.names}
          candidates={assignableVersions([assigning], account.id)} initialVersionId={assigning.version.id} onAssigned={() => navigate(back)} />
      )}
    </>
  );
}

export function RulebookVersionPage() {
  const { accountId = "", versionId = "" } = useParams();
  const ctx = useAccountRulebookContext(accountId || null);
  const version = useRulebookVersion(versionId || null);
  return (
    <div className="acct-page rb-page">
      <Link to={`/accounts/${encodeURIComponent(accountId)}/rulebook`} className="acct-back"><ArrowLeft size={16} aria-hidden="true" />Rulebook overview</Link>
      <StateBoundary state={toAsyncState(ctx.account)} label="account" scope="route" onRetry={retryRead(ctx.account.refresh)}>
        {() => (
          <StateBoundary state={toAsyncState(version)} label="rulebook version" scope="route" onRetry={retryRead(version.refresh)}>
            {d => d.rulebook.ownerAccountId !== null && d.rulebook.ownerAccountId !== accountId
              ? <UnavailableState title="This version belongs to another account" reason="Account rules are private to their account attempt. Open it from that account instead." />
              : <VersionView key={d.version.id} d={d} ctx={ctx} />}
          </StateBoundary>
        )}
      </StateBoundary>
    </div>
  );
}
