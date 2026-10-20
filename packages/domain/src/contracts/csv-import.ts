// CSV import DTOs for the Rust command payloads in apps/desktop/src-tauri/src.
// Field names and shapes must match the serde structs there; see fields.ts.

import { z } from "zod";

import { fieldIssueSchema } from "./errors.js";
import { pnlStatuses, tradeSides } from "./trades.js";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;

export const csvFormats = ["auto", "performance", "generic"] as const;
export const dateFormats = ["auto", "ymd", "mdy", "dmy"] as const;

/** CSV header name per generic trade field (case, spaces and punctuation are ignored). */
export const columnMappingSchema = z.strictObject({
  symbol: z.string(),
  side: z.string(),
  quantity: z.string(),
  entryTime: z.string(),
  entryPrice: z.string(),
  exitTime: z.string().nullish(),
  exitPrice: z.string().nullish(),
  fees: z.string().nullish(),
  realizedPnl: z.string().nullish(),
  brokerTradeId: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ColumnMapping = z.input<typeof columnMappingSchema>;

export const csvImportRequestSchema = z.strictObject({
  accountId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  content: z.string().max(MAX_CSV_BYTES, "File is larger than 10 MB"),
  /** IANA zone for timestamps in the file that have no offset. */
  timezone: z.string().trim().min(1),
  format: z.enum(csvFormats).optional(),
  /** How slash dates are read; "auto" refuses to guess when M/D and D/M both fit. */
  dateFormat: z.enum(dateFormats).optional(),
  /** Explicit generic mapping; omit to match headers by name. */
  columns: columnMappingSchema.nullish(),
});
export type CsvImportRequest = z.input<typeof csvImportRequestSchema>;

export const tradePreviewSchema = z.object({
  symbol: z.string(),
  side: z.enum(tradeSides),
  /** Paired-fill rows: which fill opened the trade. */
  entryBasis: z.enum(["buy_first", "sell_first", "same_time"]).nullable(),
  quantity: z.string(),
  entryAt: z.string(),
  entryPrice: z.string(),
  exitAt: z.string().nullable(),
  exitPrice: z.string().nullable(),
  fees: z.string(),
  tradingDay: z.string(),
  realizedPnl: z.string().nullable(),
  reportedPnl: z.string().nullable(),
  pnlStatus: z.enum(pnlStatuses),
  buyFillId: z.string().nullable(),
  sellFillId: z.string().nullable(),
  boughtAtSource: z.string().nullable(),
  soldAtSource: z.string().nullable(),
  duration: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  brokerTradeId: z.string().nullable(),
});
export type TradePreview = z.infer<typeof tradePreviewSchema>;

export const duplicateSchema = z.object({
  /** "file": an earlier line of this file; "saved": a trade already in the account. */
  of: z.enum(["file", "saved"]),
  key: z.string(),
  reason: z.string(),
  lineNumber: z.number().int().nullable(),
  tradeId: z.string().nullable(),
});

/** A deleted trade of the account that a "new" row brings back instead of inserting a second trade. */
export const restoreSchema = z.object({
  key: z.string(),
  tradeId: z.string(),
  reason: z.string(),
});

export const rowReportSchema = z.object({
  rowNumber: z.number().int(),
  /** Line in the file (the header is line 1). */
  lineNumber: z.number().int(),
  status: z.enum(["new", "duplicate", "blank", "invalid"]),
  errors: z.array(fieldIssueSchema),
  warnings: z.array(fieldIssueSchema),
  duplicate: duplicateSchema.nullable(),
  restores: restoreSchema.nullable(),
  raw: z.array(z.string()),
  trade: tradePreviewSchema.nullable(),
});
export type RowReport = z.infer<typeof rowReportSchema>;

export const csvPreviewSchema = z.object({
  format: z.enum(["performance", "generic"]),
  formatReason: z.string(),
  dateFormat: z.enum(["ymd", "mdy", "dmy"]).nullable(),
  dateFormatReason: z.string(),
  headers: z.array(z.string()),
  mapping: z.array(z.object({ field: z.string(), header: z.string().nullable(), required: z.boolean() })),
  ignoredHeaders: z.array(z.string()),
  /** Problems with the file, mapping or settings; when non-empty nothing can be imported. */
  fileIssues: z.array(fieldIssueSchema),
  fileWarnings: z.array(fieldIssueSchema),
  filePreviouslyImported: z.boolean(),
  rowCount: z.number().int(),
  newCount: z.number().int(),
  /** New rows that restore a deleted trade (included in newCount). */
  restoreCount: z.number().int(),
  duplicateCount: z.number().int(),
  blankCount: z.number().int(),
  invalidCount: z.number().int(),
  /** Rows (any status) with at least one warning. */
  warningCount: z.number().int(),
  rows: z.array(rowReportSchema),
  /** Plain new rows beyond the preview limit that are not listed. */
  rowsOmitted: z.number().int(),
  limits: z.object({ maxBytes: z.number().int(), maxRows: z.number().int() }),
});
export type CsvPreview = z.infer<typeof csvPreviewSchema>;

export const importBatchSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  fileName: z.string(),
  fileSha256: z.string(),
  fileSize: z.number().int(),
  sourceFormat: z.enum(["performance", "generic"]),
  status: z.enum(["committed", "failed"]),
  rowCount: z.number().int(),
  importedCount: z.number().int(),
  /** Duplicates plus blank rows. */
  skippedCount: z.number().int(),
  duplicateCount: z.number().int(),
  /** Invalid rows. */
  failedCount: z.number().int(),
  warningCount: z.number().int(),
  errorSummary: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string(),
});
export type ImportBatch = z.infer<typeof importBatchSchema>;

export const importRowRecordSchema = z.object({
  rowNumber: z.number().int(),
  lineNumber: z.number().int(),
  status: z.enum(["imported", "duplicate", "skipped", "invalid"]),
  errors: z.array(fieldIssueSchema),
  warnings: z.array(fieldIssueSchema),
  raw: z.array(z.string()),
  duplicateOfTradeId: z.string().nullable(),
});
export type ImportRowRecord = z.infer<typeof importRowRecordSchema>;
