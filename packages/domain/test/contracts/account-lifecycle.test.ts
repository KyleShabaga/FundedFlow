import { describe, expect, it } from "vitest";

import {
  type Account,
  type AttemptSummary,
  accountSchema,
  assessImportTarget,
  filterAccounts,
  isHistorical,
  isRiskEligible,
  resetInputSchema,
  selectRiskEligibleAccounts,
  statusChangeInputSchema,
} from "../../src/index.js";

const T = "2026-10-19T14:30:00.000Z";
const acct = (id: string, status: Account["status"], archivedAt: string | null = null): Account =>
  accountSchema.parse({
    id, name: id, broker: null, propFirm: null, externalRef: null, accountType: "evaluation", status,
    currency: "USD", startingBalance: "50000", timezone: "America/New_York", tradingDayResetTime: "17:00",
    notes: null, createdAt: T, updatedAt: T, archivedAt,
  });

const all = [
  acct("live", "active"), acct("paused", "paused"), acct("passed", "passed"), acct("failed", "failed"),
  acct("closed", "closed"), acct("old-failed", "failed", T), acct("old-active", "active", T),
];
const ids = (xs: Account[]) => xs.map((a) => a.id);

describe("account lifecycle presentation rules", () => {
  it("defaults the lifecycle fields so older payloads still parse", () => {
    const a = acct("x", "active");
    expect([a.archivedAt, a.predecessorAccountId, a.successorAccountId]).toEqual([null, null, null]);
  });

  it("filters history without counting an account twice", () => {
    expect(ids(filterAccounts(all, "live"))).toEqual(["live", "paused"]);
    expect(ids(filterAccounts(all, "failed"))).toEqual(["failed"]);
    expect(ids(filterAccounts(all, "archived"))).toEqual(["old-failed", "old-active"]);
    expect(ids(filterAccounts(all, "all"))).toHaveLength(7);
  });

  it("lets only active, unarchived accounts into risk views", () => {
    expect(ids(selectRiskEligibleAccounts(all))).toEqual(["live"]);
    expect(isRiskEligible(acct("a", "active", T))).toBe(false);
    expect(isHistorical(acct("a", "failed"))).toBe(true);
    expect(isHistorical(acct("a", "paused"))).toBe(false);
  });

  it("requires an explicit outcome, balance and rulebook decision for a reset", () => {
    const ok = {
      predecessorAccountId: "a", priorOutcome: "failed", effectiveAt: "2026-10-20T15:00:00-04:00", source: "user_entered",
      name: "Attempt 2", startingBalance: "50000", rulebook: { kind: "decideLater" },
    };
    expect(resetInputSchema.safeParse(ok).success).toBe(true);
    for (const missing of ["priorOutcome", "startingBalance", "rulebook", "effectiveAt"]) {
      const { [missing]: _drop, ...rest } = ok as Record<string, unknown>;
      expect(resetInputSchema.safeParse(rest).success, missing).toBe(false);
    }
    expect(resetInputSchema.safeParse({ ...ok, priorOutcome: "active" }).success).toBe(false);
    expect(resetInputSchema.safeParse({ ...ok, startingBalance: "-5" }).success).toBe(false);
  });

  it("validates a status change", () => {
    expect(statusChangeInputSchema.safeParse({ status: "failed", cause: null }).success).toBe(true);
    expect(statusChangeInputSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("assessImportTarget", () => {
  const link = (effectiveAt: string) => ({
    predecessorAccountId: "a", successorAccountId: "b", priorOutcome: "failed" as const, effectiveAt,
    reason: null, source: "user_entered" as const, rulebookDecision: "deferred" as const, createdAt: T,
  });
  const attempt = (accountId: string, n: number, resetToNext: AttemptSummary["resetToNext"]): AttemptSummary => ({
    accountId, attemptNumber: n, name: accountId, status: "active", archivedAt: null, externalRef: null,
    startingBalance: "50000", createdAt: T, resetToNext, tradeCount: 0, firstTradingDay: null, lastTradingDay: null,
    importCount: 0, netPnl: null, tradesWithUnknownPnl: 0,
  });
  const attempts = [attempt("a", 1, link("2026-10-20T19:00:00.000Z")), attempt("b", 2, null)];

  it("blocks archived accounts", () => {
    expect(assessImportTarget(acct("a", "failed", T), [], ["2026-10-01"]).blocked).toMatch(/archived/);
  });

  it("asks for confirmation on a non-active account and for trades after the reset", () => {
    const r = assessImportTarget(acct("a", "failed"), attempts, ["2026-10-18", "2026-10-22"]);
    expect(r.blocked).toBeNull();
    expect(r.confirmations).toHaveLength(2);
    expect(r.confirmations[1]).toMatch(/reset on 2026-10-20/);
  });

  it("asks for confirmation on trades before the new attempt began", () => {
    const r = assessImportTarget(acct("b", "active"), attempts, ["2026-10-15"]);
    expect(r.confirmations).toEqual([expect.stringMatching(/started on 2026-10-20/)]);
  });

  it("says nothing when the file fits the attempt", () => {
    expect(assessImportTarget(acct("b", "active"), attempts, ["2026-10-21"])).toEqual({ blocked: null, confirmations: [] });
  });
});
