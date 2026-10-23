/** Build 24 portable DTOs. Paths appear only in local requests, never archive metadata. */
import { z } from "zod";
export const dataControlCodeSchema = z.enum([
  "invalid_archive",
  "unsupported_version",
  "integrity",
  "unsafe_path",
  "limit_exceeded",
  "missing_attachment",
  "insufficient_space",
  "io",
  "database",
  "confirmation_required",
  "stale_preview",
  "linked_attempts",
  "unsupported_ownership",
  "busy",
  "recovery_required",
  "unrecognized_file",
]);
export const dataControlErrorSchema = z.object({
  code: dataControlCodeSchema,
  message: z.string(),
  /** Which limit was exceeded and the measured value; never a path or row content. */
  detail: z.string().optional(),
});
export type DataControlError = z.infer<typeof dataControlErrorSchema>;
export const dataControlCountsSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);
export const archiveAttachmentSchema = z.strictObject({
  id: z.string(),
  storageKey: z.string(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const archiveManifestSchema = z.strictObject({
  format: z.literal("fundedflow-journal"),
  formatVersion: z.literal(1),
  schemaVersion: z.number().int().min(3),
  producerVersion: z.string(),
  createdAt: z.string(),
  exportId: z.string(),
  protection: z.literal("plaintext"),
  entities: dataControlCountsSchema,
  accountIds: z.array(z.string()),
  financialEncoding: z.string(),
  timeEncoding: z.string(),
  attachments: z.array(archiveAttachmentSchema),
  entries: z.array(
    z.strictObject({
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  maxEntryBytes: z.number().int().positive(),
  maxTotalBytes: z.number().int().positive(),
  maxEntries: z.number().int().positive(),
});
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;
const localPath = z.string().min(1).max(4096);
export const archiveExportRequestSchema = z.strictObject({
  destination: localPath,
  acknowledgePlaintext: z.literal(true),
});
export const csvExportRequestSchema = archiveExportRequestSchema.extend({
  accountId: z.string().nullable(),
});
export const dataExportResultSchema = z.object({
  operationId: z.string(),
  state: z.literal("completed"),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  plaintext: z.literal(true),
});
export type ArchiveExportRequest = z.infer<typeof archiveExportRequestSchema>;
export type CsvExportRequest = z.infer<typeof csvExportRequestSchema>;
export type DataExportResult = z.infer<typeof dataExportResultSchema>;
export const archiveInspectRequestSchema = z.strictObject({
  source: localPath,
});
export const archiveRestorePreviewSchema = z.object({
  state: z.literal("validated"),
  manifest: archiveManifestSchema,
  archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  previewToken: z.string(),
  replacedEntities: dataControlCountsSchema,
  requiredConfirmation: z.literal("REPLACE ENTIRE JOURNAL"),
  requiredFreeBytes: z.number().int().positive(),
  warnings: z.array(z.string()),
});
export const archiveRestoreRequestSchema = z.strictObject({
  source: localPath,
  previewToken: z.string().min(1),
  confirmation: z.literal("REPLACE ENTIRE JOURNAL"),
});
export const archiveRestoreResultSchema = z.object({
  operationId: z.string(),
  state: z.literal("restart_required"),
  safetyBackupId: z.string(),
});
export type ArchiveInspectRequest = z.infer<typeof archiveInspectRequestSchema>;
export type ArchiveRestorePreview = z.infer<typeof archiveRestorePreviewSchema>;
export type ArchiveRestoreRequest = z.infer<typeof archiveRestoreRequestSchema>;
export type ArchiveRestoreResult = z.infer<typeof archiveRestoreResultSchema>;
export const deletionScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("account"), accountId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("journal") }),
]);
export const permanentDeletionPreviewRequestSchema = z.strictObject({
  scope: deletionScopeSchema,
});
export const permanentDeletionPreviewSchema = z.object({
  scope: deletionScopeSchema,
  accountName: z.string().nullable(),
  affectedEntities: dataControlCountsSchema,
  attachments: z.array(archiveAttachmentSchema),
  /** Whole-journal erase: storage keys of leftover files FundedFlow wrote that no record lists. Empty otherwise. */
  extraFiles: z.array(z.string()),
  linkedAccountIds: z.array(z.string()),
  blockers: z.array(z.string()),
  previewToken: z.string(),
  requiredConfirmation: z.string(),
  warnings: z.array(z.string()),
  localRecoveryCopies: z.number().int().nonnegative(),
});
export const permanentDeletionRequestSchema = z.strictObject({
  scope: deletionScopeSchema,
  previewToken: z.string().min(1),
  confirmation: z.string().min(1),
});
export const permanentDeletionResultSchema = z.object({
  operationId: z.string(),
  state: z.enum(["completed", "cleanup_pending"]),
  affectedEntities: dataControlCountsSchema,
});
export type PermanentDeletionPreviewRequest = z.infer<
  typeof permanentDeletionPreviewRequestSchema
>;
export type PermanentDeletionPreview = z.infer<
  typeof permanentDeletionPreviewSchema
>;
export type PermanentDeletionRequest = z.infer<
  typeof permanentDeletionRequestSchema
>;
export type PermanentDeletionResult = z.infer<
  typeof permanentDeletionResultSchema
>;
