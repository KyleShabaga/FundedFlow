//! Rulebook operations (Build 9.5) against the catalogue fixture: drafts,
//! publication, verification, applicability, source conflicts, supersession
//! and account assignments, with the schema's triggers as the backstop.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::catalogue_tests::{id, rejects, seeded};
use crate::error::AppError;
use crate::rulebook::{
    ApplicabilityInput, ApplicableRulebookQuery, AssignmentInput, NewRulebook, RuleDefinitionInput, RulebookDraftInput,
    SourceConflictInput,
};
use crate::store::rulebooks as store;
use crate::store::{accounts, tests::account_input};

const FIXTURE: &str = include_str!("../../../../../packages/domain/test/fixtures/rulebook.json");

/// The fixture rules of one version, as draft inputs.
pub(super) fn fixture_rules(version: u32) -> Vec<RuleDefinitionInput> {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    f["rules"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["rulebookVersionId"] == id(version))
        .map(|r| {
            let mut r = r.clone();
            let o = r.as_object_mut().unwrap();
            o.remove("id");
            o.remove("rulebookVersionId");
            serde_json::from_value(r).unwrap()
        })
        .collect()
}

pub(super) fn draft(rules: Vec<RuleDefinitionInput>, phase: u32, catalogue_version: u32) -> RulebookDraftInput {
    RulebookDraftInput {
        rulebook_id: Some(id(0x90)),
        new_rulebook: None,
        supersedes_version_id: None,
        change_reason: None,
        captured_at: "2026-10-20T09:00:00Z".into(),
        effective_from: None,
        effective_to: None,
        rules,
        applicability: vec![ApplicabilityInput {
            catalogue_version_id: id(catalogue_version),
            programme_phase_id: id(phase),
            phase_path_id: None,
        }],
    }
}

pub(super) fn account(conn: &mut Connection, name: &str) -> String {
    accounts::create(conn, account_input(name)).unwrap().id
}

pub(super) fn assign(account_id: &str, version: &str, from: &str) -> AssignmentInput {
    AssignmentInput {
        account_id: account_id.into(),
        rulebook_version_id: version.into(),
        effective_from: from.into(),
        programme_phase_id: None,
        phase_path_id: None,
        account_phase_event_id: None,
    }
}

pub(super) fn fields(e: AppError) -> Vec<String> {
    match e {
        AppError::Validation { issues, .. } => issues.into_iter().map(|i| i.field).collect(),
        other => panic!("expected a validation error, got {other:?}"),
    }
}

/// A verified catalogue version for the 100K evaluation phase (0x43).
pub(super) fn verified_100k(conn: &mut Connection) -> String {
    let v = store::create_draft(conn, draft(fixture_rules(0xa1), 0x43, 0x32)).unwrap().version.id;
    store::publish(conn, &v, None).unwrap();
    store::publish(conn, &v, Some("kyle".into())).unwrap();
    v
}

#[test]
fn a_catalogue_version_is_reviewed_then_verified_and_frozen() {
    let mut conn = seeded();
    let d = store::create_draft(&mut conn, draft(fixture_rules(0xa1), 0x43, 0x32)).unwrap();
    let v = d.version.id.clone();
    assert_eq!((d.version.verification_status.as_str(), d.version.origin.as_str(), d.version.version_number), ("draft", "catalogue", 4));
    assert_eq!(d.rules.len(), 5);
    assert!(store::validate(&conn, &v).unwrap().is_empty());

    // A draft is published without a reviewer, then verified by one.
    assert_eq!(fields(store::publish(&mut conn, &v, Some("kyle".into())).unwrap_err()), ["reviewer"]);
    assert_eq!(store::publish(&mut conn, &v, None).unwrap().version.verification_status, "needs_review");
    rejects(&conn, &format!("UPDATE rule_definitions SET display_order = 9 WHERE rulebook_version_id = '{v}'"), "cannot change");
    assert_eq!(fields(store::publish(&mut conn, &v, None).unwrap_err()), ["reviewer"]);
    let verified = store::publish(&mut conn, &v, Some(" kyle ".into())).unwrap().version;
    assert_eq!((verified.verification_status.as_str(), verified.verified_by.as_deref()), ("verified", Some("kyle")));
    assert_eq!(fields(store::publish(&mut conn, &v, Some("kyle".into())).unwrap_err()), ["verificationStatus"]);

    // Verified content and its sign-off never change.
    rejects(&conn, &format!("UPDATE rulebook_versions SET change_reason = 'x' WHERE id = '{v}'"), "frozen");
    rejects(&conn, &format!("UPDATE rulebook_versions SET verified_by = 'someone' WHERE id = '{v}'"), "frozen");
    rejects(&conn, &format!("DELETE FROM rule_definitions WHERE rulebook_version_id = '{v}'"), "cannot change");
    rejects(&conn, &format!("DELETE FROM rule_applicability WHERE rulebook_version_id = '{v}'"), "cannot change");
    rejects(&conn, &format!("DELETE FROM rulebook_versions WHERE id = '{v}'"), "frozen");
    rejects(&conn, &format!("UPDATE rulebook_versions SET verification_status = 'needs_review' WHERE id = '{v}'"), "invalid");
}

#[test]
fn invalid_rules_and_applicability_are_rejected_before_writing() {
    let mut conn = seeded();
    let mut rules = fixture_rules(0xa1);
    rules[0].parameters = json!({ "amount": { "state": "value", "value": 3000 }, "basis": "unknown" });
    rules[1].support_status = "needs_setup".into();
    rules.push(rules[2].clone());
    assert_eq!(
        fields(store::create_draft(&mut conn, draft(rules, 0x43, 0x32)).unwrap_err()),
        ["rules[0].parameters", "rules[1].supportStatus", "rules[5].ruleKey"]
    );
    let before: i64 = conn.query_row("SELECT count(*) FROM rulebook_versions", [], |r| r.get(0)).unwrap();

    // Phase 0x43 is not in catalogue version 0x31; provider 2 does not publish this rulebook.
    assert!(matches!(store::create_draft(&mut conn, draft(fixture_rules(0xa1), 0x43, 0x31)), Err(AppError::Conflict { .. })));
    let mine = account(&mut conn, "Mine");
    let private = store::create_draft(&mut conn, RulebookDraftInput {
        rulebook_id: None,
        new_rulebook: Some(NewRulebook {
            provider_id: None,
            owner_account_id: Some(mine),
            slug: "mine".into(),
            display_name: "Mine".into(),
            description: None,
        }),
        ..draft(fixture_rules(0xa1), 0x43, 0x32)
    });
    assert_eq!(fields(private.unwrap_err()), ["applicability"]);
    let after: i64 = conn.query_row("SELECT count(*) FROM rulebook_versions", [], |r| r.get(0)).unwrap();
    assert_eq!(before, after, "nothing was written");
}

#[test]
fn applicable_rulebooks_resolve_by_binding_then_applicability_and_never_guess() {
    let mut conn = seeded();
    let q = |phase: u32, path: Option<u32>| ApplicableRulebookQuery {
        programme_phase_id: id(phase),
        phase_path_id: path.map(id),
    };
    // Bound by the phase default / path override, but not yet verified.
    let eval = store::applicable(&conn, &q(0x41, None)).unwrap();
    assert_eq!((eval.status, eval.rulebook_version_ids), ("unverified", vec![id(0xa1)]));
    assert_eq!(store::applicable(&conn, &q(0x42, Some(0x52))).unwrap().rulebook_version_ids, vec![id(0xa3)]);
    // No binding and no applicability: nothing is inferred.
    assert_eq!(store::applicable(&conn, &q(0x43, None)).unwrap().status, "none");

    let first = verified_100k(&mut conn);
    let one = store::applicable(&conn, &q(0x43, None)).unwrap();
    assert_eq!((one.status, one.rulebook_version_ids), ("resolved", vec![first.clone()]));
    verified_100k(&mut conn);
    assert_eq!(store::applicable(&conn, &q(0x43, None)).unwrap().status, "ambiguous");

    // Phase and path references must name an existing catalogue rulebook version.
    rejects(&conn, &format!("UPDATE programme_phases SET default_rulebook_version_id = 'nope' WHERE id = '{}'", id(0x43)), "existing");
}

#[test]
fn assignments_are_explicit_dated_history() {
    let mut conn = seeded();
    let acc = account(&mut conn, "Eval");
    let v1 = verified_100k(&mut conn);

    // An unverified catalogue version cannot be assigned.
    let draft_v = store::create_draft(&mut conn, draft(fixture_rules(0xa1), 0x43, 0x32)).unwrap().version.id;
    assert_eq!(fields(store::assign(&mut conn, assign(&acc, &draft_v, "2026-10-01")).unwrap_err()), ["rulebookVersionId"]);
    assert_eq!(fields(store::assign(&mut conn, assign(&acc, &v1, "2026-10-1")).unwrap_err()), ["effectiveFrom"]);

    let a1 = store::assign(&mut conn, AssignmentInput { programme_phase_id: Some(id(0x43)), ..assign(&acc, &v1, "2026-10-01") }).unwrap();
    assert_eq!((a1.assignment_source.as_str(), a1.effective_to.as_deref()), ("catalogue_selection", None));
    // A version that does not apply to the phase is refused.
    assert_eq!(
        fields(store::assign(&mut conn, AssignmentInput { programme_phase_id: Some(id(0x41)), ..assign(&acc, &v1, "2026-10-05") }).unwrap_err()),
        ["programmePhaseId"]
    );

    // A newer verified version is never switched in by itself.
    let v2 = verified_100k(&mut conn);
    assert_eq!(store::list_assignments(&conn, &acc).unwrap().len(), 1);
    store::assign(&mut conn, assign(&acc, &v2, "2026-10-10")).unwrap();
    let history = store::list_assignments(&conn, &acc).unwrap();
    let spans: Vec<(&str, Option<&str>)> = history.iter().map(|a| (a.effective_from.as_str(), a.effective_to.as_deref())).collect();
    assert_eq!(spans, [("2026-10-01", Some("2026-10-10")), ("2026-10-10", None)]);
    assert!(matches!(store::assign(&mut conn, assign(&acc, &v1, "2026-10-10")), Err(AppError::Conflict { .. })));
    assert!(matches!(store::assign(&mut conn, assign(&acc, &v1, "2026-09-01")), Err(AppError::Conflict { .. })));
    rejects(&conn, &format!("UPDATE account_rulebook_assignments SET effective_from = '2026-09-01' WHERE id = '{}'", a1.id), "history");

    // A private rulebook serves only its own account, once published.
    let other = account(&mut conn, "Other");
    let mut personal = fixture_rules(0xa1);
    personal.truncate(1);
    let private = store::create_draft(&mut conn, RulebookDraftInput {
        rulebook_id: None,
        new_rulebook: Some(NewRulebook {
            provider_id: None,
            owner_account_id: Some(other.clone()),
            slug: "other-rules".into(),
            display_name: "Other's rules".into(),
            description: None,
        }),
        applicability: vec![],
        ..draft(personal, 0x43, 0x32)
    })
    .unwrap();
    let pv = private.version.id;
    assert_eq!(private.version.origin, "user_authored");
    assert_eq!(fields(store::assign(&mut conn, assign(&other, &pv, "2026-10-01")).unwrap_err()), ["rulebookVersionId"]);
    store::publish(&mut conn, &pv, None).unwrap();
    assert_eq!(fields(store::publish(&mut conn, &pv, Some("kyle".into())).unwrap_err()), ["verificationStatus"]);
    assert_eq!(fields(store::assign(&mut conn, assign(&acc, &pv, "2026-11-01")).unwrap_err()), ["rulebookVersionId"]);
    store::assign(&mut conn, assign(&other, &pv, "2026-10-01")).unwrap();
}

#[test]
fn a_conflict_makes_a_verified_version_stale_until_a_correction_supersedes_it() {
    let mut conn = seeded();
    let v1 = verified_100k(&mut conn);
    let rule_id = store::get_version(&conn, &v1).unwrap().rules[0].id.clone();
    let claim = store::flag_conflict(&mut conn, SourceConflictInput {
        rule_definition_id: rule_id,
        source_id: id(0x91),
        field: Some("amount".into()),
        provider_text: Some("Profit Target $2,500".into()),
        note: "Help centre now says $2,500".into(),
    })
    .unwrap();
    assert_eq!(claim.claim_status, "conflicting");
    let stale = store::get_version(&conn, &v1).unwrap();
    assert_eq!(stale.version.verification_status, "stale");
    assert_eq!(fields(store::publish(&mut conn, &v1, Some("kyle".into())).unwrap_err()), ["verificationStatus"]);
    // A stale version is never reopened for review.
    rejects(&conn, &format!("UPDATE rulebook_versions SET verification_status = 'needs_review' WHERE id = '{v1}'"), "invalid");

    let mut corrected = fixture_rules(0xa1);
    corrected[0].parameters = json!({ "amount": { "state": "value", "value": "2500" }, "basis": "unknown" });
    let v2 = store::create_draft(&mut conn, RulebookDraftInput {
        supersedes_version_id: Some(v1.clone()),
        change_reason: Some("Profit target lowered".into()),
        ..draft(corrected, 0x43, 0x32)
    })
    .unwrap()
    .version
    .id;
    store::publish(&mut conn, &v2, None).unwrap();
    store::publish(&mut conn, &v2, Some("kyle".into())).unwrap();
    assert_eq!(store::get_version(&conn, &v1).unwrap().version.verification_status, "superseded");
    assert_eq!(store::list_versions(&conn, &id(0x90)).unwrap()[0].version.id, v2);

    // A correction without a reason is refused.
    let no_reason = RulebookDraftInput { supersedes_version_id: Some(v2), ..draft(fixture_rules(0xa1), 0x43, 0x32) };
    assert_eq!(fields(store::create_draft(&mut conn, no_reason).unwrap_err()), ["changeReason"]);
}
