// The trade's review (Build 20): reviewed status, execution rating, strategy, the checklist's answers, setup/mistake/
// mindset/general tags, the plan (entry, stop, target, risk), thesis and reflection; screenshots below.
// The review keeps the labels it was made with; renamed or archived templates show both. Process (checklist) and
// outcome (P&L) are shown apart. A save names the revision it started from, so a stale form is a conflict. Unsaved
// edits are guarded (links and window close) and kept per account and trade for the window's session. A save's
// returned review is the form's new baseline: Rust stores canonical values (decimals, tag and answer order), so the
// form is compared with what was persisted, never with what was typed. An uncertain save is checked against the
// review as stored now before saving is allowed again.
import { toMicros, type Library, type ReviewInput, type TradeReview } from "@fundedflow/domain";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  Badge,
  Button,
  Checkbox,
  ChipGroup,
  ConfirmDialog,
  ErrorState,
  FieldGroup,
  focusFirstInvalid,
  focusFirstInvalidWhenShown,
  formatInstant,
  formatMoney,
  InlineNotice,
  LoadingState,
  MutationFeedback,
  Pnl,
  RadioGroup,
  Select,
  StatList,
  Textarea,
  TextField,
  useToast,
  ValidationSummary,
  type ValidationIssue,
} from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { useLibrary } from "../../library/hooks/library";
import { useSaveTradeReview, useTradeReview } from "../../reviews/hooks/reviews";
import { useLeave, useLeaveGuard } from "../../shared/hooks/use-leave-guard";
import { fieldErrors, retryRead, toMutationState } from "../../shared/presentation";
import { UncertainOutcomeReview, type UncertainWrite } from "../../shared/UncertainOutcomeReview";
import type { TradeViewModel } from "../../trades/view-models/trade";
import { Screenshots } from "./Screenshots";

type Answer = "followed" | "missed" | "not_applicable";
export interface ReviewFormValues {
  reviewed: boolean;
  rating: string;
  strategyId: string | null;
  checklistId: string | null;
  plannedEntryPrice: string;
  plannedStopPrice: string;
  plannedTargetPrice: string;
  plannedRisk: string;
  thesis: string;
  reflection: string;
  tagIds: string[];
  answers: Record<string, { result: Answer; note: string }>;
}

export function reviewValues(review: TradeReview | null): ReviewFormValues {
  return {
    reviewed: review?.reviewedAt != null,
    rating: review?.executionRating == null ? "" : String(review.executionRating),
    strategyId: review?.strategy?.id ?? null,
    checklistId: review?.checklist?.id ?? null,
    plannedEntryPrice: review?.plannedEntryPrice ?? "",
    plannedStopPrice: review?.plannedStopPrice ?? "",
    plannedTargetPrice: review?.plannedTargetPrice ?? "",
    // A derived risk is Rust's figure from entry and stop, not something the trader typed.
    plannedRisk: review?.plannedRiskSource === "entered" ? (review.plannedRisk ?? "") : "",
    thesis: review?.thesis ?? "",
    reflection: review?.reflection ?? "",
    tagIds: review?.tags.map(t => t.tagId) ?? [],
    answers: Object.fromEntries((review?.checklistResults ?? []).map(a => [a.itemId, { result: a.result, note: a.note ?? "" }])),
  };
}

export function toReviewInput(accountId: string, tradeId: string, revision: number | null, v: ReviewFormValues): ReviewInput {
  const text = (s: string) => (s.trim() === "" ? null : s);
  const num = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    accountId,
    tradeId,
    expectedRevision: revision,
    strategyId: v.strategyId,
    checklistId: v.checklistId,
    plannedEntryPrice: num(v.plannedEntryPrice),
    plannedStopPrice: num(v.plannedStopPrice),
    plannedTargetPrice: num(v.plannedTargetPrice),
    plannedRisk: num(v.plannedRisk),
    executionRating: v.rating === "" ? null : Number(v.rating),
    thesis: text(v.thesis),
    reflection: text(v.reflection),
    reviewed: v.reviewed,
    tagIds: v.tagIds,
    checklistResults: v.checklistId ? Object.entries(v.answers).map(([itemId, a]) => ({ itemId, result: a.result, note: text(a.note) })) : [],
  };
}

/* ---------- Kept edits (per window session; every access guarded) ---------- */

interface Kept { revision: number | null; values: ReviewFormValues }
interface Baseline { revision: number | null; values: ReviewFormValues }
const same = (a: ReviewFormValues, b: ReviewFormValues) => JSON.stringify(a) === JSON.stringify(b);
const keptKey = (accountId: string, tradeId: string) => `fundedflow.tradeReview.${accountId}.${tradeId}`;
function keep(accountId: string, tradeId: string, kept: Kept) {
  try { sessionStorage.setItem(keptKey(accountId, tradeId), JSON.stringify(kept)); } catch { /* Edits stay in the page. */ }
}
function forget(accountId: string, tradeId: string) {
  try { sessionStorage.removeItem(keptKey(accountId, tradeId)); } catch { /* Nothing kept. */ }
}
function kept(accountId: string, tradeId: string): Kept | null {
  try {
    const raw = sessionStorage.getItem(keptKey(accountId, tradeId));
    const parsed = raw ? (JSON.parse(raw) as Kept) : null;
    return parsed && typeof parsed.values === "object" && Array.isArray(parsed.values.tagIds) ? parsed : null;
  } catch {
    return null;
  }
}

/* ---------- Card ---------- */

/**
 * What an uncertain review save is checked against: the trade's review as stored now (stored values only). It sits
 * outside the form, which starts again from each stored revision, so the check survives a save that did land.
 */
function ReviewWriteReview({ write, account, trade }: { write: UncertainWrite; account: AccountViewModel; trade: TradeViewModel }) {
  const review = useTradeReview(account.id, trade.id);
  const r = review.data;
  const text = (value: string | null | undefined) => (value?.trim() ? value : "None");
  return (
    <UncertainOutcomeReview write={write} what="the saved review" reviewReady={r !== undefined && !review.error} readReviewed={review.refresh}>
      {r
        ? <StatList label="The review as saved now" items={[
          { label: "Status", value: r.reviewedAt ? `Reviewed ${formatInstant(r.reviewedAt, { timeZone: account.timezone, year: true })}` : "Not reviewed" },
          { label: "Last saved", value: formatInstant(r.updatedAt, { timeZone: account.timezone, year: true, zoneName: true }) },
          { label: FIELD_LABELS.executionRating, value: r.executionRating == null ? "None" : `${r.executionRating} of 5` },
          { label: FIELD_LABELS.strategyId, value: r.strategy?.label ?? "None" },
          { label: FIELD_LABELS.tagIds, value: r.tags.length ? r.tags.map(t => t.label).join(", ") : "None" },
          { label: FIELD_LABELS.thesis, value: text(r.thesis) },
          { label: FIELD_LABELS.reflection, value: text(r.reflection) },
        ]} />
        : <p>No review is saved for this trade.</p>}
    </UncertainOutcomeReview>
  );
}

export function ReviewCard({ account, trade }: { account: AccountViewModel; trade: TradeViewModel }) {
  const review = useTradeReview(account.id, trade.id);
  const library = useLibrary();
  const save = useSaveTradeReview(account.id, trade.id);
  return (
    <section className="ds-card jr-section jr-review" aria-labelledby="jr-review-title">
      <h3 id="jr-review-title">Review</h3>
      {save.outcome === "uncertain-outcome" && <ReviewWriteReview write={save} account={account} trade={trade} />}
      {review.data === undefined ? (
        review.error ? (
          <ErrorState title="The review couldn't be loaded" message="The trade's own values above are unaffected." onRetry={retryRead(review.refresh)} />
        ) : (
          <LoadingState label="Loading the review" rows={5} />
        )
      ) : (
        // The form follows new revisions itself, so a save made here keeps edits typed while it was pending.
        <ReviewForm account={account} trade={trade} review={review.data} library={library.data ?? null}
          libraryFailed={library.error !== null && library.data === undefined} reload={retryRead(review.refresh)} />
      )}
      {review.data !== undefined && <Screenshots account={account} trade={trade} review={review.data} />}
    </section>
  );
}

const fid = (base: string, f: string) => `${base}-${f}`;
const FIELD_LABELS: Record<string, string> = {
  plannedEntryPrice: "Planned entry", plannedStopPrice: "Planned stop", plannedTargetPrice: "Planned target", plannedRisk: "Planned risk (1R)",
  executionRating: "Execution rating", thesis: "Plan and thesis", reflection: "Notes and reflection", strategyId: "Strategy", checklistId: "Checklist", tagIds: "Tags",
};

function ReviewForm({ account, trade, review, library, libraryFailed, reload }: {
  account: AccountViewModel; trade: TradeViewModel; review: TradeReview | null; library: Library | null; libraryFailed: boolean; reload: () => void;
}) {
  const base = useId().replace(/:/g, "");
  const toast = useToast();
  const persistedNow = useMemo<Baseline>(() => ({ revision: review?.revision ?? null, values: reviewValues(review) }), [review]);
  const restorableFor = (b: Baseline) => {
    const k = kept(account.id, trade.id);
    return k && !same(k.values, b.values) ? k : null;
  };
  // What is persisted as far as this form knows: the review it opened on, the one its last save returned, or a newer one.
  const [baseline, setBaseline] = useState(persistedNow);
  const [restorable, setRestorable] = useState(() => restorableFor(persistedNow));
  const [values, setValues] = useState(persistedNow.values);
  const [pending, setPending] = useState(false);
  const [starts, setStarts] = useState(0);
  const [summary, setSummary] = useState<ValidationIssue[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null);
  const latest = useRef(values);
  latest.current = values;
  const form = useRef<HTMLFormElement>(null);
  const save = useSaveTradeReview(account.id, trade.id);
  const readOnly = account.archivedAt !== null;
  // A newer revision saved elsewhere (or reloaded after a conflict) starts the form again from what is stored. While a
  // save is pending its result decides, and a revision it returned is already the baseline. A screenshot added to a
  // trade without a review creates an empty one at revision 1, which must not reset the form: no review is 1 too.
  if (!pending && (persistedNow.revision ?? 1) > (baseline.revision ?? 1)) {
    setBaseline(persistedNow);
    setValues(persistedNow.values);
    setRestorable(restorableFor(persistedNow));
    setSummary([]);
    setStarts(n => n + 1);
  }
  // Starting again also drops the last save's feedback (a conflict notice belongs to the revision it was about).
  const resetSave = useRef(save.reset);
  resetSave.current = save.reset;
  useEffect(() => { if (starts > 0) resetSave.current(); }, [starts]);
  const revision = (persistedNow.revision ?? 0) > (baseline.revision ?? 0) ? persistedNow.revision : baseline.revision;
  const dirty = !same(values, baseline.values);

  useLeaveGuard(dirty, href => setLeaving(href));
  const leave = useLeave();
  useEffect(() => {
    if (dirty) keep(account.id, trade.id, { revision, values });
  }, [dirty, values, account.id, trade.id, revision]);

  const set = <K extends keyof ReviewFormValues>(key: K, value: ReviewFormValues[K]) => setValues(v => ({ ...v, [key]: value }));
  const server = fieldErrors(save.error);
  const conflict = save.error?.category === "conflict";
  const uncertain = save.outcome === "uncertain-outcome"; // Checked above the form (ReviewWriteReview).

  const strategies = (library?.strategies ?? []).filter(s => !s.archived || s.id === values.strategyId);
  const checklists = (library?.checklists ?? []).filter(c => c.scope === "trade" && (!c.archived || c.id === values.checklistId))
    .sort((a, b) => Number(b.strategyId === values.strategyId) - Number(a.strategyId === values.strategyId));
  const checklist = library?.checklists.find(c => c.id === values.checklistId) ?? null;
  const stored = review?.checklist?.id === values.checklistId ? review?.checklistResults ?? [] : [];
  const items = [
    ...stored.map(a => ({ id: a.itemId, label: a.label, note: a.currentLabel ? `now “${a.currentLabel}”` : a.archived ? "item archived" : null })),
    ...(checklist?.items ?? []).filter(i => !i.archived && !stored.some(a => a.itemId === i.id)).map(i => ({ id: i.id, label: i.label, note: null })),
  ];

  const tagOptions = (kind: "setup" | "mistake" | "emotion" | "general") => {
    const recorded = review?.tags.filter(t => t.kind === kind) ?? [];
    const current = (library?.tags ?? []).filter(t => t.kind === kind && !t.archived && !recorded.some(r => r.tagId === t.id));
    return [
      ...recorded.map(r => ({ value: r.tagId, label: r.label, note: r.currentLabel ? `Renamed since: ${r.currentLabel}` : r.archived ? "Archived: kept on this review" : undefined, disabled: r.archived && !values.tagIds.includes(r.tagId) })),
      ...current.map(t => ({ value: t.id, label: t.name })),
    ];
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending || readOnly) return;
    const issues: ValidationIssue[] = [];
    const decimal = /^[+-]?(\d+\.?\d*|\.\d+)$/;
    for (const f of ["plannedEntryPrice", "plannedStopPrice", "plannedTargetPrice", "plannedRisk"] as const) {
      const v = values[f].trim();
      if (v && !decimal.test(v)) issues.push({ fieldId: fid(base, f), message: `${FIELD_LABELS[f]}: enter a number` });
    }
    // Money is compared in micro-units, never through number (an invalid entry is reported above).
    const plannedRisk = values.plannedRisk.trim() ? toMicros(values.plannedRisk.trim()) : null;
    if (plannedRisk !== null && plannedRisk <= 0n) issues.push({ fieldId: fid(base, "plannedRisk"), message: "Planned risk: must be greater than zero (leave it empty when unknown)" });
    setSummary(issues);
    if (issues.length) { queueMicrotask(() => focusFirstInvalid(form.current)); return; }
    const submitted = values;
    setPending(true);
    save.submit(toReviewInput(account.id, trade.id, revision, submitted)).then(
      saved => {
        const persisted = { revision: saved.revision, values: reviewValues(saved) };
        // Edits made while the save was pending stay unsaved, now against the revision it stored.
        const edited = !same(latest.current, submitted);
        if (edited) keep(account.id, trade.id, { revision: persisted.revision, values: latest.current });
        else forget(account.id, trade.id);
        setBaseline(persisted);
        if (!edited) setValues(persisted.values);
        setPending(false);
        toast.show({ tone: "success", title: "Review saved" });
      },
      () => { setPending(false); focusFirstInvalidWhenShown(form.current); },
    );
  };
  const feedback = toMutationState(save, { success: "Review saved.", fieldId: f => fid(base, f.split(".")[0]), fieldLabel: f => FIELD_LABELS[f.split(".")[0]] });
  const process = review?.adherence;
  const answered = process ? process.followed + process.missed : 0;

  return (
    <>
      <div className="jr-review-split">
        <div className="jr-review-fact">
          <span className="ds-label">Process</span>
          <span>{process && answered > 0 ? `${process.followed} of ${answered} checklist items followed` : "No checklist answers saved"}</span>
        </div>
        <div className="jr-review-fact">
          <span className="ds-label">Outcome</span>
          <Pnl value={trade.realizedPnl} size="m" currency={trade.currency} />
        </div>
        <div className="jr-review-fact">
          <span className="ds-label">R-multiple</span>
          <span className="ds-mono">{review?.rMultiple != null ? `${review.rMultiple}R` : "—"}</span>
          <span className="ds-faint">{review?.rMultiple != null ? (review.plannedRiskSource === "derived" ? "1R from the planned entry and stop" : "1R as entered") : "Needs a known P&L and planned risk"}</span>
        </div>
        <div className="jr-review-fact">
          <span className="ds-label">Status</span>
          {review?.reviewedAt ? <Badge tone="profit">Reviewed {formatInstant(review.reviewedAt, { timeZone: account.timezone })}</Badge> : <Badge>Not reviewed</Badge>}
        </div>
      </div>

      <form ref={form} onSubmit={submit} noValidate className="jr-form" aria-label="Trade review">
        {restorable && (
          <InlineNotice tone="info" title="You have unsaved edits from earlier"
            actions={<>
              <Button size="sm" onClick={() => { setValues(restorable.values); setRestorable(null); }}>Restore them</Button>
              <Button size="sm" variant="ghost" onClick={() => { forget(account.id, trade.id); setRestorable(null); }}>Discard</Button>
            </>}>
            {restorable.revision === revision ? "They were made on this version of the review." : "The review was saved since; restoring replaces what is stored now when you save."}
          </InlineNotice>
        )}
        {readOnly && <InlineNotice tone="info">This account is archived, so its reviews are read-only.</InlineNotice>}
        {libraryFailed && <InlineNotice tone="warning" title="Strategies, checklists and tags couldn't be loaded">You can still write notes and the plan; choices already on the review are kept.</InlineNotice>}
        <ValidationSummary issues={summary} />
        {conflict ? (
          <InlineNotice tone="warning" title="This review changed after you opened it" live="polite"
            actions={<Button size="sm" onClick={() => { keep(account.id, trade.id, { revision, values }); reload(); }}>Reload the review</Button>}>
            Nothing was saved. Reload to see the stored review; your edits stay available to restore.
          </InlineNotice>
        ) : !uncertain && feedback.status !== "idle" && feedback.status !== "submitting" && feedback.status !== "success" && <MutationFeedback state={feedback} />}

        <fieldset className="ds-fieldset jr-review-body" disabled={readOnly} aria-label="Review fields">
          {/* P0-D24: status and rating as two balanced groups. Both are drafts until Save; neither follows the P&L. */}
          <div className="jr-form-row jr-review-marks">
            <FieldGroup label="Review status" description="Mark when you have finished reviewing this trade." className="jr-review-status">
              <Checkbox tile label="Reviewed" checked={values.reviewed} onChange={e => set("reviewed", e.target.checked)}
                aria-describedby={values.reviewed === baseline.values.reviewed ? undefined : fid(base, "reviewed-draft")} />
              {values.reviewed !== baseline.values.reviewed && (
                <p id={fid(base, "reviewed-draft")} className="ds-faint jr-draft-note">
                  Not saved yet. Save the review to {values.reviewed ? "mark it reviewed" : "clear Reviewed"}.
                </p>
              )}
            </FieldGroup>
            <div className="jr-rating">
              <RadioGroup label={FIELD_LABELS.executionRating} segmented value={values.rating || null} onValueChange={v => set("rating", v)} error={server.executionRating}
                options={["1", "2", "3", "4", "5"].map(n => ({ value: n, label: n }))} description="How well you followed your plan, 1 (poor) to 5 (excellent); not the trade's result." />
              {values.rating
                // Clearing removes this button, so focus goes back to the scale (focus never chooses a score).
                ? <Button size="sm" variant="ghost" onClick={() => { set("rating", ""); form.current?.querySelector<HTMLInputElement>(".jr-rating input[type=radio]")?.focus(); }}>Clear rating</Button>
                : <span className="ds-faint jr-unrated">Not rated</span>}
            </div>
          </div>

          <div className="jr-form-row">
            <Select id={fid(base, "strategyId")} label={FIELD_LABELS.strategyId} placeholder="No strategy" value={values.strategyId ?? "__none"}
              onValueChange={v => set("strategyId", v === "__none" ? null : v)} error={server.strategyId}
              options={[{ value: "__none", label: "No strategy" }, ...strategies.map(s => ({ value: s.id, label: s.id === review?.strategy?.id ? review.strategy.label + (s.archived ? " (archived)" : "") : s.name }))]}
              description={review?.strategy?.currentLabel ? `Recorded as “${review.strategy.label}”; now called “${review.strategy.currentLabel}”.` : undefined} />
            <Select id={fid(base, "checklistId")} label={FIELD_LABELS.checklistId} placeholder="No checklist" value={values.checklistId ?? "__none"}
              onValueChange={v => setValues(prev => ({ ...prev, checklistId: v === "__none" ? null : v, answers: v === prev.checklistId ? prev.answers : {} }))} error={server.checklistId}
              options={[{ value: "__none", label: "No checklist" }, ...checklists.map(c => ({ value: c.id, label: c.id === review?.checklist?.id ? review.checklist.label + (c.archived ? " (archived)" : "") : c.name }))]} />
          </div>
          {values.checklistId && (
            <fieldset className="ds-fieldset jr-checklist">
              <legend className="ds-field-label">Checklist answers</legend>
              {items.length === 0 ? <p className="ds-faint">This checklist has no items. Add them in Library → Templates.</p> : items.map(item => {
                const a = values.answers[item.id];
                return (
                  <div key={item.id} className="jr-check-item">
                    <RadioGroup label={item.label} inline value={a?.result ?? null} description={item.note ?? undefined}
                      onValueChange={result => set("answers", { ...values.answers, [item.id]: { result, note: a?.note ?? "" } })}
                      options={[{ value: "followed", label: "Followed" }, { value: "missed", label: "Missed" }, { value: "not_applicable", label: "Not applicable" }]} />
                    {a && (
                      <div className="jr-row">
                        <TextField label={`Note on “${item.label}”`} hideLabel placeholder="Note (optional)" value={a.note} maxLength={2000}
                          onChange={e => set("answers", { ...values.answers, [item.id]: { ...a, note: e.target.value } })} />
                        <Button size="sm" variant="ghost" onClick={() => { const next = { ...values.answers }; delete next[item.id]; set("answers", next); }}>Clear</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}

          <ChipGroup label="Setup" value={values.tagIds} onValueChange={v => set("tagIds", v)} options={tagOptions("setup")} empty="No setup tags yet." />
          <ChipGroup label="Mistakes" tone="warn" value={values.tagIds} onValueChange={v => set("tagIds", v)} options={tagOptions("mistake")} empty="No mistake tags yet." />
          <ChipGroup label="Mindset" value={values.tagIds} onValueChange={v => set("tagIds", v)} options={tagOptions("emotion")} empty="No mindset tags yet." />
          <ChipGroup label="Other tags" value={values.tagIds} onValueChange={v => set("tagIds", v)} options={tagOptions("general")} empty="No general tags yet." error={server.tagIds} />
          <p className="ds-faint jr-note">Create, rename and archive strategies, checklists and tags in <Link to="/journal?view=library">Library</Link>.</p>

          <div className="jr-form-row jr-plan">
            <TextField id={fid(base, "plannedEntryPrice")} label={FIELD_LABELS.plannedEntryPrice} optional numeric inputMode="decimal" value={values.plannedEntryPrice} onChange={e => set("plannedEntryPrice", e.target.value)} error={server.plannedEntryPrice} />
            <TextField id={fid(base, "plannedStopPrice")} label={FIELD_LABELS.plannedStopPrice} optional numeric inputMode="decimal" value={values.plannedStopPrice} onChange={e => set("plannedStopPrice", e.target.value)} error={server.plannedStopPrice} />
            <TextField id={fid(base, "plannedTargetPrice")} label={FIELD_LABELS.plannedTargetPrice} optional numeric inputMode="decimal" value={values.plannedTargetPrice} onChange={e => set("plannedTargetPrice", e.target.value)} error={server.plannedTargetPrice} />
            <TextField id={fid(base, "plannedRisk")} label={FIELD_LABELS.plannedRisk} optional numeric inputMode="decimal" suffix={account.currency} value={values.plannedRisk} onChange={e => set("plannedRisk", e.target.value)} error={server.plannedRisk}
              description={review?.plannedRiskSource === "derived" && !values.plannedRisk ? `Worked out from entry and stop: ${formatMoney(review.plannedRisk, { currency: account.currency, signed: false })}` : "Leave empty when unknown; it is never assumed to be zero."} />
          </div>
          <Textarea id={fid(base, "thesis")} label={FIELD_LABELS.thesis} optional rows={3} maxLength={20_000} value={values.thesis} onChange={e => set("thesis", e.target.value)} error={server.thesis} placeholder="What you planned before the trade" />
          <Textarea id={fid(base, "reflection")} label={FIELD_LABELS.reflection} optional rows={5} maxLength={20_000} value={values.reflection} onChange={e => set("reflection", e.target.value)} error={server.reflection} placeholder="What happened, what you'd repeat or change" />
        </fieldset>
        <div className="jr-form-actions">
          {dirty && <span className="ds-faint" role="status">Unsaved changes</span>}
          <Button disabled={!dirty || save.isPending} onClick={() => { setValues(baseline.values); forget(account.id, trade.id); }}>Discard changes</Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={readOnly || (!save.canSubmit && !save.isPending)}
            disabledReason={readOnly ? "Archived accounts are read-only" : uncertain ? "Check the result of the last save first" : !save.canSubmit && !save.isPending ? "Saving isn't available right now" : undefined}>
            {save.isPending ? "Saving…" : review ? "Save review" : "Save review"}
          </Button>
        </div>
      </form>
      <ConfirmDialog open={leaving !== null} onOpenChange={o => !o && setLeaving(null)} tone="neutral" title="Leave without saving the review?" confirmLabel="Leave"
        onConfirm={async () => { const href = leaving; setLeaving(null); if (href) leave(href); }}>
        <p>Your edits stay available to restore in this window when you come back to this trade.</p>
      </ConfirmDialog>
    </>
  );
}
