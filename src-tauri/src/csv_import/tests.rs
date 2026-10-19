//! CSV parsing, validation reporting, duplicate handling and rollback.

use rusqlite::Connection;

use super::*;
use crate::store::accounts;
use crate::store::tests::{account_input, db};

const FILE: &str = "\u{feff}Trade ID, Symbol ,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price,Commission,P&L
T1,MESZ6,Buy,2,2026-10-19 09:30:00,\"5,000.25\",2026-10-19 09:45:00,5004.00,$2.48,$37.50
T2,MNQZ6,Sell,1,10/19/2026 10:00:00,21000,10/19/2026 10:05:00,21010.5,(1.24),(21.00)
T3,ESZ6,Long,abc,2026-10-19 11:00:00,5000,2026-10-19 10:00:00,5001,0,
,,,,,,,,,
T4,ESZ6,Short,1,2026-10-19 12:00:00,5000
";

fn mapping() -> ColumnMapping {
    ColumnMapping {
        symbol: "symbol".into(),
        side: "Side".into(),
        quantity: "Qty".into(),
        entry_time: "Entry Time".into(),
        entry_price: "Entry Price".into(),
        exit_time: Some("Exit Time".into()),
        exit_price: Some("Exit Price".into()),
        fees: Some("Commission".into()),
        realized_pnl: Some("P&L".into()),
        broker_trade_id: Some("Trade ID".into()),
        notes: None,
    }
}

fn request(account_id: &str, content: &str) -> CsvImportRequest {
    CsvImportRequest {
        account_id: account_id.into(),
        file_name: "tradovate-2026-10-19.csv".into(),
        content: content.into(),
        columns: mapping(),
        timezone: "America/New_York".into(),
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

#[test]
fn preview_validates_every_row_without_writing() {
    let (conn, account) = setup();
    let p = preview(&conn, &request(&account, FILE)).unwrap();
    assert!(p.file_issues.is_empty(), "{:?}", p.file_issues);
    assert_eq!(p.headers[1], " Symbol ");
    assert_eq!(
        (p.row_count, p.new_count, p.duplicate_count, p.skipped_count, p.invalid_count),
        (5, 2, 0, 1, 2)
    );

    let t1 = p.rows[0].trade.as_ref().unwrap();
    assert_eq!((t1.symbol.as_str(), t1.side.as_str(), t1.entry_price.as_str()), ("MESZ6", "long", "5000.25"));
    assert_eq!(t1.entry_at, "2026-10-19T13:30:00.000Z", "naive times are read in the file's timezone");
    assert_eq!(t1.realized_pnl.as_deref(), Some("35.02"));
    let t2 = p.rows[1].trade.as_ref().unwrap();
    assert_eq!((t2.side.as_str(), t2.fees.as_str()), ("short", "1.24"));
    assert_eq!(t2.realized_pnl.as_deref(), Some("-22.24"));

    let bad = &p.rows[2];
    assert_eq!((bad.status, bad.line_number), ("invalid", 4));
    let fields: Vec<_> = bad.issues.iter().map(|i| i.field.as_str()).collect();
    assert_eq!(fields, ["quantity", "exitAt"]);
    assert!(bad.issues[0].message.contains("column 'Qty'"));
    assert_eq!(bad.raw[0], "T3");
    assert_eq!(p.rows[3].status, "skipped");
    assert_eq!(p.rows[4].status, "invalid");
    assert_eq!(p.rows[4].issues[0].field, "row");

    assert_eq!(count(&conn, "SELECT count(*) FROM import_batches"), 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 0);
}

#[test]
fn commit_imports_valid_rows_and_keeps_the_rest_with_reasons() {
    let (mut conn, account) = setup();
    let b = commit(&mut conn, &request(&account, FILE)).unwrap();
    assert_eq!(b.status, "committed");
    assert_eq!(
        (b.row_count, b.imported_count, b.skipped_count, b.duplicate_count, b.failed_count),
        (5, 2, 1, 0, 2)
    );
    assert_eq!(count(&conn, "SELECT count(*) FROM import_rows"), 5, "every row is retained");

    let trades = crate::store::trades::list(&conn, &account).unwrap();
    assert_eq!(trades.len(), 2);
    assert!(trades.iter().all(|t| t.source == "csv_import" && t.import_batch_id.as_deref() == Some(b.id.as_str())));
    let mes = trades.iter().find(|t| t.symbol == "MESZ6").unwrap();
    assert_eq!(mes.broker_trade_id.as_deref(), Some("T1"));
    assert_eq!(mes.reported_pnl.as_deref(), Some("37.5"));
    assert_eq!(mes.pnl_status, "calculated");

    let problems = list_problem_rows(&conn, &b.id).unwrap();
    let summary: Vec<_> = problems.iter().map(|r| (r.row_number, r.status.as_str())).collect();
    assert_eq!(summary, [(3, "invalid"), (4, "skipped"), (5, "invalid")]);
    assert_eq!(problems[0].raw[3], "abc");
    assert_eq!(problems[0].issues[0].field, "quantity");

    assert_eq!(list_batches(&conn, &account).unwrap().len(), 1);
}

#[test]
fn reimporting_a_file_skips_every_duplicate() {
    let (mut conn, account) = setup();
    commit(&mut conn, &request(&account, FILE)).unwrap();

    let p = preview(&conn, &request(&account, FILE)).unwrap();
    assert!(p.file_previously_imported);
    assert_eq!((p.new_count, p.duplicate_count, p.skipped_count), (0, 2, 3));

    let b = commit(&mut conn, &request(&account, FILE)).unwrap();
    assert_eq!((b.imported_count, b.duplicate_count, b.skipped_count, b.failed_count), (0, 2, 3, 2));
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 2);
    let linked = count(&conn, "SELECT count(*) FROM import_rows WHERE status = 'duplicate' AND duplicate_of_trade_id IS NOT NULL");
    assert_eq!(linked, 2);

    // Another account is a separate scope.
    let other = accounts::create(&mut conn, account_input("Other")).unwrap();
    let b = commit(&mut conn, &request(&other.id, FILE)).unwrap();
    assert_eq!(b.imported_count, 2);
}

#[test]
fn identical_rows_without_ids_are_counted_by_occurrence() {
    let (mut conn, account) = setup();
    let no_ids = |rows: usize| {
        let mut s = String::from("Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price\n");
        for _ in 0..rows {
            s.push_str("ESZ6,Buy,1,2026-10-19 09:30:00,5000,2026-10-19 09:31:00,5001\n");
        }
        s
    };
    let req = |content: String| CsvImportRequest {
        columns: ColumnMapping { fees: None, realized_pnl: None, broker_trade_id: None, ..mapping() },
        ..request(&account, &content)
    };
    // Two genuine identical partial fills in one export are both kept.
    assert_eq!(commit(&mut conn, &req(no_ids(2))).unwrap().imported_count, 2);
    // A longer export containing them again adds only the new third one.
    let b = commit(&mut conn, &req(no_ids(3))).unwrap();
    assert_eq!((b.imported_count, b.duplicate_count), (1, 2));
}

#[test]
fn repeated_broker_ids_within_a_file_are_duplicates() {
    let (mut conn, account) = setup();
    let content = "Trade ID,Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price,Commission,P&L
X1,ESZ6,Buy,1,2026-10-19 09:30:00,5000,2026-10-19 09:31:00,5001,0,
X1,ESZ6,Buy,1,2026-10-19 09:30:00,5000,2026-10-19 09:31:00,5001,0,
";
    let p = preview(&conn, &request(&account, content)).unwrap();
    assert_eq!((p.new_count, p.duplicate_count), (1, 1));
    assert_eq!(p.rows[1].issues[0].message, "same broker trade ID as row 1");
    let b = commit(&mut conn, &request(&account, content)).unwrap();
    assert_eq!((b.imported_count, b.duplicate_count), (1, 1));
}

#[test]
fn deleted_imported_trades_are_not_resurrected() {
    let (mut conn, account) = setup();
    commit(&mut conn, &request(&account, FILE)).unwrap();
    let t = crate::store::trades::list(&conn, &account).unwrap().remove(0);
    crate::store::trades::delete(&mut conn, &t.id).unwrap();
    let b = commit(&mut conn, &request(&account, FILE)).unwrap();
    assert_eq!(b.imported_count, 0);
    assert_eq!(crate::store::trades::list(&conn, &account).unwrap().len(), 1);
}

#[test]
fn unusable_mapping_imports_nothing_and_records_the_attempt() {
    let (mut conn, account) = setup();
    let req = CsvImportRequest {
        columns: ColumnMapping { symbol: "Ticker".into(), exit_price: None, ..mapping() },
        ..request(&account, FILE)
    };
    let p = preview(&conn, &req).unwrap();
    let fields: Vec<_> = p.file_issues.iter().map(|i| i.field.as_str()).collect();
    assert_eq!(fields, ["columns.symbol", "columns.exitPrice"]);

    let err = commit(&mut conn, &req).unwrap_err();
    assert!(matches!(err, AppError::Validation { .. }));
    let batches = list_batches(&conn, &account).unwrap();
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].status, "failed");
    assert!(batches[0].error_summary.as_deref().unwrap().contains("fields are invalid"));
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 0);

    let header_only = format!("{}\n", FILE.lines().next().unwrap());
    for content in ["", header_only.as_str()] {
        let p = preview(&conn, &request(&account, content)).unwrap();
        assert_eq!(p.file_issues[0].field, "content", "{content:?}");
    }
}

#[test]
fn a_failing_write_rolls_back_the_whole_batch() {
    let (mut conn, account) = setup();
    conn.execute_batch(
        "CREATE TRIGGER boom BEFORE INSERT ON trades WHEN NEW.symbol = 'BOOM'
         BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    let content = "Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price
ESZ6,Buy,1,2026-10-19 09:30:00,5000,2026-10-19 09:31:00,5001
BOOM,Buy,1,2026-10-19 09:30:00,5000,2026-10-19 09:31:00,5001
";
    let req = CsvImportRequest {
        columns: ColumnMapping { fees: None, realized_pnl: None, broker_trade_id: None, ..mapping() },
        ..request(&account, content)
    };
    assert!(commit(&mut conn, &req).is_err());

    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 0, "the first row must be rolled back");
    assert_eq!(count(&conn, "SELECT count(*) FROM import_rows"), 0);
    let batches = list_batches(&conn, &account).unwrap();
    assert_eq!(batches.len(), 1);
    let b = &batches[0];
    assert_eq!((b.status.as_str(), b.imported_count, b.row_count), ("failed", 0, 2));
    assert!(b.error_summary.as_deref().unwrap().contains("boom"));
}

#[test]
fn parses_common_timestamp_shapes() {
    let ny: Tz = "America/New_York".parse().unwrap();
    let utc = |s: &str| parse_csv_time(s, ny).map(format_instant);
    assert_eq!(utc("2026-10-19 09:30:00").unwrap(), "2026-10-19T13:30:00.000Z");
    assert_eq!(utc("2026-10-19T09:30:00.250").unwrap(), "2026-10-19T13:30:00.250Z");
    assert_eq!(utc("10/19/2026 9:30").unwrap(), "2026-10-19T13:30:00.000Z");
    assert_eq!(utc("10/19/2026 09:30:00 PM").unwrap(), "2026-10-20T01:30:00.000Z");
    assert_eq!(utc("2026-10-19T09:30:00+01:00").unwrap(), "2026-10-19T08:30:00.000Z");
    assert!(utc("2026-11-01 01:30:00").unwrap_err().contains("ambiguous"));
    assert!(utc("2026-03-08 02:30:00").unwrap_err().contains("does not exist"));
    assert!(utc("19 Oct 2026").is_err());
}

#[test]
fn cleans_currency_formatted_numbers() {
    assert_eq!(clean_number(" $1,234.50 "), "1234.50");
    assert_eq!(clean_number("(12.50)"), "-12.50");
    assert_eq!(clean_number("$(3)"), "-3");
}
