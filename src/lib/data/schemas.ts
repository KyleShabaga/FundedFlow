// Runtime schemas for the Rust command payloads (src-tauri/src/store, csv_import).
// Field names and shapes must match the serde structs there.
//
// Money, prices and quantities are decimal strings ("50000", "5004.25") so
// nothing passes through floating point. Instants are ISO 8601 strings; the
// backend returns them as UTC with milliseconds ("2026-10-19T14:30:00.000Z").

import { z } from "zod";

const decimal = z.string().trim().regex(/^[+-]?(\d+\.?\d*|\.\d+)$/, "Enter a number");
const positiveDecimal = decimal.refine((v) => Number(v) > 0, "Must be greater than zero");
const nonNegativeDecimal = decimal.refine((v) => !v.startsWith("-") || Number(v) === 0, "Must be zero or positive");
const instant = z.iso.datetime({ offset: true, message: "Enter a date and time" });
const optionalText = (max: number) => z.string().max(max).nullish();

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const fieldIssueSchema = z.object({ field: z.string(), message: z.string() });
export type FieldIssue = z.infer<typeof fieldIssueSchema>;

export const appErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("validation"), message: z.string(), issues: z.array(fieldIssueSchema) }),
  z.object({ kind: z.literal("notFound"), message: z.string() }),
  z.object({ kind: z.literal("conflict"), message: z.string() }),
  z.object({ kind: z.literal("database"), message: z.string() }),
]);
export type AppError = z.infer<typeof appErrorSchema>;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accountTypes = ["evaluation", "sim_funded", "live_funded", "personal", "demo", "other"] as const;
export const accountStatuses = ["active", "paused", "passed", "failed", "closed"] as const;

export const accountInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Required").max(100),
  broker: optionalText(100),
  propFirm: optionalText(100),
  externalRef: optionalText(100),
  accountType: z.enum(accountTypes),
  status: z.enum(accountStatuses),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter code such as USD"),
  startingBalance: nonNegativeDecimal,
  /** IANA zone, e.g. America/New_York. Checked against the tz database in Rust. */
  timezone: z.string().trim().min(1),
  /** HH:MM in `timezone`; 00:00 for plain calendar days. */
  tradingDayResetTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  notes: optionalText(20_000),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  broker: z.string().nullable(),
  propFirm: z.string().nullable(),
  externalRef: z.string().nullable(),
  accountType: z.enum(accountTypes),
  status: z.enum(accountStatuses),
  currency: z.string(),
  startingBalance: z.string(),
  timezone: z.string(),
  tradingDayResetTime: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Account = z.infer<typeof accountSchema>;

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Trade = z.infer<typeof tradeSchema>;

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export const journalEntryInputSchema = z.strictObject({
  accountId: z.string().min(1),
  /** Optional trade of the same account. */
  tradeId: z.string().min(1).nullish(),
  entryAt: instant,
  title: z.string().trim().min(1, "Required").max(200),
  body: z.string().max(100_000),
  tags: z.array(z.string().trim().max(40, "Tags are at most 40 characters")).max(20),
});
export type JournalEntryInput = z.input<typeof journalEntryInputSchema>;

export const journalEntrySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  tradeId: z.string().nullable(),
  entryAt: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/** CSV header name per trade field (case-insensitive). */
export const columnMappingSchema = z.strictObject({
  symbol: z.string().min(1),
  side: z.string().min(1),
  quantity: z.string().min(1),
  entryTime: z.string().min(1),
  entryPrice: z.string().min(1),
  exitTime: z.string().nullish(),
  exitPrice: z.string().nullish(),
  fees: z.string().nullish(),
  realizedPnl: z.string().nullish(),
  brokerTradeId: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ColumnMapping = z.input<typeof columnMappingSchema>;

export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export const csvImportRequestSchema = z.strictObject({
  accountId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  content: z.string().max(MAX_CSV_BYTES, "File is larger than 10 MB"),
  columns: columnMappingSchema,
  /** IANA zone for timestamps in the file that have no offset. */
  timezone: z.string().trim().min(1),
});
export type CsvImportRequest = z.input<typeof csvImportRequestSchema>;

export const tradePreviewSchema = z.object({
  symbol: z.string(),
  side: z.enum(tradeSides),
  quantity: z.string(),
  entryAt: z.string(),
  entryPrice: z.string(),
  exitAt: z.string().nullable(),
  exitPrice: z.string().nullable(),
  fees: z.string(),
  tradingDay: z.string(),
  realizedPnl: z.string().nullable(),
  pnlStatus: z.enum(pnlStatuses),
});

export const rowReportSchema = z.object({
  rowNumber: z.number().int(),
  lineNumber: z.number().int(),
  status: z.enum(["new", "duplicate", "skipped", "invalid"]),
  issues: z.array(fieldIssueSchema),
  raw: z.array(z.string()),
  trade: tradePreviewSchema.nullable(),
});
export type RowReport = z.infer<typeof rowReportSchema>;

export const csvPreviewSchema = z.object({
  headers: z.array(z.string()),
  /** Problems with the file or mapping; when non-empty nothing can be imported. */
  fileIssues: z.array(fieldIssueSchema),
  filePreviouslyImported: z.boolean(),
  rowCount: z.number().int(),
  newCount: z.number().int(),
  duplicateCount: z.number().int(),
  /** Duplicates plus blank rows. */
  skippedCount: z.number().int(),
  invalidCount: z.number().int(),
  /** Every row that would not be imported, plus a sample of new rows. */
  rows: z.array(rowReportSchema),
});
export type CsvPreview = z.infer<typeof csvPreviewSchema>;

export const importBatchSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  fileName: z.string(),
  fileSha256: z.string(),
  fileSize: z.number().int(),
  status: z.enum(["committed", "failed"]),
  rowCount: z.number().int(),
  importedCount: z.number().int(),
  /** Duplicates plus blank rows. */
  skippedCount: z.number().int(),
  duplicateCount: z.number().int(),
  failedCount: z.number().int(),
  errorSummary: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string(),
});
export type ImportBatch = z.infer<typeof importBatchSchema>;

export const importRowRecordSchema = z.object({
  rowNumber: z.number().int(),
  lineNumber: z.number().int(),
  status: z.enum(["imported", "duplicate", "skipped", "invalid"]),
  issues: z.array(fieldIssueSchema),
  raw: z.array(z.string()),
  duplicateOfTradeId: z.string().nullable(),
});
export type ImportRowRecord = z.infer<typeof importRowRecordSchema>;
