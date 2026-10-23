//! Daily reviews (Build 22): the pre-session plan, the post-session
//! reflection and day-level checklist answers for one account attempt and one
//! trading day.
//!
//! Identity is `(account_id, trading_day)`: an evaluation reset creates a new
//! account, so a reset attempt starts with no reviews, and the trading day is
//! Rust's (`domain::trading_day`, the account's zone and reset), never a
//! browser date. Saves are guarded by `revision`, so a stale form is a
//! conflict, never an overwrite, and two saves of a new day cannot fork.
//!
//! The trades a review was saved with are kept by trade id. Reads compare them
//! with the day's trades now and report trades added, corrected, deleted or
//! moved to another day (a timezone or reset change re-derives trading days);
//! the review itself never moves. Process adherence (checklist answers) and the
//! closed-trade outcome are reported separately, and neither says anything
//! about prop-firm rule compliance.

use chrono::{
    DateTime, Datelike, Days, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc, Weekday,
};
use chrono_tz::Tz;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};

use super::reviews::{ChecklistAnswer, ChecklistAnswerInput, LabelRef};
use super::{account_ctx, opt_text, require_account};
use crate::domain::{
    canonical, format_instant, format_reset_time, micros_to_string, new_id, parse_decimal,
    parse_instant, parse_reset_time, parse_tz, to_micros, trading_day,
};
use crate::error::{AppError, AppResult, Issues};

const MAX_TEXT_CHARS: usize = 20_000;
const MAX_NOTE_CHARS: usize = 2_000;
const RESULTS: [&str; 3] = ["followed", "missed", "not_applicable"];
/// How far ahead a day can be planned, in calendar days after the current trading day.
pub const MAX_DAYS_AHEAD: u64 = 14;

/* ---------- DTOs ---------- */

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanInput {
    pub focus: Option<String>,
    pub setups: Option<String>,
    pub no_trade_conditions: Option<String>,
    pub commitments: Option<String>,
    /// Self-imposed maximum risk for the day (account currency, decimal text).
    pub max_risk: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReflectionInput {
    pub market_context: Option<String>,
    pub went_well: Option<String>,
    pub mistakes: Option<String>,
    pub emotions: Option<String>,
    pub key_lesson: Option<String>,
    pub next_action: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyReviewInput {
    pub account_id: String,
    pub trading_day: String,
    /// The revision the form started from; None when no review existed.
    pub expected_revision: Option<i64>,
    pub plan: PlanInput,
    pub reflection: ReflectionInput,
    pub no_trade_day: bool,
    pub checklist_id: Option<String>,
    pub answers: Vec<ChecklistAnswerInput>,
    /// "save" keeps the status (a completed review stays completed and is marked edited);
    /// "complete" marks it completed.
    pub action: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyReviewRef {
    pub account_id: String,
    pub trading_day: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub focus: Option<String>,
    pub setups: Option<String>,
    pub no_trade_conditions: Option<String>,
    pub commitments: Option<String>,
    pub max_risk: Option<String>,
    pub notes: Option<String>,
    /// When the plan first had content.
    pub authored_at: Option<String>,
    /// "pre_session" | "retrospective" | None (no plan).
    pub timing: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reflection {
    pub market_context: Option<String>,
    pub went_well: Option<String>,
    pub mistakes: Option<String>,
    pub emotions: Option<String>,
    pub key_lesson: Option<String>,
    pub next_action: Option<String>,
    pub notes: Option<String>,
}

/// Process only: applicable answered items marked followed over applicable answered items.
/// Unanswered and not-applicable items are never failures; no denominator is Unknown, not 0% or 100%.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyAdherence {
    pub followed: i64,
    pub missed: i64,
    pub not_applicable: i64,
    /// Active items of the chosen checklist with no answer.
    pub unanswered: i64,
    /// followed + missed: the denominator.
    pub answered: i64,
    /// Whole percent, half away from zero; None when nothing applicable was answered.
    pub percent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEvent {
    /// "created" | "saved" | "completed" | "edited" | "reopened" | "relinked"
    pub kind: String,
    pub revision: i64,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSettings {
    pub timezone: String,
    pub reset_time: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReview {
    pub id: String,
    pub account_id: String,
    pub trading_day: String,
    /// "draft" | "completed"
    pub status: String,
    pub revision: i64,
    pub plan: Plan,
    pub reflection: Reflection,
    pub no_trade_day: bool,
    pub checklist: Option<LabelRef>,
    pub answers: Vec<ChecklistAnswer>,
    pub adherence: DailyAdherence,
    /// The account's session settings when it was last saved.
    pub saved_with: SessionSettings,
    pub completed_at: Option<String>,
    pub first_completed_at: Option<String>,
    pub edited_after_completion_at: Option<String>,
    pub reopened_at: Option<String>,
    pub events: Vec<ReviewEvent>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTrade {
    pub trade_id: String,
    pub symbol: String,
    pub side: String,
    pub entry_at: String,
    pub exit_at: Option<String>,
    pub net_pnl: Option<String>,
    pub pnl_status: String,
    /// None when the day has no review yet; else "linked" (unchanged since the last save),
    /// "added" (not in the day when it was saved) or "changed" (corrected since).
    pub link: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingTrade {
    pub trade_id: String,
    pub symbol: String,
    /// "deleted" | "moved"
    pub reason: String,
    /// The trading day it belongs to now, when moved.
    pub moved_to: Option<String>,
    pub net_pnl_when_saved: Option<String>,
}

/// Closed-trade outcome of the day, Rust-summed: known P&L only; the rest is counted, never zeroed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayOutcome {
    pub trades: i64,
    pub closed_with_known_pnl: i64,
    pub unknown_pnl: i64,
    pub open: i64,
    /// Sum of known net P&L; None when no trade has a known P&L.
    pub net: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReviewDay {
    pub account_id: String,
    pub trading_day: String,
    /// The account's session settings now.
    pub session: SessionSettings,
    /// The trading day's window as instants (UTC): [start, end).
    pub session_start: String,
    pub session_end: String,
    pub current_trading_day: String,
    /// After the current trading day: only the plan can be written.
    pub is_future: bool,
    pub archived: bool,
    pub review: Option<DailyReview>,
    pub trades: Vec<DayTrade>,
    pub missing_trades: Vec<MissingTrade>,
    pub outcome: DayOutcome,
    /// "traded" | "no_trade_day" | "no_trades_recorded"
    pub day_state: String,
    /// The account's zone or reset differs from what the review was saved with.
    pub session_settings_changed: bool,
    /// Trades were added, corrected, deleted or moved since the review was saved.
    pub trades_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReviewSummary {
    pub id: String,
    pub trading_day: String,
    pub status: String,
    pub revision: i64,
    pub plan_timing: Option<String>,
    pub has_plan: bool,
    pub has_reflection: bool,
    pub no_trade_day: bool,
    pub key_lesson: Option<String>,
    pub adherence: DailyAdherence,
    pub outcome: DayOutcome,
    pub trades_changed: bool,
    pub completed_at: Option<String>,
    pub updated_at: String,
}

/// A generic journal entry without a trade (written before Build 22). Listed apart from reviews,
/// never counted as one; its trading day is derived from its time.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDayNote {
    pub id: String,
    pub title: String,
    pub entry_at: String,
    pub trading_day: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReviewIndex {
    pub account_id: String,
    pub current_trading_day: String,
    pub session: SessionSettings,
    pub archived: bool,
    /// Newest first.
    pub reviews: Vec<DailyReviewSummary>,
    pub legacy_notes: Vec<LegacyDayNote>,
}

/* ---------- Account and day ---------- */

struct Account {
    tz: Tz,
    reset: NaiveTime,
    tz_text: String,
    reset_text: String,
    archived: bool,
}

fn account(conn: &Connection, id: &str) -> AppResult<Account> {
    require_account(conn, id)?;
    let (tz_text, reset_text, archived): (String, String, bool) = conn.query_row(
        "SELECT timezone, trading_day_reset_time, archived_at IS NOT NULL FROM accounts WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let corrupt = || AppError::Database {
        message: format!("account '{id}' has invalid session settings"),
    };
    let tz = parse_tz(&tz_text).ok_or_else(corrupt)?;
    let reset = parse_reset_time(&reset_text).ok_or_else(corrupt)?;
    Ok(Account {
        tz,
        reset,
        reset_text: format_reset_time(reset),
        tz_text,
        archived,
    })
}

/// A Monday-to-Friday calendar date.
pub(crate) fn parse_trading_day(text: &str) -> AppResult<NaiveDate> {
    let day = NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d")
        .ok()
        .filter(|d| d.format("%Y-%m-%d").to_string() == text.trim())
        .ok_or_else(|| AppError::invalid("tradingDay", "must be a date (YYYY-MM-DD)"))?;
    if matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
        return Err(AppError::invalid(
            "tradingDay",
            "is not a trading day: trading days run Monday to Friday",
        ));
    }
    Ok(day)
}

/// The instant a local wall-clock time names; a time skipped by DST moves forward to the first valid minute.
fn local_instant(tz: Tz, at: NaiveDateTime) -> DateTime<Utc> {
    let mut t = at;
    for _ in 0..180 {
        if let Some(i) = tz.from_local_datetime(&t).earliest() {
            return i.with_timezone(&Utc);
        }
        t += chrono::Duration::minutes(1);
    }
    Utc.from_utc_datetime(&at)
}

/// When trading day `day` ends: its reset time on that date, or midnight after it for a 00:00 reset.
fn session_end(day: NaiveDate, tz: Tz, reset: NaiveTime) -> DateTime<Utc> {
    if reset == NaiveTime::MIN {
        local_instant(tz, day.succ_opt().unwrap_or(day).and_time(NaiveTime::MIN))
    } else {
        local_instant(tz, day.and_time(reset))
    }
}

fn previous_weekday(day: NaiveDate) -> NaiveDate {
    let back = match day.weekday() {
        Weekday::Mon => 3,
        Weekday::Sun => 2,
        _ => 1,
    };
    day.checked_sub_days(Days::new(back)).unwrap_or(day)
}

/// The trading day's window [start, end): it starts when the previous trading day ends, so a Monday
/// includes the weekend.
pub(crate) fn session_window(
    day: NaiveDate,
    tz: Tz,
    reset: NaiveTime,
) -> (DateTime<Utc>, DateTime<Utc>) {
    (
        session_end(previous_weekday(day), tz, reset),
        session_end(day, tz, reset),
    )
}

/* ---------- Stored rows ---------- */

struct Row {
    id: String,
    status: String,
    revision: i64,
    tz_snapshot: String,
    reset_snapshot: String,
    plan: [Option<String>; 5],
    max_risk: Option<i64>,
    plan_authored_at: Option<String>,
    plan_timing: Option<String>,
    reflection: [Option<String>; 7],
    no_trade_day: bool,
    checklist_id: Option<String>,
    checklist_snapshot: Option<String>,
    completed_at: Option<String>,
    first_completed_at: Option<String>,
    edited_after_completion_at: Option<String>,
    reopened_at: Option<String>,
    created_at: String,
    updated_at: String,
}

const COLUMNS: &str = "id, status, revision, timezone_snapshot, reset_time_snapshot,
    plan_focus, plan_setups, plan_no_trade_conditions, plan_commitments, plan_notes, plan_max_risk_micros,
    plan_authored_at, plan_timing,
    market_context, went_well, mistakes, emotions, key_lesson, next_action, reflection_notes, no_trade_day,
    checklist_id, checklist_name_snapshot, completed_at, first_completed_at, edited_after_completion_at, reopened_at,
    created_at, updated_at";

fn from_row(r: &rusqlite::Row) -> rusqlite::Result<Row> {
    row_at(r, 0)
}

fn stored(conn: &Connection, account_id: &str, day: &str) -> AppResult<Option<Row>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM daily_reviews WHERE account_id = ?1 AND trading_day = ?2"
            ),
            params![account_id, day],
            from_row,
        )
        .optional()?)
}

/* ---------- Trades of a day ---------- */

struct TradeNow {
    id: String,
    symbol: String,
    side: String,
    entry_at: String,
    exit_at: Option<String>,
    net: Option<i64>,
    pnl_status: String,
    trading_day: String,
    deleted: bool,
    updated_at: String,
}

fn trade_now(r: &rusqlite::Row) -> rusqlite::Result<TradeNow> {
    Ok(TradeNow {
        id: r.get(0)?,
        symbol: r.get(1)?,
        side: r.get(2)?,
        entry_at: r.get(3)?,
        exit_at: r.get(4)?,
        net: r.get(5)?,
        pnl_status: r.get(6)?,
        trading_day: r.get(7)?,
        deleted: r.get(8)?,
        updated_at: r.get(9)?,
    })
}
const TRADE_COLUMNS: &str = "t.id, t.symbol, t.side, t.entry_at, t.exit_at, t.net_pnl_micros, t.pnl_status, t.trading_day, t.deleted_at IS NOT NULL, t.updated_at";

/// Active trades of the account on `day`, in entry order (ties by id, so duplicate timestamps are stable).
fn day_trades(conn: &Connection, account_id: &str, day: &str) -> AppResult<Vec<TradeNow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TRADE_COLUMNS} FROM trades t
         WHERE t.account_id = ?1 AND t.trading_day = ?2 AND t.deleted_at IS NULL ORDER BY t.entry_at, t.id"
    ))?;
    let rows = stmt.query_map(params![account_id, day], trade_now)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

struct Link {
    trade_id: String,
    net: Option<i64>,
    pnl_status: String,
    updated_at: String,
}

fn links(conn: &Connection, review_id: &str) -> AppResult<Vec<(Link, TradeNow)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT l.trade_id, l.net_pnl_micros_snapshot, l.pnl_status_snapshot, l.trade_updated_at_snapshot, {TRADE_COLUMNS}
         FROM daily_review_trades l JOIN trades t ON t.id = l.trade_id
         WHERE l.daily_review_id = ?1 ORDER BY t.entry_at, t.id"
    ))?;
    let rows = stmt.query_map([review_id], |r| {
        let link = Link {
            trade_id: r.get(0)?,
            net: r.get(1)?,
            pnl_status: r.get(2)?,
            updated_at: r.get(3)?,
        };
        let t = TradeNow {
            id: r.get(4)?,
            symbol: r.get(5)?,
            side: r.get(6)?,
            entry_at: r.get(7)?,
            exit_at: r.get(8)?,
            net: r.get(9)?,
            pnl_status: r.get(10)?,
            trading_day: r.get(11)?,
            deleted: r.get(12)?,
            updated_at: r.get(13)?,
        };
        Ok((link, t))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Replace the review's trade links with the day's trades now.
fn relink(
    tx: &Transaction,
    review_id: &str,
    account_id: &str,
    day: &str,
    now: &str,
) -> AppResult<()> {
    tx.execute(
        "DELETE FROM daily_review_trades WHERE daily_review_id = ?1",
        [review_id],
    )?;
    for t in day_trades(tx, account_id, day)? {
        tx.execute(
            "INSERT INTO daily_review_trades (daily_review_id, trade_id, trading_day_snapshot, net_pnl_micros_snapshot,
                                              pnl_status_snapshot, trade_updated_at_snapshot, linked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![review_id, t.id, t.trading_day, t.net, t.pnl_status, t.updated_at, now],
        )?;
    }
    Ok(())
}

struct Membership {
    trades: Vec<DayTrade>,
    missing: Vec<MissingTrade>,
    outcome: DayOutcome,
    changed: bool,
}

fn membership(
    conn: &Connection,
    account_id: &str,
    day: &str,
    review_id: Option<&str>,
) -> AppResult<Membership> {
    let now = day_trades(conn, account_id, day)?;
    let linked = match review_id {
        Some(id) => links(conn, id)?,
        None => Vec::new(),
    };
    let mut changed = false;
    let trades = now
        .iter()
        .map(|t| {
            let link = review_id.map(|_| match linked.iter().find(|(l, _)| l.trade_id == t.id) {
                None => "added",
                Some((l, _))
                    if l.updated_at != t.updated_at
                        || l.net != t.net
                        || l.pnl_status != t.pnl_status =>
                {
                    "changed"
                }
                Some(_) => "linked",
            });
            changed |= link.is_some_and(|l| l != "linked");
            DayTrade {
                trade_id: t.id.clone(),
                symbol: t.symbol.clone(),
                side: t.side.clone(),
                entry_at: t.entry_at.clone(),
                exit_at: t.exit_at.clone(),
                net_pnl: t.net.map(micros_to_string),
                pnl_status: t.pnl_status.clone(),
                link: link.map(str::to_string),
            }
        })
        .collect();
    let missing: Vec<MissingTrade> = linked
        .iter()
        .filter(|(_, t)| t.deleted || t.trading_day != day)
        .map(|(l, t)| MissingTrade {
            trade_id: t.id.clone(),
            symbol: t.symbol.clone(),
            reason: if t.deleted { "deleted" } else { "moved" }.into(),
            moved_to: (!t.deleted).then(|| t.trading_day.clone()),
            net_pnl_when_saved: l.net.map(micros_to_string),
        })
        .collect();
    changed |= !missing.is_empty();
    let known: Vec<i64> = now.iter().filter_map(|t| t.net).collect();
    let open = now.iter().filter(|t| t.pnl_status == "open").count() as i64;
    let outcome = DayOutcome {
        trades: now.len() as i64,
        closed_with_known_pnl: known.len() as i64,
        unknown_pnl: now.len() as i64 - known.len() as i64 - open,
        open,
        net: (!known.is_empty()).then(|| micros_to_string(known.iter().sum())),
    };
    Ok(Membership {
        trades,
        missing,
        outcome,
        changed,
    })
}

/* ---------- Checklist ---------- */

fn answers(conn: &Connection, review_id: &str) -> AppResult<Vec<ChecklistAnswer>> {
    let mut stmt = conn.prepare(
        "SELECT a.checklist_item_id, a.item_label_snapshot, a.result, a.note, i.label, i.is_archived = 1
         FROM daily_review_answers a JOIN checklist_items i ON i.id = a.checklist_item_id
         WHERE a.daily_review_id = ?1 ORDER BY a.sort_order_snapshot, a.checklist_item_id",
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

/// Active items of a checklist not answered.
fn unanswered(
    conn: &Connection,
    checklist_id: Option<&str>,
    answered: &[ChecklistAnswer],
) -> AppResult<i64> {
    let Some(id) = checklist_id else { return Ok(0) };
    let mut stmt =
        conn.prepare("SELECT id FROM checklist_items WHERE checklist_id = ?1 AND is_archived = 0 AND deleted_at IS NULL")?;
    let items: Vec<String> = stmt
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(items
        .iter()
        .filter(|i| !answered.iter().any(|a| &a.item_id == *i))
        .count() as i64)
}

pub(crate) fn adherence(results: &[ChecklistAnswer], unanswered: i64) -> DailyAdherence {
    let count = |k: &str| results.iter().filter(|a| a.result == k).count() as i64;
    let (followed, missed) = (count("followed"), count("missed"));
    let answered = followed + missed;
    let percent = (answered > 0).then(|| {
        let p = Decimal::from(followed * 100) / Decimal::from(answered);
        canonical(p.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero))
    });
    DailyAdherence {
        followed,
        missed,
        not_applicable: count("not_applicable"),
        unanswered,
        answered,
        percent,
    }
}

fn events(conn: &Connection, review_id: &str) -> AppResult<Vec<ReviewEvent>> {
    let mut stmt =
        conn.prepare("SELECT kind, revision, at FROM daily_review_events WHERE daily_review_id = ?1 ORDER BY at, rowid")?;
    let rows = stmt.query_map([review_id], |r| {
        Ok(ReviewEvent {
            kind: r.get(0)?,
            revision: r.get(1)?,
            at: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn event(tx: &Transaction, review_id: &str, kind: &str, revision: i64, at: &str) -> AppResult<()> {
    tx.execute(
        "INSERT INTO daily_review_events (id, daily_review_id, kind, revision, at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), review_id, kind, revision, at],
    )?;
    Ok(())
}

fn to_review(conn: &Connection, account_id: &str, day: &str, row: Row) -> AppResult<DailyReview> {
    let answers = answers(conn, &row.id)?;
    let current: Option<(String, bool)> = match &row.checklist_id {
        Some(c) => conn
            .query_row(
                "SELECT name, is_archived = 1 FROM checklists WHERE id = ?1 AND deleted_at IS NULL",
                [c],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?,
        None => None,
    };
    let checklist = row
        .checklist_snapshot
        .clone()
        .or_else(|| current.as_ref().map(|c| c.0.clone()))
        .map(|label| LabelRef {
            current_label: current
                .as_ref()
                .filter(|c| c.0 != label)
                .map(|c| c.0.clone()),
            archived: current.as_ref().is_some_and(|c| c.1),
            id: row.checklist_id.clone(),
            label,
        });
    let open = unanswered(conn, row.checklist_id.as_deref(), &answers)?;
    let [focus, setups, no_trade_conditions, commitments, plan_notes] = row.plan;
    let [
        market_context,
        went_well,
        mistakes,
        emotions,
        key_lesson,
        next_action,
        reflection_notes,
    ] = row.reflection;
    Ok(DailyReview {
        adherence: adherence(&answers, open),
        events: events(conn, &row.id)?,
        id: row.id,
        account_id: account_id.into(),
        trading_day: day.into(),
        status: row.status,
        revision: row.revision,
        plan: Plan {
            focus,
            setups,
            no_trade_conditions,
            commitments,
            max_risk: row.max_risk.map(micros_to_string),
            notes: plan_notes,
            authored_at: row.plan_authored_at,
            timing: row.plan_timing,
        },
        reflection: Reflection {
            market_context,
            went_well,
            mistakes,
            emotions,
            key_lesson,
            next_action,
            notes: reflection_notes,
        },
        no_trade_day: row.no_trade_day,
        checklist,
        answers,
        saved_with: SessionSettings {
            timezone: row.tz_snapshot,
            reset_time: row.reset_snapshot,
        },
        completed_at: row.completed_at,
        first_completed_at: row.first_completed_at,
        edited_after_completion_at: row.edited_after_completion_at,
        reopened_at: row.reopened_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/* ---------- Reads ---------- */

/// One trading day of an account: its review (if any), the day's trades with their link status and the
/// closed-trade outcome. Archived accounts are readable.
pub fn get_day(
    conn: &Connection,
    account_id: &str,
    trading_day_text: &str,
) -> AppResult<DailyReviewDay> {
    get_day_at(conn, account_id, trading_day_text, Utc::now())
}

pub(crate) fn get_day_at(
    conn: &Connection,
    account_id: &str,
    text: &str,
    now: DateTime<Utc>,
) -> AppResult<DailyReviewDay> {
    let acct = account(conn, account_id)?;
    let day = parse_trading_day(text)?;
    let day_text = day.to_string();
    let current = trading_day(now, acct.tz, acct.reset);
    let row = stored(conn, account_id, &day_text)?;
    let m = membership(
        conn,
        account_id,
        &day_text,
        row.as_ref().map(|r| r.id.as_str()),
    )?;
    let review = row
        .map(|r| to_review(conn, account_id, &day_text, r))
        .transpose()?;
    let (start, end) = session_window(day, acct.tz, acct.reset);
    let session_settings_changed = review.as_ref().is_some_and(|r| {
        r.saved_with.timezone != acct.tz_text || r.saved_with.reset_time != acct.reset_text
    });
    let day_state = if m.outcome.trades > 0 {
        "traded"
    } else if review.as_ref().is_some_and(|r| r.no_trade_day) {
        "no_trade_day"
    } else {
        "no_trades_recorded"
    };
    Ok(DailyReviewDay {
        account_id: account_id.into(),
        trading_day: day_text,
        session: SessionSettings {
            timezone: acct.tz_text,
            reset_time: acct.reset_text,
        },
        session_start: format_instant(start),
        session_end: format_instant(end),
        current_trading_day: current.to_string(),
        is_future: day > current,
        archived: acct.archived,
        review,
        trades: m.trades,
        missing_trades: m.missing,
        outcome: m.outcome,
        day_state: day_state.into(),
        session_settings_changed,
        trades_changed: m.changed,
    })
}

/// Every review of an account (newest first), the current trading day, and legacy day notes.
pub fn list(conn: &Connection, account_id: &str) -> AppResult<DailyReviewIndex> {
    list_at(conn, account_id, Utc::now())
}

pub(crate) fn list_at(
    conn: &Connection,
    account_id: &str,
    now: DateTime<Utc>,
) -> AppResult<DailyReviewIndex> {
    let acct = account(conn, account_id)?;
    let rows: Vec<(String, Row)> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT trading_day, {COLUMNS} FROM daily_reviews WHERE account_id = ?1 ORDER BY trading_day DESC"
        ))?;
        let rows = stmt.query_map([account_id], |r| {
            let day: String = r.get(0)?;
            Ok((day, row_at(r, 1)?))
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut reviews = Vec::with_capacity(rows.len());
    for (day, row) in rows {
        let m = membership(conn, account_id, &day, Some(&row.id))?;
        let has_plan = row.plan.iter().any(Option::is_some) || row.max_risk.is_some();
        let has_reflection = row.reflection.iter().any(Option::is_some);
        let key_lesson = row.reflection[4].clone();
        let answered = answers(conn, &row.id)?;
        let open = unanswered(conn, row.checklist_id.as_deref(), &answered)?;
        reviews.push(DailyReviewSummary {
            adherence: adherence(&answered, open),
            outcome: m.outcome,
            trades_changed: m.changed,
            id: row.id,
            trading_day: day,
            status: row.status,
            revision: row.revision,
            plan_timing: row.plan_timing,
            has_plan,
            has_reflection,
            no_trade_day: row.no_trade_day,
            key_lesson,
            completed_at: row.completed_at,
            updated_at: row.updated_at,
        });
    }
    let legacy_notes = {
        let mut stmt = conn.prepare(
            "SELECT id, title, entry_at FROM journal_entries WHERE account_id = ?1 AND trade_id IS NULL
             ORDER BY entry_at DESC, id",
        )?;
        let rows = stmt.query_map([account_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter_map(|(id, title, entry_at)| {
                let at = parse_instant(&entry_at)?;
                Some(LegacyDayNote {
                    trading_day: trading_day(at, acct.tz, acct.reset).to_string(),
                    id,
                    title,
                    entry_at,
                })
            })
            .collect()
    };
    Ok(DailyReviewIndex {
        account_id: account_id.into(),
        current_trading_day: trading_day(now, acct.tz, acct.reset).to_string(),
        session: SessionSettings {
            timezone: acct.tz_text,
            reset_time: acct.reset_text,
        },
        archived: acct.archived,
        reviews,
        legacy_notes,
    })
}

fn row_at(r: &rusqlite::Row, o: usize) -> rusqlite::Result<Row> {
    Ok(Row {
        id: r.get(o)?,
        status: r.get(o + 1)?,
        revision: r.get(o + 2)?,
        tz_snapshot: r.get(o + 3)?,
        reset_snapshot: r.get(o + 4)?,
        plan: [
            r.get(o + 5)?,
            r.get(o + 6)?,
            r.get(o + 7)?,
            r.get(o + 8)?,
            r.get(o + 9)?,
        ],
        max_risk: r.get(o + 10)?,
        plan_authored_at: r.get(o + 11)?,
        plan_timing: r.get(o + 12)?,
        reflection: [
            r.get(o + 13)?,
            r.get(o + 14)?,
            r.get(o + 15)?,
            r.get(o + 16)?,
            r.get(o + 17)?,
            r.get(o + 18)?,
            r.get(o + 19)?,
        ],
        no_trade_day: r.get(o + 20)?,
        checklist_id: r.get(o + 21)?,
        checklist_snapshot: r.get(o + 22)?,
        completed_at: r.get(o + 23)?,
        first_completed_at: r.get(o + 24)?,
        edited_after_completion_at: r.get(o + 25)?,
        reopened_at: r.get(o + 26)?,
        created_at: r.get(o + 27)?,
        updated_at: r.get(o + 28)?,
    })
}

/* ---------- Writes ---------- */

fn text(issues: &mut Issues, field: &str, value: Option<String>) -> Option<String> {
    let value = value.filter(|v| !v.trim().is_empty());
    if value
        .as_ref()
        .is_some_and(|v| v.chars().count() > MAX_TEXT_CHARS)
    {
        issues.add(
            field,
            format!("must be at most {MAX_TEXT_CHARS} characters"),
        );
    }
    value
}

/// Writes need a live account: an archived account is read-only.
fn writable(conn: &Connection, account_id: &str) -> AppResult<Account> {
    let acct = account(conn, account_id)?;
    if acct.archived {
        return Err(AppError::Conflict {
            message: "this account is archived, so its daily reviews are read-only".into(),
        });
    }
    account_ctx(conn, account_id)?;
    Ok(acct)
}

fn check_revision(existing: &Option<Row>, expected: Option<i64>) -> AppResult<()> {
    match (existing, expected) {
        (Some(_), None) => Err(AppError::Conflict {
            message:
                "this day already has a review that you have not loaded; reload it before saving"
                    .into(),
        }),
        (Some(s), Some(r)) if s.revision != r => Err(AppError::Conflict {
            message:
                "this review was changed after you opened it; reload it and apply your edits again"
                    .into(),
        }),
        (None, Some(_)) => Err(AppError::Conflict {
            message: "this review no longer exists; reload the day".into(),
        }),
        _ => Ok(()),
    }
}

/// Save the day's review (create or update) in one transaction. Nothing is written when any check fails.
pub fn save(conn: &mut Connection, input: DailyReviewInput) -> AppResult<DailyReviewDay> {
    save_at(conn, input, Utc::now())
}

pub(crate) fn save_at(
    conn: &mut Connection,
    input: DailyReviewInput,
    at: DateTime<Utc>,
) -> AppResult<DailyReviewDay> {
    let mut issues = Issues::default();
    let complete = match input.action.as_str() {
        "save" => false,
        "complete" => true,
        _ => {
            issues.add("action", "must be save or complete");
            false
        }
    };
    let day = match parse_trading_day(&input.trading_day) {
        Ok(d) => Some(d),
        Err(AppError::Validation { issues: found, .. }) => {
            issues.0.extend(found);
            None
        }
        Err(e) => return Err(e),
    };
    let p = input.plan;
    let plan = [
        text(&mut issues, "plan.focus", p.focus),
        text(&mut issues, "plan.setups", p.setups),
        text(&mut issues, "plan.noTradeConditions", p.no_trade_conditions),
        text(&mut issues, "plan.commitments", p.commitments),
        text(&mut issues, "plan.notes", p.notes),
    ];
    let max_risk = match opt_text(p.max_risk) {
        None => None,
        Some(t) => match parse_decimal(&t).and_then(to_micros) {
            Some(m) if m > 0 => Some(m),
            Some(_) => {
                issues.add(
                    "plan.maxRisk",
                    "must be greater than zero (leave it empty when not set)",
                );
                None
            }
            None => {
                issues.add("plan.maxRisk", "must be an amount");
                None
            }
        },
    };
    let r = input.reflection;
    let reflection = [
        text(&mut issues, "reflection.marketContext", r.market_context),
        text(&mut issues, "reflection.wentWell", r.went_well),
        text(&mut issues, "reflection.mistakes", r.mistakes),
        text(&mut issues, "reflection.emotions", r.emotions),
        text(&mut issues, "reflection.keyLesson", r.key_lesson),
        text(&mut issues, "reflection.nextAction", r.next_action),
        text(&mut issues, "reflection.notes", r.notes),
    ];
    let checklist_id = opt_text(input.checklist_id);
    for (i, a) in input.answers.iter().enumerate() {
        if !RESULTS.contains(&a.result.as_str()) {
            issues.add(
                &format!("answers.{i}.result"),
                "must be followed, missed or not_applicable",
            );
        }
        if input.answers[..i].iter().any(|b| b.item_id == a.item_id) {
            issues.add(&format!("answers.{i}.itemId"), "answered twice");
        }
        if opt_text(a.note.clone()).is_some_and(|n| n.chars().count() > MAX_NOTE_CHARS) {
            issues.add(
                &format!("answers.{i}.note"),
                format!("must be at most {MAX_NOTE_CHARS} characters"),
            );
        }
    }
    if checklist_id.is_none() && !input.answers.is_empty() {
        issues.add(
            "checklistId",
            "choose the checklist these answers belong to",
        );
    }
    issues.into_result()?;
    let day = day.expect("validated");
    let day_text = day.to_string();

    let tx = conn.transaction()?;
    let acct = writable(&tx, &input.account_id)?;
    let current = trading_day(at, acct.tz, acct.reset);
    let mut issues = Issues::default();
    if day
        > current
            .checked_add_days(Days::new(MAX_DAYS_AHEAD))
            .unwrap_or(current)
    {
        issues.add(
            "tradingDay",
            format!("can be planned at most {MAX_DAYS_AHEAD} days ahead"),
        );
    }
    let has_reflection =
        reflection.iter().any(Option::is_some) || !input.answers.is_empty() || input.no_trade_day;
    if day > current && (has_reflection || complete) {
        issues.add(
            "tradingDay",
            "this trading day hasn't started; only its plan can be written now",
        );
    }
    let has_content = plan.iter().any(Option::is_some)
        || max_risk.is_some()
        || has_reflection
        || checklist_id.is_some();
    if complete && !has_content {
        issues.add("action", "write a plan, a reflection, answer the checklist or mark a no-trade day before completing");
    }
    if input.no_trade_day && !day_trades(&tx, &input.account_id, &day_text)?.is_empty() {
        issues.add(
            "noTradeDay",
            "trades are recorded for this day; it can't be marked a no-trade day",
        );
    }
    issues.into_result()?;

    let existing = stored(&tx, &input.account_id, &day_text)?;
    check_revision(&existing, input.expected_revision)?;

    // A checklist already on the review may be archived since; a new choice must be an active daily checklist.
    let mut issues = Issues::default();
    let checklist_snapshot = match &checklist_id {
        None => None,
        Some(id) => {
            let row: Option<(String, String, i64)> = tx
                .query_row("SELECT name, scope, is_archived FROM checklists WHERE id = ?1 AND deleted_at IS NULL", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })
                .optional()?;
            let kept = existing
                .as_ref()
                .filter(|s| s.checklist_id.as_ref() == Some(id));
            match (row, kept) {
                (Some((_, scope, _)), _) if scope != "daily" => {
                    issues.add(
                        "checklistId",
                        "a trade checklist is answered on a trade's review, not the day",
                    );
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

    let now = format_instant(at);
    let plan_has_content = plan.iter().any(Option::is_some) || max_risk.is_some();
    // Authored time is set when a plan first has content and cleared with it; a plan first written after the
    // session ended or after the day's first trade opened is retrospective.
    let (plan_authored_at, plan_timing) = match (&existing, plan_has_content) {
        (_, false) => (None, None),
        (Some(s), true) if s.plan_authored_at.is_some() => {
            (s.plan_authored_at.clone(), s.plan_timing.clone())
        }
        _ => {
            let (_, end) = session_window(day, acct.tz, acct.reset);
            let traded_before: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM trades WHERE account_id = ?1 AND trading_day = ?2 AND deleted_at IS NULL
                                AND entry_at <= ?3)",
                params![input.account_id, day_text, now],
                |r| r.get(0),
            )?;
            let timing = if at < end && !traded_before {
                "pre_session"
            } else {
                "retrospective"
            };
            (Some(now.clone()), Some(timing.to_string()))
        }
    };

    let (review_id, revision, created) = match &existing {
        Some(s) => (s.id.clone(), s.revision + 1, false),
        None => (new_id(), 1, true),
    };
    let was_completed = existing.as_ref().is_some_and(|s| s.status == "completed");
    let status = if complete || was_completed {
        "completed"
    } else {
        "draft"
    };
    let completed_at = match (&existing, complete) {
        (Some(s), false) => s.completed_at.clone(),
        (Some(s), true) if was_completed => s.completed_at.clone(),
        _ if complete => Some(now.clone()),
        _ => None,
    };
    let first_completed_at = existing
        .as_ref()
        .and_then(|s| s.first_completed_at.clone())
        .or_else(|| completed_at.clone());
    let edited_after = if was_completed {
        Some(now.clone())
    } else {
        existing
            .as_ref()
            .and_then(|s| s.edited_after_completion_at.clone())
    };
    let updated_at = match &existing {
        Some(s) => super::trades::later_than(&s.updated_at),
        None => now.clone(),
    };
    if created {
        tx.execute(
            "INSERT INTO daily_reviews (id, account_id, trading_day, timezone_snapshot, reset_time_snapshot, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![review_id, input.account_id, day_text, acct.tz_text, acct.reset_text, now],
        )?;
    }
    tx.execute(
        "UPDATE daily_reviews SET status = ?2, revision = ?3, timezone_snapshot = ?4, reset_time_snapshot = ?5,
                plan_focus = ?6, plan_setups = ?7, plan_no_trade_conditions = ?8, plan_commitments = ?9, plan_notes = ?10,
                plan_max_risk_micros = ?11, plan_authored_at = ?12, plan_timing = ?13,
                market_context = ?14, went_well = ?15, mistakes = ?16, emotions = ?17, key_lesson = ?18, next_action = ?19,
                reflection_notes = ?20, no_trade_day = ?21, checklist_id = ?22, checklist_name_snapshot = ?23,
                completed_at = ?24, first_completed_at = ?25, edited_after_completion_at = ?26, updated_at = ?27
         WHERE id = ?1",
        params![
            review_id,
            status,
            revision,
            acct.tz_text,
            acct.reset_text,
            plan[0],
            plan[1],
            plan[2],
            plan[3],
            plan[4],
            max_risk,
            plan_authored_at,
            plan_timing,
            reflection[0],
            reflection[1],
            reflection[2],
            reflection[3],
            reflection[4],
            reflection[5],
            reflection[6],
            input.no_trade_day,
            checklist_id,
            checklist_snapshot,
            completed_at,
            first_completed_at,
            edited_after,
            updated_at,
        ],
    )?;

    // Checklist answers: an item answered before keeps the label it was answered under.
    let mut issues = Issues::default();
    let current_answers: Vec<(String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT id, checklist_item_id FROM daily_review_answers WHERE daily_review_id = ?1",
        )?;
        stmt.query_map([&review_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    for (i, answer) in input.answers.iter().enumerate() {
        let item: Option<(String, String, i64, bool)> = tx
            .query_row(
                "SELECT checklist_id, label, sort_order, is_archived = 1 FROM checklist_items WHERE id = ?1 AND deleted_at IS NULL",
                [&answer.item_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let note = opt_text(answer.note.clone());
        let answered = current_answers
            .iter()
            .find(|(_, item_id)| *item_id == answer.item_id);
        match (item, answered) {
            (Some((owner, ..)), _) if Some(&owner) != checklist_id.as_ref() => issues.add(
                &format!("answers.{i}.itemId"),
                "item is not on the chosen checklist",
            ),
            (Some(_), Some((answer_id, _))) => {
                tx.execute(
                    "UPDATE daily_review_answers SET result = ?2, note = ?3,
                            updated_at = CASE WHEN result = ?2 AND note IS ?3 THEN updated_at ELSE ?4 END
                     WHERE id = ?1",
                    params![answer_id, answer.result, note, now],
                )?;
            }
            (Some((_, label, order, false)), None) => {
                tx.execute(
                    "INSERT INTO daily_review_answers (id, daily_review_id, checklist_item_id, item_label_snapshot,
                                                       sort_order_snapshot, result, note, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![new_id(), review_id, answer.item_id, label, order, answer.result, note, now],
                )?;
            }
            (Some(_), None) => issues.add(&format!("answers.{i}.itemId"), "this item is archived"),
            (None, _) => issues.add(&format!("answers.{i}.itemId"), "item not found"),
        }
    }
    // An answer no longer given is cleared: unanswered is its own state, not a failure.
    for (answer_id, item_id) in &current_answers {
        if !input.answers.iter().any(|a| &a.item_id == item_id) {
            tx.execute(
                "DELETE FROM daily_review_answers WHERE id = ?1",
                [answer_id],
            )?;
        }
    }
    issues.into_result()?;

    relink(&tx, &review_id, &input.account_id, &day_text, &now)?;
    if created {
        event(&tx, &review_id, "created", revision, &now)?;
    }
    let kind = if complete && !was_completed {
        "completed"
    } else if was_completed {
        "edited"
    } else {
        "saved"
    };
    if !(created && kind == "saved") {
        event(&tx, &review_id, kind, revision, &now)?;
    }
    tx.commit()?;
    get_day_at(conn, &input.account_id, &day_text, at)
}

/// Move a completed review back to draft. Its first completion and history are kept.
pub fn reopen(conn: &mut Connection, input: DailyReviewRef) -> AppResult<DailyReviewDay> {
    reopen_at(conn, input, Utc::now())
}

pub(crate) fn reopen_at(
    conn: &mut Connection,
    input: DailyReviewRef,
    at: DateTime<Utc>,
) -> AppResult<DailyReviewDay> {
    let day = parse_trading_day(&input.trading_day)?.to_string();
    let tx = conn.transaction()?;
    writable(&tx, &input.account_id)?;
    let existing = stored(&tx, &input.account_id, &day)?;
    check_revision(&existing, Some(input.expected_revision))?;
    let row = existing.expect("checked");
    if row.status != "completed" {
        return Err(AppError::Conflict {
            message: "this review is already a draft".into(),
        });
    }
    let now = format_instant(at);
    let revision = row.revision + 1;
    tx.execute(
        "UPDATE daily_reviews SET status = 'draft', completed_at = NULL, reopened_at = ?2, revision = ?3, updated_at = ?4
         WHERE id = ?1",
        params![row.id, now, revision, super::trades::later_than(&row.updated_at)],
    )?;
    event(&tx, &row.id, "reopened", revision, &now)?;
    tx.commit()?;
    get_day_at(conn, &input.account_id, &day, at)
}

/// Accept the day's trades as they are now (after a reimport, correction, deletion or timezone change)
/// without changing the review's text or status.
pub fn relink_trades(conn: &mut Connection, input: DailyReviewRef) -> AppResult<DailyReviewDay> {
    relink_at(conn, input, Utc::now())
}

pub(crate) fn relink_at(
    conn: &mut Connection,
    input: DailyReviewRef,
    at: DateTime<Utc>,
) -> AppResult<DailyReviewDay> {
    let day = parse_trading_day(&input.trading_day)?.to_string();
    let tx = conn.transaction()?;
    let acct = writable(&tx, &input.account_id)?;
    let existing = stored(&tx, &input.account_id, &day)?;
    check_revision(&existing, Some(input.expected_revision))?;
    let row = existing.expect("checked");
    let now = format_instant(at);
    let revision = row.revision + 1;
    tx.execute(
        "UPDATE daily_reviews SET revision = ?2, timezone_snapshot = ?3, reset_time_snapshot = ?4, updated_at = ?5 WHERE id = ?1",
        params![row.id, revision, acct.tz_text, acct.reset_text, super::trades::later_than(&row.updated_at)],
    )?;
    relink(&tx, &row.id, &input.account_id, &day, &now)?;
    event(&tx, &row.id, "relinked", revision, &now)?;
    tx.commit()?;
    get_day_at(conn, &input.account_id, &day, at)
}
