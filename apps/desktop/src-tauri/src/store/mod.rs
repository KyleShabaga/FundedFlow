//! Repositories over the journal database. Every write validates its input
//! first, uses parameterized SQL, and runs multi-statement writes in a
//! transaction.

pub mod accounts;
pub mod attachments;
pub mod attempts;
pub mod authoring;
pub mod catalogue;
pub mod daily_reviews;
pub mod freshness;
pub mod insights;
pub mod journal;
pub mod ledger;
pub mod library;
pub mod offers;
pub mod reviews;
pub mod risk_promotion;
pub mod rulebooks;
pub mod settings;
pub mod snapshots;
pub mod trades;

use std::str::FromStr;

use chrono::NaiveTime;
use chrono_tz::Tz;
use rusqlite::{Connection, OptionalExtension};
use rust_decimal::Decimal;

use crate::domain::{Instrument, parse_reset_time, parse_tz};
use crate::error::{AppError, AppResult};

/// Trim; treat blank as absent.
pub(crate) fn opt_text(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Account settings that trade derivation depends on.
pub(crate) struct AccountCtx {
    pub currency: String,
    pub tz: Tz,
    pub reset: NaiveTime,
}

pub(crate) fn account_ctx(conn: &Connection, id: &str) -> AppResult<AccountCtx> {
    let row = conn
        .query_row(
            "SELECT currency, timezone, trading_day_reset_time FROM accounts
             WHERE id = ?1 AND archived_at IS NULL",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let (currency, tz, reset) = row.ok_or_else(|| AppError::not_found("account", id))?;
    let corrupt = || AppError::Database {
        message: format!("account '{id}' has invalid session settings"),
    };
    Ok(AccountCtx {
        currency,
        tz: parse_tz(&tz).ok_or_else(corrupt)?,
        reset: parse_reset_time(&reset).ok_or_else(corrupt)?,
    })
}

/// The account exists, archived or not. For reads: an archived account is
/// browsable read-only, while writes use `account_ctx` and refuse it.
pub(crate) fn require_account(conn: &Connection, id: &str) -> AppResult<()> {
    let found: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM accounts WHERE id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if found {
        Ok(())
    } else {
        Err(AppError::not_found("account", id))
    }
}

pub(crate) fn load_instruments(conn: &Connection) -> AppResult<Vec<Instrument>> {
    let mut stmt = conn.prepare(
        "SELECT id, symbol_root, currency, point_value FROM instruments WHERE deleted_at IS NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, root, currency, pv) = row?;
        // An instrument with an unusable point value is skipped rather than
        // guessed; its trades show pnl_status 'missing_instrument'.
        if let Ok(point_value) = Decimal::from_str(&pv) {
            out.push(Instrument {
                id,
                root: root.to_ascii_uppercase(),
                currency,
                point_value,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod attempt_tests;
#[cfg(test)]
mod build10_tests;
#[cfg(test)]
mod build9_tests;
#[cfg(test)]
pub(crate) mod tests;

pub mod evidence;
pub mod reconciliation;

#[cfg(test)]
mod evidence_tests;

#[cfg(test)]
mod engine_snapshot_tests;
#[cfg(test)]
mod risk_promotion_tests;

#[cfg(test)]
mod journal_review_tests;

#[cfg(test)]
mod daily_review_tests;

#[cfg(test)]
mod insights_tests;
