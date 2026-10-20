//! Startup must survive database failures, report them by category, never
//! change the user's file, and recover through `initialize` (retry).

use std::path::PathBuf;

use super::*;
use crate::db::{DB_FILE_NAME, MIGRATIONS};

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        TempDir(std::env::temp_dir().join(format!("fundedflow-rt-{}", uuid::Uuid::now_v7())))
    }
    fn db(&self) -> PathBuf {
        self.0.join(DB_FILE_NAME)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn user_version(path: &Path) -> u32 {
    Connection::open(path).unwrap().pragma_query_value(None, "user_version", |r| r.get(0)).unwrap()
}

fn category(rt: &Runtime) -> FailureCategory {
    rt.status().failure.expect("a failure").category
}

fn count_accounts(rt: &Runtime) -> AppResult<i64> {
    rt.with(|c| Ok(c.query_row("SELECT count(*) FROM accounts", [], |r| r.get(0))?))
}

#[test]
fn first_run_creates_the_journal_and_is_ready() {
    let dir = TempDir::new();
    let rt = Runtime::start(Ok(dir.db()));
    let s = rt.status();
    assert_eq!(s.state, RuntimeState::Ready);
    assert!(s.created);
    assert_eq!(s.schema_version, Some(db::latest_version()));
    assert_eq!(s.failure, None);
    assert_eq!(count_accounts(&rt).unwrap(), 0);
}

#[test]
fn an_existing_journal_opens_with_its_data() {
    let dir = TempDir::new();
    {
        let rt = Runtime::start(Ok(dir.db()));
        rt.with(|c| {
            c.execute(
                "INSERT INTO accounts (id, name, starting_balance_micros, timezone, created_at, updated_at)
                 VALUES ('a1', 'Eval', 0, 'America/New_York', 'x', 'x')",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    }
    let rt = Runtime::start(Ok(dir.db()));
    assert_eq!(rt.status().state, RuntimeState::Ready);
    assert!(!rt.status().created, "an existing journal is not reported as new");
    assert_eq!(count_accounts(&rt).unwrap(), 1);
}

#[test]
fn an_unreadable_file_fails_without_being_changed_and_retry_recovers() {
    let dir = TempDir::new();
    std::fs::create_dir_all(&dir.0).unwrap();
    let garbage = b"this is not a sqlite database, and must survive startup untouched".repeat(100);
    std::fs::write(dir.db(), &garbage).unwrap();

    let rt = Runtime::start(Ok(dir.db()));
    let s = rt.status();
    assert_eq!(s.state, RuntimeState::Failed);
    assert_eq!(category(&rt), FailureCategory::OpenFailed);
    assert!(s.failure.as_ref().unwrap().retryable);
    assert!(!s.created);
    assert_eq!(std::fs::read(dir.db()).unwrap(), garbage, "the file is never replaced or rewritten");
    assert!(matches!(count_accounts(&rt), Err(AppError::Unavailable { .. })));

    // Still broken: retry reports the same failure and changes nothing.
    assert_eq!(rt.initialize().state, RuntimeState::Failed);
    assert_eq!(std::fs::read(dir.db()).unwrap(), garbage);

    // The user moves the bad file aside; retry runs the real open path.
    std::fs::rename(dir.db(), dir.0.join("moved-aside.db")).unwrap();
    let s = rt.initialize();
    assert_eq!(s.state, RuntimeState::Ready);
    assert!(s.created);
    assert_eq!(count_accounts(&rt).unwrap(), 0);
}

#[test]
fn a_newer_schema_is_refused_and_left_untouched() {
    let dir = TempDir::new();
    std::fs::create_dir_all(&dir.0).unwrap();
    Connection::open(dir.db()).unwrap().pragma_update(None, "user_version", 99).unwrap();

    let rt = Runtime::start(Ok(dir.db()));
    let s = rt.status();
    assert_eq!(s.state, RuntimeState::Failed);
    let f = s.failure.unwrap();
    assert_eq!(f.category, FailureCategory::NewerSchema);
    assert!(!f.retryable);
    assert_eq!(s.supported_schema_version, db::latest_version());
    drop(rt);
    assert_eq!(user_version(&dir.db()), 99, "never downgraded");
    let backups = std::fs::read_dir(&dir.0).unwrap().filter(|e| {
        e.as_ref().unwrap().file_name().to_string_lossy().contains(".bak")
    });
    assert_eq!(backups.count(), 0);
}

#[test]
fn a_failed_migration_rolls_back_and_keeps_a_backup() {
    let dir = TempDir::new();
    std::fs::create_dir_all(&dir.0).unwrap();
    {
        // A version-1 journal whose data makes migration 2 fail: the built-in
        // ES instrument id is already taken.
        let conn = Connection::open(dir.db()).unwrap();
        conn.execute_batch(MIGRATIONS[0].sql).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute(
            "INSERT INTO instruments (id, symbol_root, asset_class, point_value, created_at, updated_at)
             VALUES ('builtin:instrument:ES', 'XES', 'future', '1', 'x', 'x')",
            [],
        )
        .unwrap();
    }

    let rt = Runtime::start(Ok(dir.db()));
    assert_eq!(rt.status().state, RuntimeState::Failed);
    assert_eq!(category(&rt), FailureCategory::MigrationFailed);
    assert!(rt.status().failure.unwrap().retryable);
    drop(rt);
    assert_eq!(user_version(&dir.db()), 1, "the failed migration rolled back");
    let backup = dir.db().with_extension(format!("db.before-v{}.bak", db::latest_version()));
    assert_eq!(user_version(&backup), 1);
}

#[test]
fn an_unresolvable_data_directory_is_reported() {
    let rt = Runtime::start(Err("no home directory".into()));
    assert_eq!(rt.status().state, RuntimeState::Failed);
    assert_eq!(category(&rt), FailureCategory::DataDirectory);
    assert!(rt.status().failure.unwrap().detail.contains("no home directory"));
    assert!(matches!(count_accounts(&rt), Err(AppError::Unavailable { .. })));
}

#[test]
fn retry_when_ready_is_a_no_op() {
    let dir = TempDir::new();
    let rt = Runtime::start(Ok(dir.db()));
    let before = rt.status();
    assert_eq!(rt.initialize(), before);
    assert_eq!(count_accounts(&rt).unwrap(), 0);
}

#[test]
fn concurrent_retries_run_one_at_a_time() {
    let dir = TempDir::new();
    std::fs::create_dir_all(&dir.0).unwrap();
    std::fs::write(dir.db(), b"not a database".repeat(100)).unwrap();
    let rt = Runtime::start(Ok(dir.db()));
    std::fs::remove_file(dir.db()).unwrap();

    let results: Vec<RuntimeStatus> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..4).map(|_| s.spawn(|| rt.initialize())).collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    assert!(results.iter().all(|s| s.state == RuntimeState::Ready));
    assert_eq!(results.iter().filter(|s| s.created).count(), 4, "all see the one successful open");
    assert_eq!(count_accounts(&rt).unwrap(), 0);
}
