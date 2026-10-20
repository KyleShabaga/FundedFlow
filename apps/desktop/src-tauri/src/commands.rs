//! Tauri commands: thin wrappers that hand typed payloads to the store and
//! CSV import layers, which validate before writing. Mirrored by
//! `src/lib/data/api.ts`.
//!
//! Commands are `async` so database work runs off the main (UI) thread.

use tauri::{AppHandle, Manager, State};

use crate::csv_import::{self, CsvImportRequest, CsvPreview, ImportBatch, ImportRowRecord};
use crate::error::AppResult;
use crate::store::accounts::{self, Account, AccountInput};
use crate::error::FieldIssue;
use crate::rulebook::{
    AccountRulebookAssignment, ApplicableRulebook, ApplicableRulebookQuery, AssignmentInput, RuleClaim, Rulebook,
    RulebookDraftInput, RulebookVersionDetail, SourceConflictInput,
};
use crate::store::journal::{self, JournalEntry, JournalEntryInput};
use crate::store::rulebooks;
use crate::store::trades::{self, Trade, TradeInput};
use crate::runtime::{Runtime, RuntimeStatus};

#[tauri::command]
pub async fn list_accounts(db: State<'_, Runtime>) -> AppResult<Vec<Account>> {
    db.with(|c| accounts::list(c))
}

#[tauri::command]
pub async fn create_account(db: State<'_, Runtime>, input: AccountInput) -> AppResult<Account> {
    db.with(|c| accounts::create(c, input))
}

#[tauri::command]
pub async fn update_account(db: State<'_, Runtime>, id: String, input: AccountInput) -> AppResult<Account> {
    db.with(|c| accounts::update(c, &id, input))
}

#[tauri::command]
pub async fn archive_account(db: State<'_, Runtime>, id: String) -> AppResult<()> {
    db.with(|c| accounts::archive(c, &id))
}

#[tauri::command]
pub async fn list_trades(db: State<'_, Runtime>, account_id: String) -> AppResult<Vec<Trade>> {
    db.with(|c| trades::list(c, &account_id))
}

#[tauri::command]
pub async fn create_trade(db: State<'_, Runtime>, input: TradeInput) -> AppResult<Trade> {
    db.with(|c| trades::create(c, input))
}

#[tauri::command]
pub async fn update_trade(db: State<'_, Runtime>, id: String, input: TradeInput) -> AppResult<Trade> {
    db.with(|c| trades::update(c, &id, input))
}

#[tauri::command]
pub async fn delete_trade(db: State<'_, Runtime>, id: String) -> AppResult<()> {
    db.with(|c| trades::delete(c, &id))
}

#[tauri::command]
pub async fn list_journal_entries(db: State<'_, Runtime>, account_id: String) -> AppResult<Vec<JournalEntry>> {
    db.with(|c| journal::list(c, &account_id))
}

#[tauri::command]
pub async fn create_journal_entry(db: State<'_, Runtime>, input: JournalEntryInput) -> AppResult<JournalEntry> {
    db.with(|c| journal::create(c, input))
}

#[tauri::command]
pub async fn update_journal_entry(db: State<'_, Runtime>, id: String, input: JournalEntryInput) -> AppResult<JournalEntry> {
    db.with(|c| journal::update(c, &id, input))
}

#[tauri::command]
pub async fn delete_journal_entry(db: State<'_, Runtime>, id: String) -> AppResult<()> {
    db.with(|c| journal::delete(c, &id))
}

#[tauri::command]
pub async fn preview_csv_import(db: State<'_, Runtime>, request: CsvImportRequest) -> AppResult<CsvPreview> {
    db.with(|c| csv_import::preview(c, &request))
}

#[tauri::command]
pub async fn commit_csv_import(db: State<'_, Runtime>, request: CsvImportRequest) -> AppResult<ImportBatch> {
    db.with(|c| csv_import::commit(c, &request))
}

#[tauri::command]
pub async fn list_csv_imports(db: State<'_, Runtime>, account_id: String) -> AppResult<Vec<ImportBatch>> {
    db.with(|c| csv_import::list_batches(c, &account_id))
}

#[tauri::command]
pub async fn list_csv_import_problem_rows(db: State<'_, Runtime>, batch_id: String) -> AppResult<Vec<ImportRowRecord>> {
    db.with(|c| csv_import::list_problem_rows(c, &batch_id))
}

#[tauri::command]
pub async fn list_rulebooks(db: State<'_, Runtime>, account_id: Option<String>) -> AppResult<Vec<Rulebook>> {
    db.with(|c| rulebooks::list(c, account_id.as_deref()))
}

#[tauri::command]
pub async fn list_rulebook_versions(db: State<'_, Runtime>, rulebook_id: String) -> AppResult<Vec<RulebookVersionDetail>> {
    db.with(|c| rulebooks::list_versions(c, &rulebook_id))
}

#[tauri::command]
pub async fn get_rulebook_version(db: State<'_, Runtime>, id: String) -> AppResult<RulebookVersionDetail> {
    db.with(|c| rulebooks::get_version(c, &id))
}

#[tauri::command]
pub async fn get_applicable_rulebook(db: State<'_, Runtime>, query: ApplicableRulebookQuery) -> AppResult<ApplicableRulebook> {
    db.with(|c| rulebooks::applicable(c, &query))
}

#[tauri::command]
pub async fn create_rulebook_draft(db: State<'_, Runtime>, input: RulebookDraftInput) -> AppResult<RulebookVersionDetail> {
    db.with(|c| rulebooks::create_draft(c, input))
}

#[tauri::command]
pub async fn validate_rulebook_draft(db: State<'_, Runtime>, id: String) -> AppResult<Vec<FieldIssue>> {
    db.with(|c| rulebooks::validate(c, &id))
}

#[tauri::command]
pub async fn publish_rulebook_version(
    db: State<'_, Runtime>,
    id: String,
    reviewer: Option<String>,
) -> AppResult<RulebookVersionDetail> {
    db.with(|c| rulebooks::publish(c, &id, reviewer))
}

#[tauri::command]
pub async fn assign_rulebook_to_account(db: State<'_, Runtime>, input: AssignmentInput) -> AppResult<AccountRulebookAssignment> {
    db.with(|c| rulebooks::assign(c, input))
}

#[tauri::command]
pub async fn list_account_rulebook_assignments(
    db: State<'_, Runtime>,
    account_id: String,
) -> AppResult<Vec<AccountRulebookAssignment>> {
    db.with(|c| rulebooks::list_assignments(c, &account_id))
}

#[tauri::command]
pub async fn flag_rulebook_source_conflict(db: State<'_, Runtime>, input: SourceConflictInput) -> AppResult<RuleClaim> {
    db.with(|c| rulebooks::flag_conflict(c, input))
}

/// Read-only: whether the journal database is open, and why not if it isn't.
#[tauri::command]
pub fn runtime_status(rt: State<'_, Runtime>) -> RuntimeStatus {
    rt.status()
}

/// Re-run the real open/backup/migrate path in the background and return at
/// once (`initializing`); the frontend polls `runtime_status`. A no-op when
/// ready or when an attempt is already running.
#[tauri::command]
pub fn retry_runtime(app: AppHandle, rt: State<'_, Runtime>) -> RuntimeStatus {
    if rt.begin_initialize() {
        initialize_in_background(app);
    }
    rt.status()
}

/// Run `Runtime::initialize` on its own thread, off Tauri's setup and command threads.
pub fn initialize_in_background(app: AppHandle) {
    std::thread::spawn(move || {
        app.state::<Runtime>().initialize();
    });
}
