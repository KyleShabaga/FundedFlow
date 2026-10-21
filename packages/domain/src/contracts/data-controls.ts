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
]);
export const dataControlErrorSchema = z.object({
  code: dataControlCodeSchema,
  message: z.string(),
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
