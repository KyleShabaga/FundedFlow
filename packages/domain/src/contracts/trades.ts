// Trade DTOs for the Rust command payloads in apps/desktop/src-tauri/src.
// Field names and shapes must match the serde structs there; see fields.ts.

import { z } from "zod";

import { decimal, instant, nonNegativeDecimal, optionalText, positiveDecimal } from "./fields.js";

export const tradeSides = ["long", "short"] as const;
/**
 * calculated: (exit − entry) × qty × instrument point value (negated for shorts)
 * reported: the broker-reported P&L, used when it cannot be calculated
 * open: no exit yet; missing_instrument / currency_mismatch: no P&L available
 */
export const pnlStatuses = ["calculated", "reported", "open", "missing_instrument", "currency_mismatch"] as const;

const I64_MAX = 9223372036854775807n;
/**
 * A paired-fill export's duration in whole seconds, 0 to signed i64 maximum (native storage). One canonical form per
 * value: an integer JSON number up to Number.MAX_SAFE_INTEGER, and above that a decimal string of digits without a
 * leading zero, because a JSON number there would be rounded before it could be validated (P0-04). Every value that
 * fits a safe integer is sent exactly as before.
 */
export const durationSecondsSchema = z.union([
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.string().refine(s => {
    if (!/^[1-9][0-9]*$/.test(s)) return false;
    const n = BigInt(s);
    return n > BigInt(Number.MAX_SAFE_INTEGER) && n <= I64_MAX;
  }, "is not a whole number of seconds above 2^53 - 1 within signed 64-bit range"),
]);
export type DurationSeconds = z.infer<typeof durationSecondsSchema>;
/** The exact number of seconds. */
export const durationSecondsValue = (wire: DurationSeconds): bigint => BigInt(wire);

export const tradeInputSchema = z
  .strictObject({
    accountId: z.string().min(1),
    symbol: z.string().trim().min(1, "Required").max(32),
    side: z.enum(tradeSides),
    quantity: positiveDecimal,
    entryAt: instant,
    entryPrice: decimal,
    exitAt: instant.nullish(),
    exitPrice: decimal.nullish(),
    /** Total commissions and fees, a positive cost. */
    fees: nonNegativeDecimal.nullish(),
    /** Broker-reported P&L before fees; only used when it cannot be calculated. */
    realizedPnl: decimal.nullish(),
    notes: optionalText(20_000),
  })
  .refine((t) => !t.exitAt === !t.exitPrice, {
    path: ["exitPrice"],
    message: "Exit time and exit price go together",
  })
  .refine((t) => !t.exitAt || Date.parse(t.exitAt) >= Date.parse(t.entryAt), {
    path: ["exitAt"],
    message: "Must not be before the entry time",
  });
export type TradeInput = z.input<typeof tradeInputSchema>;

export const tradeSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  source: z.enum(["manual", "csv_import"]),
  importBatchId: z.string().nullable(),
  brokerTradeId: z.string().nullable(),
  symbol: z.string(),
  side: z.enum(tradeSides),
  quantity: z.string(),
  entryAt: z.string(),
  entryPrice: z.string(),
  exitAt: z.string().nullable(),
  exitPrice: z.string().nullable(),
  fees: z.string(),
  /** YYYY-MM-DD in the account's timezone and reset time. */
  tradingDay: z.string(),
  reportedPnl: z.string().nullable(),
  grossPnl: z.string().nullable(),
  /** Net realized P&L (gross − fees) in the account currency. */
  realizedPnl: z.string().nullable(),
  pnlStatus: z.enum(pnlStatuses),
  notes: z.string().nullable(),
  /** Source values when imported from a paired-fill performance export, exactly as supplied. */
  roundTrip: z
    .object({
      buyFillId: z.string().nullable(),
      sellFillId: z.string().nullable(),
      buyPrice: z.string(),
      sellPrice: z.string(),
      boughtAt: z.string(),
      soldAt: z.string(),
      boughtAtSource: z.string(),
      soldAtSource: z.string(),
      durationSource: z.string().nullable(),
      durationSeconds: durationSecondsSchema.nullable(),
      priceFormat: z.string().nullable(),
      priceFormatType: z.string().nullable(),
      tickSize: z.string().nullable(),
      /** buy_first = long; sell_first = short (sell filled before buy); same_time = taken as long. */
      entryBasis: z.enum(["buy_first", "sell_first", "same_time"]),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Trade = z.infer<typeof tradeSchema>;
