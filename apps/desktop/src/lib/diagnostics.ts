// Build 26.5: a copyable diagnostic summary for runtime and render failures. Allowlisted fields only: it is
// built from typed, known-safe values and never from error text, so raw exception messages and stacks, SQL,
// absolute paths, file names, account names or ids, trade or journal content and secrets cannot reach it.
// Unknown values stay "unknown". Nothing is sent anywhere: the trader copies it themselves.
import { version as appVersion } from "../../package.json";
import type { RuntimeState } from "../app/RuntimeProvider";
import { failureCategories, runtimeStages, type RuntimeGatewayErrorKind } from "./data/runtime";

export const APP_VERSION: string = appVersion;

/** Top-level sections a route may be reported as. Never the full path (it can hold account or trade ids). */
const SECTIONS = ["today", "journal", "insights", "accounts", "settings", "import"] as const;
type Section = (typeof SECTIONS)[number] | "unknown";
/** Built-in error constructors. Anything else (a custom or library error) is reported as "Error". */
const ERROR_NAMES = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"] as const;
const GATEWAY_KINDS: readonly RuntimeGatewayErrorKind[] = ["timeout", "rejected", "invalid-response", "pending"];
const UNAVAILABLE_REASONS = [...GATEWAY_KINDS, "runtime-failed", "initialization-pending"] as const;
const RUNTIME_KINDS = ["checking", "recovering", "ready", "unavailable", "unsupported-schema"] as const;

const UNKNOWN = "unknown";

export interface DiagnosticSummary {
  incidentId: string;
  occurredAt: string;
  appVersion: string;
  surface: "runtime" | "render";
  /** Stable code: runtime failure category, gateway kind or render error class. */
  code: string;
  runtimeState: string;
  stage: string;
  schemaVersion: string;
  supportedSchemaVersion: string;
  failedMigration: string;
  retryable: string;
  section: Section;
}

/** An opaque id for one incident: random, never derived from data. Shown and copied unchanged. */
export function newIncidentId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `FF-${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | typeof UNKNOWN =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : UNKNOWN;
const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : UNKNOWN);

export function sectionOf(hashOrPath: string): Section {
  const first = hashOrPath.replace(/^#/, "").replace(/^\//, "").split(/[/?#]/)[0]?.toLowerCase() ?? "";
  return first === "" ? "today" : pick(first, SECTIONS) === UNKNOWN ? "unknown" : (first as Section);
}

/** Summary of the runtime's current state. */
export function runtimeDiagnostics(state: RuntimeState, incidentId: string, occurredAt: Date, path: string): DiagnosticSummary {
  const status = state.status ?? null;
  const failure = status?.failure ?? null;
  const migration = failure?.failedMigration ?? null;
  const reason = state.kind === "unavailable" ? pick(state.reason, UNAVAILABLE_REASONS) : null;
  return {
    incidentId,
    occurredAt: occurredAt.toISOString(),
    appVersion: APP_VERSION,
    surface: "runtime",
    code: failure ? pick(failure.category, failureCategories) : reason ?? (state.kind === "unsupported-schema" ? "newer_schema" : UNKNOWN),
    runtimeState: pick(state.kind, RUNTIME_KINDS),
    stage: pick(status?.stage, runtimeStages),
    schemaVersion: count(status?.schemaVersion),
    supportedSchemaVersion: count(status?.supportedSchemaVersion),
    failedMigration: migration ? `step ${count(migration.version)} (from ${count(migration.fromVersion)}, reached ${count(migration.reachedVersion)})` : UNKNOWN,
    retryable: failure ? String(failure.retryable === true) : UNKNOWN,
    section: sectionOf(path),
  };
}

/** Summary of a render failure. Only the built-in error class is kept; its message and stack never are. */
export function renderDiagnostics(error: unknown, incidentId: string, occurredAt: Date, path: string): DiagnosticSummary {
  const name = error instanceof Error ? pick(error.constructor?.name ?? error.name, ERROR_NAMES) : UNKNOWN;
  return {
    incidentId,
    occurredAt: occurredAt.toISOString(),
    appVersion: APP_VERSION,
    surface: "render",
    code: `render_${name === UNKNOWN ? "Error" : name}`,
    runtimeState: UNKNOWN,
    stage: UNKNOWN,
    schemaVersion: UNKNOWN,
    supportedSchemaVersion: UNKNOWN,
    failedMigration: UNKNOWN,
    retryable: UNKNOWN,
    section: sectionOf(path),
  };
}

const LABELS: [keyof DiagnosticSummary, string][] = [
  ["incidentId", "Incident"],
  ["occurredAt", "Time (UTC)"],
  ["appVersion", "FundedFlow version"],
  ["surface", "Where"],
  ["code", "Code"],
  ["runtimeState", "Local data state"],
  ["stage", "Stage"],
  ["schemaVersion", "Journal version"],
  ["supportedSchemaVersion", "Supported journal version"],
  ["failedMigration", "Failed upgrade step"],
  ["retryable", "Retry allowed"],
  ["section", "Screen"],
];

/** Plain text for the clipboard and the on-screen copy. */
export function formatDiagnostics(summary: DiagnosticSummary): string {
  return [
    "FundedFlow diagnostic summary",
    ...LABELS.map(([key, label]) => `${label}: ${summary[key]}`),
    "Contains no trades, notes, account names, file paths or error text.",
  ].join("\n");
}
