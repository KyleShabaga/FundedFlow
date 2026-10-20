mod catalogue;
mod commands;
mod csv_import;
mod db;
mod domain;
mod error;
#[cfg(test)]
mod parity;
mod runtime;
mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Per-user data directory, e.g. %APPDATA%\com.fundedflow.desktop\ on
            // Windows; never the install directory. A database failure must not
            // stop the window from opening: it is recorded in the runtime
            // status and shown by the frontend's recovery screen.
            let path = app
                .path()
                .app_data_dir()
                .map(|dir| dir.join(db::DB_FILE_NAME))
                .map_err(|e| e.to_string());
            app.manage(runtime::Runtime::start(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::runtime_status,
            commands::retry_runtime,
            commands::list_accounts,
            commands::create_account,
            commands::update_account,
            commands::archive_account,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
