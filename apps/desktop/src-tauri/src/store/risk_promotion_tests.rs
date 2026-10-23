//! P0-02 native regressions: coherent capture, atomic compare-and-promote, the mutation matrix, ordering,
//! history, isolation, rollback and compatibility. File-backed journals with two real connections where a race
//! matters; controlled hooks instead of sleeps. All data is synthetic.
use std::path::PathBuf;

use rusqlite::{Connection, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::evidence::{self, ObservationCorrection, ObservationInput, RiskInputsQuery};
use super::ledger::{self, LedgerEntryInput};
use super::reconciliation::{self, Coverage, ReconciliationRequest, ResolutionInput};
use super::risk_promotion::{self, BEFORE_PROMOTION_COMMIT, MID_CAPTURE, RiskCapture};
use super::snapshots::{self, SnapshotInput, canonical_engine_json};
use super::tests::{account_input, db, trade_input};
use super::{accounts, catalogue, rulebooks, trades};
use crate::catalogue::{AccountFieldSource, PhaseEventSource, PhaseKey};
use crate::data_controls;
use crate::error::AppError;
use crate::rulebook::{AssignmentInput, SourceConflictInput};

const AT: &str = "2026-10-01T00:00:00.000Z";
const VERSION: &str = "00000000-0000-4000-8000-0000000000a1";
const RULE: &str = "00000000-0000-4000-8000-0000000000b1";
const CUTOFF: &str = "2026-10-20T20:00:00.000Z";
const PROVIDER: &str = "00000000-0000-4000-8000-0000000000c1";
const BOOK: &str = "00000000-0000-4000-8000-0000000000c2";
const SOURCE: &str = "00000000-0000-4000-8000-0000000000c3";

struct JournalFile(PathBuf);
impl JournalFile {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("fundedflow-p002-{}", uuid::Uuid::now_v7())))
    }
    fn open(&self) -> Connection {
        crate::db::open_file(&self.0.join(crate::db::DB_FILE_NAME)).unwrap()
    }
}
impl Drop for JournalFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A verified catalogue rulebook version with one rule and one source, shared by every account assigned to it.
fn seed_catalogue(c: &Connection) {
    c.execute("INSERT INTO providers(id,slug,display_name,record_status,created_at,updated_at) VALUES(?1,'synthetic','Synthetic','active',?2,?2)", params![PROVIDER, AT]).unwrap();
    c.execute("INSERT INTO rulebooks(id,provider_id,slug,display_name,record_status,created_at,updated_at) VALUES(?1,?2,'synthetic','Synthetic','active',?3,?3)", params![BOOK, PROVIDER, AT]).unwrap();
    c.execute("INSERT INTO rulebook_versions(id,rulebook_id,version_number,schema_version,verification_status,origin,captured_at,verified_by,verified_at,record_status,created_at,updated_at) VALUES(?1,?2,1,1,'draft','catalogue',?3,NULL,NULL,'active',?3,?3)", params![VERSION, BOOK, AT]).unwrap();
    c.execute("INSERT INTO rule_definitions(id,rulebook_version_id,rule_key,rule_type,parameter_schema_version,parameters_json,support_status,display_order,created_at,updated_at) VALUES(?1,?2,'daily_loss','daily_loss_limit',1,?4,'supported',0,?3,?3)", params![RULE, VERSION, AT,
        r#"{"limit":{"state":"value","value":"1000"},"basis":"realized","resetBasis":"account_trading_day","breach":"hard","condition":"always"}"#]).unwrap();
    c.execute(
        "UPDATE rulebook_versions SET verification_status='needs_review' WHERE id=?1",
        [VERSION],
    )
    .unwrap();
    c.execute("UPDATE rulebook_versions SET verification_status='verified', verified_by='synthetic reviewer', verified_at=?2 WHERE id=?1", params![VERSION, AT]).unwrap();
    c.execute("INSERT INTO catalogue_sources(id,source_type,descriptor,captured_at,verification_status) VALUES(?1,'official','Synthetic terms page',?2,'draft')", params![SOURCE, AT]).unwrap();
}

fn observation(account: &str, kind: &str, value: &str, at: &str) -> ObservationInput {
    ObservationInput {
        account_id: account.into(),
        kind: kind.into(),
        value: Some(value.into()),
        currency: "USD".into(),
        basis: "balance".into(),
        observed_at: at.into(),
        source_category: "firm_dashboard".into(),
        source_reference: "synthetic dashboard".into(),
        confirmation: "user_confirmed".into(),
        confidence: "user_reported".into(),
        valid_until: None,
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
        open_positions: "unsupported".into(),
        eod_history: "available".into(),
        intraday_history: "unsupported".into(),
        source_reference: "synthetic statement".into(),
    }
}

fn query(account: &str, as_of: &str) -> RiskInputsQuery {
    RiskInputsQuery {
        account_id: account.into(),
        as_of: as_of.into(),
        coverage: coverage(),
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

/// Ids of the records each mutation family changes.
struct Ctx {
    account: String,
    other: String,
    trade: String,
    opening: String,
    balance: String,
    ledger: String,
    review: String,
}

/// Two accounts on the shared catalogue version; account A also has a trade, checkpoints, a ledger movement and a
/// reconciliation review, so every family has something to change.
fn seeded(c: &mut Connection) -> Ctx {
    seed_catalogue(c);
    let account = accounts::create(c, account_input("Eval A")).unwrap().id;
    let other = accounts::create(c, account_input("Eval B")).unwrap().id;
    for id in [&account, &other] {
        rulebooks::assign(
            c,
            AssignmentInput {
                account_id: id.clone(),
                rulebook_version_id: VERSION.into(),
                effective_from: "2026-10-19".into(),
                programme_phase_id: None,
                phase_path_id: None,
                account_phase_event_id: None,
            },
        )
        .unwrap();
    }
    let trade = trades::create(c, trade_input(&account)).unwrap().id;
    let opening = evidence::create(
        c,
        observation(
            &account,
            "opening_balance",
            "50000",
            "2026-10-19T12:00:00.000Z",
        ),
    )
    .unwrap()
    .id;
    let balance = evidence::create(
        c,
        observation(&account, "balance", "50100", "2026-10-20T19:00:00.000Z"),
    )
    .unwrap()
    .id;
    let ledger = ledger::create(c, movement(&account, "-25")).unwrap().id;
    let review = reconciliation::create(
        c,
        ReconciliationRequest {
            account_id: account.clone(),
            observation_id: balance.clone(),
            baseline_observation_id: opening.clone(),
            as_of: "2026-10-20T19:30:00.000Z".into(),
            evaluated_at: "2026-10-20T19:30:00.000Z".into(),
            coverage: coverage(),
        },
    )
    .unwrap()
    .id;
    Ctx {
        account,
        other,
        trade,
        opening,
        balance,
        ledger,
        review,
    }
}

fn capture(c: &mut Connection, account: &str, as_of: &str) -> RiskCapture {
    risk_promotion::capture(c, query(account, as_of)).unwrap()
}

/// What the TypeScript engine would hand to native: a calculation of exactly this capture (an Unknown result, or
/// a Stop that records a breach of the assigned rule), with the same frozen identity and hash rules.
fn calc(cap: &RiskCapture, breach: bool) -> SnapshotInput {
    let inputs = cap.inputs.clone();
    let policy = json!({ "ruleCurrency": null, "ruleCurrencySourceClaimIds": [], "boundary": null, "boundarySourceClaimIds": [],
        "reconciliationRevisionIds": cap.reconciliation_revision_ids, "personalCautionHeadroom": null, "priorBreaches": cap.prior_breaches });
    let engine_version = "fundedflow-risk/1";
    let hash = format!(
        "{:x}",
        Sha256::digest(
            canonical_engine_json(
                &json!({"engineVersion": engine_version, "input": inputs, "policy": policy})
            )
            .as_bytes()
        )
    );
    let assignment = &inputs["applicableAssignment"];
    let version = assignment["rulebookVersionId"].as_str().map(str::to_string);
    let rules = if breach {
        json!([{ "ruleId": RULE, "ruleKey": "daily_loss", "ruleType": "daily_loss_limit", "state": "breached", "reasonCode": "limit_reached",
            "metrics": {}, "formula": "", "operands": {}, "sourceReferences": [SOURCE], "missingInputs": [], "evidence": [], "assumptions": [] }])
    } else {
        json!([])
    };
    let status = if breach { "Stop" } else { "Unknown" };
    let engine = json!({ "accountId": inputs["account"]["id"], "rulebookVersionId": version, "assignmentId": assignment["id"],
        "programmePhaseId": null, "phasePathId": null, "engineVersion": engine_version, "tradingDay": inputs["effectiveTradingDay"],
        "asOf": inputs["asOf"], "dataAsOf": null, "inputsHash": hash, "status": status, "balance": null, "realizedDayPnl": null,
        "tradingDaysCompleted": null, "rules": rules });
    serde_json::from_value(json!({
        "accountId": inputs["account"]["id"], "rulebookVersionId": version, "tradingDay": inputs["effectiveTradingDay"], "isEndOfDay": false,
        "dataAsOf": null, "dataSource": "manual", "engineVersion": engine_version, "inputsHash": hash, "feesIncluded": true,
        "unrealizedIncluded": false, "balance": null, "realizedDayPnl": null, "unrealizedPnl": null, "dailyLossLimit": null,
        "dailyLossRemaining": null, "drawdownMode": null, "highWaterMark": null, "drawdownFloor": null, "drawdownHeadroom": null,
        "drawdownLocked": null, "profitTarget": null, "tradingDaysCompleted": null, "tradingDaysRequired": null,
        "status": status.to_ascii_lowercase(), "statusReasons": ["synthetic"],
        "explanation": { "engine": engine, "inputs": inputs, "policy": policy },
    }))
    .unwrap()
}

/// Capture now and promote that calculation.
fn promote_now(
    c: &mut Connection,
    account: &str,
    as_of: &str,
    breach: bool,
) -> Result<snapshots::Snapshot, AppError> {
    let cap = capture(c, account, as_of);
    risk_promotion::promote(c, calc(&cap, breach))
}

fn count(c: &Connection, table: &str) -> i64 {
    c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn is_conflict(r: Result<snapshots::Snapshot, AppError>) -> bool {
    matches!(r, Err(AppError::Conflict { .. }))
}

fn unchanged(c: &mut Connection, account: &str) -> Option<bool> {
    risk_promotion::current(c, account)
        .unwrap()
        .sources_unchanged
}

#[test]
fn unchanged_sources_promote_and_the_result_stays_current_after_reopen() {
    let file = JournalFile::new();
    let (account, id);
    {
        let mut c = file.open();
        account = seeded(&mut c).account;
        let cap = capture(&mut c, &account, CUTOFF);
        assert_eq!(cap.source_fingerprint.len(), 64);
        id = risk_promotion::promote(&mut c, calc(&cap, false))
            .unwrap()
            .id;
        let current = risk_promotion::current(&mut c, &account).unwrap();
        assert_eq!(
            (current.snapshot.map(|s| s.id), current.sources_unchanged),
            (Some(id.clone()), Some(true))
        );
    }
    let mut c = file.open();
    let current = risk_promotion::current(&mut c, &account).unwrap();
    assert_eq!(
        (current.snapshot.map(|s| s.id), current.sources_unchanged),
        (Some(id.clone()), Some(true))
    );
    assert_eq!(
        risk_promotion::freshness(&mut c, &id)
            .unwrap()
            .sources_unchanged,
        Some(true)
    );
    assert!(
        c.execute("UPDATE risk_promotions SET promoted_at = 'x'", [])
            .is_err(),
        "promotions are immutable"
    );
    assert!(c.execute("DELETE FROM risk_promotions", []).is_err());
}

#[test]
fn capture_is_one_database_state_while_another_connection_writes_between_its_reads() {
    let file = JournalFile::new();
    let mut c = file.open();
    let ctx = seeded(&mut c);
    let writer = std::rc::Rc::new(std::cell::RefCell::new(file.open()));
    let account = ctx.account.clone();
    let w = writer.clone();
    // Between the canonical inputs and the reconciliation/history reads: a trade and a new review in one commit.
    MID_CAPTURE.with(|h| {
        *h.borrow_mut() = Some(Box::new(move || {
            let mut w = w.borrow_mut();
            let tx = w.transaction().unwrap();
            tx.execute("SELECT 1", []).ok();
            drop(tx);
            trades::create(&mut w, trade_input(&account)).unwrap();
            let obs = evidence::list(&w, &account).unwrap();
            let (opening, balance) = (obs[0].id.clone(), obs[1].id.clone());
            reconciliation::create(
                &mut w,
                ReconciliationRequest {
                    account_id: account.clone(),
                    observation_id: balance,
                    baseline_observation_id: opening,
                    as_of: "2026-10-20T19:40:00.000Z".into(),
                    evaluated_at: "2026-10-20T19:40:00.000Z".into(),
                    coverage: coverage(),
                },
            )
            .unwrap();
        }))
    });
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    MID_CAPTURE.with(|h| *h.borrow_mut() = None);
    // Neither write is in the bundle: the reads after the write still saw the state the first read fixed.
    assert_eq!(cap.inputs["trades"].as_array().unwrap().len(), 1);
    assert_eq!(cap.reconciliation_revision_ids, vec![ctx.review.clone()]);
    // The writes are committed, so the bundle is no longer current and cannot be promoted.
    assert_eq!(
        trades::list(&writer.borrow(), &ctx.account).unwrap().len(),
        2
    );
    assert!(is_conflict(risk_promotion::promote(
        &mut c,
        calc(&cap, false)
    )));
    assert_eq!(count(&c, "account_snapshots"), 0);
    // A fresh capture includes both, and promotes.
    let fresh = capture(&mut c, &ctx.account, CUTOFF);
    assert_eq!(
        (
            fresh.inputs["trades"].as_array().unwrap().len(),
            fresh.reconciliation_revision_ids.len()
        ),
        (2, 2)
    );
    risk_promotion::promote(&mut c, calc(&fresh, false)).unwrap();
}

type Mutation = (
    &'static str,
    fn(&mut Connection, &Ctx),
    fn(&mut Connection, &Ctx),
);

fn none(_: &mut Connection, _: &Ctx) {}

/// Every family of successful source write the product supports (see the matrix in
/// docs/architecture/p0-02-risk-promotion.md), each through its real native writer.
fn mutations() -> Vec<Mutation> {
    vec![
        ("manual trade create", none, |c, x| {
            trades::create(c, trade_input(&x.account)).unwrap();
        }),
        ("manual trade edit", none, |c, x| {
            trades::update(
                c,
                &x.trade,
                trades::TradeInput {
                    fees: Some("9".into()),
                    ..trade_input(&x.account)
                },
            )
            .unwrap();
        }),
        ("trade delete", none, |c, x| {
            trades::delete(c, &x.trade).unwrap()
        }),
        (
            "trade restore",
            |c, x| trades::delete(c, &x.trade).unwrap(),
            |c, x| {
                trades::restore_deleted(c, &x.account, &x.trade, None).unwrap();
            },
        ),
        ("CSV import", none, |c, x| {
            let perf = include_str!("../../../../../test_csvimport/Performance.csv");
            let content = format!(
                "{}\n{}\n",
                perf.lines().next().unwrap(),
                perf.lines().nth(1).unwrap()
            );
            let req = crate::csv_import::CsvImportRequest {
                account_id: x.account.clone(),
                file_name: "p.csv".into(),
                content,
                timezone: "America/New_York".into(),
                format: Default::default(),
                date_format: Default::default(),
                columns: None,
                target_acknowledgement: None,
            };
            crate::csv_import::commit_reviewed(c, &req).unwrap();
        }),
        ("checkpoint create", none, |c, x| {
            evidence::create(
                c,
                observation(&x.account, "balance", "50200", "2026-10-20T19:50:00.000Z"),
            )
            .unwrap();
        }),
        ("checkpoint correction (supersession)", none, |c, x| {
            evidence::correct(
                c,
                &x.balance,
                ObservationCorrection {
                    replacement: observation(
                        &x.account,
                        "balance",
                        "50101",
                        "2026-10-20T19:00:00.000Z",
                    ),
                    reason: "typo".into(),
                },
            )
            .unwrap();
        }),
        ("ledger movement", none, |c, x| {
            ledger::create(c, movement(&x.account, "-10")).unwrap();
        }),
        ("ledger correction", none, |c, x| {
            ledger::update_with_metadata(
                c,
                &x.ledger,
                movement(&x.account, "-30"),
                evidence::CorrectionMetadata {
                    actor: "tester".into(),
                    reason: "fix".into(),
                },
            )
            .unwrap();
        }),
        ("ledger removal", none, |c, x| {
            ledger::delete_with_metadata(
                c,
                &x.ledger,
                evidence::CorrectionMetadata {
                    actor: "tester".into(),
                    reason: "wrong".into(),
                },
            )
            .unwrap();
        }),
        ("reconciliation review", none, |c, x| {
            reconciliation::create(
                c,
                ReconciliationRequest {
                    account_id: x.account.clone(),
                    observation_id: x.balance.clone(),
                    baseline_observation_id: x.opening.clone(),
                    as_of: "2026-10-20T19:45:00.000Z".into(),
                    evaluated_at: "2026-10-20T19:45:00.000Z".into(),
                    coverage: coverage(),
                },
            )
            .unwrap();
        }),
        ("comparison resolution", none, |c, x| {
            reconciliation::resolve(
                c,
                &x.review,
                ResolutionInput {
                    actor: "tester".into(),
                    reason: "checked".into(),
                    status: "reviewed".into(),
                },
            )
            .unwrap();
        }),
        ("rulebook assignment", none, |c, x| {
            rulebooks::assign(
                c,
                AssignmentInput {
                    account_id: x.account.clone(),
                    rulebook_version_id: VERSION.into(),
                    effective_from: "2026-10-21".into(),
                    programme_phase_id: None,
                    phase_path_id: None,
                    account_phase_event_id: None,
                },
            )
            .unwrap();
        }),
        ("applicable version claim (shared)", none, |c, _| {
            rulebooks::flag_conflict(
                c,
                SourceConflictInput {
                    rule_definition_id: RULE.into(),
                    source_id: SOURCE.into(),
                    field: None,
                    provider_text: None,
                    note: "dashboard says otherwise".into(),
                },
            )
            .unwrap();
        }),
        (
            "account financial/zone/reset configuration",
            none,
            |c, x| {
                accounts::update(
                    c,
                    &x.account,
                    accounts::AccountInput {
                        timezone: "Europe/London".into(),
                        ..account_input("Eval A")
                    },
                )
                .unwrap();
            },
        ),
        ("account lifecycle", none, |c, x| {
            accounts::change_status(
                c,
                &x.account,
                accounts::StatusChangeInput {
                    status: "paused".into(),
                    effective_at: None,
                    cause: None,
                    note: None,
                },
            )
            .unwrap();
        }),
        ("phase event", none, |c, x| {
            catalogue::record_phase_event(
                c,
                catalogue::PhaseEventInput {
                    account_id: x.account.clone(),
                    from_phase: None,
                    to_phase: PhaseKey::SimulatedFunded,
                    provider_label: None,
                    occurred_at: None,
                    source: PhaseEventSource::UserEntered,
                    note: None,
                    correction_of_event_id: None,
                    catalogue_version_id: None,
                    programme_phase_id: None,
                    phase_path_id: None,
                },
            )
            .unwrap();
        }),
        ("calculation history (a new breach)", none, |c, x| {
            let cap =
                risk_promotion::capture(c, query(&x.account, "2026-10-20T20:05:00.000Z")).unwrap();
            snapshots::save(c, calc(&cap, true)).unwrap();
        }),
    ]
}

#[test]
fn each_mutation_family_after_capture_rejects_promotion_and_invalidates_the_current_result() {
    for (name, before, mutate) in mutations() {
        let mut c = db();
        let ctx = seeded(&mut c);
        before(&mut c, &ctx);
        let promoted = promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
        let other = promote_now(&mut c, &ctx.other, CUTOFF, false).unwrap();
        let pending = capture(&mut c, &ctx.account, CUTOFF);
        let snapshots_before = count(&c, "account_snapshots");
        mutate(&mut c, &ctx);
        let snapshots_after_write = count(&c, "account_snapshots");
        let r = risk_promotion::promote(&mut c, calc(&pending, false));
        assert!(
            is_conflict(r),
            "{name}: a calculation of the earlier sources must not become current"
        );
        assert_eq!(
            count(&c, "account_snapshots"),
            snapshots_after_write,
            "{name}: the rejection wrote nothing"
        );
        assert!(snapshots_after_write >= snapshots_before);
        let current = risk_promotion::current(&mut c, &ctx.account).unwrap();
        assert_eq!(
            current.snapshot.as_ref().map(|s| s.id.as_str()),
            Some(promoted.id.as_str()),
            "{name}"
        );
        assert_eq!(
            current.sources_unchanged,
            Some(false),
            "{name}: the promoted result is no longer eligible"
        );
        // Only shared dependencies reach the other account.
        let other_now = risk_promotion::current(&mut c, &ctx.other).unwrap();
        assert_eq!(
            other_now.snapshot.map(|s| s.id),
            Some(other.id.clone()),
            "{name}"
        );
        assert_eq!(
            other_now.sources_unchanged,
            Some(name != "applicable version claim (shared)"),
            "{name}: account isolation"
        );
        // A deliberate new calculation of the new sources promotes.
        promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
        assert_eq!(unchanged(&mut c, &ctx.account), Some(true), "{name}");
    }
}

#[test]
fn non_risk_records_and_failed_writes_do_not_invalidate() {
    let mut c = db();
    let ctx = seeded(&mut c);
    promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    // Journal notes, trade reviews and settings are not risk sources.
    super::journal::create(
        &mut c,
        super::journal::JournalEntryInput {
            account_id: ctx.account.clone(),
            trade_id: Some(ctx.trade.clone()),
            entry_at: "2026-10-20T21:00:00Z".into(),
            title: "Session".into(),
            body: "calm session".into(),
            tags: vec![],
        },
    )
    .unwrap();
    super::settings::set(&c, "ui.theme", &json!("dark")).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
    // A rejected write changes nothing.
    assert!(
        trades::create(
            &mut c,
            trades::TradeInput {
                quantity: "-1".into(),
                ..trade_input(&ctx.account)
            }
        )
        .is_err()
    );
    assert!(
        evidence::create(
            &mut c,
            observation(&ctx.account, "balance", "not money", CUTOFF)
        )
        .is_err()
    );
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
}

#[test]
fn a_source_write_cannot_land_between_the_comparison_and_the_commit() {
    let file = JournalFile::new();
    let mut c = file.open();
    let ctx = seeded(&mut c);
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    let other = std::rc::Rc::new(std::cell::RefCell::new(file.open()));
    other
        .borrow()
        .busy_timeout(std::time::Duration::ZERO)
        .unwrap();
    let attempted = std::rc::Rc::new(std::cell::Cell::new(false));
    let (o, done, account) = (other.clone(), attempted.clone(), ctx.account.clone());
    BEFORE_PROMOTION_COMMIT.with(|h| {
        *h.borrow_mut() = Some(Box::new(move || {
            let r = trades::create(&mut o.borrow_mut(), trade_input(&account));
            assert!(
                matches!(r, Err(AppError::Database { .. })),
                "another connection's write must wait for the promotion"
            );
            done.set(true);
        }))
    });
    let promoted = risk_promotion::promote(&mut c, calc(&cap, false));
    BEFORE_PROMOTION_COMMIT.with(|h| *h.borrow_mut() = None);
    assert!(attempted.get());
    promoted.unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
    // After the commit the write goes through, and the promoted result is no longer eligible.
    trades::create(&mut other.borrow_mut(), trade_input(&ctx.account)).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false));
}

#[test]
fn a_failed_promotion_rolls_back_the_calculation_and_the_promotion() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    c.execute_batch("CREATE TEMP TRIGGER fail_promotion BEFORE INSERT ON risk_promotions BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;").unwrap();
    assert!(risk_promotion::promote(&mut c, calc(&cap, false)).is_err());
    assert_eq!(
        (count(&c, "account_snapshots"), count(&c, "risk_promotions")),
        (0, 0)
    );
    c.execute_batch("DROP TRIGGER fail_promotion").unwrap();
    risk_promotion::promote(&mut c, calc(&cap, false)).unwrap();
    assert_eq!(
        (count(&c, "account_snapshots"), count(&c, "risk_promotions")),
        (1, 1)
    );
}

#[test]
fn an_older_calculation_cannot_displace_a_newer_cutoff_on_the_same_sources() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let older = capture(&mut c, &ctx.account, "2026-10-20T19:55:00.000Z");
    let newer = capture(&mut c, &ctx.account, CUTOFF);
    let kept = risk_promotion::promote(&mut c, calc(&newer, false)).unwrap();
    assert!(
        is_conflict(risk_promotion::promote(&mut c, calc(&older, false))),
        "the later cutoff stays current"
    );
    assert_eq!(count(&c, "account_snapshots"), 1);
    assert_eq!(
        risk_promotion::current(&mut c, &ctx.account)
            .unwrap()
            .snapshot
            .map(|s| s.id),
        Some(kept.id)
    );
    // At an equal cutoff on the same verified sources, the later commit is current.
    let again = promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    assert_eq!(
        risk_promotion::current(&mut c, &ctx.account)
            .unwrap()
            .snapshot
            .map(|s| s.id),
        Some(again.id)
    );
    // Once the newer result is no longer eligible, an earlier cutoff of the new sources may become current.
    trades::create(&mut c, trade_input(&ctx.account)).unwrap();
    promote_now(&mut c, &ctx.account, "2026-10-20T19:55:00.000Z", false).unwrap();
}

#[test]
fn a_calculation_read_before_a_new_stop_cannot_replace_it() {
    let mut c = db();
    let ctx = seeded(&mut c);
    // The older calculation loads first and sees no breach history.
    let slow = capture(&mut c, &ctx.account, CUTOFF);
    assert!(slow.prior_breaches.is_empty());
    // Meanwhile a Stop with a breach is calculated and promoted.
    let stop = promote_now(&mut c, &ctx.account, CUTOFF, true).unwrap();
    // Promoting it does not make itself stale (its own breach is not part of its own prior history).
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
    // The slow one finishes afterwards: its prior-breach history is incomplete, so it is refused.
    assert!(is_conflict(risk_promotion::promote(
        &mut c,
        calc(&slow, false)
    )));
    let current = risk_promotion::current(&mut c, &ctx.account).unwrap();
    assert_eq!(
        (current.snapshot.map(|s| s.id), current.sources_unchanged),
        (Some(stop.id.clone()), Some(true))
    );
    // The next calculation carries the breach forward.
    let next = capture(&mut c, &ctx.account, CUTOFF);
    assert_eq!(next.prior_breaches.len(), 1);
    assert_eq!(next.prior_breaches[0]["ruleKey"], "daily_loss");
    assert_eq!(next.prior_breaches[0]["observedAt"], CUTOFF);
    // ...but never into another attempt.
    assert!(
        capture(&mut c, &ctx.other, CUTOFF)
            .prior_breaches
            .is_empty()
    );
}

#[test]
fn changes_that_are_reversed_still_count_as_new_history() {
    let mut c = db();
    let ctx = seeded(&mut c);
    // A checkpoint corrected and corrected back: both supersessions stay in the append-only history.
    promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    let fixed = evidence::correct(
        &mut c,
        &ctx.balance,
        ObservationCorrection {
            replacement: observation(&ctx.account, "balance", "1", "2026-10-20T19:00:00.000Z"),
            reason: "x".into(),
        },
    )
    .unwrap();
    evidence::correct(
        &mut c,
        &fixed.id,
        ObservationCorrection {
            replacement: observation(&ctx.account, "balance", "50100", "2026-10-20T19:00:00.000Z"),
            reason: "back".into(),
        },
    )
    .unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false));
    // A trade edited and edited back carries its new revision time.
    promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    let original = trade_input(&ctx.account);
    trades::update(
        &mut c,
        &ctx.trade,
        trades::TradeInput {
            fees: Some("1".into()),
            ..original.clone()
        },
    )
    .unwrap();
    trades::update(&mut c, &ctx.trade, original).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false));
}

#[test]
fn a_calculation_of_another_journal_never_promotes() {
    // A journal restored or replaced from elsewhere: same account identity, different records.
    let (mut a, mut b) = (db(), db());
    for c in [&a, &b] {
        c.execute("INSERT INTO accounts(id,name,account_type,status,currency,starting_balance_micros,timezone,trading_day_reset_time,created_at,updated_at) VALUES('acct','Eval','evaluation','active','USD',50000000000,'America/New_York','17:00',?1,?1)", [AT]).unwrap();
    }
    trades::create(&mut b, trade_input("acct")).unwrap();
    let cap = capture(&mut a, "acct", CUTOFF);
    assert!(is_conflict(risk_promotion::promote(
        &mut b,
        calc(&cap, false)
    )));
    assert_eq!(count(&b, "account_snapshots"), 0);
    risk_promotion::promote(&mut a, calc(&cap, false)).unwrap();
}

#[test]
fn history_saves_never_become_current_and_eod_rows_stay_idempotent() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    let saved = snapshots::save(&mut c, calc(&cap, false)).unwrap();
    let current = risk_promotion::current(&mut c, &ctx.account).unwrap();
    assert_eq!(
        (current.snapshot, current.sources_unchanged),
        (None, None),
        "a saved calculation is history, not current"
    );
    assert_eq!(
        snapshots::latest(&c, &ctx.account).unwrap().map(|s| s.id),
        Some(saved.id.clone())
    );
    assert_eq!(
        risk_promotion::freshness(&mut c, &saved.id)
            .unwrap()
            .sources_unchanged,
        Some(true)
    );
    // End-of-day saves keep returning the identical stored row.
    let eod = SnapshotInput {
        is_end_of_day: true,
        ..calc(&cap, false)
    };
    let first = snapshots::save(&mut c, eod.clone()).unwrap();
    assert_eq!(snapshots::save(&mut c, eod).unwrap().id, first.id);
    // A caller-supplied (pre-engine) snapshot can never be promoted.
    let legacy = SnapshotInput {
        engine_version: "legacy".into(),
        ..calc(&cap, false)
    };
    assert!(matches!(
        risk_promotion::promote(&mut c, legacy),
        Err(AppError::Validation { .. })
    ));
    assert_eq!(
        risk_promotion::freshness(&mut c, &first.id)
            .unwrap()
            .sources_unchanged,
        Some(true)
    );
    // Promotion keeps the frozen identity checks: a tampered figure is refused before anything is read.
    let mut tampered = calc(&cap, false);
    tampered.explanation["engine"]["status"] = json!("Safe");
    assert!(matches!(
        risk_promotion::promote(&mut c, tampered),
        Err(AppError::Validation { .. })
    ));
    // A frozen bundle that claims different records is a conflict, never trusted.
    let mut forged = calc(&cap, false);
    forged.explanation["inputs"]["trades"] = json!([]);
    let hash = format!("{:x}", Sha256::digest(canonical_engine_json(&json!({"engineVersion": forged.engine_version, "input": forged.explanation["inputs"], "policy": forged.explanation["policy"]})).as_bytes()));
    forged.inputs_hash = hash.clone();
    forged.explanation["engine"]["inputsHash"] = json!(hash);
    assert!(is_conflict(risk_promotion::promote(&mut c, forged)));
    assert_eq!(count(&c, "risk_promotions"), 0);
}

#[test]
fn archived_accounts_keep_their_current_result_readable_but_promote_nothing() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let promoted = promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    let pending = capture(&mut c, &ctx.account, CUTOFF);
    accounts::archive(&mut c, &ctx.account).unwrap();
    assert!(risk_promotion::promote(&mut c, calc(&pending, false)).is_err());
    let current = risk_promotion::current(&mut c, &ctx.account).unwrap();
    assert_eq!(current.snapshot.map(|s| s.id), Some(promoted.id));
    assert_eq!(
        current.sources_unchanged,
        Some(false),
        "archiving changed the account it froze"
    );
}

#[test]
fn reconciliation_reviews_become_missing_inputs_and_revisions_as_the_desktop_loader_did() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    let status = reconciliation::list(&c, &ctx.account).unwrap()[0]
        .result
        .reconciliation_status
        .clone();
    let markers: Vec<&str> = cap.inputs["missingInputs"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .filter(|m| m.starts_with("reconciliation_review:"))
        .collect();
    if status == "matched" {
        assert!(markers.is_empty());
    } else {
        assert_eq!(
            markers,
            [format!("reconciliation_review:{}:{status}", ctx.review)]
        );
    }
    // Reviews after the cutoff are revisions but not this cutoff's gaps.
    let early = capture(&mut c, &ctx.account, "2026-10-20T19:10:00.000Z");
    assert!(
        !early.inputs["missingInputs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m.as_str().unwrap().starts_with("reconciliation_review:"))
    );
    assert_eq!(early.reconciliation_revision_ids, vec![ctx.review.clone()]);
    // A resolution is a revision too; a superseded checkpoint's review no longer counts as a gap.
    let resolution = reconciliation::resolve(
        &mut c,
        &ctx.review,
        ResolutionInput {
            actor: "t".into(),
            reason: "r".into(),
            status: "reviewed".into(),
        },
    )
    .unwrap();
    evidence::correct(
        &mut c,
        &ctx.balance,
        ObservationCorrection {
            replacement: observation(&ctx.account, "balance", "50100", "2026-10-20T19:00:00.000Z"),
            reason: "re-entered".into(),
        },
    )
    .unwrap();
    let later = capture(&mut c, &ctx.account, CUTOFF);
    let mut ids = vec![ctx.review.clone(), resolution.id];
    ids.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    assert_eq!(later.reconciliation_revision_ids, ids);
    assert!(
        !later.inputs["missingInputs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m.as_str().unwrap().starts_with("reconciliation_review:"))
    );
}

#[test]
fn a_populated_v20_journal_upgrades_without_promoting_its_history() {
    let file = JournalFile::new();
    let path = file.0.join(crate::db::DB_FILE_NAME);
    std::fs::create_dir_all(&file.0).unwrap();
    let (account, ids);
    {
        let mut c = Connection::open(&path).unwrap();
        crate::db::configure(&c).unwrap();
        crate::db::migrate_with(&mut c, &crate::db::MIGRATIONS[..20]).unwrap();
        // This build's trade code needs migration 0022's column; it is dropped again below (TASK-042).
        c.execute_batch("ALTER TABLE trades ADD COLUMN fees_recorded INTEGER NOT NULL DEFAULT 1")
            .unwrap();
        let ctx = seeded(&mut c);
        account = ctx.account;
        let cap = risk_promotion::capture(&mut c, query(&account, CUTOFF)).unwrap();
        let a = snapshots::save(&mut c, calc(&cap, true)).unwrap();
        let b = snapshots::save(&mut c, calc(&cap, false)).unwrap();
        ids = vec![a.id, b.id];
        without_fees_recorded(&c, 20);
        let version: u32 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 20);
    }
    let mut c = file.open();
    let version: u32 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, crate::db::latest_version());
    let mut stored: Vec<String> = snapshots::list(&c, &account, None, None, false)
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    stored.sort();
    let mut expected = ids.clone();
    expected.sort();
    assert_eq!(stored, expected, "history keeps its ids");
    assert_eq!(
        count(&c, "risk_promotions"),
        0,
        "nothing is promoted by the migration"
    );
    assert_eq!(
        risk_promotion::current(&mut c, &account).unwrap().snapshot,
        None
    );
    // The breach recorded before the upgrade still carries forward.
    assert_eq!(
        risk_promotion::capture(&mut c, query(&account, CUTOFF))
            .unwrap()
            .prior_breaches
            .len(),
        1
    );
}

/// Native payloads of the four P0-02 commands for the desktop contract tests (src/test/fixtures/risk-promotion-wire.json).
/// Regenerate deliberately with FUNDEDFLOW_UPDATE_FIXTURES=1 and review the diff.
#[test]
fn promotion_command_wire_fixture() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let stop = promote_now(&mut c, &ctx.account, "2026-10-20T19:58:00.000Z", true).unwrap();
    let q = query(&ctx.account, CUTOFF);
    let cap = risk_promotion::capture(&mut c, q.clone()).unwrap();
    assert_eq!(cap.prior_breaches.len(), 1);
    let input = calc(&cap, false);
    let promoted = risk_promotion::promote(&mut c, input.clone()).unwrap();
    let current = risk_promotion::current(&mut c, &ctx.account).unwrap();
    let history = risk_promotion::freshness(&mut c, &stop.id).unwrap();
    let input_json = serde_json::to_value(serde_json::from_value::<Value>(json!({
        "accountId": input.account_id, "rulebookVersionId": input.rulebook_version_id, "tradingDay": input.trading_day,
        "isEndOfDay": input.is_end_of_day, "dataAsOf": input.data_as_of, "dataSource": input.data_source, "engineVersion": input.engine_version,
        "inputsHash": input.inputs_hash, "feesIncluded": input.fees_included, "unrealizedIncluded": input.unrealized_included,
        "balance": input.balance, "realizedDayPnl": input.realized_day_pnl, "unrealizedPnl": input.unrealized_pnl, "dailyLossLimit": input.daily_loss_limit,
        "dailyLossRemaining": input.daily_loss_remaining, "drawdownMode": input.drawdown_mode, "highWaterMark": input.high_water_mark,
        "drawdownFloor": input.drawdown_floor, "drawdownHeadroom": input.drawdown_headroom, "drawdownLocked": input.drawdown_locked,
        "profitTarget": input.profit_target, "tradingDaysCompleted": input.trading_days_completed, "tradingDaysRequired": input.trading_days_required,
        "status": input.status, "statusReasons": input.status_reasons, "explanation": input.explanation,
    })).unwrap()).unwrap();
    let mut payloads = json!([
        {"command":"capture_account_risk","args":{"query":q},"output":cap},
        {"command":"promote_account_risk","args":{"input":input_json},"output":promoted},
        {"command":"get_current_account_risk","args":{"accountId":ctx.account},"output":current},
        {"command":"get_account_snapshot_freshness","args":{"snapshotId":stop.id},"output":history},
    ]);
    assert_eq!(current.sources_unchanged, Some(true));
    // A later calculation that records no new breach leaves the Stop's own sources unchanged for its cutoff.
    assert_eq!(history.sources_unchanged, Some(true));
    let mut ids = std::collections::BTreeMap::new();
    super::evidence_tests::normalize_wire(&mut payloads, None, &mut ids);
    fn fixed(v: &mut Value, ids: &mut std::collections::BTreeMap<String, String>) {
        match v {
            Value::Object(o) => {
                for (k, value) in o.iter_mut() {
                    match (k.as_str(), value.is_string()) {
                        (
                            "calculatedAt" | "promotedAt" | "verifiedAt" | "capturedAt"
                            | "assignedAt" | "occurredAt",
                            true,
                        ) => *value = json!("2026-10-21T00:00:00.000Z"),
                        ("sourceFingerprint" | "inputsHash", true) => {
                            *value = json!("f".repeat(64))
                        }
                        _ => fixed(value, ids),
                    }
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| fixed(x, ids)),
            // Review ids embedded in missing-input markers.
            Value::String(s) if s.starts_with("reconciliation_review:") => {
                let parts: Vec<&str> = s.splitn(3, ':').collect();
                let n = ids.len() + 1;
                let id = ids
                    .entry(parts[1].to_string())
                    .or_insert_with(|| format!("00000000-0000-4000-8000-{n:012}"))
                    .clone();
                *s = format!("reconciliation_review:{id}:{}", parts[2]);
            }
            _ => {}
        }
    }
    fixed(&mut payloads, &mut ids);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/risk-promotion-wire.json");
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some() {
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&payloads).unwrap()),
        )
        .unwrap();
    }
    let stored: Value = serde_json::from_str(
        &std::fs::read_to_string(path).expect("generate deliberate promotion wire fixture"),
    )
    .unwrap();
    assert_eq!(stored, payloads);
}

// Writers outside the generic matrix loop (rows 16 and 19–22). Each promotes, runs the writer directly, then checks
// the result reads not current (or is gone) and that a deliberate new calculation promotes.

/// Pins `updated_at` to a fixed past instant so a writer that only stamps "now" cannot coincide with it.
fn pin_updated_at(c: &Connection, account: &str) {
    c.execute(
        "UPDATE accounts SET updated_at = ?2 WHERE id = ?1",
        params![account, AT],
    )
    .unwrap();
}

fn promoted_and_current(c: &mut Connection, account: &str) -> snapshots::Snapshot {
    let promoted = promote_now(c, account, CUTOFF, false).unwrap();
    assert_eq!(unchanged(c, account), Some(true));
    promoted
}

fn current_id(c: &mut Connection, account: &str) -> Option<String> {
    risk_promotion::current(c, account)
        .unwrap()
        .snapshot
        .map(|s| s.id)
}

#[test]
fn archive_and_restore_account_driven_directly_invalidate_and_a_new_calculation_promotes() {
    let mut c = db();
    let ctx = seeded(&mut c);
    pin_updated_at(&c, &ctx.account);
    let promoted = promoted_and_current(&mut c, &ctx.account);
    accounts::archive(&mut c, &ctx.account).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false), "archive");
    accounts::restore(&mut c, &ctx.account).unwrap();
    // Back in the lists, but the account's revision moved on: still not current.
    assert_eq!(current_id(&mut c, &ctx.account), Some(promoted.id));
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false), "restore");
    assert_eq!(unchanged(&mut c, &ctx.other), None);
    promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
}

#[test]
fn an_attempt_reset_invalidates_the_predecessor_and_both_attempts_promote_afresh() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let promoted = promoted_and_current(&mut c, &ctx.account);
    let other = promoted_and_current(&mut c, &ctx.other);
    let pending = capture(&mut c, &ctx.account, CUTOFF);
    let reset = super::attempts::reset(
        &mut c,
        super::attempts::ResetInput {
            predecessor_account_id: ctx.account.clone(),
            prior_outcome: "failed".into(),
            effective_at: "2026-10-20T21:00:00Z".into(),
            reason: Some("daily loss".into()),
            source: "user_entered".into(),
            name: "Eval A (2)".into(),
            external_ref: None,
            starting_balance: "50000".into(),
            catalogue: None,
            rulebook: super::attempts::RulebookDecision::DecideLater,
            notes: None,
        },
    )
    .unwrap();
    assert_eq!(reset.predecessor.status, "failed");
    assert!(is_conflict(risk_promotion::promote(
        &mut c,
        calc(&pending, false)
    )));
    assert_eq!(current_id(&mut c, &ctx.account), Some(promoted.id));
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false));
    // The new attempt starts with no result; an unrelated account is untouched.
    assert_eq!(current_id(&mut c, &reset.successor.id), None);
    assert_eq!(current_id(&mut c, &ctx.other), Some(other.id));
    assert_eq!(unchanged(&mut c, &ctx.other), Some(true));
    promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
    promote_now(&mut c, &reset.successor.id, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &reset.successor.id), Some(true));
}

#[test]
fn a_catalogue_link_change_invalidates_and_a_new_calculation_promotes() {
    let mut c = db();
    let ctx = seeded(&mut c);
    pin_updated_at(&c, &ctx.account);
    let promoted = promoted_and_current(&mut c, &ctx.account);
    let size_source = match catalogue::get_link(&c, &ctx.account).unwrap().size_source {
        AccountFieldSource::Imported => AccountFieldSource::UserEntered,
        _ => AccountFieldSource::Imported,
    };
    let pending = capture(&mut c, &ctx.account, CUTOFF);
    catalogue::set_link(
        &mut c,
        catalogue::AccountLinkInput {
            account_id: ctx.account.clone(),
            programme_variant_id: None,
            catalogue_version_id: None,
            selected_phase_path_id: None,
            size_source,
        },
    )
    .unwrap();
    assert!(is_conflict(risk_promotion::promote(
        &mut c,
        calc(&pending, false)
    )));
    assert_eq!(current_id(&mut c, &ctx.account), Some(promoted.id));
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false));
    promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
}

fn export_archive(c: &Connection, file: &JournalFile, dest: &std::path::Path) {
    data_controls::export_journal(
        c,
        &file.0,
        data_controls::ExportRequest {
            destination: dest.to_string_lossy().into(),
            acknowledge_plaintext: true,
        },
    )
    .unwrap();
}

/// `restore_journal_archive` end to end: prepare under the open connection, close it, install at the next open.
fn restore_archive(c: Connection, file: &JournalFile, archive: &std::path::Path) -> Connection {
    let source: String = archive.to_string_lossy().into();
    let preview = data_controls::inspect_restore(
        &c,
        &file.0,
        data_controls::InspectRequest {
            source: source.clone(),
        },
    )
    .unwrap();
    data_controls::prepare_restore(
        &c,
        &file.0,
        data_controls::RestoreRequest {
            source,
            preview_token: preview.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        },
    )
    .unwrap();
    drop(c);
    data_controls::recover(&file.0, &file.0.join(crate::db::DB_FILE_NAME)).unwrap();
    file.open()
}

#[test]
fn a_journal_restore_keeps_a_result_current_only_when_its_sources_are_byte_identical() {
    let file = JournalFile::new();
    let archives = tempfile::tempdir().unwrap();
    let mut c = file.open();
    let ctx = seeded(&mut c);
    // Archive 1 holds a promotion and, unchanged, every source it froze.
    let first = promoted_and_current(&mut c, &ctx.account);
    let identical = archives.path().join("identical.zip");
    export_archive(&c, &file, &identical);
    trades::create(&mut c, trade_input(&ctx.account)).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false));
    let mut c = restore_archive(c, &file, &identical);
    assert_eq!(current_id(&mut c, &ctx.account), Some(first.id.clone()));
    assert_eq!(
        unchanged(&mut c, &ctx.account),
        Some(true),
        "byte-identical sources verify"
    );
    // Archive 2 holds the same promotion but a later source write.
    trades::create(&mut c, trade_input(&ctx.account)).unwrap();
    let changed = archives.path().join("changed.zip");
    export_archive(&c, &file, &changed);
    // Results promoted after that archive was taken are gone once it is restored.
    let later = promoted_and_current(&mut c, &ctx.account);
    let other = promoted_and_current(&mut c, &ctx.other);
    let mut c = restore_archive(c, &file, &changed);
    assert!(
        risk_promotion::freshness(&mut c, &later.id).is_err(),
        "the pre-restore result is not in the restored journal"
    );
    assert!(risk_promotion::freshness(&mut c, &other.id).is_err());
    assert_eq!(current_id(&mut c, &ctx.account), Some(first.id));
    assert_eq!(unchanged(&mut c, &ctx.account), Some(false));
    assert_eq!(current_id(&mut c, &ctx.other), None);
    promote_now(&mut c, &ctx.account, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.account), Some(true));
    promote_now(&mut c, &ctx.other, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.other), Some(true));
}

/// `permanently_delete_data` as the desktop calls it: preview, then delete with the preview's token and phrase.
fn delete_data(c: &mut Connection, root: &std::path::Path, scope: Value) {
    let preview = data_controls::preview_deletion(
        c,
        root,
        serde_json::from_value(json!({ "scope": scope })).unwrap(),
    )
    .unwrap();
    assert!(preview.blockers.is_empty(), "{:?}", preview.blockers);
    let request = serde_json::from_value(json!({
        "scope": scope, "previewToken": preview.preview_token, "confirmation": preview.required_confirmation,
    }))
    .unwrap();
    let result = data_controls::delete_data(c, root, request).unwrap();
    assert_eq!(result.state, "completed");
}

#[test]
fn permanently_deleting_an_account_removes_its_results_and_leaves_others_current() {
    let root = tempfile::tempdir().unwrap();
    let mut c = db();
    let ctx = seeded(&mut c);
    // An account with no shared rulebook history, so deletion is not blocked.
    let doomed = accounts::create(&mut c, account_input("Eval C"))
        .unwrap()
        .id;
    trades::create(&mut c, trade_input(&doomed)).unwrap();
    let gone = promoted_and_current(&mut c, &doomed);
    let pending = capture(&mut c, &doomed, CUTOFF);
    let other = promoted_and_current(&mut c, &ctx.other);
    delete_data(
        &mut c,
        root.path(),
        json!({ "kind": "account", "accountId": doomed }),
    );
    assert!(matches!(
        risk_promotion::current(&mut c, &doomed),
        Err(AppError::NotFound { .. })
    ));
    assert!(risk_promotion::freshness(&mut c, &gone.id).is_err());
    assert!(risk_promotion::promote(&mut c, calc(&pending, false)).is_err());
    let left: i64 = c
        .query_row(
            "SELECT count(*) FROM risk_promotions WHERE account_id = ?1",
            [&doomed],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(left, 0);
    assert_eq!(current_id(&mut c, &ctx.other), Some(other.id));
    assert_eq!(unchanged(&mut c, &ctx.other), Some(true));
    promote_now(&mut c, &ctx.other, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &ctx.other), Some(true));
}

#[test]
fn erasing_the_whole_journal_removes_every_result_and_a_new_journal_promotes() {
    let root = tempfile::tempdir().unwrap();
    let mut c = db();
    let ctx = seeded(&mut c);
    promoted_and_current(&mut c, &ctx.account);
    promoted_and_current(&mut c, &ctx.other);
    let pending = capture(&mut c, &ctx.account, CUTOFF);
    delete_data(&mut c, root.path(), json!({ "kind": "journal" }));
    assert_eq!(
        (count(&c, "risk_promotions"), count(&c, "account_snapshots")),
        (0, 0)
    );
    for id in [&ctx.account, &ctx.other] {
        assert!(matches!(
            risk_promotion::current(&mut c, id),
            Err(AppError::NotFound { .. })
        ));
    }
    assert!(risk_promotion::promote(&mut c, calc(&pending, false)).is_err());
    let fresh = seeded(&mut c);
    promote_now(&mut c, &fresh.account, CUTOFF, false).unwrap();
    assert_eq!(unchanged(&mut c, &fresh.account), Some(true));
}

/// Commands that write nothing a calculation could read: queries, previews, inspections and exports.
const READ_COMMANDS: &[&str] = &[
    "list_accounts",
    "list_active_accounts",
    "get_account",
    "get_account_history",
    "get_account_lineage",
    "preview_account_deletion",
    "list_trades",
    "list_deleted_trades",
    "get_trade_detail",
    "get_trade_review",
    "list_trade_review_summaries",
    "read_trade_screenshot",
    "get_review_library",
    "list_journal_entries",
    "preview_csv_import",
    "list_csv_imports",
    "list_csv_import_problem_rows",
    "list_rulebooks",
    "list_rulebook_versions",
    "get_rulebook_version",
    "get_applicable_rulebook",
    "list_rulebook_events",
    "validate_rulebook_draft",
    "list_account_rulebook_assignments",
    "get_catalogue",
    "list_account_offer_selections",
    "get_account_catalogue_link",
    "list_account_phase_events",
    "list_ledger_entries",
    "get_ledger_balance_adjustment",
    "get_setting",
    "list_settings",
    "list_account_snapshots",
    "get_latest_account_snapshot",
    "capture_account_risk",
    "get_current_account_risk",
    "get_account_snapshot_freshness",
    "runtime_status",
    "get_account_risk_inputs",
    "get_financial_observation",
    "list_financial_observations",
    "get_ledger_history",
    "list_financial_reconciliations",
    "list_reconciliation_resolutions",
    "export_journal_archive",
    "export_trade_csv",
    "inspect_journal_archive",
    "preview_permanent_deletion",
    "get_daily_review",
    "list_daily_reviews",
    "get_insights_dataset",
    "dev_tools_status",
    "dev_reset_preview",
    "get_legal_acceptance",
    "list_account_freshness",
];

/// Every `#[tauri::command]` is either a listed read or a write the §3 command table classifies (a matrix row, or
/// "not a source"), so a new writer cannot skip the matrix silently. Listed names that no longer exist fail too.
#[test]
fn every_write_command_is_classified_for_risk_promotion() {
    let sources = [
        include_str!("../commands.rs"),
        include_str!("../dev_tools/mod.rs"),
        include_str!("../legal.rs"),
    ];
    let doc = include_str!("../../../../../docs/architecture/p0-02-risk-promotion.md");
    let defined: Vec<&str> = sources
        .iter()
        .flat_map(|s| s.split("#[tauri::command]").skip(1))
        .filter_map(|chunk| chunk.split("fn ").nth(1)?.split('(').next())
        .map(str::trim)
        .collect();
    assert!(defined.len() > 100, "found {} commands", defined.len());
    let section = doc
        .split("## 3.")
        .nth(1)
        .and_then(|s| s.split("\n## ").next())
        .expect("§3 of the P0-02 doc");
    let classified: Vec<&str> = section
        .lines()
        .filter_map(|l| l.strip_prefix("| `")?.split('`').next())
        .collect();
    for name in &defined {
        let read = READ_COMMANDS.contains(name);
        let write = classified.contains(name);
        assert!(
            read != write,
            "{name}: list it as a read in READ_COMMANDS, or as a write in the §3 command table (not both)"
        );
    }
    for name in READ_COMMANDS.iter().chain(&classified) {
        assert!(
            defined.contains(name),
            "{name} is classified but is not a command"
        );
    }
    // Each table entry names a matrix row (or rows) that exists, or says why it is not a source.
    let rows: Vec<&str> = section
        .lines()
        .filter_map(|l| l.strip_prefix("| ")?.split(' ').next())
        .filter(|n| n.parse::<u32>().is_ok())
        .collect();
    for line in section.lines().filter(|l| l.starts_with("| `")) {
        let row = line.split('|').nth(2).unwrap().trim();
        let known = match row.split_once('–') {
            Some((a, b)) => rows.contains(&a) && rows.contains(&b),
            None => rows.contains(&row) || matches!(row, "not a source" | "new account"),
        };
        assert!(known, "{line}: names no matrix row");
    }
}

// ---------------------------------------------------------------------------
// TASK-042 (B2-2): migration 0022 does not change the fingerprint of stored calculations.
// ---------------------------------------------------------------------------

/// Turns a journal this build wrote back into the version-21 schema of `trades`: the only schema change
/// migration 0022 makes is the `fees_recorded` column. Lets a test use this build's store code "before" 0022.
fn without_fees_recorded(c: &Connection, version: u32) {
    c.execute_batch("ALTER TABLE trades DROP COLUMN fees_recorded")
        .unwrap();
    c.pragma_update(None, "user_version", version).unwrap();
}

#[test]
fn risk_inputs_never_carry_fees_recorded() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    let listed = cap.inputs["trades"].as_array().unwrap();
    assert_eq!(listed.len(), 1);
    for t in listed {
        let keys: Vec<&str> = t.as_object().unwrap().keys().map(String::as_str).collect();
        assert!(
            !keys.contains(&"feesRecorded"),
            "risk inputs leave the flag out"
        );
        assert!(keys.contains(&"fees"));
    }
    // The command DTO itself does carry it.
    let listed = serde_json::to_value(trades::list(&c, &ctx.account).unwrap()).unwrap();
    assert_eq!(listed[0]["feesRecorded"], true);
}

#[test]
fn a_calculation_promoted_before_migration_22_stays_current_after_it() {
    let file = JournalFile::new();
    let path = file.0.join(crate::db::DB_FILE_NAME);
    let (account, id, explicit_zero);
    {
        let mut c = file.open();
        account = seeded(&mut c).account;
        // An explicit 0 is recorded now; the legacy rule of migration 0022 will mark it "not recorded",
        // so the flag changes across the migration while the calculation's sources do not.
        explicit_zero = trades::create(
            &mut c,
            trades::TradeInput {
                fees: Some("0".into()),
                ..trade_input(&account)
            },
        )
        .unwrap()
        .id;
        let cap = capture(&mut c, &account, CUTOFF);
        id = risk_promotion::promote(&mut c, calc(&cap, false))
            .unwrap()
            .id;
        assert_eq!(unchanged(&mut c, &account), Some(true));
    }
    without_fees_recorded(&Connection::open(&path).unwrap(), 21);

    let mut c = file.open();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        crate::db::latest_version()
    );
    let flag: i64 = c
        .query_row(
            "SELECT fees_recorded FROM trades WHERE id = ?1",
            [&explicit_zero],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(flag, 0, "the legacy rule applied");
    let current = risk_promotion::current(&mut c, &account).unwrap();
    assert_eq!(
        (current.snapshot.map(|s| s.id), current.sources_unchanged),
        (Some(id), Some(true))
    );
}
