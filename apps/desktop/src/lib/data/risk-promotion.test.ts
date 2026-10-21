// P0-02 regressions at the orchestration boundary (`calculateAndSaveRisk`), over the in-memory journal that follows
// the native rules. Native atomicity itself (one read snapshot, BEGIN IMMEDIATE compare-and-promote, real SQLite
// connections) is proven in src-tauri/src/store/risk_promotion_tests.rs; these prove the desktop never presents a
// calculation built from superseded sources as saved/current.
import { defaultEnginePolicy, type JournalRepository, type RiskInputsQuery } from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import { makeAccount } from "../../features/accounts/test-store";
import { closedTrade } from "../../features/rulebooks/test-store";
import { createTodayStore } from "../../features/today/test-store";
import { calculateAndSaveRisk } from "./calculate-risk";

const A = "acct-a";
const query: RiskInputsQuery = {
  accountId: A, asOf: "2026-10-21T16:00:00.000Z",
  coverage: { baseline: "available", eodHistory: "available", closedTrades: "available", fees: "available", ledger: "available",
    openPositions: "unsupported", intradayHistory: "unsupported", sourceReference: "P0-02 regression" },
};

/** Runs `write` once, right after the calculation's first source read has answered (before it can save). */
function afterFirstRead(repository: JournalRepository, write: () => void): JournalRepository {
  let done = false;
  const evidence = new Proxy(repository.evidence, {
    get(target, key) {
      const fn = Reflect.get(target, key) as unknown;
      if (typeof fn !== "function") return fn;
      return async (...args: unknown[]) => {
        const out = await (fn as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        if (!done) { done = true; write(); }
        return out;
      };
    },
  });
  return { ...repository, evidence } as JournalRepository;
}

describe("P0-02: a calculation never becomes current from superseded sources", () => {
  it("a trade recorded after the sources were read rejects the save, and nothing is stored", async () => {
    const store = createTodayStore([makeAccount({ id: A, name: "Eval A" })]);
    store.trades.set(A, [closedTrade(A, 1, "100", "2026-10-21")]);
    const repository = afterFirstRead(store.repository as unknown as JournalRepository, () => {
      store.trades.set(A, [...store.trades.get(A)!, closedTrade(A, 2, "-900", "2026-10-21")]);
    });
    await expect(calculateAndSaveRisk(repository, query, defaultEnginePolicy, false)).rejects.toMatchObject({ error: { kind: "conflict" } });
    expect(store.snapshots).toHaveLength(0);
  });

  it("with unchanged sources the same calculation is saved and current", async () => {
    const store = createTodayStore([makeAccount({ id: A, name: "Eval A" })]);
    store.trades.set(A, [closedTrade(A, 1, "100", "2026-10-21")]);
    const saved = await calculateAndSaveRisk(store.repository as unknown as JournalRepository, query, defaultEnginePolicy, false);
    expect(store.snapshots.map(s => s.id)).toEqual([saved.id]);
  });
});
