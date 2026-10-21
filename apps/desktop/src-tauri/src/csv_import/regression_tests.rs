//! Build 17 backend regressions. All CSV values here are synthetic.
use super::*;
use std::path::{Path, PathBuf};

const HEADER: &str = "Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price,Fees,P&L,Notes";
const TRADE: &str = "MNQZ6,Buy,1,2026-10-19 09:30:00,21000,2026-10-19 09:31:00,21001,0,2,original";

pub(super) struct JournalFile(PathBuf);
impl JournalFile {
    pub(super) fn new() -> Self {
        Self(std::env::temp_dir().join(format!("fundedflow-build17-{}", uuid::Uuid::now_v7())))
    }
    fn path(&self) -> PathBuf {
        self.0.join(crate::db::DB_FILE_NAME)
    }
    pub(super) fn open(&self) -> Connection {
        crate::db::open_file(&self.path()).unwrap()
    }
}
impl Drop for JournalFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn single_performance() -> String {
    format!("{}\n{}\n", PERFORMANCE.lines().next().unwrap(), PERFORMANCE.lines().nth(1).unwrap())
}

fn assert_no_records(conn: &Connection) {
    for table in ["import_batches", "import_rows", "trades", "trade_round_trips"] {
        assert_eq!(count(conn, &format!("SELECT count(*) FROM {table}")), 0, "{table}");
    }
}

#[test]
fn every_identity_strategy_is_account_isolated_including_deleted_trades() {
    let generic = format!("{HEADER}\n{TRADE}\n");
    let with_id = format!("Trade ID,{HEADER}\nT17,{TRADE}\n");
    let paired = single_performance();
    let no_fill_ids = "symbol,qty,buyPrice,sellPrice,boughtTimestamp,soldTimestamp\nMNQZ6,1,21000,21001,10/19/2026 09:30:00,10/19/2026 09:31:00\n";
    for content in [generic.as_str(), &with_id, &paired, no_fill_ids] {
        let (mut conn, a) = setup();
        let b = accounts::create(&mut conn, account_input("Independent")).unwrap().id;
        let first = commit(&mut conn, &request(&a, content)).unwrap();
        let a_trade = trade_store::list(&conn, &a).unwrap().remove(0);
        trade_store::delete(&mut conn, &a_trade.id).unwrap();
        let p = preview(&conn, &request(&b, content)).unwrap();
        assert!(!p.file_previously_imported);
        assert_eq!((p.new_count, p.restore_count, p.duplicate_count), (1, 0, 0));
        let second = commit(&mut conn, &request(&b, content)).unwrap();
        let b_trade = trade_store::list(&conn, &b).unwrap().remove(0);
        assert_ne!(a_trade.id, b_trade.id);
        assert_ne!(first.id, second.id);
        assert_eq!(first.file_sha256, second.file_sha256);
        let keys: Vec<String> = conn
            .prepare("SELECT dedup_key FROM trades ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0], keys[1], "identical key is permitted only in different accounts");
        let restore = preview(&conn, &request(&a, content)).unwrap();
        assert_eq!(restore.rows[0].restores.as_ref().unwrap().trade_id, a_trade.id);
        let again = preview(&conn, &request(&b, content)).unwrap();
        assert_eq!(again.rows[0].duplicate.as_ref().unwrap().trade_id.as_deref(), Some(b_trade.id.as_str()));
        assert_eq!(list_batches(&conn, &a).unwrap(), [first]);
        assert_eq!(list_batches(&conn, &b).unwrap(), [second]);
    }
}

#[test]
fn utf8_byte_limit_is_inclusive_and_oversized_commit_writes_no_rows() {
    let (mut conn, account) = setup();
    let prefix = format!("{HEADER},Export Metadata\n{TRADE},");
    let remaining = MAX_CSV_BYTES - prefix.len() - 1;
    let exact = format!("{prefix}{}{}\n", "é".repeat(remaining / 2), "x".repeat(remaining % 2));
    assert_eq!(exact.len(), MAX_CSV_BYTES);
    let p = preview(&conn, &request(&account, &exact)).unwrap();
    assert!(p.file_issues.is_empty(), "{:?}", p.file_issues);
    assert_eq!((p.row_count, p.new_count), (1, 1));
    assert_no_records(&conn);
    let too_large = format!("{exact}x");
    assert!(too_large.chars().count() < MAX_CSV_BYTES, "cap is bytes, not Unicode characters");
    let p = preview(&conn, &request(&account, &too_large)).unwrap();
    assert_eq!(fields(&p.file_issues), ["content"]);
    assert!(p.file_issues[0].message.contains("larger"));
    assert_eq!(p.row_count, 0);
    assert!(matches!(commit(&mut conn, &request(&account, &too_large)), Err(AppError::Validation { .. })));
    for table in ["import_rows", "trades", "trade_round_trips"] {
        assert_eq!(count(&conn, &format!("SELECT count(*) FROM {table}")), 0);
    }
    let batches = list_batches(&conn, &account).unwrap();
    assert_eq!(batches[0].status, "failed");
    assert_eq!(batches[0].file_size, (MAX_CSV_BYTES + 1) as i64);
    let accepted = commit(&mut conn, &request(&account, &exact)).unwrap();
    assert_eq!((accepted.imported_count, accepted.file_size), (1, MAX_CSV_BYTES as i64));
    let raw: String =
        conn.query_row("SELECT raw_json FROM import_rows WHERE batch_id = ?1", [&accepted.id], |r| r.get(0)).unwrap();
    let cells: Vec<String> = serde_json::from_str(&raw).unwrap();
    assert_eq!(cells[10].len(), remaining, "unknown source metadata remains lossless at the byte cap");
}

#[test]
fn row_limit_is_inclusive_and_overflow_never_commits_a_truncated_file() {
    let (mut conn, account) = setup();
    let exact = format!("{HEADER}\n{}", format!("{TRADE}\n").repeat(MAX_CSV_ROWS));
    let p = preview(&conn, &request(&account, &exact)).unwrap();
    assert!(p.file_issues.is_empty(), "{:?}", p.file_issues);
    assert_eq!((p.row_count, p.new_count, p.duplicate_count), (50_000, 1, 49_999));
    assert_eq!(p.rows.len(), MAX_CSV_ROWS, "duplicates remain visible after preview limit");
    assert_no_records(&conn);
    let batch = commit(&mut conn, &request(&account, &exact)).unwrap();
    assert_eq!((batch.row_count, batch.imported_count, batch.duplicate_count), (50_000, 1, 49_999));
    assert_eq!(count(&conn, "SELECT count(*) FROM import_rows"), 50_000);
    let overflow = format!("{exact}{TRADE}\n");
    let p = preview(&conn, &request(&account, &overflow)).unwrap();
    assert!(p.file_issues.iter().any(|i| i.message.contains("more than 50000")));
    assert!(matches!(commit(&mut conn, &request(&account, &overflow)), Err(AppError::Validation { .. })));
    assert_eq!(count(&conn, "SELECT count(*) FROM import_rows"), 50_000);
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM import_batches WHERE status = 'committed'"), 1);
}

#[test]
fn preview_overflow_retains_late_invalid_warning_blank_duplicate_and_restore_rows() {
    let (mut conn, account) = setup();
    let original = format!("Trade ID,{HEADER}\nrestore,{TRADE}\n");
    commit(&mut conn, &request(&account, &original)).unwrap();
    let deleted = trade_store::list(&conn, &account).unwrap().remove(0);
    trade_store::delete(&mut conn, &deleted.id).unwrap();
    let mut content = format!("Trade ID,{HEADER}\n");
    for i in 0..=PREVIEW_ROW_LIMIT {
        content.push_str(&format!("new{i},{TRADE}\n"));
    }
    content.push_str(&format!("restore,{TRADE}\n"));
    content.push_str(&format!("bad,{}\n", TRADE.replacen(",Buy,1,", ",Buy,0,", 1)));
    content.push_str(&format!("warn,{}\n", TRADE.replacen(",0,2,original", ",-1,2,original", 1)));
    content.push_str(",,,,,,,,,,\n");
    content.push_str(&format!("new0,{TRADE}\n"));
    let p = preview(&conn, &request(&account, &content)).unwrap();
    assert!(p.file_issues.is_empty());
    assert_eq!(
        (p.row_count, p.new_count, p.restore_count, p.invalid_count, p.warning_count, p.blank_count, p.duplicate_count),
        (2006, 2003, 1, 1, 1, 1, 1)
    );
    assert_eq!(p.rows_omitted, 1);
    assert_eq!(p.rows.len(), 2005);
    assert!(!p.rows.iter().any(|r| r.row_number == 2001));
    assert_eq!(p.rows.iter().find(|r| r.row_number == 2002).unwrap().restores.as_ref().unwrap().trade_id, deleted.id);
    assert_eq!(p.rows.iter().find(|r| r.row_number == 2003).unwrap().status, "invalid");
    assert!(!p.rows.iter().find(|r| r.row_number == 2004).unwrap().warnings.is_empty());
    assert_eq!(p.rows.iter().find(|r| r.row_number == 2005).unwrap().status, "blank");
    assert_eq!(p.rows.iter().find(|r| r.row_number == 2006).unwrap().status, "duplicate");
    assert!(trade_store::list(&conn, &account).unwrap().is_empty(), "preview did not restore");
    let batch = commit(&mut conn, &request(&account, &content)).unwrap();
    assert_eq!((batch.row_count, batch.imported_count, batch.failed_count, batch.skipped_count), (2006, 2003, 1, 2));
    let rows: i64 =
        conn.query_row("SELECT count(*) FROM import_rows WHERE batch_id = ?1", [&batch.id], |r| r.get(0)).unwrap();
    assert_eq!(rows, 2006, "omitted preview rows are still persisted");
}

#[test]
fn all_invalid_blank_and_duplicate_only_batches_survive_reopen() {
    let file = JournalFile::new();
    let account;
    let invalid = format!("{HEADER}\n{}\n", TRADE.replacen(",Buy,1,", ",Buy,0,", 1));
    let blank = format!("{HEADER}\n,,,,,,,,,\n");
    let valid = format!("{HEADER}\n{TRADE}\n");
    let (invalid_batch, blank_batch, valid_batch);
    {
        let mut conn = file.open();
        account = accounts::create(&mut conn, account_input("Restart")).unwrap().id;
        invalid_batch = commit(&mut conn, &request(&account, &invalid)).unwrap();
        assert_eq!(
            (invalid_batch.status.as_str(), invalid_batch.imported_count, invalid_batch.failed_count),
            ("committed", 0, 1)
        );
        blank_batch = commit(&mut conn, &request(&account, &blank)).unwrap();
        assert_eq!((blank_batch.imported_count, blank_batch.skipped_count), (0, 1));
        valid_batch = commit(&mut conn, &request(&account, &valid)).unwrap();
    }
    let duplicate_batch;
    let trade;
    {
        let mut conn = file.open();
        assert_eq!(get_batch(&conn, &invalid_batch.id).unwrap(), invalid_batch);
        assert_eq!(get_batch(&conn, &blank_batch.id).unwrap(), blank_batch);
        assert_eq!(list_problem_rows(&conn, &invalid_batch.id).unwrap()[0].raw[2], "0");
        assert_eq!(list_problem_rows(&conn, &blank_batch.id).unwrap()[0].status, "skipped");
        trade = trade_store::list(&conn, &account).unwrap().remove(0);
        let p = preview(&conn, &request(&account, &valid)).unwrap();
        assert!(p.file_previously_imported);
        assert_eq!((p.new_count, p.duplicate_count), (0, 1));
        duplicate_batch = commit(&mut conn, &request(&account, &valid)).unwrap();
        assert_eq!(
            (duplicate_batch.status.as_str(), duplicate_batch.imported_count, duplicate_batch.duplicate_count),
            ("committed", 0, 1)
        );
    }
    let conn = file.open();
    assert_eq!(get_batch(&conn, &duplicate_batch.id).unwrap(), duplicate_batch);
    assert_eq!(get_batch(&conn, &valid_batch.id).unwrap(), valid_batch);
    assert_eq!(trade_store::list(&conn, &account).unwrap().as_slice(), std::slice::from_ref(&trade));
    assert_eq!(
        list_problem_rows(&conn, &duplicate_batch.id).unwrap()[0].duplicate_of_trade_id.as_deref(),
        Some(trade.id.as_str())
    );
    assert_eq!(count(&conn, "SELECT count(*) FROM import_rows"), 4);
}

#[test]
fn commit_reclassifies_a_preview_after_another_import_or_deletion() {
    let (mut conn, account) = setup();
    let csv = single_performance();
    let req = request(&account, &csv);
    assert_eq!(preview(&conn, &req).unwrap().new_count, 1);
    commit(&mut conn, &req).unwrap();
    let duplicate = commit(&mut conn, &req).unwrap();
    assert_eq!((duplicate.imported_count, duplicate.duplicate_count), (0, 1));
    let trade = trade_store::list(&conn, &account).unwrap().remove(0);
    assert_eq!(preview(&conn, &req).unwrap().duplicate_count, 1);
    trade_store::delete(&mut conn, &trade.id).unwrap();
    assert_eq!(commit(&mut conn, &req).unwrap().imported_count, 1);
    assert_eq!(trade_store::list(&conn, &account).unwrap()[0].id, trade.id);
}

#[test]
fn rollback_reverts_restore_and_new_trade_and_reimport_after_restart_is_safe() {
    let file = JournalFile::new();
    let (account, deleted_id, failed_id);
    let csv = single_performance();
    let mixed = format!("{csv}{}\n", PERFORMANCE.lines().nth(2).unwrap());
    {
        let mut conn = file.open();
        account = accounts::create(&mut conn, account_input("Rollback")).unwrap().id;
        commit(&mut conn, &request(&account, &csv)).unwrap();
        deleted_id = trade_store::list(&conn, &account).unwrap().remove(0).id;
        trade_store::delete(&mut conn, &deleted_id).unwrap();
        // Last write: after restoring the first trade and inserting the second trade/row.
        conn.execute_batch(
            "CREATE TRIGGER interrupt_import BEFORE INSERT ON trade_round_trips
            WHEN NEW.sell_fill_id = '707776450038'
            BEGIN SELECT RAISE(ROLLBACK, 'interrupted import (simulated)'); END;",
        )
        .unwrap();
        assert!(commit(&mut conn, &request(&account, &mixed)).is_err());
        assert!(trade_store::list(&conn, &account).unwrap().is_empty());
        assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM trade_round_trips"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM import_rows"), 1);
        let failed = list_batches(&conn, &account).unwrap().into_iter().find(|b| b.status == "failed").unwrap();
        failed_id = failed.id;
        assert_eq!(failed.imported_count, 0);
        conn.execute_batch("DROP TRIGGER interrupt_import").unwrap();
    }
    {
        let mut conn = file.open();
        assert_eq!(get_batch(&conn, &failed_id).unwrap().status, "failed");
        let p = preview(&conn, &request(&account, &mixed)).unwrap();
        assert!(!p.file_previously_imported, "failed hash is not a committed file");
        assert_eq!((p.new_count, p.restore_count), (2, 1));
        assert_eq!(commit(&mut conn, &request(&account, &mixed)).unwrap().imported_count, 2);
    }
    let mut conn = file.open();
    assert_eq!(commit(&mut conn, &request(&account, &mixed)).unwrap().duplicate_count, 2);
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 2);
    assert!(trade_store::list(&conn, &account).unwrap().iter().any(|t| t.id == deleted_id));
}

#[test]
fn source_provenance_survives_corrections_edits_restore_and_reopen() {
    let file = JournalFile::new();
    let csv = single_performance();
    let (account, trade_id, original_batch, original_raw, original_rt, mapping);
    {
        let mut conn = file.open();
        account = accounts::create(&mut conn, account_input("Provenance")).unwrap().id;
        original_batch = commit(&mut conn, &request(&account, &csv)).unwrap();
        let trade = trade_store::list(&conn, &account).unwrap().remove(0);
        trade_id = trade.id.clone();
        original_rt = trade.round_trip.clone();
        original_raw = conn
            .query_row("SELECT raw_json FROM import_rows WHERE batch_id = ?1", [&original_batch.id], |r| {
                r.get::<_, String>(0)
            })
            .unwrap();
        mapping = conn
            .query_row("SELECT mapping_snapshot_json FROM import_batches WHERE id = ?1", [&original_batch.id], |r| {
                r.get::<_, String>(0)
            })
            .unwrap();
        let edited = crate::store::trades::TradeInput {
            notes: Some("edited locally".into()),
            ..crate::store::tests::trade_input(&account)
        };
        trade_store::update(&mut conn, &trade_id, edited).unwrap();
        trade_store::delete(&mut conn, &trade_id).unwrap();
        let corrected = csv.replace("29787.25", "29788.25"); // Same fill IDs: restore original, never overwrite source.
        let restored = commit(&mut conn, &request(&account, &corrected)).unwrap();
        assert_eq!(restored.imported_count, 1);
        assert_ne!(restored.file_sha256, original_batch.file_sha256);
        assert!(conn
            .execute("UPDATE import_rows SET raw_json = '[]' WHERE batch_id = ?1", [&original_batch.id])
            .is_err());
        assert!(conn.execute("UPDATE trade_round_trips SET tick_size = '1' WHERE trade_id = ?1", [&trade_id]).is_err());
    }
    let conn = file.open();
    let restored = trade_store::list(&conn, &account).unwrap().remove(0);
    assert_eq!(restored.id, trade_id);
    assert_eq!(restored.notes.as_deref(), Some("edited locally"));
    assert_eq!(restored.round_trip, original_rt);
    let (batch_id, raw): (String, String) = conn.query_row("SELECT t.import_batch_id, r.raw_json FROM trades t JOIN import_rows r ON r.id = t.import_row_id WHERE t.id = ?1", [&trade_id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((batch_id, raw), (original_batch.id.clone(), original_raw));
    assert_eq!(get_batch(&conn, &original_batch.id).unwrap(), original_batch);
    let saved_mapping: String = conn
        .query_row("SELECT mapping_snapshot_json FROM import_batches WHERE id = ?1", [&original_batch.id], |r| r.get(0))
        .unwrap();
    assert_eq!(mapping, saved_mapping);
}

#[test]
fn mixed_locale_lines_are_not_reinterpreted_per_row() {
    let (mut conn, account) = setup();
    let content = "Symbol,Side,Qty,Entry Time,Entry Price\nMNQ,Buy,1,10/19/2026 09:30:00,21000\nMNQ,Buy,1,10/20/2026 09:30:00,21000\nMNQ,Buy,1,19/10/2026 09:30:00,21000\n";
    let p = preview(&conn, &request(&account, content)).unwrap();
    assert_eq!(p.date_format, Some(values::DateFormat::Mdy));
    assert_eq!((p.new_count, p.invalid_count), (2, 1));
    assert_eq!(p.rows[2].status, "invalid");
    assert!(fields(&p.rows[2].errors).contains(&"entryTime"));
    let b = commit(&mut conn, &request(&account, content)).unwrap();
    assert_eq!((b.imported_count, b.failed_count), (2, 1));
    assert_eq!(list_problem_rows(&conn, &b.id).unwrap()[0].raw[3], "19/10/2026 09:30:00");
}

#[test]
fn fees_notes_format_and_timestamp_precision_follow_existing_identity_rules() {
    let (mut conn, account) = setup();
    let csv = format!("{HEADER}\n{TRADE}\n");
    commit(&mut conn, &request(&account, &csv)).unwrap();
    let correction = csv.replace(",0,2,original", ",1,2,corrected");
    assert_eq!(preview(&conn, &request(&account, &correction)).unwrap().duplicate_count, 1);
    commit(&mut conn, &request(&account, &correction)).unwrap();
    let original = trade_store::list(&conn, &account).unwrap().remove(0);
    assert_eq!(original.fees, "0");
    assert_eq!(original.notes.as_deref(), Some("original"));
    let equivalent = csv.replace("09:30:00", "09:30:00.000");
    assert_eq!(preview(&conn, &request(&account, &equivalent)).unwrap().duplicate_count, 1);
    let precision_change = csv.replace("09:30:00", "09:30:00.001");
    assert_eq!(preview(&conn, &request(&account, &precision_change)).unwrap().new_count, 1);
    let performance = "symbol,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp\nMNQZ6,1,21000,21001,2,10/19/2026 09:30:00,10/19/2026 09:31:00\n";
    assert_eq!(
        preview(&conn, &request(&account, performance)).unwrap().new_count,
        1,
        "format participates in fallback identity"
    );
}

#[test]
fn minimum_signed_money_in_a_pnl_warning_does_not_panic() {
    let (mut conn, account) = setup();
    let csv = single_performance().replace("$26.00", "-9223372036854.775808");
    let p = preview(&conn, &request(&account, &csv)).unwrap();
    assert_eq!(p.new_count, 1);
    assert!(p.rows[0].warnings.iter().any(|w| w.message.contains("-$9223372036854.775808")));
    assert_eq!(commit(&mut conn, &request(&account, &csv)).unwrap().imported_count, 1);
}

#[test]
fn duration_overflow_is_a_row_error_not_a_panic_or_failed_transaction() {
    let (mut conn, account) = setup();
    for duration in ["18446744073709551615:00:00", "9223372036854775808sec"] {
        let csv = single_performance().replace("32sec", duration);
        let p = preview(&conn, &request(&account, &csv)).unwrap();
        assert_eq!((p.new_count, p.invalid_count), (0, 1));
        assert_eq!(fields(&p.rows[0].errors), ["duration"]);
        let b = commit(&mut conn, &request(&account, &csv)).unwrap();
        assert_eq!((b.status.as_str(), b.imported_count, b.failed_count), ("committed", 0, 1));
    }
}

#[test]
fn abrupt_process_exit_after_preview_has_no_persistent_import() {
    let file = JournalFile::new();
    let account = {
        let mut conn = file.open();
        accounts::create(&mut conn, account_input("Unconfirmed")).unwrap().id
    };
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "csv_import::tests::regressions::preview_exit_worker", "--ignored", "--nocapture"])
        .env("FUNDEDFLOW_TEST_PREVIEW_EXIT_DB", file.path())
        .env("FUNDEDFLOW_TEST_PREVIEW_EXIT_ACCOUNT", &account)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(37), "worker must finish preview and exit without running destructors");
    let mut conn = file.open();
    assert_no_records(&conn);
    assert_eq!(commit(&mut conn, &request(&account, &single_performance())).unwrap().imported_count, 1);
}

#[test]
#[ignore = "subprocess worker for abrupt_process_exit_after_preview_has_no_persistent_import"]
fn preview_exit_worker() {
    let path = std::env::var_os("FUNDEDFLOW_TEST_PREVIEW_EXIT_DB").expect("worker database path");
    let account = std::env::var("FUNDEDFLOW_TEST_PREVIEW_EXIT_ACCOUNT").unwrap();
    let conn = crate::db::open_file(Path::new(&path)).unwrap();
    assert_eq!(preview(&conn, &request(&account, &single_performance())).unwrap().new_count, 1);
    std::process::exit(37);
}

#[path = "golden_tests.rs"]
mod golden;

#[test]
fn submillisecond_fill_order_cannot_be_previewed_as_a_persistable_trade() {
    let (mut conn, account) = setup();
    let header = "symbol,qty,buyPrice,sellPrice,boughtTimestamp,soldTimestamp";
    for (buy, sell) in [("0001", "0002"), ("0002", "0001")] {
        let csv = format!("{header}\nMNQ,1,21000,21001,2026-10-19T13:30:00.{buy}Z,2026-10-19T13:30:00.{sell}Z\n");
        let p = preview(&conn, &request(&account, &csv)).unwrap();
        assert_eq!((p.new_count, p.invalid_count), (0, 1));
        assert!(p.rows[0].errors.iter().any(|e| e.field == "soldTimestamp" && e.message.contains("millisecond")));
        let batch = commit(&mut conn, &request(&account, &csv)).unwrap();
        assert_eq!((batch.status.as_str(), batch.imported_count, batch.failed_count), ("committed", 0, 1));
    }
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 0);
}

#[test]
fn repeated_saved_duplicates_keep_trade_references_through_restart() {
    let paired = single_performance();
    let content = format!(
        "{}\n{}\n{}\n{}\n",
        paired.lines().next().unwrap(),
        paired.lines().nth(1).unwrap(),
        paired.lines().nth(1).unwrap(),
        paired.lines().nth(1).unwrap()
    );
    for csv in [
        format!("{HEADER}\n{}", format!("{TRADE}\n").repeat(3)),
        format!("Trade ID,{HEADER}\n{}", format!("T17,{TRADE}\n").repeat(3)),
        content,
    ] {
        let file = JournalFile::new();
        let (account, original_trade);
        {
            let mut conn = file.open();
            account = accounts::create(&mut conn, account_input("Duplicate provenance")).unwrap().id;
            assert_eq!(commit(&mut conn, &request(&account, &csv)).unwrap().imported_count, 1);
            original_trade = trade_store::list(&conn, &account).unwrap().remove(0);
        }
        let batch;
        {
            let mut conn = file.open();
            let p = preview(&conn, &request(&account, &csv)).unwrap();
            assert_eq!((p.new_count, p.duplicate_count), (0, 3));
            assert_eq!(p.rows[0].duplicate.as_ref().unwrap().of, "saved");
            assert_eq!(p.rows[1].duplicate.as_ref().unwrap().of, "file");
            assert!(
                p.rows
                    .iter()
                    .all(|r| r.duplicate.as_ref().unwrap().trade_id.as_deref() == Some(original_trade.id.as_str())),
                "every duplicate can trace the saved trade, including repeated lines"
            );
            batch = commit(&mut conn, &request(&account, &csv)).unwrap();
            assert_eq!((batch.imported_count, batch.duplicate_count), (0, 3));
        }
        let conn = file.open();
        let problems = list_problem_rows(&conn, &batch.id).unwrap();
        assert_eq!(problems.len(), 3);
        assert!(problems.iter().all(|r| r.duplicate_of_trade_id.as_deref() == Some(original_trade.id.as_str())));
        assert_eq!(trade_store::list(&conn, &account).unwrap(), [original_trade]);
    }
}

#[test]
fn commit_uses_current_account_context_without_reinterpreting_source_times() {
    let (mut conn, account) = setup();
    let csv = format!("{HEADER}\nMNQZ6,Buy,1,2026-10-19 16:30:00,21000,2026-10-19 16:31:00,21001,0,,source time\n");
    let req = request(&account, &csv);
    let before = preview(&conn, &req).unwrap();
    let before_trade = before.rows[0].trade.as_ref().unwrap();
    assert_eq!(before_trade.trading_day, "2026-10-19");
    assert_eq!(before_trade.realized_pnl.as_deref(), Some("2"));
    accounts::update(
        &mut conn,
        &account,
        crate::store::accounts::AccountInput {
            currency: "EUR".into(),
            timezone: "Asia/Tokyo".into(),
            trading_day_reset_time: "00:00".into(),
            ..account_input("Updated account context")
        },
    )
    .unwrap();
    let batch = commit(&mut conn, &req).unwrap();
    assert_eq!(batch.imported_count, 1);
    let saved = trade_store::list(&conn, &account).unwrap().remove(0);
    assert_eq!(saved.entry_at, before_trade.entry_at, "source zone in the request still determines the instant");
    assert_eq!(saved.exit_at, before_trade.exit_at);
    assert_eq!(saved.trading_day, "2026-10-20", "current account zone/reset determine the trading day");
    assert_eq!(saved.pnl_status, "currency_mismatch");
    assert_eq!(saved.realized_pnl, None, "commit must not persist the old USD calculation");
    let source_zone: String =
        conn.query_row("SELECT source_timezone FROM import_batches WHERE id = ?1", [&batch.id], |r| r.get(0)).unwrap();
    assert_eq!(source_zone, "America/New_York");
    let raw: String =
        conn.query_row("SELECT raw_json FROM import_rows WHERE batch_id = ?1", [&batch.id], |r| r.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<Vec<String>>(&raw).unwrap()[3], "2026-10-19 16:30:00");
}
