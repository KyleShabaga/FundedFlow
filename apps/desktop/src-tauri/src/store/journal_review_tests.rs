//! Build 20: manual trades and corrections, reviews with library snapshots,
//! screenshots, CSV re-import and account isolation.

use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rusqlite::Connection;

use super::accounts;
use super::attachments::{self, ScreenshotInput};
use super::library::{
    self, ArchiveInput, ChecklistInput, ChecklistItemInput, StrategyInput, TagInput,
};
use super::reviews::{self, ChecklistAnswerInput, ReviewInput};
use super::tests::{account_input, db, trade_input};
use super::trades::{self, TradeChangeOptions};
use crate::csv_import::{self, CsvImportRequest, DateFormatChoice, FormatChoice};
use crate::error::AppError;

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("ff-b20-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn account(conn: &mut Connection, name: &str) -> String {
    accounts::create(conn, account_input(name)).unwrap().id
}

fn review(account_id: &str, trade_id: &str) -> ReviewInput {
    ReviewInput {
        account_id: account_id.into(),
        trade_id: trade_id.into(),
        expected_revision: None,
        strategy_id: None,
        checklist_id: None,
        planned_entry_price: None,
        planned_stop_price: None,
        planned_target_price: None,
        planned_risk: None,
        execution_rating: None,
        thesis: None,
        reflection: None,
        reviewed: false,
        tag_ids: vec![],
        checklist_results: vec![],
    }
}

/// A minimal PNG header; `marker` is a trailing byte that only makes fixture images (and their hashes) differ.
fn png(width: u32, height: u32, marker: u8) -> Vec<u8> {
    let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    b.extend(width.to_be_bytes());
    b.extend(height.to_be_bytes());
    b.extend([8, 6, 0, 0, 0, 0, 0, 0, 0, marker]);
    b
}

fn shot(account_id: &str, trade_id: &str, bytes: &[u8]) -> ScreenshotInput {
    ScreenshotInput {
        account_id: account_id.into(),
        trade_id: trade_id.into(),
        file_name: Some(r"C:\Users\someone\Pictures\entry.png".into()),
        data_base64: STANDARD.encode(bytes),
    }
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

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

// ---------------------------------------------------------------------------
// Manual trades and corrections
// ---------------------------------------------------------------------------

#[test]
fn a_manual_trade_and_its_review_survive_closing_and_reopening_the_journal() {
    let dir = TempDir::new();
    let path = dir.0.join(crate::db::DB_FILE_NAME);
    let (account_id, trade_id) = {
        let mut conn = crate::db::open_file(&path).unwrap();
        let a = account(&mut conn, "Manual only");
        let t = trades::create(&mut conn, trade_input(&a)).unwrap();
        assert_eq!(t.source, "manual");
        let s = library::save_strategy(
            &mut conn,
            None,
            StrategyInput {
                name: "Opening drive".into(),
                description: None,
            },
        )
        .unwrap();
        let mut r = review(&a, &t.id);
        r.strategy_id = Some(s.id);
        r.reflection = Some("Held to target.".into());
        r.execution_rating = Some(4);
        r.reviewed = true;
        reviews::save(&mut conn, Some(&dir.0), r).unwrap();
        (a, t.id)
    };
    let conn = crate::db::open_file(&path).unwrap();
    let t = trades::detail(&conn, &account_id, &trade_id).unwrap().trade;
    // ES long 5000.25 → 5004.50, 1 contract × $50 = 212.50 gross, 4.12 fees.
    assert_eq!(
        (
            t.gross_pnl.as_deref(),
            t.fees.as_str(),
            t.realized_pnl.as_deref()
        ),
        (Some("212.5"), "4.12", Some("208.38"))
    );
    assert_eq!(t.trading_day, "2026-10-19");
    let r = reviews::get(&conn, Some(&dir.0), &account_id, &trade_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            r.reflection.as_deref(),
            r.execution_rating,
            r.reviewed_at.is_some()
        ),
        (Some("Held to target."), Some(4), true)
    );
    assert_eq!(r.strategy.unwrap().label, "Opening drive");
}

#[test]
fn an_edit_recomputes_pnl_in_rust_and_records_the_old_and_new_values() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    let mut input = trade_input(&a);
    input.fees = Some("10".into());
    input.exit_price = Some("5010.25".into());
    let options = TradeChangeOptions {
        expected_updated_at: Some(t.updated_at.clone()),
        reason: Some("broker statement".into()),
    };
    let edited = trades::update_with(&mut conn, &t.id, input.clone(), options).unwrap();
    assert_eq!(
        (edited.gross_pnl.as_deref(), edited.realized_pnl.as_deref()),
        (Some("500"), Some("490"))
    );
    assert!(edited.updated_at > t.updated_at);

    let history = trades::corrections(&conn, &t.id).unwrap();
    assert_eq!(history.len(), 1);
    let c = &history[0];
    assert_eq!(
        (c.kind.as_str(), c.actor.as_str(), c.reason.as_deref()),
        ("edit", "local_user", Some("broker statement"))
    );
    for field in ["exitPrice", "fees", "grossPnl", "realizedPnl"] {
        assert!(
            c.changed_fields.iter().any(|f| f == field),
            "{field} in {:?}",
            c.changed_fields
        );
    }
    assert_eq!(c.before.as_ref().unwrap()["realizedPnl"], "208.38");
    assert_eq!(c.after.as_ref().unwrap()["realizedPnl"], "490");

    // The same values again change nothing and record nothing.
    let same = trades::update_with(
        &mut conn,
        &t.id,
        input.clone(),
        TradeChangeOptions::default(),
    )
    .unwrap();
    assert_eq!(same.updated_at, edited.updated_at);
    assert_eq!(trades::corrections(&conn, &t.id).unwrap().len(), 1);

    // A form opened before the edit is a conflict, and nothing is written.
    input.fees = Some("1".into());
    let stale = TradeChangeOptions {
        expected_updated_at: Some(t.updated_at.clone()),
        reason: None,
    };
    assert_eq!(
        kind(trades::update_with(&mut conn, &t.id, input, stale).unwrap_err()),
        "conflict"
    );
    assert_eq!(trades::get(&conn, &t.id).unwrap().fees, "10");
    // History is append-only.
    assert!(
        conn.execute("UPDATE trade_corrections SET reason = 'x'", [])
            .is_err()
    );
    assert!(conn.execute("DELETE FROM trade_corrections", []).is_err());
}

#[test]
fn delete_and_restore_are_recorded_and_keep_the_review() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    let mut r = review(&a, &t.id);
    r.reflection = Some("kept".into());
    reviews::save(&mut conn, None, r).unwrap();
    trades::delete_with(&mut conn, &t.id, Some("duplicate entry".into())).unwrap();
    assert_eq!(
        kind(trades::detail(&conn, &a, &t.id).unwrap_err()),
        "notFound"
    );
    let deleted = trades::list_deleted(&conn, &a).unwrap();
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0].trade.id, t.id);
    let restored = trades::restore_deleted(&mut conn, &a, &t.id, None).unwrap();
    assert_eq!(restored.realized_pnl, t.realized_pnl);
    let kinds: Vec<String> = trades::corrections(&conn, &t.id)
        .unwrap()
        .into_iter()
        .map(|c| c.kind)
        .collect();
    assert_eq!(kinds, ["delete", "restore"]);
    assert_eq!(
        reviews::get(&conn, None, &a, &t.id)
            .unwrap()
            .unwrap()
            .reflection
            .as_deref(),
        Some("kept")
    );
}

#[test]
fn trade_detail_gives_neighbours_in_entry_order() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let mut ids = Vec::new();
    for (entry, exit) in [
        ("2026-10-19T13:30:00Z", "2026-10-19T13:40:00Z"),
        ("2026-10-19T14:30:00Z", "2026-10-19T14:40:00Z"),
        ("2026-10-20T13:30:00Z", "2026-10-20T13:35:00Z"),
    ] {
        let mut input = trade_input(&a);
        input.entry_at = entry.into();
        input.exit_at = Some(exit.into());
        ids.push(trades::create(&mut conn, input).unwrap().id);
    }
    let d = trades::detail(&conn, &a, &ids[1]).unwrap();
    assert_eq!(
        (d.previous_trade_id.as_deref(), d.next_trade_id.as_deref()),
        (Some(ids[0].as_str()), Some(ids[2].as_str()))
    );
    assert_eq!((d.position, d.total), (2, 3));
    assert!(
        d.import_source.is_none(),
        "a manual trade has no import source"
    );
}

// ---------------------------------------------------------------------------
// CSV re-import keeps reviews; source rows are immutable
// ---------------------------------------------------------------------------

const CSV: &str = "symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
MNQZ6,-2,0,0.25,9001,9002,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,32sec
MNQZ6,-2,0,0.25,9003,9004,2,29790.00,29780.00,$(40.00),10/19/2026 08:10:00,10/19/2026 08:05:00,5min
";

fn import(conn: &mut Connection, account_id: &str) -> csv_import::ImportBatch {
    let req = CsvImportRequest {
        account_id: account_id.into(),
        file_name: "Performance.csv".into(),
        content: CSV.into(),
        timezone: "America/New_York".into(),
        format: FormatChoice::Auto,
        date_format: DateFormatChoice::Auto,
        columns: None,
        target_acknowledgement: None,
    };
    csv_import::commit_reviewed(conn, &req).unwrap()
}

#[test]
fn reimporting_the_same_file_keeps_reviews_and_source_rows() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let first = import(&mut conn, &a);
    assert_eq!(first.imported_count, 2);
    let listed = trades::list(&conn, &a).unwrap();
    let t = listed.iter().find(|t| t.quantity == "1").unwrap().clone();
    let tag = library::save_tag(
        &mut conn,
        None,
        TagInput {
            name: "A+ setup".into(),
            kind: "setup".into(),
        },
    )
    .unwrap();
    let mut r = review(&a, &t.id);
    r.tag_ids = vec![tag.id.clone()];
    r.reflection = Some("Imported, then reviewed.".into());
    let saved = reviews::save(&mut conn, None, r).unwrap();

    let raw_before: String = conn
        .query_row(
            "SELECT group_concat(raw_json, '|') FROM import_rows ORDER BY rowid",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let fills_before: String = conn
        .query_row(
            "SELECT group_concat(buy_price || sold_at_source, '|') FROM trade_round_trips",
            [],
            |r| r.get(0),
        )
        .unwrap();

    // Correct the imported trade: source cells and fills stay as exported.
    let mut edit = trade_input(&a);
    edit.symbol = t.symbol.clone();
    edit.entry_at = t.entry_at.clone();
    edit.entry_price = t.entry_price.clone();
    edit.exit_at = t.exit_at.clone();
    edit.exit_price = t.exit_price.clone();
    edit.fees = Some("1.24".into());
    edit.notes = None;
    let edited = trades::update(&mut conn, &t.id, edit).unwrap();
    assert_eq!(
        (edited.gross_pnl.as_deref(), edited.realized_pnl.as_deref()),
        (Some("26"), Some("24.76"))
    );
    assert_eq!(edited.source, "csv_import");

    // Re-importing is idempotent: duplicates, the review is untouched.
    let again = import(&mut conn, &a);
    assert_eq!((again.imported_count, again.duplicate_count), (0, 2));
    let kept = reviews::get(&conn, None, &a, &t.id).unwrap().unwrap();
    assert_eq!(
        (kept.revision, kept.reflection.as_deref()),
        (saved.revision, Some("Imported, then reviewed."))
    );
    assert_eq!(kept.tags.len(), 1);
    assert_eq!(
        trades::get(&conn, &t.id).unwrap().fees,
        "1.24",
        "a re-import never reverts a correction"
    );

    // Deleted, then re-imported: the same trade comes back with its review and import provenance.
    trades::delete(&mut conn, &t.id).unwrap();
    let restore = import(&mut conn, &a);
    assert_eq!(restore.imported_count, 1);
    assert_eq!(
        count(&conn, "SELECT count(*) FROM trades"),
        2,
        "no copy was inserted"
    );
    let detail = trades::detail(&conn, &a, &t.id).unwrap();
    let source = detail.import_source.unwrap();
    assert_eq!(
        (source.batch_id.as_str(), source.source_format.as_str()),
        (first.id.as_str(), "performance")
    );
    let at = source
        .headers
        .iter()
        .position(|h| h == "buyFillId")
        .unwrap();
    assert_eq!(source.raw_cells.unwrap()[at], "9001");
    assert_eq!(
        detail
            .corrections
            .iter()
            .map(|c| c.kind.as_str())
            .collect::<Vec<_>>(),
        ["edit", "delete", "import_restore"]
    );
    assert_eq!(
        reviews::get(&conn, None, &a, &t.id)
            .unwrap()
            .unwrap()
            .reflection
            .as_deref(),
        Some("Imported, then reviewed.")
    );

    let raw_after: String = conn.query_row("SELECT group_concat(raw_json, '|') FROM import_rows WHERE batch_id = ?1 ORDER BY rowid", [&first.id], |r| r.get(0)).unwrap();
    assert!(
        raw_before.starts_with(&raw_after),
        "original rows of the first import are unchanged"
    );
    let fills_after: String = conn
        .query_row(
            "SELECT group_concat(buy_price || sold_at_source, '|') FROM trade_round_trips",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(fills_before, fills_after);
}

// ---------------------------------------------------------------------------
// Account-attempt isolation
// ---------------------------------------------------------------------------

#[test]
fn identical_trades_in_two_accounts_never_share_a_review_or_screenshot() {
    let dir = TempDir::new();
    let mut conn = db();
    let a = account(&mut conn, "Attempt 1");
    let mut b_input = account_input("Attempt 2");
    b_input.external_ref = Some("other".into());
    let b = accounts::create(&mut conn, b_input).unwrap().id;
    let ta = trades::create(&mut conn, trade_input(&a)).unwrap();
    let tb = trades::create(&mut conn, trade_input(&b)).unwrap();
    assert_eq!(
        (ta.entry_at.as_str(), ta.symbol.as_str()),
        (tb.entry_at.as_str(), tb.symbol.as_str())
    );

    let mut r = review(&a, &ta.id);
    r.reflection = Some("account A only".into());
    reviews::save(&mut conn, Some(&dir.0), r).unwrap();
    assert!(reviews::get(&conn, None, &b, &tb.id).unwrap().is_none());
    // Another account's trade is "not found", for every read and write.
    assert_eq!(
        kind(reviews::get(&conn, None, &b, &ta.id).unwrap_err()),
        "notFound"
    );
    assert_eq!(
        kind(reviews::save(&mut conn, None, review(&b, &ta.id)).unwrap_err()),
        "notFound"
    );
    assert_eq!(
        kind(trades::detail(&conn, &b, &ta.id).unwrap_err()),
        "notFound"
    );
    let s = attachments::add(&mut conn, &dir.0, shot(&a, &ta.id, &png(800, 600, 1))).unwrap();
    assert_eq!(
        kind(attachments::read(&conn, &dir.0, &b, &s.id).unwrap_err()),
        "notFound"
    );
    assert_eq!(
        kind(attachments::add(&mut conn, &dir.0, shot(&b, &ta.id, &png(800, 600, 2))).unwrap_err()),
        "notFound"
    );
    assert_eq!(
        kind(attachments::remove(&mut conn, &b, &s.id).unwrap_err()),
        "notFound"
    );
    // The schema refuses a cross-account review even without the store.
    let err = conn.execute(
        "INSERT INTO trade_reviews (id, trade_id, account_id, created_at, updated_at) VALUES ('x', ?1, ?2, 'n', 'n')",
        [&tb.id, &a],
    );
    assert!(err.is_err());
    assert_eq!(reviews::summaries(&conn, &b).unwrap().len(), 0);
    assert_eq!(
        reviews::summaries(&conn, &a).unwrap()[0].notes,
        "account A only"
    );
}

// ---------------------------------------------------------------------------
// Reviews, library snapshots and history
// ---------------------------------------------------------------------------

#[test]
fn historical_reviews_keep_labels_after_templates_are_renamed_or_archived() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    let s = library::save_strategy(
        &mut conn,
        None,
        StrategyInput {
            name: "ORB".into(),
            description: Some("Opening range".into()),
        },
    )
    .unwrap();
    let mistake = library::save_tag(
        &mut conn,
        None,
        TagInput {
            name: "Chased".into(),
            kind: "mistake".into(),
        },
    )
    .unwrap();
    let c = library::save_checklist(
        &mut conn,
        None,
        ChecklistInput {
            name: "ORB entry".into(),
            description: None,
            scope: "trade".into(),
            strategy_id: Some(s.id.clone()),
            items: vec![
                ChecklistItemInput {
                    id: None,
                    label: "Waited for the range".into(),
                },
                ChecklistItemInput {
                    id: None,
                    label: "Stop below the range".into(),
                },
            ],
        },
    )
    .unwrap();
    let mut r = review(&a, &t.id);
    r.strategy_id = Some(s.id.clone());
    r.checklist_id = Some(c.id.clone());
    r.tag_ids = vec![mistake.id.clone()];
    r.checklist_results = vec![
        ChecklistAnswerInput {
            item_id: c.items[0].id.clone(),
            result: "followed".into(),
            note: None,
        },
        ChecklistAnswerInput {
            item_id: c.items[1].id.clone(),
            result: "missed".into(),
            note: Some("too tight".into()),
        },
    ];
    r.planned_entry_price = Some("5000".into());
    r.planned_stop_price = Some("4998".into());
    let first = reviews::save(&mut conn, None, r.clone()).unwrap();
    assert_eq!((first.adherence.followed, first.adherence.missed), (1, 1));
    // 1R derived from plan: |5000 − 4998| × 1 × $50 = $100; net 208.38 → 2.08R.
    assert_eq!(
        (
            first.planned_risk.as_deref(),
            first.planned_risk_source.as_deref()
        ),
        (Some("100"), Some("derived"))
    );
    assert_eq!(first.r_multiple.as_deref(), Some("2.08"));

    // Rename and archive everything the review used.
    library::save_strategy(
        &mut conn,
        Some(&s.id),
        StrategyInput {
            name: "Opening range breakout".into(),
            description: None,
        },
    )
    .unwrap();
    library::save_tag(
        &mut conn,
        Some(&mistake.id),
        TagInput {
            name: "FOMO entry".into(),
            kind: "mistake".into(),
        },
    )
    .unwrap();
    library::save_checklist(
        &mut conn,
        Some(&c.id),
        ChecklistInput {
            name: "ORB v2".into(),
            description: None,
            scope: "trade".into(),
            strategy_id: Some(s.id.clone()),
            items: vec![ChecklistItemInput {
                id: Some(c.items[0].id.clone()),
                label: "Range formed (15 min)".into(),
            }],
        },
    )
    .unwrap();
    for (entity, id) in [
        ("strategy", &s.id),
        ("tag", &mistake.id),
        ("checklist", &c.id),
    ] {
        library::set_archived(
            &mut conn,
            ArchiveInput {
                entity: entity.into(),
                id: id.clone(),
                archived: true,
            },
        )
        .unwrap();
    }

    let after = reviews::get(&conn, None, &a, &t.id).unwrap().unwrap();
    let strategy = after.strategy.clone().unwrap();
    assert_eq!(
        (
            strategy.label.as_str(),
            strategy.current_label.as_deref(),
            strategy.archived
        ),
        ("ORB", Some("Opening range breakout"), true)
    );
    assert_eq!(after.checklist.clone().unwrap().label, "ORB entry");
    assert_eq!(after.tags[0].label, "Chased");
    assert_eq!(after.tags[0].current_label.as_deref(), Some("FOMO entry"));
    let labels: Vec<&str> = after
        .checklist_results
        .iter()
        .map(|a| a.label.as_str())
        .collect();
    assert_eq!(labels, ["Waited for the range", "Stop below the range"]);
    assert!(
        after.checklist_results[1].archived,
        "the dropped item was archived, not deleted"
    );

    // Re-saving keeps the snapshots; archived entries already on the review may stay.
    let mut again = r.clone();
    again.expected_revision = Some(after.revision);
    again.reflection = Some("Re-read a week later".into());
    let resaved = reviews::save(&mut conn, None, again).unwrap();
    assert_eq!(resaved.revision, after.revision + 1);
    assert_eq!(resaved.strategy.unwrap().label, "ORB");
    assert_eq!(resaved.checklist_results[0].label, "Waited for the range");
    assert_eq!(resaved.tags[0].label, "Chased");

    // A stale form is a conflict; an archived template cannot be newly chosen.
    let mut stale = r.clone();
    stale.expected_revision = Some(after.revision);
    assert_eq!(
        kind(reviews::save(&mut conn, None, stale).unwrap_err()),
        "conflict"
    );
    let other = trades::create(&mut conn, trade_input(&a)).unwrap();
    let mut fresh = review(&a, &other.id);
    fresh.strategy_id = Some(s.id.clone());
    assert_eq!(
        kind(reviews::save(&mut conn, None, fresh).unwrap_err()),
        "validation"
    );
    // Unknown planned risk stays unknown, never zero.
    let blank = reviews::save(&mut conn, None, review(&a, &other.id)).unwrap();
    assert_eq!((blank.planned_risk, blank.r_multiple), (None, None));
    let mut zero = review(&a, &other.id);
    zero.expected_revision = Some(blank.revision);
    zero.planned_risk = Some("0".into());
    assert_eq!(
        kind(reviews::save(&mut conn, None, zero).unwrap_err()),
        "validation"
    );
}

#[test]
fn prices_beyond_decimal_range_give_unknown_risk_or_a_validation_error_never_a_panic() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    // |79228162514264337593543950335 − (−1)| does not fit a Decimal: 1R is unknown, and later reads still work.
    let mut r = review(&a, &t.id);
    r.planned_entry_price = Some("79228162514264337593543950335".into());
    r.planned_stop_price = Some("-1".into());
    let saved = reviews::save(&mut conn, None, r).unwrap();
    assert_eq!(
        (saved.planned_risk.as_deref(), saved.r_multiple.as_deref()),
        (None, None)
    );
    let read = reviews::get(&conn, None, &a, &t.id).unwrap().unwrap();
    assert_eq!(
        (read.planned_risk.as_deref(), read.r_multiple.as_deref()),
        (None, None)
    );

    // A trade whose price move does not fit is rejected, and nothing is written.
    let before = count(&conn, "SELECT COUNT(*) FROM trades");
    let mut input = trade_input(&a);
    input.entry_price = "79228162514264337593543950335".into();
    input.exit_price = Some("-1".into());
    assert_eq!(
        kind(trades::create(&mut conn, input).unwrap_err()),
        "validation"
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM trades"), before);
}

#[test]
fn library_validation_and_uniqueness() {
    let mut conn = db();
    library::save_tag(
        &mut conn,
        None,
        TagInput {
            name: "Calm".into(),
            kind: "emotion".into(),
        },
    )
    .unwrap();
    assert_eq!(
        kind(
            library::save_tag(
                &mut conn,
                None,
                TagInput {
                    name: "calm".into(),
                    kind: "emotion".into()
                }
            )
            .unwrap_err()
        ),
        "conflict"
    );
    library::save_tag(
        &mut conn,
        None,
        TagInput {
            name: "Calm".into(),
            kind: "general".into(),
        },
    )
    .unwrap();
    assert_eq!(
        kind(
            library::save_tag(
                &mut conn,
                None,
                TagInput {
                    name: " ".into(),
                    kind: "setup".into()
                }
            )
            .unwrap_err()
        ),
        "validation"
    );
    assert_eq!(
        kind(
            library::save_tag(
                &mut conn,
                None,
                TagInput {
                    name: "x".into(),
                    kind: "mood".into()
                }
            )
            .unwrap_err()
        ),
        "validation"
    );
    let daily = ChecklistInput {
        name: "Morning".into(),
        description: None,
        scope: "daily".into(),
        strategy_id: None,
        items: vec![],
    };
    let c = library::save_checklist(&mut conn, None, daily).unwrap();
    assert_eq!(c.scope, "daily");
    let mut with_strategy = ChecklistInput {
        name: "Bad".into(),
        description: None,
        scope: "daily".into(),
        strategy_id: Some("s".into()),
        items: vec![],
    };
    assert_eq!(
        kind(library::save_checklist(&mut conn, None, with_strategy.clone()).unwrap_err()),
        "validation"
    );
    with_strategy.scope = "trade".into();
    assert_eq!(
        kind(library::save_checklist(&mut conn, None, with_strategy).unwrap_err()),
        "validation"
    );
    let lib = library::load(&conn).unwrap();
    assert_eq!((lib.tags.len(), lib.checklists.len()), (2, 1));
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

fn stored_file(root: &Path, conn: &Connection, id: &str) -> PathBuf {
    let key: String = conn
        .query_row(
            "SELECT storage_key FROM attachments WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        key.starts_with("screenshots/") && !key.contains('\\') && !key.contains(':'),
        "portable key {key}"
    );
    root.join("attachments").join(key)
}

#[test]
fn screenshots_are_validated_stored_portably_and_recovered_safely() {
    let dir = TempDir::new();
    let mut conn = db();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    let mut r = review(&a, &t.id);
    r.reflection = Some("notes first".into());
    reviews::save(&mut conn, Some(&dir.0), r).unwrap();

    let bytes = png(1920, 1080, 7);
    let s = attachments::add(&mut conn, &dir.0, shot(&a, &t.id, &bytes)).unwrap();
    assert_eq!(
        (
            s.mime_type.as_str(),
            s.width,
            s.height,
            s.file_status.as_str()
        ),
        ("image/png", Some(1920), Some(1080), "ok")
    );
    assert_eq!(
        s.file_name.as_deref(),
        Some("entry.png"),
        "only the file's name is kept, never its path"
    );
    let file = stored_file(&dir.0, &conn, &s.id);
    assert_eq!(std::fs::read(&file).unwrap(), bytes);
    let read = attachments::read(&conn, &dir.0, &a, &s.id).unwrap();
    assert_eq!(
        (read.status.as_str(), read.data_base64.as_deref()),
        ("ok", Some(STANDARD.encode(&bytes).as_str()))
    );
    // Adding a screenshot leaves the review's text and revision alone.
    let rev = reviews::get(&conn, Some(&dir.0), &a, &t.id)
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            rev.revision,
            rev.reflection.as_deref(),
            rev.attachments.len()
        ),
        (1, Some("notes first"), 1)
    );

    // Rejected: duplicates, non-images (whatever their name), oversized and enormous images.
    assert_eq!(
        kind(attachments::add(&mut conn, &dir.0, shot(&a, &t.id, &bytes)).unwrap_err()),
        "conflict"
    );
    let mut fake = shot(&a, &t.id, b"MZ\x90\x00 not a png");
    fake.file_name = Some("chart.png".into());
    assert_eq!(
        kind(attachments::add(&mut conn, &dir.0, fake).unwrap_err()),
        "validation"
    );
    assert_eq!(
        kind(
            attachments::add(&mut conn, &dir.0, shot(&a, &t.id, &png(20_000, 10, 1))).unwrap_err()
        ),
        "validation"
    );
    let mut big = png(10, 10, 1);
    big.resize(attachments::MAX_BYTES + 1, 0);
    assert_eq!(
        kind(attachments::add(&mut conn, &dir.0, shot(&a, &t.id, &big)).unwrap_err()),
        "validation"
    );
    let mut garbled = shot(&a, &t.id, &bytes);
    garbled.data_base64 = "%%%".into();
    assert_eq!(
        kind(attachments::add(&mut conn, &dir.0, garbled).unwrap_err()),
        "validation"
    );

    // A changed file is reported corrupt, a missing one missing; the review still reads.
    std::fs::write(&file, png(1920, 1080, 8)).unwrap();
    assert_eq!(
        attachments::read(&conn, &dir.0, &a, &s.id).unwrap().status,
        "corrupt"
    );
    std::fs::remove_file(&file).unwrap();
    assert_eq!(
        attachments::read(&conn, &dir.0, &a, &s.id).unwrap().status,
        "missing"
    );
    let rev = reviews::get(&conn, Some(&dir.0), &a, &t.id)
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            rev.attachments[0].file_status.as_str(),
            rev.reflection.as_deref()
        ),
        ("missing", Some("notes first"))
    );

    // Removing detaches it; the row and inventory stay for the archive.
    let second = attachments::add(&mut conn, &dir.0, shot(&a, &t.id, &png(640, 480, 9))).unwrap();
    attachments::remove(&mut conn, &a, &second.id).unwrap();
    assert_eq!(
        reviews::get(&conn, None, &a, &t.id)
            .unwrap()
            .unwrap()
            .attachments
            .len(),
        1
    );
    assert!(stored_file(&dir.0, &conn, &second.id).exists());
    assert_eq!(
        kind(attachments::read(&conn, &dir.0, &a, &second.id).unwrap_err()),
        "notFound"
    );
}

#[test]
fn a_failed_screenshot_save_leaves_no_file_and_keeps_the_review() {
    let dir = TempDir::new();
    let mut conn = db();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    let mut r = review(&a, &t.id);
    r.thesis = Some("plan".into());
    reviews::save(&mut conn, Some(&dir.0), r).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_links BEFORE INSERT ON attachment_links BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
    )
    .unwrap();
    assert!(attachments::add(&mut conn, &dir.0, shot(&a, &t.id, &png(10, 10, 1))).is_err());
    assert_eq!(count(&conn, "SELECT count(*) FROM attachments"), 0);
    let shots = dir.0.join("attachments").join("screenshots");
    let left: Vec<_> = std::fs::read_dir(&shots)
        .map(|d| d.flatten().collect())
        .unwrap_or_default();
    assert!(left.is_empty(), "no orphan bytes: {left:?}");
    assert_eq!(
        reviews::get(&conn, None, &a, &t.id)
            .unwrap()
            .unwrap()
            .thesis
            .as_deref(),
        Some("plan")
    );
}

#[test]
fn image_signatures_and_dimensions() {
    let jpeg = [
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x02, 0x58,
        0x03, 0x20, 0x03, 0x01, 0x11, 0x00,
    ];
    let info = attachments::sniff(&jpeg).unwrap();
    assert_eq!(
        (info.mime, info.width, info.height),
        ("image/jpeg", 800, 600)
    );
    let mut webp = b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0".to_vec();
    webp.extend([0x7F, 0x07, 0x00, 0x37, 0x04, 0x00]); // 1920 × 1080, stored minus one
    let info = attachments::sniff(&webp).unwrap();
    assert_eq!(
        (info.mime, info.width, info.height),
        ("image/webp", 1920, 1080)
    );
    assert!(attachments::sniff(b"GIF89a....").is_none());
    assert!(
        attachments::sniff(b"\x89PNG\r\n\x1a\n").is_none(),
        "truncated header"
    );
}

// ---------------------------------------------------------------------------
// Migration 17
// ---------------------------------------------------------------------------

#[test]
fn migration_17_keeps_reserved_rows_and_fills_review_ownership() {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::configure(&conn).unwrap();
    crate::db::migrate_with(&mut conn, &crate::db::MIGRATIONS[..16]).unwrap();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    // A review row in the v16 (reserved) shape.
    conn.execute(
        "INSERT INTO trade_reviews (id, trade_id, reflection_md, created_at, updated_at)
         VALUES ('old-review', ?1, 'written before v17', '2026-10-19T21:00:00.000Z', '2026-10-19T21:00:00.000Z')",
        [&t.id],
    )
    .unwrap();
    let before = trades::get(&conn, &t.id).unwrap();
    assert_eq!(
        crate::db::migrate_with(&mut conn, &crate::db::MIGRATIONS[..17]).unwrap(),
        17
    );
    assert_eq!(
        trades::get(&conn, &t.id).unwrap(),
        before,
        "trades are unchanged"
    );
    let r = reviews::get(&conn, None, &a, &t.id).unwrap().unwrap();
    assert_eq!(
        (r.id.as_str(), r.account_id.as_str(), r.revision),
        ("old-review", a.as_str(), 1)
    );
    assert_eq!(r.reflection.as_deref(), Some("written before v17"));
    assert_eq!(
        crate::db::migrate_with(&mut conn, &crate::db::MIGRATIONS[..17]).unwrap(),
        17,
        "reopening is a no-op"
    );
}

#[test]
fn trade_edits_never_rewrite_stored_snapshots() {
    let mut conn = db();
    let a = account(&mut conn, "A");
    let t = trades::create(&mut conn, trade_input(&a)).unwrap();
    conn.execute(
        "INSERT INTO account_snapshots (id, account_id, trading_day, is_end_of_day, data_source, calculated_at,
                                        engine_version, inputs_hash, balance_micros, realized_day_pnl_micros, status,
                                        explanation_json)
         VALUES ('snap', ?1, '2026-10-19', 1, 'manual', '2026-10-19T22:00:00.000Z', 'test', 'h', 50208380000,
                 208380000, 'safe', '{}')",
        [&a],
    )
    .unwrap();
    let mut input = trade_input(&a);
    input.fees = Some("100".into());
    trades::update(&mut conn, &t.id, input).unwrap();
    let (balance, hash): (i64, String) = conn
        .query_row(
            "SELECT balance_micros, inputs_hash FROM account_snapshots WHERE id = 'snap'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    // The stored figure stays as calculated; the engine's inputs hash no longer matches, so the UI shows it stale.
    assert_eq!((balance, hash.as_str()), (50_208_380_000, "h"));
}
