//! Per-trade reviews (Build 20): strategy, checklist answers, setup/mistake/
//! emotion/general tags, plan (entry, stop, target, risk), execution rating,
//! notes and screenshots.
//!
//! A review belongs to one trade and that trade's account (triggers). It
//! keeps the strategy, checklist, item and tag labels as they read when they
//! were chosen: renaming or archiving a template never re-labels a past review.
//! Saves are guarded by `revision`, so a stale form is a conflict, never an
//! overwrite. The review is keyed by trade id, so CSV re-imports (which skip
//! or restore the same trade) never touch it, and nothing is ever matched by
//! timestamp or symbol.

use std::path::Path;
use std::str::FromStr;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};

use super::attachments::{self, AttachmentMeta};
use super::{account_ctx, load_instruments, opt_text};
use crate::domain::{canonical, micros_to_string, new_id, now, parse_decimal, resolve_instrument, to_micros, Instrument};
use crate::error::{AppError, AppResult, Issues};

const MAX_NOTES_CHARS: usize = 20_000;
const MAX_TAGS: usize = 30;
const RESULTS: [&str; 3] = ["followed", "missed", "not_applicable"];

/// A library entry as the review recorded it, beside what it is called now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelRef {
    /// None when the template no longer exists.
    pub id: Option<String>,
    /// The label when it was chosen for this review.
    pub label: String,
    /// The template's label now, when it differs or None when it is gone.
    pub current_label: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewTag {
    pub tag_id: String,
    pub label: String,
    /// Kind when added: "setup" | "mistake" | "emotion" | "general".
    pub kind: String,
    pub current_label: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistAnswer {
    pub item_id: String,
    /// The item's label when it was answered.
    pub label: String,
    /// "followed" | "missed" | "not_applicable"
    pub result: String,
    pub note: Option<String>,
    pub current_label: Option<String>,
    pub archived: bool,
}

/// Process (checklist adherence) and outcome (P&L) are reported separately; this is process only.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adherence {
    pub followed: i64,
    pub missed: i64,
    pub not_applicable: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeReview {
    pub id: String,
    pub trade_id: String,
    pub account_id: String,
    pub revision: i64,
    /// When the trader marked it reviewed; None while it is a draft.
    pub reviewed_at: Option<String>,
    pub strategy: Option<LabelRef>,
    pub checklist: Option<LabelRef>,
    /// Planned before the trade, as entered (decimal text). None is unknown, never zero.
    pub planned_entry_price: Option<String>,
    pub planned_stop_price: Option<String>,
    pub planned_target_price: Option<String>,
    /// 1R in the account currency: as entered, or derived from planned entry and stop.
    pub planned_risk: Option<String>,
    /// "entered" | "derived" | None (unknown).
    pub planned_risk_source: Option<String>,
    /// Net P&L ÷ planned risk, 2 dp; None unless both are known.
    pub r_multiple: Option<String>,
    pub execution_rating: Option<i64>,
    /// The plan or thesis written for the trade.
    pub thesis: Option<String>,
    /// Notes and reflection afterwards.
    pub reflection: Option<String>,
    pub tags: Vec<ReviewTag>,
    pub checklist_results: Vec<ChecklistAnswer>,
    pub adherence: Adherence,
    pub attachments: Vec<AttachmentMeta>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChecklistAnswerInput {
    pub item_id: String,
    pub result: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewInput {
    pub account_id: String,
    pub trade_id: String,
    /// The revision the form started from; None when no review existed.
    pub expected_revision: Option<i64>,
    pub strategy_id: Option<String>,
    pub checklist_id: Option<String>,
    pub planned_entry_price: Option<String>,
    pub planned_stop_price: Option<String>,
    pub planned_target_price: Option<String>,
    pub planned_risk: Option<String>,
    pub execution_rating: Option<i64>,
    pub thesis: Option<String>,
    pub reflection: Option<String>,
    pub reviewed: bool,
    pub tag_ids: Vec<String>,
    pub checklist_results: Vec<ChecklistAnswerInput>,
}

/// What the trade log shows and filters on for one reviewed trade.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub trade_id: String,
    pub reviewed: bool,
    pub strategy_id: Option<String>,
    pub strategy_name: Option<String>,
    pub tags: Vec<ReviewTag>,
    pub execution_rating: Option<i64>,
    pub adherence: Adherence,
    pub screenshot_count: i64,
    /// Thesis and reflection, for search.
    pub notes: String,
}

struct Stored {
    id: String,
    revision: i64,
    strategy_id: Option<String>,
    strategy_snapshot: Option<String>,
    checklist_id: Option<String>,
    checklist_snapshot: Option<String>,
    reviewed_at: Option<String>,
    has_content: bool,
}

fn stored(conn: &Connection, trade_id: &str) -> AppResult<Option<Stored>> {
    Ok(conn
        .query_row(
            "SELECT id, revision, strategy_id, strategy_name_snapshot, checklist_id, checklist_name_snapshot, reviewed_at,
                    (strategy_id IS NOT NULL OR checklist_id IS NOT NULL OR planned_entry_price IS NOT NULL
                     OR planned_stop_price IS NOT NULL OR planned_target_price IS NOT NULL
                     OR planned_risk_micros IS NOT NULL OR execution_rating IS NOT NULL OR thesis_md IS NOT NULL
                     OR reflection_md IS NOT NULL OR reviewed_at IS NOT NULL
                     OR EXISTS (SELECT 1 FROM trade_review_tags WHERE trade_review_id = trade_reviews.id)
                     OR EXISTS (SELECT 1 FROM checklist_results WHERE trade_review_id = trade_reviews.id
                                AND deleted_at IS NULL))
             FROM trade_reviews WHERE trade_id = ?1 AND deleted_at IS NULL",
            [trade_id],
            |r| {
                Ok(Stored {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    strategy_id: r.get(2)?,
                    strategy_snapshot: r.get(3)?,
                    checklist_id: r.get(4)?,
                    checklist_snapshot: r.get(5)?,
                    reviewed_at: r.get(6)?,
                    has_content: r.get(7)?,
                })
            },
        )
        .optional()?)
}

/// The trade must be an active trade of `account_id`; another account's trade is "not found".
fn require_trade(conn: &Connection, account_id: &str, trade_id: &str) -> AppResult<()> {
    let owner: Option<String> = conn
        .query_row("SELECT account_id FROM trades WHERE id = ?1 AND deleted_at IS NULL", [trade_id], |r| r.get(0))
        .optional()?;
    if owner.as_deref() == Some(account_id) { Ok(()) } else { Err(AppError::not_found("trade", trade_id)) }
}

/// Insert an empty review so a screenshot has something to belong to. Its
/// revision stays 1 and it has no content, so a first form save still succeeds.
pub(crate) fn ensure(tx: &Transaction, account_id: &str, trade_id: &str) -> AppResult<String> {
    if let Some(s) = stored(tx, trade_id)? {
        return Ok(s.id);
    }
    let id = new_id();
    let now = now();
    tx.execute(
        "INSERT INTO trade_reviews (id, trade_id, account_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, trade_id, account_id, now],
    )?;
    Ok(id)
}

fn label_ref(id: Option<String>, snapshot: Option<String>, current: Option<(String, bool)>) -> Option<LabelRef> {
    let label = snapshot.or_else(|| current.as_ref().map(|c| c.0.clone()))?;
    Some(LabelRef {
        current_label: current.as_ref().filter(|c| c.0 != label).map(|c| c.0.clone()),
        archived: current.as_ref().is_some_and(|c| c.1),
        id,
        label,
    })
}

fn decimal_text(issues: &mut Issues, field: &str, value: Option<String>) -> Option<String> {
    let value = opt_text(value)?;
    match parse_decimal(&value) {
        Some(d) => Some(canonical(d)),
        None => {
            issues.add(field, "must be a number");
            None
        }
    }
}

fn notes(issues: &mut Issues, field: &str, value: Option<String>) -> Option<String> {
    let value = value.filter(|v| !v.trim().is_empty());
    if value.as_ref().is_some_and(|v| v.chars().count() > MAX_NOTES_CHARS) {
        issues.add(field, format!("must be at most {MAX_NOTES_CHARS} characters"));
    }
    value
}

/// Save the review of a trade (create or replace), in one transaction.
pub fn save(conn: &mut Connection, root: Option<&Path>, input: ReviewInput) -> AppResult<TradeReview> {
    let mut issues = Issues::default();
    let planned_entry = decimal_text(&mut issues, "plannedEntryPrice", input.planned_entry_price);
    let planned_stop = decimal_text(&mut issues, "plannedStopPrice", input.planned_stop_price);
    let planned_target = decimal_text(&mut issues, "plannedTargetPrice", input.planned_target_price);
    let planned_risk = match opt_text(input.planned_risk) {
        None => None,
        Some(text) => match parse_decimal(&text).and_then(to_micros) {
            Some(m) if m > 0 => Some(m),
            Some(_) => {
                issues.add("plannedRisk", "must be greater than zero (leave it empty when unknown)");
                None
            }
            None => {
                issues.add("plannedRisk", "must be an amount");
                None
            }
        },
    };
    if input.execution_rating.is_some_and(|r| !(1..=5).contains(&r)) {
        issues.add("executionRating", "must be from 1 to 5");
    }
    let thesis = notes(&mut issues, "thesis", input.thesis);
    let reflection = notes(&mut issues, "reflection", input.reflection);
    let mut tag_ids: Vec<String> = Vec::new();
    for t in input.tag_ids {
        if !tag_ids.contains(&t) {
            tag_ids.push(t);
        }
    }
    if tag_ids.len() > MAX_TAGS {
        issues.add("tagIds", format!("at most {MAX_TAGS} tags"));
    }
    let strategy_id = opt_text(input.strategy_id);
    let checklist_id = opt_text(input.checklist_id);
    for (i, a) in input.checklist_results.iter().enumerate() {
        if !RESULTS.contains(&a.result.as_str()) {
            issues.add(&format!("checklistResults.{i}.result"), "must be followed, missed or not_applicable");
        }
        if input.checklist_results[..i].iter().any(|b| b.item_id == a.item_id) {
            issues.add(&format!("checklistResults.{i}.itemId"), "answered twice");
        }
    }
    if checklist_id.is_none() && !input.checklist_results.is_empty() {
        issues.add("checklistId", "choose the checklist these answers belong to");
    }
    issues.into_result()?;

    let tx = conn.transaction()?;
    account_ctx(&tx, &input.account_id)?;
    require_trade(&tx, &input.account_id, &input.trade_id)?;
    let existing = stored(&tx, &input.trade_id)?;
    match (&existing, input.expected_revision) {
        (Some(s), None) if s.has_content => {
            return Err(AppError::Conflict {
                message: "this trade already has a review that you have not loaded; reload it before saving".into(),
            });
        }
        (Some(s), Some(r)) if s.revision != r => {
            return Err(AppError::Conflict {
                message: "this review was changed after you opened it; reload it and apply your edits again".into(),
            });
        }
        (None, Some(_)) => {
            return Err(AppError::Conflict { message: "this review no longer exists; reload the trade".into() });
        }
        _ => {}
    }

    let mut issues = Issues::default();
    // A strategy or checklist already on the review may be archived; a new choice may not.
    let strategy_snapshot = match &strategy_id {
        None => None,
        Some(id) => {
            let row: Option<(String, i64)> = tx
                .query_row("SELECT name, is_archived FROM strategies WHERE id = ?1 AND deleted_at IS NULL", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()?;
            let kept = existing.as_ref().filter(|s| s.strategy_id.as_ref() == Some(id));
            match (row, kept) {
                (_, Some(s)) => s.strategy_snapshot.clone(),
                (Some((name, 0)), None) => Some(name),
                (Some(_), None) => {
                    issues.add("strategyId", "this strategy is archived");
                    None
                }
                (None, None) => {
                    issues.add("strategyId", "strategy not found");
                    None
                }
            }
        }
    };
    let checklist_snapshot = match &checklist_id {
        None => None,
        Some(id) => {
            let row: Option<(String, String, i64)> = tx
                .query_row(
                    "SELECT name, scope, is_archived FROM checklists WHERE id = ?1 AND deleted_at IS NULL",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let kept = existing.as_ref().filter(|s| s.checklist_id.as_ref() == Some(id));
            match (row, kept) {
                (Some((_, scope, _)), _) if scope != "trade" => {
                    issues.add("checklistId", "a daily checklist is reviewed with the day, not a trade");
                    None
                }
                (_, Some(s)) => s.checklist_snapshot.clone(),
                (Some((name, _, 0)), None) => Some(name),
                (Some(_), None) => {
                    issues.add("checklistId", "this checklist is archived");
                    None
                }
                (None, None) => {
                    issues.add("checklistId", "checklist not found");
                    None
                }
            }
        }
    };
    issues.into_result()?;

    let now = now();
    let review_id = match &existing {
        Some(s) => s.id.clone(),
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO trade_reviews (id, trade_id, account_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, input.trade_id, input.account_id, now],
            )?;
            id
        }
    };
    let reviewed_at = if input.reviewed { existing.as_ref().and_then(|s| s.reviewed_at.clone()).or(Some(now.clone())) } else { None };
    let revision = existing.as_ref().map_or(1, |s| s.revision + 1);
    let updated_at = existing
        .as_ref()
        .map(|_| {
            let prev: String = tx
                .query_row("SELECT updated_at FROM trade_reviews WHERE id = ?1", [&review_id], |r| r.get(0))
                .unwrap_or_default();
            super::trades::later_than(&prev)
        })
        .unwrap_or_else(|| now.clone());
    tx.execute(
        "UPDATE trade_reviews SET strategy_id = ?2, strategy_name_snapshot = ?3, checklist_id = ?4,
                checklist_name_snapshot = ?5, planned_entry_price = ?6, planned_stop_price = ?7,
                planned_target_price = ?8, planned_risk_micros = ?9, execution_rating = ?10, thesis_md = ?11,
                reflection_md = ?12, reviewed_at = ?13, revision = ?14, updated_at = ?15
         WHERE id = ?1",
        params![
            review_id,
            strategy_id,
            strategy_snapshot,
            checklist_id,
            checklist_snapshot,
            planned_entry,
            planned_stop,
            planned_target,
            planned_risk,
            input.execution_rating,
            thesis,
            reflection,
            reviewed_at,
            revision,
            updated_at,
        ],
    )?;

    // Tags: keep the label of tags already on the review; new ones take their current label.
    let mut issues = Issues::default();
    let linked: Vec<String> = {
        let mut stmt = tx.prepare("SELECT tag_id FROM trade_review_tags WHERE trade_review_id = ?1")?;
        stmt.query_map([&review_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    for (i, tag_id) in tag_ids.iter().enumerate() {
        if linked.contains(tag_id) {
            continue;
        }
        let tag: Option<(String, String, bool)> = tx
            .query_row("SELECT name, kind, archived_at IS NOT NULL FROM tags WHERE id = ?1 AND deleted_at IS NULL", [tag_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?;
        match tag {
            Some((name, kind, false)) => {
                tx.execute(
                    "INSERT INTO trade_review_tags (trade_review_id, tag_id, created_at, label_snapshot, kind_snapshot)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![review_id, tag_id, now, name, kind],
                )?;
            }
            Some(_) => issues.add(&format!("tagIds.{i}"), "this tag is archived"),
            None => issues.add(&format!("tagIds.{i}"), "tag not found"),
        }
    }
    for tag_id in linked.iter().filter(|t| !tag_ids.contains(t)) {
        tx.execute("DELETE FROM trade_review_tags WHERE trade_review_id = ?1 AND tag_id = ?2", params![review_id, tag_id])?;
    }

    // Checklist answers: an item answered before keeps the label it was answered under.
    let current: Vec<(String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT id, checklist_item_id FROM checklist_results WHERE trade_review_id = ?1 AND deleted_at IS NULL",
        )?;
        stmt.query_map([&review_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
    };
    for (i, answer) in input.checklist_results.iter().enumerate() {
        let item: Option<(String, String, bool)> = tx
            .query_row(
                "SELECT checklist_id, label, is_archived = 1 FROM checklist_items WHERE id = ?1 AND deleted_at IS NULL",
                [&answer.item_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let note = opt_text(answer.note.clone());
        if note.as_ref().is_some_and(|n| n.chars().count() > 2000) {
            issues.add(&format!("checklistResults.{i}.note"), "must be at most 2000 characters");
            continue;
        }
        let answered = current.iter().find(|(_, item_id)| *item_id == answer.item_id);
        match (item, answered) {
            (Some((owner, _, _)), _) if Some(&owner) != checklist_id.as_ref() => {
                issues.add(&format!("checklistResults.{i}.itemId"), "item is not on the chosen checklist")
            }
            (Some(_), Some((result_id, _))) => {
                tx.execute(
                    "UPDATE checklist_results SET result = ?2, note = ?3,
                            updated_at = CASE WHEN result = ?2 AND note IS ?3 THEN updated_at ELSE ?4 END
                     WHERE id = ?1",
                    params![result_id, answer.result, note, now],
                )?;
            }
            (Some((_, label, false)), None) => {
                tx.execute(
                    "INSERT INTO checklist_results (id, checklist_item_id, item_label_snapshot, trade_review_id, result,
                                                    note, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![new_id(), answer.item_id, label, review_id, answer.result, note, now],
                )?;
            }
            (Some(_), None) => issues.add(&format!("checklistResults.{i}.itemId"), "this item is archived"),
            (None, _) => issues.add(&format!("checklistResults.{i}.itemId"), "item not found"),
        }
    }
    // Answers no longer given (or of another checklist) are set aside, never hard-deleted.
    for (result_id, item_id) in &current {
        if !input.checklist_results.iter().any(|a| &a.item_id == item_id) {
            tx.execute(
                "UPDATE checklist_results SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![result_id, now],
            )?;
        }
    }
    issues.into_result()?;
    tx.commit()?;
    get(conn, root, &input.account_id, &input.trade_id)?.ok_or_else(|| AppError::not_found("review", &review_id))
}

/// 1R from the planned entry and stop when no risk was entered: |entry − stop| × quantity × point value,
/// only for an instrument quoted in the account currency.
fn derived_risk(conn: &Connection, trade_id: &str, entry: &Option<String>, stop: &Option<String>) -> AppResult<Option<i64>> {
    let (Some(entry), Some(stop)) = (entry.as_deref().and_then(parse_decimal), stop.as_deref().and_then(parse_decimal)) else {
        return Ok(None);
    };
    let (symbol, quantity, account_id): (String, String, String) =
        conn.query_row("SELECT symbol, quantity, account_id FROM trades WHERE id = ?1", [trade_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
    let currency: String = conn.query_row("SELECT currency FROM accounts WHERE id = ?1", [&account_id], |r| r.get(0))?;
    let instruments = load_instruments(conn)?;
    Ok(risk_from_plan(entry, stop, &quantity, resolve_instrument(&symbol, &instruments), &currency))
}

/// |entry − stop| × quantity × point value in micro-units, for an instrument quoted in the account currency; None
/// otherwise. Shared with the Insights read (Build 23) so both derive 1R the same way.
pub(crate) fn risk_from_plan(entry: Decimal, stop: Decimal, quantity: &str, instrument: Option<&Instrument>, currency: &str) -> Option<i64> {
    let instrument = instrument.filter(|i| i.currency == currency)?;
    let quantity = Decimal::from_str(quantity).ok()?;
    let risk = (entry - stop).abs().checked_mul(quantity).and_then(|r| r.checked_mul(instrument.point_value));
    risk.and_then(to_micros).filter(|m| *m > 0)
}

pub(crate) fn r_multiple(net_micros: Option<i64>, risk_micros: Option<i64>) -> Option<String> {
    let (net, risk) = (net_micros?, risk_micros?);
    let r = Decimal::new(net, 0).checked_div(Decimal::new(risk, 0))?;
    Some(canonical(r.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)))
}

struct ReviewRow {
    id: String,
    revision: i64,
    reviewed_at: Option<String>,
    strategy_id: Option<String>,
    strategy_snap: Option<String>,
    checklist_id: Option<String>,
    checklist_snap: Option<String>,
    planned_entry_price: Option<String>,
    planned_stop_price: Option<String>,
    planned_target_price: Option<String>,
    entered_risk: Option<i64>,
    execution_rating: Option<i64>,
    thesis: Option<String>,
    reflection: Option<String>,
    created_at: String,
    updated_at: String,
}

/// The review of an active trade of `account_id`, or None when it has none.
pub fn get(conn: &Connection, root: Option<&Path>, account_id: &str, trade_id: &str) -> AppResult<Option<TradeReview>> {
    super::require_account(conn, account_id)?;
    require_trade(conn, account_id, trade_id)?;
    let row = conn
        .query_row(
            "SELECT id, revision, reviewed_at, strategy_id, strategy_name_snapshot, checklist_id, checklist_name_snapshot,
                    planned_entry_price, planned_stop_price, planned_target_price, planned_risk_micros, execution_rating,
                    thesis_md, reflection_md, created_at, updated_at
             FROM trade_reviews WHERE trade_id = ?1 AND account_id = ?2 AND deleted_at IS NULL",
            params![trade_id, account_id],
            |r| {
                Ok(ReviewRow {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    reviewed_at: r.get(2)?,
                    strategy_id: r.get(3)?,
                    strategy_snap: r.get(4)?,
                    checklist_id: r.get(5)?,
                    checklist_snap: r.get(6)?,
                    planned_entry_price: r.get(7)?,
                    planned_stop_price: r.get(8)?,
                    planned_target_price: r.get(9)?,
                    entered_risk: r.get(10)?,
                    execution_rating: r.get(11)?,
                    thesis: r.get(12)?,
                    reflection: r.get(13)?,
                    created_at: r.get(14)?,
                    updated_at: r.get(15)?,
                })
            },
        )
        .optional()?;
    let Some(ReviewRow {
        id,
        revision,
        reviewed_at,
        strategy_id,
        strategy_snap,
        checklist_id,
        checklist_snap,
        planned_entry_price,
        planned_stop_price,
        planned_target_price,
        entered_risk,
        execution_rating,
        thesis,
        reflection,
        created_at,
        updated_at,
    }) = row
    else {
        return Ok(None);
    };
    let current_strategy: Option<(String, bool)> = match &strategy_id {
        Some(s) => conn
            .query_row("SELECT name, is_archived = 1 FROM strategies WHERE id = ?1 AND deleted_at IS NULL", [s], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?,
        None => None,
    };
    let current_checklist: Option<(String, bool)> = match &checklist_id {
        Some(c) => conn
            .query_row("SELECT name, is_archived = 1 FROM checklists WHERE id = ?1 AND deleted_at IS NULL", [c], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?,
        None => None,
    };
    let tags = review_tags(conn, &id)?;
    let checklist_results = answers(conn, &id)?;
    let (risk, risk_source) = match entered_risk {
        Some(r) => (Some(r), Some("entered")),
        None => match derived_risk(conn, trade_id, &planned_entry_price, &planned_stop_price)? {
            Some(r) => (Some(r), Some("derived")),
            None => (None, None),
        },
    };
    let net: Option<i64> = conn.query_row("SELECT net_pnl_micros FROM trades WHERE id = ?1", [trade_id], |r| r.get(0))?;
    Ok(Some(TradeReview {
        adherence: adherence(&checklist_results),
        attachments: attachments::for_review(conn, root, &id)?,
        strategy: label_ref(strategy_id, strategy_snap, current_strategy),
        checklist: label_ref(checklist_id, checklist_snap, current_checklist),
        r_multiple: r_multiple(net, risk),
        planned_risk: risk.map(micros_to_string),
        planned_risk_source: risk_source.map(str::to_string),
        id,
        trade_id: trade_id.to_string(),
        account_id: account_id.to_string(),
        revision,
        reviewed_at,
        planned_entry_price,
        planned_stop_price,
        planned_target_price,
        execution_rating,
        thesis,
        reflection,
        tags,
        checklist_results,
        created_at,
        updated_at,
    }))
}

fn review_tags(conn: &Connection, review_id: &str) -> AppResult<Vec<ReviewTag>> {
    let mut stmt = conn.prepare(
        "SELECT rt.tag_id, coalesce(rt.label_snapshot, t.name), coalesce(rt.kind_snapshot, t.kind), t.name,
                t.archived_at IS NOT NULL
         FROM trade_review_tags rt JOIN tags t ON t.id = rt.tag_id
         WHERE rt.trade_review_id = ?1 ORDER BY 3, 2 COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([review_id], |r| {
        let label: String = r.get(1)?;
        let now: String = r.get(3)?;
        Ok(ReviewTag {
            tag_id: r.get(0)?,
            current_label: (now != label).then_some(now),
            label,
            kind: r.get(2)?,
            archived: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn answers(conn: &Connection, review_id: &str) -> AppResult<Vec<ChecklistAnswer>> {
    let mut stmt = conn.prepare(
        "SELECT r.checklist_item_id, r.item_label_snapshot, r.result, r.note, i.label, i.is_archived = 1
         FROM checklist_results r JOIN checklist_items i ON i.id = r.checklist_item_id
         WHERE r.trade_review_id = ?1 AND r.deleted_at IS NULL ORDER BY i.sort_order, i.id",
    )?;
    let rows = stmt.query_map([review_id], |r| {
        let label: String = r.get(1)?;
        let now: String = r.get(4)?;
        Ok(ChecklistAnswer {
            item_id: r.get(0)?,
            current_label: (now != label).then_some(now),
            label,
            result: r.get(2)?,
            note: r.get(3)?,
            archived: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn adherence(results: &[ChecklistAnswer]) -> Adherence {
    let count = |k: &str| results.iter().filter(|a| a.result == k).count() as i64;
    Adherence { followed: count("followed"), missed: count("missed"), not_applicable: count("not_applicable") }
}

/// One summary per active trade of the account that has a review.
pub fn summaries(conn: &Connection, account_id: &str) -> AppResult<Vec<ReviewSummary>> {
    super::require_account(conn, account_id)?;
    let mut stmt = conn.prepare(
        "SELECT r.id, r.trade_id, r.reviewed_at IS NOT NULL, r.strategy_id, r.strategy_name_snapshot, r.execution_rating,
                coalesce(r.thesis_md, '') || char(10) || coalesce(r.reflection_md, ''),
                (SELECT count(*) FROM attachment_links l WHERE l.trade_review_id = r.id AND l.deleted_at IS NULL)
         FROM trade_reviews r JOIN trades t ON t.id = r.trade_id
         WHERE r.account_id = ?1 AND r.deleted_at IS NULL AND t.deleted_at IS NULL
         ORDER BY t.entry_at DESC, t.id",
    )?;
    let heads = stmt
        .query_map([account_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, bool>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    heads
        .into_iter()
        .map(|(id, trade_id, reviewed, strategy_id, strategy_name, rating, notes, screenshots)| {
            Ok(ReviewSummary {
                adherence: adherence(&answers(conn, &id)?),
                tags: review_tags(conn, &id)?,
                trade_id,
                reviewed,
                strategy_id,
                strategy_name,
                execution_rating: rating,
                screenshot_count: screenshots,
                notes: notes.trim().to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod r_multiple_tests {
    use super::r_multiple;

    #[test]
    fn r_multiple_is_exact_and_needs_both_values() {
        assert_eq!(r_multiple(Some(250_000_000), Some(100_000_000)).as_deref(), Some("2.5"));
        assert_eq!(r_multiple(Some(-50_000_000), Some(150_000_000)).as_deref(), Some("-0.33"));
        assert_eq!(r_multiple(Some(5_000_000), Some(1_000_000_000)).as_deref(), Some("0.01"));
        assert_eq!(r_multiple(None, Some(1)), None);
        assert_eq!(r_multiple(Some(1), None), None, "unknown risk is never treated as zero");
    }
}
