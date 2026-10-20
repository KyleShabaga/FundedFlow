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
      accounts: { list: none, create: fail, update: fail, archive: fail },
      trades: { list: none, create: fail, update: fail, remove: fail },
      journal: { list: none, create: fail, update: fail, remove: fail },
      imports: { preview: fail, commit: fail, list: none, problemRows: none },
    };
    expect(await repo.accounts.list()).toEqual([]);
    await expect(repo.trades.remove("t1")).rejects.toBeInstanceOf(RepositoryError);
  });
});
