// Lifecycle actions on one account: change status (mark failed, passed, paused,
// closed or active again), archive, restore, and start a new evaluation attempt.
// Each uses the existing Rust command through its Build 14 hook. Nothing is
// deleted, nothing is inferred from losses, and a reset creates a new linked
// account instead of changing the old one.
import { accountStatuses, priorOutcomes, resetSources, statusLabels, toMicros, type RulebookDecision, type StatusChangeInput } from "@fundedflow/domain";
import { ArrowRight } from "lucide-react";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";

import {
  Button,
  ConfirmDialog,
  Dialog,
  focusFirstInvalid,
  FormSection,
  InlineNotice,
  MutationFeedback,
  RadioGroup,
  Select,
  StatList,
  StatusIndicator,
  Stepper,
  Textarea,
  TextField,
  useToast,
  ValidationSummary,
  type ValidationIssue,
  zonedWallTime,
  zonedWallTimeToInstant,
} from "../../../design-system";
import { readRulebooks, readRulebookVersions } from "../../references/api/references";
import { useCatalogue } from "../../references/hooks/references";
import { receipt } from "../../shared/contracts";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { fieldErrors, toMutationState } from "../../shared/presentation";
import { featureKeys } from "../../shared/query-keys";
import { useArchiveAccount, useChangeAccountStatus, useRestoreAccount, useResetAccountAttempt } from "../hooks/accounts";
import { useTradingDayAt } from "../hooks/trading-day";
import type { AccountViewModel } from "../view-models/account";
import { AccountWriteReview } from "./AccountWriteReview";
import { accountLabel } from "./presentation";

type Status = AccountViewModel["status"];

const STATUS_HELP: Record<Status, string> = {
  active: "Trading on this account.",
  paused: "Not trading for now; it can be made active again.",
  passed: "Passed the evaluation or phase.",
  failed: "Ended by the firm or a rule breach. The account and its trades are kept.",
  closed: "Stopped by you. The account and its trades are kept.",
};
const STATUS_ACTION: Record<Status, string> = {
  active: "Make active",
  paused: "Pause account",
  passed: "Mark passed",
  failed: "Mark failed",
  closed: "Close account",
};

/** "now" in the account's zone, as a datetime-local value. */
const nowIn = (timeZone: string) => zonedWallTime(Date.now(), timeZone);

/* ---------- Change status ---------- */

export interface StatusDialogProps {
  account: AccountViewModel;
  /** Preselected target, e.g. "failed" from "Mark failed". */
  initialStatus?: Status;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StatusDialog(props: StatusDialogProps) {
  return props.open ? <StatusDialogBody {...props} /> : null;
}

function StatusDialogBody({ account, initialStatus, open, onOpenChange }: StatusDialogProps) {
  const base = useId().replace(/:/g, "");
  const choices = accountStatuses.filter(s => s !== account.status);
  const [status, setStatus] = useState<Status | null>(initialStatus && initialStatus !== account.status ? initialStatus : null);
  const [effective, setEffective] = useState(nowIn(account.timezone));
  const [cause, setCause] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const change = useChangeAccountStatus(account.id);
  const server = fieldErrors(change.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!status) next.status = "Choose the new status";
    const effectiveAt = zonedWallTimeToInstant(effective, account.timezone);
    if (!effectiveAt) next.effectiveAt = "Enter a date and time";
    setErrors(next);
    if (Object.keys(next).length || !status) {
      queueMicrotask(() => focusFirstInvalid(form.current));
      return;
    }
    const input: StatusChangeInput = { status, effectiveAt, cause: cause.trim() || null, note: note.trim() || null };
    change
      .submit(input)
      .then(saved => {
        toast.show({ tone: "success", title: `${saved.name} is now ${statusLabels[saved.status].toLowerCase()}` });
        onOpenChange(false);
      })
      .catch(() => {});
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => !change.isPending && onOpenChange(next)}
      dismissible={!change.isPending}
      title={`Change status of ${account.name}`}
      description={`Now ${statusLabels[account.status].toLowerCase()}. The account, its trades and history stay as they are; nothing is archived or deleted.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={change.isPending}>Cancel</Button>
          <Button type="submit" form={`${base}-form`} variant={status === "failed" ? "danger" : "primary"} loading={change.isPending} disabled={!change.canSubmit && !change.isPending}>
            {change.isPending ? "Saving…" : status ? STATUS_ACTION[status] : "Change status"}
          </Button>
        </>
      }
    >
      <form id={`${base}-form`} ref={form} onSubmit={submit} noValidate className="acct-form">
        {change.outcome === "uncertain-outcome"
          ? <AccountWriteReview write={change} accountId={account.id} />
          : <MutationFeedback state={toMutationState(change, { success: "Status changed." })} />}
        <RadioGroup<Status>
          label="New status"
          required
          value={status}
          onValueChange={setStatus}
          error={errors.status ?? server.status}
          options={choices.map(s => ({ value: s, label: statusLabels[s], description: STATUS_HELP[s] }))}
        />
        <div className="acct-form-row">
          <TextField label="Took effect" type="datetime-local" required value={effective} onChange={e => setEffective(e.target.value)} error={errors.effectiveAt ?? server.effectiveAt} description={`In the account's time zone (${account.timezone}).`} />
        </div>
        <TextField label="Cause" optional value={cause} onChange={e => setCause(e.target.value)} error={server.cause} maxLength={500} description="In your words. Leave it empty if you don't know; FundedFlow never guesses a rule breach." />
        <Textarea label="Notes or evidence" optional value={note} onChange={e => setNote(e.target.value)} error={server.note} rows={3} placeholder="Where the firm said so, what happened" />
      </form>
    </Dialog>
  );
}

/* ---------- Archive and restore ---------- */

// TASK-024: an archive or restore with no answer may have been saved. An account that shows as archived offers no review
// (its menu has no Edit, Change status or Start new attempt), so its lock lasts until FundedFlow restarts.
const isUncertain = (error: unknown) => (error as { category?: string } | null)?.category === "uncertain-outcome";
const LOCKED_UNTIL_RESTART = "Archiving and restoring this account are locked until you restart FundedFlow; check the account after reopening it.";

export function ArchiveDialog({ account, open, onOpenChange, onArchived }: { account: AccountViewModel; open: boolean; onOpenChange: (open: boolean) => void; onArchived?: () => void }) {
  const archive = useArchiveAccount(account.id);
  const toast = useToast();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="neutral"
      title={`Archive ${account.name}?`}
      confirmLabel="Archive"
      busyLabel="Archiving…"
      onConfirm={async () => {
        await archive.submit(undefined);
        toast.show({ tone: "success", title: `${account.name} archived`, description: "Find it under the Archived filter." });
        onArchived?.();
      }}
      describeError={error => (!isUncertain(error)
        ? "It wasn't archived. Check the account and try again."
        : account.archivedAt !== null
          ? `No answer came back, so it may have been archived. ${LOCKED_UNTIL_RESTART} Nothing is sent again.`
          : "No answer came back, so it may have been archived. Close this and check the account; archived accounts are under the Archived filter. "
            + "If it is archived, archiving and restoring it are locked until you restart FundedFlow; check it again after reopening. "
            + "If it isn't, its Edit, Change status or Start new attempt dialog shows what was saved. Nothing is sent again.")}
    >
      <p>It leaves the account lists and becomes read-only. Its trades, imports, journal and history are kept, and you can restore it at any time.</p>
    </ConfirmDialog>
  );
}

export function RestoreDialog({ account, open, onOpenChange }: { account: AccountViewModel; open: boolean; onOpenChange: (open: boolean) => void }) {
  const restore = useRestoreAccount(account.id);
  const toast = useToast();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="neutral"
      title={`Restore ${account.name}?`}
      confirmLabel="Restore"
      busyLabel="Restoring…"
      onConfirm={async () => {
        await restore.submit(undefined);
        toast.show({ tone: "success", title: `${account.name} restored` });
      }}
      describeError={error =>
        (error as { category?: string })?.category === "conflict"
          ? "Another active or paused account already uses this broker account number. Close or archive that one first."
          : isUncertain(error)
            ? `No answer came back for this account's last change, so it may already have been archived or restored. ${LOCKED_UNTIL_RESTART} Nothing is sent again.`
            : "It wasn't restored. Check the account and try again."
      }
    >
      <p>It returns to the account lists with its status unchanged ({statusLabels[account.status].toLowerCase()}).</p>
    </ConfirmDialog>
  );
}

/* ---------- New evaluation attempt ---------- */

const SOURCE_LABELS: Record<(typeof resetSources)[number], string> = {
  user_entered: "My own record",
  provider_email: "The firm's email",
  provider_dashboard: "The firm's dashboard",
  other: "Somewhere else",
};

interface RulebookOption {
  key: string;
  label: string;
  decision: RulebookDecision;
}

interface VerifiedVersion {
  versionId: string;
  rulebookName: string;
  versionNumber: number;
  applicability: { programmePhaseId: string; phasePathId: string | null }[];
}

/** Verified, active catalogue rulebook versions with the phases they apply to. Never guessed from names. */
function useVerifiedRulebooks(enabled: boolean) {
  return useFeatureQuery<VerifiedVersion[]>({
    key: [...featureKeys.root, "verified-rulebook-options"],
    enabled,
    isEmpty: () => false,
    read: async signal => {
      const books = (await readRulebooks(null, signal)).value.filter(rb => rb.ownerAccountId === null && rb.recordStatus === "active");
      const out: VerifiedVersion[] = [];
      for (const rb of books) {
        for (const d of (await readRulebookVersions(rb.id, signal)).value) {
          if (d.version.verificationStatus !== "verified" || d.version.recordStatus !== "active" || d.applicability.length === 0) continue;
          out.push({ versionId: d.version.id, rulebookName: rb.displayName, versionNumber: d.version.versionNumber, applicability: d.applicability });
        }
      }
      return receipt(out);
    },
  });
}

export interface ResetDialogProps {
  account: AccountViewModel;
  /** This attempt's number in its lineage, when known. */
  attemptNumber?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After Rust confirms the new attempt: open it, or make it active. */
  onCreated?: (successor: AccountViewModel, action: "open" | "activate") => void;
}

export function ResetDialog(props: ResetDialogProps) {
  return props.open ? <ResetDialogBody {...props} /> : null;
}

const STEPS = [{ label: "Previous attempt" }, { label: "New attempt" }, { label: "Rulebook" }, { label: "Confirm" }];
type PriorOutcome = (typeof priorOutcomes)[number];

function ResetDialogBody({ account, attemptNumber, open, onOpenChange, onCreated }: ResetDialogProps) {
  const base = useId().replace(/:/g, "");
  const form = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  // Never defaulted to failed: prefilled only when the account already records the outcome.
  const [prior, setPrior] = useState<PriorOutcome | null>((priorOutcomes as readonly string[]).includes(account.status) ? (account.status as PriorOutcome) : null);
  const [effective, setEffective] = useState(nowIn(account.timezone));
  const [source, setSource] = useState<(typeof resetSources)[number]>("user_entered");
  const [reason, setReason] = useState("");
  const nextNumber = (attemptNumber ?? 1) + 1;
  const [name, setName] = useState(`${account.name} · attempt ${nextNumber}`);
  const [externalRef, setExternalRef] = useState("");
  const [balance, setBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [rulebookKey, setRulebookKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ValidationIssue[]>([]);
  const [created, setCreated] = useState<AccountViewModel | null>(null);
  const reset = useResetAccountAttempt(account.id);
  const toast = useToast();
  const server = fieldErrors(reset.error);
  const rulebooks = useVerifiedRulebooks(open);
  const catalogue = useCatalogue();

  const effectiveAt = zonedWallTimeToInstant(effective, account.timezone);
  // The rulebook's first day is Rust's trading day for the chosen instant (zone, reset time, weekends), read
  // again whenever the instant changes. Until it is known for this instant, an assignment can't be submitted.
  const tradingDay = useTradingDayAt(account.id, open ? effectiveAt : null);
  const effectiveDay = tradingDay.kind === "known" ? tradingDay.day : null;
  const options = useMemo<RulebookOption[]>(() => {
    const phases = new Map((catalogue.data?.graph.programmePhases ?? []).map(p => [p.id, p.providerLabel]));
    const paths = new Map((catalogue.data?.graph.phasePaths ?? []).map(p => [p.id, p.providerLabel]));
    return (rulebooks.data ?? []).flatMap(v =>
      v.applicability.map(a => {
        const where = [phases.get(a.programmePhaseId), a.phasePathId ? paths.get(a.phasePathId) : null].filter(Boolean).join(" · ");
        return {
          key: `${v.versionId}|${a.programmePhaseId}|${a.phasePathId ?? ""}`,
          label: `${v.rulebookName} v${v.versionNumber}${where ? ` (${where})` : ""}`,
          decision: { kind: "assign" as const, rulebookVersionId: v.versionId, effectiveFrom: effectiveDay ?? "", programmePhaseId: a.programmePhaseId, phasePathId: a.phasePathId },
        };
      }),
    );
  }, [rulebooks.data, catalogue.data, effectiveDay]);

  const decision: RulebookDecision | null = rulebookKey === "later" ? { kind: "decideLater" } : (options.find(o => o.key === rulebookKey)?.decision ?? null);
  // "Decide later" sends no date, so it never waits for the trading day.
  const dayBlocked = decision?.kind === "assign" && effectiveDay === null
    ? tradingDay.kind === "loading" ? "Reading the first trading day for this reset time" : "The first trading day for this reset time couldn't be read"
    : null;

  const checkStep = (s: number): Record<string, string> => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!prior) e.priorOutcome = "Confirm how the previous attempt ended";
      if (!effectiveAt) e.effectiveAt = "Enter when the reset took effect";
    }
    if (s === 1) {
      if (name.trim() === "") e.name = "Required";
      const b = balance.trim();
      if (b === "") e.startingBalance = "Enter the new attempt's starting balance";
      else if (!/^\d+(\.\d{1,6})?$/.test(b) || toMicros(b) === null) e.startingBalance = "Use a number such as 50000, up to 6 decimal places";
    }
    if (s === 2 && !decision) e.rulebook = "Choose a rulebook or decide later";
    return e;
  };
  const LABELS: Record<string, string> = { priorOutcome: "Previous result", effectiveAt: "Reset took effect", name: "New attempt name", startingBalance: "Starting balance", rulebook: "Rulebook" };
  const advance = () => {
    const e = checkStep(step);
    setErrors(e);
    setSummary(Object.keys(e).map(k => ({ fieldId: `${base}-${k}`, message: `${LABELS[k]}: ${e[k]}` })));
    if (Object.keys(e).length) {
      queueMicrotask(() => focusFirstInvalid(form.current));
      return;
    }
    setStep(s => s + 1);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step < 3) return advance();
    if (!prior || !effectiveAt || !decision || dayBlocked) return;
    reset
      .submit({
        predecessorAccountId: account.id,
        priorOutcome: prior,
        effectiveAt,
        reason: reason.trim() || null,
        source,
        name: name.trim(),
        externalRef: externalRef.trim() || null,
        startingBalance: balance.trim(),
        catalogue: null,
        rulebook: decision,
        notes: notes.trim() || null,
      })
      .then(result => {
        setCreated(result.successor);
        toast.show({ tone: "success", title: `${result.successor.name} started`, description: `${account.name} is kept as ${statusLabels[result.predecessor.status].toLowerCase()}.` });
      })
      .catch(() => {});
  };

  const close = () => !reset.isPending && onOpenChange(false);

  if (created) {
    return (
      <Dialog open={open} onOpenChange={close} title="New attempt started" description="Both attempts are kept and linked.">
        <div className="acct-lineage" aria-label="Attempts">
          <div className="acct-lineage-node">
            <span className="ds-faint">Attempt {attemptNumber ?? 1}</span>
            <b>{account.name}</b>
            <span className="ds-faint">{prior ? statusLabels[prior] : ""} · history kept</span>
          </div>
          <ArrowRight size={18} aria-hidden="true" />
          <div className="acct-lineage-node is-new">
            <span className="ds-faint">Attempt {nextNumber}</span>
            <b>{created.name}</b>
            <span className="ds-faint">Active · starts clean</span>
          </div>
        </div>
        <div className="acct-dialog-actions">
          <Button onClick={() => { onOpenChange(false); onCreated?.(created, "open"); }}>Open new attempt</Button>
          <Button variant="primary" onClick={() => { onOpenChange(false); onCreated?.(created, "activate"); }}>Use it as the active account</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => (next ? undefined : close())}
      dismissible={!reset.isPending}
      size="lg"
      title={`Start a new attempt after ${account.name}`}
      description="For a prop-firm evaluation reset. This creates a new linked account; it doesn't change the trading-day start time."
      footer={
        <>
          {step > 0 ? <Button onClick={() => setStep(s => s - 1)} disabled={reset.isPending}>Back</Button> : <Button onClick={close}>Cancel</Button>}
          <Button type="submit" form={`${base}-form`} variant="primary" loading={reset.isPending}
            disabled={step === 3 && ((!reset.canSubmit && !reset.isPending) || dayBlocked !== null)} disabledReason={step === 3 && !reset.isPending ? dayBlocked ?? undefined : undefined}>
            {step < 3 ? "Next" : reset.isPending ? "Starting…" : "Start new attempt"}
          </Button>
        </>
      }
    >
      <form id={`${base}-form`} ref={form} onSubmit={submit} noValidate className="acct-form">
        <Stepper label="New attempt steps" steps={STEPS} current={step} />
        <ValidationSummary issues={summary} />
        {reset.outcome === "uncertain-outcome"
          ? <AccountWriteReview write={reset} accountId={account.id} />
          : <MutationFeedback state={toMutationState(reset, { success: "New attempt started.", fieldId: f => `${base}-${f}` })} />}

        {step === 0 && (
          <FormSection title="How did the previous attempt end?" description="Confirm the real result. It is recorded on the old attempt; nothing is inferred from its trades.">
            <div id={`${base}-priorOutcome`} tabIndex={-1} aria-invalid={errors.priorOutcome ? true : undefined}>
              <RadioGroup<PriorOutcome>
                label="Previous result"
                required
                value={prior}
                onValueChange={setPrior}
                error={errors.priorOutcome ?? server.priorOutcome}
                options={priorOutcomes.map(o => ({ value: o, label: statusLabels[o], description: STATUS_HELP[o] }))}
              />
            </div>
            <TextField id={`${base}-effectiveAt`} label="Reset took effect" type="datetime-local" required value={effective} onChange={e => setEffective(e.target.value)} error={errors.effectiveAt ?? server.effectiveAt} description={`In ${account.timezone}. Trades after this belong to the new attempt.`} />
            <Select label="Where this comes from" required value={source} onValueChange={v => setSource(v as typeof source)} options={resetSources.map(s => ({ value: s, label: SOURCE_LABELS[s] }))} />
            <TextField label="Reason" optional value={reason} onChange={e => setReason(e.target.value)} error={server.reason} maxLength={500} placeholder="Bought a reset after hitting the drawdown" />
          </FormSection>
        )}

        {step === 1 && (
          <FormSection title="The new attempt" description="It starts clean: no trades, ledger, checkpoints or risk status are copied from the old attempt.">
            <TextField id={`${base}-name`} label="New attempt name" required value={name} onChange={e => setName(e.target.value)} error={errors.name ?? server.name} maxLength={100} />
            <TextField label="Account number" optional value={externalRef} onChange={e => setExternalRef(e.target.value)} error={server.externalRef} maxLength={100} description={account.externalRef ? `The old attempt used ${account.externalRef}. The firm may reuse it; enter it again if so.` : "The firm's number for the new attempt, if it has one."} />
            <TextField id={`${base}-startingBalance`} label="Starting balance" required numeric inputMode="decimal" suffix={account.currency} value={balance} onChange={e => setBalance(e.target.value)} error={errors.startingBalance ?? server.startingBalance} placeholder={account.startingBalance} description="A reset never carries the old balance over." />
            <Textarea label="Notes" optional value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </FormSection>
        )}

        {step === 2 && (
          <FormSection title="Rulebook for the new attempt" description="Choose the firm's verified rulebook and phase, or decide later. Without one, limits show as Needs setup, never as safe.">
            {rulebooks.isInitialLoading && <p className="ds-faint" role="status">Loading verified rulebooks…</p>}
            {rulebooks.error && <InlineNotice tone="warning" live="polite">Verified rulebooks couldn't be loaded. You can decide later.</InlineNotice>}
            <div id={`${base}-rulebook`} tabIndex={-1} aria-invalid={errors.rulebook ? true : undefined}>
              <RadioGroup
                label="Rulebook"
                required
                value={rulebookKey}
                onValueChange={setRulebookKey}
                error={errors.rulebook ?? server.rulebook}
                options={[
                  { value: "later", label: "Decide later", description: "No rulebook yet. The account works for journaling and imports." },
                  ...options.map(o => ({ value: o.key, label: o.label, description: effectiveDay ? `From ${effectiveDay}` : undefined })),
                ]}
              />
            </div>
            {options.length > 0 && effectiveDay === null && (
              <StatusIndicator status="unknown" label="First trading day: Unknown"
                detail={tradingDay.kind === "loading" ? "Reading it for this reset time" : "It couldn't be read for this reset time"} />
            )}
          </FormSection>
        )}

        {step === 3 && (
          <>
            <StatList
              bordered
              label="New attempt summary"
              items={[
                { label: "Previous attempt", value: `${accountLabel(account)} → ${prior ? statusLabels[prior] : "—"}` },
                { label: "Reset took effect", value: `${effective.replace("T", " ")} (${account.timezone})` },
                { label: "New attempt", value: name.trim() },
                { label: "Account number", value: externalRef.trim() || "Not set" },
                { label: "Starting balance", value: { kind: "money", amount: balance.trim(), signed: false, currency: account.currency } },
                { label: "Rulebook", value: rulebookKey === "later" ? "Decide later" : (options.find(o => o.key === rulebookKey)?.label ?? "—") },
                ...(decision?.kind === "assign" ? [{ label: "Rulebook from", value: effectiveDay ? `${effectiveDay} (trading day)` : <StatusIndicator status="unknown" variant="inline" label="Unknown" /> }] : []),
              ]}
            />
            {dayBlocked && <InlineNotice tone="warning" live="polite" title="First trading day not known yet">{dayBlocked}. Go back and check the reset time, or choose Decide later.</InlineNotice>}
            <InlineNotice tone="info" live="off" title="The old attempt stays as it is">
              Its trades, imports, journal, history and rulebook evidence are kept under {account.name}. This doesn't erase a breach or move past trades.
            </InlineNotice>
          </>
        )}
      </form>
    </Dialog>
  );
}
