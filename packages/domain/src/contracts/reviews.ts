// Build 20 DTOs: trade corrections and detail, per-trade reviews, the review
// library (strategies, tags, checklists) and screenshots. Field names and
// shapes match the serde structs in apps/desktop/src-tauri/src/store
// (trades.rs, reviews.rs, library.rs, attachments.rs). Rust validates every
// write again and computes every stored or derived value (P&L, planned risk
// from entry and stop, R-multiple); these schemas only give early feedback.

import { z } from "zod";

import { decimal, optionalText } from "./fields.js";
import { tradeSchema } from "./trades.js";

/* ---------- Trade corrections and detail ---------- */

export const tradeChangeOptionsSchema = z.strictObject({
  /** The trade's updatedAt as last read; a later change is a conflict, never an overwrite. */
  expectedUpdatedAt: z.string().nullish(),
  reason: optionalText(2000),
});
export type TradeChangeOptions = z.input<typeof tradeChangeOptionsSchema>;

export const correctionKinds = ["edit", "delete", "restore", "import_restore"] as const;
export const tradeCorrectionSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  kind: z.enum(correctionKinds),
  correctedAt: z.string(),
  /** "local_user" or "csv_import": local and unauthenticated. */
  actor: z.string(),
  reason: z.string().nullable(),
  /** Trade DTO field names whose stored value changed. */
  changedFields: z.array(z.string()),
  /** The stored values before and after (money as decimal text). */
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type TradeCorrection = z.infer<typeof tradeCorrectionSchema>;

export const importSourceSchema = z.object({
  batchId: z.string(),
  fileName: z.string(),
  fileSha256: z.string(),
  sourceFormat: z.enum(["performance", "generic"]),
  sourceTimezone: z.string(),
  importedAt: z.string(),
  rowNumber: z.number().int().nullable(),
  lineNumber: z.number().int().nullable(),
  headers: z.array(z.string()),
  /** The original cells exactly as read from the file, in header order. */
  rawCells: z.array(z.string()).nullable(),
});
export type ImportSource = z.infer<typeof importSourceSchema>;

export const tradeDetailSchema = z.object({
  trade: tradeSchema,
  importSource: importSourceSchema.nullable(),
  corrections: z.array(tradeCorrectionSchema),
  /** Neighbours among the account's active trades in entry order (oldest first). */
  previousTradeId: z.string().nullable(),
  nextTradeId: z.string().nullable(),
  position: z.number().int().positive(),
  total: z.number().int().positive(),
});
export type TradeDetail = z.infer<typeof tradeDetailSchema>;

export const deletedTradeSchema = z.object({ trade: tradeSchema, deletedAt: z.string() });
export type DeletedTrade = z.infer<typeof deletedTradeSchema>;

/* ---------- Library ---------- */

export const tagKinds = ["setup", "mistake", "emotion", "general"] as const;
export type TagKind = (typeof tagKinds)[number];

export const strategySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  archived: z.boolean(),
  reviewCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Strategy = z.infer<typeof strategySchema>;
export const strategyInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Required").max(80),
  description: optionalText(20_000),
});
export type StrategyInput = z.input<typeof strategyInputSchema>;

export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(tagKinds),
  archived: z.boolean(),
  reviewCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Tag = z.infer<typeof tagSchema>;
export const tagInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Required").max(40),
  kind: z.enum(tagKinds),
});
export type TagInput = z.input<typeof tagInputSchema>;

export const checklistScopes = ["trade", "daily"] as const;
export const checklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
});
export const checklistSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** trade: reviewed per trade (Build 20); daily: reviewed with the day (Build 22). */
  scope: z.enum(checklistScopes),
  strategyId: z.string().nullable(),
  archived: z.boolean(),
  /** Active items in order, then archived ones. */
  items: z.array(checklistItemSchema),
  reviewCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Checklist = z.infer<typeof checklistSchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export const checklistInputSchema = z
  .strictObject({
    name: z.string().trim().min(1, "Required").max(80),
    description: optionalText(20_000),
    scope: z.enum(checklistScopes),
    strategyId: z.string().min(1).nullish(),
    /** Active items in order. Existing items left out are archived, never deleted. */
    items: z.array(z.strictObject({ id: z.string().min(1).nullish(), label: z.string().trim().min(1, "Required").max(200) })).max(50),
  })
  .refine((c) => c.scope === "trade" || !c.strategyId, { path: ["strategyId"], message: "Only a trade checklist belongs to a strategy" });
export type ChecklistInput = z.input<typeof checklistInputSchema>;

export const librarySchema = z.object({
  strategies: z.array(strategySchema),
  tags: z.array(tagSchema),
  checklists: z.array(checklistSchema),
});
export type Library = z.infer<typeof librarySchema>;

export const archiveInputSchema = z.strictObject({
  entity: z.enum(["strategy", "tag", "checklist"]),
  id: z.string().min(1),
  archived: z.boolean(),
});
export type ArchiveInput = z.input<typeof archiveInputSchema>;

/* ---------- Reviews ---------- */

/** A library entry as the review recorded it, beside what it is called now. */
export const labelRefSchema = z.object({
  id: z.string().nullable(),
  label: z.string(),
  currentLabel: z.string().nullable(),
  archived: z.boolean(),
});
export type LabelRef = z.infer<typeof labelRefSchema>;

export const reviewTagSchema = z.object({
  tagId: z.string(),
  label: z.string(),
  kind: z.enum(tagKinds),
  currentLabel: z.string().nullable(),
  archived: z.boolean(),
});
export type ReviewTag = z.infer<typeof reviewTagSchema>;

export const checklistResults = ["followed", "missed", "not_applicable"] as const;
export type ChecklistResult = (typeof checklistResults)[number];
export const checklistAnswerSchema = z.object({
  itemId: z.string(),
  /** The item's label when it was answered. */
  label: z.string(),
  result: z.enum(checklistResults),
  note: z.string().nullable(),
  currentLabel: z.string().nullable(),
  archived: z.boolean(),
});
export type ChecklistAnswer = z.infer<typeof checklistAnswerSchema>;

/** Process (checklist adherence), reported apart from outcome (P&L). */
export const adherenceSchema = z.object({
  followed: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
});
export type Adherence = z.infer<typeof adherenceSchema>;

export const attachmentFileStatuses = ["ok", "missing", "changed", "unknown"] as const;
export const attachmentMetaSchema = z.object({
  id: z.string(),
  /** Display name only; never a path. */
  fileName: z.string().nullable(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: z.string(),
  caption: z.string().nullable(),
  createdAt: z.string(),
  fileStatus: z.enum(attachmentFileStatuses),
});
export type AttachmentMeta = z.infer<typeof attachmentMetaSchema>;

export const tradeReviewSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  accountId: z.string(),
  revision: z.number().int().positive(),
  reviewedAt: z.string().nullable(),
  strategy: labelRefSchema.nullable(),
  checklist: labelRefSchema.nullable(),
  /** Planned before the trade. null is unknown, never zero. */
  plannedEntryPrice: z.string().nullable(),
  plannedStopPrice: z.string().nullable(),
  plannedTargetPrice: z.string().nullable(),
  /** 1R in the account currency, as entered or derived by Rust from planned entry and stop. */
  plannedRisk: z.string().nullable(),
  plannedRiskSource: z.enum(["entered", "derived"]).nullable(),
  /** Net P&L ÷ planned risk to 2 dp, computed in Rust; null unless both are known. */
  rMultiple: z.string().nullable(),
  executionRating: z.number().int().min(1).max(5).nullable(),
  thesis: z.string().nullable(),
  reflection: z.string().nullable(),
  tags: z.array(reviewTagSchema),
  checklistResults: z.array(checklistAnswerSchema),
  adherence: adherenceSchema,
  attachments: z.array(attachmentMetaSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TradeReview = z.infer<typeof tradeReviewSchema>;

const optionalDecimal = z.union([decimal, z.literal("")]).nullish();
export const reviewInputSchema = z.strictObject({
  accountId: z.string().min(1),
  tradeId: z.string().min(1),
  /** The revision the form started from; null when there was no review. */
  expectedRevision: z.number().int().positive().nullable(),
  strategyId: z.string().min(1).nullish(),
  checklistId: z.string().min(1).nullish(),
  plannedEntryPrice: optionalDecimal,
  plannedStopPrice: optionalDecimal,
  plannedTargetPrice: optionalDecimal,
  plannedRisk: z.union([decimal.refine((v) => Number(v) > 0, "Must be greater than zero (leave it empty when unknown)"), z.literal("")]).nullish(),
  executionRating: z.number().int().min(1).max(5).nullish(),
  thesis: optionalText(20_000),
  reflection: optionalText(20_000),
  reviewed: z.boolean(),
  tagIds: z.array(z.string().min(1)).max(30),
  checklistResults: z.array(z.strictObject({ itemId: z.string().min(1), result: z.enum(checklistResults), note: optionalText(2000) })),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

export const reviewSummarySchema = z.object({
  tradeId: z.string(),
  reviewed: z.boolean(),
  strategyId: z.string().nullable(),
  strategyName: z.string().nullable(),
  tags: z.array(reviewTagSchema),
  executionRating: z.number().int().nullable(),
  adherence: adherenceSchema,
  screenshotCount: z.number().int().nonnegative(),
  /** Thesis and reflection, for search. */
  notes: z.string(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

/* ---------- Screenshots ---------- */

export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
export const SCREENSHOTS_PER_TRADE = 20;
export const screenshotInputSchema = z.strictObject({
  accountId: z.string().min(1),
  tradeId: z.string().min(1),
  fileName: z.string().max(1024).nullish(),
  /** The file's bytes, base64. Rust checks the type from the bytes, not the name. */
  dataBase64: z.string().min(1).max(Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4 + 4, "Screenshots can be at most 10 MB"),
});
export type ScreenshotInput = z.input<typeof screenshotInputSchema>;

export const screenshotDataSchema = z.object({
  attachmentId: z.string(),
  /** ok: verified bytes in dataBase64; missing: no file; corrupt: the file no longer matches its record. */
  status: z.enum(["ok", "missing", "corrupt"]),
  mimeType: z.string(),
  dataBase64: z.string().nullable(),
});
export type ScreenshotData = z.infer<typeof screenshotDataSchema>;
