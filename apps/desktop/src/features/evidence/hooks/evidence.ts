import type { ObservationInput, ReconciliationRequest } from "@fundedflow/domain";
import * as api from "../api/evidence";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

// A checkpoint or comparison changes the risk inputs, so saved calculations are re-checked (snapshotsRoot).
const affected = (id: string) => [keys.observations(id), keys.reconciliations(id), keys.snapshotsRoot(id)];
const scope = (id: string) => JSON.stringify(["evidence", id]);
export const useObservations = (id: string | null) => useFeatureQuery({ key: keys.observations(id), enabled: id !== null, read: signal => api.readObservations(id!, signal) });
export const useReconciliations = (id: string | null) => useFeatureQuery({ key: keys.reconciliations(id), enabled: id !== null, read: signal => api.readReconciliations(id!, signal) });
export const useRecordObservation = (id: string) => useFeatureMutation({ scope: scope(id), run: (input: ObservationInput, guard) => api.recordObservation(id, input, guard), invalidate: () => affected(id) });
export const useReconcileBalance = (id: string) => useFeatureMutation({ scope: scope(id), run: (request: ReconciliationRequest, guard) => api.reconcileBalance(id, request, guard), invalidate: () => affected(id) });
