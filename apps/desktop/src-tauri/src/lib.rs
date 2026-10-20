mod catalogue;
mod commands;
mod csv_import;
mod db;
mod domain;
mod error;
#[cfg(test)]
mod parity;
mod rulebook;
mod runtime;
mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Per-user data directory, e.g. %APPDATA%\com.fundedflow.desktop\ on
            // Windows; never the install directory. Opening, backing up and
            // migrating the journal run on a background thread, so neither a
            // failure nor a slow upgrade keeps the window from opening: the
            // frontend polls the runtime status and shows progress or recovery.
            let path = app
                .path()
                .app_data_dir()
                .map(|dir| dir.join(db::DB_FILE_NAME))
                .map_err(|e| e.to_string());
            app.manage(runtime::Runtime::new(path));
            commands::initialize_in_background(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::runtime_status,
            commands::retry_runtime,
            commands::list_accounts,
            commands::create_account,
            commands::update_account,
            commands::archive_account,
            commands::restore_account,
            commands::change_account_status,
            commands::get_account_history,
            commands::reset_account_attempt,
            commands::get_account_lineage,
            commands::preview_account_deletion,
            commands::get_account,
            commands::get_catalogue,
            commands::create_catalogue_source,
            commands::create_catalogue_draft,
            commands::replace_catalogue_draft,
            commands::select_account_offer,
            commands::list_account_offer_selections,
            commands::transition_catalogue_version,
            commands::get_account_catalogue_link,
            commands::set_account_catalogue_link,
            commands::list_account_phase_events,
            commands::record_account_phase_event,
            commands::list_ledger_entries,
            commands::create_ledger_entry,
            commands::update_ledger_entry,
            commands::delete_ledger_entry,
            commands::get_ledger_balance_adjustment,
            commands::get_setting,
            commands::list_settings,
            commands::set_setting,
            commands::remove_setting,
            commands::save_account_snapshot,
            commands::list_account_snapshots,
            commands::get_latest_account_snapshot,
            commands::list_active_accounts,
            commands::list_trades,
            commands::create_trade,
            commands::update_trade,
            commands::delete_trade,
            commands::list_journal_entries,
            commands::create_journal_entry,
            commands::update_journal_entry,
            commands::delete_journal_entry,
            commands::preview_csv_import,
            commands::commit_csv_import,
            commands::list_csv_imports,
            commands::list_csv_import_problem_rows,
            commands::list_rulebooks,
            commands::list_rulebook_versions,
            commands::get_rulebook_version,
            commands::get_applicable_rulebook,
            commands::create_rulebook_draft,
            commands::validate_rulebook_draft,
            commands::publish_rulebook_version,
            commands::assign_rulebook_to_account,
            commands::list_account_rulebook_assignments,
            commands::flag_rulebook_source_conflict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
