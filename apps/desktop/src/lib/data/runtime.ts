// Typed access to the local runtime commands in src-tauri/src/commands.rs
// (`runtime_status`, `retry_runtime`). See docs/data-model.md#startup-and-recovery.
//
// Initialization runs in the background on the Rust side; both commands
// answer at once. While the state is "initializing" the frontend polls
// `runtime_status` with finite backoff. Pausing frontend checks never cancels
// or declares failure of a background upgrade.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const failureCategories = [
  "data_directory",
  "open_failed",
  "backup_failed",
  "migration_failed",
  "newer_schema",
  /** The data folder itself is a symbolic link, junction or mount point (TASK-018). Never retryable. */
  "data_folder_link",
] as const;

export const runtimeStages = ["data_directory", "open", "backup", "migrate", "ready"] as const;

/** Deletion cleanup left on disk; never a failure (`CleanupOutcome` in src-tauri/src/data_controls/deletion.rs). */
export const cleanupStates = ["clear", "quarantined", "pending"] as const;

const version = z.number().int().min(0).max(4_294_967_295);

export const runtimeFailureSchema = z.object({
  category: z.enum(failureCategories),
  retryable: z.boolean(),
  message: z.string(),
  detail: z.string(),
  /** For migration_failed: which step failed, and the version the journal is at now. */
  failedMigration: z
    .object({
      version: version,
      name: z.string(),
      fromVersion: version,
      reachedVersion: version,
    })
    .nullable(),
});
export type RuntimeFailure = z.infer<typeof runtimeFailureSchema>;

export const runtimeStatusSchema = z.object({
  state: z.enum(["initializing", "ready", "failed"]),
  /** What initialization is doing, reached, or where it failed. */
  stage: z.enum(runtimeStages),
  /** The journal's schema version whenever known, also on failure. */
  schemaVersion: version.nullable(),
  supportedSchemaVersion: version,
  created: z.boolean(),
  failure: runtimeFailureSchema.nullable(),
  /** Files a permanent deletion could not remove yet ("pending"), or unreadable cleanup records set aside. */
  cleanup: z.enum(cleanupStates),
}).superRefine((status, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (status.state === "ready") {
    if (status.failure !== null || status.stage !== "ready" || status.schemaVersion !== status.supportedSchemaVersion) {
      invalid("Ready status must describe a supported, open journal without a failure");
    }
  } else if (status.state === "initializing") {
    if (status.failure !== null) invalid("Initializing status cannot contain a failure");
  } else {
    const failure = status.failure;
    if (!failure) { invalid("Failed status must describe its failure"); return; }
    const stage = { data_directory: "data_directory", open_failed: "open", backup_failed: "backup", migration_failed: "migrate", newer_schema: "open", data_folder_link: "data_directory" };
    if (status.stage !== stage[failure.category] || status.created) invalid("Failed status has contradictory stage or creation fields");
    if (failure.category === "newer_schema" && (failure.retryable || status.schemaVersion === null || status.schemaVersion <= status.supportedSchemaVersion)) {
      invalid("Newer schema must be newer than supported and cannot be retried");
    }
    if (failure.category === "data_folder_link" && failure.retryable) invalid("A linked data folder cannot be retried");
    const migration = failure.failedMigration;
    if (failure.category === "migration_failed") {
      if (!migration || migration.fromVersion > migration.reachedVersion || migration.reachedVersion >= migration.version || status.schemaVersion !== migration.reachedVersion) {
        invalid("Migration failure must report consistent reached and failed versions");
      }
    } else if (migration !== null) invalid("Migration details require a migration failure");
  }
});
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const COMMAND_TIMEOUT_MS = 10_000;
export type RuntimeCommand = "runtime_status" | "retry_runtime";
export type RuntimeGatewayErrorKind = "timeout" | "rejected" | "invalid-response" | "pending";

export class RuntimeGatewayError extends Error {
  constructor(public readonly kind: RuntimeGatewayErrorKind) {
    const messages = {
      timeout: "The local runtime did not answer within 10 seconds.",
      rejected: "The local runtime command could not be completed.",
      "invalid-response": "The local runtime returned an invalid response.",
      pending: "A previous runtime command is still awaiting a response.",
    };
    super(messages[kind]);
    this.name = "RuntimeGatewayError";
  }
}

/** Runtime-only bridge. A timed-out invoke cannot be cancelled: retain its lock until it settles. */
export function createRuntimeGateway(transport: (command: RuntimeCommand) => Promise<unknown>) {
  let flight: { command: RuntimeCommand; promise: Promise<RuntimeStatus>; timedOut: boolean } | null = null;
  function call(command: RuntimeCommand): Promise<RuntimeStatus> {
    if (flight) {
      if (flight.command === command && !flight.timedOut) return flight.promise;
      return Promise.reject(new RuntimeGatewayError("pending"));
    }
    const response = Promise.resolve().then(() => transport(command)).then(value => {
      const parsed = runtimeStatusSchema.safeParse(value);
      if (!parsed.success) throw new RuntimeGatewayError("invalid-response");
      return parsed.data;
    }, () => { throw new RuntimeGatewayError("rejected"); });
    const promise = new Promise<RuntimeStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.timedOut = true;
        reject(new RuntimeGatewayError("timeout"));
      }, COMMAND_TIMEOUT_MS);
      const release = () => { clearTimeout(timer); if (flight === entry) flight = null; };
      response.then(value => { release(); resolve(value); }, error => { release(); reject(error); });
    });
    const entry = { command, promise, timedOut: false };
    flight = entry;
    return promise;
  }
  return {
    /** Read-only; never initializes or repairs the database. */
    status: () => call("runtime_status"),
    /** Starts actual initialization; the backend does nothing if already ready or initializing. */
    retry: () => call("retry_runtime"),
  };
}

export const runtimeGateway = createRuntimeGateway(command => invoke<unknown>(command));
