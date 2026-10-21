import { hashKey, useQuery, useQueryClient, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useRuntime, type RuntimeState } from "../../../app/RuntimeProvider";
import type { ReadReceipt } from "../contracts";
import { FeatureDataError, normalizeError } from "../errors";

export const FEATURE_STALE_MS = 30_000;
export function querySemantics<T>(query: Pick<UseQueryResult<ReadReceipt<T>, FeatureDataError>, "data" | "error" | "isPending" | "isFetching" | "isStale" | "status">,
  runtimeKind: RuntimeState["kind"], enabled: boolean, isEmpty: (value: T) => boolean) {
  const hasData = query.data !== undefined;
  const runtimeReady = runtimeKind === "ready";
  // Startup checks and recovery retries are transient: they read as loading, not as unavailable data.
  const runtimePending = runtimeKind === "checking" || runtimeKind === "recovering";
  const error = runtimeReady ? query.error : runtimePending ? null : new FeatureDataError(runtimeKind === "unsupported-schema" ? "unsupported-schema" : "unavailable");
  const isStale = hasData && (!runtimeReady || query.error !== null || query.isStale);
  return {
    data: query.data?.value, error, queryError: query.error, runtimeKind,
    isRuntimePending: runtimePending,
    isInitialLoading: enabled && !hasData && (runtimePending || (runtimeReady && query.isPending)),
    isRefreshing: hasData && query.isFetching,
    isEmpty: enabled && runtimeReady && query.status === "success" && !query.error && hasData ? isEmpty(query.data!.value) : null,
    /**
     * "cache-age" only means TanStack would refetch on next use (older than FEATURE_STALE_MS). Local SQLite data
     * changes only through this app's invalidated writes, so it is not a user-facing freshness problem: do not
     * show a stale notice for it. "refresh-error" and "runtime" are real: the data could not be confirmed.
     */
    isStale, staleReason: !isStale ? null : !runtimeReady ? "runtime" as const : query.error ? "refresh-error" as const : "cache-age" as const,
    isUnavailable: (!runtimeReady && !runtimePending) || error?.category === "unavailable",
    isUnsupported: runtimeKind === "unsupported-schema" || error?.category === "unsupported",
    isUsable: enabled && runtimeReady && query.status === "success" && !query.error,
    /** Client receipt time, not the snapshot's calculatedAt / stored updatedAt. */
    observedAt: query.data?.receivedAt ?? null,
    source: query.data?.source ?? null,
  };
}
/** Consumes the existing app providers. No transport, QueryClient or runtime polling is installed here. */
export function useFeatureQuery<T>({ key, read, enabled = true, isEmpty = value => value === null || (Array.isArray(value) && value.length === 0) }: {
  key: QueryKey; read: (signal: AbortSignal) => Promise<ReadReceipt<T>>; enabled?: boolean; isEmpty?: (value: T) => boolean;
}) {
  const { state, check } = useRuntime();
  const client = useQueryClient();
  const current = useRef({ state, read, enabled, check });
  current.current = { state, read, enabled, check };
  const ready = state.kind === "ready";
  const keyHash = hashKey(key);
  const query = useQuery<ReadReceipt<T>, FeatureDataError>({
    queryKey: key, networkMode: "always", enabled: ready && enabled, staleTime: FEATURE_STALE_MS,
    refetchOnWindowFocus: false, refetchInterval: false,
    retry: (count, error) => count < 1 && current.current.state.kind === "ready" && ["timeout", "unexpected"].includes(error.category),
    retryDelay: 500,
    queryFn: async ({ signal }) => {
      if (current.current.state.kind !== "ready" || !enabled) throw new FeatureDataError("unavailable");
      try {
        const value = await read(signal);
        if (signal.aborted) throw new FeatureDataError("cancelled");
        if (current.current.state.kind !== "ready") throw new FeatureDataError("unavailable");
        return value;
      } catch (cause) {
        const error = normalizeError(cause);
        if (error.category === "unavailable" && current.current.state.kind === "ready") void current.current.check();
        throw error;
      }
    },
  });
  useEffect(() => {
    if (ready) return;
    // Cancel consumption, then invalidate retained data without fetching while the runtime is unavailable.
    void client.cancelQueries({ queryKey: key, exact: true });
    void client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    // keyHash intentionally tracks key values, not a newly allocated tuple each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, ready, keyHash]);
  const refresh = async () => {
    if (current.current.state.kind !== "ready" || !current.current.enabled) throw new FeatureDataError("unavailable");
    await query.refetch({ throwOnError: true });
  };
  return { ...querySemantics(query, state.kind, enabled, isEmpty), refresh };
}
