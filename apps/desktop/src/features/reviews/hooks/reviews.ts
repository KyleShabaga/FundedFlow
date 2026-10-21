import type { ReviewInput, ScreenshotInput } from "@fundedflow/domain";
import { addScreenshot, readReviewSummaries, readScreenshot, readTradeReview, removeScreenshot, saveTradeReview } from "../api/reviews";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

// Library counts ("used by n reviews") change with reviews, so review writes refresh the library too.
const affected = (accountId: string) => [keys.reviewsRoot(accountId), keys.library, keys.deletion(accountId)];
const scope = (accountId: string, tradeId: string) => JSON.stringify(["review", accountId, tradeId]);

export const useTradeReview = (accountId: string | null, tradeId: string | null) => useFeatureQuery({
  key: keys.tradeReview(accountId, tradeId), enabled: accountId !== null && tradeId !== null,
  read: signal => readTradeReview(accountId!, tradeId!, signal), isEmpty: () => false,
});
export const useReviewSummaries = (accountId: string | null) => useFeatureQuery({
  key: keys.reviewSummaries(accountId), enabled: accountId !== null, read: signal => readReviewSummaries(accountId!, signal),
});
export const useSaveTradeReview = (accountId: string, tradeId: string) => useFeatureMutation({
  scope: scope(accountId, tradeId), run: (input: ReviewInput, guard) => saveTradeReview(accountId, input, guard), invalidate: () => affected(accountId),
});
// Screenshots have their own scope so an upload never blocks saving the notes, and vice versa.
export const useAddScreenshot = (accountId: string, tradeId: string) => useFeatureMutation({
  scope: JSON.stringify(["screenshot", accountId, tradeId]), run: (input: ScreenshotInput, guard) => addScreenshot(accountId, input, guard), invalidate: () => affected(accountId),
});
export const useRemoveScreenshot = (accountId: string, tradeId: string) => useFeatureMutation({
  scope: JSON.stringify(["screenshot", accountId, tradeId]), run: (id: string, guard) => removeScreenshot(accountId, id, guard), invalidate: () => affected(accountId),
});
export const useScreenshot = (accountId: string | null, id: string | null) => useFeatureQuery({
  key: keys.screenshot(accountId, id), enabled: accountId !== null && id !== null, read: signal => readScreenshot(accountId!, id!, signal), isEmpty: () => false,
});
