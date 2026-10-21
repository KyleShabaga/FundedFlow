import type { CsvImportRequest } from "@fundedflow/domain";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useRuntime } from "../../../app/RuntimeProvider";
import * as api from "../api/imports";
import { FeatureDataError } from "../../shared/errors";
import { featureKeys as keys } from "../../shared/query-keys";
import { useFeatureQuery } from "../../shared/hooks/use-feature-query";
import { useFeatureMutation } from "../../shared/hooks/use-feature-mutation";

export const useImportHistory = (id: string | null) => useFeatureQuery({ key: keys.imports(id), enabled: id !== null, read: signal => api.readImportHistory(id!, signal) });
export const useImportResult = (id: string | null, batchId: string | null) => useFeatureQuery({ key: keys.importResult(id, batchId), enabled: id !== null && batchId !== null, read: signal => api.readImportResult(id!, batchId!, signal), isEmpty: () => false });
export const useImportProblemRows = (id: string | null, batchId: string | null) => useFeatureQuery({ key: keys.importRows(id, batchId), enabled: id !== null && batchId !== null, read: signal => api.readImportProblemRows(id!, batchId!, signal) });
/** Explicit, read-only preview action. CSV contents never enter persistent query keys/caches. */
export function useCsvPreview() {
  const { state } = useRuntime();
  const current = useRef(state); current.current = state;
  const active = useRef<AbortController | null>(null);
  useEffect(() => { if (state.kind !== "ready") active.current?.abort(); }, [state.kind]);
  useEffect(() => () => active.current?.abort(), []);
  const preview = useMutation({ retry: false, networkMode: "always", gcTime: 0, mutationFn: (input: CsvImportRequest) => {
    if (current.current.kind !== "ready") throw new FeatureDataError(current.current.kind === "unsupported-schema" ? "unsupported-schema" : "unavailable");
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    return api.previewImport(input, controller.signal).finally(() => { if (active.current === controller) active.current = null; });
  } });
  return { data: state.kind === "ready" ? preview.data?.value : undefined, error: preview.error,
    isPending: preview.isPending, reset: () => { active.current?.abort(); preview.reset(); },
    preview: (request: CsvImportRequest) => preview.mutateAsync(request) };
}
export const useCommitCsvImport = (id: string) => useFeatureMutation({ scope: JSON.stringify(["csv-commit", id]),
  run: (input: CsvImportRequest) => {
    if (input.accountId !== id) throw new FeatureDataError("validation");
    return api.commitImport(input);
  }, confirmedFailure: batch => batch.status === "failed",
  invalidate: batch => batch?.status === "failed" ? [keys.imports(id), keys.deletion(id)]
    : [keys.imports(id), keys.tradesRoot(id), keys.dailyReviewsRoot(id), keys.snapshotsRoot(id), keys.deletion(id), keys.lineageRoot],
});
