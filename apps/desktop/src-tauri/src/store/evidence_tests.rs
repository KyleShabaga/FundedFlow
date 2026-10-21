use super::tests::{account_input, db, trade_input};
use super::{
    accounts,
    evidence::{self, CorrectionMetadata, ObservationCorrection, ObservationInput},
    ledger::{self, LedgerEntryInput},
    reconciliation::{self, Coverage, ReconciliationRequest},
    trades,
};
use crate::domain::micros_to_string;
use serde_json::{json, Value};
fn input(account: &str, kind: &str, value: Option<&str>, at: &str) -> ObservationInput {
    ObservationInput {
        account_id: account.into(),
        kind: kind.into(),
        value: value.map(str::to_string),
        currency: "USD".into(),
        basis: if ["equity", "intraday_peak"].contains(&kind) {
            "equity"
        } else {
            "balance"
        }
        .into(),
        observed_at: at.into(),
        source_category: "firm_dashboard".into(),
        source_reference: "synthetic dashboard".into(),
        confirmation: "user_confirmed".into(),
        confidence: "user_reported".into(),
        valid_until: Some("2026-11-01T00:00:00.000Z".into()),
        actor: "tester".into(),
        note: None,
    }
}
fn coverage() -> Coverage {
    Coverage {
        baseline: "available".into(),
        closed_trades: "available".into(),
        fees: "available".into(),
        ledger: "available".into(),
        open_positions: "missing".into(),
        eod_history: "missing".into(),
        intraday_history: "unsupported".into(),
        source_reference: "synthetic interval checked by user".into(),
    }
}
fn movement(account: &str, amount: &str) -> LedgerEntryInput {
    LedgerEntryInput {
        account_id: account.into(),
        kind: "payout".into(),
        amount: amount.into(),
        affects_balance: None,
        effective_at: "2026-10-19T20:00:00Z".into(),
        note: None,
    }
}
fn request(account: &str, baseline: &str, observation: &str) -> ReconciliationRequest {
    ReconciliationRequest {
        account_id: account.into(),
        baseline_observation_id: baseline.into(),
        observation_id: observation.into(),
        as_of: "2026-10-20T20:00:00.000Z".into(),
        evaluated_at: "2026-10-20T20:00:00.000Z".into(),
        coverage: coverage(),
    }
}

#[test]
fn observations_are_immutable_scoped_versioned_and_archived_readable() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("A")).unwrap();
    let b = accounts::create(&mut c, account_input("B")).unwrap();
    let original = evidence::create(
        &mut c,
        input(
            &a.id,
            "balance",
            Some("50000.000001"),
            "2026-10-19T20:00:00Z",
        ),
    )
    .unwrap();
    let json = serde_json::to_string(&original).unwrap();
    let decoded: evidence::Observation = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded.input.value, original.input.value);
    assert!(evidence::correct(
        &mut c,
        &original.id,
        ObservationCorrection {
            replacement: input(&b.id, "balance", Some("1"), "2026-10-19T20:00:00Z"),
            reason: "wrong attempt".into()
        }
    )
    .is_err());
    let corrected = evidence::correct(
        &mut c,
        &original.id,
        ObservationCorrection {
            replacement: input(&a.id, "balance", Some("50001"), "2026-10-19T20:00:00Z"),
            reason: "transcription".into(),
        },
    )
    .unwrap();
    assert_eq!(
        corrected.supersedes_id.as_deref(),
        Some(original.id.as_str())
    );
    assert!(evidence::correct(
        &mut c,
        &original.id,
        ObservationCorrection {
            replacement: original.input.clone(),
            reason: "fork".into()
        }
    )
    .is_err());
    assert_eq!(
        evidence::get(&c, &original.id).unwrap().input.value,
        Some("50000.000001".into())
    );
    assert!(c
        .execute("UPDATE financial_observations SET value_micros=0", [])
        .is_err());
    assert!(c.execute("DELETE FROM financial_observations", []).is_err());
    assert!(evidence::list(&c, &b.id).unwrap().is_empty());
    accounts::archive(&mut c, &a.id).unwrap();
    assert_eq!(evidence::list(&c, &a.id).unwrap().len(), 2);
    assert!(evidence::create(&mut c, original.input).is_err());
}
#[test]
fn ledger_legacy_and_explicit_corrections_replay_and_rollback() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("A")).unwrap();
    let e = ledger::create(&mut c, movement(&a.id, "-12.000001")).unwrap();
    ledger::update_with_metadata(
        &mut c,
        &e.id,
        movement(&a.id, "-13"),
        CorrectionMetadata {
            actor: "tester".into(),
            reason: "fee correction".into(),
        },
    )
    .unwrap();
    c.execute_batch("CREATE TEMP TRIGGER fail_revision BEFORE INSERT ON ledger_revisions BEGIN SELECT RAISE(ABORT,'simulated failure'); END;").unwrap();
    assert!(ledger::update(&mut c, &e.id, movement(&a.id, "-14")).is_err());
    assert!(ledger::delete(&mut c, &e.id).is_err());
    assert_eq!(ledger::get(&c, &e.id).unwrap().amount, "-13");
    assert_eq!(ledger::history(&c, &a.id).unwrap().len(), 2);
    c.execute_batch("DROP TRIGGER fail_revision").unwrap();
    ledger::delete(&mut c, &e.id).unwrap();
    let h = ledger::history(&c, &a.id).unwrap();
    assert_eq!(h.len(), 3);
    assert_eq!(h[0].entry, e);
    assert_eq!(h[1].reason, "fee correction");
    assert!(h[2].deleted);
    assert!(h[2].reason.contains("no reason supplied"));
    assert_eq!(h[2].supersedes_id.as_deref(), Some(h[1].id.as_str()));
    assert_eq!(ledger::balance_adjustment(&c, &a.id).unwrap(), "0");
    assert!(c
        .execute("UPDATE ledger_revisions SET actor='x'", [])
        .is_err());
}
#[test]
fn reconciliation_freezes_inputs_corrections_and_does_not_balance() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("A")).unwrap();
    let baseline = evidence::create(
        &mut c,
        input(
            &a.id,
            "opening_balance",
            Some("50000"),
            "2026-10-18T00:00:00Z",
        ),
    )
    .unwrap();
    let observation = evidence::create(
        &mut c,
        input(&a.id, "balance", Some("50198.38"), "2026-10-20T20:00:00Z"),
    )
    .unwrap();
    let t = trades::create(&mut c, trade_input(&a.id)).unwrap();
    assert_eq!(t.realized_pnl.as_deref(), Some("208.38"));
    let e = ledger::create(&mut c, movement(&a.id, "-10")).unwrap();
    let r = reconciliation::create(&mut c, request(&a.id, &baseline.id, &observation.id)).unwrap();
    assert_eq!(r.result.difference.as_deref(), Some("0"));
    ledger::update(&mut c, &e.id, movement(&a.id, "-11")).unwrap();
    let next =
        reconciliation::create(&mut c, request(&a.id, &baseline.id, &observation.id)).unwrap();
    assert_eq!(next.result.difference.as_deref(), Some("1"));
    let saved = reconciliation::list(&c, &a.id).unwrap();
    assert_eq!(saved[0].ledger[0].amount, "-10");
    assert_eq!(saved[0].trades[0], t);
    assert_eq!(ledger::list(&c, &a.id).unwrap().len(), 1);
    assert_eq!(accounts::get(&c, &a.id).unwrap().starting_balance, "50000");
    let resolution = reconciliation::resolve(
        &mut c,
        &r.id,
        reconciliation::ResolutionInput {
            actor: "tester".into(),
            reason: "review only".into(),
            status: "reviewed".into(),
        },
    )
    .unwrap();
    assert_eq!(
        reconciliation::resolutions(&c, &r.id).unwrap()[0].id,
        resolution.id
    );
    evidence::correct(
        &mut c,
        &observation.id,
        ObservationCorrection {
            replacement: observation.input.clone(),
            reason: "recaptured".into(),
        },
    )
    .unwrap();
    assert_eq!(
        reconciliation::create(&mut c, request(&a.id, &baseline.id, &observation.id))
            .unwrap()
            .result
            .reconciliation_status,
        "conflicting"
    );
    c.execute_batch("CREATE TEMP TRIGGER fail_reconciliation BEFORE INSERT ON financial_reconciliations BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;").unwrap();
    assert!(reconciliation::create(&mut c, request(&a.id, &baseline.id, &observation.id)).is_err());
    assert_eq!(reconciliation::list(&c, &a.id).unwrap().len(), 3);
}
#[test]
fn canonical_input_payload_preserves_unknowns_and_frozen_days_across_settings_changes() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("A")).unwrap();
    let o = evidence::create(&mut c, input(&a.id, "equity", None, "2026-10-23T21:30:00Z")).unwrap();
    assert_eq!(o.effective_trading_day, "2026-10-26");
    accounts::update(
        &mut c,
        &a.id,
        super::accounts::AccountInput {
            trading_day_reset_time: "00:00".into(),
            ..account_input("A")
        },
    )
    .unwrap();
    assert_eq!(
        evidence::get(&c, &o.id).unwrap().effective_trading_day,
        "2026-10-26"
    );
    let v = evidence::risk_inputs(
        &mut c,
        evidence::RiskInputsQuery {
            account_id: a.id.clone(),
            as_of: "2026-10-23T21:30:00Z".into(),
            coverage: coverage(),
        },
    )
    .unwrap();
    assert!(v["observations"][0]["value"].is_null());
    assert!(v["applicableRulebook"].is_null());
    assert_eq!(v["coverage"]["baseline"], "missing");
    assert_eq!(v["coverage"]["intradayHistory"], "unsupported");
    assert_eq!(v["effectiveTradingDay"], "2026-10-23");
}
#[test]
fn strict_observation_money_and_provenance_validation() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("A")).unwrap();
    for amount in [
        "0.0000001",
        "1.0",
        "+1",
        "9223372036854.775808",
        "NaN",
        "-0",
    ] {
        assert!(
            evidence::create(
                &mut c,
                input(&a.id, "balance", Some(amount), "2026-10-19T20:00:00Z")
            )
            .is_err(),
            "{amount}"
        );
    }
    for amount in [
        "0",
        "-0.000001",
        "9223372036854.775807",
        "-9223372036854.775808",
    ] {
        assert!(
            evidence::create(
                &mut c,
                input(&a.id, "balance", Some(amount), "2026-10-19T20:00:00Z")
            )
            .is_ok(),
            "{amount}"
        );
    }
    let mut bad = input(&a.id, "equity", Some("1"), "2026-10-19T20:00:00Z");
    bad.currency = "EUR".into();
    assert!(evidence::create(&mut c, bad).is_err());
    let mut bad = input(&a.id, "balance", Some("1"), "2026-10-19T20:00:00Z");
    bad.confirmation = "broker_verified".into();
    assert!(evidence::create(&mut c, bad).is_err());
}

#[test]
fn reconciliation_parity_fixture() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("parity")).unwrap();
    let mut baseline = evidence::create(
        &mut c,
        input(
            &a.id,
            "opening_balance",
            Some("50000"),
            "2026-10-18T00:00:00Z",
        ),
    )
    .unwrap();
    let mut observation = evidence::create(
        &mut c,
        input(&a.id, "balance", Some("50208.38"), "2026-10-20T20:00:00Z"),
    )
    .unwrap();
    baseline.id = "baseline".into();
    baseline.input.account_id = "attempt-a".into();
    baseline.recorded_at = "2026-10-20T20:00:00.000Z".into();
    observation.id = "observation".into();
    observation.input.account_id = "attempt-a".into();
    observation.recorded_at = baseline.recorded_at.clone();
    let mut trade = trades::create(&mut c, trade_input(&a.id)).unwrap();
    trade.id = "trade-1".into();
    trade.account_id = "attempt-a".into();
    trade.created_at = baseline.recorded_at.clone();
    trade.updated_at = baseline.recorded_at.clone();
    let base = json!({"name":"complete_net_pnl","request":request("attempt-a","baseline","observation"),"observation":observation,"baseline":baseline,"trades":[trade],"ledger":[],"superseded":[]});
    let mut cases = vec![base.clone()];
    for (name, path, value) in [
        ("fresh_empty", "/trades", json!([])),
        (
            "mid_challenge",
            "/request/coverage/closedTrades",
            json!("incomplete"),
        ),
        (
            "missing_baseline",
            "/request/coverage/baseline",
            json!("missing"),
        ),
        ("missing_fees", "/request/coverage/fees", json!("missing")),
        (
            "stale_balance",
            "/request/evaluatedAt",
            json!("2026-11-02T00:00:00.000Z"),
        ),
        ("unknown_freshness", "/observation/validUntil", Value::Null),
        ("equity_not_balance", "/observation/basis", json!("equity")),
        ("null_observation", "/observation/value", Value::Null),
        (
            "different_attempt",
            "/observation/accountId",
            json!("attempt-b"),
        ),
        ("currency_mismatch", "/baseline/currency", json!("EUR")),
        (
            "conflicting_coverage",
            "/request/coverage/ledger",
            json!("conflicting"),
        ),
        (
            "noncomparable_time",
            "/request/asOf",
            json!("2026-10-20T21:00:00.000Z"),
        ),
        (
            "unconfirmed",
            "/baseline/confirmation",
            json!("unconfirmed"),
        ),
        ("superseded", "/superseded", json!(["baseline"])),
        ("unknown_pnl", "/trades/0/realizedPnl", Value::Null),
        (
            "baseline_open_position",
            "/baseline/observedAt",
            json!("2026-10-19T14:00:00.000Z"),
        ),
        ("overflow", "/baseline/value", json!("9223372036854.775807")),
        ("negative_mismatch", "/observation/value", json!("-1")),
        (
            "stale_coverage",
            "/request/coverage/baseline",
            json!("stale"),
        ),
        (
            "evaluated_before_asof",
            "/request/evaluatedAt",
            json!("2026-10-19T00:00:00.000Z"),
        ),
    ] {
        let mut v = base.clone();
        v["name"] = json!(name);
        *v.pointer_mut(path).unwrap() = value;
        cases.push(v);
    }
    let mut payout = base.clone();
    payout["name"] = json!("payout_exact_micro");
    let mut e = ledger::create(&mut c, movement(&a.id, "-0.000001")).unwrap();
    e.id = "ledger-1".into();
    e.account_id = "attempt-a".into();
    e.created_at = baseline.recorded_at.clone();
    e.updated_at = baseline.recorded_at.clone();
    payout["ledger"] = json!([e]);
    payout["observation"]["value"] = json!("50208.379999");
    cases.push(payout);
    let mut fresh = base.clone();
    fresh["name"] = json!("fresh_complete_baseline");
    fresh["trades"] = json!([]);
    fresh["observation"]["value"] = json!("50000");
    cases.push(fresh);
    let mut costs = base.clone();
    costs["name"] = json!("programme_fee_does_not_change_bookkeeping_balance");
    let mut fee = ledger::create(&mut c, movement(&a.id, "-1")).unwrap();
    fee.id = "fee".into();
    fee.account_id = "attempt-a".into();
    fee.kind = "evaluation_fee".into();
    fee.affects_balance = false;
    fee.created_at = baseline.recorded_at.clone();
    fee.updated_at = baseline.recorded_at.clone();
    costs["ledger"] = json!([fee]);
    cases.push(costs);
    let mut reset = base.clone();
    reset["name"] = json!("ledger_reset_is_signed_movement_not_new_attempt");
    let mut e = ledger::create(&mut c, movement(&a.id, "-1")).unwrap();
    e.id = "reset".into();
    e.account_id = "attempt-a".into();
    e.kind = "reset".into();
    e.amount = "100".into();
    e.created_at = baseline.recorded_at.clone();
    e.updated_at = baseline.recorded_at.clone();
    reset["ledger"] = json!([e]);
    reset["observation"]["value"] = json!("50308.38");
    cases.push(reset);
    let mut uncertain = base.clone();
    uncertain["name"] = json!("unknown_confidence");
    uncertain["observation"]["confidence"] = json!("unknown");
    cases.push(uncertain);
    for case in &mut cases {
        let r = compare_case(case);
        case["expected"] = serde_json::to_value(r).unwrap();
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/domain/test/fixtures/reconciliation.json");
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some() {
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&cases).unwrap()),
        )
        .unwrap();
    }
    let stored: Value = serde_json::from_str(
        &std::fs::read_to_string(path)
            .expect("generate fixture deliberately with FUNDEDFLOW_UPDATE_FIXTURES=1"),
    )
    .unwrap();
    assert_eq!(stored, json!(cases));
}
fn compare_case(v: &Value) -> reconciliation::Comparison {
    reconciliation::compare(
        &serde_json::from_value(v["request"].clone()).unwrap(),
        &serde_json::from_value(v["observation"].clone()).unwrap(),
        &serde_json::from_value(v["baseline"].clone()).unwrap(),
        &serde_json::from_value::<Vec<super::trades::Trade>>(v["trades"].clone()).unwrap(),
        &serde_json::from_value::<Vec<ledger::LedgerEntry>>(v["ledger"].clone()).unwrap(),
        &serde_json::from_value::<Vec<String>>(v["superseded"].clone()).unwrap(),
        &[],
    )
    .unwrap()
}

#[test]
fn populated_v13_upgrade_freezes_legacy_signed_amounts_and_preserves_rows() {
    let mut c = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrate_with(&mut c, &crate::db::MIGRATIONS[..13]).unwrap();
    let a = accounts::create(&mut c, account_input("legacy")).unwrap();
    for (i, m) in [-1_i64, i64::MIN, -1000001, 0, 1, i64::MAX]
        .iter()
        .enumerate()
    {
        c.execute("INSERT INTO account_ledger_entries(id,account_id,kind,amount_micros,affects_balance,effective_at,trading_day,created_at,updated_at) VALUES(?1,?2,'balance_correction',?3,1,'2026-10-19T20:00:00.000Z','2026-10-19','2026-10-19T20:00:00.000Z','2026-10-19T20:00:00.000Z')",rusqlite::params![format!("legacy-{i}"),a.id,m]).unwrap();
    }
    crate::db::migrate(&mut c).unwrap();
    let h = ledger::history(&c, &a.id).unwrap();
    assert_eq!(h.len(), 6);
    for (i, m) in [-1_i64, i64::MIN, -1000001, 0, 1, i64::MAX]
        .iter()
        .enumerate()
    {
        let entry = h
            .iter()
            .find(|r| r.entry_id == format!("legacy-{i}"))
            .unwrap();
        assert_eq!(entry.entry.amount, micros_to_string(*m));
        assert_eq!(entry.operation, "baseline");
    }
    crate::db::migrate(&mut c).unwrap();
    assert_eq!(ledger::history(&c, &a.id).unwrap().len(), 6);
}
#[test]
fn failed_v14_migration_rolls_back_new_tables_and_version() {
    let mut c = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrate_with(&mut c, &crate::db::MIGRATIONS[..13]).unwrap();
    let a = accounts::create(&mut c, account_input("keep")).unwrap();
    c.execute_batch("CREATE TABLE financial_reconciliations(blocker INTEGER);")
        .unwrap();
    assert!(crate::db::migrate(&mut c).is_err());
    let version: u32 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 13);
    assert!(c.prepare("SELECT * FROM financial_observations").is_err());
    assert_eq!(accounts::get(&c, &a.id).unwrap(), a);
    c.execute_batch("DROP TABLE financial_reconciliations")
        .unwrap();
    crate::db::migrate(&mut c).unwrap();
}
#[test]
fn observation_correction_failure_preserves_original_and_history() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("A")).unwrap();
    let o = evidence::create(
        &mut c,
        input(&a.id, "balance", None, "2026-10-19T20:00:00Z"),
    )
    .unwrap();
    c.execute_batch("CREATE TEMP TRIGGER fail_observation BEFORE INSERT ON financial_observations BEGIN SELECT RAISE(ABORT,'simulated failure'); END;").unwrap();
    assert!(evidence::correct(
        &mut c,
        &o.id,
        ObservationCorrection {
            replacement: o.input.clone(),
            reason: "correct".into()
        }
    )
    .is_err());
    assert_eq!(evidence::list(&c, &a.id).unwrap().len(), 1);
}
#[test]
fn evidence_trading_days_use_existing_weekend_and_dst_policy() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("DST")).unwrap();
    for (at, day) in [
        ("2026-03-08T06:30:00Z", "2026-03-09"),
        ("2026-03-08T07:30:00Z", "2026-03-09"),
        ("2026-11-01T05:30:00Z", "2026-11-02"),
        ("2026-11-01T06:30:00Z", "2026-11-02"),
        ("2026-10-23T20:59:59Z", "2026-10-23"),
        ("2026-10-23T21:00:00Z", "2026-10-26"),
    ] {
        let mut i = input(&a.id, "eod_settlement", Some("0"), at);
        i.valid_until = None;
        assert_eq!(
            evidence::create(&mut c, i).unwrap().effective_trading_day,
            day
        );
    }
}

#[test]
fn reset_attempt_does_not_copy_evidence_even_with_reused_broker_reference() {
    use super::attempts::{self, ResetInput, RulebookDecision};
    let mut c = db();
    let a = accounts::create(
        &mut c,
        super::accounts::AccountInput {
            external_ref: Some("same-broker-id".into()),
            ..account_input("Attempt 1")
        },
    )
    .unwrap();
    let o = evidence::create(
        &mut c,
        input(&a.id, "balance", Some("1"), "2026-10-19T20:00:00Z"),
    )
    .unwrap();
    ledger::create(&mut c, movement(&a.id, "-1")).unwrap();
    let reset = attempts::reset(
        &mut c,
        ResetInput {
            predecessor_account_id: a.id.clone(),
            prior_outcome: "failed".into(),
            effective_at: "2026-10-20T20:00:00Z".into(),
            reason: Some("new attempt".into()),
            source: "user_entered".into(),
            name: "Attempt 2".into(),
            external_ref: Some("same-broker-id".into()),
            starting_balance: "50000".into(),
            catalogue: None,
            rulebook: RulebookDecision::DecideLater,
            notes: None,
        },
    )
    .unwrap();
    assert_ne!(reset.successor.id, a.id);
    assert_eq!(reset.successor.external_ref, a.external_ref);
    assert!(evidence::list(&c, &reset.successor.id).unwrap().is_empty());
    assert!(ledger::history(&c, &reset.successor.id).unwrap().is_empty());
    assert_eq!(evidence::get(&c, &o.id).unwrap().input.account_id, a.id);
    assert!(reconciliation::create(&mut c, request(&reset.successor.id, &o.id, &o.id)).is_err());
}
#[test]
fn populated_older_journals_keep_source_rows_backups_and_reopen() {
    for version in [3, 8, 10] {
        let dir = std::env::temp_dir().join(format!(
            "fundedflow-evidence-upgrade-{}",
            crate::domain::new_id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fundedflow.db");
        std::fs::write(&path, include_bytes!("../db/fixtures/fundedflow-v3.db")).unwrap();
        let mut old = rusqlite::Connection::open(&path).unwrap();
        crate::db::migrate_with(&mut old, &crate::db::MIGRATIONS[..version]).unwrap();
        let source = |c: &rusqlite::Connection| {
            let mut s = c
                .prepare("SELECT id,raw_json FROM import_rows ORDER BY id")
                .unwrap();
            s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        let before = source(&old);
        drop(old);
        let upgraded = crate::db::open_file(&path).unwrap();
        assert_eq!(source(&upgraded), before);
        assert_eq!(
            upgraded
                .query_row("SELECT count(*) FROM financial_observations", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let backup = rusqlite::Connection::open(crate::db::backup_path(&path)).unwrap();
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            version as u32
        );
        drop(backup);
        drop(upgraded);
        let reopened = crate::db::open_file(&path).unwrap();
        assert_eq!(source(&reopened), before);
        drop(reopened);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
#[test]
fn csv_provenance_remains_in_frozen_reconciliation_and_fee_corrections_create_new_results() {
    use crate::csv_import::{self, CsvImportRequest, DateFormatChoice, FormatChoice};
    let mut c = db();
    let a = accounts::create(&mut c, account_input("CSV")).unwrap();
    let baseline = evidence::create(
        &mut c,
        input(
            &a.id,
            "opening_balance",
            Some("50000"),
            "2026-10-18T00:00:00Z",
        ),
    )
    .unwrap();
    let o = evidence::create(
        &mut c,
        input(&a.id, "balance", Some("50026"), "2026-10-20T20:00:00Z"),
    )
    .unwrap();
    let import=CsvImportRequest { account_id:a.id.clone(),file_name:"performance.csv".into(),content:"symbol,qty,buyPrice,sellPrice,boughtTimestamp,soldTimestamp,pnl,buyFillId,sellFillId\nMNQZ6,1,29774.25,29787.25,2026-10-19T11:47:48Z,2026-10-19T11:48:21Z,26,buy-1,sell-1\n".into(),format:FormatChoice::Auto,columns:None,target_acknowledgement:None,date_format:DateFormatChoice::Auto,timezone:"America/New_York".into() };
    let batch = csv_import::commit_reviewed(&mut c, &import).unwrap();
    let mut req = request(&a.id, &baseline.id, &o.id);
    req.coverage.fees = "missing".into();
    let missing = reconciliation::create(&mut c, req.clone()).unwrap();
    assert_eq!(missing.result.reconciliation_status, "incomplete");
    req.coverage.fees = "available".into();
    let first = reconciliation::create(&mut c, req.clone()).unwrap();
    assert_eq!(first.result.difference.as_deref(), Some("0"));
    assert_eq!(
        first.trades[0].import_batch_id.as_deref(),
        Some(batch.id.as_str())
    );
    assert_eq!(
        first.trades[0]
            .round_trip
            .as_ref()
            .unwrap()
            .buy_fill_id
            .as_deref(),
        Some("buy-1")
    );
    let t = &first.trades[0];
    trades::update(
        &mut c,
        &t.id,
        super::trades::TradeInput {
            account_id: a.id.clone(),
            symbol: t.symbol.clone(),
            side: t.side.clone(),
            quantity: t.quantity.clone(),
            entry_at: t.entry_at.clone(),
            entry_price: t.entry_price.clone(),
            exit_at: t.exit_at.clone(),
            exit_price: t.exit_price.clone(),
            fees: Some("1".into()),
            realized_pnl: None,
            notes: None,
        },
    )
    .unwrap();
    let second = reconciliation::create(&mut c, req).unwrap();
    assert_eq!(second.result.difference.as_deref(), Some("1"));
    assert_eq!(
        reconciliation::list(&c, &a.id).unwrap()[1].trades[0].fees,
        "0"
    );
}

/// Real native wire outputs consumed through the desktop adapter, not handwritten mocks.
#[test]
fn evidence_command_wire_fixture() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("Wire")).unwrap();
    let initial = input(
        &a.id,
        "opening_balance",
        Some("50000"),
        "2026-10-18T00:00:00Z",
    );
    let baseline = evidence::create(&mut c, initial.clone()).unwrap();
    let correction = ObservationCorrection {
        replacement: input(&a.id, "balance", Some("50001"), "2026-10-20T20:00:00Z"),
        reason: "corrected dashboard".into(),
    };
    let o = evidence::create(
        &mut c,
        input(&a.id, "balance", Some("50000"), "2026-10-20T20:00:00Z"),
    )
    .unwrap();
    let corrected = evidence::correct(&mut c, &o.id, correction.clone()).unwrap();
    let e = ledger::create(&mut c, movement(&a.id, "-1")).unwrap();
    let metadata = CorrectionMetadata {
        actor: "tester".into(),
        reason: "correct amount".into(),
    };
    let corrected_ledger =
        ledger::update_with_metadata(&mut c, &e.id, movement(&a.id, "-2"), metadata.clone())
            .unwrap();
    let query = evidence::RiskInputsQuery {
        account_id: a.id.clone(),
        as_of: "2026-10-20T20:00:00Z".into(),
        coverage: coverage(),
    };
    let inputs = evidence::risk_inputs(&mut c, query).unwrap();
    let req = request(&a.id, &baseline.id, &corrected.id);
    let r = reconciliation::create(&mut c, req.clone()).unwrap();
    let resolution = reconciliation::ResolutionInput {
        actor: "tester".into(),
        reason: "needs review".into(),
        status: "unresolved".into(),
    };
    let resolved = reconciliation::resolve(&mut c, &r.id, resolution.clone()).unwrap();
    let mut payloads = json!([
        {"command":"create_financial_observation","args":{"input":initial},"output":baseline},
        {"command":"get_financial_observation","args":{"id":o.id},"output":evidence::get(&c,&o.id).unwrap()},
        {"command":"list_financial_observations","args":{"accountId":a.id},"output":evidence::list(&c,&a.id).unwrap()},
        {"command":"correct_financial_observation","args":{"id":o.id,"input":correction},"output":corrected},
        {"command":"get_ledger_history","args":{"accountId":a.id},"output":ledger::history(&c,&a.id).unwrap()},
        {"command":"correct_ledger_entry","args":{"id":e.id,"input":movement(&a.id,"-2"),"metadata":metadata},"output":corrected_ledger},
        {"command":"get_account_risk_inputs","args":{"query":{"accountId":a.id,"asOf":"2026-10-20T20:00:00Z","coverage":coverage()}},"output":inputs},
        {"command":"reconcile_financial_balance","args":{"request":req},"output":r},
        {"command":"list_financial_reconciliations","args":{"accountId":a.id},"output":reconciliation::list(&c,&a.id).unwrap()},
        {"command":"resolve_financial_reconciliation","args":{"id":r.id,"input":resolution},"output":resolved},
        {"command":"list_reconciliation_resolutions","args":{"id":r.id},"output":reconciliation::resolutions(&c,&r.id).unwrap()}
    ]);
    ledger::delete_with_metadata(&mut c, &e.id, metadata.clone()).unwrap();
    payloads.as_array_mut().unwrap().push(json!({"command":"remove_ledger_entry_with_reason","args":{"id":e.id,"metadata":metadata},"output":null}));
    let mut ids = std::collections::BTreeMap::new();
    normalize_wire(&mut payloads, None, &mut ids);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/evidence-wire.json");
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some() {
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&payloads).unwrap()),
        )
        .unwrap();
    }
    let stored: Value = serde_json::from_str(
        &std::fs::read_to_string(path).expect("generate deliberate evidence wire fixture"),
    )
    .unwrap();
    assert_eq!(stored, payloads);
}
fn normalize_wire(
    v: &mut Value,
    key: Option<&str>,
    ids: &mut std::collections::BTreeMap<String, String>,
) {
    match v {
        Value::Object(o) => {
            for (key, value) in o {
                normalize_wire(value, Some(key), ids);
            }
        }
        Value::Array(a) => {
            for value in a {
                normalize_wire(value, None, ids);
            }
        }
        Value::String(s) => {
            if matches!(key, Some("recordedAt" | "createdAt" | "updatedAt")) {
                *s = "2026-10-21T00:00:00.000Z".into();
            } else if uuid::Uuid::parse_str(s).is_ok() {
                let n = ids.len() + 1;
                *s = ids
                    .entry(s.clone())
                    .or_insert_with(|| format!("00000000-0000-4000-8000-{n:012}"))
                    .clone();
            }
        }
        _ => (),
    }
}

#[test]
fn phase_transition_preserves_observations_and_canonical_phase_identity() {
    use super::catalogue::{self, PhaseEventInput};
    use crate::catalogue::{PhaseEventSource, PhaseKey};
    let mut c = db();
    let a = accounts::create(&mut c, account_input("Phase")).unwrap();
    let o = evidence::create(
        &mut c,
        input(&a.id, "balance", Some("50000"), "2026-10-19T20:00:00Z"),
    )
    .unwrap();
    let event = catalogue::record_phase_event(
        &mut c,
        PhaseEventInput {
            account_id: a.id.clone(),
            from_phase: Some(PhaseKey::Evaluation),
            to_phase: PhaseKey::SimulatedFunded,
            provider_label: None,
            occurred_at: Some("2026-10-20T00:00:00Z".into()),
            source: PhaseEventSource::UserEntered,
            note: Some("manual phase transition".into()),
            correction_of_event_id: None,
            catalogue_version_id: None,
            programme_phase_id: None,
            phase_path_id: None,
        },
    )
    .unwrap();
    let inputs = evidence::risk_inputs(
        &mut c,
        evidence::RiskInputsQuery {
            account_id: a.id.clone(),
            as_of: "2026-10-20T20:00:00Z".into(),
            coverage: coverage(),
        },
    )
    .unwrap();
    assert_eq!(inputs["phaseHistory"][0]["id"], event.id);
    assert_eq!(inputs["observations"][0]["id"], o.id);
    assert!(inputs["catalogueLink"]["selectedPhasePathId"].is_null());
    assert!(inputs["applicableAssignment"].is_null());
}

#[test]
fn native_conflicting_sources_currency_edits_and_archived_reconciliation_remain_unavailable() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("Scope")).unwrap();
    let b = evidence::create(
        &mut c,
        input(
            &a.id,
            "opening_balance",
            Some("50000"),
            "2026-10-18T00:00:00Z",
        ),
    )
    .unwrap();
    let o = evidence::create(
        &mut c,
        input(&a.id, "balance", Some("50000"), "2026-10-20T20:00:00Z"),
    )
    .unwrap();
    let req = request(&a.id, &b.id, &o.id);
    assert_eq!(
        reconciliation::create(&mut c, req.clone())
            .unwrap()
            .result
            .reconciliation_status,
        "matched"
    );
    evidence::create(
        &mut c,
        input(&a.id, "balance", Some("50001"), "2026-10-20T20:00:00Z"),
    )
    .unwrap();
    let result = reconciliation::create(&mut c, req.clone()).unwrap().result;
    assert_eq!(result.reason_code, "conflicting_source_records");
    assert!(result.difference.is_none());
    accounts::update(
        &mut c,
        &a.id,
        super::accounts::AccountInput {
            currency: "EUR".into(),
            ..account_input("Scope")
        },
    )
    .unwrap();
    let result = reconciliation::create(&mut c, req.clone()).unwrap().result;
    assert_eq!(result.reason_code, "currency_mismatch");
    assert!(result.difference.is_none());
    accounts::archive(&mut c, &a.id).unwrap();
    assert!(reconciliation::create(&mut c, req).is_err());
    assert_eq!(reconciliation::list(&c, &a.id).unwrap().len(), 3);
}

#[test]
fn eod_and_peak_evidence_preserve_explicit_financial_basis() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("Basis")).unwrap();
    let mut eod = input(
        &a.id,
        "eod_settlement",
        Some("50000"),
        "2026-10-19T20:00:00Z",
    );
    eod.basis = "equity".into();
    let mut peak = input(
        &a.id,
        "intraday_peak",
        Some("50100"),
        "2026-10-19T20:00:00Z",
    );
    peak.basis = "balance".into();
    assert_eq!(evidence::create(&mut c, eod).unwrap().input.basis, "equity");
    assert_eq!(
        evidence::create(&mut c, peak).unwrap().input.basis,
        "balance"
    );
}

#[test]
fn corrected_unavailable_eod_does_not_promote_original_to_available_history() {
    let mut c = db();
    let a = accounts::create(&mut c, account_input("EOD correction")).unwrap();
    let old = evidence::create(
        &mut c,
        input(
            &a.id,
            "eod_settlement",
            Some("50000"),
            "2026-10-19T20:00:00Z",
        ),
    )
    .unwrap();
    let mut replacement = old.input.clone();
    replacement.value = None;
    evidence::correct(
        &mut c,
        &old.id,
        ObservationCorrection {
            replacement,
            reason: "Statement value could not be verified".into(),
        },
    )
    .unwrap();
    let mut cov = coverage();
    cov.eod_history = "available".into();
    let result = evidence::risk_inputs(
        &mut c,
        evidence::RiskInputsQuery {
            account_id: a.id,
            as_of: "2026-10-20T20:00:00Z".into(),
            coverage: cov,
        },
    )
    .unwrap();
    assert_eq!(result["coverage"]["eodHistory"], "missing");
    assert_eq!(result["observations"].as_array().unwrap().len(), 2);
}
