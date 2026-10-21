// One data-control operation at a time, across every Settings and Accounts
// entry point. Native operations report only their end state, so there is no
// timeout and no invented progress: a long export or restore stays "working"
// until Rust answers. Restore and deletion clear every cached read afterwards.
import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { useRuntime } from "../../../app/RuntimeProvider";
import { featureKeys } from "../../shared/query-keys";
import { DataControlProblem } from "../api/data-controls";

export type OperationName = "export" | "restore" | "delete" | "cleanup";

let current: OperationName | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => current;
const set = (next: OperationName | null) => {
  current = next;
  listeners.forEach(listener => listener());
};

/** Test-only: forget a lock left by an unmounted test. */
export function resetDataControlLock() {
  set(null);
}

export function useDataControlOperation() {
  const busy = useSyncExternalStore(subscribe, snapshot, snapshot);
  const runtime = useRuntime();
  const client = useQueryClient();
  const ready = runtime.state.kind === "ready";

  /** Runs one native operation. A second call while one is running is rejected, never queued. */
  const run = async <T,>(name: OperationName, task: () => Promise<T>): Promise<T> => {
    if (current !== null) throw new DataControlProblem("busy");
    if (runtime.state.kind !== "ready") throw new DataControlProblem("recovery_required");
    set(name);
    try {
      return await task();
    } finally {
      set(null);
    }
  };

  /** After a restore or deletion every cached read may describe data that is gone. */
  const forgetJournal = async () => {
    await client.cancelQueries({ queryKey: featureKeys.root });
    await client.resetQueries({ queryKey: featureKeys.root });
  };

  return { busy, ready, canStart: ready && busy === null, run, forgetJournal, retryRuntime: runtime.retry, runtimeKind: runtime.state.kind };
}
