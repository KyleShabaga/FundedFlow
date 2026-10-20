import { RepositoryError } from "@fundedflow/domain";
import { z } from "zod";

export type DataErrorCategory = "validation" | "not-found" | "conflict" | "unavailable" | "unsupported-schema" |
  "unsupported" | "invalid-response" | "unexpected" | "cancelled" | "timeout" | "duplicate-submission" | "uncertain-outcome";
const messages: Record<DataErrorCategory, string> = {
  validation: "Check the highlighted input fields.", "not-found": "This record is no longer available.",
  conflict: "This change conflicts with an existing record. Refresh and review before trying again.",
  unavailable: "Local data is unavailable. Use the shell recovery controls.",
  "unsupported-schema": "This journal requires a newer FundedFlow version.", unsupported: "This operation is not supported yet.",
  "invalid-response": "The saved data response could not be validated.", unexpected: "The data request could not be completed.",
  cancelled: "The data request was cancelled.", timeout: "The data request did not answer in time.",
  "duplicate-submission": "An operation for this record is already pending.",
  "uncertain-outcome": "The change may have been saved. Refresh and check the records before submitting again.",
};
export class FeatureDataError extends Error {
  readonly diagnosticReference: string | null = null; // The current AppError contract supplies no correlation ID.
  constructor(readonly category: DataErrorCategory, readonly backendKind: string | null = null,
    readonly issues: readonly { field: string; message: string }[] = []) {
    super(messages[category]);
    this.name = "FeatureDataError";
  }
}
export function normalizeError(error: unknown, write = false): FeatureDataError {
  if (error instanceof FeatureDataError) return error;
  if (error instanceof RepositoryError) {
    const kind = error.error.kind;
    const category = { validation: "validation", notFound: "not-found", conflict: "conflict", unavailable: "unavailable", database: write ? "uncertain-outcome" : "unexpected" } as const;
    const issues = error.issues.map(issue => ({
      field: /^[a-zA-Z][a-zA-Z0-9_.\[\]]{0,100}$/.test(issue.field) ? issue.field : "input",
      message: safeIssueMessage(issue.message),
    }));
    return new FeatureDataError(category[kind], kind, issues);
  }
  if (write) return new FeatureDataError("uncertain-outcome");
  return new FeatureDataError(error instanceof z.ZodError ? "invalid-response" : "unexpected");
}
export function validateInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new FeatureDataError("validation", null, result.error.issues.map(issue => ({ field: issue.path.join("."), message: zodIssueMessage(issue) })));
}
export const GENERIC_ISSUE_MESSAGE = "Check this value.";
// Paths, SQL, Rust sources, stack traces and multi-line text never reach the UI.
const UNSAFE_MESSAGE = /[\\]|\/\w+\/|\b(sql|sqlite|select\s|insert\s|panicked|stack trace)\b|\.rs\b|[\r\n]/i;
/**
 * A field message safe to show: the backend's or schema's own text when it is short, single-line and free of
 * internals; otherwise a generic prompt. Messages may be relative to the field ("must be greater than zero").
 */
export function safeIssueMessage(message: unknown): string {
  if (typeof message !== "string") return GENERIC_ISSUE_MESSAGE;
  const text = message.trim();
  if (!text || text.length > 200 || UNSAFE_MESSAGE.test(text)) return GENERIC_ISSUE_MESSAGE;
  return text;
}
/** Frontend schemas are ours, so their custom messages are actionable; Zod's type-mismatch text is replaced. */
function zodIssueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type") return /received (undefined|null)/.test(issue.message) ? "Required" : "Enter a valid value";
  return safeIssueMessage(issue.message);
}
