//! Account lifecycle: failed-account retention, evaluation-reset attempts,
//! archive and restore, and the deletion preview.

use rusqlite::Connection;

use super::accounts::{self, AccountInput, StatusChangeInput};
use super::attempts::{self, RulebookDecision, ResetInput};
use super::tests::{account_input, db};
use super::trades::{self, TradeInput};
use crate::csv_import::{self, CsvImportRequest, DateFormatChoice, FormatChoice};
use crate::error::AppError;

const PERFORMANCE: &str = include_str!("../../../../../test_csvimport/Performance.csv");

fn with_ref(name: &str, number: &str) -> AccountInput {
    AccountInput { external_ref: Some(number.into()), ..account_input(name) }
}

fn trade(account_id: &str) -> TradeInput {
    TradeInput {
        account_id: account_id.into(),
        symbol: "esz6".into(),
        side: "long".into(),
        quantity: "1".into(),
        entry_at: "2026-10-19T13:30:00Z".into(),
        entry_price: "5000.25".into(),
        exit_at: Some("2026-10-19T14:00:00Z".into()),
        exit_price: Some("5004.50".into()),
        fees: Some("4.12".into()),
        realized_pnl: None,
        notes: None,
    }
}

fn reset_input(predecessor: &str, name: &str) -> ResetInput {
    ResetInput {
        predecessor_account_id: predecessor.into(),
        prior_outcome: "failed".into(),
        effective_at: "2026-10-20T15:00:00-04:00".into(),
        reason: Some("Hit the trailing drawdown".into()),
        source: "provider_email".into(),
        name: name.into(),
        external_ref: None,
        starting_balance: "50000".into(),
        catalogue: None,
        rulebook: RulebookDecision::DecideLater,
        notes: None,
    }
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn fail(conn: &mut Connection, id: &str) {
    accounts::change_status(
        conn,
        id,
        StatusChangeInput { status: "failed".into(), effective_at: None, cause: None, note: None },
    )
    .unwrap();
}

/// A snapshot row with every NOT NULL column, for tests that need one.
fn snapshot(conn: &Connection, account_id: &str) {
    conn.execute(
        "INSERT INTO account_snapshots (id, account_id, trading_day, is_end_of_day, data_source, calculated_at,
                                        engine_version, inputs_hash, balance_micros, realized_day_pnl_micros,
                                        status, explanation_json)
         VALUES (?1, ?2, '2026-10-19', 1, 'manual', '2026-10-19T21:00:00.000Z', 'test', 'h', 50000000000, 0,
                 'unknown', '{}')",
        rusqlite::params![crate::domain::new_id(), account_id],
    )
    .unwrap();
}

#[test]
fn a_failed_account_keeps_everything_and_is_not_archived() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    trades::create(&mut conn, trade(&a.id)).unwrap();
    let failed = accounts::change_status(
        &mut conn,
        &a.id,
        StatusChangeInput {
            status: "failed".into(),
            effective_at: Some("2026-10-19T20:00:00Z".into()),
            cause: Some("  Daily loss limit  ".into()),
            note: Some("see provider email".into()),
        },
    )
    .unwrap();
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.archived_at, None, "failing never archives");
    assert_eq!(trades::list(&conn, &a.id).unwrap().len(), 1, "trades are kept and readable");
    assert!(accounts::list(&conn).unwrap().iter().any(|x| x.id == a.id), "still listed for history");

    let h = accounts::history(&conn, &a.id).unwrap();
    // History is ordered by effective time, which the user chose, so find the event by status.
    let last = h.status_events.iter().find(|e| e.status == "failed").unwrap();
    assert_eq!(last.effective_at, "2026-10-19T20:00:00.000Z");
    assert_eq!(last.cause.as_deref(), Some("Daily loss limit"));
    assert_eq!(last.note.as_deref(), Some("see provider email"));

    // Same status is refused, so history is not padded.
    let again = accounts::change_status(
        &mut conn,
        &a.id,
        StatusChangeInput { status: "failed".into(), effective_at: None, cause: None, note: None },
    );
    assert!(matches!(again, Err(AppError::Validation { .. })));
}

#[test]
fn a_reset_creates_a_new_linked_account_and_preserves_the_old_one() {
    let mut conn = db();
    let first = accounts::create(&mut conn, with_ref("Attempt 1", "ABC-123")).unwrap();
    let old_trade = trades::create(&mut conn, trade(&first.id)).unwrap();
    snapshot(&conn, &first.id);
    // The user, not the app, decides the outcome: the account is still 'active' here.
    let r = attempts::reset(&mut conn, ResetInput { external_ref: Some("ABC-123".into()), ..reset_input(&first.id, "Attempt 2") })
        .unwrap();

    assert_ne!(r.successor.id, first.id, "a new internal id");
    assert_eq!(r.successor.predecessor_account_id.as_deref(), Some(first.id.as_str()));
    assert_eq!(r.predecessor.successor_account_id.as_deref(), Some(r.successor.id.as_str()));
    assert_eq!((r.predecessor.status.as_str(), r.successor.status.as_str()), ("failed", "active"));
    assert_eq!(r.link.prior_outcome, "failed");
    assert_eq!(r.link.effective_at, "2026-10-20T19:00:00.000Z");
    assert_eq!((r.link.source.as_str(), r.link.rulebook_decision.as_str()), ("provider_email", "deferred"));
    assert_eq!(r.successor.external_ref.as_deref(), Some("ABC-123"), "the provider's number may be reused");
    assert_eq!(r.successor.starting_balance, "50000");
    assert_eq!((r.successor.broker.as_deref(), r.successor.currency.as_str()), (Some("Tradovate"), "USD"));

    // Nothing moved or was created for the new attempt.
    assert_eq!(trades::list(&conn, &first.id).unwrap().len(), 1);
    assert_eq!(trades::list(&conn, &first.id).unwrap()[0].id, old_trade.id);
    assert!(trades::list(&conn, &r.successor.id).unwrap().is_empty());
    for table in ["trades", "journal_entries", "import_batches", "account_snapshots", "account_ledger_entries", "account_rulebook_assignments"] {
        let n = count(&conn, &format!("SELECT COUNT(*) FROM {table} WHERE account_id = '{}'", r.successor.id));
        assert_eq!(n, 0, "{table} starts empty");
    }
    assert_eq!(count(&conn, &format!("SELECT COUNT(*) FROM account_snapshots WHERE account_id = '{}'", first.id)), 1);

    // History of the old attempt shows the confirmed outcome.
    let h = accounts::history(&conn, &first.id).unwrap();
    let last = h.status_events.iter().find(|e| e.status == "failed").unwrap();
    assert_eq!(last.cause.as_deref(), Some("Hit the trailing drawdown"));
}

#[test]
fn the_prior_outcome_is_the_users_not_assumed_failed() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let bad = ResetInput { prior_outcome: "active".into(), ..reset_input(&a.id, "Next") };
    assert!(matches!(attempts::reset(&mut conn, bad), Err(AppError::Validation { .. })));
    assert_eq!(accounts::get(&conn, &a.id).unwrap().status, "active", "unconfirmed reset changes nothing");

    let r = attempts::reset(&mut conn, ResetInput { prior_outcome: "closed".into(), ..reset_input(&a.id, "Next") }).unwrap();
    assert_eq!(r.predecessor.status, "closed");
    assert_eq!(r.link.prior_outcome, "closed");
}

#[test]
fn the_same_broker_number_is_safe_across_attempts_but_not_for_two_live_accounts() {
    let mut conn = db();
    let a = accounts::create(&mut conn, with_ref("A1", "999")).unwrap();
    // Two live accounts may not share a number.
    assert!(matches!(accounts::create(&mut conn, with_ref("Other", "999")), Err(AppError::Conflict { .. })));

    let r1 = attempts::reset(&mut conn, ResetInput { external_ref: Some("999".into()), ..reset_input(&a.id, "A2") }).unwrap();
    let r2 = attempts::reset(&mut conn, ResetInput { external_ref: Some("999".into()), ..reset_input(&r1.successor.id, "A3") }).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM accounts WHERE external_ref = '999'"), 3);

    // A failed attempt cannot silently go back to active beside the live one.
    let back = accounts::change_status(
        &mut conn,
        &a.id,
        StatusChangeInput { status: "active".into(), effective_at: None, cause: None, note: None },
    );
    assert!(matches!(back, Err(AppError::Conflict { .. })), "{back:?}");
    assert_eq!(accounts::get(&conn, &a.id).unwrap().status, "failed");
    assert_eq!(accounts::get(&conn, &r2.successor.id).unwrap().status, "active");
}

#[test]
fn a_reset_that_fails_changes_nothing() {
    let mut conn = db();
    let a = accounts::create(&mut conn, with_ref("A1", "111")).unwrap();
    accounts::create(&mut conn, with_ref("Unrelated live account", "222")).unwrap();
    let before = (
        count(&conn, "SELECT COUNT(*) FROM accounts"),
        count(&conn, "SELECT COUNT(*) FROM account_status_events"),
        count(&conn, "SELECT COUNT(*) FROM account_attempt_links"),
    );

    // The number belongs to another live account: conflict, and the predecessor keeps its status.
    let r = attempts::reset(&mut conn, ResetInput { external_ref: Some("222".into()), ..reset_input(&a.id, "A2") });
    assert!(matches!(r, Err(AppError::Conflict { .. })), "{r:?}");
    // A bad rulebook decision fails after the account insert: still nothing remains.
    let r = attempts::reset(
        &mut conn,
        ResetInput {
            rulebook: RulebookDecision::Assign {
                rulebook_version_id: "missing".into(),
                effective_from: "2026-10-20".into(),
                programme_phase_id: None,
                phase_path_id: None,
            },
            ..reset_input(&a.id, "A2")
        },
    );
    assert!(r.is_err());
    // A bad catalogue selection is rejected by the account triggers.
    let r = attempts::reset(
        &mut conn,
        ResetInput {
            catalogue: Some(attempts::CatalogueSelection { catalogue_version_id: Some("nope".into()), ..Default::default() }),
            ..reset_input(&a.id, "A2")
        },
    );
    assert!(r.is_err());

    let after = (
        count(&conn, "SELECT COUNT(*) FROM accounts"),
        count(&conn, "SELECT COUNT(*) FROM account_status_events"),
        count(&conn, "SELECT COUNT(*) FROM account_attempt_links"),
    );
    assert_eq!(before, after);
    assert_eq!(accounts::get(&conn, &a.id).unwrap().status, "active");
}

#[test]
fn an_attempt_resets_once_and_an_archived_one_must_be_restored_first() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A1")).unwrap();
    attempts::reset(&mut conn, reset_input(&a.id, "A2")).unwrap();
    assert!(matches!(attempts::reset(&mut conn, reset_input(&a.id, "A2 again")), Err(AppError::Conflict { .. })));

    let b = accounts::create(&mut conn, account_input("B1")).unwrap();
    accounts::archive(&mut conn, &b.id).unwrap();
    assert!(matches!(attempts::reset(&mut conn, reset_input(&b.id, "B2")), Err(AppError::Validation { .. })));
    assert!(matches!(attempts::reset(&mut conn, reset_input("nope", "X")), Err(AppError::NotFound { .. })));
}

#[test]
fn lineage_lists_attempts_in_order_from_any_member_with_per_attempt_figures() {
    let mut conn = db();
    let a1 = accounts::create(&mut conn, account_input("A1")).unwrap();
    trades::create(&mut conn, trade(&a1.id)).unwrap();
    let r2 = attempts::reset(&mut conn, reset_input(&a1.id, "A2")).unwrap();
    trades::create(&mut conn, trade(&r2.successor.id)).unwrap();
    // An open trade has no result: it is counted as unknown, not as zero.
    trades::create(&mut conn, TradeInput { exit_at: None, exit_price: None, entry_at: "2026-10-21T13:30:00Z".into(), ..trade(&r2.successor.id) }).unwrap();
    let r3 = attempts::reset(&mut conn, ResetInput { prior_outcome: "passed".into(), ..reset_input(&r2.successor.id, "A3") }).unwrap();

    for from in [&a1.id, &r2.successor.id, &r3.successor.id] {
        let l = attempts::lineage(&conn, from).unwrap();
        assert_eq!(l.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["A1", "A2", "A3"]);
        assert_eq!(l.iter().map(|a| a.attempt_number).collect::<Vec<_>>(), [1, 2, 3]);
    }
    let l = attempts::lineage(&conn, &a1.id).unwrap();
    assert_eq!((l[0].trade_count, l[0].net_pnl.as_deref(), l[0].trades_with_unknown_pnl), (1, Some("208.38"), 0));
    assert_eq!((l[1].trade_count, l[1].net_pnl.as_deref(), l[1].trades_with_unknown_pnl), (2, Some("208.38"), 1));
    assert_eq!((l[2].trade_count, l[2].net_pnl.clone()), (0, None), "no trades is unknown, not 0");
    assert_eq!(l[1].reset_to_next.as_ref().unwrap().prior_outcome, "passed");
    assert_eq!(l[1].status, "passed");
    assert!(l[2].reset_to_next.is_none());
}

#[test]
fn csv_duplicate_detection_is_scoped_to_the_attempt() {
    let mut conn = db();
    let a1 = accounts::create(&mut conn, with_ref("A1", "77")).unwrap();
    let req = |id: &str| CsvImportRequest {
        account_id: id.into(),
        file_name: "Performance.csv".into(),
        content: PERFORMANCE.into(),
        timezone: "America/New_York".into(),
        format: FormatChoice::Auto,
        date_format: DateFormatChoice::Auto,
        columns: None,
    };
    csv_import::commit(&mut conn, &req(&a1.id)).unwrap();
    let imported = count(&conn, &format!("SELECT COUNT(*) FROM trades WHERE account_id = '{}'", a1.id));
    assert!(imported > 0);

    let r = attempts::reset(&mut conn, ResetInput { external_ref: Some("77".into()), ..reset_input(&a1.id, "A2") }).unwrap();
    // The same file into the new attempt is entirely new, not a duplicate of attempt 1.
    let p = csv_import::preview(&conn, &req(&r.successor.id)).unwrap();
    assert_eq!(p.duplicate_count, 0);
    csv_import::commit(&mut conn, &req(&r.successor.id)).unwrap();
    assert_eq!(count(&conn, &format!("SELECT COUNT(*) FROM trades WHERE account_id = '{}'", r.successor.id)), imported);
    assert_eq!(count(&conn, &format!("SELECT COUNT(*) FROM trades WHERE account_id = '{}'", a1.id)), imported);
    // And within attempt 2 it is a duplicate.
    assert_eq!(csv_import::preview(&conn, &req(&r.successor.id)).unwrap().duplicate_count as i64, imported);
}

#[test]
fn archived_accounts_are_browsable_read_only_and_restorable() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    trades::create(&mut conn, trade(&a.id)).unwrap();
    fail(&mut conn, &a.id);
    accounts::archive(&mut conn, &a.id).unwrap();

    assert!(accounts::list(&conn).unwrap().is_empty());
    let all = accounts::list_with(&conn, true).unwrap();
    assert_eq!(all.len(), 1);
    assert!(all[0].archived_at.is_some());
    assert_eq!(accounts::get_any(&conn, &a.id).unwrap().status, "failed");
    assert_eq!(trades::list(&conn, &a.id).unwrap().len(), 1, "read-only browsing");
    assert!(csv_import::list_batches(&conn, &a.id).is_ok());
    // Writes are refused.
    assert!(matches!(trades::create(&mut conn, trade(&a.id)), Err(AppError::NotFound { .. })));
    let status = accounts::change_status(
        &mut conn,
        &a.id,
        StatusChangeInput { status: "closed".into(), effective_at: None, cause: None, note: None },
    );
    assert!(matches!(status, Err(AppError::Validation { .. })));

    let restored = accounts::restore(&mut conn, &a.id).unwrap();
    assert_eq!(restored.archived_at, None);
    assert_eq!(restored.status, "failed", "restoring never reactivates a failed account");
    assert!(matches!(accounts::restore(&mut conn, &a.id), Err(AppError::Validation { .. })));
    let actions: Vec<String> = accounts::history(&conn, &a.id).unwrap().archive_events.into_iter().map(|e| e.action).collect();
    assert_eq!(actions, ["archived", "restored"]);
}

#[test]
fn restore_checks_the_broker_number_for_accounts_that_could_trade() {
    let mut conn = db();
    let a = accounts::create(&mut conn, with_ref("Old", "555")).unwrap();
    accounts::archive(&mut conn, &a.id).unwrap();
    accounts::create(&mut conn, with_ref("New live", "555")).unwrap();
    let r = accounts::restore(&mut conn, &a.id);
    assert!(matches!(r, Err(AppError::Conflict { .. })), "{r:?}");
    assert!(accounts::get_any(&conn, &a.id).unwrap().archived_at.is_some(), "still archived");

    // The same number on a failed archived account restores fine: it cannot trade.
    let b = accounts::create(&mut conn, with_ref("Old failed", "556")).unwrap();
    fail(&mut conn, &b.id);
    accounts::archive(&mut conn, &b.id).unwrap();
    accounts::create(&mut conn, with_ref("Live 556", "556")).unwrap();
    assert_eq!(accounts::restore(&mut conn, &b.id).unwrap().status, "failed");
}

#[test]
fn only_active_accounts_qualify_for_risk_views() {
    let mut conn = db();
    let live = accounts::create(&mut conn, account_input("Live")).unwrap();
    let failed = accounts::create(&mut conn, account_input("Failed")).unwrap();
    let archived = accounts::create(&mut conn, account_input("Archived")).unwrap();
    fail(&mut conn, &failed.id);
    accounts::archive(&mut conn, &archived.id).unwrap();
    let r = attempts::reset(&mut conn, reset_input(&live.id, "Live 2")).unwrap();

    let ids: Vec<String> = accounts::list_active(&conn).unwrap().into_iter().map(|a| a.id).collect();
    assert_eq!(ids, [r.successor.id], "the reset predecessor, failed and archived accounts are excluded");
}

#[test]
fn links_are_append_only_and_linked_accounts_cannot_be_hard_deleted() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A1")).unwrap();
    let r = attempts::reset(&mut conn, reset_input(&a.id, "A2")).unwrap();

    for sql in [
        "DELETE FROM account_attempt_links".to_string(),
        "UPDATE account_attempt_links SET reason = 'edited'".to_string(),
        format!("DELETE FROM accounts WHERE id = '{}'", a.id),
        format!("DELETE FROM accounts WHERE id = '{}'", r.successor.id),
    ] {
        assert!(conn.execute(&sql, []).is_err(), "{sql} must be refused");
    }
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM accounts"), 2);
    // A chain cannot loop or point at itself.
    let same = conn.execute(
        "INSERT INTO account_attempt_links (id, predecessor_account_id, successor_account_id, prior_outcome, effective_at, source, rulebook_decision, created_at)
         VALUES ('x', ?1, ?1, 'failed', '2026-10-20T00:00:00.000Z', 'other', 'deferred', '2026-10-20T00:00:00.000Z')",
        [&a.id],
    );
    assert!(same.is_err());
}

#[test]
fn the_deletion_preview_lists_contents_and_never_offers_chain_deletion() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A1")).unwrap();
    trades::create(&mut conn, trade(&a.id)).unwrap();
    let t2 = trades::create(&mut conn, TradeInput { entry_at: "2026-10-20T13:30:00Z".into(), exit_at: Some("2026-10-20T14:00:00Z".into()), ..trade(&a.id) }).unwrap();
    trades::delete(&mut conn, &t2.id).unwrap();
    let solo = attempts::deletion_preview(&conn, &a.id).unwrap();
    assert_eq!((solo.trades, solo.deleted_trades, solo.status_events), (1, 1, 1));
    assert!(solo.linked_attempts.is_empty());
    assert!(solo.blockers.iter().any(|b| b.contains("Build 24")), "no delete command exists yet");

    let r = attempts::reset(&mut conn, reset_input(&a.id, "A2")).unwrap();
    let linked = attempts::deletion_preview(&conn, &a.id).unwrap();
    assert_eq!(linked.linked_attempts, std::slice::from_ref(&r.successor.id));
    assert!(linked.blockers.iter().any(|b| b.contains("reset chain")));
    assert!(matches!(attempts::deletion_preview(&conn, "nope"), Err(AppError::NotFound { .. })));
}

#[test]
fn lineage_survives_a_backup_copy() {
    let mut conn = db();
    let a = accounts::create(&mut conn, with_ref("A1", "42")).unwrap();
    trades::create(&mut conn, trade(&a.id)).unwrap();
    let r = attempts::reset(&mut conn, ResetInput { external_ref: Some("42".into()), ..reset_input(&a.id, "A2") }).unwrap();

    let copy = std::env::temp_dir().join(format!("fundedflow-lineage-{}.db", crate::domain::new_id()));
    conn.execute("VACUUM INTO ?1", [copy.to_string_lossy()]).unwrap();
    let restored = Connection::open(&copy).unwrap();
    let l = attempts::lineage(&restored, &r.successor.id).unwrap();
    assert_eq!(l.iter().map(|x| x.account_id.as_str()).collect::<Vec<_>>(), [a.id.as_str(), r.successor.id.as_str()]);
    assert_eq!(l[0].trade_count, 1);
    assert_eq!(l[0].reset_to_next.as_ref().unwrap().reason.as_deref(), Some("Hit the trailing drawdown"));
    assert!(accounts::history(&restored, &a.id).unwrap().status_events.iter().any(|e| e.status == "failed"));
    drop(restored);
    let _ = std::fs::remove_file(copy);
}
