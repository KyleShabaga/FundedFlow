import { describe, expect, it } from "vitest";

import {
  MICROS_MAX,
  MICROS_MIN,
  canonicalDecimal,
  microsFromWire,
  microsToDecimal,
  microsToWire,
  toMicros,
} from "../../src/index.js";
import fixture from "../fixtures/money.json" with { type: "json" };

interface DecimalCase {
  input: string;
  canonical: string | null;
  micros: string | null;
  money: string | null;
  tsDivergence?: string;
}

const exact = (fixture.decimal as DecimalCase[]).filter((c) => !c.tsDivergence);
const divergent = (fixture.decimal as DecimalCase[]).filter((c) => c.tsDivergence);

describe("money.json parity with Rust", () => {
  it.each(exact)("canonicalDecimal($input)", (c) => {
    expect(canonicalDecimal(c.input)).toBe(c.canonical);
  });

  it.each(exact)("toMicros($input)", (c) => {
    expect(toMicros(c.input)).toBe(c.micros === null ? null : BigInt(c.micros));
  });

  it.each(exact.filter((c) => c.micros !== null))("microsToDecimal(toMicros($input))", (c) => {
    expect(microsToDecimal(BigInt(c.micros!))).toBe(c.money);
  });

  it.each(fixture.microsToString)("microsToDecimal($micros)", (c) => {
    expect(microsToDecimal(BigInt(c.micros))).toBe(c.money);
  });

  // Documented difference: Rust rounds over-precise input while parsing.
  it.each(divergent)("rejects inexact input $input", (c) => {
    expect(canonicalDecimal(c.input)).toBeNull();
    expect(toMicros(c.input)).toBeNull();
  });
});

describe("micro-unit wire text", () => {
  it("round-trips the i64 range", () => {
    for (const m of [MICROS_MIN, -1n, 0n, 1n, MICROS_MAX]) {
      expect(microsFromWire(microsToWire(m))).toBe(m);
    }
    expect(JSON.stringify({ pnl: microsToWire(-1_250_000n) })).toBe('{"pnl":"-1250000"}');
  });

  it("rejects non-canonical or out-of-range text", () => {
    for (const s of ["", "-0", "01", "+1", "1.0", " 1", "1e3", "9223372036854775808", "-9223372036854775809"]) {
      expect(microsFromWire(s)).toBeNull();
    }
  });

  it("refuses to format amounts outside i64", () => {
    expect(() => microsToWire(MICROS_MAX + 1n)).toThrow(RangeError);
    expect(() => microsToDecimal(MICROS_MIN - 1n)).toThrow(RangeError);
  });
});
