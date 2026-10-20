//! Local runtime readiness: opening and migrating the journal database without
//! taking the window down when that fails.
//!
//! Startup never aborts on a database error. The failure is recorded here,
//! the window and command bridge come up, and the frontend reads
//! `runtime_status` to show recovery UI and calls `retry_runtime` to re-run
//! the real open/backup/migrate path. Data commands return
//! `AppError::Unavailable` until the runtime is ready.
//!
//! Recovery is never destructive: a database that fails to open is left
//! exactly as it is; no empty replacement is created, nothing is reset or
//! downgraded.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use serde::Serialize;

use crate::db::{self, MigrateError};
use crate::error::{AppError, AppResult};

/// Read-only snapshot returned by `runtime_status` and `retry_runtime`.
/// Mirrored by `runtimeStatusSchema` in `src/lib/data/runtime.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: RuntimeState,
    /// Schema version of the open database; `None` until it opened.
    pub schema_version: Option<u32>,
    /// Latest schema version this build understands.
    pub supported_schema_version: u32,
    /// The database file did not exist and was created by this start.
    pub created: bool,
    pub failure: Option<RuntimeFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeState {
    Initializing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFailure {
    pub category: FailureCategory,
    /// Retrying can succeed without a newer app (e.g. after freeing disk space
    /// or closing another program that locks the file).
    pub retryable: bool,
    /// Safe to show the user; contains no file contents.
    pub message: String,
    /// Technical detail for support/diagnostics.
    pub detail: String,
}

/// Stable failure categories; see docs/data-model.md#startup-and-recovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCategory {
    /// The per-user data directory could not be resolved or created.
    DataDirectory,
    /// The database file exists but could not be opened or read
    /// (locked, corrupt, not a database, permission denied).
    OpenFailed,
    /// The pre-upgrade backup could not be written; no upgrade was attempted.
    BackupFailed,
    /// A migration failed and was rolled back; the database is unchanged at
    /// its previous version.
    MigrationFailed,
    /// The database was written by a newer FundedFlow; it is left untouched.
    NewerSchema,
}

fn failure(category: FailureCategory, detail: String) -> RuntimeFailure {
    use FailureCategory::*;
    let (retryable, message) = match category {
        DataDirectory => (true, "FundedFlow could not create its data folder. Check that your user profile folder is writable, then retry."),
        OpenFailed => (true, "FundedFlow could not open your journal database. If another copy of FundedFlow or a sync/backup tool is using it, close it and retry. Your data has not been changed."),
        BackupFailed => (true, "FundedFlow could not save a backup before upgrading your journal, so it did not upgrade. Free up disk space and retry. Your data has not been changed."),
        MigrationFailed => (true, "Upgrading your journal failed and was rolled back. Your data has not been changed. Retry, or contact support with the details below."),
        NewerSchema => (false, "Your journal was created by a newer version of FundedFlow. Install the latest version to open it. Your data has not been changed."),
    };
    RuntimeFailure { category, retryable, message: message.into(), detail }
}

fn classify(e: &MigrateError) -> RuntimeFailure {
    let category = match e {
        MigrateError::NewerSchema { .. } => FailureCategory::NewerSchema,
        MigrateError::Migration { .. } => FailureCategory::MigrationFailed,
        MigrateError::Backup(_) => FailureCategory::BackupFailed,
        MigrateError::Io(_) => FailureCategory::DataDirectory,
        MigrateError::Sqlite(_) => FailureCategory::OpenFailed,
    };
    failure(category, e.to_string())
}

/// Tauri-managed handle to the single journal connection, which is absent
/// while the runtime is not ready.
pub struct Runtime {
    /// Where the journal lives, or why that could not be determined.
    path: Result<PathBuf, String>,
    conn: Mutex<Option<Connection>>,
    status: Mutex<RuntimeStatus>,
}

/// A panic while a lock was held poisons it. Every write runs in a
/// transaction that rolls back on drop, so the data is still consistent:
/// recover the guard instead of failing every later command.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Runtime {
    /// Resolve and open the journal. Never fails: a failure is recorded in
    /// the status for the frontend to show.
    pub fn start(path: Result<PathBuf, String>) -> Self {
        let rt = Runtime {
            path,
            conn: Mutex::new(None),
            status: Mutex::new(RuntimeStatus {
                state: RuntimeState::Initializing,
                schema_version: None,
                supported_schema_version: db::latest_version(),
                created: false,
                failure: None,
            }),
        };
        rt.initialize();
        rt
    }

    pub fn status(&self) -> RuntimeStatus {
        lock(&self.status).clone()
    }

    /// Run the real open/backup/migrate path unless already ready. Holding the
    /// connection lock for the whole attempt means only one initialization
    /// runs at a time; concurrent retries wait and then see the result.
    /// Bounded by SQLite's busy timeout (see `db::configure`).
    pub fn initialize(&self) -> RuntimeStatus {
        let mut conn = lock(&self.conn);
        if conn.is_some() {
            return self.status();
        }
        lock(&self.status).state = RuntimeState::Initializing;

        let (result, created) = match &self.path {
            Ok(path) => {
                let created = !path.exists();
                (open(path), created)
            }
            Err(e) => (Err(failure(FailureCategory::DataDirectory, e.clone())), false),
        };

        let mut status = lock(&self.status);
        match result {
            Ok((c, version)) => {
                *conn = Some(c);
                status.state = RuntimeState::Ready;
                status.schema_version = Some(version);
                status.created = created;
                status.failure = None;
            }
            Err(f) => {
                status.state = RuntimeState::Failed;
                status.schema_version = None;
                status.created = false;
                status.failure = Some(f);
            }
        }
        status.clone()
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        match lock(&self.conn).as_mut() {
            Some(conn) => f(conn),
            None => Err(AppError::Unavailable {
                message: "the journal database is not available; see runtime status".into(),
            }),
        }
    }
}

fn open(path: &Path) -> Result<(Connection, u32), RuntimeFailure> {
    let conn = db::open_file(path).map_err(|e| classify(&e))?;
    let version = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| failure(FailureCategory::OpenFailed, e.to_string()))?;
    Ok((conn, version))
}

#[cfg(test)]
mod tests;
