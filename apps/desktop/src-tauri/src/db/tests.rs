//! Schema-level guarantees the rest of the app relies on.

use super::*;
use rusqlite::{Connection, params};

const T: &str = "2026-10-19T14:30:00.000Z";

pub(crate) fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn seed_account(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO accounts (id, name, broker, external_ref, starting_balance_micros, timezone,
                               created_at, updated_at)
         VALUES (?1, 'Eval 50K', 'Tradovate', ?1, 50000000000, 'America/New_York', ?2, ?2)",
        params![id, T],
    )
    .unwrap();
}

fn seed_batch(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO import_batches (id, account_id, file_name, file_sha256, file_size, mapping_snapshot_json,
                                     source_timezone, status, created_at, completed_at)
         VALUES (?1, 'acc1', 'trades.csv', ?2, 120, '{}', 'America/New_York', 'committed', ?3, ?3)",
        params![id, "a".repeat(64), T],
    )
    .unwrap();
}

/// A closed MNQ long: (21010.25 − 21000.25) × 2 × $2 = $40 gross, $1.24 fees.
fn insert_imported_trade(conn: &Connection, id: &str, dedup_key: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO trades (id, account_id, source, import_batch_id, dedup_key, symbol, side, quantity,
                             entry_at, entry_price, exit_at, exit_price, fees_micros, trading_day,
                             gross_pnl_micros, net_pnl_micros, pnl_status, created_at, updated_at)
         VALUES (?1, 'acc1', 'csv_import', 'batch1', ?2, 'MNQZ6', 'long', '2',
                 '2026-10-19T14:30:05.123Z', '21000.25', '2026-10-19T14:35:00.000Z', '21010.25', 1240000,
                 '2026-10-19', 40000000, 38760000, 'calculated', ?3, ?3)",
        params![id, dedup_key, T],
    )
}

fn setup_trading() -> Connection {
    let conn = db();
    seed_account(&conn, "acc1");
    seed_batch(&conn, "batch1");
    insert_imported_trade(&conn, "t1", "h:abc").unwrap();
    conn
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn migrations_apply_cleanly_and_are_idempotent() {
    let mut conn = db();
    let v: u32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(v, latest_version());
    // Second run is a no-op.
    assert_eq!(migrate(&mut conn).unwrap(), latest_version());
    let ok: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ok, "ok");
    assert_eq!(count(&conn, "pragma_foreign_key_check"), 0);
    let fk_on: i64 = conn
        .pragma_query_value(None, "foreign_keys", |r| r.get(0))
        .unwrap();
    assert_eq!(fk_on, 1);
    let instruments: i64 = conn
        .query_row(
            "SELECT count(*) FROM instruments WHERE is_built_in = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(instruments >= 10);
}

#[test]
fn refuses_newer_schema() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "user_version", 999).unwrap();
    assert!(matches!(
        migrate(&mut conn),
        Err(MigrateError::NewerSchema { found: 999, .. })
    ));
}

#[test]
fn failed_migration_leaves_the_previous_version_intact() {
    let migrations = [
        Migration {
            version: 1,
            name: "one",
            step: Step::Sql("CREATE TABLE a (x INTEGER);"),
        },
        Migration {
            version: 2,
            name: "two",
            step: Step::Sql("CREATE TABLE b (x INTEGER); SELECT nope FROM missing;"),
        },
    ];
    let mut conn = Connection::open_in_memory().unwrap();
    let err = migrate_with(&mut conn, &migrations).unwrap_err();
    assert!(matches!(err, MigrateError::Migration { name: "two", .. }));
    let v: u32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(v, 1);
    let b_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name = 'b'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        b_exists, 0,
        "the failed migration's DDL must be rolled back"
    );
}

#[test]
fn open_file_creates_the_journal_and_backs_up_before_upgrading() {
    let dir = std::env::temp_dir().join(format!("fundedflow-test-{}", uuid::Uuid::now_v7()));
    let path = dir.join("nested").join(DB_FILE_NAME);

    // An existing journal at schema version 1.
    {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut conn = Connection::open(&path).unwrap();
        migrate_with(&mut conn, &MIGRATIONS[..1]).unwrap();
    }
    let conn = open_file(&path).unwrap();
    let v: u32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(v, latest_version());
    let mode: String = conn
        .pragma_query_value(None, "journal_mode", |r| r.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    let backup = path.with_extension(format!("db.before-v{}.bak", latest_version()));
    assert!(backup.exists(), "expected a backup at {}", backup.display());
    let backup_version: u32 = Connection::open(&backup)
        .unwrap()
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(backup_version, 1);
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reimporting_the_same_trade_conflicts_per_account() {
    let conn = setup_trading();
    assert!(insert_imported_trade(&conn, "t2", "h:abc").is_err());
    assert_eq!(count(&conn, "trades"), 1);
    // Manual trades carry no dedup key and never conflict.
    let manual = "INSERT INTO trades (id, account_id, source, symbol, side, quantity, entry_at, entry_price,
                                      trading_day, pnl_status, created_at, updated_at)
                  VALUES (?1, 'acc1', 'manual', 'ES', 'short', '1', ?2, '5000', '2026-10-19', 'open', ?2, ?2)";
    conn.execute(manual, params!["m1", T]).unwrap();
    conn.execute(manual, params!["m2", T]).unwrap();
}

#[test]
fn trade_constraints_reject_inconsistent_rows() {
    let conn = setup_trading();
    let attempt = |sql: &str| {
        conn.execute(&format!("UPDATE trades SET {sql} WHERE id = 't1'"), [])
            .is_err()
    };
    assert!(attempt("net_pnl_micros = 1"), "net must equal gross − fees");
    assert!(
        attempt("exit_price = NULL"),
        "exit time and price go together"
    );
    assert!(
        attempt("exit_at = '2026-10-19T14:00:00.000Z'"),
        "exit before entry"
    );
    assert!(attempt("quantity = '-1'"), "quantity must be positive");
    assert!(attempt("quantity = '1.2.3'"));
    assert!(attempt("entry_price = '1e5'"));
    assert!(
        attempt("entry_at = '2026-10-19 14:30'"),
        "instants are canonical UTC"
    );
    assert!(
        attempt("pnl_status = 'open'"),
        "a closed trade cannot be open"
    );
    assert!(
        attempt("account_id = 'other'"),
        "trades never move between accounts"
    );
    assert!(attempt("dedup_key = 'x'"), "import provenance is immutable");
    // Editable fields can change.
    conn.execute("UPDATE trades SET notes_md = 'late entry', fees_micros = 0, net_pnl_micros = 40000000 WHERE id = 't1'", [])
        .unwrap();
}

#[test]
fn original_import_rows_are_immutable() {
    let conn = setup_trading();
    conn.execute(
        "INSERT INTO import_rows (id, batch_id, row_number, line_number, raw_json, status)
         VALUES ('r1', 'batch1', 1, 2, '[\"a\"]', 'invalid')",
        [],
    )
    .unwrap();
    assert!(
        conn.execute(
            "UPDATE import_rows SET raw_json = '[\"b\"]' WHERE id = 'r1'",
            []
        )
        .is_err()
    );
}

#[test]
fn round_trip_sources_are_immutable() {
    let conn = setup_trading();
    conn.execute(
        "INSERT INTO trade_round_trips (trade_id, buy_fill_id, sell_fill_id, buy_price, sell_price, bought_at,
                                        sold_at, bought_at_source, sold_at_source, entry_basis)
         VALUES ('t1', 'b1', 's1', '21000.25', '21010.25', '2026-10-19T14:30:05.123Z', '2026-10-19T14:35:00.000Z',
                 '10/19/2026 10:30:05', '10/19/2026 10:35:00', 'buy_first')",
        [],
    )
    .unwrap();
    let err = conn
        .execute(
            "UPDATE trade_round_trips SET sell_price = '1' WHERE trade_id = 't1'",
            [],
        )
        .unwrap_err();
    assert!(err.to_string().contains("immutable"), "{err}");
}

#[test]
fn journal_trade_must_belong_to_the_same_account() {
    let conn = setup_trading();
    seed_account(&conn, "acc2");
    let insert = |id: &str, account: &str, trade: Option<&str>| {
        conn.execute(
            "INSERT INTO journal_entries (id, account_id, trade_id, entry_at, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'Review', ?4, ?4)",
            params![id, account, trade, T],
        )
    };
    insert("j1", "acc1", Some("t1")).unwrap();
    insert("j2", "acc1", None).unwrap();
    assert!(insert("j3", "acc2", Some("t1")).is_err());
    assert!(
        conn.execute(
            "UPDATE journal_entries SET account_id = 'acc2' WHERE id = 'j1'",
            []
        )
        .is_err()
    );
    assert!(
        conn.execute(
            "INSERT INTO journal_entries (id, account_id, entry_at, title, created_at, updated_at)
             VALUES ('j4', 'acc1', ?1, '   ', ?1, ?1)",
            [T],
        )
        .is_err(),
        "title is required"
    );
}

#[test]
fn deleting_an_account_removes_everything_it_owns() {
    let conn = setup_trading();
    conn.execute_batch(&format!(
        "INSERT INTO import_rows (id, batch_id, row_number, line_number, raw_json, status)
           VALUES ('r1', 'batch1', 1, 2, '[]', 'imported');
         INSERT INTO journal_entries (id, account_id, trade_id, entry_at, title, created_at, updated_at)
           VALUES ('j1', 'acc1', 't1', '{T}', 'Review', '{T}', '{T}');
         INSERT INTO tags (id, name, created_at, updated_at) VALUES ('tag1', 'fomo', '{T}', '{T}');
         INSERT INTO journal_entry_tags (journal_entry_id, tag_id, created_at) VALUES ('j1', 'tag1', '{T}');
         INSERT INTO trade_reviews (id, trade_id, account_id, created_at, updated_at) VALUES ('tr1', 't1', 'acc1', '{T}', '{T}');
         INSERT INTO trade_corrections (id, trade_id, account_id, kind, corrected_at, actor)
           VALUES ('c1', 't1', 'acc1', 'edit', '{T}', 'local_user');
         INSERT INTO account_status_events (id, account_id, status, effective_at, created_at)
           VALUES ('s1', 'acc1', 'active', '{T}', '{T}');
         INSERT INTO legacy_account_rulebook_versions (id, account_id, version_number, effective_from, created_at, updated_at)
           VALUES ('rv1', 'acc1', 1, '2026-11-01', '{T}', '{T}');
         INSERT INTO legacy_account_rules (id, rulebook_version_id, rule_type, created_at, updated_at)
           VALUES ('r1', 'rv1', 'profit_target', '{T}', '{T}');
         UPDATE legacy_account_rulebook_versions SET status = 'active', activated_at = '{T}' WHERE id = 'rv1';
         INSERT INTO rulebooks (id, owner_account_id, slug, display_name, record_status, created_at, updated_at)
           VALUES ('rb1', 'acc1', 'acc1-rules', 'Rules', 'active', '{T}', '{T}');
         INSERT INTO rulebook_versions (id, rulebook_id, version_number, schema_version, verification_status, origin,
                                        captured_at, record_status, created_at, updated_at)
           VALUES ('nv1', 'rb1', 1, 1, 'draft', 'user_authored', '{T}', 'active', '{T}', '{T}');
         INSERT INTO rule_definitions (id, rulebook_version_id, rule_key, rule_type, parameter_schema_version,
                                       parameters_json, support_status, display_order, created_at, updated_at)
           VALUES ('nr1', 'nv1', 'max_trades_per_day', 'max_trades_per_day', 1,
                   '{{\"count\":{{\"state\":\"value\",\"value\":3}}}}', 'supported', 0, '{T}', '{T}');
         UPDATE rulebook_versions SET verification_status = 'needs_review' WHERE id = 'nv1';
         INSERT INTO account_rulebook_assignments (id, account_id, rulebook_version_id, effective_from, assigned_at,
                                                   assignment_source)
           VALUES ('as1', 'acc1', 'nv1', '2026-10-01', '{T}', 'user');"
    ))
    .unwrap();

    // Cascades through trades, imports, journal and rulebooks (frozen-rule
    // triggers allow the cascade because the parent version is deleted first).
    conn.execute("DELETE FROM accounts WHERE id = 'acc1'", [])
        .unwrap();
    for table in [
        "trades",
        "import_batches",
        "import_rows",
        "journal_entries",
        "journal_entry_tags",
        "trade_reviews",
        "trade_corrections",
        "account_status_events",
        "legacy_account_rulebook_versions",
        "legacy_account_rules",
        "rulebooks",
        "rulebook_versions",
        "rule_definitions",
        "account_rulebook_assignments",
    ] {
        assert_eq!(count(&conn, table), 0, "{table} should be empty");
    }
    assert_eq!(
        count(&conn, "tags"),
        1,
        "tags are shared and outlive the account"
    );
}

#[test]
fn hard_deleting_a_trade_unlinks_journal_entries() {
    let conn = setup_trading();
    conn.execute(
        "INSERT INTO journal_entries (id, account_id, trade_id, entry_at, title, created_at, updated_at)
         VALUES ('j1', 'acc1', 't1', ?1, 'Review', ?1, ?1)",
        [T],
    )
    .unwrap();
    conn.execute("DELETE FROM trades WHERE id = 't1'", [])
        .unwrap();
    let trade: Option<String> = conn
        .query_row(
            "SELECT trade_id FROM journal_entries WHERE id = 'j1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(trade, None);
}

#[test]
fn activated_legacy_rulebooks_are_frozen() {
    let conn = db();
    seed_account(&conn, "acc1");
    conn.execute_batch(&format!(
        "INSERT INTO legacy_account_rulebook_versions (id, account_id, version_number, effective_from, created_at, updated_at)
           VALUES ('rv1', 'acc1', 1, '2026-10-01', '{T}', '{T}');
         INSERT INTO legacy_account_rules (id, rulebook_version_id, rule_type, params_json, created_at, updated_at)
           VALUES ('r1', 'rv1', 'max_drawdown',
                   '{{\"mode\":\"eod_trailing\",\"amount_micros\":2000000000,\"includes_unrealized\":false,\"lock\":null}}',
                   '{T}', '{T}');
         UPDATE legacy_account_rules SET label = 'Trailing DD' WHERE id = 'r1';
         UPDATE legacy_account_rulebook_versions SET status = 'active', activated_at = '{T}' WHERE id = 'rv1';"
    ))
    .unwrap();

    assert!(
        conn.execute(
            "UPDATE legacy_account_rules SET params_json = '{}' WHERE id = 'r1'",
            []
        )
        .is_err()
    );
    assert!(
        conn.execute("DELETE FROM legacy_account_rules WHERE id = 'r1'", [])
            .is_err()
    );
    assert!(conn
        .execute(
            &format!("INSERT INTO legacy_account_rules (id, rulebook_version_id, rule_type, created_at, updated_at)
                      VALUES ('r2', 'rv1', 'profit_target', '{T}', '{T}')"),
            [],
        )
        .is_err());
    assert!(conn
        .execute("UPDATE legacy_account_rulebook_versions SET effective_from = '2026-09-01' WHERE id = 'rv1'", [])
        .is_err());
    // Retiring is the one allowed transition.
    conn.execute("UPDATE legacy_account_rulebook_versions SET status = 'retired', updated_at = 'x' WHERE id = 'rv1'", [])
        .unwrap();
}

#[test]
fn legacy_manual_check_rules_require_manual_confirmation() {
    let conn = db();
    seed_account(&conn, "acc1");
    conn.execute(
        &format!("INSERT INTO legacy_account_rulebook_versions (id, account_id, version_number, effective_from, created_at, updated_at)
                  VALUES ('rv1', 'acc1', 1, '2026-10-01', '{T}', '{T}')"),
        [],
    )
    .unwrap();
    let calculated = conn.execute(
        &format!("INSERT INTO legacy_account_rules (id, rulebook_version_id, rule_type, evaluation, created_at, updated_at)
                  VALUES ('r1', 'rv1', 'manual_check', 'calculated', '{T}', '{T}')"),
        [],
    );
    assert!(calculated.is_err());
}

#[test]
fn audit_events_are_append_only() {
    let conn = db();
    conn.execute(
        "INSERT INTO audit_events (id, occurred_at, action, entity_type, summary)
         VALUES ('a1', ?1, 'import.committed', 'import_batch', 'Imported 12 trades')",
        params![T],
    )
    .unwrap();
    assert!(
        conn.execute("UPDATE audit_events SET summary = 'x'", [])
            .is_err()
    );
}

#[test]
fn attachment_keys_must_be_relative() {
    let conn = db();
    for key in ["C:\\Users\\me\\shot.png", "/etc/passwd", "../escape.png"] {
        let r = conn.execute(
            "INSERT INTO attachments (id, kind, storage_key, mime_type, byte_size, sha256, created_at, updated_at)
             VALUES (?1, 'screenshot', ?1, 'image/png', 1, ?2, ?3, ?3)",
            params![key, "b".repeat(64), T],
        );
        assert!(r.is_err(), "{key} should be rejected");
    }
}

/// Migration 11 on a version-10 journal: archived accounts gain their archive
/// history, existing rows and numbers are untouched, and the broker-number rule
/// now lets a failed account share its number with a live one.
#[test]
fn migration_11_upgrades_a_v10_journal_without_changing_its_rows() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate_with(&mut conn, &MIGRATIONS[..10]).unwrap();
    conn.execute(
        "INSERT INTO accounts (id, name, broker, external_ref, starting_balance_micros, timezone, status, created_at, updated_at)
         VALUES ('failed', 'Old', 'Tradovate', '777', 50000000000, 'America/New_York', 'failed', ?1, ?1)",
        [T],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO accounts (id, name, broker, external_ref, starting_balance_micros, timezone, created_at, updated_at, archived_at)
         VALUES ('archived', 'Hidden', 'Tradovate', '888', 50000000000, 'America/New_York', ?1, ?1, ?1)",
        [T],
    )
    .unwrap();
    // Before: the failed account still blocks a new account with its number.
    let blocked = conn.execute(
        "INSERT INTO accounts (id, name, broker, external_ref, starting_balance_micros, timezone, created_at, updated_at)
         VALUES ('live', 'Next', 'Tradovate', '777', 50000000000, 'America/New_York', ?1, ?1)",
        [T],
    );
    assert!(blocked.is_err());

    assert_eq!(migrate_with(&mut conn, &MIGRATIONS[..11]).unwrap(), 11);
    let accounts: i64 = conn
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(accounts, 2);
    let archive_events: Vec<(String, String, String)> = conn
        .prepare("SELECT account_id, action, occurred_at FROM account_archive_events")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        archive_events,
        [("archived".into(), "archived".into(), T.into())]
    );
    // After: the same number is allowed beside a failed account, but not beside another live one.
    conn.execute(
        "INSERT INTO accounts (id, name, broker, external_ref, starting_balance_micros, timezone, created_at, updated_at)
         VALUES ('live', 'Next', 'Tradovate', '777', 50000000000, 'America/New_York', ?1, ?1)",
        [T],
    )
    .unwrap();
    let dup = conn.execute(
        "INSERT INTO accounts (id, name, broker, external_ref, starting_balance_micros, timezone, created_at, updated_at)
         VALUES ('live2', 'Dup', 'Tradovate', '777', 50000000000, 'America/New_York', ?1, ?1)",
        [T],
    );
    assert!(dup.is_err());
}
