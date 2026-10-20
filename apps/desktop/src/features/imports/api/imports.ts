import { csvImportRequestSchema, importRowRecordSchema, type CsvImportRequest } from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { readAccount } from "../../accounts/api/accounts";
import { recordId } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";
import { importProblemRowSchema, previewViewModelSchema, toImportViewModel } from "../view-models/import";

export async function readImportHistory(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.imports.list(accountId), values => values.map(value => { requireAccount(value.accountId, accountId); return toImportViewModel(value); }), signal);
}
export async function readImportResult(accountId: string, batchId: string, signal?: AbortSignal) {
  validateInput(recordId, batchId);
  const history = await readImportHistory(accountId, signal);
  const value = history.value.find(batch => batch.id === batchId);
  if (!value) throw new FeatureDataError("not-found");
  return { ...history, value };
}
export async function readImportProblemRows(accountId: string, batchId: string, signal?: AbortSignal) {
  await readImportResult(accountId, batchId, signal); // Native row endpoint carries no account ID: verify the batch's ownership first.
  return readOperation(() => repository.imports.problemRows(batchId), values => z.array(importRowRecordSchema).parse(values).map(row =>
    importProblemRowSchema.parse({ ...row, batchId, rowKey: `${batchId}:${row.rowNumber}` })), signal);
}
export async function previewImport(request: CsvImportRequest, signal?: AbortSignal) {
  const parsed = validateInput(csvImportRequestSchema, request);
  const account = (await readAccount(parsed.accountId, signal)).value;
  return readOperation(() => repository.imports.preview(parsed), preview => previewViewModelSchema.parse({ phase: "preview", accountId: parsed.accountId,
    fileName: parsed.fileName, currency: account.currency, preview }), signal);
}
export async function commitImport(request: CsvImportRequest) {
  const parsed = validateInput(csvImportRequestSchema, request);
  return writeOperation(() => repository.imports.commit(parsed), batch => { requireAccount(batch.accountId, parsed.accountId); return toImportViewModel(batch); });
}
