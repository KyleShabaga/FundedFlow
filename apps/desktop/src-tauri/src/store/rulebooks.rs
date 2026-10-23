//! Rulebooks (Build 9.5): drafts, publication, verification, applicability,
//! source conflicts and account assignments. Each operation validates first
//! and writes in one transaction; the triggers in `0009_rulebooks.sql` enforce
//! freezing and assignment validity again at the database.
//!
//! Mirrored by `RulebookRepository` in packages/domain/src/ports.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{new_id, now, parse_instant};
use crate::error::{AppError, AppResult, FieldIssue, Issues};
use crate::rulebook::{
    check_rule_definitions, AccountRulebookAssignment, ApplicabilityInput, ApplicableRulebook, ApplicableRulebookQuery,
    AssignmentGuard, AssignmentInput, ChangeContext, RuleApplicability, RuleClaim, RuleDefinition, RuleDefinitionInput,
    Rulebook, RulebookDraftInput, RulebookDraftUpdate, RulebookEvent, RulebookEventQuery, RulebookVersion,
    RulebookVersionDetail, SourceConflictInput, RULE_PARAMETER_SCHEMA_VERSION,
};
use crate::store::opt_text;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const RULEBOOK: &str = "SELECT id, provider_id, owner_account_id, slug, display_name, description, record_status,
                               created_at, updated_at FROM rulebooks";

fn rulebook_row(r: &Row) -> rusqlite::Result<Rulebook> {
    Ok(Rulebook {
        id: r.get(0)?,
        provider_id: r.get(1)?,
        owner_account_id: r.get(2)?,
        slug: r.get(3)?,
        display_name: r.get(4)?,
        description: r.get(5)?,
        record_status: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

const VERSION: &str = "SELECT id, rulebook_id, version_number, schema_version, verification_status, origin, captured_at,
                              effective_from, effective_to, verified_by, verified_at, user_confirmed_at, change_reason,
                              supersedes_version_id, record_status, created_at, updated_at FROM rulebook_versions";

fn version_row(r: &Row) -> rusqlite::Result<RulebookVersion> {
    Ok(RulebookVersion {
        id: r.get(0)?,
        rulebook_id: r.get(1)?,
        version_number: r.get(2)?,
        schema_version: r.get(3)?,
        verification_status: r.get(4)?,
        origin: r.get(5)?,
        captured_at: r.get(6)?,
        effective_from: r.get(7)?,
        effective_to: r.get(8)?,
        verified_by: r.get(9)?,
        verified_at: r.get(10)?,
        user_confirmed_at: r.get(11)?,
        change_reason: r.get(12)?,
        supersedes_version_id: r.get(13)?,
        record_status: r.get(14)?,
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
    })
}

const ASSIGNMENT: &str = "SELECT id, account_id, rulebook_version_id, programme_phase_id, phase_path_id,
                                 account_phase_event_id, effective_from, effective_to, assigned_at, assignment_source
                          FROM account_rulebook_assignments";

fn assignment_row(r: &Row) -> rusqlite::Result<AccountRulebookAssignment> {
    Ok(AccountRulebookAssignment {
        id: r.get(0)?,
        account_id: r.get(1)?,
        rulebook_version_id: r.get(2)?,
        programme_phase_id: r.get(3)?,
        phase_path_id: r.get(4)?,
        account_phase_event_id: r.get(5)?,
        effective_from: r.get(6)?,
        effective_to: r.get(7)?,
        assigned_at: r.get(8)?,
        assignment_source: r.get(9)?,
    })
}

fn all<T>(conn: &Connection, sql: &str, p: impl rusqlite::Params, map: fn(&Row) -> rusqlite::Result<T>) -> AppResult<Vec<T>> {
    Ok(conn.prepare(sql)?.query_map(p, map)?.collect::<rusqlite::Result<_>>()?)
}

/// Catalogue rulebooks, plus the account's private ones when `account_id` is given.
pub fn list(conn: &Connection, account_id: Option<&str>) -> AppResult<Vec<Rulebook>> {
    all(
        conn,
        &format!("{RULEBOOK} WHERE owner_account_id IS NULL OR owner_account_id = ?1 ORDER BY display_name, id"),
        [account_id],
        rulebook_row,
    )
}

pub fn get_version(conn: &Connection, id: &str) -> AppResult<RulebookVersionDetail> {
    let version = conn
        .query_row(&format!("{VERSION} WHERE id = ?1"), [id], version_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("rulebook version", id))?;
    let rulebook = conn.query_row(&format!("{RULEBOOK} WHERE id = ?1"), [&version.rulebook_id], rulebook_row)?;
    let rules = all(
        conn,
        "SELECT id, rulebook_version_id, rule_key, rule_type, parameter_schema_version, provider_label, display_label,
                source_text, support_status, override_kind, display_order, parameters_json
         FROM rule_definitions WHERE rulebook_version_id = ?1 ORDER BY display_order, rule_key",
        [id],
        |r| {
            let parameters: String = r.get(11)?;
            Ok(RuleDefinition {
                id: r.get(0)?,
                rulebook_version_id: r.get(1)?,
                rule: RuleDefinitionInput {
                    rule_key: r.get(2)?,
                    rule_type: r.get(3)?,
                    parameter_schema_version: r.get(4)?,
                    provider_label: r.get(5)?,
                    display_label: r.get(6)?,
                    source_text: r.get(7)?,
                    support_status: r.get(8)?,
                    override_kind: r.get(9)?,
                    display_order: r.get(10)?,
                    parameters: serde_json::from_str(&parameters).unwrap_or(serde_json::Value::Null),
                },
            })
        },
    )?;
    let applicability = all(
        conn,
        "SELECT id, rulebook_version_id, catalogue_version_id, programme_phase_id, phase_path_id
         FROM rule_applicability WHERE rulebook_version_id = ?1 ORDER BY programme_phase_id, phase_path_id",
        [id],
        |r| {
            Ok(RuleApplicability {
                id: r.get(0)?,
                rulebook_version_id: r.get(1)?,
                catalogue_version_id: r.get(2)?,
                programme_phase_id: r.get(3)?,
                phase_path_id: r.get(4)?,
            })
        },
    )?;
    let claims = all(
        conn,
        "SELECT c.id, c.rule_definition_id, c.source_id, c.field, c.origin, c.provider_text, c.claim_status, c.note,
                c.reviewed_by, c.reviewed_at, c.created_at
         FROM rule_claims c JOIN rule_definitions d ON d.id = c.rule_definition_id
         WHERE d.rulebook_version_id = ?1 ORDER BY c.created_at, c.id",
        [id],
        |r| {
            Ok(RuleClaim {
                id: r.get(0)?,
                rule_definition_id: r.get(1)?,
                source_id: r.get(2)?,
                field: r.get(3)?,
                origin: r.get(4)?,
                provider_text: r.get(5)?,
                claim_status: r.get(6)?,
                note: r.get(7)?,
                reviewed_by: r.get(8)?,
                reviewed_at: r.get(9)?,
                created_at: r.get(10)?,
            })
        },
    )?;
    Ok(RulebookVersionDetail { rulebook, version, rules, applicability, claims })
}

/// Every version of a rulebook, newest first.
pub fn list_versions(conn: &Connection, rulebook_id: &str) -> AppResult<Vec<RulebookVersionDetail>> {
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM rulebook_versions WHERE rulebook_id = ?1 ORDER BY version_number DESC")?
        .query_map([rulebook_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    ids.iter().map(|id| get_version(conn, id)).collect()
}

pub fn list_assignments(conn: &Connection, account_id: &str) -> AppResult<Vec<AccountRulebookAssignment>> {
    all(conn, &format!("{ASSIGNMENT} WHERE account_id = ?1 ORDER BY effective_from"), [account_id], assignment_row)
}

/// The verified catalogue version that governs a phase, or a path of it. An
/// explicit binding (path override, then the phase default) wins; otherwise
/// the applicability rows for exactly that phase and path. Never inferred
/// from names, and never another phase's or path's rules.
pub fn applicable(conn: &Connection, q: &ApplicableRulebookQuery) -> AppResult<ApplicableRulebook> {
    let phase: Option<(Option<String>, String)> = conn
        .query_row("SELECT ph.default_rulebook_version_id, pv.provider_id FROM programme_phases ph
            JOIN catalogue_versions cv ON cv.id = ph.catalogue_version_id
            JOIN programme_variants pv ON pv.id = cv.programme_variant_id WHERE ph.id = ?1",
            [&q.programme_phase_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let (phase_default, provider) = phase.ok_or_else(|| AppError::not_found("programme phase", &q.programme_phase_id))?;
    let path_override = match &q.phase_path_id {
        None => None,
        Some(path) => conn
            .query_row(
                "SELECT rulebook_version_id FROM phase_paths WHERE id = ?1 AND programme_phase_id = ?2",
                [path, &q.programme_phase_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .ok_or_else(|| AppError::not_found("phase path", path))?,
    };
    let verified = |id: &str| -> AppResult<bool> {
        Ok(conn
            .query_row("SELECT v.verification_status = 'verified' AND v.record_status = 'active'
                AND b.record_status = 'active' AND b.owner_account_id IS NULL AND b.provider_id = ?2
                FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id WHERE v.id = ?1",
                [id, &provider], |r| r.get(0))
            .optional()?
            .unwrap_or(false))
    };
    if let Some(bound) = path_override.or(phase_default) {
        let status = if verified(&bound)? { "resolved" } else { "unverified" };
        return Ok(ApplicableRulebook { status, rulebook_version_ids: vec![bound] });
    }
    let ids: Vec<String> = conn
        .prepare(
            "SELECT a.rulebook_version_id FROM rule_applicability a
             JOIN rulebook_versions v ON v.id = a.rulebook_version_id
             JOIN rulebooks b ON b.id = v.rulebook_id
             WHERE a.programme_phase_id = ?1 AND a.phase_path_id IS ?2 AND v.verification_status = 'verified'
               AND v.record_status = 'active' AND b.record_status = 'active' AND b.provider_id = ?3
             ORDER BY a.rulebook_version_id",
        )?
        .query_map(params![q.programme_phase_id, q.phase_path_id, provider], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let status = match ids.len() {
        0 => "none",
        1 => "resolved",
        _ => "ambiguous",
    };
    Ok(ApplicableRulebook { status, rulebook_version_ids: ids })
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

fn require_writable_owner(conn: &Connection, rulebook: &Rulebook) -> AppResult<()> {
    if let Some(owner) = &rulebook.owner_account_id {
        super::account_ctx(conn, owner)?;
    }
    Ok(())
}

fn check_instant(issues: &mut Issues, field: &str, value: Option<&str>) {
    if value.is_some_and(|v| parse_instant(v).is_none()) {
        issues.add(field, "Use an ISO 8601 instant with an offset");
    }
}

fn stored(value: &str) -> String {
    parse_instant(value).map(crate::domain::format_instant).unwrap_or_else(|| value.to_string())
}

/// Create a draft version: of an existing rulebook, or of a new one. A
/// private rulebook's draft never has catalogue applicability.
///
/// Test convenience: the same with the default `local_user` audit context.
#[cfg(test)]
pub fn create_draft(conn: &mut Connection, input: RulebookDraftInput) -> AppResult<RulebookVersionDetail> {
    create_draft_with(conn, input, ChangeContext::local())
}

/// Checks shared by a new draft and a saved one.
fn check_draft_content(
    issues: &mut Issues,
    captured_at: &str,
    effective_from: Option<&str>,
    effective_to: Option<&str>,
    rules: &[RuleDefinitionInput],
) {
    check_instant(issues, "capturedAt", Some(captured_at));
    check_instant(issues, "effectiveFrom", effective_from);
    check_instant(issues, "effectiveTo", effective_to);
    let window = (effective_from.and_then(parse_instant), effective_to.and_then(parse_instant));
    if let (Some(from), Some(to)) = window
        && to <= from
    {
        issues.add("effectiveTo", "Must be after effectiveFrom");
    }
    issues.0.extend(check_rule_definitions(rules));
}

fn check_context(context: &ChangeContext) -> AppResult<()> {
    let actor = context.actor.trim();
    if actor.is_empty() || actor.chars().count() > 200 {
        return Err(AppError::invalid("actor", "Name who is making the change (at most 200 characters)"));
    }
    if context.reason.as_ref().is_some_and(|r| r.chars().count() > 2_000) {
        return Err(AppError::invalid("reason", "Use at most 2,000 characters"));
    }
    Ok(())
}

/// One append-only audit row, written in the caller's transaction.
pub(crate) fn record_event(
    conn: &Connection,
    version_id: &str,
    action: &str,
    context: &ChangeContext,
    account: Option<(&str, Option<&str>)>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO rulebook_events (id, rulebook_id, rulebook_version_id, account_id, assignment_id, action, actor,
                                      reason, occurred_at)
         SELECT ?1, rulebook_id, id, ?3, ?4, ?5, ?6, ?7, ?8 FROM rulebook_versions WHERE id = ?2",
        params![
            new_id(),
            version_id,
            account.map(|a| a.0),
            account.and_then(|a| a.1),
            action,
            context.actor.trim(),
            opt_text(context.reason.clone()),
            now()
        ],
    )?;
    Ok(())
}

fn insert_content(
    tx: &Connection,
    version_id: &str,
    rules: &[RuleDefinitionInput],
    applicability: &[ApplicabilityInput],
    at: &str,
) -> AppResult<()> {
    for rule in rules {
        tx.execute(
            "INSERT INTO rule_definitions (id, rulebook_version_id, rule_key, rule_type, parameter_schema_version,
                                           parameters_json, provider_label, display_label, source_text, support_status,
                                           override_kind, display_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
            params![
                new_id(),
                version_id,
                rule.rule_key,
                rule.rule_type,
                rule.parameter_schema_version,
                rule.parameters.to_string(),
                rule.provider_label,
                opt_text(rule.display_label.clone()),
                rule.source_text,
                rule.support_status,
                rule.override_kind,
                rule.display_order,
                at
            ],
        )?;
    }
    for a in applicability {
        tx.execute(
            "INSERT INTO rule_applicability (id, rulebook_version_id, catalogue_version_id, programme_phase_id, phase_path_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![new_id(), version_id, a.catalogue_version_id, a.programme_phase_id, a.phase_path_id],
        )?;
    }
    Ok(())
}

/// `create_draft`, recording who created it and why.
pub fn create_draft_with(
    conn: &mut Connection,
    input: RulebookDraftInput,
    context: ChangeContext,
) -> AppResult<RulebookVersionDetail> {
    let mut issues = Issues::default();
    if input.rulebook_id.is_some() == input.new_rulebook.is_some() {
        issues.add("rulebookId", "Give either an existing rulebook or a new one");
    }
    check_draft_content(
        &mut issues,
        &input.captured_at,
        input.effective_from.as_deref(),
        input.effective_to.as_deref(),
        &input.rules,
    );
    issues.into_result()?;
    check_context(&context)?;

    let at = now();
    let tx = conn.transaction()?;
    let rulebook_id = match (&input.rulebook_id, &input.new_rulebook) {
        (Some(id), _) => {
            let status: Option<String> =
                tx.query_row("SELECT record_status FROM rulebooks WHERE id = ?1", [id], |r| r.get(0)).optional()?;
            match status.as_deref() {
                None => return Err(AppError::not_found("rulebook", id)),
                Some("archived") => return Err(AppError::invalid("rulebookId", "The rulebook is archived")),
                _ => id.clone(),
            }
        }
        (None, Some(new)) => {
            if new.owner_account_id.is_none() && new.provider_id.is_none() {
                return Err(AppError::invalid("newRulebook.providerId", "A catalogue rulebook belongs to a provider"));
            }
            let id = new_id();
            tx.execute(
                "INSERT INTO rulebooks (id, provider_id, owner_account_id, slug, display_name, description, record_status,
                                        created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)",
                params![id, new.provider_id, new.owner_account_id, new.slug, new.display_name.trim(),
                        opt_text(new.description.clone()), at],
            )?;
            id
        }
        (None, None) => unreachable!("checked above"),
    };
    let private: bool =
        tx.query_row("SELECT owner_account_id IS NOT NULL FROM rulebooks WHERE id = ?1", [&rulebook_id], |r| r.get(0))?;
    let owner: Option<String> = tx.query_row("SELECT owner_account_id FROM rulebooks WHERE id = ?1", [&rulebook_id], |r| r.get(0))?;
    if let Some(owner) = owner {
        super::account_ctx(&tx, &owner)?;
    }
    if private && !input.applicability.is_empty() {
        return Err(AppError::invalid("applicability", "An account-private rulebook does not apply to catalogue phases"));
    }
    if let Some(prev) = &input.supersedes_version_id {
        let same: Option<bool> = tx
            .query_row("SELECT rulebook_id = ?2 FROM rulebook_versions WHERE id = ?1", [prev, &rulebook_id], |r| r.get(0))
            .optional()?;
        if same != Some(true) {
            return Err(AppError::invalid("supersedesVersionId", "Supersede a version of the same rulebook"));
        }
        if opt_text(input.change_reason.clone()).is_none() {
            return Err(AppError::invalid("changeReason", "A superseding version needs a reason"));
        }
    }
    let number: i64 = tx.query_row(
        "SELECT coalesce(max(version_number), 0) + 1 FROM rulebook_versions WHERE rulebook_id = ?1",
        [&rulebook_id],
        |r| r.get(0),
    )?;
    let id = new_id();
    tx.execute(
        "INSERT INTO rulebook_versions (id, rulebook_id, version_number, schema_version, verification_status, origin,
                                        captured_at, effective_from, effective_to, change_reason, supersedes_version_id,
                                        record_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, ?11)",
        params![
            id,
            rulebook_id,
            number,
            RULE_PARAMETER_SCHEMA_VERSION,
            if private { "user_authored" } else { "catalogue" },
            stored(&input.captured_at),
            input.effective_from.as_deref().map(stored),
            input.effective_to.as_deref().map(stored),
            opt_text(input.change_reason.clone()),
            input.supersedes_version_id,
            at
        ],
    )?;
    insert_content(&tx, &id, &input.rules, &input.applicability, &at)?;
    record_event(&tx, &id, "draft_created", &ChangeContext { reason: context.reason.clone().or(input.change_reason.clone()), ..context }, None)?;
    tx.commit()?;
    get_version(conn, &id)
}

/// What stops this version from being published now (`checkPublish` without
/// the reviewer). Empty means `publish` will succeed given a reviewer when
/// one is needed.
pub fn validate(conn: &Connection, id: &str) -> AppResult<Vec<FieldIssue>> {
    let detail = get_version(conn, id)?;
    Ok(publish_issues(&detail, None).into_iter().filter(|i| i.field != "reviewer").collect())
}

fn publish_issues(d: &RulebookVersionDetail, reviewer: Option<&str>) -> Vec<FieldIssue> {
    let rules: Vec<RuleDefinitionInput> = d.rules.iter().map(|r| r.rule.clone()).collect();
    let mut issues = check_rule_definitions(&rules);
    let private = d.rulebook.owner_account_id.is_some();
    let reviewer = reviewer.map(str::trim).filter(|r| !r.is_empty());
    if d.version.record_status != "active" {
        issues.push(FieldIssue::new("recordStatus", "The version is archived"));
    }
    match d.version.verification_status.as_str() {
        "draft" => {
            if reviewer.is_some() {
                issues.push(FieldIssue::new("reviewer", "Publish the draft first, then verify it"));
            }
            if private && !d.applicability.is_empty() {
                issues.push(FieldIssue::new("applicability", "An account-private rulebook does not apply to catalogue phases"));
            }
        }
        "needs_review" if !private => {
            if reviewer.is_none() {
                issues.push(FieldIssue::new("reviewer", "Verifying needs a reviewer"));
            }
            if d.applicability.is_empty() {
                issues.push(FieldIssue::new("applicability", "Say which phase or path the version applies to"));
            }
            if d.claims.iter().any(|c| c.claim_status == "conflicting") {
                issues.push(FieldIssue::new("claims", "Resolve the conflicting source claims first"));
            }
        }
        other => issues.push(FieldIssue::new("verificationStatus", format!("A {other} version cannot be published"))),
    }
    issues
}

/// Publish one step: a draft becomes `needs_review` (for a private rulebook
/// that puts it in use and records the user's confirmation, `user_confirmed_at`); a catalogue version in review becomes `verified`
/// with the named reviewer, and the version it supersedes is marked superseded.
///
/// Test convenience: the same with the default `local_user` audit context.
#[cfg(test)]
pub fn publish(conn: &mut Connection, id: &str, reviewer: Option<String>) -> AppResult<RulebookVersionDetail> {
    publish_with(conn, id, reviewer, None, ChangeContext::local())
}

/// The version as last read by the caller. A different `updated_at` means
/// someone else changed it since: a conflict, never a silent overwrite.
fn check_revision(detail: &RulebookVersionDetail, expected_updated_at: Option<&str>) -> AppResult<()> {
    match expected_updated_at {
        Some(expected) if parse_instant(expected) != parse_instant(&detail.version.updated_at) => Err(AppError::Conflict {
            message: format!(
                "rulebook version {} changed since it was opened; reload it before saving",
                detail.version.version_number
            ),
        }),
        _ => Ok(()),
    }
}

/// A draft that supersedes `S` is stale once another version newer than `S`
/// has been published: publishing it would hide those terms.
fn check_base_current(conn: &Connection, detail: &RulebookVersionDetail) -> AppResult<()> {
    let Some(base) = &detail.version.supersedes_version_id else { return Ok(()) };
    let newer: Option<i64> = conn
        .query_row(
            "SELECT v.version_number FROM rulebook_versions v JOIN rulebook_versions b ON b.id = ?2
             WHERE v.rulebook_id = b.rulebook_id AND v.id <> ?1 AND v.version_number > b.version_number
               AND v.verification_status NOT IN ('draft', 'rejected')
             ORDER BY v.version_number DESC LIMIT 1",
            params![detail.version.id, base],
            |r| r.get(0),
        )
        .optional()?;
    match newer {
        Some(n) => Err(AppError::Conflict {
            message: format!("version {n} was published after this draft was started; start a new draft from it"),
        }),
        None => Ok(()),
    }
}

/// `updated_at` for a write: now, but always later than the previous value,
/// so two saves within one millisecond still change the revision.
fn next_revision(previous: &str) -> String {
    let at = chrono::Utc::now();
    match parse_instant(previous) {
        Some(prev) if prev >= at => crate::domain::format_instant(prev + chrono::Duration::milliseconds(1)),
        _ => crate::domain::format_instant(at),
    }
}

/// `publish`, refusing a version changed since `expected_updated_at` or a
/// draft whose base was superseded meanwhile, and recording who and why.
pub fn publish_with(
    conn: &mut Connection,
    id: &str,
    reviewer: Option<String>,
    expected_updated_at: Option<&str>,
    context: ChangeContext,
) -> AppResult<RulebookVersionDetail> {
    check_context(&context)?;
    let tx = conn.transaction()?;
    let detail = get_version(&tx, id)?;
    require_writable_owner(&tx, &detail.rulebook)?;
    check_revision(&detail, expected_updated_at)?;
    let issues = publish_issues(&detail, reviewer.as_deref());
    if !issues.is_empty() {
        return Err(AppError::validation(issues));
    }
    let at = next_revision(&detail.version.updated_at);
    if detail.version.verification_status == "draft" {
        check_base_current(&tx, &detail)?;
        // Publishing the account's own rules is the user's confirmation of them (the engine needs
        // it); it can only be recorded now, while the version is still a draft.
        let private = detail.rulebook.owner_account_id.is_some();
        tx.execute(
            "UPDATE rulebook_versions SET verification_status = 'needs_review', updated_at = ?2,
                                          user_confirmed_at = CASE WHEN ?3 THEN ?2 ELSE user_confirmed_at END
             WHERE id = ?1",
            params![id, at, private],
        )?;
        record_event(&tx, id, "published", &context, None)?;
    } else {
        tx.execute(
            "UPDATE rulebook_versions SET verification_status = 'verified', verified_by = ?2, verified_at = ?3, updated_at = ?3
             WHERE id = ?1",
            params![id, reviewer.as_deref().map(str::trim), at],
        )?;
        if let Some(prev) = &detail.version.supersedes_version_id {
            tx.execute(
                "UPDATE rulebook_versions SET verification_status = 'superseded', updated_at = ?2
                 WHERE id = ?1 AND verification_status IN ('verified', 'stale')",
                params![prev, at],
            )?;
        }
        record_event(&tx, id, "verified", &context, None)?;
    }
    tx.commit()?;
    get_version(conn, id)
}

/// Replace a never-published draft's rules, applicability, dates and reason.
/// `expected_updated_at` is the draft as the caller last read it; any later
/// change (another window, a publish, a discard) is a conflict.
pub fn update_draft(
    conn: &mut Connection,
    id: &str,
    expected_updated_at: &str,
    input: RulebookDraftUpdate,
    context: ChangeContext,
) -> AppResult<RulebookVersionDetail> {
    let mut issues = Issues::default();
    check_draft_content(
        &mut issues,
        &input.captured_at,
        input.effective_from.as_deref(),
        input.effective_to.as_deref(),
        &input.rules,
    );
    issues.into_result()?;
    check_context(&context)?;
    let tx = conn.transaction()?;
    let detail = get_version(&tx, id)?;
    require_writable_owner(&tx, &detail.rulebook)?;
    if detail.version.verification_status != "draft" || detail.version.verified_at.is_some() {
        return Err(AppError::Conflict {
            message: format!(
                "version {} is {} and can no longer be edited; start a new draft from it",
                detail.version.version_number, detail.version.verification_status
            ),
        });
    }
    check_revision(&detail, Some(expected_updated_at))?;
    if detail.rulebook.owner_account_id.is_some() && !input.applicability.is_empty() {
        return Err(AppError::invalid("applicability", "An account-private rulebook does not apply to catalogue phases"));
    }
    if detail.version.supersedes_version_id.is_some() && opt_text(input.change_reason.clone()).is_none() {
        return Err(AppError::invalid("changeReason", "A superseding version needs a reason"));
    }
    let at = next_revision(&detail.version.updated_at);
    tx.execute(
        "DELETE FROM rule_claims WHERE rule_definition_id IN (SELECT id FROM rule_definitions WHERE rulebook_version_id = ?1)",
        [id],
    )?;
    tx.execute("DELETE FROM rule_definitions WHERE rulebook_version_id = ?1", [id])?;
    tx.execute("DELETE FROM rule_applicability WHERE rulebook_version_id = ?1", [id])?;
    tx.execute(
        "UPDATE rulebook_versions SET captured_at = ?2, effective_from = ?3, effective_to = ?4, change_reason = ?5,
                                      updated_at = ?6
         WHERE id = ?1",
        params![
            id,
            stored(&input.captured_at),
            input.effective_from.as_deref().map(stored),
            input.effective_to.as_deref().map(stored),
            opt_text(input.change_reason.clone()),
            at
        ],
    )?;
    insert_content(&tx, id, &input.rules, &input.applicability, &at)?;
    record_event(&tx, id, "draft_saved", &context, None)?;
    tx.commit()?;
    get_version(conn, id)
}

/// Set a draft aside: it becomes `rejected` and is kept, with the reason, so
/// the history still shows it. Published versions are never discarded.
pub fn discard_draft(
    conn: &mut Connection,
    id: &str,
    expected_updated_at: &str,
    context: ChangeContext,
) -> AppResult<RulebookVersionDetail> {
    check_context(&context)?;
    if opt_text(context.reason.clone()).is_none() {
        return Err(AppError::invalid("reason", "Say why the draft is discarded"));
    }
    let tx = conn.transaction()?;
    let detail = get_version(&tx, id)?;
    require_writable_owner(&tx, &detail.rulebook)?;
    if detail.version.verification_status != "draft" {
        return Err(AppError::Conflict {
            message: format!(
                "version {} is {}, not a draft",
                detail.version.version_number, detail.version.verification_status
            ),
        });
    }
    check_revision(&detail, Some(expected_updated_at))?;
    tx.execute(
        "UPDATE rulebook_versions SET verification_status = 'rejected', updated_at = ?2 WHERE id = ?1",
        params![id, next_revision(&detail.version.updated_at)],
    )?;
    record_event(&tx, id, "draft_discarded", &context, None)?;
    tx.commit()?;
    get_version(conn, id)
}

const EVENT: &str = "SELECT id, rulebook_id, rulebook_version_id, account_id, assignment_id, action, actor, reason, occurred_at
                     FROM rulebook_events";

fn event_row(r: &Row) -> rusqlite::Result<RulebookEvent> {
    Ok(RulebookEvent {
        id: r.get(0)?,
        rulebook_id: r.get(1)?,
        rulebook_version_id: r.get(2)?,
        account_id: r.get(3)?,
        assignment_id: r.get(4)?,
        action: r.get(5)?,
        actor: r.get(6)?,
        reason: r.get(7)?,
        occurred_at: r.get(8)?,
    })
}

/// Audit events, oldest first: of one rulebook, or about one account (its
/// assignments and its private rulebooks). Exactly one of the two is given.
pub fn list_events(conn: &Connection, query: &RulebookEventQuery) -> AppResult<Vec<RulebookEvent>> {
    match (&query.rulebook_id, &query.account_id) {
        (Some(rulebook), None) => {
            all(conn, &format!("{EVENT} WHERE rulebook_id = ?1 ORDER BY occurred_at, rowid"), [rulebook], event_row)
        }
        (None, Some(account)) => all(
            conn,
            &format!(
                "{EVENT} WHERE account_id = ?1 OR rulebook_id IN (SELECT id FROM rulebooks WHERE owner_account_id = ?1)
                 ORDER BY occurred_at, rowid"
            ),
            [account],
            event_row,
        ),
        _ => Err(AppError::invalid("rulebookId", "Give either a rulebook or an account")),
    }
}

// ---------------------------------------------------------------------------
// Conflicts and assignments
// ---------------------------------------------------------------------------

/// Record a source that contradicts a rule. The claim is kept as
/// `conflicting`; a verified version it contradicts becomes `stale` until a
/// corrected version supersedes it.
pub fn flag_conflict(conn: &mut Connection, input: SourceConflictInput) -> AppResult<RuleClaim> {
    if input.note.trim().is_empty() {
        return Err(AppError::invalid("note", "Say what conflicts"));
    }
    let version_id: String = conn
        .query_row("SELECT rulebook_version_id FROM rule_definitions WHERE id = ?1", [&input.rule_definition_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::not_found("rule", &input.rule_definition_id))?;
    let at = now();
    let id = new_id();
    let tx = conn.transaction()?;
    let detail = get_version(&tx, &version_id)?;
    require_writable_owner(&tx, &detail.rulebook)?;
    tx.execute(
        "INSERT INTO rule_claims (id, rule_definition_id, source_id, field, origin, provider_text, claim_status, note, created_at)
         VALUES (?1, ?2, ?3, ?4, 'observed', ?5, 'conflicting', ?6, ?7)",
        params![id, input.rule_definition_id, input.source_id, input.field, input.provider_text, input.note.trim(), at],
    )?;
    tx.execute(
        "UPDATE rulebook_versions SET verification_status = 'stale', updated_at = ?2
         WHERE id = ?1 AND verification_status = 'verified'",
        params![version_id, at],
    )?;
    let context = ChangeContext { actor: "local_user".into(), reason: Some(input.note.trim().to_string()) };
    record_event(&tx, &version_id, "conflict_flagged", &context, None)?;
    tx.commit()?;
    let detail = get_version(conn, &version_id)?;
    Ok(detail.claims.into_iter().find(|c| c.id == id).expect("claim just written"))
}

/// A `YYYY-MM-DD` date that falls Monday to Friday.
fn is_trading_day(s: &str) -> bool {
    use chrono::Datelike;
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .is_ok_and(|d| d.format("%Y-%m-%d").to_string() == s && d.weekday().number_from_monday() <= 5)
}

/// Assign a version to an account from a trading day. The account's current
/// open assignment, if any, ends that day; an assignment is never moved,
/// rewritten or switched to a newer version automatically.
///
/// Test convenience: the same with the default `local_user` audit context.
#[cfg(test)]
pub fn assign(conn: &mut Connection, input: AssignmentInput) -> AppResult<AccountRulebookAssignment> {
    assign_with(conn, input, None)
}

/// `assign`, refusing when the account's open assignment is not the one the
/// caller saw (another window assigned meanwhile), and recording who and why.
pub fn assign_with(
    conn: &mut Connection,
    input: AssignmentInput,
    guard: Option<AssignmentGuard>,
) -> AppResult<AccountRulebookAssignment> {
    let context = match &guard {
        Some(g) => ChangeContext { actor: g.actor.clone(), reason: g.reason.clone() },
        None => ChangeContext::local(),
    };
    check_context(&context)?;
    let tx = conn.transaction()?;
    if let Some(g) = &guard {
        let open: Option<String> = tx
            .query_row(
                "SELECT id FROM account_rulebook_assignments WHERE account_id = ?1 AND effective_to IS NULL",
                [&input.account_id],
                |r| r.get(0),
            )
            .optional()?;
        if open != g.expected_open_assignment_id {
            return Err(AppError::Conflict {
                message: "the account's rulebook assignment changed since this page was opened; reload and review it".into(),
            });
        }
    }
    let assignment = assign_in(&tx, input)?;
    record_event(&tx, &assignment.rulebook_version_id, "assigned", &context, Some((&assignment.account_id, Some(&assignment.id))))?;
    tx.commit()?;
    Ok(assignment)
}

/// `assign` inside the caller's transaction, so a larger operation (an
/// evaluation reset) can make the assignment part of its own atomic unit.
pub(crate) fn assign_in(conn: &Connection, input: AssignmentInput) -> AppResult<AccountRulebookAssignment> {
    if !is_trading_day(&input.effective_from) {
        return Err(AppError::invalid("effectiveFrom", "Use a Monday-to-Friday trading day as YYYY-MM-DD"));
    }
    if input.phase_path_id.is_some() && input.programme_phase_id.is_none() {
        return Err(AppError::invalid("phasePathId", "A path needs its phase"));
    }
    let archived: Option<bool> = conn
        .query_row("SELECT archived_at IS NOT NULL FROM accounts WHERE id = ?1", [&input.account_id], |r| r.get(0))
        .optional()?;
    match archived {
        None => return Err(AppError::not_found("account", &input.account_id)),
        Some(true) => return Err(AppError::invalid("accountId", "The account is archived")),
        Some(false) => {}
    }
    let detail = get_version(conn, &input.rulebook_version_id)?;
    let v = &detail.version;
    let assignable = v.record_status == "active"
        && match &detail.rulebook.owner_account_id {
            Some(owner) => owner == &input.account_id && v.verification_status == "needs_review",
            None => v.verification_status == "verified",
        };
    if !assignable {
        return Err(AppError::invalid(
            "rulebookVersionId",
            match &detail.rulebook.owner_account_id {
                Some(owner) if owner != &input.account_id => "This rulebook belongs to another account".to_string(),
                Some(_) => "Publish the version before assigning it".to_string(),
                None => format!("A {} catalogue version cannot be assigned; it must be verified", v.verification_status),
            },
        ));
    }
    if let Some(phase) = &input.programme_phase_id {
        let resolved = applicable(conn, &ApplicableRulebookQuery { programme_phase_id: phase.clone(), phase_path_id: input.phase_path_id.clone() })?;
        let applies = detail.applicability.iter().any(|a| &a.programme_phase_id == phase && a.phase_path_id == input.phase_path_id)
            || (matches!(resolved.status, "resolved" | "ambiguous") && resolved.rulebook_version_ids.contains(&v.id));
        if !applies {
            return Err(AppError::invalid("programmePhaseId", "The version does not apply to this phase or path"));
        }
    }

    let tx = conn;
    let later: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM account_rulebook_assignments WHERE account_id = ?1 AND effective_from >= ?2)",
        params![input.account_id, input.effective_from],
        |r| r.get(0),
    )?;
    if later {
        return Err(AppError::Conflict {
            message: format!("the account already has a rulebook assignment from {} or later", input.effective_from),
        });
    }
    tx.execute(
        "UPDATE account_rulebook_assignments SET effective_to = ?2 WHERE account_id = ?1 AND effective_to IS NULL",
        params![input.account_id, input.effective_from],
    )?;
    let id = new_id();
    tx.execute(
        "INSERT INTO account_rulebook_assignments (id, account_id, rulebook_version_id, programme_phase_id, phase_path_id,
                                                   account_phase_event_id, effective_from, assigned_at, assignment_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            input.account_id,
            input.rulebook_version_id,
            input.programme_phase_id,
            input.phase_path_id,
            input.account_phase_event_id,
            input.effective_from,
            now(),
            if input.programme_phase_id.is_some() { "catalogue_selection" } else { "user" }
        ],
    )?;
    Ok(conn.query_row(&format!("{ASSIGNMENT} WHERE id = ?1"), [&id], assignment_row)?)
}
