import { journalEntryInputSchema, journalEntrySchema, type JournalEntryInput } from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { instant, recordId } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";
import { readAccount } from "../../accounts/api/accounts";
import { toJournalViewModel } from "../view-models/journal";

export const journalFilterSchema = z.object({ from: instant.optional(), to: instant.optional(), tradeId: recordId.optional(), tag: z.string().min(1).optional() })
  .refine(value => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), { path: ["to"], message: "End must not precede start" });
export type JournalFilters = z.infer<typeof journalFilterSchema>;
export async function readJournal(accountId: string, filters: JournalFilters = {}, signal?: AbortSignal) {
  const parsed = validateInput(journalFilterSchema, filters);
  const account = (await readAccount(accountId, signal)).value;
  return readOperation(() => repository.journal.list(accountId), values => values.map(value => toJournalViewModel(value, account)).filter(value =>
    (!parsed.from || Date.parse(value.entryAt) >= Date.parse(parsed.from)) && (!parsed.to || Date.parse(value.entryAt) <= Date.parse(parsed.to)) &&
    (!parsed.tradeId || value.tradeId === parsed.tradeId) && (!parsed.tag || value.tags.includes(parsed.tag))), signal);
}
async function requireEntry(accountId: string, id: string) {
  validateInput(recordId, id);
  const entries = (await readOperation(() => repository.journal.list(accountId), values => z.array(journalEntrySchema).parse(values))).value;
  const record = entries.find(value => value.id === id);
  if (!record) throw new FeatureDataError("not-found");
  requireAccount(record.accountId, accountId);
}
export async function saveJournalEntry(accountId: string, input: JournalEntryInput, id?: string, assertReady?: () => void) {
  const parsed = validateInput(journalEntryInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  const account = (await readAccount(accountId)).value;
  if (id) await requireEntry(accountId, id);
  return writeOperation(() => id ? repository.journal.update(id, parsed) : repository.journal.create(parsed), value => { if (id) requireAccount(value.id, id); return toJournalViewModel(value, account); }, assertReady);
}
export async function removeJournalEntry(accountId: string, id: string, assertReady?: () => void) {
  await requireEntry(accountId, id);
  return writeOperation(() => repository.journal.remove(id), () => undefined, assertReady);
}
export async function readJournalEntry(accountId: string, id: string, signal?: AbortSignal) {
  validateInput(recordId, id);
  const result = await readJournal(accountId, {}, signal);
  const value = result.value.find(entry => entry.id === id);
  if (!value) throw new FeatureDataError("not-found");
  return { ...result, value };
}
