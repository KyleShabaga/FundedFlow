// The JournalRepository port: every read and write of the local journal goes
// through this interface. It names only domain contracts, never a host type
// (no Tauri, SQLite or HTTP), so the desktop Tauri/SQLite adapter
// (apps/desktop/src/lib/data/tauri-repository.ts) and a later Stage 2 adapter
// can both implement it. See docs/data-model.md#repository-port.
//
// Adapters keep these rules:
// - Each write is one atomic unit: it validates, derives trading day and P&L,
//   and commits in a single transaction, or changes nothing.
// - Derived values (trading day, P&L, dedup keys) are computed by the
//   authoritative implementation (Rust in Stage 1), never by the caller.
// - Failures reject with a RepositoryError carrying an AppError.

import type { Account, AccountInput } from "../contracts/accounts.js";
import type {
  AccountHistory,
  AttemptSummary,
  DeletionPreview,
  ResetInput,
  ResetResult,
  StatusChangeInput,
} from "../contracts/account-lifecycle.js";
import type { CsvImportRequest, CsvPreview, ImportBatch, ImportRowRecord } from "../contracts/csv-import.js";
import type { AppError } from "../contracts/errors.js";
import type { JournalEntry, JournalEntryInput } from "../contracts/journal.js";
import type { Trade, TradeInput } from "../contracts/trades.js";
import type {
  AccountRulebookAssignment,
  ApplicableRulebook,
  ApplicableRulebookQuery,
  AssignmentInput,
  DraftIssue,
  RuleClaim,
  Rulebook,
  RulebookDraftInput,
  RulebookVersionDetail,
  SourceConflictInput,
} from "../rulebook/versions.js";

export interface AccountRepository {
  /**
   * Accounts that are not archived, whatever their status (failed, passed and
   * closed accounts stay listed for history). `includeArchived` adds archived ones.
   */
  list(options?: { includeArchived?: boolean }): Promise<Account[]>;
  /** One account, archived or not (read-only browsing). */
  get(id: string): Promise<Account>;
  /** Accounts that can trade now: active and not archived. The only accounts risk views may read. */
  listActive(): Promise<Account[]>;
  create(input: AccountInput): Promise<Account>;
  /** Replaces every editable field. A currency, timezone or reset change re-derives the account's trades. */
  update(id: string, input: AccountInput): Promise<Account>;
  /** Hidden and read-only; its trades, journal entries, imports and history are kept. Status is unchanged. */
  archive(id: string): Promise<void>;
  /**
   * Back to the lists with its status exactly as it was (a failed account stays
   * failed). Refused if it could trade and another live account holds its broker number.
   */
  restore(id: string): Promise<Account>;
  /** Mark failed, passed, closed, etc. with the user's effective time, cause and notes. Archives nothing. */
  changeStatus(id: string, input: StatusChangeInput): Promise<Account>;
  /** Status and archive history, oldest first. Readable for archived accounts. */
  history(id: string): Promise<AccountHistory>;
  /**
   * Start the next evaluation attempt as a NEW linked account (new id), in one
   * atomic step: the previous attempt's confirmed outcome, the new account and
   * the link are written together or not at all.
   */
  resetAttempt(input: ResetInput): Promise<ResetResult>;
  /** Every attempt in the account's chain, first attempt first, with per-attempt figures. */
  lineage(id: string): Promise<AttemptSummary[]>;
  /** What permanently deleting the account would remove and what blocks it. Read-only: no delete exists yet. */
  previewDeletion(id: string): Promise<DeletionPreview>;
}

export interface TradeRepository {
  /** Non-deleted trades of an account, newest entry first. */
  list(accountId: string): Promise<Trade[]>;
  create(input: TradeInput): Promise<Trade>;
  update(id: string, input: TradeInput): Promise<Trade>;
  /** Soft delete; unlinks journal entries. Re-importing its CSV row restores the same trade. */
  remove(id: string): Promise<void>;
}

export interface JournalEntryRepository {
  list(accountId: string): Promise<JournalEntry[]>;
  create(input: JournalEntryInput): Promise<JournalEntry>;
  update(id: string, input: JournalEntryInput): Promise<JournalEntry>;
  remove(id: string): Promise<void>;
}

export interface ImportRepository {
  /** Validate a file against a column mapping. Writes nothing. */
  preview(request: CsvImportRequest): Promise<CsvPreview>;
  /** Commit bundle: batch, every row, trade and round-trip source in one transaction, or a failed batch and nothing else. */
  commit(request: CsvImportRequest): Promise<ImportBatch>;
  list(accountId: string): Promise<ImportBatch[]>;
  /** Rows of an import that were not imported or carry warnings, with their original cells. */
  problemRows(batchId: string): Promise<ImportRowRecord[]>;
}

/**
 * Versioned rulebooks (Build 9.5). Publishing never rewrites an account's
 * assignments, and nothing switches an account to newer rules on its own.
 */
export interface RulebookRepository {
  /** Catalogue rulebooks, plus `accountId`'s private ones when given. */
  list(accountId: string | null): Promise<Rulebook[]>;
  /** Every version of a rulebook, newest first. */
  listVersions(rulebookId: string): Promise<RulebookVersionDetail[]>;
  getVersion(id: string): Promise<RulebookVersionDetail>;
  /** The verified version governing a phase or path; never guessed. */
  getApplicable(query: ApplicableRulebookQuery): Promise<ApplicableRulebook>;
  /** A new draft version, of an existing rulebook or a new one, with its rules and applicability. */
  createDraft(input: RulebookDraftInput): Promise<RulebookVersionDetail>;
  /** What stops the version from being published now; empty when nothing does. */
  validateDraft(id: string): Promise<DraftIssue[]>;
  /**
   * One publication step: a draft goes to `needs_review` (a private rulebook
   * is then in use); a catalogue version in review is verified by `reviewer`.
   */
  publish(id: string, reviewer: string | null): Promise<RulebookVersionDetail>;
  /** From a trading day; the account's open assignment ends that day. */
  assign(input: AssignmentInput): Promise<AccountRulebookAssignment>;
  listAssignments(accountId: string): Promise<AccountRulebookAssignment[]>;
  /** Records a contradicting source; a verified version it contradicts becomes stale. */
  flagSourceConflict(input: SourceConflictInput): Promise<RuleClaim>;
}

/** The local journal. Account snapshots (Build 15.5) join when their persistence lands. */
export interface JournalRepository {
  readonly accounts: AccountRepository;
  readonly trades: TradeRepository;
  readonly journal: JournalEntryRepository;
  readonly imports: ImportRepository;
  readonly rulebooks: RulebookRepository;
}

/** The one error type a JournalRepository rejects with. */
export class RepositoryError extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = "RepositoryError";
    this.error = error;
  }

  /** Field-level issues for validation errors, empty otherwise. */
  get issues() {
    return this.error.kind === "validation" ? this.error.issues : [];
  }
}
