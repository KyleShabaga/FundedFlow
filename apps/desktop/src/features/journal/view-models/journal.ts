import { journalEntrySchema } from "@fundedflow/domain";
import { z } from "zod";
import { accountRecordSchema } from "../../accounts/view-models/account";
import { instant, recordId, timeZone } from "../../shared/contracts";

export const journalViewModelSchema = journalEntrySchema.extend({
  id: recordId, accountId: recordId, tradeId: recordId.nullable(),
  entryAt: instant, createdAt: instant, updatedAt: instant, timeZone,
  provenance: z.literal("stored-journal-entry"),
});
export type JournalViewModel = z.infer<typeof journalViewModelSchema>;
export function toJournalViewModel(input: unknown, accountInput: unknown): JournalViewModel {
  const account = accountRecordSchema.parse(accountInput);
  const entry = journalEntrySchema.parse(input);
  if (entry.accountId !== account.id) throw new Error("Account identity mismatch");
  return journalViewModelSchema.parse({ ...entry, timeZone: account.timezone, provenance: "stored-journal-entry" });
}
