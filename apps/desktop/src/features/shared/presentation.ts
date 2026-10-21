// The one mapping from Build 14 data facts to Build 13 presentation states.
// Screens pass a feature hook's result through these functions and render the
// design-system state components; they never interpret the flags themselves.
// Type-only imports: the data layer stays free of UI code at runtime.
import type { AsyncState, EmptyKind, MutationState, ValidationIssue } from "../../design-system";
import type { FeatureDataError } from "./errors";
import type { querySemantics } from "./hooks/use-feature-query";

type Semantics<T> = ReturnType<typeof querySemantics<T>>;
/** The query facts the mapping reads. A feature hook's result satisfies it. */
export type FeatureQueryView<T> = Pick<Semantics<T>, "data" | "error" | "queryError" | "runtimeKind" | "isInitialLoading" | "isRefreshing" | "isEmpty" | "observedAt">;

export interface AsyncStateOptions<T> {
  /** Which empty this is. Pass "no-matches" when filters are applied. Default "no-records". */
  emptyKind?: EmptyKind | ((data: T) => EmptyKind);
}

const UNSUPPORTED_SCHEMA_TITLE = "Journal needs a newer FundedFlow";

/**
 * Maps a feature query to AsyncState:
 * - runtime checking/recovering: loading (or refreshing over retained data);
 * - runtime unavailable: unavailable, or stale "offline" over retained data;
 * - unsupported schema: unavailable with update instructions;
 * - refresh failure over retained data: stale "refresh-failed";
 * - other failures: error (never empty); "unavailable"/"unsupported" categories: unavailable;
 * - a disabled query with nothing chosen (e.g. no account): empty "not-configured";
 * - TanStack "cache-age" staleness: success (local data changes only through invalidated writes).
 * Stale times are client receipt times, so they are marked asOfBasis "loaded". Success carries no asOf:
 * a receipt time is not a calculation time; screens pass a backend time (snapshot calculatedAt) themselves.
 */
export function toAsyncState<T>(query: FeatureQueryView<T>, options: AsyncStateOptions<T> = {}): AsyncState<T> {
  const { data, runtimeKind } = query;
  const asOf = query.observedAt;
  if (runtimeKind === "unsupported-schema") {
    return { status: "unavailable", title: UNSUPPORTED_SCHEMA_TITLE, reason: query.error?.message ?? "" };
  }
  if (runtimeKind === "checking" || runtimeKind === "recovering") {
    return data === undefined ? { status: "loading" } : { status: "refreshing", data };
  }
  if (runtimeKind !== "ready") {
    return data === undefined
      ? { status: "unavailable", reason: query.error?.message ?? "" }
      : { status: "stale", data, asOf, cause: "offline", asOfBasis: "loaded" };
  }
  if (data !== undefined && query.queryError) return { status: "stale", data, asOf, cause: "refresh-failed", asOfBasis: "loaded" };
  if (query.error) {
    const category = query.error.category;
    if (category === "unavailable") return { status: "unavailable", reason: query.error.message };
    if (category === "unsupported") return { status: "unavailable", title: "Not supported yet", reason: query.error.message };
    return { status: "error", error: { message: query.error.message } };
  }
  if (data === undefined) return query.isInitialLoading ? { status: "loading" } : { status: "empty", kind: "not-configured" };
  if (query.isEmpty) {
    const kind = typeof options.emptyKind === "function" ? options.emptyKind(data) : (options.emptyKind ?? "no-records");
    return { status: "empty", kind };
  }
  return query.isRefreshing ? { status: "refreshing", data } : { status: "success", data };
}

/** A read refresh for retry buttons: never leaves an unhandled rejection (the hook's state shows the failure). */
export function retryRead(refresh: () => Promise<void>): () => void {
  return () => {
    void refresh().catch(() => {});
  };
}

/** The mutation facts the mapping reads. A feature mutation hook's result satisfies it. */
export interface FeatureMutationView<Output> {
  outcome: "idle" | "submitting" | "failed" | "confirmed-failure" | "confirmed-success" | "uncertain-outcome";
  error: FeatureDataError | null;
  data: Output | undefined;
}

export interface MutationStateOptions<Output> {
  /** Shown on confirmed success ("Account saved."). */
  success: string | ((data: Output) => string);
  /** Shown when the write completed but recorded a failure (a failed import batch). */
  confirmedFailure?: string | ((data: Output) => string);
  /** DOM id of the control for a field path, so the summary links to it. */
  fieldId?: (field: string) => string | undefined;
  /** Visible label of a field, used to complete field-relative messages ("Quantity must be greater than zero"). */
  fieldLabel?: (field: string) => string | undefined;
}

// Failures where the data layer knows the write was refused before it changed anything.
const NOTHING_CHANGED = new Set(["validation", "not-found", "conflict", "unavailable", "unsupported-schema", "unsupported", "duplicate-submission", "cancelled"]);

/** Field message as a sentence: a field-relative fragment gets the field's label in front. */
export function issueSentence(field: string, message: string, label?: string): string {
  const startsLower = /^[a-z]/.test(message);
  if (!startsLower) return message;
  return `${label ?? field} ${message}`;
}

/** Field path → message, for each control's `error` prop. The first message per field wins. */
export function fieldErrors(error: FeatureDataError | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (error?.category !== "validation") return out;
  // Under a labelled control a fragment reads as its own sentence: "Must be greater than zero".
  for (const issue of error.issues) if (!(issue.field in out)) out[issue.field] = issue.message.charAt(0).toUpperCase() + issue.message.slice(1);
  return out;
}

/**
 * Maps a feature mutation to MutationState. Uncertain outcomes stay uncertain (the screen offers a check and,
 * after review, the hook's acknowledgeUncertainOutcome); a failure offers Retry only when nothing changed.
 */
export function toMutationState<Output>(mutation: FeatureMutationView<Output>, options: MutationStateOptions<Output>): MutationState {
  switch (mutation.outcome) {
    case "idle":
      return { status: "idle" };
    case "submitting":
      return { status: "submitting" };
    case "uncertain-outcome":
      return { status: "uncertain" };
    case "confirmed-success": {
      const message = typeof options.success === "function" ? options.success(mutation.data as Output) : options.success;
      return { status: "success", message };
    }
    case "confirmed-failure": {
      const text = options.confirmedFailure;
      const message = typeof text === "function" ? text(mutation.data as Output) : (text ?? "It did not complete.");
      return { status: "failed", message, nothingChanged: false };
    }
    case "failed": {
      const error = mutation.error;
      if (error?.category === "validation") {
        const issues: ValidationIssue[] = error.issues.map(issue => ({
          fieldId: options.fieldId?.(issue.field),
          message: issueSentence(issue.field, issue.message, options.fieldLabel?.(issue.field)),
        }));
        return issues.length ? { status: "validation-error", issues } : { status: "failed", message: error.message, nothingChanged: true };
      }
      return { status: "failed", message: error?.message ?? "The change could not be completed.", nothingChanged: error ? NOTHING_CHANGED.has(error.category) : false };
    }
  }
}
