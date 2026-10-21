// Build 23 Insights read through the Tauri adapter: command name, argument key, validation before invoking and
// payload parsing. The payload shape matches src-tauri/src/store/insights.rs.
import { describe, expect, it } from "vitest";

import { RepositoryError } from "./schemas";
import { type Invoke, createTauriRepository } from "./tauri-repository";

const dataset = { contractVersion: 1, generatedAt: "2026-10-20T15:00:00.000Z", accounts: [], trades: [] };

function fake(reply: unknown) {
  const calls: [string, Record<string, unknown>][] = [];
  const invoke: Invoke = async (command, args) => { calls.push([command, args]); return reply; };
  return { repo: createTauriRepository(invoke), calls };
}

describe("insights command", () => {
  it("sends the attempt ids to get_insights_dataset as { query }", async () => {
    const { repo, calls } = fake(dataset);
    await repo.insights.dataset({ accountIds: ["a1", "a2"] });
    expect(calls).toEqual([["get_insights_dataset", { query: { accountIds: ["a1", "a2"] } }]]);
  });

  it("refuses an empty or malformed request before invoking", () => {
    const { repo, calls } = fake(dataset);
    expect(() => repo.insights.dataset({ accountIds: [] })).toThrow(RepositoryError);
    expect(() => repo.insights.dataset({ accountIds: [""] })).toThrow(RepositoryError);
    expect(() => repo.insights.dataset({ accountIds: ["a"], extra: true } as never)).toThrow(RepositoryError);
    expect(calls).toHaveLength(0);
  });

  it("fails loudly on payload drift: another contract version, or money as a number", async () => {
    await expect(fake({ ...dataset, contractVersion: 2 }).repo.insights.dataset({ accountIds: ["a"] })).rejects.toThrow();
    const trade = { id: "t", accountId: "a", source: "manual", importBatchId: null, symbol: "ES", symbolRoot: "ES", side: "long", quantity: "1",
      entryAt: "x", exitAt: "y", tradingDay: "2026-10-19", fees: 4, grossPnl: null, realizedPnl: null, reportedPnl: null, pnlStatus: "open", updatedAt: "z", review: null };
    await expect(fake({ ...dataset, trades: [trade] }).repo.insights.dataset({ accountIds: ["a"] })).rejects.toThrow();
  });
});
