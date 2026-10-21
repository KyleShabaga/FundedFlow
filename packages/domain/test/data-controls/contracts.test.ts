import { describe, it, expect } from "vitest";
import wire from "../fixtures/data-controls-wire.json" with { type: "json" };
import {
  archiveRestorePreviewSchema,
  archiveRestoreResultSchema,
  dataExportResultSchema,
  permanentDeletionPreviewSchema,
  permanentDeletionResultSchema,
  dataControlErrorSchema,
  archiveRestoreRequestSchema,
  permanentDeletionRequestSchema,
} from "../../src/index.js";

describe("Rust-native data-control wire outputs", () => {
  const parsers = {
    export_journal_archive: dataExportResultSchema,
    export_trade_csv: dataExportResultSchema,
    inspect_journal_archive: archiveRestorePreviewSchema,
    restore_journal_archive: archiveRestoreResultSchema,
    preview_permanent_deletion: permanentDeletionPreviewSchema,
    permanently_delete_data: permanentDeletionResultSchema,
    error: dataControlErrorSchema,
  };
  for (const row of wire)
    it(row.command, () => {
      if (row.command === "retry_data_cleanup") {
        expect(row.output).toBeNull();
        return;
      }
      const parser = parsers[row.command as keyof typeof parsers];
      expect(parser.parse(row.output)).toEqual(row.output);
    });
  it("requires explicit replacement and distinct deletion scope", () => {
    expect(
      archiveRestoreRequestSchema.safeParse({
        source: "backup.zip",
        previewToken: "token",
        confirmation: "merge",
      }).success,
    ).toBe(false);
    expect(
      permanentDeletionRequestSchema.safeParse({
        scope: { kind: "account" },
        previewToken: "token",
        confirmation: "yes",
      }).success,
    ).toBe(false);
    expect(
      permanentDeletionRequestSchema.safeParse({
        scope: { kind: "journal", accountId: "wrong" },
        previewToken: "token",
        confirmation: "yes",
      }).success,
    ).toBe(false);
  });
});
