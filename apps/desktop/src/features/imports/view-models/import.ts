import { csvPreviewSchema, importBatchSchema, importRowRecordSchema } from "@fundedflow/domain";
import { z } from "zod";
import { instant, recordId, currency } from "../../shared/contracts";
import { tradeRecordSchema } from "../../trades/view-models/trade";

const previewTrade = csvPreviewSchema.shape.rows.element.shape.trade.unwrap().extend({
  entryAt: instant, exitAt: instant.nullable(),
  entryPrice: tradeRecordSchema.shape.entryPrice, exitPrice: tradeRecordSchema.shape.exitPrice,
  quantity: tradeRecordSchema.shape.quantity, fees: tradeRecordSchema.shape.fees,
  realizedPnl: tradeRecordSchema.shape.realizedPnl, reportedPnl: tradeRecordSchema.shape.reportedPnl,
  tradingDay: tradeRecordSchema.shape.tradingDay,
});
export const previewViewModelSchema = z.object({
  phase: z.literal("preview"), accountId: recordId, fileName: z.string().min(1), currency,
  preview: csvPreviewSchema.extend({ rows: z.array(csvPreviewSchema.shape.rows.element.extend({ trade: previewTrade.nullable() })) }),
});
export const importRecordSchema = importBatchSchema.extend({ id: recordId, accountId: recordId, createdAt: instant, completedAt: instant });
/** Raw errorSummary may contain database diagnostics; expose a safe message instead. */
export const importViewModelSchema = importRecordSchema.omit({ errorSummary: true }).extend({ failureMessage: z.string().nullable() });
export type ImportViewModel = z.infer<typeof importViewModelSchema>;
export function toImportViewModel(input: unknown): ImportViewModel {
  const { errorSummary: _diagnostic, ...record } = importRecordSchema.parse(input);
  return importViewModelSchema.parse({ ...record, failureMessage: record.status === "failed" ? "The import was not completed. Review its problem rows." : null });
}
export const importProblemRowSchema = importRowRecordSchema.extend({ batchId: recordId, rowKey: z.string().min(1) });
