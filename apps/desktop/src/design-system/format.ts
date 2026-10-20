// Display formatting for money, percentages and dates in the design system.
//
// Money arrives as canonical decimal text from the Rust commands ("208.38",
// "-36", or null for unknown). Formatting and summing go through bigint
// micro-units from @fundedflow/domain, never `number`, so a displayed total
// is exact. These helpers only format and add for display; stored values are
// still computed by Rust (docs/data-model.md, "Rust is authoritative").

import { MICROS_PER_UNIT, microsToDecimal, toMicros } from "@fundedflow/domain";

/** U+2212, used instead of a hyphen so a negative amount reads as a sign. */
export const MINUS = "−";
/** Shown for unknown values (null), which are never shown as zero. */
export const UNKNOWN = "—";

export type Sign = "profit" | "loss" | "flat";

export interface MoneyOptions {
  /** Fraction digits shown; rounds half away from zero. Default 2. */
  dp?: number;
  /** "+" on positive amounts. Default true. Negatives always get a minus. */
  signed?: boolean;
  /** Prefix for the amount. Default "$". */
  symbol?: string;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rounds micro-units to `dp` fraction digits, half away from zero. */
function roundMicros(micros: bigint, dp: number): { negative: boolean; whole: bigint; frac: bigint } {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const step = 10n ** BigInt(6 - dp);
  let units = abs / step;
  if ((abs % step) * 2n >= step) units += 1n;
  const scale = 10n ** BigInt(dp);
  return { negative: negative && units !== 0n, whole: units / scale, frac: units % scale };
}

/** Which colour a money value takes. Unknown (null or unparseable) is flat. */
export function moneySign(value: string | null | undefined): Sign {
  const micros = value == null ? null : toMicros(value);
  if (micros == null || micros === 0n) return "flat";
  return micros > 0n ? "profit" : "loss";
}

/**
 * "+$1,792.68", "−$275.73", "$0.00", or "—" for null. Never parses through
 * `number`.
 */
export function formatMoney(value: string | null | undefined, options: MoneyOptions = {}): string {
  const { dp = 2, signed = true, symbol = "$" } = options;
  if (dp < 0 || dp > 6 || !Number.isInteger(dp)) throw new RangeError("dp must be an integer from 0 to 6");
  const micros = value == null ? null : toMicros(value);
  if (micros == null) return UNKNOWN;
  const { negative, whole, frac } = roundMicros(micros, dp);
  const isZero = whole === 0n && frac === 0n;
  const sign = negative ? MINUS : signed && !isZero ? "+" : "";
  const fraction = dp > 0 ? "." + frac.toString().padStart(dp, "0") : "";
  return `${sign}${symbol}${groupThousands(whole.toString())}${fraction}`;
}

/** "+$14.3K", "−$2.1M", "+$812": for calendar cells and chart axes only. */
export function formatMoneyCompact(value: string | null | undefined, symbol = "$"): string {
  const micros = value == null ? null : toMicros(value);
  if (micros == null) return UNKNOWN;
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const sign = negative ? MINUS : abs === 0n ? "" : "+";
  const M = 1_000_000n * MICROS_PER_UNIT;
  const K = 1_000n * MICROS_PER_UNIT;
  // One decimal of the unit, half away from zero; 999,950 and up reads as 1.0M.
  const tenthsOf = (unit: bigint) => (abs * 10n + unit / 2n) / unit;
  const tier = abs >= 999_950n * MICROS_PER_UNIT ? ([M, "M"] as const) : abs >= 10_000n * MICROS_PER_UNIT ? ([K, "K"] as const) : null;
  if (tier) {
    const tenths = tenthsOf(tier[0]);
    return `${sign}${symbol}${groupThousands((tenths / 10n).toString())}.${(tenths % 10n).toString()}${tier[1]}`;
  }
  const { whole } = roundMicros(abs, 0);
  return `${abs === 0n ? "" : sign}${symbol}${groupThousands(whole.toString())}`;
}

/** Adds decimal texts exactly. Null if any part is unknown (unknown is never zero). */
export function sumMoney(values: readonly (string | null)[]): string | null {
  let total = 0n;
  for (const v of values) {
    const micros = v == null ? null : toMicros(v);
    if (micros == null) return null;
    total += micros;
  }
  return microsToDecimal(total);
}

/** "+7.62%", "−1.08%", "0.00%". Takes a plain number: ratios are display-only. */
export function formatPercent(value: number | null | undefined, dp = 2): string {
  if (value == null || !Number.isFinite(value)) return UNKNOWN;
  const rounded = Number(Math.abs(value).toFixed(dp));
  const sign = rounded === 0 ? "" : value > 0 ? "+" : MINUS;
  return `${sign}${rounded.toFixed(dp)}%`;
}

/**
 * A money value as a float, for drawing only (chart coordinates, bar
 * widths). Never feed the result back into money arithmetic or storage.
 */
export function moneyToNumberForDisplay(value: string | null | undefined): number | null {
  const micros = value == null ? null : toMicros(value);
  return micros == null ? null : Number(micros) / 1_000_000;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon Oct 19" from a trading day ("2026-10-19"). Calendar arithmetic only, no time zone. */
export function formatTradingDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}

// Wall-clock times in an account's IANA time zone. `<input type="datetime-local">`
// gives "YYYY-MM-DDTHH:MM" with no zone; these read and write it in the account's
// zone, not the computer's, and convert to and from UTC instants.

function wallParts(instant: number, timeZone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [get("year"), get("month"), get("day"), get("hour"), get("minute"), get("second")];
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "2026-10-20T20:05": the wall-clock minute of `instant` (ISO text or ms) in `timeZone`. */
export function zonedWallTime(instant: string | number, timeZone: string): string {
  const [y, m, d, h, min] = wallParts(typeof instant === "number" ? instant : Date.parse(instant), timeZone);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}`;
}

/** "2026-10-20": the calendar day of an ISO instant in `timeZone`, or "—" when it is not a valid instant. */
export function zonedDay(instant: string, timeZone: string): string {
  const ms = Date.parse(instant);
  return Number.isNaN(ms) ? UNKNOWN : zonedWallTime(ms, timeZone).slice(0, 10);
}

/**
 * The UTC instant ("…Z") of a "YYYY-MM-DDTHH:MM" wall time in `timeZone`, or "" when the input is empty or
 * malformed. A time skipped by a daylight-saving jump resolves to the instant after the gap.
 */
export function zonedWallTimeToInstant(local: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return "";
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const [py, pm, pd, ph, pmin, ps] = wallParts(t, timeZone);
    return Date.UTC(py, pm - 1, pd, ph, pmin, ps) - t;
  };
  // The second pass corrects the offset across a daylight-saving change. If the result still does not
  // show the requested wall time, that time was skipped, and the later reading is the one after the gap.
  const first = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(first);
  const instant = zonedWallTime(second, timeZone) === local ? second : Math.max(first, second);
  return new Date(instant).toISOString();
}
