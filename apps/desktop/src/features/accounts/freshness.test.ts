// P0-D06: the freshness evaluator at its boundaries, with fixed instants. Trading-day starts are what Rust returns
// (store/freshness.rs tests pin them); here they are fixtures for a 17:00 America/New_York reset.
import { describe, expect, it } from "vitest";

import type { AccountFreshnessInputs } from "../../lib/data/freshness";
import { formatInstant } from "../../design-system";
import { evaluateFreshness, freshnessLine, policyText, PRESETS, resolvePolicy, type FreshnessRules } from "./freshness";

const NOW = Date.parse("2026-10-21T18:00:00.000Z"); // Wednesday 14:00 EDT: trading day 2026-10-21
const STARTS = [
  "2026-10-20T21:00:00.000Z", // Wed 10-21 began Tue 17:00 EDT
  "2026-10-19T21:00:00.000Z", // Tue 10-20
  "2026-10-16T21:00:00.000Z", // Mon 10-19 began Fri 17:00
  "2026-10-15T21:00:00.000Z",
];
const inputs = (over: Partial<AccountFreshnessInputs> = {}): AccountFreshnessInputs => ({
  accountId: "a", currentTradingDay: "2026-10-21", tradingDayStarts: STARTS, nextTradingDayStart: "2026-10-21T21:00:00.000Z",
  lastCommittedImportAt: null, lastFailedImportAt: null, lastManualTradeAt: null, lastConfirmedCheckpointAt: null, ...over,
});
const active = { status: "active" as const };
const at = (ms: number) => new Date(ms).toISOString();
const custom = (rules: FreshnessRules) => rules;

describe("default policy: records updated since the previous trading day began", () => {
  const rules = PRESETS.default;
  it("is fresh from the previous trading day's start, and changes when the next trading day begins", () => {
    const f = evaluateFreshness(active, inputs({ lastCommittedImportAt: STARTS[1] }), rules, NOW);
    expect(f.status).toBe("fresh");
    expect(f.nextChangeAt).toBe("2026-10-21T21:00:00.000Z");
  });
  it("needs attention one millisecond before that start", () => {
    const f = evaluateFreshness(active, inputs({ lastCommittedImportAt: at(Date.parse(STARTS[1]) - 1) }), rules, NOW);
    expect(f.status).toBe("attention");
    expect(f.reasons).toEqual([{ kind: "records-stale" }]);
    expect(f.nextChangeAt).toBeNull();
  });
  it("counts a manually entered trade as a record update, whichever is newer", () => {
    const f = evaluateFreshness(active, inputs({ lastCommittedImportAt: "2026-10-10T12:00:00.000Z", lastManualTradeAt: "2026-10-21T13:00:00.000Z" }), rules, NOW);
    expect(f.status).toBe("fresh");
    expect(f.lastUpdateAt).toBe("2026-10-21T13:00:00.000Z");
  });
  it("covers a weekend: Friday evening data is still fresh on Monday", () => {
    const monday = Date.parse("2026-10-19T14:00:00.000Z");
    const mondayStarts = ["2026-10-16T21:00:00.000Z", "2026-10-15T21:00:00.000Z"];
    const f = evaluateFreshness(active, inputs({ tradingDayStarts: mondayStarts, lastCommittedImportAt: "2026-10-15T22:00:00.000Z" }), rules, monday);
    expect(f.status).toBe("fresh");
  });
  it("never uses the boundary it doesn't have", () => {
    const f = evaluateFreshness(active, inputs({ tradingDayStarts: [STARTS[0], STARTS[1]], lastCommittedImportAt: STARTS[0] }), custom({ records: { unit: "trading_days", count: 3 }, checkpoint: { required: false } }), NOW);
    expect(f.status).toBe("unknown");
  });
});

describe("day thresholds are elapsed time", () => {
  const rules = PRESETS.three_days;
  const updated = Date.parse("2026-10-18T18:00:00.000Z");
  it("is fresh until exactly 72 hours, then needs attention", () => {
    const row = inputs({ lastCommittedImportAt: at(updated) });
    expect(evaluateFreshness(active, row, rules, updated + 72 * 3_600_000 - 1).status).toBe("fresh");
    expect(evaluateFreshness(active, row, rules, updated + 72 * 3_600_000 - 1).nextChangeAt).toBe(at(updated + 72 * 3_600_000));
    expect(evaluateFreshness(active, row, rules, updated + 72 * 3_600_000).status).toBe("attention");
  });
});

describe("failed imports and checkpoints", () => {
  it("needs attention when the newest import attempt failed after the last update, not before", () => {
    const after = evaluateFreshness(active, inputs({ lastCommittedImportAt: STARTS[0], lastFailedImportAt: "2026-10-21T15:00:00.000Z" }), PRESETS.default, NOW);
    expect(after.status).toBe("attention");
    expect(after.reasons).toEqual([{ kind: "import-failed", at: "2026-10-21T15:00:00.000Z" }]);
    const before = evaluateFreshness(active, inputs({ lastCommittedImportAt: "2026-10-21T16:00:00.000Z", lastFailedImportAt: "2026-10-21T15:00:00.000Z" }), PRESETS.default, NOW);
    expect(before.status).toBe("fresh");
  });
  it("treats a checkpoint as optional unless the policy requires it", () => {
    expect(evaluateFreshness(active, inputs({ lastCommittedImportAt: STARTS[0] }), PRESETS.default, NOW).status).toBe("fresh");
    const required = evaluateFreshness(active, inputs({ lastCommittedImportAt: "2026-10-21T12:00:00.000Z" }), PRESETS.with_checkpoint, NOW);
    expect(required.status).toBe("attention");
    expect(required.reasons).toEqual([{ kind: "no-checkpoint" }]);
  });
  it("does not let new records hide a stale required checkpoint", () => {
    const checkpoint = Date.parse("2026-10-14T18:00:00.000Z"); // exactly 7 days before NOW
    const row = inputs({ lastCommittedImportAt: "2026-10-21T17:00:00.000Z", lastConfirmedCheckpointAt: at(checkpoint) });
    expect(evaluateFreshness(active, row, PRESETS.with_checkpoint, NOW).reasons).toEqual([{ kind: "checkpoint-stale", at: at(checkpoint) }]);
    const fresh = evaluateFreshness(active, row, PRESETS.with_checkpoint, NOW - 1);
    expect(fresh.status).toBe("fresh");
    // The earliest threshold wins: the checkpoint expires (NOW) before the records do.
    expect(fresh.nextChangeAt).toBe(at(NOW));
  });
  it("lists every reason that applies", () => {
    const f = evaluateFreshness(active, inputs({ lastCommittedImportAt: "2026-10-01T12:00:00.000Z", lastFailedImportAt: "2026-10-02T12:00:00.000Z" }), PRESETS.with_checkpoint, NOW);
    expect(f.reasons.map(r => r.kind)).toEqual(["import-failed", "records-stale", "no-checkpoint"]);
  });
});

describe("unknown is never fresh", () => {
  it("has no records yet", () => {
    expect(evaluateFreshness(active, inputs(), PRESETS.default, NOW)).toMatchObject({ status: "unknown", reasons: [{ kind: "no-records" }] });
    // A checkpoint alone is not a record update.
    expect(evaluateFreshness(active, inputs({ lastConfirmedCheckpointAt: STARTS[0] }), PRESETS.default, NOW).status).toBe("unknown");
  });
  it("couldn't read the inputs", () => {
    expect(evaluateFreshness(active, undefined, PRESETS.default, NOW)).toMatchObject({ status: "unknown", reasons: [{ kind: "unavailable" }] });
  });
  it("is a finished attempt, however old or new its data", () => {
    for (const status of ["passed", "failed", "closed"] as const) {
      expect(evaluateFreshness({ status }, inputs({ lastCommittedImportAt: "2026-01-01T00:00:00.000Z" }), PRESETS.default, NOW)).toMatchObject({ status: "unknown", reasons: [{ kind: "finished" }] });
      expect(evaluateFreshness({ status }, inputs({ lastCommittedImportAt: STARTS[0] }), PRESETS.default, NOW).status).toBe("unknown");
    }
  });
  it("judges a paused attempt by the live policy", () => {
    expect(evaluateFreshness({ status: "paused" }, inputs({ lastCommittedImportAt: STARTS[0] }), PRESETS.default, NOW).status).toBe("fresh");
    expect(evaluateFreshness({ status: "paused" }, inputs({ lastCommittedImportAt: "2026-10-01T00:00:00.000Z" }), PRESETS.default, NOW).status).toBe("attention");
  });
});

describe("explanations", () => {
  it("says the reason, with times in whichever zone is displayed, without changing the result", () => {
    const row = inputs({ lastCommittedImportAt: "2026-10-21T16:58:00.000Z" });
    const f = evaluateFreshness(active, row, PRESETS.default, NOW);
    const london = freshnessLine(f, i => formatInstant(i, { timeZone: "Europe/London", zoneName: "offset" }));
    const tokyo = freshnessLine(f, i => formatInstant(i, { timeZone: "Asia/Tokyo", zoneName: "offset" }));
    expect(london).toBe("Fresh · updated Oct 21, 17:58 GMT+1");
    expect(tokyo).toBe("Fresh · updated Oct 22, 01:58 GMT+9");
    expect(evaluateFreshness(active, row, PRESETS.default, NOW)).toEqual(f);
  });
  it("describes each preset", () => {
    expect(policyText(PRESETS.default)).toBe("records updated since the previous trading day began");
    expect(policyText(PRESETS.three_days)).toBe("records updated in the last 3 days");
    expect(policyText(PRESETS.with_checkpoint)).toBe("records updated in the last 3 days, and a firm checkpoint you confirmed in the last 7 days");
  });
});

describe("stored policy", () => {
  it("defaults when nothing is saved and falls back visibly when the saved value can't be used", () => {
    expect(resolvePolicy(null)).toEqual({ mode: "default", rules: PRESETS.default, fallback: false });
    expect(resolvePolicy({ mode: "three_days" })).toMatchObject({ mode: "three_days", rules: PRESETS.three_days, fallback: false });
    expect(resolvePolicy({ mode: "custom", rules: { records: { unit: "days", count: 0 }, checkpoint: { required: false } } })).toMatchObject({ mode: "default", fallback: true });
    expect(resolvePolicy({ mode: "custom", rules: { records: { unit: "trading_days", count: 2.5 }, checkpoint: { required: false } } })).toMatchObject({ fallback: true });
    expect(resolvePolicy({ mode: "always_green" })).toMatchObject({ mode: "default", fallback: true });
    const rules: FreshnessRules = { records: { unit: "trading_days", count: 2 }, checkpoint: { required: true, maxDays: 14 } };
    expect(resolvePolicy({ mode: "custom", rules })).toEqual({ mode: "custom", rules, fallback: false });
  });
});
