// Exact decimal text and integer micro-units, matching the Rust authority in
// apps/desktop/src-tauri/src/domain.rs (parse_decimal, canonical, to_micros,
// micros_to_string). Parity is pinned by test/fixtures/money.json.
//
// Money is stored as signed 64-bit integer micro-units (1e-6 of the currency
// unit) and travels as decimal text. Nothing here goes through `number`.

/** Micro-units per currency unit. */
export const MICROS_PER_UNIT = 1_000_000n;
/** Smallest micro-unit amount Rust and SQLite can hold (i64::MIN). */
export const MICROS_MIN = -(2n ** 63n);
/** Largest micro-unit amount Rust and SQLite can hold (i64::MAX). */
export const MICROS_MAX = 2n ** 63n - 1n;

const MICRO_SCALE = 6;
// rust_decimal limits: a 96-bit unsigned mantissa and at most 28 fractional digits.
const MAX_MANTISSA = 2n ** 96n - 1n;
const MAX_SCALE = 28;

const PLAIN_DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;
// Rust's str::trim strips Unicode White_Space (but not a byte-order mark).
const OUTER_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;
const WIRE_MICROS = /^-?(0|[1-9]\d*)$/;

/** sign × unscaled / 10^scale, normalized: no trailing fractional zeros, zero is unsigned. */
interface ExactDecimal {
  negative: boolean;
  unscaled: bigint;
  scale: number;
}

function normalize(negative: boolean, unscaled: bigint, scale: number): ExactDecimal {
  while (scale > 0 && unscaled % 10n === 0n) {
    unscaled /= 10n;
    scale -= 1;
  }
  return unscaled === 0n ? { negative: false, unscaled, scale: 0 } : { negative, unscaled, scale };
}

/**
 * Strict decimal parse with the grammar Rust accepts: optional sign, digits
 * with at most one point (`5.`, `.5` allowed), surrounding whitespace ignored.
 * No exponents, separators or currency symbols.
 *
 * Returns null for values rust_decimal cannot hold exactly. (Rust rounds
 * input beyond 28 fractional digits while parsing; this rejects it instead.)
 */
function parseExact(input: string): ExactDecimal | null {
  const match = PLAIN_DECIMAL.exec(input.replace(OUTER_WHITESPACE, ""));
  if (!match) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  const d = normalize(sign === "-", BigInt(whole + fraction || "0"), fraction.length);
  return d.scale <= MAX_SCALE && d.unscaled <= MAX_MANTISSA ? d : null;
}

function format({ negative, unscaled, scale }: ExactDecimal): string {
  let digits = unscaled.toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, "0");
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

/** True for a bigint inside the i64 micro-unit range. */
export function isMicros(value: bigint): boolean {
  return value >= MICROS_MIN && value <= MICROS_MAX;
}

/**
 * Canonical decimal text (`"5004.50"` → `"5004.5"`, `"-0"` → `"0"`,
 * `".5"` → `"0.5"`), or null when the input is not a plain exact decimal.
 * This is the form the Rust commands send for prices, quantities and money.
 */
export function canonicalDecimal(input: string): string | null {
  const d = parseExact(input);
  return d && format(d);
}

/**
 * Decimal text to integer micro-units, rounding a midpoint away from zero
 * (`"0.0000005"` → `1n`, `"-0.0000025"` → `-3n`). Null when the text is not a
 * plain exact decimal or the result is outside the i64 range.
 */
export function toMicros(input: string): bigint | null {
  const d = parseExact(input);
  if (!d) return null;
  let micros: bigint;
  if (d.scale <= MICRO_SCALE) {
    micros = d.unscaled * 10n ** BigInt(MICRO_SCALE - d.scale);
  } else {
    const divisor = 10n ** BigInt(d.scale - MICRO_SCALE);
    micros = d.unscaled / divisor;
    if ((d.unscaled % divisor) * 2n >= divisor) micros += 1n;
  }
  if (d.negative) micros = -micros;
  return isMicros(micros) ? micros : null;
}

/** Micro-units to canonical decimal text (`-1250000n` → `"-1.25"`). Throws RangeError outside i64. */
export function microsToDecimal(micros: bigint): string {
  if (!isMicros(micros)) throw new RangeError(`${micros} is outside the i64 micro-unit range`);
  return format(normalize(micros < 0n, micros < 0n ? -micros : micros, MICRO_SCALE));
}

/**
 * Micro-units as JSON-safe base-10 integer text (`bigint` cannot go through
 * JSON.stringify). For new wire fields only; existing Tauri payloads carry
 * decimal text from {@link microsToDecimal}. Throws RangeError outside i64.
 */
export function microsToWire(micros: bigint): string {
  if (!isMicros(micros)) throw new RangeError(`${micros} is outside the i64 micro-unit range`);
  return micros.toString();
}

/** Strict inverse of {@link microsToWire}: canonical integer text inside i64, else null. */
export function microsFromWire(text: string): bigint | null {
  if (!WIRE_MICROS.test(text) || text === "-0") return null;
  const micros = BigInt(text);
  return isMicros(micros) ? micros : null;
}
