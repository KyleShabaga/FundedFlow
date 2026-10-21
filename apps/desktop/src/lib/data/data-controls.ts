import {
  permanentDeletionPreviewRequestSchema,
  permanentDeletionPreviewSchema,
  permanentDeletionRequestSchema,
  permanentDeletionResultSchema,
  type PermanentDeletionPreviewRequest,
  type PermanentDeletionRequest,
} from "@fundedflow/domain";
import {
  archiveInspectRequestSchema,
  archiveRestorePreviewSchema,
  archiveRestoreRequestSchema,
  archiveRestoreResultSchema,
  type ArchiveInspectRequest,
  type ArchiveRestoreRequest,
} from "@fundedflow/domain";
/** Non-visual native data-control adapter. Build 25 owns user interaction. */
import { z } from "zod";
import {
  archiveExportRequestSchema,
  csvExportRequestSchema,
  dataExportResultSchema,
  dataControlErrorSchema,
  type ArchiveExportRequest,
  type CsvExportRequest,
  type DataControlError,
} from "@fundedflow/domain";
export class DataControlFailure extends Error {
  constructor(readonly error: DataControlError) {
    super(error.message);
    this.name = "DataControlFailure";
  }
}
type Invoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
export function createDataControls(invoke: Invoke) {
  async function call<S extends z.ZodType>(
    command: string,
    request: unknown,
    output: S,
  ): Promise<z.output<S>> {
    let raw: unknown;
    try {
      raw = await invoke(command, request === undefined ? {} : { request });
    } catch (error) {
      const parsed = dataControlErrorSchema.safeParse(error);
      throw new DataControlFailure(
        parsed.success
          ? parsed.data
          : { code: "io", message: "The local operation failed." },
      );
    }
    return output.parse(raw);
  }
  return {
    previewDeletion: (request: PermanentDeletionPreviewRequest) =>
      call(
        "preview_permanent_deletion",
        permanentDeletionPreviewRequestSchema.parse(request),
        permanentDeletionPreviewSchema,
      ),
    deletePermanently: (request: PermanentDeletionRequest) =>
      call(
        "permanently_delete_data",
        permanentDeletionRequestSchema.parse(request),
        permanentDeletionResultSchema,
      ),
    retryCleanup: () =>
      call("retry_data_cleanup", undefined, z.null()).then(() => undefined),
    inspectArchive: (request: ArchiveInspectRequest) =>
      call(
        "inspect_journal_archive",
        archiveInspectRequestSchema.parse(request),
        archiveRestorePreviewSchema,
      ),
    restoreArchive: (request: ArchiveRestoreRequest) =>
      call(
        "restore_journal_archive",
        archiveRestoreRequestSchema.parse(request),
        archiveRestoreResultSchema,
      ),
    exportArchive: (request: ArchiveExportRequest) =>
      call(
        "export_journal_archive",
        archiveExportRequestSchema.parse(request),
        dataExportResultSchema,
      ),
    exportCsv: (request: CsvExportRequest) =>
      call(
        "export_trade_csv",
        csvExportRequestSchema.parse(request),
        dataExportResultSchema,
      ),
  };
}
