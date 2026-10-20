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
import type { CsvImportRequest, CsvPreview, ImportBatch, ImportRowRecord } from "../contracts/csv-import.js";
import type { AppError } from "../contracts/errors.js";
import type { JournalEntry, JournalEntryInput } from "../contracts/journal.js";
import type { Trade, TradeInput } from "../contracts/trades.js";

export interface AccountRepository {
  /** Active (not archived) accounts. */
  list(): Promise<Account[]>;
  create(input: AccountInput): Promise<Account>;
  /** Replaces every editable field. A currency, timezone or reset change re-derives the account's trades. */
  update(id: string, input: AccountInput): Promise<Account>;
  /** Hidden and read-only; its trades, journal entries and imports are kept. */
  archive(id: string): Promise<void>;
}

export interface TradeRepository {
  /** Non-deleted trades of an account, newest entry first. */
  list(accountId: string): Promise<Trade[]>;
  create(input: TradeInput): Promise<Trade>;
  update(id: string, input: TradeInput): Promise<Trade>;
  /** Soft delete; unlinks journal entries. Re-importing the same CSV does not restore it. */
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
 * The local journal. Rulebooks (Build 9.5) and account snapshots (Build 15.5)
 * join as further members when their persistence lands.
 */
export interface JournalRepository {
  readonly accounts: AccountRepository;
  readonly trades: TradeRepository;
  readonly journal: JournalEntryRepository;
  readonly imports: ImportRepository;
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
