//! Build 23 Insights read: one read-only snapshot of exactly the requested
//! account attempts (archived ones included: they are read-only history) with
//! their active trades and what each trade's review recorded. Nothing is
//! written and nothing is calculated that is not already stored, except the
//! review's planned risk and R multiple, which use the same functions as the
//! trade review (`reviews::risk_from_plan`, `reviews::r_multiple`).
//!
//! Scope is by local account id only: a broker account number reused across
//! reset attempts never merges their trades, and the selection does not
//! depend on the active account or on `list_active_accounts`. Soft-deleted
//! trades are left out and counted. Aggregation is the shared TypeScript
//! engine in `packages/domain/src/insights` (mirrored by `crate::insights`
//! for the parity fixture).

use std::collections::{BTreeSet, HashMap};

use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::reviews::{r_multiple, risk_from_plan, ReviewTag};
use super::{accounts, load_instruments, require_account};
use crate::domain::{micros_to_string, now, parse_decimal, resolve_instrument};
use crate::error::{AppError, AppResult};

/// Version of the dataset wire shape (`INSIGHTS_CONTRACT_VERSION` in the domain package).
pub const CONTRACT_VERSION: u32 = 1;
/// Most attempts one request may name.
pub const MAX_ACCOUNTS: usize = 500;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InsightsQuery {
    pub account_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsReview {
    pub reviewed: bool,
    pub strategy_id: Option<String>,
    pub strategy_name: Option<String>,
    pub tags: Vec<ReviewTag>,
    pub planned_risk: Option<String>,
    pub planned_risk_source: Option<String>,
    pub r_multiple: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsTrade {
    pub id: String,
    pub account_id: String,
    pub source: String,
    pub import_batch_id: Option<String>,
    pub symbol: String,
    pub symbol_root: Option<String>,
    pub side: String,
    pub quantity: String,
    pub entry_at: String,
    pub exit_at: Option<String>,
    pub trading_day: String,
    pub fees: String,
    pub gross_pnl: Option<String>,
    pub realized_pnl: Option<String>,
    pub reported_pnl: Option<String>,
    pub pnl_status: String,
    pub updated_at: String,
    pub review: Option<InsightsReview>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsStatusEvent {
    pub status: String,
    pub effective_at: String,
    pub cause: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsAccount {
    pub id: String,
    pub name: String,
    pub broker: Option<String>,
    pub prop_firm: Option<String>,
    pub external_ref: Option<String>,
    pub account_type: String,
    pub status: String,
    pub archived_at: Option<String>,
    pub currency: String,
    pub timezone: String,
    pub trading_day_reset_time: String,
    pub created_at: String,
    pub lineage_root_id: String,
    pub attempt_number: u32,
    pub predecessor_account_id: Option<String>,
    pub successor_account_id: Option<String>,
    /// The latest status event with the account's current status: what the user entered, never inferred.
    pub status_event: Option<InsightsStatusEvent>,
    pub deleted_trade_count: i64,
    pub committed_import_count: i64,
    pub failed_import_count: i64,
    pub last_import_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsDataset {
    pub contract_version: u32,
    pub generated_at: String,
    pub accounts: Vec<InsightsAccount>,
    pub trades: Vec<InsightsTrade>,
}

pub fn dataset(conn: &Connection, query: InsightsQuery) -> AppResult<InsightsDataset> {
    dataset_at(conn, query, &now())
}

/// As `dataset`, with "now" given (tests and the wire fixture).
pub fn dataset_at(conn: &Connection, query: InsightsQuery, generated_at: &str) -> AppResult<InsightsDataset> {
    let mut ids: Vec<String> = Vec::new();
    let mut seen = BTreeSet::new();
    for id in query.account_ids.iter().map(|s| s.trim()) {
        if id.is_empty() {
            return Err(AppError::invalid("accountIds", "must not contain a blank id"));
        }
        if seen.insert(id.to_string()) {
            ids.push(id.to_string());
        }
    }
    if ids.is_empty() {
        return Err(AppError::invalid("accountIds", "choose at least one account"));
    }
    if ids.len() > MAX_ACCOUNTS {
        return Err(AppError::invalid("accountIds", format!("at most {MAX_ACCOUNTS} accounts at a time")));
    }
    for id in &ids {
        require_account(conn, id)?;
    }

    let accounts = ids.iter().map(|id| account(conn, id)).collect::<AppResult<Vec<_>>>()?;
    let currency: HashMap<&str, &str> = accounts.iter().map(|a| (a.id.as_str(), a.currency.as_str())).collect();
    let instruments = load_instruments(conn)?;

    let placeholders = vec!["?"; ids.len()].join(", ");
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id, t.account_id, t.source, t.import_batch_id, t.symbol, t.side, t.quantity, t.entry_at, t.exit_at,
                t.trading_day, t.fees_micros, t.gross_pnl_micros, t.net_pnl_micros, t.reported_pnl_micros, t.pnl_status,
                t.updated_at,
                r.id, r.reviewed_at IS NOT NULL, r.strategy_id, coalesce(r.strategy_name_snapshot, s.name),
                r.planned_risk_micros, r.planned_entry_price, r.planned_stop_price
         FROM trades t
         LEFT JOIN trade_reviews r ON r.trade_id = t.id AND r.account_id = t.account_id AND r.deleted_at IS NULL
         LEFT JOIN strategies s ON s.id = r.strategy_id
         WHERE t.deleted_at IS NULL AND t.account_id IN ({placeholders})
         ORDER BY t.trading_day, coalesce(t.exit_at, t.entry_at), t.id"
    ))?;
    struct Row {
        trade: InsightsTrade,
        net: Option<i64>,
        review_id: Option<String>,
        reviewed: bool,
        strategy_id: Option<String>,
        strategy_name: Option<String>,
        entered_risk: Option<i64>,
        entry: Option<String>,
        stop: Option<String>,
    }
    let rows = stmt
        .query_map(params_from_iter(ids.iter()), |r| {
            let money = |i: usize| r.get::<_, Option<i64>>(i).map(|m| m.map(micros_to_string));
            let net: Option<i64> = r.get(12)?;
            Ok(Row {
                trade: InsightsTrade {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    source: r.get(2)?,
                    import_batch_id: r.get(3)?,
                    symbol: r.get(4)?,
                    symbol_root: None,
                    side: r.get(5)?,
                    quantity: r.get(6)?,
                    entry_at: r.get(7)?,
                    exit_at: r.get(8)?,
                    trading_day: r.get(9)?,
                    fees: micros_to_string(r.get(10)?),
                    gross_pnl: money(11)?,
                    realized_pnl: net.map(micros_to_string),
                    reported_pnl: money(13)?,
                    pnl_status: r.get(14)?,
                    updated_at: r.get(15)?,
                    review: None,
                },
                net,
                review_id: r.get(16)?,
                reviewed: r.get::<_, Option<bool>>(17)?.unwrap_or(false),
                strategy_id: r.get(18)?,
                strategy_name: r.get(19)?,
                entered_risk: r.get(20)?,
                entry: r.get(21)?,
                stop: r.get(22)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let tags = review_tags(conn, &ids)?;
    let trades = rows
        .into_iter()
        .map(|row| {
            let mut trade = row.trade;
            let instrument = resolve_instrument(&trade.symbol, &instruments);
            trade.symbol_root = instrument.map(|i| i.root.clone());
            if let Some(review_id) = row.review_id {
                let (risk, source) = match row.entered_risk {
                    Some(r) => (Some(r), Some("entered")),
                    None => {
                        let derived = match (row.entry.as_deref().and_then(parse_decimal), row.stop.as_deref().and_then(parse_decimal)) {
                            (Some(entry), Some(stop)) => {
                                risk_from_plan(entry, stop, &trade.quantity, instrument, currency[trade.account_id.as_str()])
                            }
                            _ => None,
                        };
                        (derived, derived.map(|_| "derived"))
                    }
                };
                trade.review = Some(InsightsReview {
                    reviewed: row.reviewed,
                    strategy_id: row.strategy_id,
                    strategy_name: row.strategy_name,
                    tags: tags.get(&review_id).cloned().unwrap_or_default(),
                    r_multiple: r_multiple(row.net, risk),
                    planned_risk: risk.map(micros_to_string),
                    planned_risk_source: source.map(str::to_string),
                });
            }
            trade
        })
        .collect();

    Ok(InsightsDataset { contract_version: CONTRACT_VERSION, generated_at: generated_at.to_string(), accounts, trades })
}

/// Tags of every active review of the accounts, by review id, with their recorded labels and kinds.
fn review_tags(conn: &Connection, account_ids: &[String]) -> AppResult<HashMap<String, Vec<ReviewTag>>> {
    let placeholders = vec!["?"; account_ids.len()].join(", ");
    let mut stmt = conn.prepare(&format!(
        "SELECT rt.trade_review_id, rt.tag_id, coalesce(rt.label_snapshot, t.name), coalesce(rt.kind_snapshot, t.kind), t.name,
                t.archived_at IS NOT NULL
         FROM trade_review_tags rt JOIN tags t ON t.id = rt.tag_id JOIN trade_reviews r ON r.id = rt.trade_review_id
         WHERE r.deleted_at IS NULL AND r.account_id IN ({placeholders})
         ORDER BY rt.trade_review_id, 4, 3 COLLATE NOCASE"
    ))?;
    let mut out: HashMap<String, Vec<ReviewTag>> = HashMap::new();
    let rows = stmt.query_map(params_from_iter(account_ids.iter()), |r| {
        let label: String = r.get(2)?;
        let current: String = r.get(4)?;
        Ok((
            r.get::<_, String>(0)?,
            ReviewTag { tag_id: r.get(1)?, current_label: (current != label).then_some(current), label, kind: r.get(3)?, archived: r.get(5)? },
        ))
    })?;
    for row in rows {
        let (review, tag) = row?;
        out.entry(review).or_default().push(tag);
    }
    Ok(out)
}

fn account(conn: &Connection, id: &str) -> AppResult<InsightsAccount> {
    let a = accounts::get_any(conn, id)?;
    let neighbour = |sql: &str, id: &str| -> AppResult<Option<String>> { Ok(conn.query_row(sql, [id], |r| r.get(0)).optional()?) };
    // Walk back to the first attempt; links form a path, the walk is bounded rather than trusting the data.
    let mut root = id.to_string();
    let mut attempt_number = 1u32;
    for _ in 0..10_000 {
        match neighbour("SELECT predecessor_account_id FROM account_attempt_links WHERE successor_account_id = ?1", &root)? {
            Some(prev) => {
                root = prev;
                attempt_number += 1;
            }
            None => break,
        }
    }
    let status_event = conn
        .query_row(
            "SELECT status, effective_at, cause, note FROM account_status_events
             WHERE account_id = ?1 AND status = ?2 ORDER BY effective_at DESC, created_at DESC, id DESC LIMIT 1",
            [id, a.status.as_str()],
            |r| Ok(InsightsStatusEvent { status: r.get(0)?, effective_at: r.get(1)?, cause: r.get(2)?, note: r.get(3)? }),
        )
        .optional()?;
    let deleted_trade_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM trades WHERE account_id = ?1 AND deleted_at IS NOT NULL", [id], |r| r.get(0))?;
    let (committed, failed, last): (i64, i64, Option<String>) = conn.query_row(
        "SELECT COUNT(*) FILTER (WHERE status = 'committed'), COUNT(*) FILTER (WHERE status = 'failed'), MAX(completed_at)
         FROM import_batches WHERE account_id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    Ok(InsightsAccount {
        id: a.id,
        name: a.name,
        broker: a.broker,
        prop_firm: a.prop_firm,
        external_ref: a.external_ref,
        account_type: a.account_type,
        status: a.status,
        archived_at: a.archived_at,
        currency: a.currency,
        timezone: a.timezone,
        trading_day_reset_time: a.trading_day_reset_time,
        created_at: a.created_at,
        lineage_root_id: root,
        attempt_number,
        predecessor_account_id: a.predecessor_account_id,
        successor_account_id: a.successor_account_id,
        status_event,
        deleted_trade_count,
        committed_import_count: committed,
        failed_import_count: failed,
        last_import_at: last,
    })
}
