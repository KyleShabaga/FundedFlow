//! Evaluation-reset attempts: a reset creates a NEW account linked to the one
//! it follows. The earlier attempt keeps its id, trades, imports, journal,
//! snapshots and history; the new one starts with none of them.
//!
//! A prop-firm evaluation reset is not `trading_day_reset_time`, which is only
//! the account's session-day boundary.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::accounts::{self, Account, friendly};
use super::opt_text;
use super::rulebooks;
use crate::domain::{
    format_instant, micros_to_string, new_id, now, parse_decimal, parse_payload_time, to_micros,
    trading_day,
};
use crate::error::{AppError, AppResult, Issues};
use crate::rulebook::{AccountRulebookAssignment, AssignmentInput};

pub const PRIOR_OUTCOMES: &[&str] = &["passed", "failed", "closed"];
pub const RESET_SOURCES: &[&str] = &[
    "user_entered",
    "provider_email",
    "provider_dashboard",
    "other",
];

/// The successor's programme, version and path, when the user selects them.
/// Absent fields stay unknown; nothing is copied from the predecessor.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogueSelection {
    pub programme_variant_id: Option<String>,
    pub catalogue_version_id: Option<String>,
    pub selected_phase_path_id: Option<String>,
}

/// The applicable-rulebook decision a reset must make explicitly.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum RulebookDecision {
    /// Assign a verified catalogue version (or the user's own) from a trading day.
    #[serde(rename = "assign", rename_all = "camelCase")]
    Assign {
        rulebook_version_id: String,
        effective_from: String,
        programme_phase_id: Option<String>,
        phase_path_id: Option<String>,
    },
    /// No rulebook yet. Recorded as a decision; the attempt has no rule meter until one is assigned.
    #[serde(rename = "decideLater")]
    DecideLater,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResetInput {
    pub predecessor_account_id: String,
    /// The predecessor's real outcome, confirmed by the user: `passed`, `failed` or `closed`.
    pub prior_outcome: String,
    /// When the reset took effect (ISO 8601 with offset).
    pub effective_at: String,
    pub reason: Option<String>,
    /// Where the user learned of the reset: `user_entered`, `provider_email`, `provider_dashboard`, `other`.
    pub source: String,
    /// The new attempt's name.
    pub name: String,
    /// The provider's account number for the new attempt. It may equal the predecessor's.
    pub external_ref: Option<String>,
    /// Decimal text. Required: a reset never carries the old balance over.
    pub starting_balance: String,
    pub catalogue: Option<CatalogueSelection>,
    pub rulebook: RulebookDecision,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptLink {
    pub predecessor_account_id: String,
    pub successor_account_id: String,
    pub prior_outcome: String,
    pub effective_at: String,
    pub reason: Option<String>,
    pub source: String,
    /// `assigned` or `deferred`.
    pub rulebook_decision: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetResult {
    pub predecessor: Account,
    pub successor: Account,
    pub link: AttemptLink,
    pub rulebook_assignment: Option<AccountRulebookAssignment>,
}

fn link_row(r: &rusqlite::Row) -> rusqlite::Result<AttemptLink> {
    Ok(AttemptLink {
        predecessor_account_id: r.get(0)?,
        successor_account_id: r.get(1)?,
        prior_outcome: r.get(2)?,
        effective_at: r.get(3)?,
        reason: r.get(4)?,
        source: r.get(5)?,
        rulebook_decision: r.get(6)?,
        created_at: r.get(7)?,
    })
}

const LINK: &str = "SELECT predecessor_account_id, successor_account_id, prior_outcome, effective_at, reason, source,
        rulebook_decision, created_at FROM account_attempt_links";

struct Valid {
    prior_outcome: String,
    effective_at: String,
    effective_instant: DateTime<Utc>,
    reason: Option<String>,
    source: String,
    name: String,
    external_ref: Option<String>,
    starting_balance_micros: i64,
    notes: Option<String>,
}

fn validate(input: &ResetInput) -> AppResult<Valid> {
    let mut issues = Issues::default();
    if !PRIOR_OUTCOMES.contains(&input.prior_outcome.as_str()) {
        issues.add(
            "priorOutcome",
            format!(
                "confirm the previous attempt's outcome: {}",
                PRIOR_OUTCOMES.join(", ")
            ),
        );
    }
    if !RESET_SOURCES.contains(&input.source.as_str()) {
        issues.add(
            "source",
            format!("must be one of {}", RESET_SOURCES.join(", ")),
        );
    }
    let (effective_at, effective_instant) = match parse_payload_time(&input.effective_at) {
        Ok(t) => (format_instant(t), t),
        Err(message) => {
            issues.add("effectiveAt", message);
            (String::new(), DateTime::<Utc>::MIN_UTC)
        }
    };
    let reason = opt_text(input.reason.clone());
    if reason.as_ref().is_some_and(|r| r.chars().count() > 500) {
        issues.add("reason", "must be at most 500 characters");
    }
    let name = input.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 100 {
        issues.add("name", "must be 1–100 characters");
    }
    let external_ref = opt_text(input.external_ref.clone());
    if external_ref
        .as_ref()
        .is_some_and(|r| r.chars().count() > 100)
    {
        issues.add("externalRef", "must be at most 100 characters");
    }
    let notes = opt_text(input.notes.clone());
    if notes
        .as_ref()
        .is_some_and(|n| n.chars().count() > crate::domain::MAX_NOTES_CHARS)
    {
        issues.add("notes", "is too long");
    }
    let starting_balance_micros = match parse_decimal(&input.starting_balance) {
        None => {
            issues.add("startingBalance", "must be a number");
            0
        }
        Some(d) if d.is_sign_negative() && !d.is_zero() => {
            issues.add("startingBalance", "must be zero or positive");
            0
        }
        Some(d) => to_micros(d).unwrap_or_else(|| {
            issues.add("startingBalance", "is too large");
            0
        }),
    };
    issues.into_result()?;
    Ok(Valid {
        prior_outcome: input.prior_outcome.clone(),
        effective_at,
        effective_instant,
        reason,
        source: input.source.clone(),
        name,
        external_ref,
        starting_balance_micros,
        notes,
    })
}

/// Start the next attempt of an evaluation, in one transaction:
///
/// 1. the predecessor's outcome is recorded as the user confirmed it (never
///    assumed to be `failed`);
/// 2. a new account with a new id is created, inheriting only identity
///    (provider, broker, currency, time zone, session boundary) and taking its
///    own balance, number, programme selection and rulebook decision;
/// 3. the two are linked.
///
/// Any failure (a broker number held by another live account, a bad rulebook,
/// a bad catalogue selection) leaves every table exactly as it was.
pub fn reset(conn: &mut Connection, input: ResetInput) -> AppResult<ResetResult> {
    let v = validate(&input)?;
    let tx = conn.transaction()?;

    let (archived, status): (bool, String) = tx
        .query_row(
            "SELECT archived_at IS NOT NULL, status FROM accounts WHERE id = ?1",
            [&input.predecessor_account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("account", &input.predecessor_account_id))?;
    if archived {
        return Err(AppError::invalid(
            "predecessorAccountId",
            "Restore the archived account before resetting it",
        ));
    }
    let existing: Option<String> = tx
        .query_row(
            "SELECT successor_account_id FROM account_attempt_links WHERE predecessor_account_id = ?1",
            [&input.predecessor_account_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(next) = existing {
        return Err(AppError::Conflict {
            message: format!(
                "this attempt was already reset; its next attempt is account '{next}'"
            ),
        });
    }

    // 1. The confirmed outcome. A status already equal to it needs no new event.
    let at = now();
    if status != v.prior_outcome {
        tx.execute(
            "UPDATE accounts SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![input.predecessor_account_id, v.prior_outcome, at],
        )
        .map_err(friendly)?;
        accounts::record_status_event(
            &tx,
            &input.predecessor_account_id,
            &v.prior_outcome,
            &v.effective_at,
            v.reason.as_deref(),
            None,
        )?;
    }

    // 2. The new attempt.
    let successor_id = new_id();
    let catalogue = input.catalogue.clone().unwrap_or_default();
    tx.execute(
        "INSERT INTO accounts (id, firm_id, programme_id, name, broker, external_ref, account_type, status, currency,
                               starting_balance_micros, timezone, trading_day_reset_time, notes_md, created_at,
                               updated_at, provider_id, programme_variant_id, catalogue_version_id, selected_phase_path_id)
         SELECT ?2, firm_id, programme_id, ?3, broker, ?4, account_type, 'active', currency,
                ?5, timezone, trading_day_reset_time, ?6, ?7, ?7, provider_id, ?8, ?9, ?10
         FROM accounts WHERE id = ?1",
        params![
            input.predecessor_account_id,
            successor_id,
            v.name,
            v.external_ref,
            v.starting_balance_micros,
            v.notes,
            at,
            catalogue.programme_variant_id,
            catalogue.catalogue_version_id,
            catalogue.selected_phase_path_id
        ],
    )
    .map_err(friendly)?;
    accounts::record_status_event(
        &tx,
        &successor_id,
        "active",
        &v.effective_at,
        v.reason.as_deref(),
        None,
    )?;

    let (assignment, decision) = match &input.rulebook {
        RulebookDecision::Assign {
            rulebook_version_id,
            effective_from,
            programme_phase_id,
            phase_path_id,
        } => {
            // The rulebook applies from the trading day the reset took effect, in the new attempt's session.
            let ctx = super::account_ctx(&tx, &successor_id)?;
            let day = trading_day(v.effective_instant, ctx.tz, ctx.reset).to_string();
            if *effective_from != day {
                return Err(AppError::invalid(
                    "effectiveFrom",
                    format!("Use the trading day the reset took effect, {day}"),
                ));
            }
            let assignment = rulebooks::assign_in(
                &tx,
                AssignmentInput {
                    account_id: successor_id.clone(),
                    rulebook_version_id: rulebook_version_id.clone(),
                    effective_from: effective_from.clone(),
                    programme_phase_id: programme_phase_id.clone(),
                    phase_path_id: phase_path_id.clone(),
                    account_phase_event_id: None,
                },
            )?;
            let context = crate::rulebook::ChangeContext {
                actor: "local_user".into(),
                reason: Some("New attempt".into()),
            };
            rulebooks::record_event(
                &tx,
                &assignment.rulebook_version_id,
                "assigned",
                &context,
                Some((&successor_id, Some(&assignment.id))),
            )?;
            (Some(assignment), "assigned")
        }
        RulebookDecision::DecideLater => (None, "deferred"),
    };

    // 3. The relationship.
    tx.execute(
        "INSERT INTO account_attempt_links (id, predecessor_account_id, successor_account_id, prior_outcome,
                                           effective_at, reason, source, rulebook_decision, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            new_id(),
            input.predecessor_account_id,
            successor_id,
            v.prior_outcome,
            v.effective_at,
            v.reason,
            v.source,
            decision,
            at
        ],
    )?;
    tx.commit()?;

    Ok(ResetResult {
        predecessor: accounts::get_any(conn, &input.predecessor_account_id)?,
        successor: accounts::get_any(conn, &successor_id)?,
        link: conn.query_row(
            &format!("{LINK} WHERE successor_account_id = ?1"),
            [&successor_id],
            link_row,
        )?,
        rulebook_assignment: assignment,
    })
}

/// One attempt in a chain, with plain counts for comparing attempts. Money is
/// a sum of stored trade results only; `trades_with_unknown_pnl` says how many
/// trades (open or unpriced) the sum leaves out, so unknown is never shown as zero.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub account_id: String,
    /// 1 for the first attempt.
    pub attempt_number: u32,
    pub name: String,
    pub status: String,
    pub archived_at: Option<String>,
    pub external_ref: Option<String>,
    pub starting_balance: String,
    pub created_at: String,
    /// The reset that ended this attempt, if one did.
    pub reset_to_next: Option<AttemptLink>,
    pub trade_count: i64,
    pub first_trading_day: Option<String>,
    pub last_trading_day: Option<String>,
    pub import_count: i64,
    /// Sum of known net results; absent when the attempt has no trades with a known result.
    pub net_pnl: Option<String>,
    pub trades_with_unknown_pnl: i64,
}

/// Every attempt of the chain containing `account_id`, first attempt first.
/// Readable for archived accounts.
pub fn lineage(conn: &Connection, account_id: &str) -> AppResult<Vec<AttemptSummary>> {
    accounts::get_any(conn, account_id)?;
    let neighbour = |sql: &str, id: &str| -> AppResult<Option<String>> {
        Ok(conn.query_row(sql, [id], |r| r.get(0)).optional()?)
    };

    // The links form a path (each account has at most one predecessor and one
    // successor), but the walks are bounded rather than trusting the data.
    let mut root = account_id.to_string();
    for _ in 0..10_000 {
        match neighbour(
            "SELECT predecessor_account_id FROM account_attempt_links WHERE successor_account_id = ?1",
            &root,
        )? {
            Some(prev) => root = prev,
            None => break,
        }
    }
    let mut ids = vec![root.clone()];
    let mut at = root;
    for _ in 0..10_000 {
        match neighbour(
            "SELECT successor_account_id FROM account_attempt_links WHERE predecessor_account_id = ?1",
            &at,
        )? {
            Some(next) => {
                ids.push(next.clone());
                at = next;
            }
            None => break,
        }
    }

    ids.iter()
        .enumerate()
        .map(|(i, id)| {
            let a = accounts::get_any(conn, id)?;
            let (trade_count, first, last, pnl_micros, known, unknown): (i64, Option<String>, Option<String>, Option<i64>, i64, i64) =
                conn.query_row(
                    "SELECT COUNT(*), MIN(trading_day), MAX(trading_day), SUM(net_pnl_micros),
                            COUNT(net_pnl_micros), COUNT(*) - COUNT(net_pnl_micros)
                     FROM trades WHERE account_id = ?1 AND deleted_at IS NULL",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
                )?;
            let import_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM import_batches WHERE account_id = ?1 AND status = 'committed'",
                [id],
                |r| r.get(0),
            )?;
            let reset_to_next = conn
                .query_row(&format!("{LINK} WHERE predecessor_account_id = ?1"), [id], link_row)
                .optional()?;
            Ok(AttemptSummary {
                account_id: a.id,
                attempt_number: i as u32 + 1,
                name: a.name,
                status: a.status,
                archived_at: a.archived_at,
                external_ref: a.external_ref,
                starting_balance: a.starting_balance,
                created_at: a.created_at,
                reset_to_next,
                trade_count,
                first_trading_day: first,
                last_trading_day: last,
                import_count,
                net_pnl: if known > 0 { pnl_micros.map(micros_to_string) } else { None },
                trades_with_unknown_pnl: unknown,
            })
        })
        .collect()
}

/// What permanently deleting one account would remove, and what stops it.
/// Read-only: there is no delete command yet (Build 24 owns it).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionPreview {
    pub account_id: String,
    pub account_name: String,
    pub trades: i64,
    pub deleted_trades: i64,
    pub journal_entries: i64,
    pub import_batches: i64,
    pub status_events: i64,
    pub rulebook_assignments: i64,
    pub private_rulebooks: i64,
    pub snapshots: i64,
    pub ledger_entries: i64,
    pub phase_events: i64,
    /// Other attempts in the same chain. Deleting one attempt never deletes these.
    pub linked_attempts: Vec<String>,
    /// Why deletion is refused today. Empty does not mean it can be done: no command exists.
    pub blockers: Vec<String>,
}

pub fn deletion_preview(conn: &Connection, account_id: &str) -> AppResult<DeletionPreview> {
    let account = accounts::get_any(conn, account_id)?;
    let count =
        |sql: &str| -> AppResult<i64> { Ok(conn.query_row(sql, [account_id], |r| r.get(0))?) };
    let linked_attempts: Vec<String> = lineage(conn, account_id)?
        .into_iter()
        .filter(|a| a.account_id != account_id)
        .map(|a| a.account_id)
        .collect();
    let phase_events = count("SELECT COUNT(*) FROM account_phase_events WHERE account_id = ?1")?;

    let mut blockers = Vec::new();
    if !linked_attempts.is_empty() {
        blockers.push(
            "This account is part of an evaluation-reset chain; its links are append-only and deleting one attempt \
             would orphan its neighbours."
                .to_string(),
        );
    }
    if phase_events > 0 {
        blockers.push("Its phase history is append-only and cannot be removed.".to_string());
    }
    blockers.push("This legacy preview does not authorize deletion; use Build 24 preview_permanent_deletion and explicit native confirmation.".into());

    Ok(DeletionPreview {
        account_id: account.id,
        account_name: account.name,
        trades: count("SELECT COUNT(*) FROM trades WHERE account_id = ?1 AND deleted_at IS NULL")?,
        deleted_trades: count(
            "SELECT COUNT(*) FROM trades WHERE account_id = ?1 AND deleted_at IS NOT NULL",
        )?,
        journal_entries: count("SELECT COUNT(*) FROM journal_entries WHERE account_id = ?1")?,
        import_batches: count("SELECT COUNT(*) FROM import_batches WHERE account_id = ?1")?,
        status_events: count("SELECT COUNT(*) FROM account_status_events WHERE account_id = ?1")?,
        rulebook_assignments: count(
            "SELECT COUNT(*) FROM account_rulebook_assignments WHERE account_id = ?1",
        )?,
        private_rulebooks: count("SELECT COUNT(*) FROM rulebooks WHERE owner_account_id = ?1")?,
        snapshots: count("SELECT COUNT(*) FROM account_snapshots WHERE account_id = ?1")?,
        ledger_entries: count("SELECT COUNT(*) FROM account_ledger_entries WHERE account_id = ?1")?,
        phase_events,
        linked_attempts,
        blockers,
    })
}
