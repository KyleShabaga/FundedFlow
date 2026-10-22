// Copyright (c) 2026 Kyle Shabaga. All rights reserved.
// Proprietary and source-available, not open source. See LICENSE in the repository root.

mod catalogue;
mod data_controls;
mod commands;
mod csv_import;
mod db;
// Build 26.9 developer tools: absent from release builds (no code, no commands).
#[cfg(any(debug_assertions, test))]
mod dev_tools;
mod domain;
mod error;
#[cfg(test)]
mod insights;
mod legal;
#[cfg(test)]
mod parity;
#[cfg(test)]
mod wire_contract;
mod rulebook;
mod runtime;
mod store;

use tauri::Manager;

/// Every command the window may invoke. Debug builds add the Build 26.9 developer commands; a
/// release build never registers them, so they cannot be invoked even by a modified frontend.
macro_rules! app_commands {
    ($($extra:path),* $(,)?) => {
        tauri::generate_handler![
            commands::get_account_risk_inputs,
            commands::create_financial_observation,
            commands::get_financial_observation,
            commands::list_financial_observations,
            commands::correct_financial_observation,
            commands::get_ledger_history,
            commands::correct_ledger_entry,
            commands::remove_ledger_entry_with_reason,
            commands::reconcile_financial_balance,
            commands::list_financial_reconciliations,
            commands::resolve_financial_reconciliation,
            commands::list_reconciliation_resolutions,
            commands::preview_permanent_deletion,
            commands::permanently_delete_data,
            commands::retry_data_cleanup,
            commands::inspect_journal_archive,
            commands::restore_journal_archive,
            commands::export_journal_archive,
            commands::export_trade_csv,
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
            commands::capture_account_risk,
            commands::promote_account_risk,
            commands::get_current_account_risk,
            commands::get_account_snapshot_freshness,
            commands::list_active_accounts,
            commands::list_trades,
            commands::create_trade,
            commands::update_trade,
            commands::delete_trade,
            commands::restore_trade,
            commands::list_deleted_trades,
            commands::get_trade_detail,
            commands::get_trade_review,
            commands::save_trade_review,
            commands::list_trade_review_summaries,
            commands::add_trade_screenshot,
            commands::read_trade_screenshot,
            commands::remove_trade_screenshot,
            commands::get_review_library,
            commands::save_strategy,
            commands::save_tag,
            commands::save_checklist,
            commands::set_library_archived,
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
            commands::update_rulebook_draft,
            commands::discard_rulebook_draft,
            commands::list_rulebook_events,
            commands::get_daily_review,
            commands::list_daily_reviews,
            commands::save_daily_review,
            commands::reopen_daily_review,
            commands::relink_daily_review_trades,
            commands::get_insights_dataset,
            commands::list_account_freshness,
            legal::get_legal_acceptance,
            legal::record_legal_acceptance,
            $($extra),*
        ]
    };
}

#[cfg(debug_assertions)]
macro_rules! all_commands {
    () => {
        app_commands![
            dev_tools::dev_tools_status,
            dev_tools::dev_seed_fake_data,
            dev_tools::dev_reset_preview,
            dev_tools::dev_reset_handoff,
            dev_tools::dev_dismiss_reset_report,
        ]
    };
}

#[cfg(not(debug_assertions))]
macro_rules! all_commands {
    () => {
        app_commands![]
    };
}

/// The command-line seeder behind `cargo run --example seed-demo-journal` (debug builds only).
#[cfg(debug_assertions)]
pub fn dev_seed_cli(args: &[String]) -> Result<String, String> {
    dev_tools::cli(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Per-user data directory, e.g. %APPDATA%\com.fundedflow.desktop\ on
            // Windows; never the install directory. Opening, backing up and
            // migrating the journal run on a background thread, so neither a
            // failure nor a slow upgrade keeps the window from opening: the
            // frontend polls the runtime status and shows progress or recovery.
            let dir = app.path().app_data_dir().map_err(|e| e.to_string());
            // The first-run acceptance record belongs to the install (NA-3), in the app config
            // directory: on Windows the same per-user folder as the journal, but a separate file.
            let config_dir = app.path().app_config_dir().map_err(|e| e.to_string());
            // Debug builds only: FUNDEDFLOW_DEV_DATA_DIR opens an isolated test journal instead
            // (Build 26.9). A refused value fails startup rather than falling back to the real journal.
            // The test journal's folder also holds its acceptance record, so it never touches the real one.
            #[cfg(debug_assertions)]
            let (dir, config_dir) = {
                let dev = dev_tools::DevEnvironment::from_env(dir.clone().ok(), &app.config().identifier);
                let config_dir = match (&dev.isolated, &dev.problem) {
                    (Some(isolated), _) => Ok(isolated.clone()),
                    (None, Some(problem)) => Err(problem.clone()),
                    (None, None) => config_dir,
                };
                let dir = dev.data_dir(dir);
                app.manage(dev_tools::DevState::new(dev));
                (dir, config_dir)
            };
            app.manage(legal::LegalStore::new(config_dir));
            let path = dir.map(|dir| dir.join(db::DB_FILE_NAME));
            app.manage(runtime::Runtime::new(path));
            commands::initialize_in_background(app.handle().clone());
            Ok(())
        })
        .invoke_handler(all_commands!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
