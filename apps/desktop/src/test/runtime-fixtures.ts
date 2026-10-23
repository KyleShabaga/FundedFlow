// Runtime IPC fixtures only; never imported by production code.
import type { RuntimeFailure, RuntimeStatus } from "../lib/data/runtime";

export const initializing: RuntimeStatus = {
  state: "initializing", stage: "migrate", schemaVersion: 4,
  supportedSchemaVersion: 13, created: false, failure: null, cleanup: "clear",
};
export const ready: RuntimeStatus = {
  ...initializing, state: "ready", stage: "ready", schemaVersion: 13,
};
export function failed(category: RuntimeFailure["category"]): RuntimeStatus {
  const stages = { data_directory: "data_directory", open_failed: "open", backup_failed: "backup", migration_failed: "migrate", newer_schema: "open" } as const;
  return {
    ...initializing, state: "failed", stage: stages[category],
    schemaVersion: category === "newer_schema" ? 14 : 4,
    failure: {
      category, retryable: category !== "newer_schema", message: `Runtime failure: ${category}`,
      detail: "Test diagnostic", failedMigration: category === "migration_failed"
        ? { version: 5, name: "test", fromVersion: 3, reachedVersion: 4 } : null,
    },
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
