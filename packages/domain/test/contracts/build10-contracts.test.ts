import { describe, expect, it } from "vitest";

import {
  accountLinkInputSchema,
  ledgerEntryInputSchema,
  phaseEventInputSchema,
  settingKey,
  snapshotInputSchema,
} from "../../src/index.js";

const entry = { accountId: "a", kind: "payout", amount: "-100", effectiveAt: "2026-10-19T21:30:00Z" };
const issuePaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join(".")) ?? [];

describe("ledger entry input", () => {
  it("accepts the kinds' normal shapes", () => {
    expect(ledgerEntryInputSchema.safeParse(entry).success).toBe(true);
    expect(ledgerEntryInputSchema.safeParse({ ...entry, kind: "evaluation_fee", amount: "-165" }).success).toBe(true);
    expect(ledgerEntryInputSchema.safeParse({ ...entry, kind: "balance_correction", amount: "250" }).success).toBe(true);
    expect(ledgerEntryInputSchema.safeParse({ ...entry, kind: "other", amount: "5", affectsBalance: false }).success).toBe(true);
  });

  it("rejects what Rust rejects", () => {
    expect(issuePaths(ledgerEntryInputSchema.safeParse({ ...entry, amount: "100" }))).toEqual(["amount"]);
    expect(issuePaths(ledgerEntryInputSchema.safeParse({ ...entry, kind: "reset_fee", amount: "50" }))).toEqual(["amount"]);
    expect(issuePaths(ledgerEntryInputSchema.safeParse({ ...entry, amount: "0" }))).toEqual(["amount"]);
    expect(issuePaths(ledgerEntryInputSchema.safeParse({ ...entry, kind: "other", amount: "5" }))).toEqual(["affectsBalance"]);
    expect(ledgerEntryInputSchema.safeParse({ ...entry, kind: "tip" }).success).toBe(false);
  });
});

describe("settings keys", () => {
  it("are lower-case dotted names", () => {
    for (const ok of ["ui.theme", "import_defaults.tz", "a"]) expect(settingKey.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["", "UI.theme", "1a", "has space", "a".repeat(65)]) expect(settingKey.safeParse(bad).success, bad).toBe(false);
  });
});

describe("snapshot input", () => {
  const snap = {
    accountId: "a", tradingDay: "2026-10-19", isEndOfDay: true, dataSource: "manual", engineVersion: "1", inputsHash: "h",
    feesIncluded: true, unrealizedIncluded: false, balance: "50000", realizedDayPnl: "0", drawdownLocked: false,
    tradingDaysCompleted: 0, status: "safe", statusReasons: [], explanation: { steps: ["x"] },
  };
  it("takes unknown figures as absent, never zero", () => {
    const r = snapshotInputSchema.safeParse(snap);
    expect(r.success).toBe(true);
    expect(r.success && r.data.dailyLossLimit).toBeUndefined();
  });
  it("needs an explanation, and a reason for an unknown status", () => {
    expect(issuePaths(snapshotInputSchema.safeParse({ ...snap, explanation: {} }))).toEqual(["explanation"]);
    expect(issuePaths(snapshotInputSchema.safeParse({ ...snap, status: "unknown" }))).toEqual(["statusReasons"]);
    expect(snapshotInputSchema.safeParse({ ...snap, status: "unknown", statusReasons: ["no rulebook"] }).success).toBe(true);
    expect(snapshotInputSchema.safeParse({ ...snap, tradingDay: "19/10/2026" }).success).toBe(false);
  });
});

describe("catalogue operation inputs", () => {
  it("keeps system-made phase sources out of user entries", () => {
    const e = { accountId: "a", toPhase: "evaluation", source: "user_entered" };
    expect(phaseEventInputSchema.safeParse(e).success).toBe(true);
    expect(phaseEventInputSchema.safeParse({ ...e, source: "system" }).success).toBe(false);
    expect(phaseEventInputSchema.safeParse({ ...e, source: "catalogue_derived" }).success).toBe(false);
  });
  it("needs a size source for a link", () => {
    expect(accountLinkInputSchema.safeParse({ accountId: "a", sizeSource: "user_entered" }).success).toBe(true);
    expect(accountLinkInputSchema.safeParse({ accountId: "a" }).success).toBe(false);
  });
});
