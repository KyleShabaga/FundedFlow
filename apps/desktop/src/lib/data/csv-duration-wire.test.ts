// P0-04 durationSeconds on real native payloads (src-tauri csv_import wire_limit_tests): the JSON text as Rust wrote
// it is parsed the way the IPC bridge parses it, and every value arrives exactly. Expectations are written here
// independently of the fixture.
import { durationSecondsSchema, durationSecondsValue, tradePreviewSchema, tradeSchema } from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import { holdTime } from "../../features/journal/components/journal-model";
import { makeAccount } from "../../features/accounts/test-store";
import { trade } from "../../features/journal/test-store";
import { toTradeViewModel } from "../../features/trades/view-models/trade";
import raw from "../../test/fixtures/csv-duration-wire.json?raw";

type Fixture = {
  rows: { durationCell: string; previewStatus: string; committedStatus: string; previewDurationSeconds: unknown }[];
  storedTrades: { durationSource: string; durationSeconds: unknown }[];
};
const fixture = JSON.parse(raw) as Fixture;

// [cell, exact seconds or null for a row error]
const EXPECTED: [string, bigint | null][] = [
  ["0sec", 0n],
  ["32sec", 32n],
  ["9007199254740991sec", 9007199254740991n],
  ["9007199254740992sec", 9007199254740992n],
  ["9007199254740993sec", 9007199254740993n],
  ["2562047788015215:30:07", 9223372036854775807n],
  ["9223372036854775807sec", 9223372036854775807n],
  ["9223372036854775808sec", null],
  ["18446744073709551616sec", null],
  ["-5sec", null],
  ["1.5sec", null],
];

describe("durationSeconds from native preview and commit", () => {
  it("no JSON number in the native text is outside the safe-integer range", () => {
    for (const m of raw.matchAll(/:\s*(-?\d+)\s*[,\n}]/g)) expect(Number.isSafeInteger(Number(m[1])), m[1]).toBe(true);
  });

  it.each(EXPECTED)("%s", (cell, exact) => {
    const row = fixture.rows.find(r => r.durationCell === cell)!;
    if (exact === null) {
      expect([row.previewStatus, row.committedStatus, row.previewDurationSeconds]).toEqual(["invalid", "invalid", null]);
      return;
    }
    expect([row.previewStatus, row.committedStatus]).toEqual(["new", "imported"]);
    expect(durationSecondsValue(durationSecondsSchema.parse(row.previewDurationSeconds))).toBe(exact);
    const stored = fixture.storedTrades.find(t => t.durationSource === cell)!;
    expect(stored.durationSeconds).toEqual(row.previewDurationSeconds);
    expect(durationSecondsValue(durationSecondsSchema.parse(stored.durationSeconds))).toBe(exact);
  });

  it("the preview and trade schemas carry the exact wire value", () => {
    expect(tradePreviewSchema.shape.durationSeconds.parse("9007199254740993")).toBe("9007199254740993");
    expect(tradeSchema.shape.roundTrip.unwrap().shape.durationSeconds.parse("9223372036854775807")).toBe("9223372036854775807");
    expect(tradePreviewSchema.shape.durationSeconds.safeParse(9007199254740992).success).toBe(false);
  });
});

describe("hold time from an exported duration", () => {
  const account = makeAccount({ id: "a", name: "A" });
  const withDuration = (durationSeconds: number | string) => {
    const t = trade({ id: "p", accountId: "a" });
    return toTradeViewModel({ ...t, roundTrip: {
      buyFillId: "1", sellFillId: "2", buyPrice: "1", sellPrice: "1", boughtAt: t.entryAt, soldAt: t.exitAt!, boughtAtSource: "s",
      soldAtSource: "s", durationSource: "x", durationSeconds, priceFormat: null, priceFormatType: null, tickSize: null, entryBasis: "buy_first" } }, account);
  };
  it.each<[number | string, string]>([
    [0, "0s"],
    [77, "1m 17s"],
    [7500, "2h 05m"],
    [9007199254740991, "104249991374d 7h"],
    ["9007199254740993", "104249991374d 7h"],
    ["9223372036854775807", "106751991167300d 15h"],
  ])("%s seconds shows %s", (seconds, text) => {
    expect(holdTime(withDuration(seconds))).toBe(text);
  });
});
