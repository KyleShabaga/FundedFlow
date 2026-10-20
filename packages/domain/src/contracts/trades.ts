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
      durationSeconds: z.number().int().nullable(),
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
