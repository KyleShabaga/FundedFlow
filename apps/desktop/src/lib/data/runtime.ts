// Typed access to the local runtime commands in src-tauri/src/commands.rs
// (`runtime_status`, `retry_runtime`). See docs/data-model.md#startup-and-recovery.
//
// Initialization runs in the background on the Rust side; both commands
// answer at once. While the state is "initializing" the frontend polls
// `runtime_status`; a slow upgrade is shown as progress, never as a timeout.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const failureCategories = [
  "data_directory",
  "open_failed",
  "backup_failed",
  "migration_failed",
  "newer_schema",
] as const;

export const runtimeStages = ["data_directory", "open", "backup", "migrate", "ready"] as const;

export const runtimeFailureSchema = z.object({
  category: z.enum(failureCategories),
  retryable: z.boolean(),
  message: z.string(),
  detail: z.string(),
  /** For migration_failed: which step failed, and the version the journal is at now. */
  failedMigration: z
    .object({
      version: z.number().int(),
      name: z.string(),
      fromVersion: z.number().int(),
      reachedVersion: z.number().int(),
    })
    .nullable(),
});
export type RuntimeFailure = z.infer<typeof runtimeFailureSchema>;

export const runtimeStatusSchema = z.object({
  state: z.enum(["initializing", "ready", "failed"]),
  /** What initialization is doing, reached, or where it failed. */
  stage: z.enum(runtimeStages),
  /** The journal's schema version whenever known, also on failure. */
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

async function call(command: "runtime_status" | "retry_runtime"): Promise<RuntimeStatus> {
  // Both commands only read or start work, so an answer is quick; no answer
  // means the bridge itself is unavailable.
  return runtimeStatusSchema.parse(await withTimeout(invoke(command), 10_000));
}

export const runtimeGateway = {
  /** Read-only; never changes the database. */
  status: () => call("runtime_status"),
  /** Starts the real open/backup/migrate path again in the background and returns at once. */
  retry: () => call("retry_runtime"),
};
