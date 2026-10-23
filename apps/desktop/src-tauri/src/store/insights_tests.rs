//! Build 23: the Insights dataset read. Attempt isolation (including a reused
//! broker account number), archived and failed history, soft delete and
//! restore, CSV re-import, corrections, review facts (strategy, tags, planned
//! risk and R), trading days across the DST change, and a restart of a file
//! journal. Aggregation itself is pinned by the parity fixture
//! (`insights-metrics.json`); here the Rust summary is run over the dataset to
//! show the read and the metrics fit together.

use std::path::PathBuf;

use rusqlite::Connection;

use super::accounts::{self, AccountInput, StatusChangeInput};
use super::attempts::{self, ResetInput, RulebookDecision};
use super::insights::{self, InsightsDataset, InsightsQuery};
use super::library::{self, StrategyInput, TagInput};
use super::reviews::{self, ReviewInput};
use super::tests::{account_input, db};
use super::trades::{self, TradeChangeOptions, TradeInput};
use crate::csv_import::{self, CsvImportRequest, DateFormatChoice, FormatChoice};
use crate::error::AppError;
use crate::insights::{MetricTrade, summarize};

const PERFORMANCE: &str = include_str!("../../../../../test_csvimport/Performance.csv");
const NOW: &str = "2026-10-20T15:00:00.000Z";

fn read(conn: &Connection, ids: &[&str]) -> InsightsDataset {
    insights::dataset_at(
        conn,
        InsightsQuery {
            account_ids: ids.iter().map(|s| s.to_string()).collect(),
        },
        NOW,
    )
    .unwrap()
}

fn import(conn: &mut Connection, account_id: &str) -> usize {
    import_content(conn, account_id, PERFORMANCE)
}

fn import_content(conn: &mut Connection, account_id: &str, content: &str) -> usize {
    let req = CsvImportRequest {
        account_id: account_id.into(),
        file_name: "Performance.csv".into(),
        content: content.into(),
        timezone: "America/New_York".into(),
        format: FormatChoice::Auto,
        date_format: DateFormatChoice::Auto,
        columns: None,
        target_acknowledgement: None,
    };
    csv_import::commit_reviewed(conn, &req)
        .unwrap()
        .imported_count as usize
}

fn trade(account_id: &str, symbol: &str, exit_at: &str, entry: &str, exit: &str) -> TradeInput {
    TradeInput {
        account_id: account_id.into(),
        symbol: symbol.into(),
        side: "long".into(),
        quantity: "1".into(),
        entry_at: exit_at.into(),
        entry_price: entry.into(),
        exit_at: Some(exit_at.into()),
        exit_price: Some(exit.into()),
        fees: Some("4.12".into()),
        realized_pnl: None,
        notes: None,
    }
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
        reviewed: true,
        tag_ids: vec![],
        checklist_results: vec![],
    }
}

fn kind(err: AppError) -> &'static str {
    match err {
        AppError::Validation { .. } => "validation",
        AppError::NotFound { .. } => "notFound",
        _ => "other",
    }
}

fn metric_trades(d: &InsightsDataset) -> Vec<MetricTrade> {
    serde_json::from_value(serde_json::to_value(&d.trades).unwrap()).unwrap()
}

/// Two old attempts (the first failed, the second passed then archived) and the current attempt, all with the same
/// broker account number, holding identical economics/IDs at valid distinct attempt instants.
fn chain(conn: &mut Connection) -> (String, String, String) {
    let first = accounts::create(
        conn,
        AccountInput {
            external_ref: Some("TOP-1".into()),
            ..account_input("Attempt 1")
        },
    )
    .unwrap();
    import(conn, &first.id);
    let second = attempts::reset(
        conn,
        ResetInput {
            predecessor_account_id: first.id.clone(),
            prior_outcome: "failed".into(),
            effective_at: "2026-10-20T15:00:00-04:00".into(),
            reason: Some("Hit the trailing drawdown".into()),
            source: "provider_email".into(),
            name: "Attempt 2".into(),
            external_ref: Some("TOP-1".into()),
            starting_balance: "50000".into(),
            catalogue: None,
            rulebook: RulebookDecision::DecideLater,
            notes: None,
        },
    )
    .unwrap()
    .successor;
    // Identical broker IDs/economics, but timestamps must belong to attempt 2.
    import_content(
        conn,
        &second.id,
        &PERFORMANCE.replace("10/19/2026", "10/21/2026"),
    );
    let third = attempts::reset(
        conn,
        ResetInput {
            predecessor_account_id: second.id.clone(),
            prior_outcome: "passed".into(),
            effective_at: "2026-10-21T15:00:00-04:00".into(),
            reason: None,
            source: "user_entered".into(),
            name: "Attempt 3".into(),
            external_ref: Some("TOP-1".into()),
            starting_balance: "50000".into(),
            catalogue: None,
            rulebook: RulebookDecision::DecideLater,
            notes: None,
        },
    )
    .unwrap()
    .successor;
    accounts::archive(conn, &second.id).unwrap();
    trades::create(
        conn,
        trade(&third.id, "ESZ6", "2026-10-22T14:00:00Z", "5000", "5002"),
    )
    .unwrap();
    (first.id, second.id, third.id)
}

#[test]
fn attempts_never_share_trades_even_with_the_same_broker_number() {
    let mut conn = db();
    let (a1, a2, a3) = chain(&mut conn);
    let one = read(&conn, &[&a1]);
    let two = read(&conn, &[&a2]);
    let three = read(&conn, &[&a3]);
    assert!(!one.trades.is_empty());
    assert_eq!(
        one.trades.len(),
        two.trades.len(),
        "the same economic rows at each attempt's own instants"
    );
    assert!(one.trades.iter().all(|t| t.account_id == a1));
    assert!(two.trades.iter().all(|t| t.account_id == a2));
    let ids1: Vec<_> = one.trades.iter().map(|t| &t.id).collect();
    assert!(
        two.trades.iter().all(|t| !ids1.contains(&&t.id)),
        "distinct trade ids per attempt"
    );
    assert_eq!(three.trades.len(), 1);

    let all = read(&conn, &[&a1, &a2, &a3]);
    assert_eq!(all.trades.len(), one.trades.len() * 2 + 1);
    assert_eq!(
        all.accounts
            .iter()
            .map(|a| a.attempt_number)
            .collect::<Vec<_>>(),
        [1, 2, 3]
    );
    assert!(all.accounts.iter().all(|a| a.lineage_root_id == a1));
    assert_eq!(
        all.accounts
            .iter()
            .map(|a| a.external_ref.as_deref())
            .collect::<Vec<_>>(),
        [Some("TOP-1"); 3]
    );

    // Separate account-level calculations from the same rows.
    let s1 = summarize(&metric_trades(&one));
    let s2 = summarize(&metric_trades(&two));
    assert_eq!(s1["net"], s2["net"]);
    let total = summarize(&metric_trades(&all));
    assert_eq!(
        total["closed"].as_u64().unwrap(),
        s1["closed"].as_u64().unwrap() * 2 + 1
    );
}

#[test]
fn history_is_readable_and_outcomes_are_only_what_the_user_entered() {
    let mut conn = db();
    let (a1, a2, a3) = chain(&mut conn);
    let d = read(&conn, &[&a1, &a2, &a3]);
    let [first, second, third] = [&d.accounts[0], &d.accounts[1], &d.accounts[2]];
    assert_eq!(first.status, "failed");
    let failed = first.status_event.as_ref().unwrap();
    assert_eq!(
        (failed.status.as_str(), failed.cause.as_deref()),
        ("failed", Some("Hit the trailing drawdown"))
    );
    assert_eq!(second.status, "passed");
    assert!(
        second.archived_at.is_some(),
        "archived attempts are read, not hidden"
    );
    assert_eq!(
        second.status_event.as_ref().unwrap().cause,
        None,
        "no cause stated, none invented"
    );
    assert_eq!(third.status, "active");
    assert_eq!(
        (first.committed_import_count, third.committed_import_count),
        (1, 0)
    );

    // Marking an account failed without a cause records no cause.
    accounts::change_status(
        &mut conn,
        &a3,
        StatusChangeInput {
            status: "failed".into(),
            effective_at: Some("2026-10-23T21:00:00Z".into()),
            cause: None,
            note: None,
        },
    )
    .unwrap();
    let after = read(&conn, &[&a3]);
    assert_eq!(after.accounts[0].status_event.as_ref().unwrap().cause, None);
}

#[test]
fn deleted_trades_are_left_out_and_counted_and_restores_come_back() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap().id;
    let n = import(&mut conn, &a);
    let before = read(&conn, &[&a]);
    assert_eq!(before.trades.len(), n);
    let gone = before.trades[0].id.clone();
    trades::delete_with(&mut conn, &gone, Some("duplicate".into())).unwrap();
    let after = read(&conn, &[&a]);
    assert_eq!(after.trades.len(), n - 1);
    assert!(after.trades.iter().all(|t| t.id != gone));
    assert_eq!(after.accounts[0].deleted_trade_count, 1);

    // Re-importing the file restores the same trade id instead of adding a copy.
    import(&mut conn, &a);
    let again = read(&conn, &[&a]);
    assert_eq!(again.trades.len(), n);
    assert!(again.trades.iter().any(|t| t.id == gone));
    assert_eq!(again.accounts[0].deleted_trade_count, 0);
    // A second re-import is all duplicates.
    import(&mut conn, &a);
    assert_eq!(read(&conn, &[&a]).trades.len(), n);
}

#[test]
fn corrections_review_tags_and_planned_risk_reach_the_dataset() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap().id;
    // ES point value 50: (5004 − 5000) × 50 = 200 gross, 195.88 net.
    let t = trades::create(
        &mut conn,
        trade(&a, "ESZ6", "2026-10-19T14:00:00Z", "5000", "5004"),
    )
    .unwrap();
    let strategy = library::save_strategy(
        &mut conn,
        None,
        StrategyInput {
            name: "Opening range".into(),
            description: None,
        },
    )
    .unwrap();
    let setup = library::save_tag(
        &mut conn,
        None,
        TagInput {
            name: "ORB".into(),
            kind: "setup".into(),
        },
    )
    .unwrap();
    let mistake = library::save_tag(
        &mut conn,
        None,
        TagInput {
            name: "Late entry".into(),
            kind: "mistake".into(),
        },
    )
    .unwrap();
    let mut r = review(&a, &t.id);
    r.strategy_id = Some(strategy.id.clone());
    r.tag_ids = vec![setup.id.clone(), mistake.id.clone()];
    r.planned_entry_price = Some("5000".into());
    r.planned_stop_price = Some("4998".into());
    reviews::save(&mut conn, None, r).unwrap();

    let d = read(&conn, &[&a]);
    let row = &d.trades[0];
    assert_eq!(
        (
            row.gross_pnl.as_deref(),
            row.realized_pnl.as_deref(),
            row.fees.as_str()
        ),
        (Some("200"), Some("195.88"), "4.12")
    );
    assert_eq!(row.symbol_root.as_deref(), Some("ES"));
    let rev = row.review.as_ref().unwrap();
    assert_eq!(
        (rev.strategy_id.as_deref(), rev.strategy_name.as_deref()),
        (Some(strategy.id.as_str()), Some("Opening range"))
    );
    assert_eq!(
        rev.tags
            .iter()
            .map(|t| (t.kind.as_str(), t.label.as_str()))
            .collect::<Vec<_>>(),
        [("mistake", "Late entry"), ("setup", "ORB")]
    );
    // 1R derived from the planned stop: 2 points × 1 × 50 = 100; R = 195.88 / 100.
    assert_eq!(
        (
            rev.planned_risk.as_deref(),
            rev.planned_risk_source.as_deref(),
            rev.r_multiple.as_deref()
        ),
        (Some("100"), Some("derived"), Some("1.96"))
    );
    let detail = reviews::get(&conn, None, &a, &t.id).unwrap().unwrap();
    assert_eq!(
        detail.r_multiple, rev.r_multiple,
        "Insights and the trade review derive R the same way"
    );

    // Renaming the strategy keeps the review's recorded label.
    library::save_strategy(
        &mut conn,
        Some(&strategy.id),
        StrategyInput {
            name: "ORB v2".into(),
            description: None,
        },
    )
    .unwrap();
    assert_eq!(
        read(&conn, &[&a]).trades[0]
            .review
            .as_ref()
            .unwrap()
            .strategy_name
            .as_deref(),
        Some("Opening range")
    );

    // A correction changes the stored values the dataset returns, and R follows.
    trades::update_with(
        &mut conn,
        &t.id,
        trade(&a, "ESZ6", "2026-10-19T14:00:00Z", "5000", "4999"),
        TradeChangeOptions {
            expected_updated_at: Some(t.updated_at.clone()),
            reason: Some("wrong exit".into()),
        },
    )
    .unwrap();
    let corrected = read(&conn, &[&a]);
    let row = &corrected.trades[0];
    assert_eq!(row.realized_pnl.as_deref(), Some("-54.12"));
    assert_eq!(
        row.review.as_ref().unwrap().r_multiple.as_deref(),
        Some("-0.54")
    );

    // An entered risk wins over a derived one; unknown P&L has no R.
    let unknown = trades::create(
        &mut conn,
        trade(&a, "XYZ", "2026-10-20T14:00:00Z", "10", "11"),
    )
    .unwrap();
    let mut r2 = review(&a, &unknown.id);
    r2.planned_risk = Some("50".into());
    reviews::save(&mut conn, None, r2).unwrap();
    let d = read(&conn, &[&a]);
    let u = d.trades.iter().find(|t| t.id == unknown.id).unwrap();
    assert_eq!(
        (
            u.pnl_status.as_str(),
            u.realized_pnl.as_deref(),
            u.symbol_root.as_deref()
        ),
        ("missing_instrument", None, None)
    );
    let ur = u.review.as_ref().unwrap();
    assert_eq!(
        (
            ur.planned_risk.as_deref(),
            ur.planned_risk_source.as_deref(),
            ur.r_multiple.as_deref()
        ),
        (Some("50"), Some("entered"), None)
    );
}

#[test]
fn trading_days_are_the_stored_ones_across_dst_and_reset_changes() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap().id;
    // 17:00 New York reset. Friday 2026-10-30 17:30 EDT (21:30Z) → Monday Nov 2; after the 2026-11-01 DST change,
    // Monday 16:59 EST (21:59Z) → Monday, 17:00 EST (22:00Z) → Tuesday.
    for at in [
        "2026-10-30T21:30:00Z",
        "2026-11-02T21:59:00Z",
        "2026-11-02T22:00:00Z",
    ] {
        trades::create(&mut conn, trade(&a, "ESZ6", at, "5000", "5001")).unwrap();
    }
    let days: Vec<String> = read(&conn, &[&a])
        .trades
        .into_iter()
        .map(|t| t.trading_day)
        .collect();
    assert_eq!(days, ["2026-11-02", "2026-11-02", "2026-11-03"]);

    // Changing the account's reset re-derives stored days; Insights reads them as Rust stored them.
    let mut input = account_input("A");
    input.trading_day_reset_time = "00:00".into();
    accounts::update(&mut conn, &a, input).unwrap();
    let days: Vec<String> = read(&conn, &[&a])
        .trades
        .into_iter()
        .map(|t| t.trading_day)
        .collect();
    assert_eq!(
        days,
        ["2026-10-30", "2026-11-02", "2026-11-02"],
        "Friday afternoon is Friday's session without the evening reset"
    );
}

#[test]
fn requests_are_validated_and_scoped() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap().id;
    let b = accounts::create(&mut conn, account_input("B")).unwrap().id;
    trades::create(
        &mut conn,
        trade(&a, "ESZ6", "2026-10-19T14:00:00Z", "5000", "5001"),
    )
    .unwrap();
    trades::create(
        &mut conn,
        trade(&b, "ESZ6", "2026-10-19T14:00:00Z", "5000", "5001"),
    )
    .unwrap();
    let q = |ids: Vec<&str>| {
        insights::dataset_at(
            &conn,
            InsightsQuery {
                account_ids: ids.into_iter().map(String::from).collect(),
            },
            NOW,
        )
    };
    assert_eq!(kind(q(vec![]).unwrap_err()), "validation");
    assert_eq!(kind(q(vec![" "]).unwrap_err()), "validation");
    assert_eq!(kind(q(vec![&a, "missing"]).unwrap_err()), "notFound");
    let dup = q(vec![&a, &a]).unwrap();
    assert_eq!((dup.accounts.len(), dup.trades.len()), (1, 1));
    assert!(dup.trades.iter().all(|t| t.account_id == a));
    assert_eq!(dup.generated_at, NOW);
    assert_eq!(dup.contract_version, insights::CONTRACT_VERSION);
    // An open trade is returned with its status, never a P&L.
    let mut open = trade(&a, "ESZ6", "2026-10-20T14:00:00Z", "5000", "5001");
    open.exit_at = None;
    open.exit_price = None;
    trades::create(&mut conn, open).unwrap();
    let d = insights::dataset_at(
        &conn,
        InsightsQuery {
            account_ids: vec![a.clone()],
        },
        NOW,
    )
    .unwrap();
    let o = d.trades.iter().find(|t| t.exit_at.is_none()).unwrap();
    assert_eq!(
        (o.pnl_status.as_str(), o.realized_pnl.as_deref()),
        ("open", None)
    );
}

struct TempFile(PathBuf);
impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
    }
}

#[test]
fn a_restarted_file_journal_reads_the_same_dataset() {
    let dir = std::env::temp_dir().join(format!("ff-b23-{}", uuid::Uuid::now_v7()));
    let file = TempFile(dir.join("fundedflow.db"));
    let (ids, before) = {
        let mut conn = crate::db::open_file(&file.0).unwrap();
        let (a1, a2, a3) = chain(&mut conn);
        let ids = [a1, a2, a3];
        let before = read(&conn, &ids.iter().map(String::as_str).collect::<Vec<_>>());
        (ids, before)
    };
    let conn = crate::db::open_file(&file.0).unwrap();
    let after = read(&conn, &ids.iter().map(String::as_str).collect::<Vec<_>>());
    assert_eq!(before, after);
    assert_eq!(
        summarize(&metric_trades(&before)),
        summarize(&metric_trades(&after))
    );
}
