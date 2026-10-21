import { readCurrentRisk, readSnapshots, readLatestSnapshot, type SnapshotFilters } from "../api/snapshots";
import { readInsightsDataset } from "../api/insights";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
export const useSnapshotHistory = (id: string | null, filters: SnapshotFilters = {}) => useFeatureQuery({ key: keys.snapshots(id, filters), enabled: id !== null, read: signal => readSnapshots(id!, filters, signal) });
/**
 * The account's current result (P0-02), re-verified natively. `checkedAt` re-reads it whenever Today re-checks, so a
 * cached answer is never presented as newly verified; source writes invalidate it with the rest of the snapshots.
 */
export const useCurrentRisk = (id: string | null, checkedAt: string | null = null) => useFeatureQuery({
  key: [...keys.snapshotsRoot(id), "current", checkedAt], enabled: id !== null, read: signal => readCurrentRisk(id!, signal), isEmpty: () => false,
});
export const useLatestSnapshot = (id: string | null) => useFeatureQuery({ key: keys.latestSnapshot(id), enabled: id !== null, read: signal => readLatestSnapshot(id!, signal) });
/** Build 23: the read-only Insights snapshot of exactly these attempts (none: nothing is read). */
export const useInsightsDataset = (accountIds: readonly string[]) => useFeatureQuery({
  key: keys.insights(accountIds), enabled: accountIds.length > 0, read: signal => readInsightsDataset(accountIds, signal),
  isEmpty: () => false,
});
