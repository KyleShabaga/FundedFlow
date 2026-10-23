//! Account snapshots: persisted risk figures for one account and trading day,
//! written by the rule engine (Build 16) through this repository. This module
//! stores and reads what it is given. It calculates nothing, so a snapshot is
//! only as good as its `explanation` and `inputsHash`; the repository never
//! fills a missing figure with zero.
//!
//! End-of-day rows are idempotent: saving the same (account, day, engine
//! version, inputs hash) again returns the stored row. These are calculated outputs; raw EOD evidence comes from financial_observations.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{account_ctx, frozen_v1, require_account};
use crate::domain::{
    format_instant, micros_to_string, new_id, now, parse_decimal, parse_payload_time, to_micros,
};
use crate::error::{AppError, AppResult, Issues};

pub const DATA_SOURCES: &[&str] = &["csv_import", "manual", "mixed", "none"];
pub const DRAWDOWN_MODES: &[&str] = &["static", "eod_trailing", "intraday_trailing"];
pub const STATUSES: &[&str] = &["safe", "caution", "stop", "unknown", "needs_setup"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotInput {
    pub account_id: String,
    /// The rulebook version the figures were evaluated against, if any.
    pub rulebook_version_id: Option<String>,
    /// YYYY-MM-DD.
    pub trading_day: String,
    pub is_end_of_day: bool,
    /// Newest trade or ledger entry included (ISO 8601 with offset).
    pub data_as_of: Option<String>,
    pub data_source: String,
    pub engine_version: String,
    pub inputs_hash: String,
    pub fees_included: bool,
    pub unrealized_included: bool,
    pub balance: Option<String>,
    pub realized_day_pnl: Option<String>,
    pub unrealized_pnl: Option<String>,
    pub daily_loss_limit: Option<String>,
    pub daily_loss_remaining: Option<String>,
    pub drawdown_mode: Option<String>,
    pub high_water_mark: Option<String>,
    pub drawdown_floor: Option<String>,
    pub drawdown_headroom: Option<String>,
    pub drawdown_locked: Option<bool>,
    pub profit_target: Option<String>,
    pub trading_days_completed: Option<u32>,
    pub trading_days_required: Option<u32>,
    pub status: String,
    pub status_reasons: Vec<String>,
    /// Inputs, formula steps, rule ids and contributing trade ids. Must be a non-empty object.
    pub explanation: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub account_id: String,
    pub rulebook_version_id: Option<String>,
    pub trading_day: String,
    pub is_end_of_day: bool,
    pub data_as_of: Option<String>,
    pub data_source: String,
    pub calculated_at: String,
    pub engine_version: String,
    pub inputs_hash: String,
    pub fees_included: bool,
    pub unrealized_included: bool,
    pub balance: Option<String>,
    pub realized_day_pnl: Option<String>,
    pub unrealized_pnl: Option<String>,
    pub daily_loss_limit: Option<String>,
    pub daily_loss_remaining: Option<String>,
    pub drawdown_mode: Option<String>,
    pub high_water_mark: Option<String>,
    pub drawdown_floor: Option<String>,
    pub drawdown_headroom: Option<String>,
    pub drawdown_locked: Option<bool>,
    pub profit_target: Option<String>,
    pub trading_days_completed: Option<u32>,
    pub trading_days_required: Option<u32>,
    pub status: String,
    pub status_reasons: Vec<String>,
    pub explanation: serde_json::Value,
}

fn is_day(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .is_ok_and(|d| d.format("%Y-%m-%d").to_string() == s)
}

fn money(issues: &mut Issues, field: &str, value: &str) -> i64 {
    match parse_decimal(value).and_then(to_micros) {
        Some(m) => m,
        None => {
            issues.add(field, "must be a number");
            0
        }
    }
}

fn opt_money(issues: &mut Issues, field: &str, value: &Option<String>) -> Option<i64> {
    value.as_deref().map(|v| money(issues, field, v))
}

const COLUMNS: &str = "id, account_id, rulebook_version_id, trading_day, is_end_of_day, data_as_of, data_source,
    calculated_at, engine_version, inputs_hash, fees_included, unrealized_included, balance_micros,
    realized_day_pnl_micros, unrealized_pnl_micros, daily_loss_limit_micros, daily_loss_remaining_micros,
    drawdown_mode, high_water_mark_micros, drawdown_floor_micros, drawdown_headroom_micros, drawdown_locked,
    profit_target_micros, trading_days_completed, trading_days_required, status, status_reasons_json,
    explanation_json";

fn from_row(r: &rusqlite::Row) -> rusqlite::Result<Snapshot> {
    let m = |i: usize| -> rusqlite::Result<Option<String>> {
        Ok(r.get::<_, Option<i64>>(i)?.map(micros_to_string))
    };
    let json = |i: usize| -> rusqlite::Result<String> { r.get(i) };
    let bad = |e: serde_json::Error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    };
    Ok(Snapshot {
        id: r.get(0)?,
        account_id: r.get(1)?,
        rulebook_version_id: r.get(2)?,
        trading_day: r.get(3)?,
        is_end_of_day: r.get(4)?,
        data_as_of: r.get(5)?,
        data_source: r.get(6)?,
        calculated_at: r.get(7)?,
        engine_version: r.get(8)?,
        inputs_hash: r.get(9)?,
        fees_included: r.get(10)?,
        unrealized_included: r.get(11)?,
        balance: m(12)?,
        realized_day_pnl: m(13)?,
        unrealized_pnl: m(14)?,
        daily_loss_limit: m(15)?,
        daily_loss_remaining: m(16)?,
        drawdown_mode: r.get(17)?,
        high_water_mark: m(18)?,
        drawdown_floor: m(19)?,
        drawdown_headroom: m(20)?,
        drawdown_locked: r.get(21)?,
        profit_target: m(22)?,
        trading_days_completed: r.get(23)?,
        trading_days_required: r.get(24)?,
        status: r.get(25)?,
        status_reasons: serde_json::from_str(&json(26)?).map_err(bad)?,
        explanation: serde_json::from_str(&json(27)?).map_err(bad)?,
    })
}

/// A row as stored: its explanation may still be in the compact `frozen-v1` form.
pub(super) fn get_stored(conn: &Connection, id: &str) -> AppResult<Option<Snapshot>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM account_snapshots WHERE id = ?1"),
            [id],
            from_row,
        )
        .optional()?)
}

/// Replaces a stored explanation with the one it encodes (TASK-045).
fn decoded(decoder: &mut frozen_v1::Decoder, mut snapshot: Snapshot) -> AppResult<Snapshot> {
    let raw = std::mem::take(&mut snapshot.explanation);
    snapshot.explanation = decoder.decode(&snapshot.account_id, raw)?;
    Ok(snapshot)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Snapshot> {
    let snapshot = get_stored(conn, id)?.ok_or_else(|| AppError::not_found("snapshot", id))?;
    decoded(&mut frozen_v1::Decoder::new(conn), snapshot)
}

/// Validated, converted figures of a snapshot input, ready to insert.
pub(super) struct Prepared {
    data_as_of: Option<String>,
    balance: Option<i64>,
    realized: Option<i64>,
    unrealized: Option<i64>,
    limit: Option<i64>,
    remaining: Option<i64>,
    hwm: Option<i64>,
    floor: Option<i64>,
    headroom: Option<i64>,
    target: Option<i64>,
}

/// Store a snapshot as history, or return the existing end-of-day row for the same inputs.
/// Writes only to a non-archived account. A saved snapshot is never the account's current risk
/// result: only `risk_promotion::promote` can make one current (P0-02). IMMEDIATE, because storing an engine
/// calculation reads the account's frozen spans and may open the next generation (TASK-045).
pub fn save(conn: &mut Connection, input: SnapshotInput) -> AppResult<Snapshot> {
    let prepared = prepare(&input)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let saved = insert_prepared(&tx, &input, prepared)?;
    tx.commit()?;
    Ok(saved)
}

/// Every check a snapshot passes before it is written (field formats, engine identity, frozen
/// inputs, hash and metric projection). Reads nothing.
pub(super) fn prepare(input: &SnapshotInput) -> AppResult<Prepared> {
    let mut issues = Issues::default();
    if !is_day(&input.trading_day) {
        issues.add("tradingDay", "use a trading day as YYYY-MM-DD");
    }
    if !DATA_SOURCES.contains(&input.data_source.as_str()) {
        issues.add(
            "dataSource",
            format!("must be one of {}", DATA_SOURCES.join(", ")),
        );
    }
    if !STATUSES.contains(&input.status.as_str()) {
        issues.add("status", format!("must be one of {}", STATUSES.join(", ")));
    }
    if input
        .drawdown_mode
        .as_deref()
        .is_some_and(|m| !DRAWDOWN_MODES.contains(&m))
    {
        issues.add(
            "drawdownMode",
            format!("must be one of {}", DRAWDOWN_MODES.join(", ")),
        );
    }
    if input.engine_version.trim().is_empty() {
        issues.add("engineVersion", "required");
    }
    if input.inputs_hash.trim().is_empty() {
        issues.add("inputsHash", "required");
    }
    if !input.explanation.as_object().is_some_and(|o| !o.is_empty()) {
        issues.add(
            "explanation",
            "must be a non-empty object that explains the figures",
        );
    }
    if input.status == "unknown" && input.status_reasons.is_empty() {
        issues.add("statusReasons", "an unknown status must say why");
    }
    let data_as_of = match input
        .data_as_of
        .as_deref()
        .map(parse_payload_time)
        .transpose()
    {
        Ok(t) => t.map(format_instant),
        Err(m) => {
            issues.add("dataAsOf", m);
            None
        }
    };
    let balance = opt_money(&mut issues, "balance", &input.balance);
    let realized = opt_money(&mut issues, "realizedDayPnl", &input.realized_day_pnl);
    let unrealized = opt_money(&mut issues, "unrealizedPnl", &input.unrealized_pnl);
    let limit = opt_money(&mut issues, "dailyLossLimit", &input.daily_loss_limit);
    let remaining = opt_money(
        &mut issues,
        "dailyLossRemaining",
        &input.daily_loss_remaining,
    );
    let hwm = opt_money(&mut issues, "highWaterMark", &input.high_water_mark);
    let floor = opt_money(&mut issues, "drawdownFloor", &input.drawdown_floor);
    let headroom = opt_money(&mut issues, "drawdownHeadroom", &input.drawdown_headroom);
    let target = opt_money(&mut issues, "profitTarget", &input.profit_target);
    if matches!(input.status.as_str(), "safe" | "caution")
        && (balance.is_none() || realized.is_none())
    {
        issues.add(
            "status",
            "safe/caution requires known balance and daily P&L",
        );
    }
    validate_engine_payload(input, &mut issues);
    issues.into_result()?;
    Ok(Prepared {
        data_as_of,
        balance,
        realized,
        unrealized,
        limit,
        remaining,
        hwm,
        floor,
        headroom,
        target,
    })
}

/// Writes a prepared snapshot inside the caller's transaction (or returns the identical end-of-day row).
pub(super) fn insert_prepared(
    tx: &Connection,
    input: &SnapshotInput,
    p: Prepared,
) -> AppResult<Snapshot> {
    let Prepared {
        data_as_of,
        balance,
        realized,
        unrealized,
        limit,
        remaining,
        hwm,
        floor,
        headroom,
        target,
    } = p;
    account_ctx(tx, &input.account_id)?;
    if let Some(version) = &input.rulebook_version_id {
        let owner: Option<Option<String>> = tx.query_row(
            "SELECT b.owner_account_id FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id WHERE v.id = ?1",
            [version], |r| r.get(0),
        ).optional()?;
        match owner {
            None => {
                return Err(AppError::invalid(
                    "rulebookVersionId",
                    "Unknown rulebook version",
                ));
            }
            Some(Some(owner)) if owner != input.account_id => {
                return Err(AppError::invalid(
                    "rulebookVersionId",
                    "This rulebook belongs to another account",
                ));
            }
            _ => {}
        }
    }
    if input.is_end_of_day {
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM account_snapshots WHERE account_id = ?1 AND trading_day = ?2 AND engine_version = ?3
                   AND inputs_hash = ?4 AND is_end_of_day = 1",
                params![input.account_id, input.trading_day, input.engine_version, input.inputs_hash],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return get(tx, &id);
        }
    }
    let id = new_id();
    // TASK-045: an engine calculation is stored in the compact `frozen-v1` form when that decodes exactly.
    let explanation = frozen_v1::encode(
        tx,
        &input.account_id,
        &input.engine_version,
        &input.explanation,
    )?
    .text;
    tx.execute(
        &format!(
            "INSERT INTO account_snapshots ({COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
                     ?22, ?23, ?24, ?25, ?26, ?27, ?28)"
        ),
        params![
            id,
            input.account_id,
            input.rulebook_version_id,
            input.trading_day,
            input.is_end_of_day,
            data_as_of,
            input.data_source,
            now(),
            input.engine_version,
            input.inputs_hash,
            input.fees_included,
            input.unrealized_included,
            balance,
            realized,
            unrealized,
            limit,
            remaining,
            input.drawdown_mode,
            hwm,
            floor,
            headroom,
            input.drawdown_locked,
            target,
            input.trading_days_completed,
            input.trading_days_required,
            input.status,
            serde_json::to_string(&input.status_reasons).map_err(|e| AppError::invalid("statusReasons", e.to_string()))?,
            explanation,
        ],
    )?;
    get(tx, &id)
}

/// Snapshots of an account, newest day first. `from` and `to` are inclusive trading days.
/// Readable for archived accounts.
pub fn list(
    conn: &Connection,
    account_id: &str,
    from: Option<&str>,
    to: Option<&str>,
    end_of_day_only: bool,
) -> AppResult<Vec<Snapshot>> {
    require_account(conn, account_id)?;
    for (field, v) in [("from", from), ("to", to)] {
        if v.is_some_and(|d| !is_day(d)) {
            return Err(AppError::invalid(field, "use a trading day as YYYY-MM-DD"));
        }
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM account_snapshots
         WHERE account_id = ?1 AND (?2 IS NULL OR trading_day >= ?2) AND (?3 IS NULL OR trading_day <= ?3)
           AND (?4 = 0 OR is_end_of_day = 1)
         ORDER BY trading_day DESC, calculated_at DESC, id"
    ))?;
    let rows = stmt.query_map(params![account_id, from, to, end_of_day_only], from_row)?;
    let mut decoder = frozen_v1::Decoder::new(conn);
    rows.map(|row| decoded(&mut decoder, row?)).collect()
}

/// The most recently calculated snapshot of the account, if any.
pub fn latest(conn: &Connection, account_id: &str) -> AppResult<Option<Snapshot>> {
    require_account(conn, account_id)?;
    conn.query_row(
            &format!("SELECT {COLUMNS} FROM account_snapshots WHERE account_id = ?1 ORDER BY calculated_at DESC, id DESC LIMIT 1"),
            [account_id],
            from_row,
        )
        .optional()?
        .map(|s| decoded(&mut frozen_v1::Decoder::new(conn), s))
        .transpose()
}

/// Whether a stored engine row, rebuilt as the input that wrote it (money as decimal text, as `from_row`
/// reads it), passes `validate_engine_payload`: identity, frozen inputs, inputs hash and metric projection.
/// Migration 23's eligibility check, and the tests' re-check of decoded rows.
pub(crate) fn engine_payload_valid(s: &Snapshot) -> bool {
    let input = SnapshotInput {
        account_id: s.account_id.clone(),
        rulebook_version_id: s.rulebook_version_id.clone(),
        trading_day: s.trading_day.clone(),
        is_end_of_day: s.is_end_of_day,
        data_as_of: s.data_as_of.clone(),
        data_source: s.data_source.clone(),
        engine_version: s.engine_version.clone(),
        inputs_hash: s.inputs_hash.clone(),
        fees_included: s.fees_included,
        unrealized_included: s.unrealized_included,
        balance: s.balance.clone(),
        realized_day_pnl: s.realized_day_pnl.clone(),
        unrealized_pnl: s.unrealized_pnl.clone(),
        daily_loss_limit: s.daily_loss_limit.clone(),
        daily_loss_remaining: s.daily_loss_remaining.clone(),
        drawdown_mode: s.drawdown_mode.clone(),
        high_water_mark: s.high_water_mark.clone(),
        drawdown_floor: s.drawdown_floor.clone(),
        drawdown_headroom: s.drawdown_headroom.clone(),
        drawdown_locked: s.drawdown_locked,
        profit_target: s.profit_target.clone(),
        trading_days_completed: s.trading_days_completed,
        trading_days_required: s.trading_days_required,
        status: s.status.clone(),
        status_reasons: s.status_reasons.clone(),
        explanation: s.explanation.clone(),
    };
    let mut issues = Issues::default();
    validate_engine_payload(&input, &mut issues);
    issues.into_result().is_ok()
}

/// Canonical JSON shared with the portable engine (UTF-16 ordering, including collections).
pub(crate) fn canonical_engine_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Array(a) => {
            let mut items: Vec<_> = a.iter().map(canonical_engine_json).collect();
            items.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            format!("[{}]", items.join(","))
        }
        serde_json::Value::Object(o) => {
            let mut items: Vec<_> = o.iter().collect();
            items.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
            format!(
                "{{{}}}",
                items
                    .into_iter()
                    .map(|(k, v)| format!(
                        "{}:{}",
                        serde_json::to_string(k).expect("string serializes"),
                        canonical_engine_json(v)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        _ => value.to_string(),
    }
}
fn validate_engine_payload(input: &SnapshotInput, issues: &mut Issues) {
    if !input.engine_version.starts_with("fundedflow-risk/") {
        return;
    } // Existing caller-supplied snapshots remain compatible.
    let e = &input.explanation["engine"];
    let frozen = &input.explanation["inputs"];
    let policy = &input.explanation["policy"];
    let expected =
        serde_json::json!({"engineVersion":input.engine_version,"input":frozen,"policy":policy});
    let hash = format!(
        "{:x}",
        Sha256::digest(canonical_engine_json(&expected).as_bytes())
    );
    let checks = [
        e["accountId"] == input.account_id,
        e["engineVersion"] == input.engine_version,
        e["inputsHash"] == input.inputs_hash,
        e["tradingDay"] == input.trading_day,
        e["rulebookVersionId"] == serde_json::json!(input.rulebook_version_id),
        e["balance"] == serde_json::json!(input.balance),
        e["realizedDayPnl"] == serde_json::json!(input.realized_day_pnl),
        frozen["account"]["id"] == input.account_id,
        frozen["asOf"] == e["asOf"],
        e["dataAsOf"] == serde_json::json!(input.data_as_of),
        e["status"]
            .as_str()
            .is_some_and(|s| s.to_ascii_lowercase() == input.status),
        hash == input.inputs_hash,
        policy.is_object(),
        frozen.is_object(),
    ];
    let projected = |field: &str| {
        let values: Vec<_> = e["rules"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|r| {
                matches!(
                    r["state"].as_str(),
                    Some("satisfied" | "breached" | "caution")
                )
            })
            .filter_map(|r| r["metrics"].get(field))
            .filter(|v| !v.is_null())
            .cloned()
            .collect();
        if values.len() == 1 {
            values[0].clone()
        } else {
            serde_json::Value::Null
        }
    };
    let metric_checks = [
        ("dailyLossLimit", serde_json::json!(input.daily_loss_limit)),
        (
            "dailyLossRemaining",
            serde_json::json!(input.daily_loss_remaining),
        ),
        ("highWaterMark", serde_json::json!(input.high_water_mark)),
        ("drawdownFloor", serde_json::json!(input.drawdown_floor)),
        (
            "drawdownHeadroom",
            serde_json::json!(input.drawdown_headroom),
        ),
        ("drawdownLocked", serde_json::json!(input.drawdown_locked)),
        ("profitTarget", serde_json::json!(input.profit_target)),
        (
            "tradingDaysRequired",
            serde_json::json!(input.trading_days_required),
        ),
    ];
    if e["tradingDaysCompleted"] != serde_json::json!(input.trading_days_completed)
        || metric_checks
            .into_iter()
            .any(|(field, value)| projected(field) != value)
    {
        issues.add(
            "explanation",
            "stored metric projection must match engine output",
        );
    }
    if checks.iter().any(|ok| !ok) {
        issues.add(
            "explanation",
            "engine snapshot identity, frozen inputs, hash and figures must agree",
        );
    }
}
