import { readSnapshots, readLatestSnapshot, type SnapshotFilters } from "../api/snapshots";
import { getCapability } from "../../shared/capabilities";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
export const useSnapshotHistory = (id: string | null, filters: SnapshotFilters = {}) => useFeatureQuery({ key: keys.snapshots(id, filters), enabled: id !== null, read: signal => readSnapshots(id!, filters, signal) });
export const useLatestSnapshot = (id: string | null) => useFeatureQuery({ key: keys.latestSnapshot(id), enabled: id !== null, read: signal => readLatestSnapshot(id!, signal) });
export const useInsightsCapability = () => getCapability("insights-aggregates");
