//! Import pipeline tests. `Performance.csv` (repo-root `test_csvimport/`) is the
//! required compatibility fixture and is only read, never modified.

use rusqlite::Connection;

use super::*;
// Existing pipeline regressions exercise reviewed imports. Guard regressions call
// super::commit directly so missing/stale acknowledgements are never hidden.
use super::commit_reviewed as commit;
use crate::store::tests::{account_input, db};
use crate::store::{accounts, trades as trade_store};

const PERFORMANCE: &str = include_str!("../../../../../test_csvimport/Performance.csv");

/// Lines of the fixture whose sell fill is timestamped before the buy fill.
const SELL_FIRST_LINES: [u64; 21] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 52, 53, 54, 55, 56, 57];

fn request(account_id: &str, content: &str) -> CsvImportRequest {
    CsvImportRequest {
        account_id: account_id.into(),
        file_name: "Performance.csv".into(),
        content: content.into(),
        timezone: "America/New_York".into(),
        format: FormatChoice::Auto,
        date_format: DateFormatChoice::Auto,
        columns: None,
        target_acknowledgement: None,
    }
}

fn setup() -> (Connection, String) {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    (conn, a.id)
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn row(p: &CsvPreview, line: u64) -> &RowReport {
    p.rows.iter().find(|r| r.line_number == line).unwrap_or_else(|| panic!("no line {line}"))
}

fn fields(issues: &[FieldIssue]) -> Vec<&str> {
    issues.iter().map(|i| i.field.as_str()).collect()
}

// ---------------------------------------------------------------------------
// Performance.csv fixture
// ---------------------------------------------------------------------------

#[test]
fn fixture_format_is_detected_with_every_column_recognised() {
    let (conn, account) = setup();
    let p = preview(&conn, &request(&account, PERFORMANCE)).unwrap();
    assert_eq!(p.format, Format::Performance);
    assert!(p.file_issues.is_empty() && p.file_warnings.is_empty(), "{:?} {:?}", p.file_issues, p.file_warnings);
    assert_eq!(p.headers.len(), 13);
    assert!(p.ignored_headers.is_empty(), "{:?}", p.ignored_headers);
    let mapped: Vec<(&str, &str)> =
        p.mapping.iter().map(|m| (m.field, m.header.as_deref().expect(m.field))).collect();
    for pair in [
        ("buyPrice", "buyPrice"),
        ("soldTimestamp", "soldTimestamp"),
        ("buyFillId", "buyFillId"),
        ("realizedPnl", "pnl"),
        ("duration", "duration"),
        ("priceFormat", "_priceFormat"),
        ("priceFormatType", "_priceFormatType"),
        ("tickSize", "_tickSize"),
    ] {
        assert!(mapped.contains(&pair), "{pair:?} in {mapped:?}");
    }
    assert_eq!(p.date_format, Some(values::DateFormat::Mdy));
    assert_eq!((p.row_count, p.new_count, p.invalid_count, p.duplicate_count, p.blank_count), (67, 67, 0, 0, 0));
    assert_eq!(p.rows.len(), 67);
    assert_eq!(p.warning_count as usize, SELL_FIRST_LINES.len());
}

#[test]
fn fixture_money_and_duration_styles_parse() {
    let (conn, account) = setup();
    let p = preview(&conn, &request(&account, PERFORMANCE)).unwrap();
    let t = |line| row(&p, line).trade.as_ref().unwrap();

    let first = t(2);
    assert_eq!((first.symbol.as_str(), first.quantity.as_str()), ("MNQZ6", "1"));
    assert_eq!((first.entry_price.as_str(), first.exit_price.as_deref()), ("29774.25", Some("29787.25")));
    assert_eq!(first.reported_pnl.as_deref(), Some("26"));
    assert_eq!(first.realized_pnl.as_deref(), Some("26"), "(29787.25 − 29774.25) × 1 × $2");
    assert_eq!((first.duration.as_deref(), first.duration_seconds), (Some("32sec"), Some(32)));
    assert_eq!((first.buy_fill_id.as_deref(), first.sell_fill_id.as_deref()), (Some("707776450007"), Some("707776450023")));
    assert_eq!(first.entry_at, "2026-10-19T11:47:48.000Z", "M/D/YYYY read in America/New_York (EDT)");
    assert_eq!(t(3).reported_pnl.as_deref(), Some("0"), "$0.00");
    assert_eq!((t(8).duration.as_deref(), t(8).duration_seconds), (Some("1min 17sec"), Some(77)));
    assert_eq!(t(17).reported_pnl.as_deref(), Some("-36"), "$(36.00)");
    assert_eq!(t(17).realized_pnl.as_deref(), Some("-36"));
    assert_eq!(t(21).duration_seconds, Some(164), "2min 44sec");
    // Every exported P&L matches the calculation, so no P&L warnings.
    assert!(p.rows.iter().all(|r| r.warnings.iter().all(|w| w.field != "realizedPnl")));
}

#[test]
fn fixture_rows_sharing_a_fill_stay_distinct() {
    let (conn, account) = setup();
    let p = preview(&conn, &request(&account, PERFORMANCE)).unwrap();
    // Lines 2–4: one buy fill closed by three sells. Lines 20–22: three buys
    // closed by one sell.
    for lines in [[2, 3, 4], [20, 21, 22]] {
        let reports: Vec<&RowReport> = lines.iter().map(|l| row(&p, *l)).collect();
        assert!(reports.iter().all(|r| r.status == "new" && r.duplicate.is_none()), "{lines:?}");
    }
    let t3 = row(&p, 3).trade.as_ref().unwrap();
    let t4 = row(&p, 4).trade.as_ref().unwrap();
    assert_eq!((&t3.entry_at, &t3.exit_at, &t3.realized_pnl), (&t4.entry_at, &t4.exit_at, &t4.realized_pnl));
    assert_ne!(t3.sell_fill_id, t4.sell_fill_id);
}

#[test]
fn fixture_sell_before_buy_keeps_both_timestamps_and_warns() {
    let (mut conn, account) = setup();
    let p = preview(&conn, &request(&account, PERFORMANCE)).unwrap();
    let warned: Vec<u64> = p.rows.iter().filter(|r| !r.warnings.is_empty()).map(|r| r.line_number).collect();
    assert_eq!(warned, SELL_FIRST_LINES);

    let r = row(&p, 8);
    assert_eq!(r.status, "new", "an order anomaly is a warning, not an error");
    assert_eq!(fields(&r.warnings), ["soldTimestamp"]);
    assert!(r.warnings[0].message.contains("10/19/2026 07:52:38") && r.warnings[0].message.contains("short"));
    let t = r.trade.as_ref().unwrap();
    assert_eq!((t.side, t.entry_basis), ("short", Some("sell_first")));
    assert_eq!(t.bought_at_source.as_deref(), Some("10/19/2026 07:53:55"));
    assert_eq!(t.sold_at_source.as_deref(), Some("10/19/2026 07:52:38"));
    assert_eq!((t.entry_at.as_str(), t.exit_at.as_deref()), ("2026-10-19T11:52:38.000Z", Some("2026-10-19T11:53:55.000Z")));
    assert_eq!(t.realized_pnl.as_deref(), Some("30"));
    assert_eq!(row(&p, 2).trade.as_ref().unwrap().entry_basis, Some("buy_first"));

    commit(&mut conn, &request(&account, PERFORMANCE)).unwrap();
    let saved = trade_store::list(&conn, &account).unwrap();
    let st = saved.iter().find(|t| t.round_trip.as_ref().unwrap().sell_fill_id.as_deref() == Some("707776450114")).unwrap();
    let rt = st.round_trip.as_ref().unwrap();
    assert_eq!((rt.bought_at_source.as_str(), rt.sold_at_source.as_str()), ("10/19/2026 07:53:55", "10/19/2026 07:52:38"));
    assert_eq!((rt.buy_price.as_str(), rt.sell_price.as_str(), rt.entry_basis.as_str()), ("29728.25", "29733.25", "sell_first"));
    assert_eq!((rt.price_format.as_deref(), rt.price_format_type.as_deref(), rt.tick_size.as_deref()), (Some("-2"), Some("0"), Some("0.25")));
}

#[test]
fn fixture_import_persists_and_reimport_flags_fill_pairs() {
    let dir = std::env::temp_dir().join(format!("fundedflow-import-{}", uuid::Uuid::now_v7()));
    let path = dir.join(crate::db::DB_FILE_NAME);
    let account = {
        let mut conn = crate::db::open_file(&path).unwrap();
        let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
        let b = commit(&mut conn, &request(&a.id, PERFORMANCE)).unwrap();
        assert_eq!(b.source_format, "performance");
        assert_eq!((b.row_count, b.imported_count, b.duplicate_count, b.failed_count), (67, 67, 0, 0));
        assert_eq!(b.warning_count, 21);
        a.id
    };

    // Reopen the file: the trades and their source values were saved.
    let mut conn = crate::db::open_file(&path).unwrap();
    let saved = trade_store::list(&conn, &account).unwrap();
    assert_eq!(saved.len(), 67);
    assert!(saved.iter().all(|t| t.source == "csv_import" && t.round_trip.is_some()));
    assert_eq!(count(&conn, "SELECT count(*) FROM import_rows WHERE warnings_json <> '[]'"), 21);

    let p = preview(&conn, &request(&account, PERFORMANCE)).unwrap();
    assert!(p.file_previously_imported);
    assert_eq!((p.new_count, p.duplicate_count), (0, 67));
    let dup = row(&p, 2).duplicate.as_ref().unwrap();
    assert_eq!((dup.of, dup.key.as_str()), ("saved", "fills2:12:707776450007:707776450023"));
    assert!(dup.reason.contains("buy/sell fill IDs (707776450007 / 707776450023)"), "{}", dup.reason);
    assert!(dup.reason.contains("'Performance.csv'"));

    let b = commit(&mut conn, &request(&account, PERFORMANCE)).unwrap();
    assert_eq!((b.imported_count, b.duplicate_count, b.skipped_count), (0, 67, 67));
    assert_eq!(trade_store::list(&conn, &account).unwrap().len(), 67);
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn invalid_values_get_row_specific_errors_and_are_excluded() {
    let (mut conn, account) = setup();
    let header = PERFORMANCE.lines().next().unwrap();
    let ok = "MNQZ6,-2,0,0.25,9001,9002,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,32sec";
    let content = [
        header,
        "MNQZ6,-2,0,0.25,9011,9012,0,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,32sec",
        "MNQZ6,-2,0,0.25,9021,9022,1,29774.25,29787.25,$26.00x,10/19/2026 07:47:48,10/19/2026 07:48:21,32sec",
        "MNQZ6,-2,0,0.25,9031,9032,1,29774.25,29787.25,$26.00,19/10/2026 07:47:48,10/19/2026 07:48:21,32sec",
        "MNQZ6,-2,0,0.25,9041,9042,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,5 parsecs",
        "MNQZ6,-2,0,0.25,9051,9052,1,29774.25,abc,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,32sec",
        "<b>MNQ</b>,-2,0,0.25,9061,9062,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,32sec",
        "MNQZ6,-2,0",
        "",
        ",,,,,,,,,,,,",
        ok,
    ]
    .join("\r\n");
    let p = preview(&conn, &request(&account, &content)).unwrap();
    let expect = [
        (2, vec!["quantity"]),
        (3, vec!["realizedPnl"]),
        (4, vec!["boughtTimestamp"]),
        (5, vec!["duration"]),
        (6, vec!["sellPrice"]),
        (7, vec!["symbol"]),
    ];
    for (line, want) in expect {
        let r = row(&p, line);
        assert_eq!((r.status, fields(&r.errors)), ("invalid", want.clone()), "line {line}");
    }
    assert!(row(&p, 2).errors[0].message.contains("column 'qty'"));
    assert!(row(&p, 4).errors[0].message.contains("M/D/YYYY"));
    assert_eq!(row(&p, 7).raw[0], "<b>MNQ</b>", "raw text is kept verbatim for display as text");
    assert_eq!(row(&p, 8).errors[0].field, "row");
    assert_eq!(row(&p, 10).status, "blank");
    assert_eq!(row(&p, 11).status, "new");
    assert_eq!((p.new_count, p.invalid_count, p.blank_count), (1, 7, 1));

    let b = commit(&mut conn, &request(&account, &content)).unwrap();
    assert_eq!((b.imported_count, b.failed_count, b.skipped_count), (1, 7, 1));
    let problems = list_problem_rows(&conn, &b.id).unwrap();
    assert_eq!(problems.iter().filter(|r| r.status == "invalid").count(), 7);
    assert_eq!(problems[0].errors[0].field, "quantity");
    assert_eq!(trade_store::list(&conn, &account).unwrap().len(), 1);
}

#[test]
fn a_failed_save_leaves_no_partial_import() {
    let (mut conn, account) = setup();
    // Fail on the last row's source record, after 66 trades were written.
    conn.execute_batch(
        "CREATE TRIGGER boom BEFORE INSERT ON trade_round_trips WHEN NEW.sell_fill_id = '707776451304'
           AND NEW.buy_fill_id = '707776451294'
         BEGIN SELECT RAISE(ABORT, 'disk full (simulated)'); END;",
    )
    .unwrap();
    let err = commit(&mut conn, &request(&account, PERFORMANCE)).unwrap_err();
    assert!(err.to_string().contains("disk full"));
    for table in ["trades", "trade_round_trips", "import_rows"] {
        assert_eq!(count(&conn, &format!("SELECT count(*) FROM {table}")), 0, "{table}");
    }
    let batches = list_batches(&conn, &account).unwrap();
    assert_eq!(batches.len(), 1);
    assert_eq!((batches[0].status.as_str(), batches[0].imported_count, batches[0].row_count), ("failed", 0, 67));
}

#[test]
fn performance_rows_without_fill_ids_fall_back_to_trade_values() {
    let (mut conn, account) = setup();
    let content = "symbol,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp
MNQZ6,1,29834.00,29834.50,$1.00,10/19/2026 08:19:37,10/19/2026 08:20:59
MNQZ6,1,29834.00,29834.50,$1.00,10/19/2026 08:19:37,10/19/2026 08:20:59
MNQZ6,1,29834.00,29834.75,$1.50,10/19/2026 08:19:37,10/19/2026 08:20:59
";
    let p = preview(&conn, &request(&account, content)).unwrap();
    assert_eq!(p.format, Format::Performance);
    assert_eq!((p.new_count, p.duplicate_count), (2, 1));
    let dup = row(&p, 3).duplicate.as_ref().unwrap();
    assert_eq!(dup.of, "file");
    assert!(dup.key.starts_with("rt:"));
    assert!(dup.reason.contains("line 2") && dup.reason.contains("no IDs"), "{}", dup.reason);
    commit(&mut conn, &request(&account, content)).unwrap();
    let again = preview(&conn, &request(&account, content)).unwrap();
    assert_eq!((again.new_count, again.duplicate_count), (0, 3));
}

// ---------------------------------------------------------------------------
// Generic CSVs
// ---------------------------------------------------------------------------

const GENERIC: &str = "\u{feff}Trade ID,Ticker,Action,Qty,Open Time,Open Price,Close Time,Close Price,Commission,P&L,Notes\r
T1,MESZ6,Buy,2,2026-10-19 09:30:00,\"5,000.25\",2026-10-19 09:45:00,5004.00,$2.48,$37.50,\"retest, \"\"A+\"\" setup\"\r
T2,MNQZ6,Sell,1,2026-10-19 10:00:00,21000,2026-10-19 10:05:00,21010.5,(1.24),$(21.00),\r
T3,ESZ6,Long,abc,2026-10-19 11:00:00,5000,2026-10-19 10:00:00,5001,0,,\r
,,,,,,,,,,\r
T1,MESZ6,Buy,2,2026-10-19 09:30:00,5000.25,2026-10-19 09:45:00,5004.00,$2.48,$37.50,again\r
";

#[test]
fn generic_broker_csv_is_mapped_validated_and_deduplicated() {
    let (mut conn, account) = setup();
    let p = preview(&conn, &request(&account, GENERIC)).unwrap();
    assert_eq!(p.format, Format::Generic);
    assert!(p.file_issues.is_empty(), "{:?}", p.file_issues);
    assert_eq!(p.date_format, Some(values::DateFormat::Ymd));
    assert_eq!((p.new_count, p.invalid_count, p.blank_count, p.duplicate_count), (2, 1, 1, 1));

    let t1 = row(&p, 2).trade.as_ref().unwrap();
    assert_eq!((t1.entry_price.as_str(), t1.realized_pnl.as_deref()), ("5000.25", Some("35.02")));
    assert_eq!(fields(&row(&p, 3).warnings), ["fees"], "negative fees are flagged");
    assert_eq!(fields(&row(&p, 4).errors), ["quantity", "exitAt"]);
    let dup = row(&p, 6).duplicate.as_ref().unwrap();
    assert!(dup.reason.contains("trade ID (T1)") && dup.reason.contains("line 2"), "{}", dup.reason);

    let b = commit(&mut conn, &request(&account, GENERIC)).unwrap();
    assert_eq!((b.imported_count, b.duplicate_count, b.failed_count, b.skipped_count), (2, 1, 1, 2));
    let notes: Vec<_> = trade_store::list(&conn, &account).unwrap().into_iter().filter_map(|t| t.notes).collect();
    assert_eq!(notes, ["retest, \"A+\" setup"], "quoted commas and escaped quotes survive");
}

#[test]
fn generic_identical_rows_without_ids_are_duplicates() {
    let (conn, account) = setup();
    let content = "Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price
ESZ6,Buy,1,2026-10-19 09:30:00,5000,2026-10-19 09:31:00,5001
ESZ6,Buy,1,2026-10-19 09:30:00,5000,2026-10-19 09:31:00,5001
";
    let p = preview(&conn, &request(&account, content)).unwrap();
    assert_eq!((p.new_count, p.duplicate_count), (1, 1));
    assert!(row(&p, 3).duplicate.as_ref().unwrap().reason.contains("line 2"));
}

#[test]
fn ambiguous_slash_dates_require_an_explicit_format() {
    let (conn, account) = setup();
    let content = "Symbol,Side,Qty,Entry Time,Entry Price
ESZ6,Buy,1,03/04/2026 09:30:00,5000
";
    let p = preview(&conn, &request(&account, content)).unwrap();
    assert_eq!(fields(&p.file_issues), ["dateFormat"]);

    let dmy = CsvImportRequest { date_format: DateFormatChoice::Dmy, ..request(&account, content) };
    let p = preview(&conn, &dmy).unwrap();
    assert!(p.file_issues.is_empty());
    assert_eq!(row(&p, 2).trade.as_ref().unwrap().entry_at, "2026-04-03T13:30:00.000Z", "3 April, EDT");
}

#[test]
fn file_level_problems_block_the_import_and_are_recorded() {
    let (mut conn, account) = setup();
    for (content, field) in [
        ("", "content"),
        ("Symbol,Side,Qty,Entry Time,Entry Price\n", "content"),
        ("Symbol,Side,Qty,Qty,Entry Time,Entry Price\nES,Buy,1,1,2026-10-19 09:30:00,5000\n", "columns.quantity"),
        ("Foo,Bar\n1,2\n", "columns.symbol"),
    ] {
        let p = preview(&conn, &request(&account, content)).unwrap();
        assert_eq!(p.file_issues.first().map(|i| i.field.as_str()), Some(field), "{content:?}");
    }
    let err = commit(&mut conn, &request(&account, "Foo,Bar\n1,2\n")).unwrap_err();
    assert!(matches!(err, AppError::Validation { .. }));
    let batches = list_batches(&conn, &account).unwrap();
    assert_eq!((batches.len(), batches[0].status.as_str()), (1, "failed"));
}

#[test]
fn reimporting_restores_deleted_trades_once_and_keeps_active_ones_duplicate() {
    let (mut conn, account) = setup();
    commit(&mut conn, &request(&account, PERFORMANCE)).unwrap();
    let deleted: Vec<_> = trade_store::list(&conn, &account).unwrap().into_iter().take(2).collect();
    for t in &deleted {
        trade_store::delete(&mut conn, &t.id).unwrap();
    }

    // Preview and commit agree: the two deleted trades come back, the rest are duplicates.
    let p = preview(&conn, &request(&account, PERFORMANCE)).unwrap();
    assert_eq!((p.new_count, p.restore_count, p.duplicate_count), (2, 2, 65));
    for t in &deleted {
        let r = p.rows.iter().find(|r| r.restores.as_ref().is_some_and(|x| x.trade_id == t.id)).unwrap();
        assert_eq!(r.status, "new");
        assert!(r.duplicate.is_none());
        assert!(r.restores.as_ref().unwrap().reason.contains("deleted on"), "{:?}", r.restores);
    }

    let b = commit(&mut conn, &request(&account, PERFORMANCE)).unwrap();
    assert_eq!((b.imported_count, b.duplicate_count), (2, 65));
    let ids: Vec<String> = trade_store::list(&conn, &account).unwrap().into_iter().map(|t| t.id).collect();
    assert_eq!(ids.len(), 67);
    assert!(deleted.iter().all(|t| ids.contains(&t.id)), "the same trades are restored, not copied");
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 67, "no second row per trade");

    // Without deletions, a repeat import is all duplicates.
    let again = commit(&mut conn, &request(&account, PERFORMANCE)).unwrap();
    assert_eq!((again.imported_count, again.duplicate_count), (0, 67));
    assert_eq!(count(&conn, "SELECT count(*) FROM trades WHERE deleted_at IS NULL"), 67);
}

#[test]
fn a_restored_trade_is_restored_once_per_file() {
    let (mut conn, account) = setup();
    let line = PERFORMANCE.lines().nth(1).unwrap();
    let header = PERFORMANCE.lines().next().unwrap();
    let csv = format!("{header}\n{line}\n");
    commit(&mut conn, &request(&account, &csv)).unwrap();
    let t = trade_store::list(&conn, &account).unwrap().remove(0);
    trade_store::delete(&mut conn, &t.id).unwrap();

    // The second copy of the row is an in-file duplicate of the restore.
    let twice = format!("{header}\n{line}\n{line}\n");
    let p = preview(&conn, &request(&account, &twice)).unwrap();
    assert_eq!((p.new_count, p.restore_count, p.duplicate_count), (1, 1, 1));
    let b = commit(&mut conn, &request(&account, &twice)).unwrap();
    assert_eq!((b.imported_count, b.duplicate_count), (1, 1));
    let dup_of: Option<String> = conn
        .query_row("SELECT duplicate_of_trade_id FROM import_rows WHERE batch_id = ?1 AND status = 'duplicate'", [&b.id], |r| r.get(0))
        .unwrap();
    assert_eq!(dup_of.as_deref(), Some(t.id.as_str()));
    assert_eq!(trade_store::list(&conn, &account).unwrap().len(), 1);
}

#[path = "regression_tests.rs"]
mod regressions;

#[path = "target_tests.rs"]
mod target_acceptance;

#[path = "identity_tests.rs"]
mod identity;
