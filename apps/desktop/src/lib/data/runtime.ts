// Typed access to the local runtime commands in src-tauri/src/commands.rs
// (`runtime_status`, `retry_runtime`). See docs/data-model.md#startup-and-recovery.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const failureCategories = [
  "data_directory",
  "open_failed",
  "backup_failed",
  "migration_failed",
  "newer_schema",
] as const;

export const runtimeFailureSchema = z.object({
  category: z.enum(failureCategories),
  retryable: z.boolean(),
  message: z.string(),
  detail: z.string(),
});
export type RuntimeFailure = z.infer<typeof runtimeFailureSchema>;

export const runtimeStatusSchema = z.object({
  state: z.enum(["initializing", "ready", "failed"]),
  schemaVersion: z.number().int().nullable(),
  supportedSchemaVersion: z.number().int(),
  created: z.boolean(),
  failure: runtimeFailureSchema.nullable(),
});
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

/** Rejects if the command does not answer within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no response after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function call(command: "runtime_status" | "retry_runtime", ms: number): Promise<RuntimeStatus> {
  return runtimeStatusSchema.parse(await withTimeout(invoke(command), ms));
}

export const runtimeGateway = {
  /** Read-only; never changes the database. */
  status: () => call("runtime_status", 10_000),
  /** Re-runs the real open/backup/migrate path. */
  retry: () => call("retry_runtime", 60_000),
};
