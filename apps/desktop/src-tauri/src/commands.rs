//! Tauri commands: thin wrappers that hand typed payloads to the store and
//! CSV import layers, which validate before writing. Mirrored by
//! `src/lib/data/api.ts`.
//!
//! Commands are `async` so database work runs off the main (UI) thread.

use tauri::{AppHandle, Manager, State};

use crate::csv_import::{self, CsvImportRequest, CsvPreview, ImportBatch, ImportRowRecord};
use crate::error::AppResult;
use crate::store::accounts::{self, Account, AccountHistory, AccountInput, StatusChangeInput};
use crate::store::attempts::{self, AttemptSummary, DeletionPreview, ResetInput, ResetResult};
use crate::error::FieldIssue;
use crate::rulebook::{
    AccountRulebookAssignment, ApplicableRulebook, ApplicableRulebookQuery, AssignmentInput, RuleClaim, Rulebook,
    RulebookDraftInput, RulebookVersionDetail, SourceConflictInput,
};
use crate::catalogue::{AccountCatalogueLink, AccountPhaseEvent, CatalogueVersion};
use crate::store::catalogue::{self as catalogue_store, AccountLinkInput, CatalogueSnapshot, PhaseEventInput};
use crate::catalogue::SourceReference;
use crate::store::authoring::{self, DraftInput, SourceInput};
use crate::store::offers::{self, OfferSelection, OfferSelectionInput};
use crate::store::ledger::{self, LedgerEntry, LedgerEntryInput};
use crate::store::settings::{self, Setting};
use crate::store::snapshots::{self, Snapshot, SnapshotInput};
use crate::store::journal::{self, JournalEntry, JournalEntryInput};
use crate::store::rulebooks;
use crate::store::trades::{self, Trade, TradeInput};
use crate::runtime::{Runtime, RuntimeStatus};

#[tauri::command]
pub async fn list_accounts(db: State<'_, Runtime>, include_archived: Option<bool>) -> AppResult<Vec<Account>> {
    db.with(|c| accounts::list_with(c, include_archived.unwrap_or(false)))
}

/// Accounts that can trade now (active, not archived): the only accounts risk views may read.
#[tauri::command]
pub async fn list_active_accounts(db: State<'_, Runtime>) -> AppResult<Vec<Account>> {
    db.with(|c| accounts::list_active(c))
}

#[tauri::command]
pub async fn get_account(db: State<'_, Runtime>, id: String) -> AppResult<Account> {
    db.with(|c| accounts::get_any(c, &id))
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
pub async fn restore_account(db: State<'_, Runtime>, id: String) -> AppResult<Account> {
    db.with(|c| accounts::restore(c, &id))
}

#[tauri::command]
pub async fn change_account_status(db: State<'_, Runtime>, id: String, input: StatusChangeInput) -> AppResult<Account> {
    db.with(|c| accounts::change_status(c, &id, input))
}

#[tauri::command]
pub async fn get_account_history(db: State<'_, Runtime>, id: String) -> AppResult<AccountHistory> {
    db.with(|c| accounts::history(c, &id))
}

#[tauri::command]
pub async fn reset_account_attempt(db: State<'_, Runtime>, input: ResetInput) -> AppResult<ResetResult> {
    db.with(|c| attempts::reset(c, input))
}

#[tauri::command]
pub async fn get_account_lineage(db: State<'_, Runtime>, id: String) -> AppResult<Vec<AttemptSummary>> {
    db.with(|c| attempts::lineage(c, &id))
}

#[tauri::command]
pub async fn preview_account_deletion(db: State<'_, Runtime>, id: String) -> AppResult<DeletionPreview> {
    db.with(|c| attempts::deletion_preview(c, &id))
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

#[tauri::command]
pub async fn get_catalogue(db: State<'_, Runtime>) -> AppResult<CatalogueSnapshot> {
    db.with(|c| catalogue_store::load(c))
}

#[tauri::command]
pub async fn transition_catalogue_version(
    db: State<'_, Runtime>,
    id: String,
    to: String,
    reviewer: Option<String>,
) -> AppResult<CatalogueVersion> {
    db.with(|c| catalogue_store::transition_version(c, &id, &to, reviewer.as_deref()))
}

#[tauri::command]
pub async fn create_catalogue_source(db: State<'_, Runtime>, input: SourceInput) -> AppResult<SourceReference> {
    db.with(|c| authoring::create_source(c, input))
}

#[tauri::command]
pub async fn create_catalogue_draft(db: State<'_, Runtime>, input: DraftInput) -> AppResult<CatalogueVersion> {
    db.with(|c| authoring::create_draft(c, input))
}

#[tauri::command]
pub async fn replace_catalogue_draft(db: State<'_, Runtime>, id: String, input: DraftInput) -> AppResult<CatalogueVersion> {
    db.with(|c| authoring::replace_draft(c, &id, input))
}

#[tauri::command]
pub async fn select_account_offer(db: State<'_, Runtime>, input: OfferSelectionInput) -> AppResult<OfferSelection> {
    db.with(|c| offers::select(c, input))
}

#[tauri::command]
pub async fn list_account_offer_selections(db: State<'_, Runtime>, account_id: String) -> AppResult<Vec<OfferSelection>> {
    db.with(|c| offers::list(c, &account_id))
}

#[tauri::command]
pub async fn get_account_catalogue_link(db: State<'_, Runtime>, account_id: String) -> AppResult<AccountCatalogueLink> {
    db.with(|c| catalogue_store::get_link(c, &account_id))
}

#[tauri::command]
pub async fn set_account_catalogue_link(db: State<'_, Runtime>, input: AccountLinkInput) -> AppResult<AccountCatalogueLink> {
    db.with(|c| catalogue_store::set_link(c, input))
}

#[tauri::command]
pub async fn list_account_phase_events(db: State<'_, Runtime>, account_id: String) -> AppResult<Vec<AccountPhaseEvent>> {
    db.with(|c| catalogue_store::list_phase_events(c, &account_id))
}

#[tauri::command]
pub async fn record_account_phase_event(db: State<'_, Runtime>, input: PhaseEventInput) -> AppResult<AccountPhaseEvent> {
    db.with(|c| catalogue_store::record_phase_event(c, input))
}

#[tauri::command]
pub async fn list_ledger_entries(db: State<'_, Runtime>, account_id: String) -> AppResult<Vec<LedgerEntry>> {
    db.with(|c| ledger::list(c, &account_id))
}

#[tauri::command]
pub async fn create_ledger_entry(db: State<'_, Runtime>, input: LedgerEntryInput) -> AppResult<LedgerEntry> {
    db.with(|c| ledger::create(c, input))
}

#[tauri::command]
pub async fn update_ledger_entry(db: State<'_, Runtime>, id: String, input: LedgerEntryInput) -> AppResult<LedgerEntry> {
    db.with(|c| ledger::update(c, &id, input))
}

#[tauri::command]
pub async fn delete_ledger_entry(db: State<'_, Runtime>, id: String) -> AppResult<()> {
    db.with(|c| ledger::delete(c, &id))
}

#[tauri::command]
pub async fn get_ledger_balance_adjustment(db: State<'_, Runtime>, account_id: String) -> AppResult<String> {
    db.with(|c| ledger::balance_adjustment(c, &account_id))
}

#[tauri::command]
pub async fn get_setting(db: State<'_, Runtime>, key: String) -> AppResult<Option<Setting>> {
    db.with(|c| settings::get(c, &key))
}

#[tauri::command]
pub async fn list_settings(db: State<'_, Runtime>) -> AppResult<Vec<Setting>> {
    db.with(|c| settings::list(c))
}

#[tauri::command]
pub async fn set_setting(db: State<'_, Runtime>, key: String, value: serde_json::Value) -> AppResult<Setting> {
    db.with(|c| settings::set(c, &key, &value))
}

#[tauri::command]
pub async fn remove_setting(db: State<'_, Runtime>, key: String) -> AppResult<()> {
    db.with(|c| settings::remove(c, &key))
}

#[tauri::command]
pub async fn save_account_snapshot(db: State<'_, Runtime>, input: SnapshotInput) -> AppResult<Snapshot> {
    db.with(|c| snapshots::save(c, input))
}

#[tauri::command]
pub async fn list_account_snapshots(
    db: State<'_, Runtime>,
    account_id: String,
    from: Option<String>,
    to: Option<String>,
    end_of_day_only: Option<bool>,
) -> AppResult<Vec<Snapshot>> {
    db.with(|c| snapshots::list(c, &account_id, from.as_deref(), to.as_deref(), end_of_day_only.unwrap_or(false)))
}

#[tauri::command]
pub async fn get_latest_account_snapshot(db: State<'_, Runtime>, account_id: String) -> AppResult<Option<Snapshot>> {
    db.with(|c| snapshots::latest(c, &account_id))
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
