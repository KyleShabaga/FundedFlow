import type { JournalEntryInput } from "@fundedflow/domain";
import { readJournalEntry, readJournal, saveJournalEntry, removeJournalEntry, type JournalFilters } from "../api/journal";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";
const affected = (id: string) => [keys.journalRoot(id), keys.deletion(id)];
const scope = (id: string) => JSON.stringify(["journal", id]);
export const useJournalEntries = (id: string | null, filters: JournalFilters = {}) => useFeatureQuery({ key: keys.journal(id, filters), enabled: id !== null, read: signal => readJournal(id!, filters, signal) });
export const useCreateJournalEntry = (id: string) => useFeatureMutation({ scope: scope(id), run: (input: JournalEntryInput, guard) => saveJournalEntry(id, input, undefined, guard), invalidate: () => affected(id) });
export const useUpdateJournalEntry = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: (input: JournalEntryInput, guard) => saveJournalEntry(accountId, input, id, guard), invalidate: () => affected(accountId) });
export const useDeleteJournalEntry = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: (_: void, guard) => removeJournalEntry(accountId, id, guard), invalidate: () => affected(accountId) });

export const useJournalEntry = (accountId: string | null, id: string | null) => useFeatureQuery({ key: keys.journalDetail(accountId, id), enabled: accountId !== null && id !== null, read: signal => readJournalEntry(accountId!, id!, signal), isEmpty: () => false });
