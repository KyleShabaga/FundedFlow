//! Build 22: daily reviews: identity, lifecycle, revisions, rollback, checklist
//! snapshots and adherence, trade links after source changes, session windows,
//! account isolation and the migration of an existing journal.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use rusqlite::Connection;

use super::accounts::{self, AccountInput};
use super::attempts::RulebookDecision;
use super::attempts::{self, ResetInput};
use super::daily_reviews::{
    self, DailyReviewInput, DailyReviewRef, PlanInput, ReflectionInput, adherence, session_window,
};
use super::journal::{self, JournalEntryInput};
use super::library::{self, ArchiveInput, ChecklistInput, ChecklistItemInput};
use super::reviews::{ChecklistAnswer, ChecklistAnswerInput};
use super::tests::{account_input, db, trade_input};
use super::trades::{self, TradeChangeOptions, TradeInput};
use crate::error::AppError;

/// Tuesday 2026-10-20, 11:00 in New York: the current trading day is the 20th.
fn at(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}
fn now() -> DateTime<Utc> {
    at("2026-10-20T15:00:00Z")
}

fn kind(err: AppError) -> &'static str {
    match err {
        AppError::Validation { .. } => "validation",
        AppError::NotFound { .. } => "notFound",
        AppError::Conflict { .. } => "conflict",
        AppError::Database { .. } => "database",
        AppError::Unavailable { .. } => "unavailable",
    }
}
fn fields(err: AppError) -> Vec<String> {
    match err {
        AppError::Validation { issues, .. } => issues.into_iter().map(|i| i.field).collect(),
        other => panic!("expected validation, got {other:?}"),
    }
}

fn account(conn: &mut Connection, name: &str) -> String {
    accounts::create(conn, account_input(name)).unwrap().id
}

fn input(account_id: &str, day: &str) -> DailyReviewInput {
    DailyReviewInput {
        account_id: account_id.into(),
        trading_day: day.into(),
        expected_revision: None,
        plan: PlanInput::default(),
        reflection: ReflectionInput::default(),
        no_trade_day: false,
        checklist_id: None,
        answers: vec![],
        action: "save".into(),
    }
}

fn with_lesson(
    account_id: &str,
    day: &str,
    lesson: &str,
    revision: Option<i64>,
) -> DailyReviewInput {
    DailyReviewInput {
        expected_revision: revision,
        reflection: ReflectionInput {
            key_lesson: Some(lesson.into()),
            ..Default::default()
        },
        ..input(account_id, day)
    }
}

fn daily_checklist(conn: &mut Connection, items: &[&str]) -> (String, Vec<String>) {
    let c = library::save_checklist(
        conn,
        None,
        ChecklistInput {
            name: "Session rules".into(),
            description: None,
            scope: "daily".into(),
            strategy_id: None,
            items: items
                .iter()
                .map(|l| ChecklistItemInput {
                    id: None,
                    label: (*l).into(),
                })
                .collect(),
        },
    )
    .unwrap();
    let ids = c.items.iter().map(|i| i.id.clone()).collect();
    (c.id, ids)
}

fn answer(item: &str, result: &str) -> ChecklistAnswerInput {
    ChecklistAnswerInput {
        item_id: item.into(),
        result: result.into(),
        note: None,
    }
}

fn trade_on(account_id: &str, entry: &str, exit: &str) -> TradeInput {
    TradeInput {
        entry_at: entry.into(),
        exit_at: Some(exit.into()),
        ..trade_input(account_id)
    }
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/* ---------- Lifecycle ---------- */

#[test]
fn a_review_is_drafted_resumed_completed_reopened_and_edited() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    let day = daily_reviews::get_day_at(&conn, &a, "2026-10-20", now()).unwrap();
    assert!(day.review.is_none(), "nothing exists until it is saved");
    assert_eq!(day.current_trading_day, "2026-10-20");
    assert_eq!(day.day_state, "no_trades_recorded");

    let saved = daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            plan: PlanInput {
                focus: Some("Only A+ setups".into()),
                max_risk: Some("250".into()),
                ..Default::default()
            },
            ..input(&a, "2026-10-20")
        },
        now(),
    )
    .unwrap();
    let r = saved.review.unwrap();
    assert_eq!((r.status.as_str(), r.revision), ("draft", 1));
    assert_eq!(r.plan.max_risk.as_deref(), Some("250"));
    assert_eq!(
        r.events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
        ["created"]
    );

    // Resume: the same record, read back after "restart" (a fresh read of the same connection).
    let resumed = daily_reviews::get_day_at(&conn, &a, "2026-10-20", now())
        .unwrap()
        .review
        .unwrap();
    assert_eq!(resumed.plan.focus.as_deref(), Some("Only A+ setups"));

    let done = daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            action: "complete".into(),
            ..with_lesson(&a, "2026-10-20", "Wait for the retest", Some(1))
        },
        now(),
    )
    .unwrap()
    .review
    .unwrap();
    assert_eq!((done.status.as_str(), done.revision), ("completed", 2));
    assert!(done.completed_at.is_some() && done.first_completed_at == done.completed_at);
    assert_eq!(
        done.plan.focus, None,
        "a save replaces the whole review: fields left empty are cleared"
    );

    let reopened = daily_reviews::reopen_at(
        &mut conn,
        DailyReviewRef {
            account_id: a.clone(),
            trading_day: "2026-10-20".into(),
            expected_revision: 2,
        },
        now(),
    )
    .unwrap()
    .review
    .unwrap();
    assert_eq!((reopened.status.as_str(), reopened.revision), ("draft", 3));
    assert_eq!(reopened.completed_at, None);
    assert_eq!(
        reopened.first_completed_at, done.first_completed_at,
        "the first completion is kept"
    );
    assert_eq!(
        reopened.reflection.key_lesson.as_deref(),
        Some("Wait for the retest"),
        "reopening erases nothing"
    );

    let again = daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            action: "complete".into(),
            ..with_lesson(&a, "2026-10-20", "Wait for the retest", Some(3))
        },
        now(),
    )
    .unwrap()
    .review
    .unwrap();
    let edited = daily_reviews::save_at(
        &mut conn,
        with_lesson(
            &a,
            "2026-10-20",
            "Size down after a loss",
            Some(again.revision),
        ),
        now(),
    )
    .unwrap()
    .review
    .unwrap();
    assert_eq!(
        edited.status, "completed",
        "editing a completed review keeps it completed"
    );
    assert!(edited.edited_after_completion_at.is_some());
    assert_eq!(
        edited
            .events
            .iter()
            .map(|e| e.kind.as_str())
            .collect::<Vec<_>>(),
        ["created", "completed", "reopened", "completed", "edited"]
    );
    assert_eq!(
        kind(
            daily_reviews::reopen_at(
                &mut conn,
                DailyReviewRef {
                    account_id: a.clone(),
                    trading_day: "2026-10-20".into(),
                    expected_revision: 4
                },
                now()
            )
            .map(|_| ())
            .unwrap_err()
        ),
        "conflict",
        "a stale revision"
    );
}

#[test]
fn stale_and_duplicate_saves_are_conflicts_never_forks() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    daily_reviews::save_at(
        &mut conn,
        with_lesson(&a, "2026-10-19", "first", None),
        now(),
    )
    .unwrap();
    // A second window that also started from "no review".
    let dup = daily_reviews::save_at(
        &mut conn,
        with_lesson(&a, "2026-10-19", "second", None),
        now(),
    )
    .unwrap_err();
    assert_eq!(kind(dup), "conflict");
    // A form opened at revision 1 after another save moved it to 2.
    daily_reviews::save_at(
        &mut conn,
        with_lesson(&a, "2026-10-19", "edit", Some(1)),
        now(),
    )
    .unwrap();
    assert_eq!(
        kind(
            daily_reviews::save_at(
                &mut conn,
                with_lesson(&a, "2026-10-19", "stale", Some(1)),
                now()
            )
            .unwrap_err()
        ),
        "conflict"
    );
    assert_eq!(count(&conn, "SELECT count(*) FROM daily_reviews"), 1);
    let kept = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now())
        .unwrap()
        .review
        .unwrap();
    assert_eq!(kept.reflection.key_lesson.as_deref(), Some("edit"));
    // The schema refuses a second row for the same account and day too.
    let err = conn.execute(
        "INSERT INTO daily_reviews (id, account_id, trading_day, timezone_snapshot, reset_time_snapshot, created_at, updated_at)
         VALUES ('x', ?1, '2026-10-19', 'UTC', '00:00', 't', 't')",
        [&a],
    );
    assert!(err.is_err());
}

#[test]
fn a_failed_write_leaves_the_previous_version_intact() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    let (checklist, items) =
        daily_checklist(&mut conn, &["No revenge trades", "Stop after two losses"]);
    let first = DailyReviewInput {
        checklist_id: Some(checklist.clone()),
        answers: vec![answer(&items[0], "followed")],
        ..with_lesson(&a, "2026-10-19", "kept", None)
    };
    daily_reviews::save_at(&mut conn, first, now()).unwrap();
    // The second answer names an item that doesn't exist: the whole save is rolled back.
    let bad = DailyReviewInput {
        checklist_id: Some(checklist.clone()),
        answers: vec![answer(&items[0], "missed"), answer("nope", "followed")],
        ..with_lesson(&a, "2026-10-19", "lost", Some(1))
    };
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, bad, now()).unwrap_err()),
        ["answers.1.itemId"]
    );
    let r = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now())
        .unwrap()
        .review
        .unwrap();
    assert_eq!(r.revision, 1);
    assert_eq!(r.reflection.key_lesson.as_deref(), Some("kept"));
    assert_eq!(r.answers[0].result, "followed");
    assert_eq!(r.events.len(), 1);
}

#[test]
fn input_is_validated_before_anything_is_written() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    let bad = DailyReviewInput {
        trading_day: "2026-10-18".into(), // a Sunday
        plan: PlanInput {
            max_risk: Some("0".into()),
            focus: Some("x".repeat(20_001)),
            ..Default::default()
        },
        answers: vec![answer("i", "maybe")],
        action: "finish".into(),
        ..input(&a, "2026-10-18")
    };
    let mut found = fields(daily_reviews::save_at(&mut conn, bad, now()).unwrap_err());
    found.sort();
    assert_eq!(
        found,
        [
            "action",
            "answers.0.result",
            "checklistId",
            "plan.focus",
            "plan.maxRisk",
            "tradingDay"
        ]
    );
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, input(&a, "2026-02-30"), now()).unwrap_err()),
        ["tradingDay"]
    );
    // Completing needs something to complete.
    let empty = DailyReviewInput {
        action: "complete".into(),
        ..input(&a, "2026-10-19")
    };
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, empty, now()).unwrap_err()),
        ["action"]
    );
    assert_eq!(count(&conn, "SELECT count(*) FROM daily_reviews"), 0);
    // A trade checklist is not a daily checklist.
    let trade_list = library::save_checklist(
        &mut conn,
        None,
        ChecklistInput {
            name: "Entry".into(),
            description: None,
            scope: "trade".into(),
            strategy_id: None,
            items: vec![ChecklistItemInput {
                id: None,
                label: "Setup present".into(),
            }],
        },
    )
    .unwrap();
    let wrong = DailyReviewInput {
        checklist_id: Some(trade_list.id),
        ..input(&a, "2026-10-19")
    };
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, wrong, now()).unwrap_err()),
        ["checklistId"]
    );
}

/* ---------- Future days and plan timing ---------- */

#[test]
fn future_days_take_a_plan_only_and_plans_record_when_they_were_written() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    let plan = |day: &str| DailyReviewInput {
        plan: PlanInput {
            focus: Some("ORB only".into()),
            ..Default::default()
        },
        ..input(&a, day)
    };
    let tomorrow = daily_reviews::save_at(&mut conn, plan("2026-10-21"), now()).unwrap();
    assert!(tomorrow.is_future);
    assert_eq!(
        tomorrow.review.unwrap().plan.timing.as_deref(),
        Some("pre_session")
    );
    let reflect = DailyReviewInput {
        expected_revision: Some(1),
        ..with_lesson(&a, "2026-10-21", "too early", Some(1))
    };
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, reflect, now()).unwrap_err()),
        ["tradingDay"]
    );
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, plan("2026-11-06"), now()).unwrap_err()),
        ["tradingDay"],
        "more than 14 days ahead"
    );

    // Written on Tuesday for Monday (which ended Monday 17:00 New York): retrospective.
    let late = daily_reviews::save_at(&mut conn, plan("2026-10-19"), now())
        .unwrap()
        .review
        .unwrap();
    assert_eq!(late.plan.timing.as_deref(), Some("retrospective"));
    // Written during today's session but after today's first trade opened: retrospective too.
    trades::create(
        &mut conn,
        trade_on(&a, "2026-10-20T14:00:00Z", "2026-10-20T14:30:00Z"),
    )
    .unwrap();
    let after_trade = daily_reviews::save_at(&mut conn, plan("2026-10-20"), now())
        .unwrap()
        .review
        .unwrap();
    assert_eq!(after_trade.plan.timing.as_deref(), Some("retrospective"));
    // The authored time stays with the plan through later saves; clearing the plan clears it.
    let kept = daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            expected_revision: Some(1),
            ..plan("2026-10-21")
        },
        at("2026-10-21T15:00:00Z"),
    )
    .unwrap()
    .review
    .unwrap();
    assert_eq!(kept.plan.timing.as_deref(), Some("pre_session"));
    assert_eq!(
        kept.plan.authored_at.as_deref(),
        Some("2026-10-20T15:00:00.000Z")
    );
    let cleared = daily_reviews::save_at(
        &mut conn,
        with_lesson(&a, "2026-10-21", "x", Some(2)),
        at("2026-10-21T15:00:00Z"),
    )
    .unwrap()
    .review
    .unwrap();
    assert_eq!(
        (cleared.plan.authored_at, cleared.plan.timing),
        (None, None)
    );
}

/* ---------- Isolation ---------- */

#[test]
fn accounts_and_reset_attempts_never_share_a_review() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let b = account(&mut conn, "B");
    daily_reviews::save_at(
        &mut conn,
        with_lesson(&a, "2026-10-19", "A's lesson", None),
        now(),
    )
    .unwrap();
    let other = daily_reviews::get_day_at(&conn, &b, "2026-10-19", now()).unwrap();
    assert!(
        other.review.is_none(),
        "same date, other account: no review"
    );
    daily_reviews::save_at(
        &mut conn,
        with_lesson(&b, "2026-10-19", "B's lesson", None),
        now(),
    )
    .unwrap();
    assert_eq!(
        daily_reviews::list_at(&conn, &a, now())
            .unwrap()
            .reviews
            .len(),
        1
    );
    assert_eq!(
        daily_reviews::get_day_at(&conn, &a, "2026-10-19", now())
            .unwrap()
            .review
            .unwrap()
            .reflection
            .key_lesson
            .as_deref(),
        Some("A's lesson")
    );

    // A reset successor, even with the same provider account number, starts with no reviews.
    let reset = attempts::reset(
        &mut conn,
        ResetInput {
            predecessor_account_id: a.clone(),
            prior_outcome: "failed".into(),
            effective_at: "2026-10-20T15:00:00-04:00".into(),
            reason: None,
            source: "user_entered".into(),
            name: "A, attempt 2".into(),
            external_ref: None,
            starting_balance: "50000".into(),
            catalogue: None,
            rulebook: RulebookDecision::DecideLater,
            notes: None,
        },
    )
    .unwrap();
    let successor = reset.successor.id;
    assert!(
        daily_reviews::list_at(&conn, &successor, now())
            .unwrap()
            .reviews
            .is_empty()
    );
    assert!(
        daily_reviews::get_day_at(&conn, &successor, "2026-10-19", now())
            .unwrap()
            .review
            .is_none()
    );
    // The failed predecessor stays readable and, not being archived, editable as history.
    assert_eq!(
        daily_reviews::list_at(&conn, &a, now())
            .unwrap()
            .reviews
            .len(),
        1
    );

    // A trade of another account can never be linked, even directly in SQL.
    let tb = trades::create(&mut conn, trade_input(&b)).unwrap();
    let ra: String = conn
        .query_row(
            "SELECT id FROM daily_reviews WHERE account_id = ?1",
            [&a],
            |r| r.get(0),
        )
        .unwrap();
    let cross = conn.execute(
        "INSERT INTO daily_review_trades VALUES (?1, ?2, '2026-10-19', NULL, 'open', 't', 't')",
        [&ra, &tb.id],
    );
    assert!(cross.is_err());
    // A review moves neither account nor day.
    assert!(
        conn.execute(
            "UPDATE daily_reviews SET account_id = ?1 WHERE id = ?2",
            [&b, &ra]
        )
        .is_err()
    );
    assert!(
        conn.execute(
            "UPDATE daily_reviews SET trading_day = '2026-10-16' WHERE id = ?1",
            [&ra]
        )
        .is_err()
    );
}

#[test]
fn archived_accounts_are_read_only() {
    let mut conn = db();
    let a = account(&mut conn, "Old");
    daily_reviews::save_at(
        &mut conn,
        with_lesson(&a, "2026-10-19", "kept", None),
        now(),
    )
    .unwrap();
    accounts::archive(&mut conn, &a).unwrap();
    let day = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now()).unwrap();
    assert!(day.archived && day.review.is_some());
    assert_eq!(
        kind(
            daily_reviews::save_at(
                &mut conn,
                with_lesson(&a, "2026-10-19", "x", Some(1)),
                now()
            )
            .unwrap_err()
        ),
        "conflict"
    );
    assert_eq!(
        kind(daily_reviews::get_day_at(&conn, "missing", "2026-10-19", now()).unwrap_err()),
        "notFound"
    );
}

/* ---------- Trading days and session windows ---------- */

#[test]
fn reviews_use_rusts_trading_day_including_the_weekend_and_dst() {
    let mut conn = db();
    let a = account(&mut conn, "NY 17:00");
    // Friday 17:30 New York is after the reset: Monday's trading day.
    let t = trades::create(
        &mut conn,
        trade_on(&a, "2026-10-16T21:30:00Z", "2026-10-16T21:45:00Z"),
    )
    .unwrap();
    assert_eq!(t.trading_day, "2026-10-19");
    let monday = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now()).unwrap();
    assert_eq!(monday.trades.len(), 1);
    assert_eq!(
        monday.session_start, "2026-10-16T21:00:00.000Z",
        "Monday starts at Friday's reset"
    );
    assert_eq!(monday.session_end, "2026-10-19T21:00:00.000Z");
    assert!(
        daily_reviews::get_day_at(&conn, &a, "2026-10-16", now())
            .unwrap()
            .trades
            .is_empty()
    );

    // DST ends on Sunday 2026-11-01 in New York: Monday's window spans the change (EDT start, EST end).
    let tz: chrono_tz::Tz = "America/New_York".parse().unwrap();
    let reset = NaiveTime::from_hms_opt(17, 0, 0).unwrap();
    let (start, end) = session_window(NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(), tz, reset);
    assert_eq!(start.to_rfc3339(), "2026-10-30T21:00:00+00:00");
    assert_eq!(end.to_rfc3339(), "2026-11-02T22:00:00+00:00");
    // Midnight reset: calendar days; Monday covers the weekend from Saturday 00:00.
    let utc: chrono_tz::Tz = "UTC".parse().unwrap();
    let (start, end) = session_window(
        NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(),
        utc,
        NaiveTime::MIN,
    );
    assert_eq!(
        (start.to_rfc3339().as_str(), end.to_rfc3339().as_str()),
        ("2026-10-17T00:00:00+00:00", "2026-10-20T00:00:00+00:00")
    );

    // "Now" is Rust's trading day too: Tuesday 17:30 New York is already Wednesday's.
    assert_eq!(
        daily_reviews::list_at(&conn, &a, at("2026-10-20T21:30:00Z"))
            .unwrap()
            .current_trading_day,
        "2026-10-21"
    );
    // Friday evening after the reset rolls to Monday.
    assert_eq!(
        daily_reviews::list_at(&conn, &a, at("2026-10-23T22:00:00Z"))
            .unwrap()
            .current_trading_day,
        "2026-10-26"
    );
}

/* ---------- Checklist snapshots and adherence ---------- */

#[test]
fn checklist_answers_keep_their_wording_and_unanswered_is_not_failed() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    let (checklist, items) = daily_checklist(
        &mut conn,
        &[
            "Pre-market plan written",
            "Max two trades",
            "No news trades",
            "Journal",
        ],
    );
    let r = daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            checklist_id: Some(checklist.clone()),
            answers: vec![
                answer(&items[0], "followed"),
                answer(&items[1], "missed"),
                answer(&items[2], "not_applicable"),
            ],
            ..input(&a, "2026-10-19")
        },
        now(),
    )
    .unwrap()
    .review
    .unwrap();
    let ad = &r.adherence;
    assert_eq!(
        (
            ad.followed,
            ad.missed,
            ad.not_applicable,
            ad.unanswered,
            ad.answered
        ),
        (1, 1, 1, 1, 2)
    );
    assert_eq!(
        ad.percent.as_deref(),
        Some("50"),
        "1 of 2 applicable answered items; N/A and unanswered don't count"
    );

    // Rename one item, archive another and the checklist: the review keeps what it answered.
    library::save_checklist(
        &mut conn,
        Some(&checklist),
        ChecklistInput {
            name: "Daily rules v2".into(),
            description: None,
            scope: "daily".into(),
            strategy_id: None,
            items: vec![
                ChecklistItemInput {
                    id: Some(items[0].clone()),
                    label: "Plan written before the open".into(),
                },
                ChecklistItemInput {
                    id: Some(items[2].clone()),
                    label: "No news trades".into(),
                },
            ],
        },
    )
    .unwrap();
    library::set_archived(
        &mut conn,
        ArchiveInput {
            entity: "checklist".into(),
            id: checklist.clone(),
            archived: true,
        },
    )
    .unwrap();
    let r = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now())
        .unwrap()
        .review
        .unwrap();
    assert_eq!(r.checklist.as_ref().unwrap().label, "Session rules");
    assert_eq!(
        r.checklist.as_ref().unwrap().current_label.as_deref(),
        Some("Daily rules v2")
    );
    assert!(r.checklist.as_ref().unwrap().archived);
    assert_eq!(r.answers[0].label, "Pre-market plan written");
    assert_eq!(
        r.answers[0].current_label.as_deref(),
        Some("Plan written before the open")
    );
    assert!(
        r.answers[1].archived,
        "Max two trades was archived and is still shown with its answer"
    );
    // Saving again with the archived checklist (already on the review) is allowed.
    daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            checklist_id: Some(checklist.clone()),
            answers: vec![answer(&items[0], "followed"), answer(&items[1], "missed")],
            ..with_lesson(&a, "2026-10-19", "x", Some(1))
        },
        now(),
    )
    .unwrap();
    let after = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now())
        .unwrap()
        .review
        .unwrap();
    assert_eq!(
        after.answers.len(),
        2,
        "an answer taken away goes back to unanswered"
    );
    // The library counts daily use, so a used checklist cannot change scope.
    let lib = library::load(&conn).unwrap();
    assert_eq!(
        lib.checklists
            .iter()
            .find(|c| c.id == checklist)
            .unwrap()
            .review_count,
        1
    );
    // A new review cannot pick the archived checklist.
    let fresh = DailyReviewInput {
        checklist_id: Some(checklist),
        ..input(&a, "2026-10-16")
    };
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, fresh, now()).unwrap_err()),
        ["checklistId"]
    );
}

#[test]
fn adherence_is_unknown_without_applicable_answers() {
    let ans = |r: &str| ChecklistAnswer {
        item_id: r.into(),
        label: "x".into(),
        result: r.into(),
        note: None,
        current_label: None,
        archived: false,
    };
    assert_eq!(adherence(&[], 3).percent, None);
    assert_eq!(
        adherence(&[ans("not_applicable")], 0).percent,
        None,
        "N/A only is Unknown, not 100%"
    );
    assert_eq!(adherence(&[ans("missed")], 0).percent.as_deref(), Some("0"));
    let two_of_three = [ans("followed"), ans("followed"), ans("missed")];
    assert_eq!(adherence(&two_of_three, 0).percent.as_deref(), Some("67"));
}

/* ---------- Trades, outcome and source changes ---------- */

#[test]
fn outcome_counts_unknown_pnl_and_no_trade_days_stay_distinct() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    trades::create(&mut conn, trade_input(&a)).unwrap(); // ES, +208.38 net on Monday the 19th
    trades::create(
        &mut conn,
        TradeInput {
            symbol: "ZZZ".into(),
            ..trade_input(&a)
        },
    )
    .unwrap(); // unknown instrument
    trades::create(
        &mut conn,
        TradeInput {
            exit_at: None,
            exit_price: None,
            ..trade_input(&a)
        },
    )
    .unwrap(); // open
    let day = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now()).unwrap();
    let o = &day.outcome;
    assert_eq!(
        (o.trades, o.closed_with_known_pnl, o.unknown_pnl, o.open),
        (3, 1, 1, 1)
    );
    assert_eq!(
        o.net.as_deref(),
        Some("208.38"),
        "unknown P&L is left out, never zero"
    );
    assert_eq!(day.day_state, "traded");
    // A day with trades can't be declared a no-trade day.
    let no_trade = DailyReviewInput {
        no_trade_day: true,
        ..input(&a, "2026-10-19")
    };
    assert_eq!(
        fields(daily_reviews::save_at(&mut conn, no_trade, now()).unwrap_err()),
        ["noTradeDay"]
    );

    // An empty day: nothing recorded vs. declared no-trade day; neither has a P&L.
    let empty = daily_reviews::get_day_at(&conn, &a, "2026-10-16", now()).unwrap();
    assert_eq!(
        (empty.day_state.as_str(), empty.outcome.net.as_deref()),
        ("no_trades_recorded", None)
    );
    let declared = daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            no_trade_day: true,
            action: "complete".into(),
            ..input(&a, "2026-10-16")
        },
        now(),
    )
    .unwrap();
    assert_eq!(declared.day_state, "no_trade_day");
    assert_eq!(
        declared.outcome.net, None,
        "a completed no-trade day is not a zero-P&L session"
    );
    assert_eq!(declared.review.unwrap().status, "completed");
}

#[test]
fn deleted_corrected_restored_and_moved_trades_are_reported_and_the_review_never_moves() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    let t1 = trades::create(&mut conn, trade_input(&a)).unwrap();
    let t2 = trades::create(
        &mut conn,
        trade_on(&a, "2026-10-19T15:00:00Z", "2026-10-19T15:30:00Z"),
    )
    .unwrap();
    let saved = daily_reviews::save_at(
        &mut conn,
        with_lesson(&a, "2026-10-19", "lesson", None),
        now(),
    )
    .unwrap();
    assert!(!saved.trades_changed);
    assert!(
        saved
            .trades
            .iter()
            .all(|t| t.link.as_deref() == Some("linked"))
    );

    // Added after the save (a later import or manual entry).
    let t3 = trades::create(
        &mut conn,
        trade_on(&a, "2026-10-19T16:00:00Z", "2026-10-19T16:30:00Z"),
    )
    .unwrap();
    // Corrected.
    trades::update_with(
        &mut conn,
        &t2.id,
        TradeInput {
            exit_price: Some("5010".into()),
            ..trade_on(&a, "2026-10-19T15:00:00Z", "2026-10-19T15:30:00Z")
        },
        TradeChangeOptions {
            expected_updated_at: None,
            reason: None,
        },
    )
    .unwrap();
    // Deleted.
    trades::delete_with(&mut conn, &t1.id, Some("duplicate".into())).unwrap();
    let day = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now()).unwrap();
    assert!(day.trades_changed);
    let link = |id: &str| {
        day.trades
            .iter()
            .find(|t| t.trade_id == id)
            .and_then(|t| t.link.clone())
    };
    assert_eq!(link(&t2.id).as_deref(), Some("changed"));
    assert_eq!(link(&t3.id).as_deref(), Some("added"));
    assert_eq!(day.missing_trades.len(), 1);
    assert_eq!(
        (
            day.missing_trades[0].trade_id.as_str(),
            day.missing_trades[0].reason.as_str()
        ),
        (t1.id.as_str(), "deleted")
    );
    assert_eq!(
        day.missing_trades[0].net_pnl_when_saved.as_deref(),
        Some("208.38")
    );

    // Restoring brings it back as linked; accepting the changes relinks without touching the text or status.
    trades::restore_deleted(&mut conn, &a, &t1.id, None).unwrap();
    let day = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now()).unwrap();
    assert!(day.missing_trades.is_empty());
    let r = daily_reviews::relink_at(
        &mut conn,
        DailyReviewRef {
            account_id: a.clone(),
            trading_day: "2026-10-19".into(),
            expected_revision: 1,
        },
        now(),
    )
    .unwrap();
    assert!(!r.trades_changed);
    let review = r.review.unwrap();
    assert_eq!((review.revision, review.status.as_str()), (2, "draft"));
    assert_eq!(review.reflection.key_lesson.as_deref(), Some("lesson"));

    // A timezone change re-derives the trades' days; the review stays on its day and says so.
    let mut changed: AccountInput = account_input("Eval");
    changed.timezone = "Asia/Tokyo".into();
    changed.trading_day_reset_time = "00:00".into();
    accounts::update(&mut conn, &a, changed).unwrap();
    let day = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now()).unwrap();
    assert!(day.session_settings_changed);
    assert_eq!(
        day.review
            .as_ref()
            .unwrap()
            .reflection
            .key_lesson
            .as_deref(),
        Some("lesson")
    );
    assert!(
        day.missing_trades
            .iter()
            .all(|m| m.reason == "moved" && m.moved_to.as_deref() == Some("2026-10-20"))
    );
    assert_eq!(day.missing_trades.len(), 3);
    assert_eq!(
        count(&conn, "SELECT count(*) FROM daily_reviews"),
        1,
        "nothing was copied or moved"
    );
}

#[test]
fn csv_reimport_keeps_review_links_by_trade_id() {
    // Re-import skips or restores the same trade ids (Build 17), so links survive; here the stable id is
    // simulated by deleting and restoring through the import path's restore.
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    daily_reviews::save_at(&mut conn, with_lesson(&a, "2026-10-19", "l", None), now()).unwrap();
    trades::delete_with(&mut conn, &t.id, None).unwrap();
    trades::restore(&conn, &t.id).unwrap();
    let day = daily_reviews::get_day_at(&conn, &a, "2026-10-19", now()).unwrap();
    assert_eq!(day.trades[0].trade_id, t.id);
    assert!(day.missing_trades.is_empty());
}

/* ---------- Index and legacy notes ---------- */

#[test]
fn the_index_lists_reviews_newest_first_and_legacy_notes_apart() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    journal::create(
        &mut conn,
        JournalEntryInput {
            account_id: a.clone(),
            trade_id: None,
            entry_at: "2026-10-16T22:00:00Z".into(),
            title: "Old day note".into(),
            body: "Before Build 22".into(),
            tags: vec![],
        },
    )
    .unwrap();
    daily_reviews::save_at(&mut conn, with_lesson(&a, "2026-10-16", "a", None), now()).unwrap();
    daily_reviews::save_at(&mut conn, with_lesson(&a, "2026-10-20", "b", None), now()).unwrap();
    let index = daily_reviews::list_at(&conn, &a, now()).unwrap();
    assert_eq!(
        index
            .reviews
            .iter()
            .map(|r| r.trading_day.as_str())
            .collect::<Vec<_>>(),
        ["2026-10-20", "2026-10-16"]
    );
    assert_eq!(index.legacy_notes.len(), 1);
    assert_eq!(
        index.legacy_notes[0].trading_day, "2026-10-19",
        "Friday 18:00 New York belongs to Monday"
    );
    assert_eq!(
        count(&conn, "SELECT count(*) FROM journal_entries"),
        1,
        "the legacy note is untouched"
    );
    assert!(
        index
            .reviews
            .iter()
            .all(|r| r.has_reflection && !r.has_plan)
    );
}

/* ---------- Migration ---------- */

#[test]
fn migration_18_upgrades_a_populated_v17_journal() {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::migrate_with(&mut conn, &crate::db::MIGRATIONS[..17]).unwrap();
    let a = account(&mut conn, "Before");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    journal::create(
        &mut conn,
        JournalEntryInput {
            account_id: a.clone(),
            trade_id: None,
            entry_at: "2026-10-19T21:30:00Z".into(),
            title: "Day note".into(),
            body: "text".into(),
            tags: vec!["focus".into()],
        },
    )
    .unwrap();

    assert_eq!(
        crate::db::migrate(&mut conn).unwrap(),
        crate::db::latest_version()
    );
    let (checklist, _) = daily_checklist(&mut conn, &["Rule"]);
    assert_eq!(
        count(&conn, "SELECT count(*) FROM daily_reviews"),
        0,
        "no note becomes a review"
    );
    assert_eq!(count(&conn, "SELECT count(*) FROM journal_entries"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 1);
    let index = daily_reviews::list_at(&conn, &a, now()).unwrap();
    assert!(index.reviews.is_empty());
    assert_eq!(index.legacy_notes.len(), 1);
    // The upgraded journal takes reviews.
    let day = daily_reviews::save_at(
        &mut conn,
        DailyReviewInput {
            checklist_id: Some(checklist),
            ..with_lesson(&a, "2026-10-19", "ok", None)
        },
        now(),
    )
    .unwrap();
    assert_eq!(day.trades[0].trade_id, t.id);
    // Account deletion (Build 24) cascades through reviews, answers, links and events.
    conn.execute("DELETE FROM accounts WHERE id = ?1", [&a])
        .unwrap();
    for table in [
        "daily_reviews",
        "daily_review_answers",
        "daily_review_trades",
        "daily_review_events",
    ] {
        assert_eq!(
            count(&conn, &format!("SELECT count(*) FROM {table}")),
            0,
            "{table}"
        );
    }
}

#[test]
fn review_events_are_append_only() {
    let mut conn = db();
    let a = account(&mut conn, "Eval");
    daily_reviews::save_at(&mut conn, with_lesson(&a, "2026-10-19", "x", None), now()).unwrap();
    assert!(
        conn.execute("UPDATE daily_review_events SET kind = 'saved'", [])
            .is_err()
    );
    assert!(conn.execute("DELETE FROM daily_review_events", []).is_err());
}
