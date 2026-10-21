//! Local runtime readiness: opening and migrating the journal database without
//! taking the window down when that fails, and without making the window wait.
//!
//! Startup never aborts on a database error, and never runs the open/backup/
//! migrate path on Tauri's setup thread: `lib.rs` creates the runtime in the
//! `initializing` state and runs `initialize` on a background thread, so the
//! window and command bridge come up at once. The frontend polls
//! `runtime_status`, shows progress or recovery UI, and calls `retry_runtime`
//! to run the real path again (also in the background). Data commands return
//! `AppError::Unavailable` until the runtime is ready; they never wait for it.
//!
//! Recovery is never destructive: a database that fails to open is left
//! exactly as it is; no empty replacement is created, nothing is reset or
//! downgraded, and a newer journal is refused before anything is written to it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// What initialization is doing (while initializing), reached (ready), or
    /// where it failed.
    pub stage: RuntimeStage,
    /// Schema version of the journal file whenever it is known, including on
    /// failure: a newer journal's version, or the version a failed upgrade
    /// left. `None` only when the file could not be read at all.
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

/// The steps of initialization, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStage {
    /// Finding or creating the per-user data folder.
    DataDirectory,
    /// Opening the file and reading its schema version.
    Open,
    /// Writing the pre-upgrade backup.
    Backup,
    /// Applying migrations.
    Migrate,
    /// The journal is open and current.
    Ready,
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
    /// For `migration_failed`: the migration that failed (it was rolled back).
    pub failed_migration: Option<FailedMigration>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedMigration {
    pub version: u32,
    pub name: String,
    /// The journal's version when this upgrade started.
    pub from_version: u32,
    /// The version the journal is at now. Above `from_version` when earlier
    /// steps of the upgrade were saved before this one failed.
    pub reached_version: u32,
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
    /// A migration failed and was rolled back. Earlier migrations of the same
    /// upgrade may already be saved; see `FailedMigration`.
    MigrationFailed,
    /// The database was written by a newer FundedFlow; it is left untouched.
    NewerSchema,
}

impl FailureCategory {
    fn stage(self) -> RuntimeStage {
        match self {
            FailureCategory::DataDirectory => RuntimeStage::DataDirectory,
            FailureCategory::OpenFailed | FailureCategory::NewerSchema => RuntimeStage::Open,
            FailureCategory::BackupFailed => RuntimeStage::Backup,
            FailureCategory::MigrationFailed => RuntimeStage::Migrate,
        }
    }
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
    RuntimeFailure { category, retryable, message: message.into(), detail, failed_migration: None }
}

/// The failure and the journal's schema version, where the error tells it.
fn classify(e: &MigrateError, path: &Path) -> (RuntimeFailure, Option<u32>) {
    match e {
        MigrateError::NewerSchema { found, .. } => (failure(FailureCategory::NewerSchema, e.to_string()), Some(*found)),
        MigrateError::Backup { current, .. } => (failure(FailureCategory::BackupFailed, e.to_string()), Some(*current)),
        MigrateError::Io(_) => (failure(FailureCategory::DataDirectory, e.to_string()), None),
        MigrateError::Sqlite(_) => (failure(FailureCategory::OpenFailed, e.to_string()), None),
        MigrateError::Migration { name, version, from, reached, .. } => {
            let mut f = failure(FailureCategory::MigrationFailed, e.to_string());
            let backup = db::backup_path(path);
            let backup = backup.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            // Each migration commits on its own: only the failed step is
            // undone, so "nothing changed" is true only if it was the first.
            f.message = if reached == from {
                format!(
                    "Upgrading your journal failed at step {version} and that step was rolled back, so your data \
                     has not been changed. A copy from before the upgrade is saved as {backup}. Retry, or contact \
                     support with the details below."
                )
            } else {
                format!(
                    "Upgrading your journal stopped at step {version}, which was rolled back. Earlier upgrade steps \
                     were already saved, so your journal is now at version {reached} (it was {from}). A copy from \
                     before the upgrade is saved as {backup}. Retry to finish the upgrade, or contact support with \
                     the details below."
                )
            };
            f.failed_migration = Some(FailedMigration {
                version: *version,
                name: (*name).to_string(),
                from_version: *from,
                reached_version: *reached,
            });
            (f, Some(*reached))
        }
    }
}

/// Tauri-managed handle to the single journal connection, which is absent
/// while the runtime is not ready.
pub struct Runtime {
    /// Where the journal lives, or why that could not be determined.
    path: Result<PathBuf, String>,
    conn: Mutex<Option<Connection>>,
    status: Mutex<RuntimeStatus>,
    /// An initialization is running or has been handed to a thread.
    running: AtomicBool,
}

/// A panic while a lock was held poisons it. Every write runs in a
/// transaction that rolls back on drop, so the data is still consistent:
/// recover the guard instead of failing every later command.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Runtime {
    /// A runtime that has not opened the journal yet (`initializing`). The
    /// caller runs `initialize`, normally on a background thread (`lib.rs`),
    /// so creating it never waits on the disk.
    pub fn new(path: Result<PathBuf, String>) -> Self {
        Runtime {
            path,
            conn: Mutex::new(None),
            status: Mutex::new(RuntimeStatus {
                state: RuntimeState::Initializing,
                stage: RuntimeStage::DataDirectory,
                schema_version: None,
                supported_schema_version: db::latest_version(),
                created: false,
                failure: None,
            }),
            running: AtomicBool::new(true),
        }
    }

    /// Create and initialize on the calling thread (tests and tools).
    #[cfg(test)]
    pub fn start(path: Result<PathBuf, String>) -> Self {
        let rt = Runtime::new(path);
        rt.initialize();
        rt
    }

    /// The same connection lock and native boundary as ordinary journal commands.
    pub fn with_controls<T>(&self, f: impl FnOnce(&mut Connection, &Path) -> crate::data_controls::Result<T>) -> crate::data_controls::Result<T> {
        if self.status().state != RuntimeState::Ready { return Err(crate::data_controls::fail(crate::data_controls::Code::Busy)); }
        let path = self.path.as_ref().map_err(|_| crate::data_controls::fail(crate::data_controls::Code::Io))?;
        let root = path.parent().ok_or_else(|| crate::data_controls::fail(crate::data_controls::Code::UnsafePath))?;
        match lock(&self.conn).as_mut() {
            Some(c) => f(c, root),
            None => Err(crate::data_controls::fail(crate::data_controls::Code::Busy)),
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        lock(&self.status).clone()
    }

    /// Claim the next initialization for the caller to run (on its own
    /// thread). False when one is already running or the runtime is ready;
    /// a retry then just reports the status. The new attempt shows as
    /// `initializing`, keeping the versions already known.
    pub fn begin_initialize(&self) -> bool {
        if self.status().state == RuntimeState::Ready {
            return false;
        }
        if self.running.swap(true, Ordering::AcqRel) {
            return false;
        }
        let mut status = lock(&self.status);
        status.state = RuntimeState::Initializing;
        status.failure = None;
        true
    }

    fn set_stage(&self, stage: RuntimeStage) {
        lock(&self.status).stage = stage;
    }

    /// Run the real open/backup/migrate path unless already ready. Holding the
    /// connection lock for the whole attempt means only one initialization
    /// runs at a time; a concurrent caller waits and then sees the result.
    /// A slow upgrade delays only this thread: status reads and data commands
    /// never wait for it.
    pub fn initialize(&self) -> RuntimeStatus {
        let mut conn = lock(&self.conn);
        if conn.is_some() {
            self.running.store(false, Ordering::Release);
            return self.status();
        }
        {
            let mut status = lock(&self.status);
            status.state = RuntimeState::Initializing;
            status.stage = RuntimeStage::DataDirectory;
            status.failure = None;
        }

        let (result, created) = match &self.path {
            Ok(path) => {
                let created = !path.exists();
                (self.open(path), created)
            }
            Err(e) => (Err((failure(FailureCategory::DataDirectory, e.clone()), None)), false),
        };

        let mut status = lock(&self.status);
        match result {
            Ok((c, version)) => {
                *conn = Some(c);
                status.state = RuntimeState::Ready;
                status.stage = RuntimeStage::Ready;
                status.schema_version = Some(version);
                status.created = created;
                status.failure = None;
            }
            Err((f, version)) => {
                status.state = RuntimeState::Failed;
                status.stage = f.category.stage();
                // Keep a version learned earlier when this attempt could not read one.
                status.schema_version = version.or(status.schema_version);
                status.created = false;
                status.failure = Some(f);
            }
        }
        self.running.store(false, Ordering::Release);
        status.clone()
    }

    fn open(&self, path: &Path) -> Result<(Connection, u32), (RuntimeFailure, Option<u32>)> {
        self.set_stage(RuntimeStage::Open);
        // Read the version first, without writing, so a failed attempt still
        // reports it and the stage shows whether an upgrade is about to run.
        if path.exists()
            && let Ok(found) = read_version(path)
        {
            lock(&self.status).schema_version = Some(found);
            if found > 0 && found < db::latest_version() {
                self.set_stage(RuntimeStage::Backup);
            }
        }
        let conn = db::open_file(path).map_err(|e| classify(&e, path))?;
        let version = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| (failure(FailureCategory::OpenFailed, e.to_string()), None))?;
        Ok((conn, version))
    }

    /// Run `f` on the journal, or report it unavailable at once while the
    /// runtime is initializing or failed. Never waits for initialization.
    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let unavailable = || AppError::Unavailable {
            message: "the journal database is not available; see runtime status".into(),
        };
        if self.status().state != RuntimeState::Ready {
            return Err(unavailable());
        }
        match lock(&self.conn).as_mut() {
            Some(conn) => f(conn),
            None => Err(unavailable()),
        }
    }
}

/// The file's schema version, read without changing anything.
fn read_version(path: &Path) -> rusqlite::Result<u32> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.pragma_query_value(None, "user_version", |r| r.get(0))
}

#[cfg(test)]
mod tests;
