//! Duplicate detection. Each valid row gets an identity key, unique per
//! account in `trades.dedup_key`:
//!
//! * `fills:<buyFillId>:<sellFillId>` for paired-fill rows with both IDs. A
//!   buy fill shared by several rows (one buy closed by several sells) does
//!   not make them duplicates; only the same pair does.
//! * `id:<trade id>` for generic rows with a broker trade ID.
//! * `rt:<sha256>` otherwise, over the normalized round-trip fields
//!   (format, symbol, quantity, prices, timestamps, P&L; plus side for
//!   generic rows). Identical rows without IDs are therefore duplicates, even
//!   within one file.
//!
//! A row is a duplicate if an earlier row in the same file, or an active
//! trade of the account, already has its key. A row whose key belongs to a
//! deleted trade restores that trade (the key stays unique, so it cannot be
//! inserted again).

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::normalize::{Identity, Outcome};
use super::parse::RawRow;
use crate::error::AppResult;

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn key(identity: &Identity) -> String {
    match identity {
        Identity::FillPair { buy, sell } => format!("fills:{buy}:{sell}"),
        Identity::TradeId(id) => format!("id:{id}"),
        Identity::Composite(fields) => format!("rt:{}", sha256_hex(fields.as_bytes())),
    }
}

fn basis(identity: &Identity) -> String {
    match identity {
        Identity::FillPair { buy, sell } => format!("buy/sell fill IDs ({buy} / {sell})"),
        Identity::TradeId(id) => format!("trade ID ({id})"),
        Identity::Composite(_) => {
            "symbol, side, quantity, prices, timestamps and P&L (no IDs to tell them apart)".to_string()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Duplicate {
    /// "file": an earlier row of this file; "saved": a trade already in the account.
    pub of: &'static str,
    pub key: String,
    pub reason: String,
    pub line_number: Option<u64>,
    pub trade_id: Option<String>,
}

/// A deleted trade of the account that a row brings back.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restore {
    pub key: String,
    pub trade_id: String,
    pub reason: String,
}

/// What importing a row would do.
#[derive(Debug, Clone, PartialEq)]
pub enum Match {
    /// Insert a new trade (also used for rows that are not valid).
    New,
    /// Un-delete the account's deleted trade with this key.
    Restore(Restore),
    Duplicate(Duplicate),
}

/// Classify each row against the file and the account's trades.
pub fn classify(conn: &Connection, account_id: &str, rows: &[(&RawRow, &Outcome)]) -> AppResult<Vec<Match>> {
    // Retain an existing trade's identity when later rows duplicate the first
    // occurrence. Commit can then persist every duplicate's provenance link.
    let mut first_seen: HashMap<String, (u64, Option<String>)> = HashMap::new();
    let mut lookup = conn.prepare(
        "SELECT t.id, t.created_at, t.deleted_at, b.file_name
         FROM trades t LEFT JOIN import_batches b ON b.id = t.import_batch_id
         WHERE t.account_id = ?1 AND t.dedup_key = ?2",
    )?;
    let mut out = Vec::with_capacity(rows.len());
    for (raw, outcome) in rows {
        let Outcome::Valid { trade, .. } = outcome else {
            out.push(Match::New);
            continue;
        };
        let key = key(&trade.identity);
        let basis = basis(&trade.identity);
        if let Some((line, trade_id)) = first_seen.get(&key) {
            out.push(Match::Duplicate(Duplicate {
                of: "file",
                reason: format!("Same {basis} as line {line} of this file."),
                key,
                line_number: Some(*line),
                trade_id: trade_id.clone(),
            }));
            continue;
        }
        let saved = lookup
            .query_row(params![account_id, key], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })
            .optional()?;
        first_seen.insert(key.clone(), (raw.line_number, saved.as_ref().map(|(id, ..)| id.clone())));
        out.push(match saved {
            None => Match::New,
            Some((id, created, deleted, file)) => {
                let day = |at: &str| at[..10.min(at.len())].to_string();
                let from = file.map(|f| format!("'{f}'")).unwrap_or_else(|| "manual entry".into());
                match deleted {
                    Some(deleted) => Match::Restore(Restore {
                        reason: format!(
                            "Restores the trade saved on {} from {from} and deleted on {} (same {basis}).",
                            day(&created),
                            day(&deleted)
                        ),
                        key,
                        trade_id: id,
                    }),
                    None => Match::Duplicate(Duplicate {
                        of: "saved",
                        reason: format!("Same {basis} as a trade already saved on {} from {from}.", day(&created)),
                        key,
                        line_number: None,
                        trade_id: Some(id),
                    }),
                }
            }
        });
    }
    Ok(out)
}
