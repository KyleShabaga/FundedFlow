//! Tauri commands: thin wrappers that hand typed payloads to the store and
//! CSV import layers, which validate before writing. Mirrored by
//! `src/lib/data/api.ts`.
//!
//! Commands are `async` so database work runs off the main (UI) thread.

use tauri::State;

use crate::csv_import::{self, CsvImportRequest, CsvPreview, ImportBatch, ImportRowRecord};
use crate::error::AppResult;
use crate::store::accounts::{self, Account, AccountInput};
use crate::store::journal::{self, JournalEntry, JournalEntryInput};
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

/// Read-only: whether the journal database is open, and why not if it isn't.
#[tauri::command]
pub fn runtime_status(rt: State<'_, Runtime>) -> RuntimeStatus {
    rt.status()
}

/// Re-run the real open/backup/migrate path. A no-op when already ready.
#[tauri::command]
pub async fn retry_runtime(rt: State<'_, Runtime>) -> Result<RuntimeStatus, ()> {
    Ok(rt.initialize())
}
