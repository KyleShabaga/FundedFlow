//! Upgrades of real journals. `fixtures/fundedflow-v3.db` was written by the
//! schema-v3 release (4e3c01f), before the weekend roll, and
//! `fixtures/fundedflow-v4.db` by the current release (aeafe1e); see
//! `fixtures/README.md`. Both are copied before use and never modified.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::*;
use crate::csv_import;
use crate::store::{accounts, journal, trades};

const V3: &[u8] = include_bytes!("fixtures/fundedflow-v3.db");
const V4: &[u8] = include_bytes!("fixtures/fundedflow-v4.db");

/// The Performance CSV both fixtures imported into "NY 17:00 eval".
const FIXTURE_CSV: &str = "symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
MNQZ6,-2,0,0.25,900000000001,900000000002,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,33sec
MNQZ6,-2,0,0.25,900000000003,900000000004,2,29800.00,29790.50,$(38.00),10/16/2026 17:10:00,10/16/2026 17:20:00,10min
MESZ6,-2,0,0.25,900000000005,900000000006,1,6010.25,6000.00,$(51.25),10/18/2026 18:05:00,10/18/2026 18:01:00,4min
MNQZ6,-2,0,0.25,900000000001,900000000002,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,33sec
MNQZ6,-2,0,0.25,900000000007,900000000008,1,abc,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,33sec
";

pub(super) struct Journal(pub(super) PathBuf);

impl Journal {
    pub(super) fn copy_of(bytes: &[u8]) -> Self {
        let dir = std::env::temp_dir().join(format!("fundedflow-upgrade-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(DB_FILE_NAME);
        std::fs::write(&path, bytes).unwrap();
        Journal(path)
    }
    pub(super) fn backup(&self) -> PathBuf {
        self.0.with_extension(format!("db.before-v{}.bak", latest_version()))
    }
}

impl Drop for Journal {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
    }
}

pub(super) fn read_only(path: &Path) -> Connection {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

pub(super) fn version(conn: &Connection) -> u32 {
    conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap()
}

/// Table → (columns, every row as sorted JSON text).
pub(super) type Dump = BTreeMap<String, (Vec<String>, Vec<String>)>;

fn rows(conn: &Connection, table: &str, columns: &[String]) -> Vec<String> {
    let quoted: Vec<String> = columns.iter().map(|c| format!("\"{c}\"")).collect();
    let sql = format!("SELECT json_array({}) FROM \"{table}\"", quoted.join(", "));
    let mut rows: Vec<String> =
        conn.prepare(&sql).unwrap().query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    rows.sort();
    rows
}

/// Every row of every table, leaving out the `skip` columns.
pub(super) fn dump(conn: &Connection, skip: &[(&str, &str)]) -> Dump {
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    tables
        .into_iter()
        .map(|table| {
            let columns: Vec<String> = conn
                .prepare("SELECT name FROM pragma_table_info(?1)")
                .unwrap()
                .query_map([&table], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .filter(|c| !skip.contains(&(table.as_str(), c.as_str())))
                .collect();
            let rows = rows(conn, &table, &columns);
            (table, (columns, rows))
        })
        .collect()
}

/// Tables migration 9 renamed: the legacy rulebook rows live on under these names.
pub(super) fn renamed(table: &str) -> &str {
    match table {
        "rulebook_versions" => "legacy_account_rulebook_versions",
        "rules" => "legacy_account_rules",
        other => other,
    }
}

/// The same tables and columns as `like`, read from `conn` (which may have
/// gained tables and columns since). A dump taken before migration 9 names
/// the legacy rulebook tables by their old names.
pub(super) fn dump_like(conn: &Connection, like: &Dump) -> Dump {
    let renamed_already = version(conn) >= 9;
    like.iter()
        .map(|(table, (columns, _))| {
            let source = if renamed_already { renamed(table) } else { table.as_str() };
            (table.clone(), (columns.clone(), rows(conn, source, columns)))
        })
        .collect()
}

/// `(account name, trade notes or entry time, trading day)` for every trade, deleted ones included.
fn trading_days(conn: &Connection) -> BTreeMap<(String, String), String> {
    conn.prepare(
        "SELECT a.name, coalesce(t.notes_md, t.entry_at), t.trading_day
         FROM trades t JOIN accounts a ON a.id = t.account_id",
    )
    .unwrap()
    .query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))
    .unwrap()
    .collect::<rusqlite::Result<_>>()
    .unwrap()
}

fn assert_healthy(conn: &Connection) {
    let ok: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(ok, "ok");
    let fk_problems: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
    assert_eq!(fk_problems, 0);
}

fn account_id(conn: &Connection, name: &str) -> String {
    conn.query_row("SELECT id FROM accounts WHERE name = ?1", [name], |r| r.get(0)).unwrap()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Migrations 6 and 7 on a journal from before the catalogue: each firm got a
/// provider and each programme a family, every account with a firm points at
/// its firm's provider, and nothing else was inferred.
fn assert_catalogue_mapped(conn: &Connection, before: &Dump) {
    let rows_before = |table: &str| before[table].1.len() as i64;
    assert_eq!(count(conn, "SELECT count(*) FROM providers"), rows_before("firms"));
    assert_eq!(count(conn, "SELECT count(*) FROM programme_families"), rows_before("programmes"));
    assert_eq!(
        count(conn, "SELECT count(*) FROM providers p JOIN firms f ON f.id = p.legacy_firm_id
                     WHERE p.display_name = f.name AND p.record_status = 'unknown' AND p.aliases = '[]'"),
        rows_before("firms")
    );
    let slugs: Vec<String> =
        conn.prepare("SELECT slug FROM providers ORDER BY slug").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    assert_eq!(slugs, ["apex"]);
    assert_eq!(
        count(conn, "SELECT count(*) FROM accounts a WHERE a.provider_id IS NOT
                     (SELECT p.id FROM providers p WHERE p.legacy_firm_id = a.firm_id)"),
        0
    );
    assert!(count(conn, "SELECT count(*) FROM accounts WHERE provider_id IS NOT NULL") > 0);
    assert_eq!(
        count(conn, "SELECT count(*) FROM accounts WHERE programme_variant_id IS NOT NULL
                     OR catalogue_version_id IS NOT NULL OR selected_phase_path_id IS NOT NULL
                     OR size_source <> 'unknown'"),
        0,
        "no catalogue match is guessed"
    );
    for table in [
        "programme_variants", "catalogue_versions", "catalogue_sources", "programme_phases", "phase_paths",
        "commercial_offers", "promotions", "account_phase_events",
    ] {
        assert_eq!(count(conn, &format!("SELECT count(*) FROM {table}")), 0, "{table}");
    }
}

/// The upgraded journal still works through the store: lists, a new write
/// with the current rules, and a re-import that finds every saved trade by
/// its original dedup key.
fn assert_store_works(conn: &mut Connection) {
    let ny = account_id(conn, "NY 17:00 eval");
    assert_eq!(trades::list(conn, &ny).unwrap().len(), 7);
    let entries = journal::list(conn, &ny).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].tags, ["es", "patience"]);

    let again = csv_import::commit(
        conn,
        &serde_json::from_value(serde_json::json!({
            "accountId": ny, "fileName": "Performance.csv", "content": FIXTURE_CSV, "timezone": "America/New_York"
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!((again.imported_count, again.duplicate_count, again.failed_count), (0, 4, 1));
    assert_eq!(csv_import::list_batches(conn, &ny).unwrap().len(), 2);

    let saturday = trades::create(
        conn,
        serde_json::from_value(serde_json::json!({
            "accountId": ny, "symbol": "MESZ6", "side": "long", "quantity": "1",
            "entryAt": "2026-10-24T14:00:00Z", "entryPrice": "6000", "exitAt": null, "exitPrice": null,
            "fees": null, "realizedPnl": null, "notes": null
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(saturday.trading_day, "2026-10-26");
}

#[test]
fn a_v3_journal_from_before_the_weekend_roll_upgrades_without_data_loss() {
    let db = Journal::copy_of(V3);
    let (before, days_before) = {
        let conn = read_only(&db.0);
        assert_eq!(version(&conn), 3);
        (dump(&conn, &[("trades", "trading_day")]), trading_days(&conn))
    };

    let mut conn = open_file(&db.0).unwrap();
    assert_eq!(version(&conn), latest_version());
    assert_healthy(&conn);
    assert_eq!(version(&read_only(&db.backup())), 3, "the backup is the journal as it was");

    // Nothing but trading_day changed, and 0004's archived_at is unset everywhere.
    assert_eq!(dump_like(&conn, &before), before);
    let archived: i64 = conn.query_row("SELECT count(*) FROM accounts WHERE archived_at IS NOT NULL", [], |r| r.get(0)).unwrap();
    assert_eq!(archived, 0);
    assert_catalogue_mapped(&conn, &before);

    // Exactly the trades the documented rules put on a weekend move to Monday.
    let days_after = trading_days(&conn);
    let changed: BTreeMap<_, _> = days_before
        .iter()
        .filter(|(k, v)| days_after[*k] != **v)
        .map(|(k, v)| (k.1.as_str(), (v.as_str(), days_after[k].as_str())))
        .collect();
    let sat_to_mon = ("2026-10-17", "2026-10-19");
    assert_eq!(
        changed,
        BTreeMap::from([
            ("legacy fri", sat_to_mon),               // Fri 07:00 NY after a legacy 06:00 reset
            ("fri after reset", sat_to_mon),          // Fri 17:30 NY after the 17:00 reset
            ("2026-10-16T21:10:00.000Z", sat_to_mon), // imported, sold Fri 17:20 NY
            ("deleted", sat_to_mon),                  // soft-deleted, Fri 18:05 NY
            ("open sat", sat_to_mon),                 // open, entered Sat 10:00 NY
            ("unknown sat", sat_to_mon),              // Sat 10:00 UTC, calendar days
        ])
    );

    assert_store_works(&mut conn);
}

#[test]
fn a_v4_journal_from_the_current_release_upgrades_without_changes() {
    let db = Journal::copy_of(V4);
    let before = {
        let conn = read_only(&db.0);
        assert_eq!(version(&conn), 4);
        dump(&conn, &[])
    };

    let mut conn = open_file(&db.0).unwrap();
    assert_eq!(version(&conn), latest_version());
    assert_healthy(&conn);
    assert_eq!(version(&read_only(&db.backup())), 4);
    // This release already stored rolled days, so the re-derive changes nothing,
    // and the catalogue migrations only add tables and columns.
    assert_eq!(dump_like(&conn, &before), before);
    assert_catalogue_mapped(&conn, &before);
    // The archived account and its trade are kept, hidden from the store.
    assert_eq!(accounts::list(&conn).unwrap().len(), 2);
    assert_eq!(trading_days(&conn)[&("Archived".into(), "archived fri".into())], "2026-10-19");

    assert_store_works(&mut conn);
}

#[test]
fn reopening_an_upgraded_journal_is_a_no_op() {
    let db = Journal::copy_of(V3);
    drop(open_file(&db.0).unwrap());
    std::fs::remove_file(db.backup()).unwrap();
    let before = dump(&read_only(&db.0), &[]);

    let mut conn = open_file(&db.0).unwrap();
    assert!(!db.backup().exists(), "no backup when nothing is pending");
    assert_eq!(dump(&conn, &[]), before);
    assert_eq!(migrate(&mut conn).unwrap(), latest_version());
    assert_eq!(rederive_trading_days(&conn).unwrap(), 0, "the re-derive is idempotent");
    map_legacy_catalogue(&conn).unwrap();
    assert_eq!(dump(&conn, &[]), before, "the catalogue mapping is idempotent");
}

#[test]
fn restoring_the_pre_upgrade_backup_gives_back_the_old_journal_and_upgrades_again() {
    let db = Journal::copy_of(V3);
    let original = dump(&read_only(&db.0), &[]);
    let upgraded = {
        let conn = open_file(&db.0).unwrap();
        dump(&conn, &[])
    };
    let rows = |d: &Dump| d.iter().map(|(t, (_, r))| (t.clone(), r.len())).collect::<BTreeMap<_, _>>();

    // Restore: the backup replaces the journal, as a user would copy it back.
    std::fs::copy(db.backup(), &db.0).unwrap();
    for side in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(db.0.with_extension(side));
    }
    let restored = read_only(&db.0);
    assert_eq!(version(&restored), 3);
    assert_eq!(dump(&restored, &[]), original, "the backup is the journal exactly as it was");
    drop(restored);

    // Opening the restored journal upgrades it to the same result as the first
    // time: identical original data, and the same rows in the tables migrations
    // add (whose new IDs and timestamps differ per run).
    let conn = open_file(&db.0).unwrap();
    assert_eq!(version(&conn), latest_version());
    assert_healthy(&conn);
    assert_eq!(dump_like(&conn, &original), dump_like_from(&upgraded, &original));
    assert_eq!(rows(&dump(&conn, &[])), rows(&upgraded));
}

/// `like`'s tables and columns, taken from an existing dump.
fn dump_like_from(from: &Dump, like: &Dump) -> Dump {
    like.iter()
        .map(|(table, (columns, _))| {
            let (all, rows) = &from[renamed(table)];
            let idx: Vec<usize> = columns.iter().map(|c| all.iter().position(|a| a == c).unwrap()).collect();
            let mut rows: Vec<String> = rows
                .iter()
                .map(|r| {
                    let v: Vec<serde_json::Value> = serde_json::from_str(r).unwrap();
                    serde_json::to_string(&idx.iter().map(|&i| v[i].clone()).collect::<Vec<_>>()).unwrap()
                })
                .collect();
            rows.sort();
            (table.clone(), (columns.clone(), rows))
        })
        .collect()
}

#[test]
fn a_failure_during_the_rederive_leaves_the_journal_at_the_previous_version() {
    let db = Journal::copy_of(V3);
    {
        // Migrate to v4 only, then make any trading_day update fail.
        let mut conn = Connection::open(&db.0).unwrap();
        migrate_with(&mut conn, &MIGRATIONS[..4]).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER boom BEFORE UPDATE OF trading_day ON trades
             BEGIN SELECT RAISE(ABORT, 'disk full (simulated)'); END;",
        )
        .unwrap();
    }
    let before = dump(&read_only(&db.0), &[]);

    let err = open_file(&db.0).unwrap_err();
    assert!(matches!(err, MigrateError::Migration { name: "rederive_trading_days", .. }), "{err}");
    let conn = read_only(&db.0);
    assert_eq!(version(&conn), 4);
    assert_eq!(dump(&conn, &[]), before, "no trade was partly corrected");
}

#[test]
fn the_rederive_skips_rows_it_cannot_parse() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO accounts (id, name, starting_balance_micros, timezone, trading_day_reset_time, created_at, updated_at)
         VALUES ('ok', 'ok', 0, 'America/New_York', '17:00', 'x', 'x'),
                ('bad', 'bad', 0, 'Mars/Olympus', '17:00', 'x', 'x');
         INSERT INTO trades (id, account_id, source, symbol, side, quantity, entry_at, entry_price, fees_micros,
                             trading_day, pnl_status, created_at, updated_at)
         VALUES ('t1', 'ok', 'manual', 'ES', 'long', '1', '2026-10-17T14:00:00.000Z', '1', 0, '2026-10-17', 'open', 'x', 'x'),
                ('t2', 'bad', 'manual', 'ES', 'long', '1', '2026-10-17T14:00:00.000Z', '1', 0, '2026-10-17', 'open', 'x', 'x');",
    )
    .unwrap();
    assert_eq!(rederive_trading_days(&conn).unwrap(), 1);
    let day = |id: &str| -> String { conn.query_row("SELECT trading_day FROM trades WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
    assert_eq!((day("t1").as_str(), day("t2").as_str()), ("2026-10-19", "2026-10-17"));
}

/// Upgrade a copy of a real journal. Read-only on the source: it is copied
/// with `VACUUM INTO` first. Run with
/// `FUNDEDFLOW_UPGRADE_DB=%APPDATA%\com.fundedflow.desktop\fundedflow.db cargo test --lib upgrade_copy -- --ignored --nocapture`.
#[test]
#[ignore]
fn upgrade_copy_of_a_real_journal() {
    let source = PathBuf::from(std::env::var("FUNDEDFLOW_UPGRADE_DB").expect("FUNDEDFLOW_UPGRADE_DB"));
    let db = Journal::copy_of(&[]);
    std::fs::remove_file(&db.0).unwrap();
    let by_id = |conn: &Connection| -> BTreeMap<String, (String, String)> {
        conn.prepare("SELECT id, exit_at IS NULL, trading_day FROM trades")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, (if r.get(1)? { "open" } else { "closed" }.to_string(), r.get(2)?))))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    let (from, before, days_before) = {
        let src = read_only(&source);
        src.execute("VACUUM INTO ?1", [db.0.to_string_lossy()]).unwrap();
        let copy = read_only(&db.0);
        (version(&copy), dump(&copy, &[("trades", "trading_day")]), by_id(&copy))
    };
    let conn = open_file(&db.0).unwrap();
    assert_healthy(&conn);
    assert_eq!(dump_like(&conn, &before), before);
    let days_after = by_id(&conn);
    let changed: Vec<_> = days_before.iter().filter(|(k, v)| days_after[*k].1 != v.1).collect();
    let rows: usize = before.values().map(|(_, rows)| rows.len()).sum();
    println!("v{from} -> v{}: {rows} rows kept, {} trading days corrected", version(&conn), changed.len());
    for (id, (state, day)) in changed {
        println!("  trade {id} ({state}): {day} -> {}", days_after[id].1);
    }
}
