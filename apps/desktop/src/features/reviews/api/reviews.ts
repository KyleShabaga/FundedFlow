// Build 20 per-trade reviews and screenshots over the repository. Every read and write names the account, and a
// response for another account or trade is rejected as invalid, so a stale screen never shows another account's review.
import {
  attachmentMetaSchema, reviewInputSchema, reviewSummarySchema, screenshotDataSchema, screenshotInputSchema, tradeReviewSchema,
  type ReviewInput, type ScreenshotInput,
} from "@fundedflow/domain";
import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { recordId } from "../../shared/contracts";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation, requireAccount, writeOperation } from "../../shared/operations";

/** Screenshots are read in full (up to 10 MB), so they get a longer deadline than plain reads. */
const SCREENSHOT_TIMEOUT_MS = 30_000;

export async function readTradeReview(accountId: string, tradeId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  validateInput(recordId, tradeId);
  return readOperation(() => repository.reviews.get(accountId, tradeId), value => {
    const review = tradeReviewSchema.nullable().parse(value);
    if (review) { requireAccount(review.accountId, accountId); requireAccount(review.tradeId, tradeId); }
    return review;
  }, signal);
}
export async function saveTradeReview(accountId: string, input: ReviewInput, assertReady?: () => void) {
  const parsed = validateInput(reviewInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  return writeOperation(() => repository.reviews.save(parsed), value => {
    const review = tradeReviewSchema.parse(value);
    requireAccount(review.accountId, accountId);
    requireAccount(review.tradeId, parsed.tradeId);
    return review;
  }, assertReady);
}
export async function readReviewSummaries(accountId: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  return readOperation(() => repository.reviews.summaries(accountId), values => z.array(reviewSummarySchema).parse(values), signal);
}
export async function addScreenshot(accountId: string, input: ScreenshotInput, assertReady?: () => void) {
  const parsed = validateInput(screenshotInputSchema, input);
  if (parsed.accountId !== accountId) throw new FeatureDataError("validation");
  return writeOperation(() => repository.reviews.addScreenshot(parsed), value => attachmentMetaSchema.parse(value), assertReady);
}
export async function readScreenshot(accountId: string, id: string, signal?: AbortSignal) {
  validateInput(recordId, accountId);
  validateInput(recordId, id);
  return readOperation(() => repository.reviews.readScreenshot(accountId, id), value => {
    const data = screenshotDataSchema.parse(value);
    requireAccount(data.attachmentId, id);
    return data;
  }, signal, SCREENSHOT_TIMEOUT_MS);
}
export async function removeScreenshot(accountId: string, id: string, assertReady?: () => void) {
  validateInput(recordId, accountId);
  validateInput(recordId, id);
  return writeOperation(() => repository.reviews.removeScreenshot(accountId, id), () => undefined, assertReady);
}
