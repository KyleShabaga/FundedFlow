// TEST ONLY. The three seams the Build 26 cross-feature tests replace: the Tauri `invoke` bridge (runtime
// commands), the journal repository and the native file dialog. Everything above them (routes, providers,
// hooks, view models, components) is the real app. Test files wire these with vi.mock factories that import
// this module, so it must not import application code (types only).
import type { JournalRepository } from "@fundedflow/domain";
import type { LegalAcceptance } from "../lib/data/legal";
import type { RuntimeStatus } from "../lib/data/runtime";

export const SCHEMA = 18;
export const readyStatus: RuntimeStatus = { state: "ready", stage: "ready", schemaVersion: SCHEMA, supportedSchemaVersion: SCHEMA, created: false, failure: null };
export const initializingStatus: RuntimeStatus = { ...readyStatus, state: "initializing", stage: "migrate" };

type Answer = RuntimeStatus | Error | Promise<RuntimeStatus>;

/** Mutable boundary state, reset by `resetBoundaries()` before every test. */
export const boundary = {
  repository: null as unknown as JournalRepository,
  /** Every `runtime_status` answer; `retry_runtime` answers from `retryAnswers` first. Last answer repeats. */
  statusAnswers: [readyStatus] as Answer[],
  retryAnswers: [] as Answer[],
  /** Runs when `retry_runtime` is invoked: what the native runtime does on retry (e.g. install a staged restore). */
  onRetry: null as (() => void) | null,
  invocations: [] as string[],
  /** NA-3 per-install acceptance file: what `get_legal_acceptance` reads and `record_legal_acceptance` writes. */
  legal: { record: null as LegalAcceptance | null, writeError: null as Error | null, now: "2026-10-21T18:30:00.000Z" },
  /** P0-D06 `list_account_freshness` rows (the Rust read is tested in Rust); none by default, so dots are unknown. */
  freshness: [] as unknown[],
  /** Native save/open dialog answers: a path, null for Cancel, or an Error when the chooser can't open. */
  dialog: {
    save: [] as (string | null | Error)[],
    open: [] as (string | null | Error)[],
    calls: [] as { kind: "save" | "open"; options: unknown }[],
  },
};

export function resetBoundaries() {
  boundary.statusAnswers = [readyStatus];
  boundary.retryAnswers = [];
  boundary.onRetry = null;
  boundary.invocations = [];
  boundary.legal = { record: null, writeError: null, now: "2026-10-21T18:30:00.000Z" };
  boundary.dialog = { save: [], open: [], calls: [] };
  boundary.freshness = [];
}

const take = <T,>(queue: T[]): T | undefined => (queue.length > 1 ? queue.shift() : queue[0]);
async function answer(value: Answer | undefined): Promise<RuntimeStatus> {
  if (value === undefined) throw new Error("No runtime answer configured");
  if (value instanceof Error) throw value;
  return structuredClone(await value);
}

/** `@tauri-apps/api/core`: only the runtime, first-run acceptance and freshness commands go through invoke in these tests. */
export const tauriCoreMock = {
  invoke: async (command: string, args?: Record<string, unknown>) => {
    boundary.invocations.push(command);
    if (command === "get_legal_acceptance") return structuredClone(boundary.legal.record);
    if (command === "record_legal_acceptance") {
      if (boundary.legal.writeError) throw boundary.legal.writeError;
      boundary.legal.record = { documents: structuredClone(args?.documents) as LegalAcceptance["documents"], acceptedAt: boundary.legal.now };
      return structuredClone(boundary.legal.record);
    }
    if (command === "list_account_freshness") return structuredClone(boundary.freshness);
    if (command === "runtime_status") return answer(take(boundary.statusAnswers));
    if (command === "retry_runtime") {
      boundary.onRetry?.();
      return answer(boundary.retryAnswers.length ? boundary.retryAnswers.shift() : take(boundary.statusAnswers));
    }
    throw new Error(`Unexpected native command in a frontend test: ${command}`);
  },
};

/** `lib/data/api`: the repository port, backed by the test's in-memory store. */
export const apiMock = {
  get repository() { return boundary.repository; },
};

async function dialogAnswer(kind: "save" | "open", options: unknown) {
  boundary.dialog.calls.push({ kind, options: structuredClone(options) });
  const queue = boundary.dialog[kind];
  const next = queue.length ? queue.shift() : null;
  if (next instanceof Error) throw next;
  return next ?? null;
}

/** `@tauri-apps/plugin-dialog`: Cancel (null) unless the test queued a path. */
export const dialogPluginMock = {
  save: (options: unknown) => dialogAnswer("save", options),
  open: (options: unknown) => dialogAnswer("open", options),
};

/** A promise the test resolves or rejects itself (a native command still running). */
export function deferredFor<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
