// Account lifecycle contracts (Build 15 / Build 10): failed-account retention,
// archive and restore, evaluation-reset attempts, lineage and the deletion
// preview. Field names and shapes match the serde structs in
// apps/desktop/src-tauri/src/store/accounts.rs and attempts.rs.
//
// Three things are kept apart on purpose:
//   - status (active, paused, passed, failed, closed): the account's result;
//   - archived: a visibility/retention flag, not a result;
//   - a prop-firm evaluation reset: a NEW linked account, which is not the
//     account's `tradingDayResetTime` (a session-day boundary).

import { z } from "zod";

import { accountRulebookAssignmentSchema } from "../rulebook/versions.js";
import { type Account, accountSchema, accountStatuses } from "./accounts.js";
import { decimal, optionalText } from "./fields.js";

// ---------------------------------------------------------------------------
// Status changes and history
// ---------------------------------------------------------------------------

export const statusChangeInputSchema = z.strictObject({
  status: z.enum(accountStatuses),
  /** When it took effect (ISO 8601 with offset). Defaults to now in Rust. */
  effectiveAt: z.iso.datetime({ offset: true }).nullish(),
  /** The user's own words; absent means unknown. Never inferred from losses. */
  cause: optionalText(500),
  /** Optional evidence or notes. */
  note: optionalText(20_000),
});
export type StatusChangeInput = z.input<typeof statusChangeInputSchema>;

export const accountHistorySchema = z.object({
  statusEvents: z.array(
    z.object({
      status: z.enum(accountStatuses),
      effectiveAt: z.string(),
      cause: z.string().nullable(),
      note: z.string().nullable(),
      recordedAt: z.string(),
    }),
  ),
  archiveEvents: z.array(z.object({ action: z.enum(["archived", "restored"]), occurredAt: z.string() })),
});
export type AccountHistory = z.infer<typeof accountHistorySchema>;

// ---------------------------------------------------------------------------
// Evaluation reset
// ---------------------------------------------------------------------------

export const priorOutcomes = ["passed", "failed", "closed"] as const;
export const resetSources = ["user_entered", "provider_email", "provider_dashboard", "other"] as const;

export const rulebookDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("assign"),
    rulebookVersionId: z.string().min(1),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a trading day as YYYY-MM-DD"),
    programmePhaseId: z.string().nullish(),
    phasePathId: z.string().nullish(),
  }),
  /** An explicit decision: no rulebook yet, so the attempt shows no rule meter. */
  z.strictObject({ kind: z.literal("decideLater") }),
]);
export type RulebookDecision = z.input<typeof rulebookDecisionSchema>;

export const resetInputSchema = z.strictObject({
  predecessorAccountId: z.string().min(1),
  /** The previous attempt's real outcome, confirmed by the user. Never defaulted to failed. */
  priorOutcome: z.enum(priorOutcomes),
  effectiveAt: z.iso.datetime({ offset: true, message: "Enter when the reset took effect" }),
  reason: optionalText(500),
  source: z.enum(resetSources),
  name: z.string().trim().min(1, "Required").max(100),
  /** The provider's number for the new attempt. It may equal the previous attempt's. */
  externalRef: optionalText(100),
  /** Required: a reset never carries the old balance over. */
  startingBalance: decimal.refine((v) => !v.startsWith("-") || Number(v) === 0, "Must be zero or positive"),
  catalogue: z
    .strictObject({
      programmeVariantId: z.string().nullish(),
      catalogueVersionId: z.string().nullish(),
      selectedPhasePathId: z.string().nullish(),
    })
    .nullish(),
  rulebook: rulebookDecisionSchema,
  notes: optionalText(20_000),
});
export type ResetInput = z.input<typeof resetInputSchema>;

export const attemptLinkSchema = z.object({
  predecessorAccountId: z.string(),
  successorAccountId: z.string(),
  priorOutcome: z.enum(priorOutcomes),
  effectiveAt: z.string(),
  reason: z.string().nullable(),
  source: z.enum(resetSources),
  rulebookDecision: z.enum(["assigned", "deferred"]),
  createdAt: z.string(),
});
export type AttemptLink = z.infer<typeof attemptLinkSchema>;

export const attemptSummarySchema = z.object({
  accountId: z.string(),
  attemptNumber: z.number().int().min(1),
  name: z.string(),
  status: z.enum(accountStatuses),
  archivedAt: z.string().nullable(),
  externalRef: z.string().nullable(),
  startingBalance: z.string(),
  createdAt: z.string(),
  resetToNext: attemptLinkSchema.nullable(),
  tradeCount: z.number().int(),
  firstTradingDay: z.string().nullable(),
  lastTradingDay: z.string().nullable(),
  importCount: z.number().int(),
  /** Sum of known net results only; null when none is known, never "0" for unknown. */
  netPnl: z.string().nullable(),
  tradesWithUnknownPnl: z.number().int(),
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

export const resetResultSchema = z.object({
  predecessor: accountSchema,
  successor: accountSchema,
  link: attemptLinkSchema,
  rulebookAssignment: accountRulebookAssignmentSchema.nullable(),
});
export type ResetResult = z.infer<typeof resetResultSchema>;

// ---------------------------------------------------------------------------
// Deletion preview (read-only; Build 24 owns permanent deletion)
// ---------------------------------------------------------------------------

export const deletionPreviewSchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  trades: z.number().int(),
  deletedTrades: z.number().int(),
  journalEntries: z.number().int(),
  importBatches: z.number().int(),
  statusEvents: z.number().int(),
  rulebookAssignments: z.number().int(),
  privateRulebooks: z.number().int(),
  snapshots: z.number().int(),
  ledgerEntries: z.number().int(),
  phaseEvents: z.number().int(),
  /** Other attempts of the same chain; deleting one attempt never deletes these. */
  linkedAttempts: z.array(z.string()),
  /** Why deletion is refused today. Empty would not mean it is possible. */
  blockers: z.array(z.string()),
});
export type DeletionPreview = z.infer<typeof deletionPreviewSchema>;

// ---------------------------------------------------------------------------
// Presentation rules shared by every screen
// ---------------------------------------------------------------------------

/** What the UI shows for an account: archived is shown alongside, never instead of, the result. */
export const statusLabels: Record<(typeof accountStatuses)[number], string> = {
  active: "Active",
  paused: "Paused",
  passed: "Passed",
  failed: "Failed",
  closed: "Closed",
};

/** Only an active, unarchived account can trade, so only it may appear in risk views (Today). */
export function isRiskEligible(account: Pick<Account, "status" | "archivedAt">): boolean {
  return account.status === "active" && !account.archivedAt;
}

export function selectRiskEligibleAccounts<A extends Pick<Account, "status" | "archivedAt">>(accounts: readonly A[]): A[] {
  return accounts.filter(isRiskEligible);
}

/** A historical account is not live: it must never imply it can continue trading. */
export function isHistorical(account: Pick<Account, "status" | "archivedAt">): boolean {
  return Boolean(account.archivedAt) || account.status === "passed" || account.status === "failed" || account.status === "closed";
}

export const accountFilters = ["live", "all", "active", "paused", "passed", "failed", "closed", "archived"] as const;
export type AccountFilter = (typeof accountFilters)[number];

export const accountFilterLabels: Record<AccountFilter, string> = {
  live: "Live",
  all: "All",
  active: "Active",
  paused: "Paused",
  passed: "Passed",
  failed: "Failed",
  closed: "Closed",
  archived: "Archived",
};

/**
 * History filters. `live` (the default) is active and paused accounts that are
 * not archived; `archived` is every archived account whatever its result; the
 * status filters exclude archived accounts so an account is never counted twice.
 */
export function filterAccounts<A extends Pick<Account, "status" | "archivedAt">>(
  accounts: readonly A[],
  filter: AccountFilter,
): A[] {
  switch (filter) {
    case "all":
      return [...accounts];
    case "live":
      return accounts.filter((a) => !a.archivedAt && (a.status === "active" || a.status === "paused"));
    case "archived":
      return accounts.filter((a) => Boolean(a.archivedAt));
    default:
      return accounts.filter((a) => !a.archivedAt && a.status === filter);
  }
}

export interface ImportTargetAssessment {
  /** The import must not go ahead. */
  blocked: string | null;
  /** Things the user must read and confirm before importing here. */
  confirmations: string[];
}

/**
 * @deprecated Date-only advisory; never authorizes an import. Use the native
 * CsvPreview.targetAssessment and its acknowledgement for exact boundaries.
 * `attempts` is the account's
 * lineage (empty when it has none); `tradingDays` are the file's trading days
 * (YYYY-MM-DD). Dates are compared to the reset's effective day in UTC, so a
 * file straddling the reset is flagged for the user to decide, never split.
 */
export function assessImportTarget(
  account: Pick<Account, "id" | "name" | "status" | "archivedAt">,
  attempts: readonly AttemptSummary[],
  tradingDays: readonly string[],
): ImportTargetAssessment {
  if (account.archivedAt) {
    return { blocked: `"${account.name}" is archived. Restore it first, or choose another account.`, confirmations: [] };
  }
  const confirmations: string[] = [];
  if (account.status !== "active") {
    confirmations.push(
      `"${account.name}" is ${statusLabels[account.status].toLowerCase()}, not an active attempt. Import only if these trades belong to it.`,
    );
  }
  const index = attempts.findIndex((a) => a.accountId === account.id);
  if (index >= 0 && tradingDays.length > 0) {
    const days = [...tradingDays].sort();
    const first = days[0] as string;
    const last = days[days.length - 1] as string;
    const endsOn = attempts[index]?.resetToNext?.effectiveAt.slice(0, 10);
    const startsOn = attempts[index - 1]?.resetToNext?.effectiveAt.slice(0, 10);
    if (endsOn && last > endsOn) {
      confirmations.push(
        `This attempt was reset on ${endsOn}, but the file has trades up to ${last}. Later trades usually belong to the next attempt.`,
      );
    }
    if (startsOn && first < startsOn) {
      confirmations.push(
        `This attempt started on ${startsOn}, but the file has trades from ${first}. Earlier trades usually belong to the previous attempt.`,
      );
    }
  }
  return { blocked: null, confirmations };
}
