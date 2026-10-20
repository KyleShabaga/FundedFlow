import { accountFilters, filterAccounts, accountInputSchema, deletionPreviewSchema, resetInputSchema, resetResultSchema, statusChangeInputSchema,
  type AccountInput, type AccountFilter, type ResetInput, type StatusChangeInput } from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { recordId } from "../../shared/contracts";
import { validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";
import { historyViewModelSchema, lineageSchema, toAccountViewModel } from "../view-models/account";

export async function readAccounts(filter: AccountFilter = "live", signal?: AbortSignal) {
  validateInput(z.enum(accountFilters), filter);
  return readOperation(() => repository.accounts.list({ includeArchived: true }), values => filterAccounts(values.map(toAccountViewModel), filter), signal);
}
export async function readAccount(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.accounts.get(id), value => { requireAccount(value.id, id); return toAccountViewModel(value); }, signal);
}
export async function readAccountHistory(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.accounts.history(id), value => historyViewModelSchema.parse({ ...value, accountId: id, eventIdentity: "not-exposed-by-backend" }), signal);
}
export async function readAccountLineage(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.accounts.lineage(id), value => lineageSchema.parse(value), signal);
}
export async function readDeletionPreview(id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  return readOperation(() => repository.accounts.previewDeletion(id), value => { const result = deletionPreviewSchema.parse(value); requireAccount(result.accountId, id); return result; }, signal);
}
export async function createAccount(input: AccountInput) {
  const parsed = validateInput(accountInputSchema, input);
  return writeOperation(() => repository.accounts.create(parsed), toAccountViewModel);
}
export async function updateAccount(id: string, input: AccountInput) {
  validateInput(recordId, id);
  const parsed = validateInput(accountInputSchema, input);
  return writeOperation(() => repository.accounts.update(id, parsed), value => { requireAccount(value.id, id); return toAccountViewModel(value); });
}
export async function archiveAccount(id: string) {
  validateInput(recordId, id);
  return writeOperation(() => repository.accounts.archive(id), () => undefined);
}
export async function restoreAccount(id: string) {
  validateInput(recordId, id);
  return writeOperation(() => repository.accounts.restore(id), value => { requireAccount(value.id, id); return toAccountViewModel(value); });
}
export async function changeAccountStatus(id: string, input: StatusChangeInput) {
  validateInput(recordId, id);
  const parsed = validateInput(statusChangeInputSchema, input);
  return writeOperation(() => repository.accounts.changeStatus(id, parsed), value => { requireAccount(value.id, id); return toAccountViewModel(value); });
}
export async function resetAccountAttempt(input: ResetInput) {
  const parsed = validateInput(resetInputSchema, input);
  return writeOperation(() => repository.accounts.resetAttempt(parsed), value => {
    const result = resetResultSchema.parse(value);
    requireAccount(result.predecessor.id, parsed.predecessorAccountId);
    requireAccount(result.link.predecessorAccountId, result.predecessor.id);
    requireAccount(result.link.successorAccountId, result.successor.id);
    if (result.predecessor.id === result.successor.id) throw new Error("A reset must create a new account");
    return { ...result, predecessor: toAccountViewModel(result.predecessor), successor: toAccountViewModel(result.successor) };
  });
}
