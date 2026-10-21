// Tauri/SQLite adapter for the JournalRepository port (@fundedflow/domain),
// over the Rust commands in src-tauri/src/commands.rs. Inputs are validated
// with Zod before invoking (Rust validates again before writing); responses
// are parsed so a payload drift fails loudly. Command names and argument
// shapes are the IPC contract and must not change here.

import { z } from "zod";

import {
  accountRiskInputsSchema, riskInputsQuerySchema, observationInputSchema, observationSchema, observationCorrectionSchema,
  ledgerRevisionSchema, correctionMetadataSchema, reconciliationRequestSchema, reconciliationSchema,
  reconciliationResolutionSchema, reconciliationResolutionInputSchema,
  type JournalRepository,
  RepositoryError,
  accountHistorySchema,
  accountLinkInputSchema,
  catalogueDraftInputSchema,
  offerSelectionInputSchema,
  offerSelectionSchema,
  sourceInputSchema,
  sourceReferenceSchema,
  accountCatalogueLinkSchema,
  accountPhaseEventSchema,
  catalogueSnapshotSchema,
  catalogueVersionSchema,
  ledgerEntryInputSchema,
  ledgerEntrySchema,
  phaseEventInputSchema,
  settingKey,
  settingSchema,
  snapshotInputSchema,
  snapshotSchema,
  accountInputSchema,
  attemptSummarySchema,
  deletionPreviewSchema,
  resetInputSchema,
  resetResultSchema,
  statusChangeInputSchema,
  accountRulebookAssignmentSchema,
  assignmentGuardSchema,
  changeContextSchema,
  rulebookDraftUpdateSchema,
  rulebookEventQuerySchema,
  rulebookEventSchema,
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
  archiveInputSchema,
  attachmentMetaSchema,
  checklistInputSchema,
  checklistSchema,
  deletedTradeSchema,
  librarySchema,
  reviewInputSchema,
  reviewSummarySchema,
  screenshotDataSchema,
  screenshotInputSchema,
  strategyInputSchema,
  strategySchema,
  tagInputSchema,
  tagSchema,
  tradeChangeOptionsSchema,
  tradeDetailSchema,
  tradeReviewSchema,
  dailyReviewDaySchema,
  dailyReviewIndexSchema,
  dailyReviewInputSchema,
  dailyReviewRefSchema,
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
    evidence: {
      inputs: (query) => call("get_account_risk_inputs", { query: validate(riskInputsQuerySchema, query) }, accountRiskInputsSchema),
      create: (input) => call("create_financial_observation", { input: validate(observationInputSchema, input) }, observationSchema),
      get: (id) => call("get_financial_observation", { id }, observationSchema),
      list: (accountId) => call("list_financial_observations", { accountId }, z.array(observationSchema)),
      correct: (id, input) => call("correct_financial_observation", { id, input: validate(observationCorrectionSchema, input) }, observationSchema),
      ledgerHistory: (accountId) => call("get_ledger_history", { accountId }, z.array(ledgerRevisionSchema)),
      correctLedger: (id, input, metadata) => call("correct_ledger_entry", { id, input: validate(ledgerEntryInputSchema, input), metadata: validate(correctionMetadataSchema, metadata) }, ledgerEntrySchema),
      removeLedger: (id, metadata) => done("remove_ledger_entry_with_reason", { id, metadata: validate(correctionMetadataSchema, metadata) }),
      reconcile: (request) => call("reconcile_financial_balance", { request: validate(reconciliationRequestSchema, request) }, reconciliationSchema),
      reconciliations: (accountId) => call("list_financial_reconciliations", { accountId }, z.array(reconciliationSchema)),
      resolve: (id, input) => call("resolve_financial_reconciliation", { id, input: validate(reconciliationResolutionInputSchema, input) }, reconciliationResolutionSchema),
      resolutions: (id) => call("list_reconciliation_resolutions", { id }, z.array(reconciliationResolutionSchema)),
    },
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
      update: (id, input, options) =>
        call(
          "update_trade",
          { id, input: validate(tradeInputSchema, input), ...(options ? { options: validate(tradeChangeOptionsSchema, options) } : {}) },
          tradeSchema,
        ),
      remove: (id, reason) => done("delete_trade", reason ? { id, reason } : { id }),
      restore: (accountId, id, reason) => call("restore_trade", { accountId, id, reason: reason ?? null }, tradeSchema),
      listDeleted: (accountId) => call("list_deleted_trades", { accountId }, z.array(deletedTradeSchema)),
      detail: (accountId, id) => call("get_trade_detail", { accountId, id }, tradeDetailSchema),
    },
    reviews: {
      get: (accountId, tradeId) => call("get_trade_review", { accountId, tradeId }, tradeReviewSchema.nullable()),
      save: (input) => call("save_trade_review", { input: validate(reviewInputSchema, input) }, tradeReviewSchema),
      summaries: (accountId) => call("list_trade_review_summaries", { accountId }, z.array(reviewSummarySchema)),
      addScreenshot: (input) =>
        call("add_trade_screenshot", { input: validate(screenshotInputSchema, input) }, attachmentMetaSchema),
      readScreenshot: (accountId, id) => call("read_trade_screenshot", { accountId, id }, screenshotDataSchema),
      removeScreenshot: (accountId, id) => done("remove_trade_screenshot", { accountId, id }),
    },
    dailyReviews: {
      getDay: (accountId, tradingDay) => call("get_daily_review", { accountId, tradingDay }, dailyReviewDaySchema),
      list: (accountId) => call("list_daily_reviews", { accountId }, dailyReviewIndexSchema),
      save: (input) => call("save_daily_review", { input: validate(dailyReviewInputSchema, input) }, dailyReviewDaySchema),
      reopen: (ref) => call("reopen_daily_review", { input: validate(dailyReviewRefSchema, ref) }, dailyReviewDaySchema),
      relinkTrades: (ref) => call("relink_daily_review_trades", { input: validate(dailyReviewRefSchema, ref) }, dailyReviewDaySchema),
    },
    library: {
      load: () => call("get_review_library", {}, librarySchema),
      saveStrategy: (id, input) => call("save_strategy", { id, input: validate(strategyInputSchema, input) }, strategySchema),
      saveTag: (id, input) => call("save_tag", { id, input: validate(tagInputSchema, input) }, tagSchema),
      saveChecklist: (id, input) =>
        call("save_checklist", { id, input: validate(checklistInputSchema, input) }, checklistSchema),
      setArchived: (input) => done("set_library_archived", { input: validate(archiveInputSchema, input) }),
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
    ledger: {
      list: (accountId) => call("list_ledger_entries", { accountId }, z.array(ledgerEntrySchema)),
      create: (input) => call("create_ledger_entry", { input: validate(ledgerEntryInputSchema, input) }, ledgerEntrySchema),
      update: (id, input) =>
        call("update_ledger_entry", { id, input: validate(ledgerEntryInputSchema, input) }, ledgerEntrySchema),
      remove: (id) => done("delete_ledger_entry", { id }),
      balanceAdjustment: (accountId) => call("get_ledger_balance_adjustment", { accountId }, z.string()),
    },
    settings: {
      get: (key) => call("get_setting", { key: validate(settingKey, key) }, settingSchema.nullable()),
      list: () => call("list_settings", {}, z.array(settingSchema)),
      set: (key, value) => call("set_setting", { key: validate(settingKey, key), value }, settingSchema),
      remove: (key) => done("remove_setting", { key: validate(settingKey, key) }),
    },
    snapshots: {
      save: (input) => call("save_account_snapshot", { input: validate(snapshotInputSchema, input) }, snapshotSchema),
      list: (accountId, query) =>
        call(
          "list_account_snapshots",
          { accountId, from: query?.from ?? null, to: query?.to ?? null, endOfDayOnly: query?.endOfDayOnly ?? false },
          z.array(snapshotSchema),
        ),
      latest: (accountId) => call("get_latest_account_snapshot", { accountId }, snapshotSchema.nullable()),
    },
    catalogue: {
      load: () => call("get_catalogue", {}, catalogueSnapshotSchema),
      transitionVersion: (id, to, reviewer) =>
        call("transition_catalogue_version", { id, to, reviewer }, catalogueVersionSchema),
      getAccountLink: (accountId) => call("get_account_catalogue_link", { accountId }, accountCatalogueLinkSchema),
      setAccountLink: (input) =>
        call("set_account_catalogue_link", { input: validate(accountLinkInputSchema, input) }, accountCatalogueLinkSchema),
      listPhaseEvents: (accountId) =>
        call("list_account_phase_events", { accountId }, z.array(accountPhaseEventSchema)),
      recordPhaseEvent: (input) =>
        call("record_account_phase_event", { input: validate(phaseEventInputSchema, input) }, accountPhaseEventSchema),
      createSource: (input) =>
        call("create_catalogue_source", { input: validate(sourceInputSchema, input) }, sourceReferenceSchema),
      createDraft: (input) =>
        call("create_catalogue_draft", { input: validate(catalogueDraftInputSchema, input) }, catalogueVersionSchema),
      replaceDraft: (id, input) =>
        call("replace_catalogue_draft", { id, input: validate(catalogueDraftInputSchema, input) }, catalogueVersionSchema),
      selectOffer: (input) =>
        call("select_account_offer", { input: validate(offerSelectionInputSchema, input) }, offerSelectionSchema),
      listOfferSelections: (accountId) =>
        call("list_account_offer_selections", { accountId }, z.array(offerSelectionSchema)),
    },
    rulebooks: {
      list: (accountId) => call("list_rulebooks", { accountId }, z.array(rulebookSchema)),
      listVersions: (rulebookId) =>
        call("list_rulebook_versions", { rulebookId }, z.array(rulebookVersionDetailSchema)),
      getVersion: (id) => call("get_rulebook_version", { id }, rulebookVersionDetailSchema),
      getApplicable: (query) =>
        call("get_applicable_rulebook", { query: validate(applicableRulebookQuerySchema, query) }, applicableRulebookSchema),
      createDraft: (input, context) =>
        call(
          "create_rulebook_draft",
          { input: validate(rulebookDraftInputSchema, input), ...(context ? { context: validate(changeContextSchema, context) } : {}) },
          rulebookVersionDetailSchema,
        ),
      updateDraft: (id, expectedUpdatedAt, input, context) =>
        call(
          "update_rulebook_draft",
          { id, expectedUpdatedAt, input: validate(rulebookDraftUpdateSchema, input), context: validate(changeContextSchema, context) },
          rulebookVersionDetailSchema,
        ),
      discardDraft: (id, expectedUpdatedAt, context) =>
        call("discard_rulebook_draft", { id, expectedUpdatedAt, context: validate(changeContextSchema, context) }, rulebookVersionDetailSchema),
      listEvents: (query) =>
        call("list_rulebook_events", { query: validate(rulebookEventQuerySchema, query) }, z.array(rulebookEventSchema)),
      validateDraft: (id) => call("validate_rulebook_draft", { id }, z.array(draftIssueSchema)),
      publish: (id, reviewer, options) =>
        call(
          "publish_rulebook_version",
          options
            ? { id, reviewer, expectedUpdatedAt: options.expectedUpdatedAt, context: validate(changeContextSchema, options.context) }
            : { id, reviewer },
          rulebookVersionDetailSchema,
        ),
      assign: (input, guard) =>
        call(
          "assign_rulebook_to_account",
          { input: validate(assignmentInputSchema, input), ...(guard ? { guard: validate(assignmentGuardSchema, guard) } : {}) },
          accountRulebookAssignmentSchema,
        ),
      listAssignments: (accountId) =>
        call("list_account_rulebook_assignments", { accountId }, z.array(accountRulebookAssignmentSchema)),
      flagSourceConflict: (input) =>
        call("flag_rulebook_source_conflict", { input: validate(sourceConflictInputSchema, input) }, ruleClaimSchema),
    },
  };
}
