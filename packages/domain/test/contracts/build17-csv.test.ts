import { describe, expect, it } from "vitest";

import {
  csvImportRequestSchema, csvPreviewSchema, importBatchSchema,
  MAX_CSV_BYTES, MAX_CSV_ROWS, canonicalDecimal, toMicros, microsToDecimal,
} from "../../src/index.js";
import fixture from "../../../../test_csvimport/build17/normalization-v1.json" with { type: "json" };

// Rust generates the baseline; these checks prove DTO/primitive compatibility.
// There is no TypeScript CSV normalizer to compare algorithms against yet.
it("identifies the fixture format and Rust-only behavior baseline explicitly", () => {
  expect(fixture.fixtureVersion).toBe(1);
  expect(fixture.behaviorBaseline).toBe("rust-csv-v1");
});

describe.each(fixture.cases)("CSV Rust baseline: $name", c => {
  it("accepts the request and preserves all preview and batch fields", () => {
    expect(csvImportRequestSchema.parse(c.request)).toEqual(c.request);
    const preview = csvPreviewSchema.parse(c.expected.preview);
    expect(preview).toEqual(c.expected.preview);
    expect(preview.limits).toEqual({ maxBytes: MAX_CSV_BYTES, maxRows: MAX_CSV_ROWS });
    if (c.expected.batch !== null) {
      expect(importBatchSchema.parse(c.expected.batch)).toEqual(c.expected.batch);
      expect(c.expected.commitError).toBeNull();
    } else {
      expect(c.expected.commitError).toBe("validation");
      expect(preview.fileIssues.length).toBeGreaterThan(0);
    }
  });

  it("preserves canonical precision and nullable financial values without re-normalizing CSV", () => {
    for (const row of csvPreviewSchema.parse(c.expected.preview).rows) {
      const trade = row.trade;
      if (!trade) continue;
      for (const decimal of [trade.quantity, trade.entryPrice, trade.exitPrice]) {
        if (decimal !== null) expect(canonicalDecimal(decimal)).toBe(decimal);
      }
      for (const money of [trade.fees, trade.reportedPnl, trade.realizedPnl]) {
        if (money === null) continue;
        const micros = toMicros(money);
        expect(micros).not.toBeNull();
        expect(microsToDecimal(micros!)).toBe(money);
      }
    }
  });
});
