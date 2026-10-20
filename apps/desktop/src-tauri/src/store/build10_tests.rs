//! Build 10 repositories: settings, ledger, snapshots and the production
//! catalogue operations, plus migration 12 (snapshot → rulebook key).

use rusqlite::Connection;
use serde_json::json;

use super::catalogue::{self, AccountLinkInput, PhaseEventInput};
use super::ledger::{self, LedgerEntryInput};
use super::snapshots::{self, SnapshotInput};
use super::tests::{account_input, db};
use super::{accounts, settings};
use crate::catalogue::{AccountFieldSource, PhaseEventSource, PhaseKey};
use crate::db::{migrate_with, MIGRATIONS};
use crate::error::AppError;

fn one(conn: &Connection, sql: &str) -> String {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

// --- settings ---------------------------------------------------------------

#[test]
fn settings_round_trip_overwrite_and_validate() {
    let conn = db();
    assert!(settings::get(&conn, "ui.theme").unwrap().is_none());
    let a = settings::set(&conn, "ui.theme", &json!("dark")).unwrap();
    assert_eq!(a.value, json!("dark"));
    settings::set(&conn, "import.defaults", &json!({ "timezone": "America/New_York", "n": [1, 2] })).unwrap();
    let b = settings::set(&conn, "ui.theme", &json!("light")).unwrap();
    assert_eq!(b.value, json!("light"));
    let keys: Vec<String> = settings::list(&conn).unwrap().into_iter().map(|s| s.key).collect();
    assert_eq!(keys, ["import.defaults", "ui.theme"]);

    for bad in ["", "UI.theme", "1abc", "has space", &"a".repeat(65)] {
        assert!(matches!(settings::set(&conn, bad, &json!(1)), Err(AppError::Validation { .. })), "{bad:?}");
    }
    let big = json!("x".repeat(settings::MAX_VALUE_BYTES));
    assert!(matches!(settings::set(&conn, "big", &big), Err(AppError::Validation { .. })));
    assert!(settings::get(&conn, "big").unwrap().is_none(), "a rejected write stores nothing");

    settings::remove(&conn, "ui.theme").unwrap();
    settings::remove(&conn, "ui.theme").unwrap();
    assert!(settings::get(&conn, "ui.theme").unwrap().is_none());
}

// --- ledger -----------------------------------------------------------------

fn entry(account_id: &str, kind: &str, amount: &str) -> LedgerEntryInput {
    LedgerEntryInput {
        account_id: account_id.into(),
        kind: kind.into(),
        amount: amount.into(),
        affects_balance: None,
        effective_at: "2026-10-19T21:30:00Z".into(),
        note: Some("  note  ".into()),
    }
}

#[test]
fn ledger_entries_derive_their_trading_day_and_default_balance_effect_by_kind() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Funded")).unwrap();
    // 17:30 New York is after the 17:00 reset: the next trading day.
    let payout = ledger::create(&mut conn, entry(&a.id, "payout", "-1500.50")).unwrap();
    assert_eq!((payout.amount.as_str(), payout.trading_day.as_str(), payout.affects_balance), ("-1500.5", "2026-10-20", true));
    assert_eq!(payout.note.as_deref(), Some("note"));
    let fee = ledger::create(&mut conn, entry(&a.id, "evaluation_fee", "-165")).unwrap();
    assert!(!fee.affects_balance);
    let fix = ledger::create(&mut conn, entry(&a.id, "balance_correction", "250")).unwrap();
    assert!(fix.affects_balance);
    // Only balance-affecting entries adjust the balance; fees are kept for ROI but never counted here.
    assert_eq!(ledger::balance_adjustment(&conn, &a.id).unwrap(), "-1250.5");
    assert_eq!(ledger::list(&conn, &a.id).unwrap().len(), 3);
}

#[test]
fn ledger_rules_reject_contradictory_entries() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let fields = |conn: &mut Connection, input: LedgerEntryInput| match ledger::create(conn, input) {
        Err(AppError::Validation { issues, .. }) => issues.into_iter().map(|i| i.field).collect::<Vec<_>>(),
        other => panic!("expected validation error, got {other:?}"),
    };
    assert_eq!(fields(&mut conn, entry(&a.id, "payout", "100")), ["amount"], "a payout is negative");
    assert_eq!(fields(&mut conn, entry(&a.id, "reset_fee", "50")), ["amount"], "a fee is negative");
    assert_eq!(fields(&mut conn, entry(&a.id, "payout", "0")), ["amount"]);
    assert_eq!(fields(&mut conn, entry(&a.id, "payout", "abc")), ["amount"]);
    assert_eq!(fields(&mut conn, entry(&a.id, "other", "5")), ["affectsBalance"], "other must say explicitly");
    assert_eq!(fields(&mut conn, LedgerEntryInput { affects_balance: Some(true), ..entry(&a.id, "activation_fee", "-5") }), ["affectsBalance"]);
    assert_eq!(fields(&mut conn, LedgerEntryInput { affects_balance: Some(false), ..entry(&a.id, "payout", "-5") }), ["affectsBalance"]);
    assert_eq!(fields(&mut conn, entry(&a.id, "tip", "5")), ["kind"]);
    assert_eq!(fields(&mut conn, LedgerEntryInput { effective_at: "yesterday".into(), ..entry(&a.id, "payout", "-5") }), ["effectiveAt"]);
    assert!(ledger::list(&conn, &a.id).unwrap().is_empty(), "nothing was written");
}

#[test]
fn ledger_update_delete_and_archived_accounts() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("A")).unwrap();
    let b = accounts::create(&mut conn, account_input("B")).unwrap();
    let e = ledger::create(&mut conn, entry(&a.id, "payout", "-100")).unwrap();
    let moved = ledger::update(&mut conn, &e.id, entry(&b.id, "payout", "-100"));
    assert!(matches!(moved, Err(AppError::Validation { .. })), "an entry never changes account");
    let u = ledger::update(&mut conn, &e.id, entry(&a.id, "payout", "-250")).unwrap();
    assert_eq!(u.amount, "-250");
    assert_eq!(u.created_at, e.created_at);

    accounts::archive(&mut conn, &a.id).unwrap();
    assert_eq!(ledger::list(&conn, &a.id).unwrap().len(), 1, "archived accounts stay readable");
    assert!(matches!(ledger::create(&mut conn, entry(&a.id, "payout", "-1")), Err(AppError::NotFound { .. })));
    assert!(matches!(ledger::delete(&mut conn, &e.id), Err(AppError::NotFound { .. })));
    accounts::restore(&mut conn, &a.id).unwrap();

    ledger::delete(&mut conn, &e.id).unwrap();
    assert!(ledger::list(&conn, &a.id).unwrap().is_empty());
    assert_eq!(ledger::balance_adjustment(&conn, &a.id).unwrap(), "0");
    let kept: i64 = conn.query_row("SELECT COUNT(*) FROM account_ledger_entries WHERE deleted_at IS NOT NULL", [], |r| r.get(0)).unwrap();
    assert_eq!(kept, 1, "a soft delete keeps the row");
    assert!(matches!(ledger::delete(&mut conn, &e.id), Err(AppError::NotFound { .. })));
}

// --- snapshots and migration 12 ---------------------------------------------

fn snapshot(account_id: &str) -> SnapshotInput {
    SnapshotInput {
        account_id: account_id.into(),
        rulebook_version_id: None,
        trading_day: "2026-10-19".into(),
        is_end_of_day: true,
        data_as_of: Some("2026-10-19T20:55:00Z".into()),
        data_source: "csv_import".into(),
        engine_version: "test-1".into(),
        inputs_hash: "abc123".into(),
        fees_included: true,
        unrealized_included: false,
        balance: "50212.5".into(),
        realized_day_pnl: "212.5".into(),
        unrealized_pnl: None,
        daily_loss_limit: Some("1000".into()),
        daily_loss_remaining: Some("1212.5".into()),
        drawdown_mode: Some("eod_trailing".into()),
        high_water_mark: Some("50212.5".into()),
        drawdown_floor: Some("48212.5".into()),
        drawdown_headroom: Some("2000".into()),
        drawdown_locked: false,
        profit_target: Some("3000".into()),
        trading_days_completed: 1,
        trading_days_required: Some(5),
        status: "safe".into(),
        status_reasons: vec![],
        explanation: json!({ "inputs": { "trades": ["t1"] }, "steps": ["balance = start + pnl"] }),
    }
}

#[test]
fn snapshots_can_reference_a_reusable_rulebook_version_after_migration_12() {
    let mut conn = crate::db::catalogue_tests_seeded();
    let version = one(&conn, "SELECT id FROM rulebook_versions LIMIT 1");
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let saved = snapshots::save(&mut conn, SnapshotInput { rulebook_version_id: Some(version.clone()), ..snapshot(&a.id) }).unwrap();
    assert_eq!(saved.rulebook_version_id.as_deref(), Some(version.as_str()));
    let target = one(&conn, "SELECT \"table\" FROM pragma_foreign_key_list('account_snapshots') WHERE \"from\" = 'rulebook_version_id'");
    assert_eq!(target, "rulebook_versions");
    // A version with snapshots cannot be deleted out from under them.
    assert!(conn.execute("DELETE FROM rulebook_versions WHERE id = ?1", [&version]).is_err());
}

#[test]
fn migration_12_keeps_existing_snapshots_and_nulls_a_dangling_rulebook_reference() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate_with(&mut conn, &MIGRATIONS[..11]).unwrap();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let insert = |conn: &Connection, id: &str, version: Option<&str>| {
        conn.execute(
            "INSERT INTO account_snapshots (id, account_id, rulebook_version_id, trading_day, is_end_of_day, data_source,
                    calculated_at, engine_version, inputs_hash, balance_micros, realized_day_pnl_micros, status, explanation_json)
             VALUES (?1, ?2, ?3, '2026-10-19', 1, 'manual', '2026-10-19T21:00:00.000Z', 'v', ?1, 1, 0, 'unknown', '{}')",
            rusqlite::params![id, a.id, version],
        )
    };
    insert(&conn, "plain", None).unwrap();
    // At v11 the key still points at the legacy table; give it a legacy version and a snapshot using it.
    conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    insert(&conn, "dangling", Some("not-converted")).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();

    assert_eq!(migrate_with(&mut conn, MIGRATIONS).unwrap(), 12);
    let refs: Vec<(String, Option<String>)> = conn
        .prepare("SELECT id, rulebook_version_id FROM account_snapshots ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(refs, [("dangling".into(), None), ("plain".into(), None)]);
    let indexes: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('ix_snapshots_account_day', 'ux_snapshots_eod')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(indexes, 2);
}

#[test]
fn end_of_day_snapshots_are_idempotent_and_listed_newest_first() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let first = snapshots::save(&mut conn, snapshot(&a.id)).unwrap();
    let again = snapshots::save(&mut conn, snapshot(&a.id)).unwrap();
    assert_eq!(first.id, again.id, "same inputs, same end-of-day row");
    assert_eq!(first.balance, "50212.5");
    assert_eq!(first.explanation["steps"][0], "balance = start + pnl");
    // New inputs make a new row; intraday rows are never merged.
    let changed = snapshots::save(&mut conn, SnapshotInput { inputs_hash: "def".into(), ..snapshot(&a.id) }).unwrap();
    assert_ne!(changed.id, first.id);
    snapshots::save(&mut conn, SnapshotInput { is_end_of_day: false, ..snapshot(&a.id) }).unwrap();
    snapshots::save(&mut conn, SnapshotInput { is_end_of_day: false, ..snapshot(&a.id) }).unwrap();
    snapshots::save(&mut conn, SnapshotInput { trading_day: "2026-10-20".into(), inputs_hash: "next".into(), ..snapshot(&a.id) }).unwrap();

    let all = snapshots::list(&conn, &a.id, None, None, false).unwrap();
    assert_eq!(all.len(), 5);
    assert_eq!(all[0].trading_day, "2026-10-20");
    assert_eq!(snapshots::list(&conn, &a.id, None, None, true).unwrap().len(), 3);
    assert_eq!(snapshots::list(&conn, &a.id, Some("2026-10-20"), None, false).unwrap().len(), 1);
    assert_eq!(snapshots::latest(&conn, &a.id).unwrap().unwrap().trading_day, "2026-10-20");
    assert!(matches!(snapshots::list(&conn, &a.id, Some("soon"), None, false), Err(AppError::Validation { .. })));
}

#[test]
fn snapshots_validate_scope_and_never_invent_figures() {
    let mut conn = db();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();
    let fields = |conn: &mut Connection, input: SnapshotInput| match snapshots::save(conn, input) {
        Err(AppError::Validation { issues, .. }) => issues.into_iter().map(|i| i.field).collect::<Vec<_>>(),
        other => panic!("expected validation error, got {other:?}"),
    };
    let bad = SnapshotInput {
        trading_day: "2026-02-30".into(),
        data_source: "guess".into(),
        status: "fine".into(),
        drawdown_mode: Some("sideways".into()),
        engine_version: " ".into(),
        inputs_hash: "".into(),
        explanation: json!({}),
        balance: "lots".into(),
        data_as_of: Some("noon".into()),
        ..snapshot(&a.id)
    };
    assert_eq!(
        fields(&mut conn, bad),
        ["tradingDay", "dataSource", "status", "drawdownMode", "engineVersion", "inputsHash", "explanation", "dataAsOf", "balance"]
    );
    assert_eq!(
        fields(&mut conn, SnapshotInput { status: "unknown".into(), status_reasons: vec![], ..snapshot(&a.id) }),
        ["statusReasons"],
        "unknown must say why"
    );
    assert!(snapshots::list(&conn, &a.id, None, None, false).unwrap().is_empty());

    accounts::archive(&mut conn, &a.id).unwrap();
    assert!(matches!(snapshots::save(&mut conn, snapshot(&a.id)), Err(AppError::NotFound { .. })));
    assert!(snapshots::latest(&conn, &a.id).unwrap().is_none(), "archived accounts are readable");
    assert!(matches!(snapshots::latest(&conn, "nope"), Err(AppError::NotFound { .. })));
}

// --- catalogue operations ---------------------------------------------------

#[test]
fn the_catalogue_can_be_read_and_its_versions_reviewed() {
    let mut conn = crate::db::catalogue_tests_seeded();
    let snap = catalogue::load(&conn).unwrap();
    assert!(!snap.graph.providers.is_empty() && !snap.sources.is_empty());
    let draft = snap.graph.catalogue_versions.iter().find(|v| format!("{:?}", v.verification_status) == "Draft").cloned();
    let version = draft.unwrap_or_else(|| snap.graph.catalogue_versions[0].clone());
    let id = version.id.clone();
    conn.execute("UPDATE catalogue_versions SET verification_status = 'draft', verified_by = NULL, verified_at = NULL WHERE id = ?1", [&id])
        .ok();

    let status = |conn: &Connection| one(conn, &format!("SELECT verification_status FROM catalogue_versions WHERE id = '{id}'"));
    assert_eq!(status(&conn), "draft", "the fixture version starts as a draft");
    {
        catalogue::transition_version(&mut conn, &id, "needs_review", None).unwrap();
        // Verifying needs a named reviewer, and an illegal jump is refused by the schema.
        assert!(matches!(catalogue::transition_version(&mut conn, &id, "verified", None), Err(AppError::Validation { .. })));
        let v = catalogue::transition_version(&mut conn, &id, "verified", Some("  Kyle  ")).unwrap();
        assert_eq!(v.verified_by.as_deref(), Some("Kyle"));
        assert!(v.verified_at.is_some());
        assert!(matches!(catalogue::transition_version(&mut conn, &id, "draft", None), Err(AppError::Conflict { .. })));
        assert!(matches!(catalogue::transition_version(&mut conn, &id, "verified", Some("x")), Err(AppError::Validation { .. })));
        catalogue::transition_version(&mut conn, &id, "stale", None).unwrap();
        // A stale version re-verified keeps its original sign-off.
        let again = catalogue::transition_version(&mut conn, &id, "verified", Some("Someone else")).unwrap();
        assert_eq!(again.verified_by.as_deref(), Some("Kyle"));
    }
    assert!(matches!(catalogue::transition_version(&mut conn, "nope", "verified", Some("k")), Err(AppError::NotFound { .. })));
    assert!(matches!(catalogue::transition_version(&mut conn, &id, "published", None), Err(AppError::Validation { .. })));
}

#[test]
fn an_account_can_be_linked_to_a_programme_and_its_phase_history_is_append_only() {
    let mut conn = crate::db::catalogue_tests_seeded();
    let snap = catalogue::load(&conn).unwrap();
    let variant = &snap.graph.programme_variants[0];
    let version = snap.graph.catalogue_versions.iter().find(|v| v.programme_variant_id == variant.id).unwrap();
    let a = accounts::create(&mut conn, account_input("Eval")).unwrap();

    let link = catalogue::set_link(
        &mut conn,
        AccountLinkInput {
            account_id: a.id.clone(),
            programme_variant_id: Some(variant.id.clone()),
            catalogue_version_id: Some(version.id.clone()),
            selected_phase_path_id: None,
            size_source: AccountFieldSource::UserEntered,
        },
    )
    .unwrap();
    assert_eq!(link.provider_id.as_deref(), Some(variant.provider_id.as_str()), "the provider follows the variant");
    assert_eq!(link.catalogue_version_id.as_deref(), Some(version.id.as_str()));

    // A version without its variant, or from another variant, is refused and nothing changes.
    let orphan = catalogue::set_link(
        &mut conn,
        AccountLinkInput {
            account_id: a.id.clone(),
            programme_variant_id: None,
            catalogue_version_id: Some(version.id.clone()),
            selected_phase_path_id: None,
            size_source: AccountFieldSource::Unknown,
        },
    );
    assert!(matches!(orphan, Err(AppError::Validation { .. })));
    assert_eq!(catalogue::get_link(&conn, &a.id).unwrap().catalogue_version_id.as_deref(), Some(version.id.as_str()));

    let event = |note: &str, correction: Option<String>| PhaseEventInput {
        account_id: a.id.clone(),
        from_phase: None,
        to_phase: PhaseKey::Evaluation,
        provider_label: Some(" Phase 1 ".into()),
        occurred_at: Some("2026-10-01T14:00:00-04:00".into()),
        source: PhaseEventSource::UserEntered,
        note: Some(note.into()),
        correction_of_event_id: correction,
        catalogue_version_id: None,
        programme_phase_id: None,
        phase_path_id: None,
    };
    let first = catalogue::record_phase_event(&mut conn, event("started", None)).unwrap();
    assert_eq!((first.provider_label.as_deref(), first.occurred_at.as_deref()), (Some("Phase 1"), Some("2026-10-01T18:00:00.000Z")));
    let fix = catalogue::record_phase_event(&mut conn, event("fixed label", Some(first.id.clone()))).unwrap();
    assert_eq!(fix.correction_of_event_id.as_deref(), Some(first.id.as_str()));
    let events = catalogue::list_phase_events(&conn, &a.id).unwrap();
    assert_eq!(events.len(), 2, "the corrected event stays stored");
    assert!(conn.execute("UPDATE account_phase_events SET note = 'x'", []).is_err());
    let system = catalogue::record_phase_event(&mut conn, PhaseEventInput { source: PhaseEventSource::System, ..event("n", None) });
    assert!(matches!(system, Err(AppError::Validation { .. })));
    let foreign = catalogue::record_phase_event(&mut conn, event("n", Some("someone-elses".into())));
    assert!(foreign.is_err(), "a correction must name an event of the same account");
}
