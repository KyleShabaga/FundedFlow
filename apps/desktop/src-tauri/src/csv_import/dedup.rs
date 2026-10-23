//! Duplicate detection. Each valid row gets an identity key, unique per
//! account in `trades.dedup_key`:
//!
//! * `fills2:<n>:<buyFillId>:<sellFillId>` for paired-fill rows with both IDs,
//!   where `<n>` is the buy ID's length in UTF-8 bytes (decimal, no leading
//!   zeros). The length fixes where the buy ID ends, so every (buy, sell) pair
//!   has its own key even when IDs contain `:`. A buy fill shared by several
//!   rows (one buy closed by several sells) does not make them duplicates; only
//!   the same pair does.
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
//!
//! Journals written before P0-01 hold fill-pair trades under the unversioned
//! key `fills:<buy>:<sell>`, which `(a:b, c)` and `(a, b:c)` share. Stored keys
//! are immutable, so they are never rewritten. A pair with no `fills2` match is
//! looked up under its legacy key, and that trade counts only if its stored
//! `trade_round_trips` fill IDs are exactly this pair: a different stored pair
//! is a different trade (this row is new), and a trade whose stored pair can't
//! be read is reported as ambiguous instead of being guessed. The key is never
//! split on `:` to recover IDs. See docs/architecture/p0-01-p0-03.md.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::normalize::{Identity, Outcome};
use super::parse::RawRow;
use crate::error::AppResult;

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The key a new trade is stored under (current identity version).
pub fn key(identity: &Identity) -> String {
    match identity {
        Identity::FillPair { buy, sell } if legacy_writer() => legacy_fill_pair_key(buy, sell),
        Identity::FillPair { buy, sell } => fill_pair_key(buy, sell),
        Identity::TradeId(id) => format!("id:{id}"),
        Identity::Composite(fields) => format!("rt:{}", sha256_hex(fields.as_bytes())),
    }
}

/// Version 2 fill-pair key: length-prefixed, so distinct pairs never share it.
pub fn fill_pair_key(buy: &str, sell: &str) -> String {
    format!("fills2:{}:{buy}:{sell}", buy.len())
}

/// The unversioned key written before P0-01. Read for compatibility only, never written;
/// it does not identify a pair on its own.
pub fn legacy_fill_pair_key(buy: &str, sell: &str) -> String {
    format!("fills:{buy}:{sell}")
}

fn basis(identity: &Identity) -> String {
    match identity {
        Identity::FillPair { buy, sell } => format!("buy/sell fill IDs ({buy} / {sell})"),
        Identity::TradeId(id) => format!("trade ID ({id})"),
        Identity::Composite(_) => {
            "symbol, side, quantity, prices, timestamps and P&L (no IDs to tell them apart)"
                .to_string()
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

/// A row that may already be saved under a legacy key whose stored fill pair can't be read, so
/// whether it is that trade is unknown. It is neither imported nor matched; the row says why.
#[derive(Debug, Clone, PartialEq)]
pub struct Ambiguity {
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
    /// Not imported: see [`Ambiguity`].
    Ambiguous(Ambiguity),
}

type Saved = (String, String, Option<String>, Option<String>);

/// The account's trade with this identity: its current key, else (fill pairs) a legacy key whose
/// stored pair is exactly this one. `Err` carries a legacy trade whose stored pair is unreadable.
fn find_saved(
    conn: &Connection,
    account_id: &str,
    key: &str,
    identity: &Identity,
) -> AppResult<Result<Option<Saved>, Saved>> {
    let mut current = conn.prepare_cached(
        "SELECT t.id, t.created_at, t.deleted_at, b.file_name
         FROM trades t LEFT JOIN import_batches b ON b.id = t.import_batch_id
         WHERE t.account_id = ?1 AND t.dedup_key = ?2",
    )?;
    let saved = current
        .query_row(params![account_id, key], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()?;
    let Identity::FillPair { buy, sell } = identity else {
        return Ok(Ok(saved));
    };
    if saved.is_some() || legacy_writer() {
        return Ok(Ok(saved));
    }
    let mut legacy = conn.prepare_cached(
        "SELECT t.id, t.created_at, t.deleted_at, b.file_name, rt.trade_id IS NOT NULL, rt.buy_fill_id, rt.sell_fill_id
         FROM trades t LEFT JOIN import_batches b ON b.id = t.import_batch_id
                       LEFT JOIN trade_round_trips rt ON rt.trade_id = t.id
         WHERE t.account_id = ?1 AND t.dedup_key = ?2",
    )?;
    let found = legacy
        .query_row(params![account_id, legacy_fill_pair_key(buy, sell)], |r| {
            Ok((
                (
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ),
                r.get::<_, bool>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })
        .optional()?;
    Ok(match found {
        None => Ok(None),
        Some((saved, true, Some(b), Some(s))) => Ok((&b == buy && &s == sell).then_some(saved)),
        Some((saved, ..)) => Err(saved),
    })
}

fn day(at: &str) -> String {
    at[..10.min(at.len())].to_string()
}

fn origin(file: Option<String>) -> String {
    file.map(|f| format!("'{f}'"))
        .unwrap_or_else(|| "manual entry".into())
}

/// Classify each row against the file and the account's trades.
pub fn classify(
    conn: &Connection,
    account_id: &str,
    rows: &[(&RawRow, &Outcome)],
) -> AppResult<Vec<Match>> {
    // Retain an existing trade's identity when later rows duplicate the first
    // occurrence. Commit can then persist every duplicate's provenance link.
    let mut first_seen: HashMap<String, (u64, Option<String>)> = HashMap::new();
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
        let saved = match find_saved(conn, account_id, &key, &trade.identity)? {
            Ok(saved) => saved,
            Err((id, created, _, file)) => {
                // Not remembered as first seen: a later copy of this pair is just as ambiguous.
                out.push(Match::Ambiguous(Ambiguity {
                    reason: format!(
                        "Couldn't tell whether this row is already saved: the trade saved on {} from {} has an older \
                         identity that its {basis} share with other fill pairs, and that trade's own fill IDs can't \
                         be read. This row was not imported or matched. Check that trade, and add this one by hand if it is missing.",
                        day(&created),
                        origin(file)
                    ),
                    trade_id: id,
                }));
                continue;
            }
        };
        first_seen.insert(
            key.clone(),
            (raw.line_number, saved.as_ref().map(|(id, ..)| id.clone())),
        );
        out.push(match saved {
            None => Match::New,
            Some((id, created, deleted, file)) => {
                let from = origin(file);
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

#[cfg(test)]
thread_local! {
    static LEGACY_WRITER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Test only: while `f` runs, imports behave as before P0-01 (unversioned fill-pair keys, matched
/// by key alone), to build journals the earlier release wrote.
#[cfg(test)]
pub(crate) fn as_legacy_writer<T>(f: impl FnOnce() -> T) -> T {
    LEGACY_WRITER.with(|w| w.set(true));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    LEGACY_WRITER.with(|w| w.set(false));
    result.unwrap_or_else(|e| std::panic::resume_unwind(e))
}

#[cfg(test)]
fn legacy_writer() -> bool {
    LEGACY_WRITER.with(|w| w.get())
}

#[cfg(not(test))]
fn legacy_writer() -> bool {
    false
}
