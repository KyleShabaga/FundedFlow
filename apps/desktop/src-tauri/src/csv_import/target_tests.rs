//! Synthetic acceptance for exact attempt assessment. Always call the real
//! commit entry point here, with the acknowledgement actually retained at preview.
use super::*;
use crate::csv_import::{commit as native_commit, target::Acknowledgement};
use crate::store::attempts::{self, ResetInput};
use serde_json::json;

fn csv(entry: &str, exit: &str, id: &str) -> String {
    format!(
        "Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price,Trade ID\nMNQZ6,Buy,1,{entry},21000,{exit},21001,{id}\n"
    )
}

fn reset(conn: &mut Connection, id: &str, at: &str) -> String {
    attempts::reset(
        conn,
        serde_json::from_value::<ResetInput>(json!({
            "predecessorAccountId": id, "priorOutcome": "failed", "effectiveAt": at,
            "reason": null, "source": "user_entered", "name": "Next attempt",
            "externalRef": "reused-77", "startingBalance": "50000", "catalogue": null,
            "rulebook": {"kind": "decideLater"}, "notes": null,
        }))
        .unwrap(),
    )
    .unwrap()
    .successor
    .id
}

fn reviewed(conn: &Connection, req: &CsvImportRequest, confirmed: bool) -> CsvImportRequest {
    let mut req = req.clone();
    req.target_acknowledgement = Some(Acknowledgement {
        preview_token: preview(conn, &req).unwrap().target_assessment.preview_token,
        historical_confirmed: confirmed,
    });
    req
}

#[test]
fn exact_same_day_intervals_check_both_trade_events_and_never_retarget() {
    let (mut conn, first) = setup();
    let middle = reset(&mut conn, &first, "2026-10-20T13:00:00Z");
    let last = reset(&mut conn, &middle, "2026-10-20T19:00:00Z");
    for (i, (entry, exit, allowed)) in [
        ("2026-10-20T12:59:59.999Z", "2026-10-20T13:01:00Z", false),
        ("2026-10-20T13:00:00Z", "2026-10-20T13:01:00Z", true),
        ("2026-10-20T18:59:00Z", "2026-10-20T18:59:59.999Z", true),
        ("2026-10-20T18:59:00Z", "2026-10-20T19:00:00Z", false),
        ("2026-10-20T19:00:00Z", "2026-10-20T19:01:00Z", false),
    ]
    .into_iter()
    .enumerate()
    {
        let req = request(&middle, &csv(entry, exit, &format!("case-{i}")));
        let p = preview(&conn, &req).unwrap();
        assert_eq!(p.new_count, 1, "{p:?}");
        assert_eq!(
            p.target_assessment.blocked.is_none(),
            allowed,
            "{entry} / {exit}"
        );
        assert_eq!(
            p.target_assessment.start_inclusive.as_deref(),
            Some("2026-10-20T13:00:00.000Z")
        );
        assert_eq!(
            p.target_assessment.end_exclusive.as_deref(),
            Some("2026-10-20T19:00:00.000Z")
        );
        let ack = reviewed(&conn, &req, true);
        assert_eq!(native_commit(&mut conn, &ack).is_ok(), allowed);
    }
    assert_eq!(trade_store::list(&conn, &middle).unwrap().len(), 2);
    assert!(trade_store::list(&conn, &first).unwrap().is_empty());
    assert!(trade_store::list(&conn, &last).unwrap().is_empty());
}

#[test]
fn terminal_history_requires_confirmation_and_reused_ids_remain_account_scoped() {
    let (mut conn, first) = setup();
    let next = reset(&mut conn, &first, "2026-10-20T19:00:00Z");
    let old = request(
        &first,
        &csv("2026-10-20T13:00:00Z", "2026-10-20T13:01:00Z", "reused-id"),
    );
    let no_confirmation = reviewed(&conn, &old, false);
    assert!(native_commit(&mut conn, &no_confirmation).is_err());
    let confirmed = reviewed(&conn, &old, true);
    native_commit(&mut conn, &confirmed).unwrap();
    let old_trades = trade_store::list(&conn, &first).unwrap();
    let old_batches = list_batches(&conn, &first).unwrap();
    let fresh = request(
        &next,
        &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "reused-id"),
    );
    let p = preview(&conn, &fresh).unwrap();
    assert_eq!(p.new_count, 1);
    assert_eq!(p.duplicate_count, 0);
    let ack = reviewed(&conn, &fresh, false);
    native_commit(&mut conn, &ack).unwrap();
    assert_eq!(trade_store::list(&conn, &first).unwrap(), old_trades);
    assert_eq!(list_batches(&conn, &first).unwrap(), old_batches);
    assert_ne!(
        trade_store::list(&conn, &next).unwrap()[0].id,
        old_trades[0].id
    );
}

#[test]
fn missing_tampered_or_stale_preview_is_rejected_for_every_input_and_lineage_change() {
    let (mut conn, account) = setup();
    let req = request(
        &account,
        &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "id"),
    );
    assert!(native_commit(&mut conn, &req).is_err());
    let ack = reviewed(&conn, &req, false);
    let mut changed = ack.clone();
    changed
        .target_acknowledgement
        .as_mut()
        .unwrap()
        .preview_token = "tampered".into();
    assert!(native_commit(&mut conn, &changed).is_err());
    let other = accounts::create(&mut conn, account_input("Other")).unwrap();
    for change in 0..7 {
        let mut changed = ack.clone();
        match change {
            0 => changed.file_name = "renamed.csv".into(),
            1 => changed.content.push('\n'),
            2 => changed.timezone = "UTC".into(),
            3 => changed.date_format = DateFormatChoice::Ymd,
            4 => changed.format = FormatChoice::Generic,
            5 => changed.account_id = other.id.clone(),
            _ => changed.columns = Some(serde_json::from_value(json!({"symbol":"Symbol", "side":"Side", "quantity":"Qty", "entryTime":"Entry Time", "entryPrice":"Entry Price"})).unwrap()),
        }
        assert!(
            native_commit(&mut conn, &changed).is_err(),
            "changed choice {change}"
        );
    }
    // The row still fits the predecessor, but the new lineage revision needs review.
    reset(&mut conn, &account, "2026-10-21T19:00:00Z");
    assert!(native_commit(&mut conn, &ack).is_err());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM trades"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_rows"), 0);
}

#[test]
fn session_settings_status_and_archive_changes_invalidate_review() {
    for sql in [
        "UPDATE accounts SET timezone = 'Asia/Tokyo' WHERE id = ?1",
        "UPDATE accounts SET trading_day_reset_time = '18:00' WHERE id = ?1",
        "UPDATE accounts SET status = 'closed' WHERE id = ?1",
        "UPDATE accounts SET archived_at = '2026-10-21T00:00:00Z' WHERE id = ?1",
    ] {
        let (mut conn, account) = setup();
        let req = request(
            &account,
            &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "id"),
        );
        let ack = reviewed(&conn, &req, true);
        conn.execute(sql, [&account]).unwrap();
        assert!(native_commit(&mut conn, &ack).is_err(), "{sql}");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM trades"), 0);
    }
}

#[test]
fn changed_dedup_or_restore_state_requires_a_fresh_preview() {
    let (mut conn, account) = setup();
    let req = request(
        &account,
        &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "id"),
    );
    let ack = reviewed(&conn, &req, false);
    native_commit(&mut conn, &ack).unwrap();
    // The original acknowledgement described a new trade, not a duplicate.
    assert!(native_commit(&mut conn, &ack).is_err());
    let duplicate = reviewed(&conn, &req, false);
    let trade = trade_store::list(&conn, &account).unwrap().remove(0);
    trade_store::delete(&mut conn, &trade.id).unwrap();
    assert!(native_commit(&mut conn, &duplicate).is_err());
    let restore = reviewed(&conn, &req, false);
    native_commit(&mut conn, &restore).unwrap();
    assert_eq!(trade_store::list(&conn, &account).unwrap()[0].id, trade.id);
}

#[test]
fn all_candidates_are_assessed_including_unlisted_rows_and_saved_restore_instants() {
    let (mut conn, account) = setup();
    let mut content =
        String::from("Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price,Trade ID\n");
    for i in 0..2001 {
        content.push_str(&format!(
            "MNQZ6,Buy,1,2026-10-20T13:00:00Z,21000,2026-10-20T13:01:00Z,21001,id-{i}\n"
        ));
    }
    content.push_str("MNQZ6,Buy,1,2026-10-20T20:00:00Z,21000,2026-10-20T20:01:00Z,21001,late\n");
    reset(&mut conn, &account, "2026-10-20T19:00:00Z");
    let p = preview(&conn, &request(&account, &content)).unwrap();
    assert_eq!(p.rows_omitted, 2);
    assert_eq!(p.target_assessment.candidate_count, 2002);
    assert!(p.target_assessment.blocked.is_some());

    // A changed CSV timestamp cannot conceal a restore's actual saved timestamp.
    let (mut conn, account) = setup();
    let original = request(
        &account,
        &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "restore"),
    );
    let ack = reviewed(&conn, &original, false);
    native_commit(&mut conn, &ack).unwrap();
    let trade = trade_store::list(&conn, &account).unwrap().remove(0);
    trade_store::delete(&mut conn, &trade.id).unwrap();
    reset(&mut conn, &account, "2026-10-20T19:00:00Z");
    let changed = request(
        &account,
        &csv("2026-10-20T13:00:00Z", "2026-10-20T13:01:00Z", "restore"),
    );
    let p = preview(&conn, &changed).unwrap();
    assert_eq!(p.restore_count, 1);
    assert!(p.target_assessment.blocked.is_some());
    let ack = reviewed(&conn, &changed, true);
    assert!(native_commit(&mut conn, &ack).is_err());
    assert!(trade_store::list(&conn, &account).unwrap().is_empty());
}

#[test]
fn dst_offsets_resolve_exact_instants_but_gap_and_overlap_without_offsets_are_invalid() {
    let (mut conn, account) = setup();
    let next = reset(&mut conn, &account, "2026-11-01T06:00:00Z");
    for (at, allowed) in [
        ("2026-11-01T01:30:00-04:00", false),
        ("2026-11-01T01:30:00-05:00", true),
    ] {
        let p = preview(&conn, &request(&next, &csv(at, at, at))).unwrap();
        assert_eq!(p.target_assessment.blocked.is_none(), allowed);
    }
    for at in ["2026-11-01 01:30:00", "2026-03-08 02:30:00"] {
        let p = preview(&conn, &request(&next, &csv(at, at, at))).unwrap();
        assert_eq!(p.invalid_count, 1);
        assert_eq!(p.target_assessment.candidate_count, 0);
    }
    // UTC date differs from the source/account local day. Compare instants anyway.
    let (mut conn, first) = setup();
    let next = reset(&mut conn, &first, "2026-10-21T00:00:00Z");
    let p = preview(
        &conn,
        &request(
            &next,
            &csv(
                "2026-10-20T20:01:00-04:00",
                "2026-10-20T20:02:00-04:00",
                "local",
            ),
        ),
    )
    .unwrap();
    assert_eq!(
        p.rows[0].trade.as_ref().unwrap().entry_at,
        "2026-10-21T00:01:00.000Z"
    );
    assert!(p.target_assessment.blocked.is_none());

    let (mut conn, first) = setup();
    conn.execute("UPDATE accounts SET timezone = 'Asia/Tokyo', trading_day_reset_time = '00:00' WHERE id = ?1", [&first]).unwrap();
    let next = reset(&mut conn, &first, "2026-10-20T19:00:00Z");
    let p = preview(
        &conn,
        &request(
            &next,
            &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "Tokyo"),
        ),
    )
    .unwrap();
    assert_eq!(p.rows[0].trade.as_ref().unwrap().trading_day, "2026-10-21");
    assert!(p.target_assessment.blocked.is_none());
}

#[test]
fn incomplete_or_nonmonotonic_boundaries_block_without_inventing_dates() {
    for at in ["2026-10-20", "2026-10-20T13:00:00"] {
        let (mut conn, first) = setup();
        let next = accounts::create(&mut conn, account_input("Legacy next")).unwrap();
        conn.execute("INSERT INTO account_attempt_links (id, predecessor_account_id, successor_account_id, prior_outcome, effective_at, source, rulebook_decision, created_at) VALUES ('legacy', ?1, ?2, 'closed', ?3, 'other', 'deferred', '2026-10-21T00:00:00Z')", params![first, next.id, at]).unwrap();
        let p = preview(
            &conn,
            &request(
                &next.id,
                &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "id"),
            ),
        )
        .unwrap();
        assert!(p.target_assessment.blocked.is_some());
        assert!(p.target_assessment.start_inclusive.is_none());
    }
    let (mut conn, first) = setup();
    let next = reset(&mut conn, &first, "2026-10-20T19:00:00Z");
    reset(&mut conn, &next, "2026-10-20T13:00:00Z");
    let p = preview(
        &conn,
        &request(
            &next,
            &csv("2026-10-20T14:00:00Z", "2026-10-20T14:01:00Z", "id"),
        ),
    )
    .unwrap();
    assert!(
        p.target_assessment
            .blocked
            .as_ref()
            .unwrap()
            .contains("inconsistent")
    );
}

#[test]
fn failed_transaction_rolls_back_every_row_and_review_can_be_retried() {
    let (mut conn, account) = setup();
    let req = request(
        &account,
        &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "id"),
    );
    let ack = reviewed(&conn, &req, false);
    conn.execute_batch("CREATE TRIGGER fail_trade BEFORE INSERT ON trades BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
    assert!(native_commit(&mut conn, &ack).is_err());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM trades"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_rows"), 0);
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM import_batches WHERE status = 'committed'"
        ),
        0
    );
    conn.execute_batch("DROP TRIGGER fail_trade;").unwrap();
    assert_eq!(native_commit(&mut conn, &ack).unwrap().imported_count, 1);
}

#[test]
fn failure_logging_cannot_write_into_an_account_archived_after_analysis() {
    let (mut conn, account) = setup();
    let req = request(
        &account,
        &csv("2026-10-20T20:00:00Z", "2026-10-20T20:01:00Z", "id"),
    );
    let analysis = analyze(&conn, &req).unwrap();
    accounts::archive(&mut conn, &account).unwrap();
    // Model an archive after preflight but before the separate failure log. The
    // conditional INSERT checks writability atomically, with no check/write gap.
    record_failed(&conn, &req, &analysis, &now(), "synthetic failure").unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_batches"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_rows"), 0);
}
