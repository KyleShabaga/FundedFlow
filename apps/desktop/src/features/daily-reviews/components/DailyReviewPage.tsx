// The daily review (Build 22, docs/design/screens/14-daily-review.md): one account attempt's plan, day-level
// checklist and reflection for one Rust trading day, with the day's trades and closed-trade outcome beside it.
//
// Identity is in the URL: /journal/days/:tradingDay?account=<id>. The page renders exactly that account and day, keyed
// by both, so switching the header selection or opening another day never shows another account's draft or summary;
// when the selection differs from the page's account the page says so. Saves are explicit (no autosave): unsaved
// edits are guarded on navigation and window close and kept per account and day for the window's session, and a
// failed or conflicting save leaves the text in the form. Process adherence, the closed-trade outcome and prop-firm
// rules are shown apart; none implies another.
import { toMicros, type DailyReview, type DailyReviewDay, type Library } from "@fundedflow/domain";
import { ChevronLeft, ChevronRight, CircleCheck, RotateCcw, Save } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  type DataColumn,
  DataTable,
  EmptyState,
  ErrorState,
  focusFirstInvalid,
  focusFirstInvalidWhenShown,
  FormSection,
  formatInstant,
  formatMoney,
  InlineNotice,
  LoadingState,
  MutationFeedback,
  Pnl,
  RadioGroup,
  Select,
  Textarea,
  TextField,
  UnavailableState,
  useToast,
  ValidationSummary,
  type ValidationIssue,
} from "../../../design-system";
import { useActiveAccount } from "../../accounts/active-account";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { clock, longDay, STATUS_NOTE, tradePath, zoneLabel } from "../../journal/components/presentation";
import { useLibrary } from "../../library/hooks/library";
import { useLeaveGuard } from "../../shared/hooks/use-leave-guard";
import { fieldErrors, retryRead, toMutationState } from "../../shared/presentation";
import { useDailyReviewDay, useRelinkDailyReviewTrades, useReopenDailyReview, useSaveDailyReview } from "../hooks/daily-reviews";
import {
  adherenceDetail, adherenceText, DAY_STATE_TEXT, dailyReviewPath, type DailyReviewValues, isTradingDayKey, type PlanField,
  type ReflectionField, reviewValues, sameValues, statusView, stepTradingDay, toDailyReviewInput,
} from "../view-models/daily-review";
import { DayChooser } from "./DayChooser";
import "./daily-review.css";

export function DailyReviewPage() {
  const { tradingDay = "" } = useParams();
  const [params] = useSearchParams();
  const active = useActiveAccount();
  const accountId = params.get("account") ?? active.activeId;
  const back = <Link className="jr-back" to="/journal?view=day"><ChevronLeft size={16} aria-hidden="true" />Journal</Link>;

  if (!isTradingDayKey(tradingDay)) {
    return (
      <div className="dr-page">{back}
        <div className="ds-card">
          <EmptyState kind="no-records" title="That isn't a trading day"
            description="Trading days run Monday to Friday (a weekend counts toward Monday). Choose a day from the Journal." />
        </div>
      </div>
    );
  }
  if (active.state.kind === "loading") return <LoadingState label="Loading accounts" rows={4} />;
  if (active.state.kind === "error") return <ErrorState scope="route" title="Accounts couldn't be loaded" message="The review needs to know which account it belongs to. Use the recovery controls, then try again." />;
  const account = accountId ? (active.accounts ?? []).find(a => a.id === accountId) ?? null : null;
  if (!account) {
    return (
      <div className="dr-page">{back}
        <div className="ds-card">
          <EmptyState kind="not-configured" title={accountId ? "This account isn't available" : "Choose an account"}
            description={accountId ? "It no longer exists in this journal. Nothing was changed." : "Pick the account to review in the account selector at the top of the window."} />
        </div>
      </div>
    );
  }
  // Keyed by account and day: nothing from another account or day survives a change of either.
  return <DayReview key={`${account.id}:${tradingDay}`} account={account} day={tradingDay} selectedId={active.activeId} onSelect={active.select} />;
}

/* ---------- Kept edits (per window session; every access guarded) ---------- */

interface Kept { revision: number | null; values: DailyReviewValues }
const keptKey = (accountId: string, day: string) => `fundedflow.dailyReview.${accountId}.${day}`;
export function keepEdits(accountId: string, day: string, kept: Kept) {
  try { sessionStorage.setItem(keptKey(accountId, day), JSON.stringify(kept)); } catch { /* Edits stay in the page. */ }
}
function forgetEdits(accountId: string, day: string) {
  try { sessionStorage.removeItem(keptKey(accountId, day)); } catch { /* Nothing kept. */ }
}
function keptEdits(accountId: string, day: string): Kept | null {
  try {
    const raw = sessionStorage.getItem(keptKey(accountId, day));
    const parsed = raw ? (JSON.parse(raw) as Kept) : null;
    return parsed && typeof parsed.values?.plan === "object" && typeof parsed.values?.reflection === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/* ---------- One account and day ---------- */

function DayReview({ account, day, selectedId, onSelect }: {
  account: AccountViewModel; day: string; selectedId: string | null; onSelect: (id: string) => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const query = useDailyReviewDay(account.id, day);
  const library = useLibrary();
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const focusStatus = useRef(false);
  useLeaveGuard(dirty, href => setLeaving(href));
  const go = (href: string) => (dirty ? setLeaving(href) : navigate(href));
  const data = query.data;
  const review = data?.review ?? null;
  const status = statusView(review);

  return (
    <div className="dr-page">
      <nav className="jr-crumbs" aria-label="Breadcrumb">
        <Link to="/journal?view=day">Journal</Link> › <Link to="/journal?view=library&section=daily">Daily reviews</Link> › <span aria-current="page">{longDay(day)}</span>
      </nav>
      <header className="dr-head">
        <div className="dr-title">
          <h2>Daily review · {longDay(day)}</h2>
          {data && <Badge tone={status.tone}>{status.label}</Badge>}
          {data?.isFuture && <Badge tone="flow">Upcoming</Badge>}
        </div>
        <p className="jr-sub">
          <strong>{account.name}</strong> · trading day {day} in {zoneLabel(account.timezone)}, starting at {account.tradingDayResetTime}
          {data && <> · session {formatInstant(data.sessionStart, { timeZone: account.timezone })} – {formatInstant(data.sessionEnd, { timeZone: account.timezone })}</>}
        </p>
        <div className="dr-nav" role="group" aria-label="Trading day">
          <Button size="sm" variant="ghost" icon={<ChevronLeft size={16} aria-hidden="true" />} onClick={() => go(dailyReviewPath(account.id, stepTradingDay(day, -1)))}>Previous day</Button>
          <Button size="sm" variant="ghost" onClick={() => go(dailyReviewPath(account.id, stepTradingDay(day, 1)))}>Next day <ChevronRight size={16} aria-hidden="true" /></Button>
          {data && data.currentTradingDay !== day && (
            <Button size="sm" variant="ghost" onClick={() => go(dailyReviewPath(account.id, data.currentTradingDay))}>Current trading day</Button>
          )}
          <DayChooser initial={day} label="Go to day" onChoose={d => go(dailyReviewPath(account.id, d))} />
        </div>
      </header>

      {selectedId !== null && selectedId !== account.id && (
        <InlineNotice tone="info" live="polite" title="This review isn't for the selected account"
          actions={account.archivedAt === null ? <Button size="sm" onClick={() => { onSelect(account.id).catch(() => toast.show({ tone: "error", title: "The account wasn't switched" })); }}>Select {account.name}</Button> : undefined}>
          You are viewing <strong>{account.name}</strong>'s review. The selection at the top of the window is a different account; nothing from it is shown here.
        </InlineNotice>
      )}

      {data === undefined ? (
        query.isUnavailable ? (
          <UnavailableState title="Local data isn't available" reason="The review can be opened once the journal is available again. Use the recovery controls." />
        ) : query.error ? (
          <ErrorState title="The review couldn't be loaded" message={query.error.category === "validation" ? "This day can't be reviewed for this account." : "Your saved reviews are unaffected. Try again."} onRetry={retryRead(query.refresh)} />
        ) : (
          <LoadingState label="Loading the day" rows={6} />
        )
      ) : (
        <>
          <DaySummary account={account} data={data} />
          <ReviewForm key={review?.revision ?? 0} account={account} data={data} library={library.data ?? null}
            libraryFailed={library.error !== null && library.data === undefined} onDirtyChange={setDirty}
            reload={retryRead(query.refresh)} focusStatus={focusStatus} />
          <DayTrades account={account} data={data} dirty={dirty} />
          {review && <History account={account} review={review} />}
        </>
      )}

      <ConfirmDialog open={leaving !== null} onOpenChange={o => !o && setLeaving(null)} tone="neutral" title="Leave without saving the review?" confirmLabel="Leave"
        onConfirm={async () => { const href = leaving; setLeaving(null); setDirty(false); if (href) navigate(href); }}>
        <p>Your edits stay available to restore in this window when you come back to this day.</p>
      </ConfirmDialog>
    </div>
  );
}

/* ---------- Summary: process, outcome and day state, apart ---------- */

function DaySummary({ account, data }: { account: AccountViewModel; data: DailyReviewDay }) {
  const review = data.review;
  const o = data.outcome;
  const unknownParts = [o.unknownPnl ? `${o.unknownPnl} without a known P&L` : null, o.open ? `${o.open} open` : null].filter(Boolean);
  return (
    <section className="ds-card dr-summary" aria-label="Day summary">
      <div className="dr-fact">
        <span className="ds-label">Process (plan adherence)</span>
        <span>{review ? adherenceText(review.adherence) : "No review yet"}</span>
        {review && review.checklist && <span className="ds-faint">{adherenceDetail(review.adherence)}</span>}
      </div>
      <div className="dr-fact">
        <span className="ds-label">Outcome (closed trades)</span>
        <Pnl value={o.net} size="m" currency={account.currency} />
        <span className="ds-faint">
          {o.trades === 0 ? "No trades recorded for this day" : `${o.closedWithKnownPnl} of ${o.trades} ${o.trades === 1 ? "trade" : "trades"} with a known P&L`}
          {unknownParts.length > 0 && `; ${unknownParts.join(" and ")} left out`}
        </span>
      </div>
      <div className="dr-fact">
        <span className="ds-label">Day</span>
        <span>{DAY_STATE_TEXT[data.dayState]}</span>
        {data.dayState === "no_trades_recorded" && <span className="ds-faint">If you traded, import or add the trades; a missing import is not a no-trade day.</span>}
      </div>
      <p className="ds-faint dr-disclaimer">
        Plan adherence is your own record of process. It is not profit, and it is not a check of your prop firm's rules or a signal to trade.
      </p>
    </section>
  );
}

/* ---------- Form ---------- */

const PLAN_LABELS: Record<PlanField, string> = {
  focus: "Focus for the session", setups: "Planned setups", noTradeConditions: "No-trade conditions",
  commitments: "Process commitments", maxRisk: "Maximum risk for the day", notes: "Plan notes",
};
const REFLECTION_LABELS: Record<ReflectionField, string> = {
  marketContext: "Market context", wentWell: "What went well", mistakes: "Mistakes", emotions: "Emotions and mindset",
  keyLesson: "Key lesson", nextAction: "One action for the next session", notes: "Other notes",
};
const PLACEHOLDERS: Partial<Record<PlanField | ReflectionField, string>> = {
  focus: "What you will concentrate on", setups: "The setups you will take", noTradeConditions: "When you will not trade (news, chop, after two losses…)",
  commitments: "Rules you hold yourself to today", marketContext: "Trend, range, news, volatility", wentWell: "What you'd repeat",
  mistakes: "What you'd change", emotions: "How you felt and how it affected decisions", keyLesson: "The one thing to remember",
  nextAction: "One concrete change for next time",
};
const fieldDomId = (base: string, field: string) => `${base}-${field.replace(/\./g, "-")}`;
function fieldLabel(field: string): string | undefined {
  const [group, name] = field.split(".");
  if (group === "plan") return PLAN_LABELS[name as PlanField];
  if (group === "reflection") return REFLECTION_LABELS[name as ReflectionField];
  if (group === "answers") return "Checklist answer";
  return { checklistId: "Daily checklist", noTradeDay: "No-trade day", tradingDay: "Trading day", action: "Review" }[group];
}

function ReviewForm({ account, data, library, libraryFailed, onDirtyChange, reload, focusStatus }: {
  account: AccountViewModel; data: DailyReviewDay; library: Library | null; libraryFailed: boolean;
  onDirtyChange: (dirty: boolean) => void; reload: () => void; focusStatus: { current: boolean };
}) {
  const base = useId().replace(/:/g, "");
  const toast = useToast();
  const review = data.review;
  const day = data.tradingDay;
  const initial = useMemo(() => reviewValues(review), [review]);
  const revision = review?.revision ?? null;
  const [restorable, setRestorable] = useState(() => {
    const k = keptEdits(account.id, day);
    return k && !sameValues(k.values, initial) ? k : null;
  });
  const [values, setValues] = useState(initial);
  const [summary, setSummary] = useState<ValidationIssue[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const save = useSaveDailyReview(account.id, day);
  const reopen = useReopenDailyReview(account.id, day);
  const readOnly = data.archived || account.archivedAt !== null;
  const dirty = !sameValues(values, initial);
  const busy = save.isPending || reopen.isPending;
  const hasTrades = data.trades.length > 0;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (dirty) keepEdits(account.id, day, { revision, values });
  }, [dirty, values, account.id, day, revision]);
  // After a save the form starts again from the stored review; put focus back on its status line.
  useEffect(() => {
    if (focusStatus.current) { focusStatus.current = false; statusRef.current?.focus(); }
  }, [focusStatus]);

  const server = fieldErrors(save.error);
  const conflict = save.error?.category === "conflict" || reopen.error?.category === "conflict";
  const setPlan = (f: PlanField, v: string) => setValues(s => ({ ...s, plan: { ...s.plan, [f]: v } }));
  const setReflection = (f: ReflectionField, v: string) => setValues(s => ({ ...s, reflection: { ...s.reflection, [f]: v } }));

  const checklists = (library?.checklists ?? []).filter(c => c.scope === "daily" && (!c.archived || c.id === values.checklistId));
  const checklist = library?.checklists.find(c => c.id === values.checklistId) ?? null;
  const stored = review?.checklist?.id === values.checklistId ? review?.answers ?? [] : [];
  const items = [
    ...stored.map(a => ({ id: a.itemId, label: a.label, note: a.currentLabel ? `Now called “${a.currentLabel}”` : a.archived ? "Item archived; kept with its answer" : null })),
    ...(checklist?.items ?? []).filter(i => !i.archived && !stored.some(a => a.itemId === i.id)).map(i => ({ id: i.id, label: i.label, note: null })),
  ];

  const submit = (action: "save" | "complete") => (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || readOnly) return;
    const issues: ValidationIssue[] = [];
    const risk = values.plan.maxRisk.trim();
    // Compared in micro-units, never through number; an amount outside the stored range is invalid too.
    const micros = risk ? toMicros(risk) : null;
    if (risk && (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(risk) || micros === null || micros <= 0n)) {
      issues.push({ fieldId: fieldDomId(base, "plan.maxRisk"), message: `${PLAN_LABELS.maxRisk}: enter an amount greater than zero, or leave it empty` });
    }
    setSummary(issues);
    if (issues.length) { queueMicrotask(() => focusFirstInvalid(form.current)); return; }
    save.submit(toDailyReviewInput(account.id, day, revision, values, action)).then(
      () => {
        forgetEdits(account.id, day);
        focusStatus.current = true;
        toast.show({ tone: "success", title: action === "complete" ? "Review completed" : "Review saved" });
      },
      () => focusFirstInvalidWhenShown(form.current),
    );
  };
  const doReopen = () => {
    if (!review || busy || readOnly || dirty) return;
    reopen.submit({ accountId: account.id, tradingDay: day, expectedRevision: review.revision }).then(
      () => { focusStatus.current = true; toast.show({ tone: "success", title: "Review reopened as a draft" }); },
      () => {},
    );
  };
  const feedback = toMutationState(save, {
    success: "Review saved.", fieldId: f => (f.startsWith("answers.") ? `${base}-checklist` : fieldDomId(base, f)), fieldLabel,
  });
  const reopenFeedback = toMutationState(reopen, { success: "Reopened." });
  const futureOnly = data.isFuture;
  const savedLine = review
    ? `${review.status === "completed" ? `Completed ${formatInstant(review.completedAt, { timeZone: account.timezone })}` : "Draft"} · last saved ${formatInstant(review.updatedAt, { timeZone: account.timezone })}`
    : "Not saved yet";

  const textArea = (group: "plan" | "reflection", f: string, label: string, value: string, onChange: (v: string) => void, disabled = false, rows = 3) => (
    <Textarea key={f} id={fieldDomId(base, `${group}.${f}`)} label={label} optional rows={rows} maxLength={20_000} value={value} disabled={disabled}
      onChange={e => onChange(e.target.value)} error={server[`${group}.${f}`]} placeholder={PLACEHOLDERS[f as PlanField | ReflectionField]} />
  );

  return (
    <form ref={form} onSubmit={submit("save")} noValidate className="dr-form" aria-label="Daily review">
      <p ref={statusRef} tabIndex={-1} className="dr-status" role="status" aria-live="polite">
        {busy ? "Saving…" : dirty ? "Unsaved changes" : savedLine}
      </p>
      {restorable && (
        <InlineNotice tone="info" title="You have unsaved edits from earlier"
          actions={<>
            <Button size="sm" onClick={() => { setValues(restorable.values); setRestorable(null); }}>Restore them</Button>
            <Button size="sm" variant="ghost" onClick={() => { forgetEdits(account.id, day); setRestorable(null); }}>Discard</Button>
          </>}>
          {restorable.revision === revision ? "They were made on this version of the review." : "The review was saved since; restoring replaces what is stored now when you save."}
        </InlineNotice>
      )}
      {readOnly && <InlineNotice tone="info">This account is archived, so its reviews are read-only.</InlineNotice>}
      {futureOnly && !readOnly && <InlineNotice tone="info">This trading day hasn't started. You can write its plan now; the checklist and reflection open once the day begins.</InlineNotice>}
      {libraryFailed && <InlineNotice tone="warning" title="Checklists couldn't be loaded">You can still write the plan and reflection; a checklist already on the review is kept.</InlineNotice>}
      <ValidationSummary issues={summary} />
      {save.outcome === "uncertain-outcome" ? (
        <InlineNotice tone="warning" title="It isn't certain the review was saved" live="assertive"
          actions={<Button size="sm" onClick={() => {
            keepEdits(account.id, day, { revision, values });
            void save.acknowledgeUncertainOutcome({ recordsReviewed: true }).then(reload, () => {});
          }}>Check the stored review</Button>}>
          The save didn't confirm. Your text is still here and kept for this window. Check what is stored, then save again if needed.
        </InlineNotice>
      ) : conflict ? (
        <InlineNotice tone="warning" title="This review changed after you opened it" live="polite"
          actions={<Button size="sm" onClick={() => { keepEdits(account.id, day, { revision, values }); reload(); }}>Reload the review</Button>}>
          Nothing was saved. Reload to see the stored review; your edits stay available to restore.
        </InlineNotice>
      ) : (
        <>
          {feedback.status !== "idle" && feedback.status !== "submitting" && feedback.status !== "success" && <MutationFeedback state={feedback} />}
          {reopenFeedback.status === "failed" && <MutationFeedback state={reopenFeedback} />}
        </>
      )}

      <fieldset className="ds-fieldset dr-body" disabled={readOnly} aria-label="Review fields">
        <FormSection title="Before the session"
          description={<>
            Optional. These are your own intentions, not your firm's rules.{" "}
            {review?.plan.timing === "pre_session" && <Badge tone="flow">Written before the session · {formatInstant(review.plan.authoredAt, { timeZone: account.timezone })}</Badge>}
            {review?.plan.timing === "retrospective" && <Badge tone="warn">Written afterwards (retrospective) · {formatInstant(review.plan.authoredAt, { timeZone: account.timezone })}</Badge>}
          </>}>
          {/* P0-D26: one two-column grid in reading order (focus, setups, no-trade conditions, commitments, maximum risk,
              notes); it stacks in narrow containers. Maximum risk keeps its explanation with it. */}
          <div className="dr-plan-grid">
            {(["focus", "setups", "noTradeConditions", "commitments"] as const).map(f => textArea("plan", f, PLAN_LABELS[f], values.plan[f], v => setPlan(f, v)))}
            <TextField id={fieldDomId(base, "plan.maxRisk")} label={PLAN_LABELS.maxRisk} optional numeric inputMode="decimal" suffix={account.currency}
              value={values.plan.maxRisk} onChange={e => setPlan("maxRisk", e.target.value)} error={server["plan.maxRisk"]}
              description="Self-imposed. Leave empty when not set; it is never assumed to be zero and isn't checked against your firm's limits." />
            {textArea("plan", "notes", PLAN_LABELS.notes, values.plan.notes, v => setPlan("notes", v))}
          </div>
        </FormSection>

        <FormSection title="Daily checklist" description="Answer what applies. Unanswered items and items marked not applicable never count as missed.">
          <div id={`${base}-checklist`} tabIndex={-1}>
            <Select id={fieldDomId(base, "checklistId")} label="Daily checklist" placeholder="No checklist" value={values.checklistId ?? "__none"} disabled={futureOnly}
              onValueChange={v => setValues(prev => ({ ...prev, checklistId: v === "__none" ? null : v, answers: v === prev.checklistId ? prev.answers : {} }))} error={server.checklistId}
              options={[{ value: "__none", label: "No checklist" }, ...checklists.map(c => ({ value: c.id, label: c.id === review?.checklist?.id ? review.checklist.label + (c.archived ? " (archived)" : "") : c.name }))]}
              description={review?.checklist?.currentLabel ? `Recorded as “${review.checklist.label}”; now called “${review.checklist.currentLabel}”.` : checklists.length === 0 ? "No daily checklists yet. Create one in Library → Templates (Used for: Each day)." : undefined} />
          </div>
          {values.checklistId && (
            <fieldset className="ds-fieldset jr-checklist" disabled={futureOnly}>
              <legend className="ds-field-label">Checklist answers</legend>
              {items.length === 0 ? <p className="ds-faint">This checklist has no items. Add them in Library → Templates.</p> : items.map(item => {
                const a = values.answers[item.id];
                return (
                  <div key={item.id} className="jr-check-item">
                    <RadioGroup label={item.label} inline value={a?.result ?? null} description={item.note ?? (a ? undefined : "Unanswered")}
                      onValueChange={result => setValues(s => ({ ...s, answers: { ...s.answers, [item.id]: { result, note: a?.note ?? "" } } }))}
                      options={[{ value: "followed", label: "Followed" }, { value: "missed", label: "Missed" }, { value: "not_applicable", label: "Not applicable" }]} />
                    {a && (
                      <div className="jr-row">
                        <TextField label={`Note on “${item.label}”`} hideLabel placeholder="Note (optional)" value={a.note} maxLength={2000}
                          onChange={e => setValues(s => ({ ...s, answers: { ...s.answers, [item.id]: { ...a, note: e.target.value } } }))} />
                        <Button size="sm" variant="ghost" onClick={() => setValues(s => { const next = { ...s.answers }; delete next[item.id]; return { ...s, answers: next }; })}>Clear answer</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}
          <p className="ds-faint jr-note">Manage daily checklists in <Link to="/journal?view=library&section=templates">Library → Templates</Link>. Renaming or archiving one never changes answers already given.</p>
        </FormSection>

        <FormSection title="After the session" description="Leave anything blank; a draft can be finished later.">
          <Checkbox label="I didn't trade this day (no-trade day)" checked={values.noTradeDay} disabled={futureOnly || (hasTrades && !values.noTradeDay)}
            description={hasTrades ? "Trades are recorded for this day, so it can't be a no-trade day." : "Marks a deliberate day off trading. It is not counted as a zero-P&L session."}
            onChange={e => setValues(s => ({ ...s, noTradeDay: e.target.checked }))} />
          {server.noTradeDay && <p className="ds-field-error" role="alert">{server.noTradeDay}</p>}
          <div className="dr-grid">
            {REFLECTION_FIELDS_ORDER.map(f => textArea("reflection", f, REFLECTION_LABELS[f], values.reflection[f], v => setReflection(f, v), futureOnly, f === "notes" ? 5 : 3))}
          </div>
        </FormSection>
      </fieldset>

      <div className="jr-form-actions dr-actions">
        <Button disabled={!dirty || busy} onClick={() => { setValues(initial); forgetEdits(account.id, day); setSummary([]); }}>Discard changes</Button>
        {review?.status === "completed" && (
          <Button icon={<RotateCcw size={16} aria-hidden="true" />} onClick={doReopen} loading={reopen.isPending} disabled={readOnly || dirty || busy}
            disabledReason={readOnly ? "Archived accounts are read-only" : dirty ? "Save or discard your changes first" : undefined}>Reopen as draft</Button>
        )}
        <Button type="submit" icon={<Save size={16} aria-hidden="true" />} loading={save.isPending} disabled={readOnly || (!dirty && review !== null) || busy || !save.canSubmit}
          disabledReason={readOnly ? "Archived accounts are read-only" : !dirty && review !== null ? "No changes to save" : !save.canSubmit && !busy ? "Saving isn't available right now" : undefined}>
          {review?.status === "completed" ? "Save changes" : "Save draft"}
        </Button>
        {review?.status !== "completed" && (
          <Button variant="primary" icon={<CircleCheck size={16} aria-hidden="true" />} onClick={() => submit("complete")()} loading={save.isPending}
            disabled={readOnly || futureOnly || busy || !save.canSubmit}
            disabledReason={readOnly ? "Archived accounts are read-only" : futureOnly ? "A day can be completed once it has started" : undefined}>
            Complete review
          </Button>
        )}
      </div>
    </form>
  );
}
const REFLECTION_FIELDS_ORDER = ["marketContext", "wentWell", "mistakes", "emotions", "keyLesson", "nextAction", "notes"] as const;

/* ---------- The day's trades and link changes ---------- */

type DayTradeRow = DailyReviewDay["trades"][number];
const LINK_TEXT: Record<"linked" | "added" | "changed", { label: string; tone: "neutral" | "flow" | "warn" }> = {
  linked: { label: "In review", tone: "neutral" }, added: { label: "Added since", tone: "flow" }, changed: { label: "Changed since", tone: "warn" },
};

function DayTrades({ account, data, dirty }: { account: AccountViewModel; data: DailyReviewDay; dirty: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const relink = useRelinkDailyReviewTrades(account.id, data.tradingDay);
  const review = data.review;
  const readOnly = data.archived || account.archivedAt !== null;
  const columns: DataColumn<DayTradeRow>[] = [
    { id: "symbol", header: "Symbol", rowHeader: true, cell: t => <span className="ds-sym">{t.symbol}</span> },
    { id: "side", header: "Side", cell: t => <Badge tone={t.side === "short" ? "loss" : "profit"} variant="outline">{t.side === "long" ? "Long" : "Short"}</Badge> },
    { id: "open", header: "Open", cell: t => <span className="ds-mono">{clock(t.entryAt, account.timezone)}</span> },
    { id: "close", header: "Close", cell: t => <span className="ds-mono">{clock(t.exitAt, account.timezone)}</span> },
    { id: "net", header: "Net P&L", align: "end", cell: t => <span className="jr-pnl"><Pnl value={t.netPnl} size="s" currency={account.currency} />{STATUS_NOTE[t.pnlStatus] && t.pnlStatus !== "open" && <Badge tone="warn">{STATUS_NOTE[t.pnlStatus]}</Badge>}</span> },
    ...(review ? [{ id: "link", header: "Review", cell: (t: DayTradeRow) => t.link ? <Badge tone={LINK_TEXT[t.link].tone}>{LINK_TEXT[t.link].label}</Badge> : null }] : []),
  ];
  const accept = () => {
    if (!review) return;
    relink.submit({ accountId: account.id, tradingDay: data.tradingDay, expectedRevision: review.revision })
      .then(() => toast.show({ tone: "success", title: "The review now uses the current trades" }), () => {});
  };
  let changed: ReactNode = null;
  if (review && (data.tradesChanged || data.sessionSettingsChanged)) {
    changed = (
      <InlineNotice tone="warning" live="off" title="The day's trades changed since this review was saved"
        actions={!readOnly ? <Button size="sm" onClick={accept} loading={relink.isPending} disabled={dirty} disabledReason={dirty ? "Save or discard your changes first" : undefined}>Use the current trades</Button> : undefined}>
        <ul className="dr-changes">
          {data.sessionSettingsChanged && <li>The account's time zone or reset time changed (saved with {review.savedWith.timezone}, {review.savedWith.resetTime}); trades were re-dated by their trading day. This review stays on {data.tradingDay}.</li>}
          {data.trades.filter(t => t.link === "added").length > 0 && <li>{data.trades.filter(t => t.link === "added").length} added (imported or entered later).</li>}
          {data.trades.filter(t => t.link === "changed").length > 0 && <li>{data.trades.filter(t => t.link === "changed").length} corrected.</li>}
          {data.missingTrades.map(m => (
            <li key={m.tradeId}>
              {m.symbol} {m.reason === "deleted" ? "was deleted" : <>moved to <Link to={dailyReviewPath(account.id, m.movedTo!)}>{longDay(m.movedTo!)}</Link></>}
              {m.netPnlWhenSaved !== null && <> (net {formatMoney(m.netPnlWhenSaved, { currency: account.currency, signed: true })} when saved)</>}.{" "}
              {m.reason === "deleted" ? <Link to="/journal?view=log">Deleted trades</Link> : <Link to={tradePath(m.tradeId)}>Open trade</Link>}
            </li>
          ))}
        </ul>
        Your notes are unchanged. The outcome above always uses the trades as they are now.
      </InlineNotice>
    );
  }
  return (
    <section className="ds-card jr-section" aria-labelledby="dr-trades-title">
      <h3 id="dr-trades-title">Trades this day</h3>
      {changed}
      {relink.error && <MutationFeedback state={toMutationState(relink, { success: "" })} />}
      {data.trades.length === 0 ? (
        <p className="ds-faint">{data.dayState === "no_trade_day" ? "No trades: you marked this a no-trade day." : "No trades are recorded for this trading day."}</p>
      ) : (
        <DataTable label={`Trades on ${longDay(data.tradingDay)}`} columns={columns} rows={data.trades} getRowId={t => t.tradeId}
          onRowClick={t => navigate(tradePath(t.tradeId))} isRowMuted={t => t.pnlStatus === "open"} />
      )}
      <p className="ds-faint jr-note">Open a trade to review or correct it; trades are edited in the Journal, not here.</p>
    </section>
  );
}

/* ---------- History ---------- */

const EVENT_TEXT: Record<DailyReview["events"][number]["kind"], string> = {
  created: "Started", saved: "Saved", completed: "Completed", edited: "Edited after completion", reopened: "Reopened as draft", relinked: "Updated to the current trades",
};

function History({ account, review }: { account: AccountViewModel; review: DailyReview }) {
  return (
    <details className="ds-card dr-history">
      <summary>History ({review.events.length})</summary>
      <ol className="dr-events">
        {[...review.events].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`}><span className="ds-mono">{formatInstant(e.at, { timeZone: account.timezone, year: true })}</span> {EVENT_TEXT[e.kind]} <span className="ds-faint">(revision {e.revision})</span></li>
        ))}
      </ol>
    </details>
  );
}
