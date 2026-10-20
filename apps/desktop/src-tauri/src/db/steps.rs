//! Rust data steps run by migrations (`Step::Rust`). Each runs inside its
//! migration's transaction and must be idempotent.

use rusqlite::{params, Connection};

use crate::domain::{parse_instant, parse_reset_time, parse_tz, trading_day};

/// Migration 5: recompute every stored `trades.trading_day` with
/// `domain::trading_day` (exit time, or entry while open; the account's
/// timezone and reset; Saturday and Sunday roll to Monday) and correct the
/// rows that differ. Trades saved before the weekend roll was added kept a
/// Saturday or Sunday day.
///
/// Only `trading_day` changes: P&L, `updated_at` and every other column stay
/// as they are. Soft-deleted trades and archived accounts' trades are
/// included. A row whose account settings or instants don't parse is left
/// unchanged rather than failing the upgrade. Returns the number of trades
/// corrected; a second run returns 0.
pub(crate) fn rederive_trading_days(conn: &Connection) -> rusqlite::Result<usize> {
    let mut select = conn.prepare(
        "SELECT t.id, t.entry_at, t.exit_at, t.trading_day, a.timezone, a.trading_day_reset_time
         FROM trades t JOIN accounts a ON a.id = t.account_id",
    )?;
    let rows = select
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut update = conn.prepare("UPDATE trades SET trading_day = ?2 WHERE id = ?1")?;
    let mut corrected = 0;
    for (id, entry_at, exit_at, stored, tz, reset) in rows {
        let (Some(tz), Some(reset), Some(at)) =
            (parse_tz(&tz), parse_reset_time(&reset), parse_instant(exit_at.as_deref().unwrap_or(&entry_at)))
        else {
            continue;
        };
        let day = trading_day(at, tz, reset).to_string();
        if day != stored {
            update.execute(params![id, day])?;
            corrected += 1;
        }
    }
    Ok(corrected)
}
