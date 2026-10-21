import { describe, expect, it } from "vitest";

import { type JournalRepository, RepositoryError } from "../../src/index.js";

describe("RepositoryError", () => {
  it("carries the AppError and its field issues", () => {
    const e = new RepositoryError({
      kind: "validation",
      message: "symbol: required",
      issues: [{ field: "symbol", message: "required" }],
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("symbol: required");
    expect(e.issues).toEqual([{ field: "symbol", message: "required" }]);
  });

  it("has no issues for other kinds", () => {
    expect(new RepositoryError({ kind: "notFound", message: "trade 't1' not found" }).issues).toEqual([]);
  });
});

describe("JournalRepository", () => {
  it("can be implemented without any host type", async () => {
    const none = () => Promise.resolve([]);
    const fail = () => Promise.reject(new RepositoryError({ kind: "unavailable", message: "offline" }));
    const repo: JournalRepository = {
      evidence: { inputs: fail, create: fail, get: fail, list: none, correct: fail, ledgerHistory: none, correctLedger: fail, removeLedger: fail, reconcile: fail, reconciliations: none, resolve: fail, resolutions: none },
      accounts: {
        list: none, get: fail, listActive: none, create: fail, update: fail, archive: fail, restore: fail,
        changeStatus: fail, history: fail, resetAttempt: fail, lineage: none, previewDeletion: fail,
      },
      trades: { list: none, create: fail, update: fail, remove: fail, restore: fail, listDeleted: none, detail: fail },
      journal: { list: none, create: fail, update: fail, remove: fail },
      reviews: { get: fail, save: fail, summaries: none, addScreenshot: fail, readScreenshot: fail, removeScreenshot: fail },
      dailyReviews: { getDay: fail, list: fail, save: fail, reopen: fail, relinkTrades: fail },
      library: { load: fail, saveStrategy: fail, saveTag: fail, saveChecklist: fail, setArchived: fail },
      imports: { preview: fail, commit: fail, list: none, problemRows: none },
      ledger: { list: none, create: fail, update: fail, remove: fail, balanceAdjustment: fail },
      settings: { get: fail, list: none, set: fail, remove: fail },
      snapshots: { save: fail, list: none, latest: fail },
      catalogue: {
        load: fail, transitionVersion: fail, getAccountLink: fail, setAccountLink: fail,
        listPhaseEvents: none, recordPhaseEvent: fail, createSource: fail, createDraft: fail, replaceDraft: fail,
        selectOffer: fail, listOfferSelections: none,
      },
      rulebooks: {
        list: none, listVersions: none, getVersion: fail, getApplicable: fail, createDraft: fail,
        validateDraft: none, publish: fail, assign: fail, listAssignments: none, flagSourceConflict: fail,
        updateDraft: fail, discardDraft: fail, listEvents: none,
      },
    };
    expect(await repo.accounts.list()).toEqual([]);
    await expect(repo.trades.remove("t1")).rejects.toBeInstanceOf(RepositoryError);
  });
});
