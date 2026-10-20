// Tauri/SQLite adapter for the JournalRepository port (@fundedflow/domain),
// over the Rust commands in src-tauri/src/commands.rs. Inputs are validated
// with Zod before invoking (Rust validates again before writing); responses
// are parsed so a payload drift fails loudly. Command names and argument
// shapes are the IPC contract and must not change here.

import { z } from "zod";

import {
  type JournalRepository,
  RepositoryError,
  accountHistorySchema,
  accountInputSchema,
  attemptSummarySchema,
  deletionPreviewSchema,
  resetInputSchema,
  resetResultSchema,
  statusChangeInputSchema,
  accountRulebookAssignmentSchema,
  accountSchema,
  appErrorSchema,
  applicableRulebookQuerySchema,
  applicableRulebookSchema,
  assignmentInputSchema,
  draftIssueSchema,
  ruleClaimSchema,
  rulebookDraftInputSchema,
  rulebookSchema,
  rulebookVersionDetailSchema,
  sourceConflictInputSchema,
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
      list: (options) =>
        call("list_accounts", options?.includeArchived ? { includeArchived: true } : {}, z.array(accountSchema)),
      get: (id) => call("get_account", { id }, accountSchema),
      listActive: () => call("list_active_accounts", {}, z.array(accountSchema)),
      create: (input) => call("create_account", { input: validate(accountInputSchema, input) }, accountSchema),
      update: (id, input) => call("update_account", { id, input: validate(accountInputSchema, input) }, accountSchema),
      archive: (id) => done("archive_account", { id }),
      restore: (id) => call("restore_account", { id }, accountSchema),
      changeStatus: (id, input) =>
        call("change_account_status", { id, input: validate(statusChangeInputSchema, input) }, accountSchema),
      history: (id) => call("get_account_history", { id }, accountHistorySchema),
      resetAttempt: (input) =>
        call("reset_account_attempt", { input: validate(resetInputSchema, input) }, resetResultSchema),
      lineage: (id) => call("get_account_lineage", { id }, z.array(attemptSummarySchema)),
      previewDeletion: (id) => call("preview_account_deletion", { id }, deletionPreviewSchema),
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
    rulebooks: {
      list: (accountId) => call("list_rulebooks", { accountId }, z.array(rulebookSchema)),
      listVersions: (rulebookId) =>
        call("list_rulebook_versions", { rulebookId }, z.array(rulebookVersionDetailSchema)),
      getVersion: (id) => call("get_rulebook_version", { id }, rulebookVersionDetailSchema),
      getApplicable: (query) =>
        call("get_applicable_rulebook", { query: validate(applicableRulebookQuerySchema, query) }, applicableRulebookSchema),
      createDraft: (input) =>
        call("create_rulebook_draft", { input: validate(rulebookDraftInputSchema, input) }, rulebookVersionDetailSchema),
      validateDraft: (id) => call("validate_rulebook_draft", { id }, z.array(draftIssueSchema)),
      publish: (id, reviewer) => call("publish_rulebook_version", { id, reviewer }, rulebookVersionDetailSchema),
      assign: (input) =>
        call("assign_rulebook_to_account", { input: validate(assignmentInputSchema, input) }, accountRulebookAssignmentSchema),
      listAssignments: (accountId) =>
        call("list_account_rulebook_assignments", { accountId }, z.array(accountRulebookAssignmentSchema)),
      flagSourceConflict: (input) =>
        call("flag_rulebook_source_conflict", { input: validate(sourceConflictInputSchema, input) }, ruleClaimSchema),
    },
  };
}
