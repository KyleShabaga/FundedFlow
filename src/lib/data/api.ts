// Typed data access over the Rust commands in src-tauri/src/commands.rs.
// Inputs are validated with Zod before invoking (Rust validates again before
// writing); responses are parsed so a payload drift fails loudly.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import {
  type AccountInput,
  type AppError,
  type CsvImportRequest,
  type JournalEntryInput,
  type TradeInput,
  accountInputSchema,
  accountSchema,
  appErrorSchema,
  csvImportRequestSchema,
  csvPreviewSchema,
  importBatchSchema,
  importRowRecordSchema,
  journalEntryInputSchema,
  journalEntrySchema,
  tradeInputSchema,
  tradeSchema,
} from "./schemas";

export class DataError extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = "DataError";
    this.error = error;
  }

  /** Field-level issues for validation errors, empty otherwise. */
  get issues() {
    return this.error.kind === "validation" ? this.error.issues : [];
  }
}

function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
  throw new DataError({
    kind: "validation",
    message: issues.length === 1 ? `${issues[0].field}: ${issues[0].message}` : `${issues.length} fields are invalid`,
    issues,
  });
}

async function call<S extends z.ZodType>(command: string, args: Record<string, unknown>, output: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await invoke(command, args);
  } catch (e) {
    const parsed = appErrorSchema.safeParse(e);
    throw new DataError(parsed.success ? parsed.data : { kind: "database", message: String(e) });
  }
  return output.parse(raw);
}

const done = z.null();

export const accountsApi = {
  list: () => call("list_accounts", {}, z.array(accountSchema)),
  create: (input: AccountInput) => call("create_account", { input: validate(accountInputSchema, input) }, accountSchema),
  update: (id: string, input: AccountInput) =>
    call("update_account", { id, input: validate(accountInputSchema, input) }, accountSchema),
  /** Permanently deletes the account with its trades, journal entries and imports. */
  remove: (id: string) => call("delete_account", { id }, done),
};

export const tradesApi = {
  list: (accountId: string) => call("list_trades", { accountId }, z.array(tradeSchema)),
  create: (input: TradeInput) => call("create_trade", { input: validate(tradeInputSchema, input) }, tradeSchema),
  update: (id: string, input: TradeInput) =>
    call("update_trade", { id, input: validate(tradeInputSchema, input) }, tradeSchema),
  /** Soft delete; unlinks journal entries. Re-importing the same CSV does not restore it. */
  remove: (id: string) => call("delete_trade", { id }, done),
};

export const journalApi = {
  list: (accountId: string) => call("list_journal_entries", { accountId }, z.array(journalEntrySchema)),
  create: (input: JournalEntryInput) =>
    call("create_journal_entry", { input: validate(journalEntryInputSchema, input) }, journalEntrySchema),
  update: (id: string, input: JournalEntryInput) =>
    call("update_journal_entry", { id, input: validate(journalEntryInputSchema, input) }, journalEntrySchema),
  remove: (id: string) => call("delete_journal_entry", { id }, done),
};

export const csvImportApi = {
  /** Validate a file against a column mapping. Writes nothing. */
  preview: (request: CsvImportRequest) =>
    call("preview_csv_import", { request: validate(csvImportRequestSchema, request) }, csvPreviewSchema),
  /** Import in one transaction; failures are recorded as a failed import and nothing is written. */
  commit: (request: CsvImportRequest) =>
    call("commit_csv_import", { request: validate(csvImportRequestSchema, request) }, importBatchSchema),
  list: (accountId: string) => call("list_csv_imports", { accountId }, z.array(importBatchSchema)),
  /** Rows of an import that were not imported, with their original cells and reasons. */
  problemRows: (batchId: string) =>
    call("list_csv_import_problem_rows", { batchId }, z.array(importRowRecordSchema)),
};
