import { describe, expect, it } from "vitest";
import { csvImportRequestSchema, MAX_CSV_BYTES, utf8ByteLength } from "@fundedflow/domain";
import { initialWizardState, readCsvFile, wizardReducer, type WizardAction } from "./wizard-state";

describe("reviewed destination acknowledgement", () => {
  const file = { name: "trades.csv", content: "synthetic", size: 9, version: 1 };
  it.each<WizardAction>([
    { type: "account", accountId: "other" },
    { type: "file", file: { ...file, version: 2 } },
    { type: "clear-file" },
    { type: "timezone", timezone: "Asia/Tokyo" },
    { type: "format", format: "generic" },
    { type: "date-format", dateFormat: "mdy" },
    { type: "columns", columns: { symbol: "Ticker", side: "Side", quantity: "Qty", entryTime: "Time", entryPrice: "Price" } },
  ])("clears confirmation for a $type change", action => {
    const state = { ...initialWizardState("attempt", "UTC"), file, confirmedTargetFor: "reviewed-preview-token" };
    expect(wizardReducer(state, action).confirmedTargetFor).toBeNull();
  });
  it("keeps a deliberate confirmation during a refresh of unchanged account timezone", () => {
    const state = { ...initialWizardState("attempt", "UTC"), file, confirmedTargetFor: "reviewed-preview-token" };
    expect(wizardReducer(state, { type: "timezone", timezone: "UTC" }).confirmedTargetFor).toBe("reviewed-preview-token");
  });
});

describe("readCsvFile measures the text it submits (P0-04)", () => {
  const MAX = MAX_CSV_BYTES;
  const csv = (...parts: (string | Uint8Array)[]) => new File(parts as BlobPart[], "t.csv", { type: "text/csv" });
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const submit = (content: string) => csvImportRequestSchema.safeParse({ accountId: "a", fileName: "t.csv", content, timezone: "UTC" }).success;

  // [case, file, submitted UTF-8 bytes when accepted, or the size reported when refused]
  it.each<[string, () => File, number, boolean]>([
    ["ASCII at the cap", () => csv("a".repeat(MAX)), MAX, true],
    ["a BOM file whose text is at the cap (file is 3 bytes larger)", () => csv(bom, "a".repeat(MAX)), MAX, true],
    ["two-byte characters at the cap", () => csv("é".repeat(MAX / 2)), MAX, true],
    ["supplementary characters at the cap", () => csv("😀".repeat(MAX / 4)), MAX, true],
    ["ASCII one byte over", () => csv("a".repeat(MAX + 1)), MAX + 1, false],
    ["a BOM file whose text is one byte over (refused unread at MAX + 4)", () => csv(bom, "a".repeat(MAX + 1)), MAX + 4, false],
    ["two-byte characters one byte over", () => csv("é".repeat(MAX / 2), "a"), MAX + 1, false],
    ["supplementary characters one byte over", () => csv("😀".repeat(MAX / 4), "a"), MAX + 1, false],
  ])("%s", async (_, make, bytes, accepted) => {
    const file = make();
    const read = await readCsvFile(file, 1);
    if (!accepted) {
      expect(read).toEqual({ kind: "too-large", name: "t.csv", size: bytes });
      return;
    }
    if (!("content" in read)) throw new Error(`refused: ${read.kind}`);
    expect(read.content.startsWith("﻿")).toBe(false);
    expect(utf8ByteLength(read.content)).toBe(bytes);
    expect(read.size).toBe(file.size);
    expect(submit(read.content)).toBe(true);
  });

  it("refuses a file far over the cap before reading it", async () => {
    const file = csv("a".repeat(MAX + 4));
    expect(await readCsvFile(file, 1)).toEqual({ kind: "too-large", name: "t.csv", size: MAX + 4 });
  });

  it.each<[string, Uint8Array]>([
    ["UTF-16LE with a BOM", new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00])],
    ["UTF-16BE with a BOM", new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x2c])],
    ["Latin-1 é", new Uint8Array([0x61, 0x2c, 0xe9, 0x0a])],
    ["a truncated UTF-8 sequence", new Uint8Array([0x61, 0x2c, 0xe2, 0x82])],
  ])("refuses %s as unreadable instead of guessing", async (_, bytes) => {
    expect(await readCsvFile(csv(bytes), 1)).toEqual({ kind: "unreadable", name: "t.csv" });
  });
});
