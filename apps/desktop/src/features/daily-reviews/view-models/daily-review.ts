// Build 22 daily review: form values, the save payload, presentation of stored facts and day-key navigation.
// Nothing here derives a trading day from the clock or computes P&L or adherence: those come from Rust. Day-key
// stepping is calendar arithmetic over stored keys (Monday to Friday), and Rust rejects a key it doesn't accept.
import type { ChecklistResult, DailyAdherence, DailyReview, DailyReviewDay, DailyReviewInput, DailyReviewSummary } from "@fundedflow/domain";

export const PLAN_FIELDS = ["focus", "setups", "noTradeConditions", "commitments", "maxRisk", "notes"] as const;
export const REFLECTION_FIELDS = ["marketContext", "wentWell", "mistakes", "emotions", "keyLesson", "nextAction", "notes"] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];
export type ReflectionField = (typeof REFLECTION_FIELDS)[number];

export interface DailyReviewValues {
  plan: Record<PlanField, string>;
  reflection: Record<ReflectionField, string>;
  noTradeDay: boolean;
  checklistId: string | null;
  answers: Record<string, { result: ChecklistResult; note: string }>;
}

export function reviewValues(review: DailyReview | null): DailyReviewValues {
  const p = review?.plan;
  const r = review?.reflection;
  return {
    plan: {
      focus: p?.focus ?? "", setups: p?.setups ?? "", noTradeConditions: p?.noTradeConditions ?? "",
      commitments: p?.commitments ?? "", maxRisk: p?.maxRisk ?? "", notes: p?.notes ?? "",
    },
    reflection: {
      marketContext: r?.marketContext ?? "", wentWell: r?.wentWell ?? "", mistakes: r?.mistakes ?? "", emotions: r?.emotions ?? "",
      keyLesson: r?.keyLesson ?? "", nextAction: r?.nextAction ?? "", notes: r?.notes ?? "",
    },
    noTradeDay: review?.noTradeDay ?? false,
    checklistId: review?.checklist?.id ?? null,
    answers: Object.fromEntries((review?.answers ?? []).map(a => [a.itemId, { result: a.result, note: a.note ?? "" }])),
  };
}

export function toDailyReviewInput(
  accountId: string, tradingDay: string, revision: number | null, v: DailyReviewValues, action: "save" | "complete",
): DailyReviewInput {
  const text = (s: string) => (s.trim() === "" ? null : s);
  return {
    accountId,
    tradingDay,
    expectedRevision: revision,
    plan: {
      focus: text(v.plan.focus), setups: text(v.plan.setups), noTradeConditions: text(v.plan.noTradeConditions),
      commitments: text(v.plan.commitments), maxRisk: v.plan.maxRisk.trim() === "" ? null : v.plan.maxRisk.trim(), notes: text(v.plan.notes),
    },
    reflection: {
      marketContext: text(v.reflection.marketContext), wentWell: text(v.reflection.wentWell), mistakes: text(v.reflection.mistakes),
      emotions: text(v.reflection.emotions), keyLesson: text(v.reflection.keyLesson), nextAction: text(v.reflection.nextAction),
      notes: text(v.reflection.notes),
    },
    noTradeDay: v.noTradeDay,
    checklistId: v.checklistId,
    answers: v.checklistId ? Object.entries(v.answers).map(([itemId, a]) => ({ itemId, result: a.result, note: text(a.note) })) : [],
    action,
  };
}

export const sameValues = (a: DailyReviewValues, b: DailyReviewValues) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- Status and adherence wording ---------- */

export type ReviewStatusView = { label: string; tone: "neutral" | "flow" | "profit" | "warn" };

export function statusView(review: Pick<DailyReview, "status" | "editedAfterCompletionAt"> | Pick<DailyReviewSummary, "status"> | null): ReviewStatusView {
  if (!review) return { label: "Not started", tone: "neutral" };
  if (review.status === "draft") return { label: "Draft", tone: "warn" };
  return "editedAfterCompletionAt" in review && review.editedAfterCompletionAt
    ? { label: "Completed · edited", tone: "profit" }
    : { label: "Completed", tone: "profit" };
}

/** "3 of 4 applicable items followed (75%)", or Unknown when nothing applicable was answered. Never 0% or 100% by default. */
export function adherenceText(a: DailyAdherence): string {
  if (a.percent === null) {
    return a.notApplicable > 0 ? "Unknown: only not-applicable answers" : "Unknown: not enough answers";
  }
  return `${a.followed} of ${a.answered} applicable ${a.answered === 1 ? "item" : "items"} followed (${a.percent}%)`;
}

/** Short form for lists and day cards: "Plan 75% · 3/4", or "Plan —". */
export function adherenceShort(a: DailyAdherence): string {
  return a.percent === null ? "Plan adherence —" : `Plan adherence ${a.percent}% · ${a.followed}/${a.answered}`;
}

export function adherenceDetail(a: DailyAdherence): string {
  const parts = [`${a.followed} followed`, `${a.missed} missed`, `${a.notApplicable} not applicable`, `${a.unanswered} unanswered`];
  return `${parts.join(" · ")}. Not applicable and unanswered items don't count against you.`;
}

export const DAY_STATE_TEXT: Record<DailyReviewDay["dayState"], string> = {
  traded: "Traded",
  no_trade_day: "No-trade day (by choice)",
  no_trades_recorded: "No trades recorded",
};

/* ---------- Day keys ---------- */

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
function keyDate(day: string): Date | null {
  const m = KEY.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === day ? d : null;
}

/** A valid YYYY-MM-DD key that falls Monday to Friday. */
export function isTradingDayKey(day: string): boolean {
  const d = keyDate(day);
  return d !== null && d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
}

/** The next (+1) or previous (−1) Monday-to-Friday key. */
export function stepTradingDay(day: string, direction: 1 | -1): string {
  const d = keyDate(day);
  if (!d) return day;
  do d.setUTCDate(d.getUTCDate() + direction); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Deep link to one account's review of one trading day. The account is explicit so a link never changes meaning. */
export const dailyReviewPath = (accountId: string, day: string) =>
  `/journal/days/${encodeURIComponent(day)}?account=${encodeURIComponent(accountId)}`;
