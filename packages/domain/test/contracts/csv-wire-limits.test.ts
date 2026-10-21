// P0-04 wire contracts shared with Rust (apps/desktop/src-tauri/src/csv_import/wire_limit_tests.rs):
// the inclusive UTF-8 byte cap on submitted CSV text, and exact durationSeconds across JSON.
import { describe, expect, it } from "vitest";

import { csvImportRequestSchema, durationSecondsSchema, durationSecondsValue, MAX_CSV_BYTES, utf8ByteLength } from "../../src/index.js";
import vectors from "../../../../test_csvimport/limits/byte-limit-v1.json" with { type: "json" };

const request = (content: string) => ({ accountId: "acct", fileName: "t.csv", content, timezone: "UTC" });
const build = (parts: { text: string; repeat: number }[]) => parts.map(p => p.text.repeat(p.repeat)).join("");

describe("CSV byte limit: shared vectors", () => {
  it("uses the native limit", () => {
    expect(vectors.maxBytes).toBe(MAX_CSV_BYTES);
  });

  it.each(vectors.cases)("$name", c => {
    const content = build(c.parts);
    expect(content.length).toBe(c.utf16Units);
    expect(utf8ByteLength(content)).toBe(c.utf8Bytes);
    const result = csvImportRequestSchema.safeParse(request(content));
    expect(result.success).toBe(c.accepted);
    if (!result.success) {
      expect(result.error.issues).toEqual([expect.objectContaining({ path: ["content"], message: "The file is larger than 10 MB." })]);
    }
  });
});

describe("CSV text that can't be sent as UTF-8", () => {
  it.each([["lone high surrogate", "a,b\n\uD800"], ["lone low surrogate", "\uDC00a,b\n"], ["reversed pair", "\uDE00\uD83D"]])(
    "%s is refused before it reaches native code", (_, content) => {
      expect(utf8ByteLength(content)).toBeNull();
      const result = csvImportRequestSchema.safeParse(request(content));
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/not valid UTF-8/);
    });

  it("a well-formed surrogate pair is four bytes", () => {
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const I64_MAX = 9223372036854775807n;

describe("durationSeconds wire representation", () => {
  it.each<[string, unknown, bigint]>([
    ["zero", 0, 0n],
    ["one minute", 60, 60n],
    ["largest safe integer as a number", MAX_SAFE, 9007199254740991n],
    ["first unsafe integer as a decimal string", "9007199254740992", 9007199254740992n],
    ["next integer as a decimal string", "9007199254740993", 9007199254740993n],
    ["signed i64 maximum as a decimal string", "9223372036854775807", I64_MAX],
  ])("accepts %s exactly", (_, wire, exact) => {
    const parsed = durationSecondsSchema.parse(wire);
    expect(parsed).toBe(wire);
    expect(durationSecondsValue(parsed)).toBe(exact);
  });

  it.each<[string, unknown]>([
    ["a number above the safe range (already rounded by JSON.parse)", 2 ** 53],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["a safe value written as a string (non-canonical)", "60"],
    ["the largest safe integer as a string (non-canonical)", "9007199254740991"],
    ["a leading zero", "09007199254740993"],
    ["a sign", "+9007199254740993"],
    ["a negative string", "-9007199254740993"],
    ["a fractional string", "9007199254740993.0"],
    ["one past signed i64", "9223372036854775808"],
    ["u64 maximum", "18446744073709551615"],
    ["not a number", "1min"],
  ])("rejects %s", (_, wire) => {
    expect(durationSecondsSchema.safeParse(wire).success).toBe(false);
  });

  it("JSON numbers above 2^53 - 1 cannot carry the value, so the wire must not use them", () => {
    // What a plain JSON number would have delivered for 2^53 + 1: the neighbouring even integer.
    const rounded = (JSON.parse('{"d":9007199254740993}') as { d: number }).d;
    expect(BigInt(rounded)).not.toBe(9007199254740993n);
    const exact = (JSON.parse('{"d":"9007199254740993"}') as { d: string }).d;
    expect(durationSecondsValue(durationSecondsSchema.parse(exact))).toBe(9007199254740993n);
  });
});
