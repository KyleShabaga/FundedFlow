//! Repository behaviour: CRUD, validation, relationships and delete rules.

use rusqlite::Connection;

use super::accounts::{self, AccountInput};
use super::journal::{self, JournalEntryInput};
use super::trades::{self, TradeInput};
use crate::error::AppError;

pub(crate) fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::migrate(&mut conn).unwrap();
    conn
}

pub(crate) fn account_input(name: &str) -> AccountInput {
    AccountInput {
        name: name.into(),
        broker: Some("Tradovate".into()),
        prop_firm: Some("Topstep".into()),
        external_ref: None,
        account_type: "evaluation".into(),
        status: "active".into(),
        currency: "usd".into(),
        starting_balance: "50000".into(),
        timezone: "America/New_York".into(),
        trading_day_reset_time: "17:00".into(),
        notes: None,
    }
}

fn trade_input(account_id: &str) -> TradeInput {
    TradeInput {
        account_id: account_id.into(),
        symbol: "esz6".into(),
        side: "long".into(),
        quantity: "1".into(),
        entry_at: "2026-10-19T13:30:00Z".into(),
        entry_price: "5000.25".into(),
        exit_at: Some("2026-10-19T14:00:00-04:00".into()),
        exit_price: Some("5004.50".into()),
        fees: Some("4.12".into()),
        realized_pnl: None,
        notes: Some("  breakout retest  ".into()),
    }
}

fn journal_input(account_id: &str, trade_id: Option<&str>) -> JournalEntryInput {
    JournalEntryInput {
        account_id: account_id.into(),
        trade_id: trade_id.map(str::to_string),
        entry_at: "2026-10-19T21:00:00Z".into(),
        title: " Post-session review ".into(),
        body: "Waited for the retest.".into(),
        tags: vec!["discipline".into(), " A+ setup ".into(), "Discipline".into(), "".into()],
    }
}

fn issue_fields(err: AppError) -> Vec<String> {
    match err {
        AppError::Validation { issues, .. } => issues.into_iter().map(|i| i.field).collect(),
        other => panic!("expected a validation error, got {other:?}"),
    }
}

#[test]
fn account_crud_round_trip() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval 50K")).unwrap();
    assert_eq!(a.currency, "USD");
    assert_eq!(a.starting_balance, "50000");
    assert_eq!(a.prop_firm.as_deref(), Some("Topstep"));

    // The prop firm is found case-insensitively rather than duplicated.
    let b = accounts::create(&mut conn, AccountInput { prop_firm: Some("topstep".into()), ..account_input("Eval 2") })
        .unwrap();
    assert_eq!(b.prop_firm.as_deref(), Some("Topstep"));
    let firms: i64 = conn.query_row("SELECT count(*) FROM firms", [], |r| r.get(0)).unwrap();
    assert_eq!(firms, 1);

    let updated = accounts::update(
        &mut conn,
        &a.id,
        AccountInput { status: "passed".into(), starting_balance: "50000.5".into(), ..account_input("Eval 50K") },
    )
    .unwrap();
    assert_eq!(updated.status, "passed");
    assert_eq!(updated.starting_balance, "50000.5");
    let events: Vec<String> = conn
        .prepare("SELECT status FROM account_status_events WHERE account_id = ?1 ORDER BY rowid")
        .unwrap()
        .query_map([&a.id], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(events, ["active", "passed"]);

    let names: Vec<String> = accounts::list(&conn).unwrap().into_iter().map(|a| a.name).collect();
    assert_eq!(names, ["Eval 2", "Eval 50K"]);
    accounts::archive(&mut conn, &a.id).unwrap();
    assert!(matches!(accounts::get(&conn, &a.id), Err(AppError::NotFound { .. })));
    assert!(matches!(accounts::archive(&mut conn, &a.id), Err(AppError::NotFound { .. })));
    let names: Vec<String> = accounts::list(&conn).unwrap().into_iter().map(|a| a.name).collect();
    assert_eq!(names, ["Eval 2"]);
}

#[test]
fn account_validation_reports_each_field() {
    let mut conn = db();
    let bad = AccountInput {
        name: "  ".into(),
        account_type: "funded".into(),
        status: "open".into(),
        currency: "US".into(),
        starting_balance: "-1".into(),
        timezone: "Mars/Olympus".into(),
        trading_day_reset_time: "25:00".into(),
        ..account_input("x")
    };
    let fields = issue_fields(accounts::create(&mut conn, bad).unwrap_err());
    assert_eq!(
        fields,
        ["name", "accountType", "status", "currency", "startingBalance", "timezone", "tradingDayResetTime"]
    );
    assert!(accounts::list(&conn).unwrap().is_empty(), "nothing is written on validation failure");
}

#[test]
fn broker_account_numbers_are_unique() {
    let mut conn = db();
    let with_ref = |name: &str| AccountInput { external_ref: Some("TV-123".into()), ..account_input(name) };
    let one = accounts::create(&mut conn, with_ref("One")).unwrap();
    let err = accounts::create(&mut conn, with_ref("Two")).unwrap_err();
    assert!(matches!(err, AppError::Conflict { .. }), "{err:?}");
    // An archived account frees its number.
    accounts::archive(&mut conn, &one.id).unwrap();
    accounts::create(&mut conn, with_ref("Two")).unwrap();
}

#[test]
fn trade_crud_derives_trading_day_and_pnl() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let t = trades::create(&mut conn, trade_input(&a.id)).unwrap();
    assert_eq!(t.symbol, "ESZ6");
    assert_eq!(t.source, "manual");
    assert_eq!(t.entry_at, "2026-10-19T13:30:00.000Z");
    assert_eq!(t.exit_at.as_deref(), Some("2026-10-19T18:00:00.000Z"));
    // (5004.50 − 5000.25) × 1 × $50 = $212.50 gross, minus $4.12 fees.
    assert_eq!(t.gross_pnl.as_deref(), Some("212.5"));
    assert_eq!(t.realized_pnl.as_deref(), Some("208.38"));
    assert_eq!(t.pnl_status, "calculated");
    assert_eq!(t.trading_day, "2026-10-19");
    assert_eq!(t.notes.as_deref(), Some("breakout retest"));

    // Close after the 17:00 New York reset → next trading day.
    let late = TradeInput { exit_at: Some("2026-10-19T21:30:00Z".into()), side: "short".into(), ..trade_input(&a.id) };
    let t = trades::update(&mut conn, &t.id, late).unwrap();
    assert_eq!(t.trading_day, "2026-10-20");
    assert_eq!(t.realized_pnl.as_deref(), Some("-216.62"));

    // Open trade: no P&L, and a reported P&L is rejected.
    let open = TradeInput { exit_at: None, exit_price: None, ..trade_input(&a.id) };
    let o = trades::create(&mut conn, open.clone()).unwrap();
    assert_eq!((o.pnl_status.as_str(), o.realized_pnl.as_deref()), ("open", None));
    let fields = issue_fields(
        trades::create(&mut conn, TradeInput { realized_pnl: Some("5".into()), ..open }).unwrap_err(),
    );
    assert_eq!(fields, ["realizedPnl"]);

    // Unknown instrument falls back to the reported P&L.
    let stock = TradeInput { symbol: "AAPL".into(), realized_pnl: Some("10".into()), ..trade_input(&a.id) };
    let s = trades::create(&mut conn, stock).unwrap();
    assert_eq!((s.pnl_status.as_str(), s.realized_pnl.as_deref()), ("reported", Some("5.88")));

    assert_eq!(trades::list(&conn, &a.id).unwrap().len(), 3);
    trades::delete(&mut conn, &t.id).unwrap();
    assert_eq!(trades::list(&conn, &a.id).unwrap().len(), 2);
    assert!(matches!(trades::get(&conn, &t.id), Err(AppError::NotFound { .. })));
    assert!(matches!(trades::delete(&mut conn, &t.id), Err(AppError::NotFound { .. })));
}

#[test]
fn trades_cannot_move_between_accounts_or_reference_missing_accounts() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap();
    let b = accounts::create(&mut conn, account_input("B")).unwrap();
    let t = trades::create(&mut conn, trade_input(&a.id)).unwrap();
    assert_eq!(issue_fields(trades::update(&mut conn, &t.id, trade_input(&b.id)).unwrap_err()), ["accountId"]);
    assert!(matches!(trades::create(&mut conn, trade_input("nope")), Err(AppError::NotFound { .. })));
}

#[test]
fn changing_account_session_settings_rederives_trades() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let late = TradeInput { exit_at: Some("2026-10-19T21:30:00Z".into()), ..trade_input(&a.id) };
    let t = trades::create(&mut conn, late).unwrap();
    assert_eq!(t.trading_day, "2026-10-20");

    let calendar = AccountInput { trading_day_reset_time: "00:00".into(), ..account_input("Eval") };
    accounts::update(&mut conn, &a.id, calendar).unwrap();
    assert_eq!(trades::get(&conn, &t.id).unwrap().trading_day, "2026-10-19");

    // ES is quoted in USD; a EUR account cannot price it without FX.
    let eur = AccountInput { currency: "EUR".into(), ..account_input("Eval") };
    accounts::update(&mut conn, &a.id, eur).unwrap();
    let t = trades::get(&conn, &t.id).unwrap();
    assert_eq!((t.pnl_status.as_str(), t.realized_pnl), ("currency_mismatch", None));
}

#[test]
fn a_settings_change_that_fails_part_way_through_its_rederive_changes_nothing() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let first = trades::create(&mut conn, trade_input(&a.id)).unwrap();
    let late = TradeInput { exit_at: Some("2026-10-19T21:30:00Z".into()), ..trade_input(&a.id) };
    let second = trades::create(&mut conn, late).unwrap();
    // The bundle updates the account, then each trade; fail on the second trade.
    conn.execute_batch(&format!(
        "CREATE TEMP TRIGGER boom BEFORE UPDATE OF trading_day ON trades WHEN OLD.id = '{}'
         BEGIN SELECT RAISE(ABORT, 'disk full (simulated)'); END;",
        second.id
    ))
    .unwrap();

    let calendar = AccountInput { trading_day_reset_time: "00:00".into(), ..account_input("Eval") };
    let err = accounts::update(&mut conn, &a.id, calendar).unwrap_err();
    assert!(err.to_string().contains("disk full"), "{err}");
    assert_eq!(accounts::get(&conn, &a.id).unwrap(), a);
    assert_eq!(trades::get(&conn, &first.id).unwrap(), first);
    assert_eq!(trades::get(&conn, &second.id).unwrap(), second);
}

#[test]
fn journal_crud_with_tags_and_trade_link() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap();
    let t = trades::create(&mut conn, trade_input(&a.id)).unwrap();
    let j = journal::create(&mut conn, journal_input(&a.id, Some(&t.id))).unwrap();
    assert_eq!(j.title, "Post-session review");
    assert_eq!(j.trade_id.as_deref(), Some(t.id.as_str()));
    assert_eq!(j.entry_at, "2026-10-19T21:00:00.000Z");
    assert_eq!(j.tags, ["A+ setup", "discipline"]);

    let edit = JournalEntryInput { trade_id: None, tags: vec!["patience".into()], ..journal_input(&a.id, None) };
    let j = journal::update(&mut conn, &j.id, edit).unwrap();
    assert_eq!((j.trade_id, j.tags), (None, vec!["patience".to_string()]));
    let tags: i64 = conn.query_row("SELECT count(*) FROM tags", [], |r| r.get(0)).unwrap();
    assert_eq!(tags, 3, "tags are reusable and are not deleted with links");

    assert_eq!(journal::list(&conn, &a.id).unwrap().len(), 1);
    journal::delete(&conn, &j.id).unwrap();
    assert!(journal::list(&conn, &a.id).unwrap().is_empty());
    assert!(matches!(journal::delete(&conn, &j.id), Err(AppError::NotFound { .. })));
}

#[test]
fn journal_validation_and_relationship_rules() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap();
    let b = accounts::create(&mut conn, account_input("B")).unwrap();
    let tb = trades::create(&mut conn, trade_input(&b.id)).unwrap();

    let bad = JournalEntryInput {
        title: "".into(),
        entry_at: "19/10/2026".into(),
        tags: vec!["x".repeat(41)],
        ..journal_input(&a.id, Some(&tb.id))
    };
    assert_eq!(issue_fields(journal::create(&mut conn, bad).unwrap_err()), ["title", "entryAt", "tags", "tradeId"]);
    assert!(matches!(journal::create(&mut conn, journal_input("nope", None)), Err(AppError::NotFound { .. })));

    let j = journal::create(&mut conn, journal_input(&a.id, None)).unwrap();
    let moved = journal::update(&mut conn, &j.id, journal_input(&b.id, None)).unwrap_err();
    assert_eq!(issue_fields(moved), ["accountId"]);
}

#[test]
fn deleting_a_trade_unlinks_its_journal_entries() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap();
    let t = trades::create(&mut conn, trade_input(&a.id)).unwrap();
    let j = journal::create(&mut conn, journal_input(&a.id, Some(&t.id))).unwrap();
    trades::delete(&mut conn, &t.id).unwrap();
    assert_eq!(journal::get(&conn, &j.id).unwrap().trade_id, None);
    // A deleted trade cannot be linked again.
    let relink = journal::update(&mut conn, &j.id, journal_input(&a.id, Some(&t.id))).unwrap_err();
    assert_eq!(issue_fields(relink), ["tradeId"]);
}

#[test]
fn archiving_an_account_keeps_its_trades_and_journal_but_blocks_writes() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap();
    let keep = accounts::create(&mut conn, account_input("Keep")).unwrap();
    let t = trades::create(&mut conn, trade_input(&a.id)).unwrap();
    journal::create(&mut conn, journal_input(&a.id, Some(&t.id))).unwrap();
    trades::create(&mut conn, trade_input(&keep.id)).unwrap();

    accounts::archive(&mut conn, &a.id).unwrap();
    let left: i64 = conn.query_row("SELECT count(*) FROM trades", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 2);
    let journal: i64 = conn.query_row("SELECT count(*) FROM journal_entries", [], |r| r.get(0)).unwrap();
    assert_eq!(journal, 1);

    assert!(matches!(trades::create(&mut conn, trade_input(&a.id)), Err(AppError::NotFound { .. })));
    // Reads stay available (read-only browsing); writes are refused.
    assert_eq!(trades::list(&conn, &a.id).unwrap().len(), 1);
    assert_eq!(trades::list(&conn, &keep.id).unwrap().len(), 1);
}
