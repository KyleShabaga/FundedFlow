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

/// The Performance CSV both fixtures imported into "NY 17:00 eval", with the same fill IDs and row
/// order. Prices, times, P&L text and durations are invented (TASK-041); a re-import matches saved
/// trades by fill-pair key alone (`csv_import/dedup.rs`), so the duplicate counts are unchanged.
const FIXTURE_CSV: &str = "symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
MNQZ6,-2,0,0.25,900000000001,900000000002,1,24387.25,24396.00,$17.50,10/19/2026 07:12:15,10/19/2026 07:13:00,45sec
MNQZ6,-2,0,0.25,900000000003,900000000004,2,29800.00,29790.50,$(38.00),10/16/2026 17:10:00,10/16/2026 17:20:00,10min
MESZ6,-2,0,0.25,900000000005,900000000006,1,6010.25,6000.00,$(51.25),10/18/2026 18:05:00,10/18/2026 18:01:00,4min
MNQZ6,-2,0,0.25,900000000001,900000000002,1,24387.25,24396.00,$17.50,10/19/2026 07:12:15,10/19/2026 07:13:00,45sec
MNQZ6,-2,0,0.25,900000000007,900000000008,1,abc,24396.00,$17.50,10/19/2026 07:12:15,10/19/2026 07:13:00,45sec
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
        self.0
            .with_extension(format!("db.before-v{}.bak", latest_version()))
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
    conn.pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap()
}

/// Table → (columns, every row as sorted JSON text).
pub(super) type Dump = BTreeMap<String, (Vec<String>, Vec<String>)>;

fn rows(conn: &Connection, table: &str, columns: &[String]) -> Vec<String> {
    let quoted: Vec<String> = columns.iter().map(|c| format!("\"{c}\"")).collect();
    let sql = format!("SELECT json_array({}) FROM \"{table}\"", quoted.join(", "));
    let mut rows: Vec<String> = conn
        .prepare(&sql)
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
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
            let source = if renamed_already {
                renamed(table)
            } else {
                table.as_str()
            };
            (
                table.clone(),
                (columns.clone(), rows(conn, source, columns)),
            )
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
    let ok: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ok, "ok");
    let fk_problems: i64 = conn
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(fk_problems, 0);
}

fn account_id(conn: &Connection, name: &str) -> String {
    conn.query_row("SELECT id FROM accounts WHERE name = ?1", [name], |r| {
        r.get(0)
    })
    .unwrap()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Migrations 6 and 7 on a journal from before the catalogue: each firm got a
/// provider and each programme a family, every account with a firm points at
/// its firm's provider, and nothing else was inferred.
fn assert_catalogue_mapped(conn: &Connection, before: &Dump) {
    let rows_before = |table: &str| before[table].1.len() as i64;
    assert_eq!(
        count(conn, "SELECT count(*) FROM providers"),
        rows_before("firms")
    );
    assert_eq!(
        count(conn, "SELECT count(*) FROM programme_families"),
        rows_before("programmes")
    );
    assert_eq!(
        count(conn, "SELECT count(*) FROM providers p JOIN firms f ON f.id = p.legacy_firm_id
                     WHERE p.display_name = f.name AND p.record_status = 'unknown' AND p.aliases = '[]'"),
        rows_before("firms")
    );
    let slugs: Vec<String> = conn
        .prepare("SELECT slug FROM providers ORDER BY slug")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(slugs, ["apex"]);
    assert_eq!(
        count(
            conn,
            "SELECT count(*) FROM accounts a WHERE a.provider_id IS NOT
                     (SELECT p.id FROM providers p WHERE p.legacy_firm_id = a.firm_id)"
        ),
        0
    );
    assert!(
        count(
            conn,
            "SELECT count(*) FROM accounts WHERE provider_id IS NOT NULL"
        ) > 0
    );
    assert_eq!(
        count(
            conn,
            "SELECT count(*) FROM accounts WHERE programme_variant_id IS NOT NULL
                     OR catalogue_version_id IS NOT NULL OR selected_phase_path_id IS NOT NULL
                     OR size_source <> 'unknown'"
        ),
        0,
        "no catalogue match is guessed"
    );
    for table in [
        "programme_variants",
        "catalogue_versions",
        "catalogue_sources",
        "programme_phases",
        "phase_paths",
        "commercial_offers",
        "promotions",
        "account_phase_events",
    ] {
        assert_eq!(
            count(conn, &format!("SELECT count(*) FROM {table}")),
            0,
            "{table}"
        );
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

    let again = csv_import::commit_reviewed(
        conn,
        &serde_json::from_value(serde_json::json!({
            "accountId": ny, "fileName": "Performance.csv", "content": FIXTURE_CSV, "timezone": "America/New_York"
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        (
            again.imported_count,
            again.duplicate_count,
            again.failed_count
        ),
        (0, 4, 1)
    );
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
        (
            dump(&conn, &[("trades", "trading_day")]),
            trading_days(&conn),
        )
    };

    let mut conn = open_file(&db.0).unwrap();
    assert_eq!(version(&conn), latest_version());
    assert_healthy(&conn);
    assert_eq!(
        version(&read_only(&db.backup())),
        3,
        "the backup is the journal as it was"
    );

    // Nothing but trading_day changed, and 0004's archived_at is unset everywhere.
    assert_eq!(dump_like(&conn, &before), before);
    let archived: i64 = conn
        .query_row(
            "SELECT count(*) FROM accounts WHERE archived_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
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
            ("legacy fri", sat_to_mon),      // Fri 07:00 NY after a legacy 06:00 reset
            ("fri after reset", sat_to_mon), // Fri 17:30 NY after the 17:00 reset
            ("2026-10-16T21:10:00.000Z", sat_to_mon), // imported, sold Fri 17:20 NY
            ("deleted", sat_to_mon),         // soft-deleted, Fri 18:05 NY
            ("open sat", sat_to_mon),        // open, entered Sat 10:00 NY
            ("unknown sat", sat_to_mon),     // Sat 10:00 UTC, calendar days
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
    assert_eq!(
        trading_days(&conn)[&("Archived".into(), "archived fri".into())],
        "2026-10-19"
    );

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
    assert_eq!(
        rederive_trading_days(&conn).unwrap(),
        0,
        "the re-derive is idempotent"
    );
    map_legacy_catalogue(&conn).unwrap();
    assert_eq!(
        dump(&conn, &[]),
        before,
        "the catalogue mapping is idempotent"
    );
}

#[test]
fn restoring_the_pre_upgrade_backup_gives_back_the_old_journal_and_upgrades_again() {
    let db = Journal::copy_of(V3);
    let original = dump(&read_only(&db.0), &[]);
    let upgraded = {
        let conn = open_file(&db.0).unwrap();
        dump(&conn, &[])
    };
    let rows = |d: &Dump| {
        d.iter()
            .map(|(t, (_, r))| (t.clone(), r.len()))
            .collect::<BTreeMap<_, _>>()
    };

    // Restore: the backup replaces the journal, as a user would copy it back.
    std::fs::copy(db.backup(), &db.0).unwrap();
    for side in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(db.0.with_extension(side));
    }
    let restored = read_only(&db.0);
    assert_eq!(version(&restored), 3);
    assert_eq!(
        dump(&restored, &[]),
        original,
        "the backup is the journal exactly as it was"
    );
    drop(restored);

    // Opening the restored journal upgrades it to the same result as the first
    // time: identical original data, and the same rows in the tables migrations
    // add (whose new IDs and timestamps differ per run).
    let conn = open_file(&db.0).unwrap();
    assert_eq!(version(&conn), latest_version());
    assert_healthy(&conn);
    assert_eq!(
        dump_like(&conn, &original),
        dump_like_from(&upgraded, &original)
    );
    assert_eq!(rows(&dump(&conn, &[])), rows(&upgraded));
}

/// `like`'s tables and columns, taken from an existing dump.
fn dump_like_from(from: &Dump, like: &Dump) -> Dump {
    like.iter()
        .map(|(table, (columns, _))| {
            let (all, rows) = &from[renamed(table)];
            let idx: Vec<usize> = columns
                .iter()
                .map(|c| all.iter().position(|a| a == c).unwrap())
                .collect();
            let mut rows: Vec<String> = rows
                .iter()
                .map(|r| {
                    let v: Vec<serde_json::Value> = serde_json::from_str(r).unwrap();
                    serde_json::to_string(&idx.iter().map(|&i| v[i].clone()).collect::<Vec<_>>())
                        .unwrap()
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
    assert!(
        matches!(
            err,
            MigrateError::Migration {
                name: "rederive_trading_days",
                ..
            }
        ),
        "{err}"
    );
    let conn = read_only(&db.0);
    assert_eq!(version(&conn), 4);
    assert_eq!(dump(&conn, &[]), before, "no trade was partly corrected");
}

#[test]
fn retrying_a_partial_upgrade_preserves_the_original_pre_upgrade_backup() {
    let db = Journal::copy_of(V3);
    {
        let conn = Connection::open(&db.0).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER boom BEFORE UPDATE OF trading_day ON trades
            BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;",
        )
        .unwrap();
    }
    let original = dump(&read_only(&db.0), &[]);
    assert!(matches!(
        open_file(&db.0),
        Err(MigrateError::Migration {
            from: 3,
            reached: 4,
            ..
        })
    ));
    let backup_bytes = std::fs::read(db.backup()).unwrap();
    assert_eq!(version(&read_only(&db.backup())), 3);
    {
        let conn = Connection::open(&db.0).unwrap();
        conn.execute_batch("DROP TRIGGER boom").unwrap();
    }
    let conn = open_file(&db.0).unwrap();
    assert_eq!(version(&conn), latest_version());
    assert_eq!(
        version(&read_only(&db.backup())),
        4,
        "latest retry backup still has a stable path"
    );
    let retained: Vec<_> = std::fs::read_dir(db.0.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .contains(".previous-")
        })
        .collect();
    assert_eq!(
        retained.len(),
        1,
        "the original v3 recovery point must survive the retry"
    );
    assert_eq!(std::fs::read(&retained[0]).unwrap(), backup_bytes);
    assert_eq!(dump(&read_only(&retained[0]), &[]), original);
    assert_healthy(&conn);
}

#[test]
fn failure_to_preserve_an_existing_backup_prevents_any_migration() {
    let db = Journal::copy_of(V3);
    let before = dump(&read_only(&db.0), &[]);
    std::fs::create_dir(db.backup()).unwrap();
    assert!(matches!(
        open_file(&db.0),
        Err(MigrateError::Backup { current: 3, .. })
    ));
    let conn = read_only(&db.0);
    assert_eq!(version(&conn), 3);
    assert_eq!(dump(&conn, &[]), before);
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
    let day = |id: &str| -> String {
        conn.query_row("SELECT trading_day FROM trades WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap()
    };
    assert_eq!(
        (day("t1").as_str(), day("t2").as_str()),
        ("2026-10-19", "2026-10-17")
    );
}

/// Rows of `before` and `after` that do not pair up, counted as a multiset difference in both directions.
fn mismatched(before: &[String], after: &[String]) -> usize {
    let mut counts: BTreeMap<&str, i64> = BTreeMap::new();
    before
        .iter()
        .for_each(|r| *counts.entry(r).or_default() += 1);
    after
        .iter()
        .for_each(|r| *counts.entry(r).or_default() -= 1);
    counts.values().map(|n| n.unsigned_abs() as usize).sum()
}

/// Upgrade a copy of the journal at `source` and compare it with the original. `tamper` runs on the
/// upgraded copy before the comparison (tests use it to force a mismatch).
///
/// The source is only read: when a `fundedflow.lock` sits beside it, it must be free (a held lock means
/// the app is using the journal) and stays held while `fundedflow.db` and any `-wal`/`-shm` are copied
/// into a temp folder. Everything returned, the success lines and the error, is counts and table
/// names only: never ids, column values or row text.
fn upgrade_copy(source: &Path, tamper: impl FnOnce(&Connection)) -> Result<Vec<String>, String> {
    let db = Journal::copy_of(&[]);
    {
        let lock_path = source.with_file_name("fundedflow.lock");
        let _lock = match std::fs::File::open(&lock_path) {
            Ok(file) => {
                fs2::FileExt::try_lock_exclusive(&file)
                    .map_err(|_| "fundedflow.lock is held: close FundedFlow and copy its journal folder first".to_string())?;
                Some(file)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("cannot open fundedflow.lock ({:?})", e.kind())),
        };
        for suffix in ["", "-wal", "-shm"] {
            let from = PathBuf::from(format!("{}{suffix}", source.display()));
            let to = PathBuf::from(format!("{}{suffix}", db.0.display()));
            match std::fs::copy(&from, &to) {
                Ok(_) => {}
                Err(e) if !suffix.is_empty() && e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(format!(
                        "cannot copy fundedflow.db{suffix} ({:?})",
                        e.kind()
                    ));
                }
            }
        }
    }
    let trading_days = |conn: &Connection| -> BTreeMap<String, String> {
        conn.prepare("SELECT id, trading_day FROM trades")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    let (from, before, days_before) = {
        let copy = read_only(&db.0);
        (
            version(&copy),
            dump(&copy, &[("trades", "trading_day")]),
            trading_days(&copy),
        )
    };
    let conn = open_file(&db.0)
        .map_err(|_| format!("migrating the v{from} copy failed (error text withheld)"))?;
    tamper(&conn);

    let integrity: Vec<String> = conn
        .prepare("PRAGMA integrity_check")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let fk_problems: i64 = conn
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    let after = dump_like(&conn, &before);
    let mut problems = Vec::new();
    if integrity != ["ok"] {
        problems.push(format!("integrity_check: {} problems", integrity.len()));
    }
    if fk_problems != 0 {
        problems.push(format!("foreign_key_check: {fk_problems} problems"));
    }
    for (table, (_, rows)) in &before {
        let after_rows = &after[table].1;
        let n = mismatched(rows, after_rows);
        if n != 0 {
            problems.push(format!(
                "{table}: {} rows before, {} after, {n} mismatched",
                rows.len(),
                after_rows.len()
            ));
        }
    }
    if !problems.is_empty() {
        return Err(format!(
            "upgrade v{from} -> v{} changed the journal:\n  {}",
            version(&conn),
            problems.join("\n  ")
        ));
    }

    let days_after = trading_days(&conn);
    let corrected = days_before
        .iter()
        .filter(|(id, day)| days_after.get(*id) != Some(*day))
        .count();
    let rows: usize = before.values().map(|(_, rows)| rows.len()).sum();
    let per_table: Vec<String> = before
        .iter()
        .map(|(table, (_, rows))| format!("{table} {}", rows.len()))
        .collect();
    Ok(vec![
        format!(
            "v{from} -> v{}: {rows} rows kept, {corrected} trading days corrected",
            version(&conn)
        ),
        format!("  rows per table: {}", per_table.join(", ")),
    ])
}

/// Upgrade a copy of a real journal. Close FundedFlow, copy its journal folder (`fundedflow.db` and any
/// `-wal`/`-shm`) somewhere offline, and point `FUNDEDFLOW_UPGRADE_DB` at that copy, never at the live
/// `%APPDATA%` journal:
/// `FUNDEDFLOW_UPGRADE_DB=<copy folder>\fundedflow.db cargo test --offline --locked --lib upgrade_copy -- --ignored`.
/// The test copies it again into a temp folder and refuses while its `fundedflow.lock` is held. Output,
/// failures included, is counts only, so `--nocapture` (to see the counts) shows no journal content.
#[test]
#[ignore]
fn upgrade_copy_of_a_real_journal() {
    let source =
        PathBuf::from(std::env::var("FUNDEDFLOW_UPGRADE_DB").expect("FUNDEDFLOW_UPGRADE_DB"));
    match upgrade_copy(&source, |_| {}) {
        Ok(lines) => lines.iter().for_each(|l| println!("{l}")),
        Err(message) => panic!("{message}"),
    }
}

const MARKER: &str = "synthetic-marker-5c1e";

/// A synthetic file journal in its own temp folder: one account and one trade whose notes hold `MARKER`.
/// The connection stays open, so the writes are still in `fundedflow.db-wal`.
fn synthetic_journal() -> (Journal, Connection) {
    let db = Journal::copy_of(&[]);
    std::fs::remove_file(&db.0).unwrap();
    let mut conn = open_file(&db.0).unwrap();
    let account =
        accounts::create(&mut conn, crate::store::tests::account_input("Synthetic")).unwrap();
    let input = trades::TradeInput {
        notes: Some(MARKER.into()),
        ..crate::store::tests::trade_input(&account.id)
    };
    trades::create(&mut conn, input).unwrap();
    (db, conn)
}

/// Every account and trade id in the journal: none may appear in the gate's output.
fn ids(conn: &Connection) -> Vec<String> {
    conn.prepare("SELECT id FROM accounts UNION ALL SELECT id FROM trades")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn assert_redacted(text: &str, ids: &[String]) {
    assert!(
        !text.contains(MARKER),
        "the gate's output contains row content"
    );
    assert!(
        ids.iter().all(|id| !text.contains(id.as_str())),
        "the gate's output contains an id"
    );
    assert!(
        !text.contains("2026-10-19"),
        "the gate's output contains a trade date"
    );
}

#[test]
fn upgrade_copy_refuses_a_journal_whose_lock_is_held() {
    let (db, _conn) = synthetic_journal();
    let lock = crate::data_controls::filesystem_ownership(db.0.parent().unwrap()).unwrap();
    let err = upgrade_copy(&db.0, |_| {}).expect_err("a held journal lock must refuse the copy");
    assert!(err.contains("fundedflow.lock is held"), "{err}");
    drop(lock);
    assert!(
        upgrade_copy(&db.0, |_| {}).is_ok(),
        "a lock file nobody holds does not block the copy"
    );
}

#[test]
fn upgrade_copy_reads_wal_content_leaves_the_source_alone_and_reports_counts_only() {
    let (db, conn) = synthetic_journal();
    assert!(
        std::fs::metadata(db.0.with_extension("db-wal"))
            .unwrap()
            .len()
            > 0,
        "the writes are still in the WAL"
    );
    let folder = |dir: &Path| -> Vec<(String, Vec<u8>)> {
        let mut files: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .map(|p| {
                (
                    p.file_name().unwrap().to_string_lossy().into_owned(),
                    std::fs::read(&p).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    };
    let source_before = folder(db.0.parent().unwrap());
    let lines = upgrade_copy(&db.0, |_| {}).unwrap();
    assert_eq!(
        folder(db.0.parent().unwrap()),
        source_before,
        "the source folder is only read"
    );
    // 1 account and 1 trade came through the copy, so the WAL content was copied with the database.
    let text = lines.join("\n");
    assert!(
        text.contains(&format!("v{v} -> v{v}", v = latest_version())),
        "{text}"
    );
    assert!(
        text.contains("accounts 1, ") && text.contains("trades 1"),
        "{text}"
    );
    assert!(text.contains("0 trading days corrected"), "{text}");
    assert_redacted(&text, &ids(&conn));
}

#[test]
fn a_mismatch_after_the_upgrade_fails_with_counts_only() {
    let (db, conn) = synthetic_journal();
    let ids = ids(&conn);
    // Force a mismatch after the migration by changing the marker trade's notes in the copy, then run
    // the gate's failure path and capture its panic message.
    let failed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let tamper = |copy: &Connection| {
            copy.execute("UPDATE trades SET notes_md = notes_md || '-changed'", [])
                .unwrap();
        };
        if let Err(message) = upgrade_copy(&db.0, tamper) {
            panic!("{message}");
        }
    }));
    let payload = failed.expect_err("the forced mismatch fails the gate");
    let message = payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap();
    assert!(
        message.contains("trades: 1 rows before, 1 after, 2 mismatched"),
        "{message}"
    );
    assert_redacted(&message, &ids);
}
