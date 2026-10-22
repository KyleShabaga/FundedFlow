// P0-D27: the optional session prompt on Today. Which stage it offers, and whether that stage is new, started or done,
// comes only from what Rust reports for the selected account's current trading day (get_daily_review): the trades it
// attributes to that day, and the day's one daily review record, which holds both the plan and the after-session
// review. Skips are presentation state, saved per account, trading day and stage; they never mark anything done.
import type { DailyReviewDay } from "@fundedflow/domain";

export type SessionStage = "plan" | "review";

/** One saved skip: this account's prompt for this trading day and stage was dismissed. */
export interface SessionSkip { accountId: string; tradingDay: string; stage: SessionStage }

export type SessionPromptState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
    kind: "ready";
    tradingDay: string;
    /** Review once the day has a trade (Rust's attribution); the plan until then. Recomputed on every read. */
    stage: SessionStage;
    trades: number;
    /** The plan has content in the day's review. A plan is never cleared because trading started. */
    plan: "none" | "saved";
    /** After-session review: not started, started (reflection or a no-trade-day declaration in a draft), or completed. */
    review: "none" | "started" | "completed";
    skipped: boolean;
  };

/** Settings key for the saved skips (one list: account ids can't be part of a settings key). */
export const SESSION_SKIPS_SETTING = "today.session_prompt_skips";
/** Older skips are dropped beyond this many; a skip only matters on its own trading day. */
export const MAX_SESSION_SKIPS = 100;

const PLAN_TEXT = ["focus", "setups", "noTradeConditions", "commitments", "maxRisk", "notes"] as const;
const REFLECTION_TEXT = ["marketContext", "wentWell", "mistakes", "emotions", "keyLesson", "nextAction", "notes"] as const;
const written = (v: string | null) => v !== null && v.trim() !== "";

/**
 * The prompt for `accountId` on `tradingDay` (the index's current trading day; null while it is read). A response for
 * another account or day, such as a late answer after a switch or a day rollover, counts as not read yet.
 */
export function sessionPromptState(
  accountId: string,
  tradingDay: string | null,
  day: { data: DailyReviewDay | undefined; error: unknown },
  skips: readonly SessionSkip[],
): SessionPromptState {
  const d = day.data;
  if (tradingDay === null || d === undefined || d.accountId !== accountId || d.tradingDay !== tradingDay) {
    return day.error && tradingDay !== null ? { kind: "unavailable" } : { kind: "loading" };
  }
  const r = d.review;
  const plan = r && PLAN_TEXT.some(k => written(r.plan[k])) ? "saved" : "none";
  const review = r?.status === "completed" ? "completed"
    : r && (REFLECTION_TEXT.some(k => written(r.reflection[k])) || r.noTradeDay) ? "started" : "none";
  const stage: SessionStage = d.outcome.trades > 0 ? "review" : "plan";
  const skipped = skips.some(s => s.accountId === accountId && s.tradingDay === d.tradingDay && s.stage === stage);
  return { kind: "ready", tradingDay: d.tradingDay, stage, trades: d.outcome.trades, plan, review, skipped };
}

/** The saved list, ignoring anything malformed. */
export function readSessionSkips(value: unknown): SessionSkip[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is SessionSkip =>
    typeof s === "object" && s !== null && typeof s.accountId === "string" && typeof s.tradingDay === "string" && (s.stage === "plan" || s.stage === "review"));
}

const same = (a: SessionSkip, b: SessionSkip) => a.accountId === b.accountId && a.tradingDay === b.tradingDay && a.stage === b.stage;
export const addSessionSkip = (skips: readonly SessionSkip[], skip: SessionSkip) => [...skips.filter(s => !same(s, skip)), skip].slice(-MAX_SESSION_SKIPS);
export const removeSessionSkip = (skips: readonly SessionSkip[], skip: SessionSkip) => skips.filter(s => !same(s, skip));
