import type { DailyReviewInput, DailyReviewRef } from "@fundedflow/domain";
import { readDailyReviewDay, readDailyReviewIndex, relinkDailyReviewTrades, reopenDailyReview, saveDailyReview } from "../api/daily-reviews";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

// Library counts ("used by n reviews") include daily reviews, so review writes refresh the library too.
const affected = (accountId: string) => [keys.dailyReviewsRoot(accountId), keys.library, keys.deletion(accountId)];
// One scope per account and day: two saves of the same review never run at once.
const scope = (accountId: string, day: string) => JSON.stringify(["daily-review", accountId, day]);

export const useDailyReviewDay = (accountId: string | null, tradingDay: string | null) => useFeatureQuery({
  key: keys.dailyReviewDay(accountId, tradingDay), enabled: accountId !== null && tradingDay !== null,
  read: signal => readDailyReviewDay(accountId!, tradingDay!, signal), isEmpty: () => false,
});
/** The account's reviews, its current Rust trading day and legacy day notes. */
export const useDailyReviewIndex = (accountId: string | null) => useFeatureQuery({
  key: keys.dailyReviewIndex(accountId), enabled: accountId !== null, read: signal => readDailyReviewIndex(accountId!, signal), isEmpty: () => false,
});
export const useSaveDailyReview = (accountId: string, tradingDay: string) => useFeatureMutation({
  scope: scope(accountId, tradingDay), run: (input: DailyReviewInput, guard) => saveDailyReview(accountId, input, guard), invalidate: () => affected(accountId),
});
export const useReopenDailyReview = (accountId: string, tradingDay: string) => useFeatureMutation({
  scope: scope(accountId, tradingDay), run: (ref: DailyReviewRef, guard) => reopenDailyReview(accountId, ref, guard), invalidate: () => affected(accountId),
});
export const useRelinkDailyReviewTrades = (accountId: string, tradingDay: string) => useFeatureMutation({
  scope: scope(accountId, tradingDay), run: (ref: DailyReviewRef, guard) => relinkDailyReviewTrades(accountId, ref, guard), invalidate: () => affected(accountId),
});
