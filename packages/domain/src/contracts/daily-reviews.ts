// Build 22 DTOs: daily reviews (plan, reflection, day-level checklist answers) for one account attempt and one
// trading day. Field names and shapes match the serde structs in
// apps/desktop/src-tauri/src/store/daily_reviews.rs. Rust computes every derived value (trading days, the session
// window, plan timing, adherence, the day's closed-trade outcome and trade link status); these schemas only give
// early feedback and reject payload drift.

import { z } from "zod";

import { decimal, optionalText } from "./fields.js";
import { checklistAnswerSchema, checklistResults, labelRefSchema } from "./reviews.js";

/** A Monday-to-Friday trading day key (YYYY-MM-DD), as Rust stores it. */
export const tradingDayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date (YYYY-MM-DD)");

const text = z.string().nullable();

export const dailyReviewStatuses = ["draft", "completed"] as const;
export type DailyReviewStatus = (typeof dailyReviewStatuses)[number];
export const planTimings = ["pre_session", "retrospective"] as const;
export type PlanTiming = (typeof planTimings)[number];
export const reviewEventKinds = ["created", "saved", "completed", "edited", "reopened", "relinked"] as const;
export const dayStates = ["traded", "no_trade_day", "no_trades_recorded"] as const;
export type DayState = (typeof dayStates)[number];
export const tradeLinks = ["linked", "added", "changed"] as const;
export type TradeLink = (typeof tradeLinks)[number];

/**
 * Process only: followed ÷ (followed + missed). Unanswered and not-applicable items are never failures; with no
 * applicable answer `percent` is null (Unknown), never 0% or 100%. Says nothing about profit or firm compliance.
 */
export const dailyAdherenceSchema = z.object({
  followed: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
  unanswered: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  /** Whole percent as text, rounded by Rust. */
  percent: z.string().regex(/^\d{1,3}$/).nullable(),
});
export type DailyAdherence = z.infer<typeof dailyAdherenceSchema>;

export const planSchema = z.object({
  focus: text,
  setups: text,
  noTradeConditions: text,
  commitments: text,
  /** Self-imposed maximum risk (account currency, decimal text); null is not stated, never zero. */
  maxRisk: text,
  notes: text,
  /** When the plan first had content. */
  authoredAt: text,
  /** pre_session: written before the session ended and before its first trade opened; otherwise retrospective. */
  timing: z.enum(planTimings).nullable(),
});
export type Plan = z.infer<typeof planSchema>;

export const reflectionSchema = z.object({
  marketContext: text,
  wentWell: text,
  mistakes: text,
  emotions: text,
  keyLesson: text,
  nextAction: text,
  notes: text,
});
export type Reflection = z.infer<typeof reflectionSchema>;

export const sessionSettingsSchema = z.object({ timezone: z.string(), resetTime: z.string() });
export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export const reviewEventSchema = z.object({ kind: z.enum(reviewEventKinds), revision: z.number().int().positive(), at: z.string() });
export type ReviewEvent = z.infer<typeof reviewEventSchema>;

export const dailyReviewSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  tradingDay: tradingDayKey,
  status: z.enum(dailyReviewStatuses),
  revision: z.number().int().positive(),
  plan: planSchema,
  reflection: reflectionSchema,
  noTradeDay: z.boolean(),
  checklist: labelRefSchema.nullable(),
  answers: z.array(checklistAnswerSchema),
  adherence: dailyAdherenceSchema,
  /** The account's zone and reset when the review was last saved. */
  savedWith: sessionSettingsSchema,
  completedAt: text,
  firstCompletedAt: text,
  editedAfterCompletionAt: text,
  reopenedAt: text,
  events: z.array(reviewEventSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DailyReview = z.infer<typeof dailyReviewSchema>;

export const dayTradeSchema = z.object({
  tradeId: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  entryAt: z.string(),
  exitAt: text,
  netPnl: text,
  pnlStatus: z.enum(["calculated", "reported", "open", "missing_instrument", "currency_mismatch"]),
  /** null while the day has no review. */
  link: z.enum(tradeLinks).nullable(),
});
export type DayTrade = z.infer<typeof dayTradeSchema>;

export const missingTradeSchema = z.object({
  tradeId: z.string(),
  symbol: z.string(),
  reason: z.enum(["deleted", "moved"]),
  movedTo: tradingDayKey.nullable(),
  netPnlWhenSaved: text,
});
export type MissingTrade = z.infer<typeof missingTradeSchema>;

/** Closed-trade outcome, summed by Rust over known P&L only; the rest is counted, never zeroed. */
export const dayOutcomeSchema = z.object({
  trades: z.number().int().nonnegative(),
  closedWithKnownPnl: z.number().int().nonnegative(),
  unknownPnl: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  net: text,
});
export type DayOutcome = z.infer<typeof dayOutcomeSchema>;

export const dailyReviewDaySchema = z.object({
  accountId: z.string(),
  tradingDay: tradingDayKey,
  session: sessionSettingsSchema,
  sessionStart: z.string(),
  sessionEnd: z.string(),
  currentTradingDay: tradingDayKey,
  isFuture: z.boolean(),
  archived: z.boolean(),
  review: dailyReviewSchema.nullable(),
  trades: z.array(dayTradeSchema),
  missingTrades: z.array(missingTradeSchema),
  outcome: dayOutcomeSchema,
  dayState: z.enum(dayStates),
  sessionSettingsChanged: z.boolean(),
  tradesChanged: z.boolean(),
});
export type DailyReviewDay = z.infer<typeof dailyReviewDaySchema>;

export const dailyReviewSummarySchema = z.object({
  id: z.string(),
  tradingDay: tradingDayKey,
  status: z.enum(dailyReviewStatuses),
  revision: z.number().int().positive(),
  planTiming: z.enum(planTimings).nullable(),
  hasPlan: z.boolean(),
  hasReflection: z.boolean(),
  noTradeDay: z.boolean(),
  keyLesson: text,
  adherence: dailyAdherenceSchema,
  outcome: dayOutcomeSchema,
  tradesChanged: z.boolean(),
  completedAt: text,
  updatedAt: z.string(),
});
export type DailyReviewSummary = z.infer<typeof dailyReviewSummarySchema>;

/** A generic journal entry without a trade, written before Build 22: listed apart, never counted as a review. */
export const legacyDayNoteSchema = z.object({ id: z.string(), title: z.string(), entryAt: z.string(), tradingDay: tradingDayKey });
export type LegacyDayNote = z.infer<typeof legacyDayNoteSchema>;

export const dailyReviewIndexSchema = z.object({
  accountId: z.string(),
  currentTradingDay: tradingDayKey,
  session: sessionSettingsSchema,
  archived: z.boolean(),
  reviews: z.array(dailyReviewSummarySchema),
  legacyNotes: z.array(legacyDayNoteSchema),
});
export type DailyReviewIndex = z.infer<typeof dailyReviewIndexSchema>;

/* ---------- Inputs ---------- */

const longText = optionalText(20_000);
export const dailyReviewInputSchema = z.strictObject({
  accountId: z.string().min(1),
  tradingDay: tradingDayKey,
  /** The revision the form started from; null when no review existed. */
  expectedRevision: z.number().int().positive().nullable(),
  plan: z.strictObject({
    focus: longText,
    setups: longText,
    noTradeConditions: longText,
    commitments: longText,
    maxRisk: z.union([decimal.refine(v => Number(v) > 0, "Must be greater than zero (leave it empty when not set)"), z.literal("")]).nullish(),
    notes: longText,
  }),
  reflection: z.strictObject({
    marketContext: longText,
    wentWell: longText,
    mistakes: longText,
    emotions: longText,
    keyLesson: longText,
    nextAction: longText,
    notes: longText,
  }),
  noTradeDay: z.boolean(),
  checklistId: z.string().min(1).nullish(),
  answers: z.array(z.strictObject({ itemId: z.string().min(1), result: z.enum(checklistResults), note: optionalText(2000) })),
  /** save keeps the status (a completed review stays completed and is marked edited); complete completes it. */
  action: z.enum(["save", "complete"]),
});
export type DailyReviewInput = z.input<typeof dailyReviewInputSchema>;

export const dailyReviewRefSchema = z.strictObject({
  accountId: z.string().min(1),
  tradingDay: tradingDayKey,
  expectedRevision: z.number().int().positive(),
});
export type DailyReviewRef = z.input<typeof dailyReviewRefSchema>;
