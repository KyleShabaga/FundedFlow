// Tauri/SQLite adapter for the JournalRepository port (@fundedflow/domain),
// over the Rust commands in src-tauri/src/commands.rs. Inputs are validated
// with Zod before invoking (Rust validates again before writing); responses
// are parsed so a payload drift fails loudly. Command names and argument
// shapes are the IPC contract and must not change here.

import { z } from "zod";

import {
  type JournalRepository,
  RepositoryError,
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

/** The shape of Tauri's `invoke`, injected so the adapter can be tested without a webview. */
export type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
  throw new RepositoryError({
    kind: "validation",
    message: issues.length === 1 ? `${issues[0].field}: ${issues[0].message}` : `${issues.length} fields are invalid`,
    issues,
  });
}

export function createTauriRepository(invoke: Invoke): JournalRepository {
  async function call<S extends z.ZodType>(command: string, args: Record<string, unknown>, output: S): Promise<z.output<S>> {
    let raw: unknown;
    try {
      raw = await invoke(command, args);
    } catch (e) {
      const parsed = appErrorSchema.safeParse(e);
      throw new RepositoryError(parsed.success ? parsed.data : { kind: "database", message: String(e) });
    }
    return output.parse(raw);
  }

  const done = (command: string, args: Record<string, unknown>) => call(command, args, z.null()).then(() => undefined);

  return {
    accounts: {
      list: () => call("list_accounts", {}, z.array(accountSchema)),
      create: (input) => call("create_account", { input: validate(accountInputSchema, input) }, accountSchema),
      update: (id, input) => call("update_account", { id, input: validate(accountInputSchema, input) }, accountSchema),
      archive: (id) => done("archive_account", { id }),
    },
    trades: {
      list: (accountId) => call("list_trades", { accountId }, z.array(tradeSchema)),
      create: (input) => call("create_trade", { input: validate(tradeInputSchema, input) }, tradeSchema),
      update: (id, input) => call("update_trade", { id, input: validate(tradeInputSchema, input) }, tradeSchema),
      remove: (id) => done("delete_trade", { id }),
    },
    journal: {
      list: (accountId) => call("list_journal_entries", { accountId }, z.array(journalEntrySchema)),
      create: (input) =>
        call("create_journal_entry", { input: validate(journalEntryInputSchema, input) }, journalEntrySchema),
      update: (id, input) =>
        call("update_journal_entry", { id, input: validate(journalEntryInputSchema, input) }, journalEntrySchema),
      remove: (id) => done("delete_journal_entry", { id }),
    },
    imports: {
      preview: (request) =>
        call("preview_csv_import", { request: validate(csvImportRequestSchema, request) }, csvPreviewSchema),
      commit: (request) =>
        call("commit_csv_import", { request: validate(csvImportRequestSchema, request) }, importBatchSchema),
      list: (accountId) => call("list_csv_imports", { accountId }, z.array(importBatchSchema)),
      problemRows: (batchId) => call("list_csv_import_problem_rows", { batchId }, z.array(importRowRecordSchema)),
    },
  };
}
