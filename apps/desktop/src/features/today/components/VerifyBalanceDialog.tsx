// Verify balance against the firm's dashboard (Build 21 on the Build 15.5 evidence API). Step 1 records what the
// trader read, as a user-reported checkpoint (never "verified by FundedFlow"). Step 2, when an opening balance is on
// record, asks Rust for the exact comparison with the journal's trades and ledger: matched, a difference, or what is
// missing. Nothing is adjusted or balanced, and earlier checkpoints and comparisons are kept.
import { canonicalDecimal, riskMoney, type EvidenceState, type FinancialObservation, type ObservationInput, type Reconciliation } from "@fundedflow/domain";
import { type FormEvent, useState } from "react";

import {
  Badge, Button, Checkbox, Dialog, focusFirstInvalid, formatInstant, formatMoney, InlineNotice, MutationFeedback, RadioGroup, Select, Textarea,
  TextField, ValidationSummary, zonedWallTime, type ValidationIssue,
} from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useReconcileBalance, useRecordObservation } from "../../evidence/hooks/evidence";
import { zoneLabel } from "../../journal/components/presentation";
import { reasonText } from "../../rulebooks/view-models/engine-wording";
import { fieldErrors, toMutationState } from "../../shared/presentation";
import { checkpointInstant } from "../view-models/zoned-time";
import { CHECKPOINT_KIND } from "./FreshnessPanel";

type Kind = "opening_balance" | "balance" | "eod_settlement";
const ASSERT = [
  { value: "available", label: "Yes, complete" },
  { value: "incomplete", label: "Not sure or partly" },
  { value: "missing", label: "No" },
] as const;

/** "50000", "50,000.5" or "-12.25" → canonical decimal text, or null when it isn't an exact amount. */
export function parseAmount(raw: string): string | null {
  const text = raw.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = canonicalDecimal(text);
  return value !== null && riskMoney.safeParse(value).success ? value : null;
}

export function VerifyBalanceDialog({ account, open, onOpenChange, opening }: {
  account: AccountViewModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The confirmed opening balance on record, the base of a comparison. */
  opening: FinancialObservation | null;
}) {
  const record = useRecordObservation(account.id);
  const reconcile = useReconcileBalance(account.id);
  const busy = record.isPending || reconcile.isPending;
  const [saved, setSaved] = useState<FinancialObservation | null>(null);
  const [compared, setCompared] = useState<Reconciliation | null>(null);
  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) { setSaved(null); setCompared(null); record.reset(); reconcile.reset(); }
  };
  return (
    <Dialog open={open} onOpenChange={close} dismissible={!busy} hideClose={busy} size="md"
      title="Verify balance against your firm's dashboard"
      description="Record the figure the firm shows. It is saved as reported by you; FundedFlow can't check it with the firm.">
      {saved === null
        ? <CheckpointForm account={account} opening={opening} mutation={record} onSaved={setSaved} onCancel={() => close(false)} />
        : <CompareStep account={account} saved={saved} opening={opening} mutation={reconcile} result={compared} onCompared={setCompared} onDone={() => close(false)} />}
    </Dialog>
  );
}

function CheckpointForm({ account, opening, mutation, onSaved, onCancel }: {
  account: AccountViewModel; opening: FinancialObservation | null; mutation: ReturnType<typeof useRecordObservation>;
  onSaved: (o: FinancialObservation) => void; onCancel: () => void;
}) {
  const tz = account.timezone;
  const [kind, setKind] = useState<Kind>(opening ? "balance" : "opening_balance");
  const [amount, setAmount] = useState("");
  const [observedAt, setObservedAt] = useState(() => zonedWallTime(Date.now(), tz));
  const [validUntil, setValidUntil] = useState("");
  const [source, setSource] = useState<ObservationInput["sourceCategory"]>("firm_dashboard");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const errors: Record<string, string> = Object.fromEntries(issues.filter(i => i.fieldId).map(i => [i.fieldId!, i.message]));
  const backend = fieldErrors(mutation.error);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const found: ValidationIssue[] = [];
    const value = parseAmount(amount);
    if (value === null) found.push({ fieldId: "td-cp-amount", message: "Enter the amount exactly as the firm shows it, e.g. 50250.75" });
    const at = checkpointInstant(observedAt, tz);
    const atMessage = at.kind === "skipped" ? "That time doesn't exist on this day (clocks went forward). Pick another minute."
      : at.kind === "repeated" ? "That time happens twice on this day (clocks went back). Pick a minute outside the repeated hour."
      : at.kind === "invalid" ? "Enter the date and time you read it." : at.instant > new Date(Date.now() + 60_000).toISOString() ? "That time is in the future." : null;
    if (atMessage) found.push({ fieldId: "td-cp-at", message: atMessage });
    const until = validUntil.trim() === "" ? null : checkpointInstant(validUntil, tz);
    if (until && until.kind !== "ok") found.push({ fieldId: "td-cp-until", message: "Enter a valid time, or leave it empty." });
    else if (until && at.kind === "ok" && until.instant < at.instant) found.push({ fieldId: "td-cp-until", message: "It can't end before it was observed." });
    if (reference.trim() === "") found.push({ fieldId: "td-cp-ref", message: "Say where you read it, e.g. \"Firm dashboard, account overview\"." });
    setIssues(found);
    if (found.length) { requestAnimationFrame(() => focusFirstInvalid(form)); return; }
    try {
      const savedRow = await mutation.submit({
        accountId: account.id, kind, value, currency: account.currency, basis: "balance",
        observedAt: (at as { instant: string }).instant, sourceCategory: source, sourceReference: reference.trim(),
        confirmation: confirmed ? "user_confirmed" : "unconfirmed", confidence: confirmed ? "user_reported" : "unknown",
        validUntil: until && until.kind === "ok" ? until.instant : null, actor: "local_user", note: note.trim() === "" ? null : note.trim(),
      });
      onSaved(savedRow);
    } catch { /* MutationFeedback shows it. */ }
  };

  return (
    <form className="td-form" onSubmit={submit} noValidate aria-label="Balance checkpoint">
      <ValidationSummary issues={issues} />
      <RadioGroup label="What are you recording?" name="td-cp-kind" value={kind} onValueChange={v => setKind(v as Kind)} options={[
        { value: "opening_balance", label: CHECKPOINT_KIND.opening_balance, description: "The balance this attempt started with, before its first trade. Needed for balance, target and drawdown figures." },
        { value: "balance", label: "Current balance", description: "The closed balance the firm shows now (not equity with open trades)." },
        { value: "eod_settlement", label: CHECKPOINT_KIND.eod_settlement, description: "The firm's settled balance at a trading day's end." },
      ]} />
      <TextField id="td-cp-amount" label="Amount" required numeric inputMode="decimal" suffix={account.currency} value={amount} onChange={e => setAmount(e.target.value)}
        error={errors["td-cp-amount"] ?? backend.value} />
      <TextField id="td-cp-at" type="datetime-local" label="When you read it" required value={observedAt} onChange={e => setObservedAt(e.target.value)}
        description={`In the account's zone, ${zoneLabel(tz)}.`} error={errors["td-cp-at"] ?? backend.observedAt} />
      <Select label="Where it comes from" value={source} onValueChange={v => setSource(v as ObservationInput["sourceCategory"])} options={[
        { value: "firm_dashboard", label: "The firm's dashboard" }, { value: "statement", label: "A statement from the firm" }, { value: "user_entered", label: "My own figure" },
      ]} />
      <TextField id="td-cp-ref" label="Where you read it" required value={reference} onChange={e => setReference(e.target.value)} maxLength={2000}
        description="Page, report or screenshot name, so you can find it again." error={errors["td-cp-ref"] ?? backend.sourceReference} />
      <TextField id="td-cp-until" type="datetime-local" label="Treat it as current until" optional value={validUntil} onChange={e => setValidUntil(e.target.value)}
        description="When this figure stops being current. Without it a comparison can't call the checkpoint current." error={errors["td-cp-until"] ?? backend.validUntil} />
      <Checkbox label="I read this figure from the firm and confirm it" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
        description="Confirmed checkpoints can be used in calculations. It remains your report, not a check by FundedFlow." />
      <Textarea label="Note" optional rows={2} value={note} onChange={e => setNote(e.target.value)} />
      <MutationFeedback state={toMutationState(mutation, { success: "Checkpoint saved." })} />
      <div className="td-form-footer">
        <Button type="button" onClick={onCancel} disabled={mutation.isPending}>Cancel</Button>
        <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!mutation.canSubmit}>Save checkpoint</Button>
      </div>
    </form>
  );
}

const STATUS_TONE = { matched: "profit", mismatched: "loss", incomplete: "warn", conflicting: "loss", stale: "warn", unsupported: "neutral" } as const;

function CompareStep({ account, saved, opening, mutation, result, onCompared, onDone }: {
  account: AccountViewModel; saved: FinancialObservation; opening: FinancialObservation | null; mutation: ReturnType<typeof useReconcileBalance>;
  result: Reconciliation | null; onCompared: (r: Reconciliation) => void; onDone: () => void;
}) {
  const tz = account.timezone;
  const at = (v: string | null) => formatInstant(v, { timeZone: tz, year: true, zoneName: true });
  const [assert, setAssert] = useState<Record<"closedTrades" | "fees" | "ledger", EvidenceState>>({ closedTrades: "incomplete", fees: "incomplete", ledger: "incomplete" });
  const comparable = saved.kind !== "opening_balance" && opening !== null && opening.id !== saved.id;
  const run = async () => {
    try {
      const r = await mutation.submit({
        accountId: account.id, observationId: saved.id, baselineObservationId: opening!.id, asOf: saved.observedAt, evaluatedAt: new Date().toISOString(),
        coverage: { baseline: "available", eodHistory: "available", openPositions: "unsupported", intradayHistory: "unsupported", ...assert,
          sourceReference: "Coverage stated by the user on this computer for this comparison" },
      });
      onCompared(r);
    } catch { /* MutationFeedback shows it. */ }
  };
  return (
    <div className="td-form">
      <InlineNotice tone="success" live="polite" title="Checkpoint saved">
        {CHECKPOINT_KIND[saved.kind]} {formatMoney(saved.value, { signed: false, currency: saved.currency })} at {at(saved.observedAt)}
        {saved.confirmation === "user_confirmed" ? ", confirmed by you." : ", not confirmed (calculations won't rely on it)."} Saved estimates are checked again.
      </InlineNotice>
      {!comparable && (
        <p className="ds-faint">
          {saved.kind === "opening_balance" ? "This is the starting point for comparisons. Record a current balance to compare it with your trades." : "Record a confirmed opening balance first; a comparison measures from it."}
        </p>
      )}
      {comparable && result === null && (
        <fieldset className="td-assert">
          <legend className="ds-label">Compare with your records</legend>
          <p className="ds-faint">
            Opening balance {formatMoney(opening!.value, { signed: false, currency: opening!.currency })} at {at(opening!.observedAt)}, plus closed trades and ledger movements up to {at(saved.observedAt)}. Say how complete they are; this is your statement, not checked.
          </p>
          <div className="td-inline-fields">
            <Select size="sm" label="All closed trades are imported" options={ASSERT} value={assert.closedTrades} onValueChange={v => setAssert(a => ({ ...a, closedTrades: v }))} />
            <Select size="sm" label="Fees are complete" options={ASSERT} value={assert.fees} onValueChange={v => setAssert(a => ({ ...a, fees: v }))} />
            <Select size="sm" label="Payouts and adjustments are recorded" options={ASSERT} value={assert.ledger} onValueChange={v => setAssert(a => ({ ...a, ledger: v }))} />
          </div>
          <MutationFeedback state={toMutationState(mutation, { success: "Comparison saved." })} />
        </fieldset>
      )}
      {result && (
        <section className="td-compare" aria-labelledby="td-compare-title" role="status">
          <h3 id="td-compare-title" className="ds-title">Comparison <Badge tone={STATUS_TONE[result.result.reconciliationStatus]}>{result.result.reconciliationStatus === "matched" ? "Matches exactly" : result.result.reconciliationStatus}</Badge></h3>
          {result.result.derivedBalance !== null && (
            <p>Your records give {formatMoney(result.result.derivedBalance, { signed: false, currency: saved.currency })}; the firm shows {formatMoney(saved.value, { signed: false, currency: saved.currency })}
              {result.result.difference !== null && result.result.difference !== "0" ? ` (difference ${formatMoney(result.result.difference, { currency: saved.currency })})` : ""}.</p>
          )}
          {result.result.missingInputs.length > 0 && (
            <div><span className="ds-label">Missing before it can compare</span>
              <ul className="td-list">{result.result.missingInputs.map(m => <li key={m}>{reasonText(m)}</li>)}</ul></div>
          )}
          <p className="ds-faint">{result.result.nextVerificationAction}. {result.result.sourceSummary}. Nothing was changed or balanced.</p>
        </section>
      )}
      <div className="td-form-footer">
        {comparable && result === null && <Button onClick={run} loading={mutation.isPending} disabled={!mutation.canSubmit}>Compare</Button>}
        <Button variant="primary" onClick={onDone} disabled={mutation.isPending}>Done</Button>
      </div>
    </div>
  );
}
