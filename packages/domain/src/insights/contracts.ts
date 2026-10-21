// Build 23 Insights contracts: the read-only dataset the Rust `get_insights_dataset` command returns, the filter that
// selects the included-trade set from it, and the versioned identifiers every result carries as provenance. Field
// names and shapes match the serde structs in apps/desktop/src-tauri/src/store/insights.rs. Rust stores every money
// value, trading day and R multiple; these schemas only reject payload drift. Aggregation is in metrics.ts.

import { z } from "zod";

import { accountStatuses } from "../contracts/accounts.js";
import { reviewTagSchema } from "../contracts/reviews.js";
import { pnlStatuses, tradeSides } from "../contracts/trades.js";

/** Version of the dataset wire shape. Rust writes it; a different number is refused rather than guessed at. */
export const INSIGHTS_CONTRACT_VERSION = 1;
/** Version of the included-trade selector and metric definitions. Shown with every result as provenance. */
export const INSIGHTS_SELECTOR_VERSION = "insights/1";
/**
 * Fewest financially eligible trades before expectancy, profit factor and average R are shown. Below it the raw
 * counts and sums stay visible and these metrics are withheld as insufficient data.
 */
export const INSIGHTS_MIN_SAMPLE = 5;
/** Most attempts one request may name. */
export const INSIGHTS_MAX_ACCOUNTS = 500;

const id = z.string().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^-?\d+(\.\d+)?$/);
const text = z.string().nullable();

/** Which attempts to read, by stable local account id (archived attempts included: they are read-only history). */
export const insightsQuerySchema = z.strictObject({
  accountIds: z.array(id).min(1).max(INSIGHTS_MAX_ACCOUNTS),
});
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;

export const plannedRiskSources = ["entered", "derived"] as const;

/** What the trade's Build 20 review recorded, as Insights needs it. Labels are the review's snapshots. */
export const insightsReviewSchema = z.object({
  reviewed: z.boolean(),
  strategyId: text,
  strategyName: text,
  tags: z.array(reviewTagSchema),
  /** 1R in the account currency: entered, or derived by Rust from the planned entry and stop. Null is unknown. */
  plannedRisk: money.nullable(),
  plannedRiskSource: z.enum(plannedRiskSources).nullable(),
  /** Net P&L ÷ 1R, two decimals, computed by Rust; null without a known P&L and planned risk. */
  rMultiple: z.string().regex(/^-?\d+(\.\d+)?$/).nullable(),
});
export type InsightsReview = z.infer<typeof insightsReviewSchema>;

/** One active (not soft-deleted) trade of a requested attempt, open or closed, with Rust-stored values. */
export const insightsTradeSchema = z.object({
  id,
  accountId: id,
  source: z.enum(["manual", "csv_import"]),
  importBatchId: text,
  symbol: z.string().min(1),
  /** The matched instrument's root (ES for ESZ6), or null when the symbol matches no known instrument. */
  symbolRoot: text,
  side: z.enum(tradeSides),
  quantity: z.string(),
  entryAt: z.string(),
  exitAt: text,
  /** The account's trading day for this trade, stored by Rust (zone, reset time, weekend roll). */
  tradingDay: day,
  /** Fees as stored. An import or entry without fees is stored as 0. */
  fees: money,
  grossPnl: money.nullable(),
  realizedPnl: money.nullable(),
  reportedPnl: money.nullable(),
  pnlStatus: z.enum(pnlStatuses),
  updatedAt: z.string(),
  review: insightsReviewSchema.nullable(),
});
export type InsightsTrade = z.infer<typeof insightsTradeSchema>;

/** The status event that set the account's current status, as the user entered it. */
export const insightsStatusEventSchema = z.object({
  status: z.enum(accountStatuses),
  effectiveAt: z.string(),
  /** The user's words; null means not stated. Never inferred from trades. */
  cause: text,
  note: text,
});
export type InsightsStatusEvent = z.infer<typeof insightsStatusEventSchema>;

export const insightsAccountSchema = z.object({
  id,
  name: z.string(),
  broker: text,
  propFirm: text,
  externalRef: text,
  accountType: z.string(),
  status: z.enum(accountStatuses),
  archivedAt: text,
  currency: z.string(),
  timezone: z.string(),
  tradingDayResetTime: z.string(),
  createdAt: z.string(),
  /** First attempt of the reset chain this attempt belongs to (itself when it has no predecessor). */
  lineageRootId: id,
  /** 1 for the first attempt of the chain. */
  attemptNumber: z.number().int().min(1),
  predecessorAccountId: text,
  successorAccountId: text,
  statusEvent: insightsStatusEventSchema.nullable(),
  /** Soft-deleted trades: never included, counted so totals can say what was left out. */
  deletedTradeCount: z.number().int().nonnegative(),
  committedImportCount: z.number().int().nonnegative(),
  failedImportCount: z.number().int().nonnegative(),
  lastImportAt: text,
});
export type InsightsAccount = z.infer<typeof insightsAccountSchema>;

export const insightsDatasetSchema = z.object({
  contractVersion: z.literal(INSIGHTS_CONTRACT_VERSION),
  /** When Rust read the journal: the "data as of" of every result. */
  generatedAt: z.string(),
  accounts: z.array(insightsAccountSchema),
  trades: z.array(insightsTradeSchema),
});
export type InsightsDataset = z.infer<typeof insightsDatasetSchema>;

export type InsightsBasis = "net" | "gross";

/**
 * Which closed trades of the dataset are included. Every metric, chart and table of one report uses the same filter,
 * so they always agree. `null` / "all" means not filtered.
 */
export interface InsightsFilter {
  /** Attempts, by local account id. Never widened or narrowed to the active account. */
  accountIds: readonly string[];
  /** Trading days, inclusive. */
  from: string | null;
  to: string | null;
  /** Matches the instrument root, or the symbol itself when it has no known instrument. */
  symbol: string | null;
  side: "all" | "long" | "short";
  /** A strategy id, or NO_STRATEGY for trades without one. */
  strategyId: string | null;
  tagId: string | null;
  source: "all" | "manual" | "csv_import";
  /** The one currency to aggregate; required when the selection holds several (amounts are never converted). */
  currency: string | null;
}
export const NO_STRATEGY = "__none__";

export const EMPTY_FILTER: Omit<InsightsFilter, "accountIds"> = {
  from: null, to: null, symbol: null, side: "all", strategyId: null, tagId: null, source: "all", currency: null,
};
