//! Local SQLite schema for the FundedFlow journal.
//!
//! The schema itself lives in `apps/desktop/src-tauri/migrations/*.sql` and is documented in
//! `docs/data-model.md`. This module embeds those files, applies them and the
//! Rust data steps in `steps` in order (tracking progress with
//! `PRAGMA user_version`) and opens the per-user database file.

mod steps;

use std::path::Path;

use rusqlite::{Connection, Transaction};

pub(crate) use steps::rederive_trading_days;

/// File name of the journal database inside the app data directory
/// (`%APPDATA%\com.fundedflow.desktop\` on Windows).
pub const DB_FILE_NAME: &str = "fundedflow.db";

/// One forward-only migration. `version` is the `user_version` value the
/// database has after it is applied.
pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub step: Step,
}

/// What a migration does. Either kind runs inside the migration's transaction.
pub enum Step {
    /// A schema change or seed, embedded from `migrations/NNNN_name.sql`.
    Sql(&'static str),
    /// A data step that needs the Rust domain logic, such as re-deriving a
    /// stored value. It must be idempotent and change only derived columns.
    Rust(fn(&Transaction) -> rusqlite::Result<()>),
}

/// All migrations, oldest first. Never edit a shipped migration; add a new one.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "core_schema",
        step: Step::Sql(include_str!("../../migrations/0001_core_schema.sql")),
    },
    Migration {
        version: 2,
        name: "seed_instruments",
        step: Step::Sql(include_str!("../../migrations/0002_seed_instruments.sql")),
    },
    Migration {
        version: 3,
        name: "round_trip_imports",
        step: Step::Sql(include_str!("../../migrations/0003_round_trip_imports.sql")),
    },
    Migration {
        version: 4,
        name: "archive_accounts",
        step: Step::Sql(include_str!("../../migrations/0004_archive_accounts.sql")),
    },
    Migration {
        version: 5,
        name: "rederive_trading_days",
        step: Step::Rust(|tx| rederive_trading_days(tx).map(|_| ())),
    },
];

/// Latest schema version this build understands.
pub fn latest_version() -> u32 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

/// Per-connection settings required by the schema.
pub fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "recursive_triggers", false)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

#[derive(Debug)]
pub enum MigrateError {
    /// The journal was written by a newer FundedFlow build.
    NewerSchema { found: u32, supported: u32 },
    /// A migration failed; the database stays at the previous version.
    Migration { name: &'static str, source: rusqlite::Error },
    /// The pre-upgrade backup could not be written (e.g. disk full); the
    /// upgrade was not attempted.
    Backup(String),
    Sqlite(rusqlite::Error),
    Io(std::io::Error),
}

impl From<rusqlite::Error> for MigrateError {
    fn from(e: rusqlite::Error) -> Self {
        MigrateError::Sqlite(e)
    }
}

impl std::fmt::Display for MigrateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MigrateError::NewerSchema { found, supported } => write!(
                f,
                "journal schema version {found} is newer than this app supports ({supported})"
            ),
            MigrateError::Migration { name, source } => {
                write!(f, "migration '{name}' failed: {source}")
            }
            MigrateError::Sqlite(e) => write!(f, "database error: {e}"),
            MigrateError::Backup(e) => write!(f, "could not write the pre-upgrade backup: {e}"),
            MigrateError::Io(e) => write!(f, "could not prepare the data directory: {e}"),
        }
    }
}

impl std::error::Error for MigrateError {}

fn current_version(conn: &Connection) -> rusqlite::Result<u32> {
    conn.pragma_query_value(None, "user_version", |r| r.get(0))
}

/// Apply every pending migration. Each migration runs in its own transaction
/// together with its `user_version` bump, so a failure leaves the database at
/// the last fully-applied version. Returns the resulting version.
pub fn migrate(conn: &mut Connection) -> Result<u32, MigrateError> {
    migrate_with(conn, MIGRATIONS)
}

fn migrate_with(conn: &mut Connection, migrations: &[Migration]) -> Result<u32, MigrateError> {
    configure(conn)?;
    let current = current_version(conn)?;
    let supported = migrations.last().map(|m| m.version).unwrap_or(0);
    if current > supported {
        return Err(MigrateError::NewerSchema { found: current, supported });
    }
    for m in migrations.iter().filter(|m| m.version > current) {
        let mut apply = || -> rusqlite::Result<()> {
            let tx: Transaction = conn.transaction()?;
            match m.step {
                Step::Sql(sql) => tx.execute_batch(sql)?,
                Step::Rust(run) => run(&tx)?,
            }
            tx.pragma_update(None, "user_version", m.version)?;
            tx.commit()
        };
        apply().map_err(|source| MigrateError::Migration { name: m.name, source })?;
    }
    Ok(supported)
}

/// Open (creating if needed) the journal database at `path`, take a backup
/// copy before upgrading an existing journal, and migrate it.
pub fn open_file(path: &Path) -> Result<Connection, MigrateError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(MigrateError::Io)?;
    }
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    let current = current_version(&conn)?;
    if current > 0 && current < latest_version() {
        // A consistent copy (includes WAL content) the user can restore if an
        // upgrade goes wrong. Overwrites the backup of the previous upgrade.
        let backup = path.with_extension(format!("db.before-v{}.bak", latest_version()));
        if backup.exists() {
            std::fs::remove_file(&backup).map_err(|e| MigrateError::Backup(e.to_string()))?;
        }
        conn.execute("VACUUM INTO ?1", [backup.to_string_lossy()])
            .map_err(|e| MigrateError::Backup(e.to_string()))?;
    }
    migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod upgrade_tests;
