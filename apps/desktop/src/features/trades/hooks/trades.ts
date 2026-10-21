import type { TradeChangeOptions, TradeInput } from "@fundedflow/domain";
import { correctTrade, deleteTrade, readDeletedTrades, readTrade, readTradeRecord, readTrades, restoreTrade, saveTrade, removeTrade, type TradeFilters } from "../api/trades";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";
// A trade change can move P&L (and so R-multiples and risk snapshots): Build 16 risk views key off snapshotsRoot.
const affected = (id: string) => [keys.tradesRoot(id), keys.reviewsRoot(id), keys.dailyReviewsRoot(id), keys.journalRoot(id), keys.snapshotsRoot(id), keys.deletion(id), keys.lineageRoot, keys.insightsRoot];
const scope = (id: string) => JSON.stringify(["trades", id]);
export const useTrades = (id: string | null, filters: TradeFilters = {}) => useFeatureQuery({ key: keys.trades(id, filters), enabled: id !== null, read: signal => readTrades(id!, filters, signal) });
export const useCreateTrade = (id: string) => useFeatureMutation({ scope: scope(id), run: (input: TradeInput, guard) => saveTrade(id, input, undefined, guard), invalidate: () => affected(id) });
export const useUpdateTrade = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: (input: TradeInput, guard) => saveTrade(accountId, input, id, guard), invalidate: () => affected(accountId) });
export const useDeleteTrade = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: (_: void, guard) => removeTrade(accountId, id, guard), invalidate: () => affected(accountId) });

export const useTrade = (accountId: string | null, id: string | null) => useFeatureQuery({ key: keys.tradeDetail(accountId, id), enabled: accountId !== null && id !== null, read: signal => readTrade(accountId!, id!, signal), isEmpty: () => false });

/* Build 20 */
export const useTradeRecord = (accountId: string | null, id: string | null) => useFeatureQuery({ key: keys.tradeRecord(accountId, id), enabled: accountId !== null && id !== null, read: signal => readTradeRecord(accountId!, id!, signal), isEmpty: () => false });
export const useDeletedTrades = (accountId: string | null) => useFeatureQuery({ key: keys.deletedTrades(accountId), enabled: accountId !== null, read: signal => readDeletedTrades(accountId!, signal) });
export const useCorrectTrade = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: ({ input, options }: { input: TradeInput; options: TradeChangeOptions }, guard) => correctTrade(accountId, id, input, options, guard), invalidate: () => affected(accountId) });
export const useRemoveTrade = (accountId: string, id: string) => useFeatureMutation({ scope: scope(accountId), run: (reason: string | null, guard) => deleteTrade(accountId, id, reason, guard), invalidate: () => affected(accountId) });
export const useRestoreTrade = (accountId: string) => useFeatureMutation({ scope: scope(accountId), run: (id: string, guard) => restoreTrade(accountId, id, guard), invalidate: () => affected(accountId) });
