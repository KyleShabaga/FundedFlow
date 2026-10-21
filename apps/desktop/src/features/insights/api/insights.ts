// Build 23 Insights read over the repository. One request names exactly the attempts to read; a response that holds
// another account, or a trade of an account that was not asked for, is rejected as invalid, so a stale or mismatched
// payload can never widen the selection. Aggregation happens in @fundedflow/domain (selectTrades / summarize).
import { insightsDatasetSchema, insightsQuerySchema, type InsightsDataset } from "@fundedflow/domain";
import { repository } from "../../../lib/data/api";
import { FeatureDataError, validateInput } from "../../shared/errors";
import { readOperation } from "../../shared/operations";

export function checkScope(dataset: InsightsDataset, accountIds: readonly string[]): InsightsDataset {
  const requested = new Set(accountIds);
  const returned = new Set(dataset.accounts.map(a => a.id));
  const sameAccounts = returned.size === requested.size && [...returned].every(id => requested.has(id));
  if (!sameAccounts || dataset.trades.some(t => !requested.has(t.accountId))) throw new FeatureDataError("invalid-response");
  return dataset;
}

export async function readInsightsDataset(accountIds: readonly string[], signal?: AbortSignal) {
  const query = validateInput(insightsQuerySchema, { accountIds: [...new Set(accountIds)].sort() });
  return readOperation(() => repository.insights.dataset(query), value => checkScope(insightsDatasetSchema.parse(value), query.accountIds), signal);
}
