import type { TradeInput } from "@fundedflow/domain";
import { readTrade, readTrades, saveTrade, removeTrade, type TradeFilters } from "../api/trades";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";
const affected = (id: string) => [keys.tradesRoot(id), keys.journalRoot(id), keys.snapshotsRoot(id), keys.deletion(id), keys.lineageRoot];
const scope = (id: string) => JSON.stringify(["trades", id]);
export const useTrades = (id: string | null, filters: TradeFilters = {}) => useFeatureQuery({ key: keys.trades(id, filters), enabled: id !== null, read: signal => readTrades(id!, filters, signal) });
export const useCreateTrade = (id: string) => useFeatureMutation({ scope: scope(id), run: (input: TradeInput, guard) => saveTrade(id, input, undefined, guard), invalidate: () => affected(id) });
export const useUpdateTrade = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: (input: TradeInput, guard) => saveTrade(accountId, input, id, guard), invalidate: () => affected(accountId) });
export const useDeleteTrade = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: (_: void, guard) => removeTrade(accountId, id, guard), invalidate: () => affected(accountId) });

export const useTrade = (accountId: string | null, id: string | null) => useFeatureQuery({ key: keys.tradeDetail(accountId, id), enabled: accountId !== null && id !== null, read: signal => readTrade(accountId!, id!, signal), isEmpty: () => false });
