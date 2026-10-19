mod commands;
mod csv_import;
mod db;
mod domain;
mod error;
mod store;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Per-user data directory, e.g. %APPDATA%\com.fundedflow.desktop\ on
            // Windows; never the install directory.
            let path = app.path().app_data_dir()?.join(db::DB_FILE_NAME);
            let conn = db::open_file(&path)?;
            app.manage(store::Db::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::list_accounts,
            commands::create_account,
            commands::update_account,
            commands::delete_account,
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
