// Build 22 daily reviews over the repository. Every read and write names the account and trading day, and a response
// for another account or day is rejected as invalid, so a stale screen never shows another account's review.
import {
  dailyReviewDaySchema, dailyReviewIndexSchema, dailyReviewInputSchema, dailyReviewRefSchema, tradingDayKey,
  type DailyReviewDay, type DailyReviewInput, type DailyReviewRef,
} from "@fundedflow/domain";
import { repository } from "../../../lib/data/api";
import { recordId } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";

function requireDay(day: DailyReviewDay, accountId: string, tradingDay: string) {
  requireAccount(day.accountId, accountId);
  requireAccount(day.tradingDay, tradingDay);
  if (day.review) { requireAccount(day.review.accountId, accountId); requireAccount(day.review.tradingDay, tradingDay); }
  return day;
}

export async function readDailyReviewDay(accountId: string, tradingDay: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  validateInput(tradingDayKey, tradingDay);
  return readOperation(() => repository.dailyReviews.getDay(accountId, tradingDay),
    value => requireDay(dailyReviewDaySchema.parse(value), accountId, tradingDay), signal);
}
export async function readDailyReviewIndex(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.dailyReviews.list(accountId), value => {
    const index = dailyReviewIndexSchema.parse(value);
    requireAccount(index.accountId, accountId);
    return index;
  }, signal);
}
export async function saveDailyReview(accountId: string, input: DailyReviewInput, assertReady?: () => void) {
  const parsed = validateInput(dailyReviewInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  return writeOperation(() => repository.dailyReviews.save(parsed),
    value => requireDay(dailyReviewDaySchema.parse(value), accountId, parsed.tradingDay), assertReady);
}
export async function reopenDailyReview(accountId: string, ref: DailyReviewRef, assertReady?: () => void) {
  const parsed = validateInput(dailyReviewRefSchema, ref);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  return writeOperation(() => repository.dailyReviews.reopen(parsed),
    value => requireDay(dailyReviewDaySchema.parse(value), accountId, parsed.tradingDay), assertReady);
}
export async function relinkDailyReviewTrades(accountId: string, ref: DailyReviewRef, assertReady?: () => void) {
  const parsed = validateInput(dailyReviewRefSchema, ref);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  return writeOperation(() => repository.dailyReviews.relinkTrades(parsed),
    value => requireDay(dailyReviewDaySchema.parse(value), accountId, parsed.tradingDay), assertReady);
}
