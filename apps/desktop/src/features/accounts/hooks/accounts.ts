import type { AccountFilter, AccountInput, ResetInput, StatusChangeInput } from "@fundedflow/domain";
import * as api from "../api/accounts";
import { FeatureDataError } from "../../shared/errors";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

export const useAccounts = (filter: AccountFilter = "live") => useFeatureQuery({ key: keys.accountList(filter), read: signal => api.readAccounts(filter, signal) });
export const useAccount = (id: string | null) => useFeatureQuery({ key: keys.detail(id), enabled: id !== null, read: signal => api.readAccount(id!, signal) });
export const useAccountHistory = (id: string | null) => useFeatureQuery({ key: keys.history(id), enabled: id !== null, read: signal => api.readAccountHistory(id!, signal), isEmpty: value => value.statusEvents.length === 0 && value.archiveEvents.length === 0 });
export const useAccountLineage = (id: string | null) => useFeatureQuery({ key: keys.lineage(id), enabled: id !== null, read: signal => api.readAccountLineage(id!, signal) });
export const useAccountDeletionPreview = (id: string | null) => useFeatureQuery({ key: keys.deletion(id), enabled: id !== null, read: signal => api.readDeletionPreview(id!, signal), isEmpty: () => false });
const affected = (id: string) => [keys.accounts, keys.account(id), keys.lineageRoot, keys.rulebooks(id), keys.dailyReviewsRoot(id)];
const scope = (id: string) => JSON.stringify(["account", id]);
export const useCreateAccount = () => useFeatureMutation({ scope: "accounts-create", run: api.createAccount, invalidate: () => [keys.accounts] });
export const useUpdateAccount = (id: string) => useFeatureMutation({ scope: scope(id), run: (input: AccountInput) => api.updateAccount(id, input), invalidate: () => affected(id) });
export const useArchiveAccount = (id: string) => useFeatureMutation({ scope: scope(id), run: (_: void) => api.archiveAccount(id), invalidate: () => affected(id) });
export const useRestoreAccount = (id: string) => useFeatureMutation({ scope: scope(id), run: (_: void) => api.restoreAccount(id), invalidate: () => affected(id) });
export const useChangeAccountStatus = (id: string) => useFeatureMutation({ scope: scope(id), run: (input: StatusChangeInput) => api.changeAccountStatus(id, input), invalidate: () => affected(id) });
export const useResetAccountAttempt = (id: string) => useFeatureMutation({ scope: scope(id), run: (input: ResetInput) => {
  if (input.predecessorAccountId !== id) throw new FeatureDataError("validation");
  return api.resetAccountAttempt(input);
}, invalidate: result => [...affected(id), ...(result ? [keys.account(result.successor.id)] : [])] });
