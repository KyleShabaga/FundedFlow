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
      raw = await invoke(command, { request });
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
