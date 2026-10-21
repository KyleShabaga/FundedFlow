//! Build 19 rulebook editor operations against the catalogue fixture: saving
//! drafts with optimistic concurrency, discarding them, stale drafts, guarded
//! assignments, the append-only audit log, migrations 15 and 16, restart persistence,
//! and that reading risk inputs for a preview writes nothing.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::catalogue_tests::{id, rejects, seeded};
use super::rulebook_tests::{account, assign, draft, fields, fixture_rules, verified_100k};
use crate::error::AppError;
use crate::rulebook::{
    AssignmentGuard, ChangeContext, NewRulebook, RulebookDraftInput, RulebookDraftUpdate, RulebookEventQuery,
    RulebookVersionDetail,
};
use crate::store::rulebooks as store;

fn me(reason: &str) -> ChangeContext {
    ChangeContext { actor: "tester".into(), reason: Some(reason.into()) }
}

/// The draft's content as an update, so a test can change one thing.
fn content(d: &RulebookVersionDetail) -> RulebookDraftUpdate {
    RulebookDraftUpdate {
        change_reason: d.version.change_reason.clone(),
        captured_at: d.version.captured_at.clone(),
        effective_from: d.version.effective_from.clone(),
        effective_to: d.version.effective_to.clone(),
        rules: d.rules.iter().map(|r| r.rule.clone()).collect(),
        applicability: d
            .applicability
            .iter()
            .map(|a| crate::rulebook::ApplicabilityInput {
                catalogue_version_id: a.catalogue_version_id.clone(),
                programme_phase_id: a.programme_phase_id.clone(),
                phase_path_id: a.phase_path_id.clone(),
            })
            .collect(),
    }
}

/// A private draft for `account`, copied from a verified catalogue version.
fn private_copy(conn: &mut Connection, account_id: &str, base: &str) -> RulebookVersionDetail {
    let source = store::get_version(conn, base).unwrap();
    store::create_draft_with(
        conn,
        RulebookDraftInput {
            rulebook_id: None,
            new_rulebook: Some(NewRulebook {
                provider_id: source.rulebook.provider_id.clone(),
                owner_account_id: Some(account_id.into()),
                slug: format!("own-{}", &account_id[account_id.len() - 4..]),
                display_name: "My rules".into(),
                description: None,
            }),
            supersedes_version_id: None,
            change_reason: Some("Copied from the firm's rulebook".into()),
            captured_at: "2026-10-20T09:00:00Z".into(),
            effective_from: None,
            effective_to: None,
            rules: source.rules.iter().map(|r| r.rule.clone()).collect(),
            applicability: vec![],
        },
        me("Start my own limits"),
    )
    .unwrap()
}

fn events(conn: &Connection, q: RulebookEventQuery) -> Vec<(String, Option<String>)> {
    store::list_events(conn, &q).unwrap().into_iter().map(|e| (e.action, e.reason)).collect()
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)).unwrap()
}

#[test]
fn a_draft_is_saved_only_against_the_revision_it_was_read_at() {
    let mut conn = seeded();
    let base = verified_100k(&mut conn);
    let before_base = store::get_version(&conn, &base).unwrap();
    let acc = account(&mut conn, "Eval");
    let d = private_copy(&mut conn, &acc, &base);
    let v = d.version.id.clone();

    let mut edit = content(&d);
    edit.rules[0].parameters = json!({ "amount": { "state": "value", "value": "2500" }, "basis": "balance" });
    let saved = store::update_draft(&mut conn, &v, &d.version.updated_at, edit.clone(), me("Lower target")).unwrap();
    assert_eq!(saved.rules[0].rule.parameters["amount"]["value"], "2500");
    assert!(saved.version.updated_at > d.version.updated_at, "every save moves the revision");
    assert_eq!(saved.version.version_number, d.version.version_number);

    // Saving again from the old revision (a second window) is a conflict, not an overwrite.
    let mut other = content(&d);
    other.rules[0].parameters = json!({ "amount": { "state": "value", "value": "9999" }, "basis": "balance" });
    assert!(matches!(
        store::update_draft(&mut conn, &v, &d.version.updated_at, other, me("Other window")),
        Err(AppError::Conflict { .. })
    ));
    assert_eq!(store::get_version(&conn, &v).unwrap().rules[0].rule.parameters["amount"]["value"], "2500");

    // Two quick saves in a row each get a later revision.
    let again = store::update_draft(&mut conn, &v, &saved.version.updated_at, edit.clone(), me("Again")).unwrap();
    assert!(again.version.updated_at > saved.version.updated_at);

    // Publishing from a stale revision is refused too; from the current one it goes into use.
    assert!(matches!(
        store::publish_with(&mut conn, &v, None, Some(&saved.version.updated_at), me("Use it")),
        Err(AppError::Conflict { .. })
    ));
    let published = store::publish_with(&mut conn, &v, None, Some(&again.version.updated_at), me("Use it")).unwrap();
    assert_eq!(published.version.verification_status, "needs_review");

    // Published content is frozen: neither the operation nor SQL can change it.
    assert!(matches!(
        store::update_draft(&mut conn, &v, &published.version.updated_at, edit, me("Late edit")),
        Err(AppError::Conflict { .. })
    ));
    rejects(&conn, &format!("DELETE FROM rule_definitions WHERE rulebook_version_id = '{v}'"), "cannot change");

    // The catalogue version it was copied from is untouched.
    assert_eq!(store::get_version(&conn, &base).unwrap(), before_base);
    assert_eq!(
        events(&conn, RulebookEventQuery { rulebook_id: Some(d.rulebook.id.clone()), account_id: None }),
        [
            ("draft_created".to_string(), Some("Start my own limits".to_string())),
            ("draft_saved".into(), Some("Lower target".into())),
            ("draft_saved".into(), Some("Again".into())),
            ("published".into(), Some("Use it".into())),
        ]
    );
}

#[test]
fn a_failed_save_changes_nothing() {
    let mut conn = seeded();
    let base = verified_100k(&mut conn);
    let acc = account(&mut conn, "Eval");
    let d = private_copy(&mut conn, &acc, &base);
    let v = d.version.id.clone();
    let events_before = count(&conn, "rulebook_events");

    // Invalid parameters are refused before writing.
    let mut bad = content(&d);
    bad.rules[0].parameters = json!({ "amount": { "state": "value", "value": 3000 }, "basis": "unknown" });
    assert_eq!(fields(store::update_draft(&mut conn, &v, &d.version.updated_at, bad, me("x")).unwrap_err()), ["rules[0].parameters"]);
    // A private rulebook never gets catalogue applicability.
    let mut catalogue = content(&d);
    catalogue.applicability = content(&store::get_version(&conn, &base).unwrap()).applicability;
    assert_eq!(fields(store::update_draft(&mut conn, &v, &d.version.updated_at, catalogue, me("x")).unwrap_err()), ["applicability"]);
    // A blank actor is refused.
    let blank = ChangeContext { actor: "  ".into(), reason: None };
    assert_eq!(fields(store::update_draft(&mut conn, &v, &d.version.updated_at, content(&d), blank).unwrap_err()), ["actor"]);

    // A failure part-way through the transaction rolls every step back.
    conn.execute_batch("CREATE TEMP TRIGGER fail_rules BEFORE INSERT ON rule_definitions BEGIN SELECT RAISE(ABORT, 'injected'); END;")
        .unwrap();
    let mut edit = content(&d);
    edit.change_reason = Some("Changed".into());
    assert!(store::update_draft(&mut conn, &v, &d.version.updated_at, edit.clone(), me("x")).is_err());
    conn.execute_batch("DROP TRIGGER fail_rules").unwrap();
    assert_eq!(store::get_version(&conn, &v).unwrap(), d);
    assert_eq!(count(&conn, "rulebook_events"), events_before);

    // The retry with the same revision then succeeds.
    assert_eq!(store::update_draft(&mut conn, &v, &d.version.updated_at, edit, me("Retry")).unwrap().version.change_reason.as_deref(), Some("Changed"));
}

#[test]
fn a_discarded_draft_is_kept_rejected_and_never_published() {
    let mut conn = seeded();
    let base = verified_100k(&mut conn);
    let d = store::create_draft_with(
        &mut conn,
        RulebookDraftInput {
            supersedes_version_id: Some(base.clone()),
            change_reason: Some("Trial".into()),
            ..draft(fixture_rules(0xa1), 0x43, 0x32)
        },
        me("Trial"),
    )
    .unwrap();
    let v = d.version.id.clone();
    let no_reason = ChangeContext { actor: "tester".into(), reason: None };
    assert_eq!(fields(store::discard_draft(&mut conn, &v, &d.version.updated_at, no_reason).unwrap_err()), ["reason"]);
    assert!(matches!(
        store::discard_draft(&mut conn, &v, "2020-01-01T00:00:00.000Z", me("Not needed")),
        Err(AppError::Conflict { .. })
    ));
    let gone = store::discard_draft(&mut conn, &v, &d.version.updated_at, me("Not needed")).unwrap();
    assert_eq!(gone.version.verification_status, "rejected");
    assert!(store::list_versions(&conn, &id(0x90)).unwrap().iter().any(|x| x.version.id == v), "kept in history");
    assert_eq!(fields(store::publish(&mut conn, &v, None).unwrap_err()), ["verificationStatus"]);
    assert!(matches!(
        store::discard_draft(&mut conn, &v, &gone.version.updated_at, me("Again")),
        Err(AppError::Conflict { .. })
    ));
    // A verified version can never be discarded.
    let verified = store::get_version(&conn, &base).unwrap();
    assert!(matches!(
        store::discard_draft(&mut conn, &base, &verified.version.updated_at, me("x")),
        Err(AppError::Conflict { .. })
    ));
    assert_eq!(store::get_version(&conn, &base).unwrap().version.verification_status, "verified");
}

#[test]
fn a_draft_whose_base_was_superseded_meanwhile_is_stale() {
    let mut conn = seeded();
    let v1 = verified_100k(&mut conn);
    let start = |conn: &mut Connection, why: &str| {
        store::create_draft(
            conn,
            RulebookDraftInput {
                supersedes_version_id: Some(v1.clone()),
                change_reason: Some(why.into()),
                ..draft(fixture_rules(0xa1), 0x43, 0x32)
            },
        )
        .unwrap()
        .version
        .id
    };
    let a = start(&mut conn, "First edit");
    let b = start(&mut conn, "Second edit");
    store::publish(&mut conn, &b, None).unwrap();
    // B is now the newer published version of the same base: A would hide it.
    let err = store::publish(&mut conn, &a, None).unwrap_err();
    assert!(matches!(&err, AppError::Conflict { message } if message.contains("start a new draft")), "{err:?}");
    assert_eq!(store::get_version(&conn, &a).unwrap().version.verification_status, "draft");
    // The safe path: discard A and draft again from the newest version.
    let ad = store::get_version(&conn, &a).unwrap();
    store::discard_draft(&mut conn, &a, &ad.version.updated_at, me("Superseded by version 5")).unwrap();
}

#[test]
fn assignment_is_guarded_by_what_the_caller_saw_and_audited() {
    let mut conn = seeded();
    let v1 = verified_100k(&mut conn);
    let acc = account(&mut conn, "Eval");
    let other = account(&mut conn, "Other");
    let guard = |open: Option<String>, why: &str| {
        Some(AssignmentGuard { expected_open_assignment_id: open, actor: "tester".into(), reason: Some(why.into()) })
    };
    let first = store::assign_with(&mut conn, assign(&acc, &v1, "2026-10-01"), guard(None, "Start of evaluation")).unwrap();

    // A second window still thinks there is no assignment: refused, nothing ends.
    assert!(matches!(
        store::assign_with(&mut conn, assign(&acc, &v1, "2026-10-12"), guard(None, "Stale")),
        Err(AppError::Conflict { .. })
    ));
    assert_eq!(store::list_assignments(&conn, &acc).unwrap()[0].effective_to, None);

    let pv = {
        let d = private_copy(&mut conn, &acc, &v1);
        store::publish(&mut conn, &d.version.id, None).unwrap().version.id
    };
    let second =
        store::assign_with(&mut conn, assign(&acc, &pv, "2026-10-12"), guard(Some(first.id.clone()), "My own limits")).unwrap();
    let history = store::list_assignments(&conn, &acc).unwrap();
    assert_eq!(history.len(), 2, "history is appended, not rewritten");
    assert_eq!((history[0].rulebook_version_id.as_str(), history[0].effective_to.as_deref()), (v1.as_str(), Some("2026-10-12")));
    assert_eq!(history[1].id, second.id);

    let log = store::list_events(&conn, &RulebookEventQuery { rulebook_id: None, account_id: Some(acc.clone()) }).unwrap();
    let assigned: Vec<_> = log.iter().filter(|e| e.action == "assigned").collect();
    assert_eq!(assigned.len(), 2);
    assert_eq!(assigned[0].assignment_id.as_deref(), Some(first.id.as_str()));
    assert_eq!(assigned[1].reason.as_deref(), Some("My own limits"));
    assert!(log.iter().any(|e| e.action == "draft_created"), "the account's private rulebook events are included");
    // Another account sees none of it.
    assert!(store::list_events(&conn, &RulebookEventQuery { rulebook_id: None, account_id: Some(other) }).unwrap().is_empty());
    assert_eq!(
        fields(store::list_events(&conn, &RulebookEventQuery { rulebook_id: None, account_id: None }).unwrap_err()),
        ["rulebookId"]
    );
}

#[test]
fn the_audit_log_is_append_only() {
    let mut conn = seeded();
    let v1 = verified_100k(&mut conn);
    assert!(count(&conn, "rulebook_events") >= 3);
    rejects(&conn, "UPDATE rulebook_events SET reason = 'rewritten'", "append-only");
    rejects(&conn, "DELETE FROM rulebook_events", "append-only");
    rejects(
        &conn,
        &format!(
            "INSERT INTO rulebook_events (id, rulebook_id, rulebook_version_id, action, actor, occurred_at)
             VALUES ('e', '{}', '{v1}', 'assigned', 'x', '2026-10-20T00:00:00.000Z')",
            id(0x90)
        ),
        "CHECK",
    );
}

#[test]
fn reading_risk_inputs_for_a_preview_writes_nothing() {
    let mut conn = seeded();
    let v1 = verified_100k(&mut conn);
    let acc = account(&mut conn, "Eval");
    store::assign(&mut conn, assign(&acc, &v1, "2026-10-01")).unwrap();
    let before: i64 = conn.query_row("SELECT total_changes()", [], |r| r.get(0)).unwrap();
    let query: crate::store::evidence::RiskInputsQuery = serde_json::from_value(json!({
        "accountId": acc, "asOf": "2026-10-20T20:00:00Z",
        "coverage": { "baseline": "incomplete", "closedTrades": "incomplete", "fees": "incomplete", "ledger": "incomplete",
                      "openPositions": "unsupported", "eodHistory": "missing", "intradayHistory": "unsupported",
                      "sourceReference": "Rulebook preview: nothing asserted" }
    }))
    .unwrap();
    let inputs = crate::store::evidence::risk_inputs(&mut conn, query).unwrap();
    assert_eq!(inputs["applicableAssignment"]["rulebookVersionId"], Value::String(v1));
    let after: i64 = conn.query_row("SELECT total_changes()", [], |r| r.get(0)).unwrap();
    assert_eq!(after, before);
}

/// A calculated snapshot written straight into the v14 table (nothing nullable yet).
fn legacy_snapshot(conn: &Connection, account: &str) {
    conn.execute(
        "INSERT INTO account_snapshots (id, account_id, trading_day, is_end_of_day, data_source, calculated_at,
                                        engine_version, inputs_hash, fees_included, unrealized_included, balance_micros,
                                        realized_day_pnl_micros, drawdown_locked, trading_days_completed, status,
                                        status_reasons_json, explanation_json)
         VALUES ('legacy-snap', ?1, '2026-10-19', 1, 'manual', '2026-10-19T21:00:00.000Z', 'legacy/1', 'h', 1, 0,
                 50000000000, 0, 0, 0, 'unknown', '[\"no engine\"]', '{\"note\":\"legacy\"}')",
        [account],
    )
    .unwrap();
}

fn version(conn: &Connection) -> u32 {
    conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap()
}

fn balance_nullable(conn: &Connection) -> bool {
    conn.query_row("SELECT \"notnull\" = 0 FROM pragma_table_info('account_snapshots') WHERE name = 'balance_micros'", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn migrations_15_and_16_upgrade_a_populated_v14_journal_in_order_and_roll_back_on_failure() {
    let mut conn = Connection::open_in_memory().unwrap();
    super::configure(&conn).unwrap();
    super::migrate_with(&mut conn, &super::MIGRATIONS[..14]).unwrap();
    let acc = crate::store::accounts::create(&mut conn, crate::store::tests::account_input("Keep")).unwrap();
    legacy_snapshot(&conn, &acc.id);
    // v14 → v15: nullable engine snapshots, rows kept.
    assert_eq!(super::migrate_with(&mut conn, &super::MIGRATIONS[..15]).unwrap(), 15);
    assert!(balance_nullable(&conn));
    // A blocker for v16 makes it fail; the journal stays at v15 with its rows.
    conn.execute_batch("CREATE TABLE rulebook_events (blocker INTEGER);").unwrap();
    assert!(super::migrate(&mut conn).is_err());
    assert_eq!(version(&conn), 15);
    assert_eq!(crate::store::accounts::get(&conn, &acc.id).unwrap(), acc);
    conn.execute_batch("DROP TABLE rulebook_events").unwrap();
    assert_eq!(super::migrate(&mut conn).unwrap(), 16);
    assert_eq!(count(&conn, "rulebook_events"), 0, "nothing is backfilled");
    assert_eq!(count(&conn, "account_snapshots"), 1);
    let kept = crate::store::snapshots::get(&conn, "legacy-snap").unwrap();
    assert_eq!((kept.balance.as_deref(), kept.trading_days_completed), (Some("50000"), Some(0)));
    assert_eq!(crate::store::accounts::get(&conn, &acc.id).unwrap(), acc);
    // Idempotent: a second run does nothing.
    assert_eq!(super::migrate(&mut conn).unwrap(), 16);
}

/// The unmerged Build 19 branch numbered the audit log 15. A journal it opened is at version 15
/// without nullable snapshots; migration 16 must repair that explicitly, keeping its events.
#[test]
fn migration_16_repairs_a_journal_that_reached_15_on_the_build_19_branch() {
    let mut conn = Connection::open_in_memory().unwrap();
    super::configure(&conn).unwrap();
    super::migrate_with(&mut conn, &super::MIGRATIONS[..14]).unwrap();
    let acc = crate::store::accounts::create(&mut conn, crate::store::tests::account_input("Branch")).unwrap();
    legacy_snapshot(&conn, &acc.id);
    // What the branch's migration 15 did: the audit log only.
    conn.execute_batch(include_str!("../../migrations/0016_rulebook_events.sql")).unwrap();
    conn.pragma_update(None, "user_version", 15).unwrap();
    let rb: String = conn.query_row("SELECT id FROM rulebooks LIMIT 1", [], |r| r.get(0)).unwrap_or_default();
    if !rb.is_empty() {
        conn.execute(
            "INSERT INTO rulebook_events (id, rulebook_id, rulebook_version_id, action, actor, occurred_at)
             VALUES ('e1', ?1, 'v', 'draft_created', 'local_user', '2026-10-20T00:00:00.000Z')",
            [&rb],
        )
        .unwrap();
    }
    let events_before = count(&conn, "rulebook_events");
    assert!(!balance_nullable(&conn));
    assert_eq!(super::migrate(&mut conn).unwrap(), 16);
    assert!(balance_nullable(&conn), "the skipped nullable snapshot rebuild was applied");
    assert_eq!(count(&conn, "rulebook_events"), events_before, "existing audit rows kept");
    assert_eq!(crate::store::snapshots::get(&conn, "legacy-snap").unwrap().balance.as_deref(), Some("50000"));
    rejects(&conn, "UPDATE account_snapshots SET status = 'safe'", "immutable");
    let triggers: i64 = conn
        .query_row("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_rulebook_events_%'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(triggers, 2, "append-only triggers in place");
}

#[test]
fn drafts_assignments_and_the_log_survive_a_restart() {
    let dir = std::env::temp_dir().join(format!("ff-b19-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("journal.db");
    let (v, saved_at, acc) = {
        let mut conn = super::open_file(&path).unwrap();
        let (_, fixture) = crate::parity::catalogue_fixture();
        super::catalogue_tests_save(&conn, &fixture);
        let base = verified_100k(&mut conn);
        let acc = account(&mut conn, "Eval");
        let d = private_copy(&mut conn, &acc, &base);
        let mut edit = content(&d);
        edit.change_reason = Some("Saved before closing".into());
        let saved = store::update_draft(&mut conn, &d.version.id, &d.version.updated_at, edit, me("Before restart")).unwrap();
        (saved.version.id, saved.version.updated_at, acc)
    };
    let mut conn = super::open_file(&path).unwrap();
    let back = store::get_version(&conn, &v).unwrap();
    assert_eq!((back.version.updated_at.as_str(), back.version.change_reason.as_deref()), (saved_at.as_str(), Some("Saved before closing")));
    // The reopened draft continues from the saved revision.
    let published = store::publish_with(&mut conn, &v, None, Some(&saved_at), me("After restart")).unwrap();
    store::assign_with(
        &mut conn,
        assign(&acc, &published.version.id, "2026-10-05"),
        Some(AssignmentGuard { expected_open_assignment_id: None, actor: "tester".into(), reason: Some("Restarted".into()) }),
    )
    .unwrap();
    drop(conn);
    let conn = super::open_file(&path).unwrap();
    let log = events(&conn, RulebookEventQuery { rulebook_id: None, account_id: Some(acc) });
    assert_eq!(log.iter().map(|e| e.0.as_str()).collect::<Vec<_>>(), ["draft_created", "draft_saved", "published", "assigned"]);
    drop(conn);
    let _ = std::fs::remove_dir_all(dir);
}

/// Generated ids and write times replaced by stable placeholders, consistently.
fn normalize(v: &mut Value, key: Option<&str>, ids: &mut std::collections::BTreeMap<String, String>) {
    match v {
        Value::Object(o) => o.iter_mut().for_each(|(k, value)| normalize(value, Some(k), ids)),
        Value::Array(a) => a.iter_mut().for_each(|value| normalize(value, None, ids)),
        Value::String(s) => {
            if matches!(key, Some("createdAt" | "updatedAt" | "occurredAt" | "assignedAt" | "verifiedAt" | "expectedUpdatedAt")) {
                *s = "2026-10-21T00:00:00.000Z".into();
            } else if uuid::Uuid::parse_str(s).is_ok() {
                let n = ids.len() + 1;
                *s = ids.entry(s.clone()).or_insert_with(|| format!("00000000-0000-4000-8000-{n:012}")).clone();
            }
        }
        _ => (),
    }
}

/// Real native outputs of the rulebook editor commands, replayed through the
/// desktop adapter by `src/lib/data/rulebook-wire.test.ts`. After an
/// intentional change: `FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --lib rulebook_command_wire`.
#[test]
fn rulebook_command_wire_fixture() {
    let mut c = seeded();
    let base = verified_100k(&mut c);
    let acc = account(&mut c, "Wire");
    let source = store::get_version(&c, &base).unwrap();
    let create_input = json!({
        "rulebookId": null,
        "newRulebook": { "providerId": source.rulebook.provider_id, "ownerAccountId": acc, "slug": "wire-rules",
                         "displayName": "Wire rules", "description": null },
        "supersedesVersionId": null, "changeReason": "Copied", "capturedAt": "2026-10-20T09:00:00Z",
        "effectiveFrom": null, "effectiveTo": null,
        "rules": source.rules.iter().map(|r| serde_json::to_value(&r.rule).unwrap()).collect::<Vec<_>>(),
        "applicability": [],
    });
    let context = json!({ "actor": "tester", "reason": "Start my rules" });
    let created = store::create_draft_with(&mut c, serde_json::from_value(create_input.clone()).unwrap(), me("Start my rules")).unwrap();
    let v = created.version.id.clone();
    let mut update = content(&created);
    update.change_reason = Some("Lower target".into());
    update.rules[0].parameters = json!({ "amount": { "state": "value", "value": "2500" }, "basis": "balance" });
    let save_context = json!({ "actor": "tester", "reason": "Lower target" });
    let saved = store::update_draft(&mut c, &v, &created.version.updated_at, update.clone(), me("Lower target")).unwrap();
    let issues = store::validate(&c, &v).unwrap();
    let publish_context = json!({ "actor": "tester", "reason": "Use it" });
    let published = store::publish_with(&mut c, &v, None, Some(&saved.version.updated_at), me("Use it")).unwrap();
    let assign_input = assign(&acc, &v, "2026-10-05");
    let guard = AssignmentGuard { expected_open_assignment_id: None, actor: "tester".into(), reason: Some("Assign".into()) };
    let assigned = store::assign_with(&mut c, assign_input.clone(), Some(guard.clone())).unwrap();
    let second = store::create_draft_with(
        &mut c,
        RulebookDraftInput {
            rulebook_id: Some(created.rulebook.id.clone()),
            new_rulebook: None,
            supersedes_version_id: Some(v.clone()),
            change_reason: Some("Try another".into()),
            ..serde_json::from_value(create_input.clone()).unwrap()
        },
        me("Try another"),
    )
    .unwrap();
    let discard_context = json!({ "actor": "tester", "reason": "Not needed" });
    let discarded = store::discard_draft(&mut c, &second.version.id, &second.version.updated_at, me("Not needed")).unwrap();
    let query = RulebookEventQuery { rulebook_id: None, account_id: Some(acc.clone()) };
    let mut payloads = json!([
        { "command": "list_rulebooks", "args": { "accountId": acc }, "output": store::list(&c, Some(&acc)).unwrap() },
        { "command": "create_rulebook_draft", "args": { "input": create_input, "context": context }, "output": created },
        { "command": "update_rulebook_draft", "args": { "id": v, "expectedUpdatedAt": created.version.updated_at, "input": update, "context": save_context }, "output": saved },
        { "command": "validate_rulebook_draft", "args": { "id": v }, "output": issues },
        { "command": "publish_rulebook_version", "args": { "id": v, "reviewer": null, "expectedUpdatedAt": saved.version.updated_at, "context": publish_context }, "output": published },
        { "command": "assign_rulebook_to_account", "args": { "input": assign_input, "guard": guard }, "output": assigned },
        { "command": "list_account_rulebook_assignments", "args": { "accountId": acc }, "output": store::list_assignments(&c, &acc).unwrap() },
        { "command": "discard_rulebook_draft", "args": { "id": second.version.id, "expectedUpdatedAt": second.version.updated_at, "context": discard_context }, "output": discarded },
        { "command": "list_rulebook_versions", "args": { "rulebookId": created.rulebook.id }, "output": store::list_versions(&c, &created.rulebook.id).unwrap() },
        { "command": "get_rulebook_version", "args": { "id": base }, "output": store::get_version(&c, &base).unwrap() },
        { "command": "list_rulebook_events", "args": { "query": query }, "output": store::list_events(&c, &query).unwrap() },
    ]);
    normalize(&mut payloads, None, &mut Default::default());
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/test/fixtures/rulebook-wire.json");
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some() {
        std::fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&payloads).unwrap())).unwrap();
    }
    let stored: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("generate the rulebook wire fixture deliberately")).unwrap();
    assert_eq!(stored, payloads);
}
