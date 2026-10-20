import { ledgerEntryInputSchema, ledgerEntrySchema, type LedgerEntryInput } from "@fundedflow/domain";
import { repository } from "../../../lib/data/api";
import { instant, moneyText, recordId, tradingDay } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";

export const ledgerViewModelSchema = ledgerEntrySchema.extend({ id: recordId, accountId: recordId, amount: moneyText, effectiveAt: instant, createdAt: instant, updatedAt: instant, tradingDay });
export async function readLedger(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.ledger.list(accountId), entries => entries.map(entry => { requireAccount(entry.accountId, accountId); return ledgerViewModelSchema.parse(entry); }), signal);
}
export async function readLedgerBalance(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.ledger.balanceAdjustment(accountId), value => moneyText.parse(value), signal);
}
export async function saveLedgerEntry(accountId: string, input: LedgerEntryInput, id?: string, assertReady?: () => void) {
  const parsed = validateInput(ledgerEntryInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  if (id && !(await readLedger(accountId)).value.some(entry => entry.id === id)) throw new FeatureDataError("not-found");
  return writeOperation(() => id ? repository.ledger.update(id, parsed) : repository.ledger.create(parsed), value => { requireAccount(value.accountId, accountId); if (id) requireAccount(value.id, id); return ledgerViewModelSchema.parse(value); }, assertReady);
}
export async function removeLedgerEntry(accountId: string, id: string, assertReady?: () => void) {
  validateInput(recordId, id);
  if (!(await readLedger(accountId)).value.some(entry => entry.id === id)) throw new FeatureDataError("not-found");
  return writeOperation(() => repository.ledger.remove(id), () => undefined, assertReady);
}
