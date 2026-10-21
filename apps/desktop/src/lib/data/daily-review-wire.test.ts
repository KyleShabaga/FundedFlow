// Build 22 daily-review calls through the Tauri adapter: command names, argument keys, input validation before
// invoking and payload parsing. The payload shapes match src-tauri/src/store/daily_reviews.rs.
import { describe, expect, it } from "vitest";

import { RepositoryError } from "./schemas";
import { type Invoke, createTauriRepository } from "./tauri-repository";

const outcome = { trades: 0, closedWithKnownPnl: 0, unknownPnl: 0, open: 0, net: null };
const day = {
  accountId: "a1", tradingDay: "2026-10-19", session: { timezone: "America/New_York", resetTime: "17:00" },
  sessionStart: "2026-10-16T21:00:00.000Z", sessionEnd: "2026-10-19T21:00:00.000Z", currentTradingDay: "2026-10-20",
  isFuture: false, archived: false, review: null, trades: [], missingTrades: [], outcome, dayState: "no_trades_recorded",
  sessionSettingsChanged: false, tradesChanged: false,
};
const index = { accountId: "a1", currentTradingDay: "2026-10-20", session: day.session, archived: false, reviews: [], legacyNotes: [] };
const input = {
  accountId: "a1", tradingDay: "2026-10-19", expectedRevision: null, plan: { maxRisk: "250" }, reflection: { keyLesson: "Wait" },
  noTradeDay: false, checklistId: null, answers: [], action: "save" as const,
};

function fake(reply: (command: string) => unknown) {
  const calls: [string, Record<string, unknown>][] = [];
  const invoke: Invoke = async (command, args) => { calls.push([command, args]); return reply(command); };
  return { repo: createTauriRepository(invoke), calls };
}

describe("daily review commands", () => {
  it("sends each call to its command in commands.rs with its argument keys", async () => {
    const { repo, calls } = fake(c => (c === "list_daily_reviews" ? index : day));
    await repo.dailyReviews.getDay("a1", "2026-10-19");
    await repo.dailyReviews.list("a1");
    await repo.dailyReviews.save(input);
    await repo.dailyReviews.reopen({ accountId: "a1", tradingDay: "2026-10-19", expectedRevision: 2 });
    await repo.dailyReviews.relinkTrades({ accountId: "a1", tradingDay: "2026-10-19", expectedRevision: 3 });
    expect(calls.map(c => c[0])).toEqual(["get_daily_review", "list_daily_reviews", "save_daily_review", "reopen_daily_review", "relink_daily_review_trades"]);
    expect(calls[0][1]).toEqual({ accountId: "a1", tradingDay: "2026-10-19" });
    expect(calls[2][1]).toEqual({ input });
    expect(calls[3][1]).toEqual({ input: { accountId: "a1", tradingDay: "2026-10-19", expectedRevision: 2 } });
  });

  it("validates inputs before invoking", () => {
    const { repo, calls } = fake(() => day);
    expect(() => repo.dailyReviews.save({ ...input, plan: { maxRisk: "0" } })).toThrow(RepositoryError);
    expect(() => repo.dailyReviews.save({ ...input, tradingDay: "19/10/2026" })).toThrow(RepositoryError);
    expect(() => repo.dailyReviews.save({ ...input, action: "finish" as never })).toThrow(RepositoryError);
    expect(() => repo.dailyReviews.save({ ...input, reflection: { keyLesson: "x".repeat(20_001) } })).toThrow(RepositoryError);
    expect(() => repo.dailyReviews.reopen({ accountId: "a1", tradingDay: "2026-10-19", expectedRevision: 0 })).toThrow(RepositoryError);
    expect(calls).toHaveLength(0);
  });

  it("fails loudly on payload drift, such as adherence given as a number or zero for an unknown outcome", async () => {
    const { repo } = fake(() => ({ ...day, outcome: { ...outcome, net: 0 } }));
    await expect(repo.dailyReviews.getDay("a1", "2026-10-19")).rejects.toThrow();
  });
});
