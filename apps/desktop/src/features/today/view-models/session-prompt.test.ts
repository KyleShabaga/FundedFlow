// P0-D27 session prompt model: which stage Today offers (plan until Rust attributes a trade, then review), whether the
// plan and review are new, started or done, and that saved skips only hide the matching account, day and stage.
import type { DailyReview, DailyReviewDay } from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import {
  addSessionSkip, MAX_SESSION_SKIPS, readSessionSkips, removeSessionSkip, sessionPromptState,
  type SessionPromptState, type SessionSkip,
} from "./session-prompt";

const A = "acct-a";
const B = "acct-b";
const DAY = "2026-10-21";
const NEXT = "2026-10-22";

const emptyPlan: DailyReview["plan"] = { focus: null, setups: null, noTradeConditions: null, commitments: null, maxRisk: null, notes: null, authoredAt: null, timing: null };
const emptyReflection: DailyReview["reflection"] = { marketContext: null, wentWell: null, mistakes: null, emotions: null, keyLesson: null, nextAction: null, notes: null };

function review(over: Partial<DailyReview> = {}): DailyReview {
  return {
    id: "review-1", accountId: A, tradingDay: DAY, status: "draft", revision: 1, plan: emptyPlan, reflection: emptyReflection, noTradeDay: false,
    checklist: null, answers: [], adherence: { followed: 0, missed: 0, notApplicable: 0, unanswered: 0, answered: 0, percent: null },
    savedWith: { timezone: "America/New_York", resetTime: "17:00" }, completedAt: null, firstCompletedAt: null, editedAfterCompletionAt: null,
    reopenedAt: null, events: [], createdAt: "2026-10-21T12:00:00.000Z", updatedAt: "2026-10-21T12:00:00.000Z",
    ...over,
  };
}
function reviewDay(over: Partial<DailyReviewDay> = {}, trades = 0): DailyReviewDay {
  return {
    accountId: A, tradingDay: DAY, session: { timezone: "America/New_York", resetTime: "17:00" }, sessionStart: "2026-10-20T21:00:00.000Z",
    sessionEnd: "2026-10-21T21:00:00.000Z", currentTradingDay: DAY, isFuture: false, archived: false, review: null, trades: [], missingTrades: [],
    outcome: { trades, closedWithKnownPnl: trades, unknownPnl: 0, open: 0, net: trades > 0 ? "10" : null },
    dayState: trades > 0 ? "traded" : "no_trades_recorded", sessionSettingsChanged: false, tradesChanged: false,
    ...over,
  };
}
const loaded = (data: DailyReviewDay | undefined, error: unknown = null) => ({ data, error });
function ready(s: SessionPromptState) {
  if (s.kind !== "ready") throw new Error(`expected ready, got ${s.kind}`);
  return s;
}
const state = (data: DailyReviewDay, skips: readonly SessionSkip[] = []) => ready(sessionPromptState(A, DAY, loaded(data), skips));

describe("loading and unavailable", () => {
  it("is loading while the trading day is not known yet", () => {
    expect(sessionPromptState(A, null, loaded(reviewDay()), [])).toEqual({ kind: "loading" });
  });
  it("is loading while there is no data and no error", () => {
    expect(sessionPromptState(A, DAY, loaded(undefined), [])).toEqual({ kind: "loading" });
  });
  it("treats a late response for another account as not read yet", () => {
    expect(sessionPromptState(B, DAY, loaded(reviewDay()), [])).toEqual({ kind: "loading" });
  });
  it("treats a response for another trading day as not read yet after a rollover", () => {
    expect(sessionPromptState(A, NEXT, loaded(reviewDay()), [])).toEqual({ kind: "loading" });
  });
  it("is unavailable on an error for a known trading day with no data", () => {
    expect(sessionPromptState(A, DAY, loaded(undefined, new Error("boom")), [])).toEqual({ kind: "unavailable" });
  });
  it("stays loading on an error while the trading day is not known", () => {
    expect(sessionPromptState(A, null, loaded(undefined, new Error("boom")), [])).toEqual({ kind: "loading" });
  });
});

describe("stage", () => {
  it("offers the plan before any trade", () => {
    expect(state(reviewDay())).toMatchObject({ kind: "ready", tradingDay: DAY, stage: "plan", trades: 0 });
  });
  it("offers the review once Rust attributes a trade to the day", () => {
    expect(state(reviewDay({}, 1))).toMatchObject({ stage: "review", trades: 1 });
    expect(state(reviewDay({}, 3))).toMatchObject({ stage: "review", trades: 3 });
  });
  it("goes back to the plan when the day's trades drop to zero, keeping plan, review and skips", () => {
    const r = review({ plan: { ...emptyPlan, focus: "Opening range" }, reflection: { ...emptyReflection, wentWell: "Patience" } });
    const skips = [{ accountId: A, tradingDay: DAY, stage: "plan" as const }];
    expect(state(reviewDay({ review: r }, 2), skips)).toMatchObject({ stage: "review", plan: "saved", review: "started", skipped: false });
    expect(state(reviewDay({ review: r }, 0), skips)).toMatchObject({ stage: "plan", plan: "saved", review: "started", skipped: true });
  });
});

describe("plan", () => {
  it("is none without a review", () => {
    expect(state(reviewDay()).plan).toBe("none");
  });
  it("is none when every plan field is null or whitespace", () => {
    const plan = { ...emptyPlan, focus: "   ", setups: "\n\t", notes: "", authoredAt: "2026-10-21T12:00:00.000Z", timing: "pre_session" as const };
    expect(state(reviewDay({ review: review({ plan }) })).plan).toBe("none");
  });
  it.each(["focus", "setups", "noTradeConditions", "commitments", "maxRisk", "notes"] as const)("is saved when %s has text", key => {
    expect(state(reviewDay({ review: review({ plan: { ...emptyPlan, [key]: "x" } }) })).plan).toBe("saved");
  });
  it("stays saved in the review stage; trading never erases a plan", () => {
    expect(state(reviewDay({ review: review({ plan: { ...emptyPlan, focus: "VWAP" } }) }, 1))).toMatchObject({ stage: "review", plan: "saved" });
  });
});

describe("review", () => {
  it("is none without a review or with an empty draft", () => {
    expect(state(reviewDay()).review).toBe("none");
    expect(state(reviewDay({ review: review() })).review).toBe("none");
  });
  it("is none when only the plan has text", () => {
    expect(state(reviewDay({ review: review({ plan: { ...emptyPlan, focus: "x" } }) }, 1)).review).toBe("none");
  });
  it.each(["marketContext", "wentWell", "mistakes", "emotions", "keyLesson", "nextAction", "notes"] as const)("is started when the draft's %s has text", key => {
    expect(state(reviewDay({ review: review({ reflection: { ...emptyReflection, [key]: "x" } }) }, 1)).review).toBe("started");
  });
  it("ignores whitespace-only reflection text", () => {
    expect(state(reviewDay({ review: review({ reflection: { ...emptyReflection, keyLesson: "  " } }) }, 1)).review).toBe("none");
  });
  it("is started when a draft declares a no-trade day", () => {
    expect(state(reviewDay({ review: review({ noTradeDay: true }) })).review).toBe("started");
  });
  it("is completed only from a completed status, even in the plan stage", () => {
    expect(state(reviewDay({ review: review({ status: "completed" }) }))).toMatchObject({ stage: "plan", review: "completed" });
    expect(state(reviewDay({ review: review({ status: "completed" }) }, 1))).toMatchObject({ stage: "review", review: "completed" });
  });
  it("is not completed by activity or skips", () => {
    const r = review({ reflection: { ...emptyReflection, wentWell: "x", keyLesson: "y" }, noTradeDay: true, completedAt: null });
    const skips = [{ accountId: A, tradingDay: DAY, stage: "review" as const }];
    expect(state(reviewDay({ review: r }, 1), skips)).toMatchObject({ review: "started", skipped: true });
  });
});

describe("skipped", () => {
  it("is skipped only for the same account, trading day and current stage", () => {
    expect(state(reviewDay(), [{ accountId: A, tradingDay: DAY, stage: "plan" }]).skipped).toBe(true);
    expect(state(reviewDay(), []).skipped).toBe(false);
  });
  it("does not carry a plan skip into the review stage", () => {
    expect(state(reviewDay({}, 1), [{ accountId: A, tradingDay: DAY, stage: "plan" }]).skipped).toBe(false);
  });
  it("ignores skips for another day or another account", () => {
    expect(state(reviewDay(), [{ accountId: A, tradingDay: "2026-10-20", stage: "plan" }, { accountId: B, tradingDay: DAY, stage: "plan" }]).skipped).toBe(false);
  });
});

describe("saved skips", () => {
  const s = (accountId: string, tradingDay: string, stage: "plan" | "review" = "plan"): SessionSkip => ({ accountId, tradingDay, stage });

  it("reads anything but an array as no skips", () => {
    expect(readSessionSkips(undefined)).toEqual([]);
    expect(readSessionSkips(null)).toEqual([]);
    expect(readSessionSkips("[]")).toEqual([]);
    expect(readSessionSkips({ accountId: A, tradingDay: DAY, stage: "plan" })).toEqual([]);
  });
  it("drops malformed entries and unknown stages, keeping valid ones", () => {
    const valid = [s(A, DAY), s(B, DAY, "review")];
    const raw: unknown = [
      valid[0], null, 7, "x", { accountId: A, tradingDay: DAY }, { accountId: 1, tradingDay: DAY, stage: "plan" },
      { accountId: A, tradingDay: null, stage: "plan" }, { accountId: A, tradingDay: DAY, stage: "close" }, valid[1],
    ];
    expect(readSessionSkips(raw)).toEqual(valid);
  });
  it("adds a skip at the end and moves an existing one there instead of duplicating it", () => {
    const list = [s(A, DAY), s(B, DAY), s(A, NEXT)];
    expect(addSessionSkip(list, s(A, DAY, "review"))).toEqual([...list, s(A, DAY, "review")]);
    expect(addSessionSkip(list, s(A, DAY))).toEqual([s(B, DAY), s(A, NEXT), s(A, DAY)]);
  });
  it("keeps at most MAX_SESSION_SKIPS, dropping the oldest", () => {
    const full = Array.from({ length: MAX_SESSION_SKIPS }, (_, i) => s(`acct-${i}`, DAY));
    const next = addSessionSkip(full, s(A, NEXT));
    expect(next).toHaveLength(MAX_SESSION_SKIPS);
    expect(next[0]).toEqual(s("acct-1", DAY));
    expect(next[next.length - 1]).toEqual(s(A, NEXT));
  });
  it("removes only the exact entry", () => {
    const list = [s(A, DAY), s(A, DAY, "review"), s(B, DAY), s(A, NEXT)];
    expect(removeSessionSkip(list, s(A, DAY))).toEqual([s(A, DAY, "review"), s(B, DAY), s(A, NEXT)]);
    expect(removeSessionSkip(list, s(B, NEXT))).toEqual(list);
  });
});
