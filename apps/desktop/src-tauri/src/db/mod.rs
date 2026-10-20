//! Local SQLite schema for the FundedFlow journal.
//!
//! The schema itself lives in `apps/desktop/src-tauri/migrations/*.sql` and is documented in
//! `docs/data-model.md`. This module embeds those files, applies them and the
//! Rust data steps in `steps` in order (tracking progress with
//! `PRAGMA user_version`) and opens the per-user database file.

mod steps;

use std::path::Path;

use rusqlite::{Connection, Transaction};

pub(crate) use steps::{convert_legacy_rulebooks, map_legacy_catalogue, provider_for_firm, rederive_trading_days};

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
    Migration {
        version: 6,
        name: "provider_catalogue",
        step: Step::Sql(include_str!("../../migrations/0006_provider_catalogue.sql")),
    },
    Migration {
        version: 7,
        name: "map_legacy_catalogue",
        step: Step::Rust(|tx| map_legacy_catalogue(tx)),
    },
    Migration {
        version: 8,
        name: "freeze_ever_verified",
        step: Step::Sql(include_str!("../../migrations/0008_freeze_ever_verified.sql")),
    },
    Migration {
        version: 9,
        name: "rulebooks",
        step: Step::Sql(include_str!("../../migrations/0009_rulebooks.sql")),
    },
    Migration {
        version: 10,
        name: "convert_legacy_rulebooks",
        step: Step::Rust(|tx| convert_legacy_rulebooks(tx)),
    },
    Migration {
        version: 11,
        name: "account_attempts",
        step: Step::Sql(include_str!("../../migrations/0011_account_attempts.sql")),
    },
    Migration {
        version: 12,
        name: "snapshot_rulebook_fk",
        step: Step::Sql(include_str!("../../migrations/0012_snapshot_rulebook_fk.sql")),
    },
    Migration {
        version: 13,
        name: "account_offer_selections",
        step: Step::Sql(include_str!("../../migrations/0013_account_offer_selections.sql")),
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
    /// Migration `version` failed and was rolled back. Each migration commits
    /// on its own, so the journal is at `reached`: `from` if this was the
    /// first step of the upgrade, later if earlier steps were already saved.
    Migration { name: &'static str, version: u32, from: u32, reached: u32, source: rusqlite::Error },
    /// The pre-upgrade backup could not be written (e.g. disk full); the
    /// upgrade was not attempted and the journal is still at `current`.
    Backup { current: u32, message: String },
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
            MigrateError::Migration { name, version, from, reached, source } => write!(
                f,
                "migration {version} '{name}' failed and was rolled back: {source} \
                 (upgrade started at version {from}; the journal is at version {reached})"
            ),
            MigrateError::Sqlite(e) => write!(f, "database error: {e}"),
            MigrateError::Backup { current, message } => {
                write!(f, "could not write the pre-upgrade backup of version {current}: {message}")
            }
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

pub(crate) fn migrate_with(conn: &mut Connection, migrations: &[Migration]) -> Result<u32, MigrateError> {
    configure(conn)?;
    let current = current_version(conn)?;
    let supported = migrations.last().map(|m| m.version).unwrap_or(0);
    if current > supported {
        return Err(MigrateError::NewerSchema { found: current, supported });
    }
    let mut reached = current;
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
        apply().map_err(|source| MigrateError::Migration {
            name: m.name,
            version: m.version,
            from: current,
            reached,
            source,
        })?;
        reached = m.version;
    }
    Ok(supported)
}

/// Where `open_file` writes the pre-upgrade copy of the journal at `path`.
pub fn backup_path(path: &Path) -> std::path::PathBuf {
    path.with_extension(format!("db.before-v{}.bak", latest_version()))
}

/// Open (creating if needed) the journal database at `path`, take a backup
/// copy before upgrading an existing journal, and migrate it.
pub fn open_file(path: &Path) -> Result<Connection, MigrateError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(MigrateError::Io)?;
    }
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    // Refuse a newer journal before anything persistent is set on the file
    // (WAL mode is stored in the database header).
    let current = current_version(&conn)?;
    if current > latest_version() {
        return Err(MigrateError::NewerSchema { found: current, supported: latest_version() });
    }
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    if current > 0 && current < latest_version() {
        // A consistent copy (includes WAL content) the user can restore if an
        // upgrade goes wrong. Overwrites the backup of the previous upgrade.
        let backup_error = |e: &dyn std::fmt::Display| MigrateError::Backup { current, message: e.to_string() };
        let backup = backup_path(path);
        if backup.exists() {
            std::fs::remove_file(&backup).map_err(|e| backup_error(&e))?;
        }
        conn.execute("VACUUM INTO ?1", [backup.to_string_lossy()]).map_err(|e| backup_error(&e))?;
    }
    migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod upgrade_tests;
#[cfg(test)]
mod catalogue_tests;
/// Writes the catalogue fixture into a database (any schema version from 6), for other modules' tests.
#[cfg(test)]
pub(crate) fn catalogue_tests_save(conn: &Connection, fixture: &crate::parity::CatalogueFixture) {
    catalogue_tests::save_fixture(conn, fixture)
}
/// A database holding the whole catalogue fixture, for other modules' tests.
#[cfg(test)]
pub(crate) fn catalogue_tests_seeded() -> Connection {
    catalogue_tests::seeded()
}
#[cfg(test)]
mod legacy_rulebook_tests;
#[cfg(test)]
mod rulebook_tests;
