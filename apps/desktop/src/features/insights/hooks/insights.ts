import { readSnapshots, readLatestSnapshot, type SnapshotFilters } from "../api/snapshots";
import { readInsightsDataset } from "../api/insights";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
export const useSnapshotHistory = (id: string | null, filters: SnapshotFilters = {}) => useFeatureQuery({ key: keys.snapshots(id, filters), enabled: id !== null, read: signal => readSnapshots(id!, filters, signal) });
export const useLatestSnapshot = (id: string | null) => useFeatureQuery({ key: keys.latestSnapshot(id), enabled: id !== null, read: signal => readLatestSnapshot(id!, signal) });
/** Build 23: the read-only Insights snapshot of exactly these attempts (none: nothing is read). */
export const useInsightsDataset = (accountIds: readonly string[]) => useFeatureQuery({
  key: keys.insights(accountIds), enabled: accountIds.length > 0, read: signal => readInsightsDataset(accountIds, signal),
  isEmpty: () => false,
});
