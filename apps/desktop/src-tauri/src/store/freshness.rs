//! P0-D06: the inputs of the account freshness indicator, for every account in one read. Each is a stored instant
//! that says when evidence arrived; none is a verdict. The freshness policy itself (thresholds, which inputs are
//! required) is a display preference applied by the app to these instants. The trading-day boundaries come from
//! [`trading_day`], so the app never does calendar arithmetic of its own.

use chrono::{DateTime, Datelike, Days, Duration, NaiveDate, NaiveTime, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use rusqlite::Connection;
use serde::Serialize;

use crate::domain::{format_instant, parse_instant, parse_reset_time, parse_tz, trading_day};
use crate::error::{AppError, AppResult};

/// How many trading-day starts are returned: the current day and the nine before it.
pub const TRADING_DAY_STARTS: usize = 10;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFreshnessInputs {
    pub account_id: String,
    /// The trading day `as_of` belongs to, in the account's zone and reset time.
    pub current_trading_day: String,
    /// When the current trading day began, then each earlier trading day, newest first (`TRADING_DAY_STARTS`).
    pub trading_day_starts: Vec<String>,
    /// When the next trading day begins: the moment a "since the previous trading day" rule moves on.
    pub next_trading_day_start: String,
    /// Newest `completed_at` of a committed import (a duplicate-only import still counts: the file was checked).
    pub last_committed_import_at: Option<String>,
    /// Newest `completed_at` of a failed import attempt.
    pub last_failed_import_at: Option<String>,
    /// Newest `created_at` of a manually entered trade that isn't deleted (when it was recorded, not traded).
    pub last_manual_trade_at: Option<String>,
    /// Newest `observedAt` of a user-confirmed balance checkpoint in force (not superseded, with a value).
    pub last_confirmed_checkpoint_at: Option<String>,
}

/// The first instant of trading day `day`: the reset on the previous trading day, or midnight after it for a
/// 00:00 reset. A local time skipped by a daylight-saving jump moves to the first valid minute after it.
pub fn trading_day_start(day: NaiveDate, tz: Tz, reset: NaiveTime) -> DateTime<Utc> {
    let previous = previous_trading_day(day);
    let local = if reset == NaiveTime::MIN {
        previous.succ_opt().unwrap_or(previous).and_time(NaiveTime::MIN)
    } else {
        previous.and_time(reset)
    };
    let mut candidate = local;
    for _ in 0..180 {
        if let Some(t) = tz.from_local_datetime(&candidate).earliest() {
            return t.with_timezone(&Utc);
        }
        candidate += Duration::minutes(1);
    }
    Utc.from_utc_datetime(&local)
}

fn previous_trading_day(day: NaiveDate) -> NaiveDate {
    let back = match day.weekday() {
        Weekday::Mon => 3,
        Weekday::Sun => 2,
        _ => 1,
    };
    day.checked_sub_days(Days::new(back)).unwrap_or(day)
}

fn next_trading_day(day: NaiveDate) -> NaiveDate {
    let ahead = match day.weekday() {
        Weekday::Fri => 3,
        Weekday::Sat => 2,
        _ => 1,
    };
    day.checked_add_days(Days::new(ahead)).unwrap_or(day)
}

/// Every account (archived ones included, so a caller can show history), at `as_of`.
pub fn list_at(conn: &Connection, as_of: &str) -> AppResult<Vec<AccountFreshnessInputs>> {
    let at = parse_instant(as_of).ok_or_else(|| AppError::invalid("asOf", "Use an ISO 8601 instant with an offset"))?;
    let mut stmt = conn.prepare(
        "SELECT a.id, a.timezone, a.trading_day_reset_time,
           (SELECT MAX(completed_at) FROM import_batches b WHERE b.account_id = a.id AND b.status = 'committed'),
           (SELECT MAX(completed_at) FROM import_batches b WHERE b.account_id = a.id AND b.status = 'failed'),
           (SELECT MAX(created_at) FROM trades t WHERE t.account_id = a.id AND t.source = 'manual' AND t.deleted_at IS NULL),
           (SELECT MAX(json_extract(o.payload_json, '$.observedAt')) FROM financial_observations o
             WHERE o.account_id = a.id AND o.value_micros IS NOT NULL
               AND json_extract(o.payload_json, '$.confirmation') = 'user_confirmed'
               AND json_extract(o.payload_json, '$.kind') IN ('opening_balance', 'balance', 'eod_settlement', 'equity')
               AND NOT EXISTS (SELECT 1 FROM financial_observations s WHERE s.supersedes_id = o.id))
         FROM accounts a ORDER BY a.created_at, a.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, tz, reset, committed, failed, manual, checkpoint) = row?;
        let corrupt = || AppError::Database { message: format!("account '{id}' has invalid session settings") };
        let tz = parse_tz(&tz).ok_or_else(corrupt)?;
        let reset = parse_reset_time(&reset).ok_or_else(corrupt)?;
        let today = trading_day(at, tz, reset);
        let mut starts = Vec::with_capacity(TRADING_DAY_STARTS);
        let mut day = today;
        for _ in 0..TRADING_DAY_STARTS {
            starts.push(format_instant(trading_day_start(day, tz, reset)));
            day = previous_trading_day(day);
        }
        // Stored instants are already canonical; re-format defensively so the app compares like with like.
        let canon = |v: Option<String>| v.and_then(|s| parse_instant(&s)).map(format_instant);
        out.push(AccountFreshnessInputs {
            account_id: id,
            current_trading_day: today.format("%Y-%m-%d").to_string(),
            trading_day_starts: starts,
            next_trading_day_start: format_instant(trading_day_start(next_trading_day(today), tz, reset)),
            last_committed_import_at: canon(committed),
            last_failed_import_at: canon(failed),
            last_manual_trade_at: canon(manual),
            last_confirmed_checkpoint_at: canon(checkpoint),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::accounts;
    use crate::store::evidence::{self, ObservationInput};
    use crate::store::tests::{account_input, db};
    use crate::store::trades::{self, TradeInput};

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    fn ny() -> Tz {
        parse_tz("America/New_York").unwrap()
    }
    fn at(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn a_trading_day_starts_at_the_previous_trading_days_reset() {
        // Wednesday 2026-10-21 with a 17:00 New York reset starts Tuesday 17:00 EDT; Monday starts Friday 17:00.
        assert_eq!(format_instant(trading_day_start(date("2026-10-21"), ny(), at(17, 0))), "2026-10-20T21:00:00.000Z");
        assert_eq!(format_instant(trading_day_start(date("2026-10-19"), ny(), at(17, 0))), "2026-10-16T21:00:00.000Z");
        // A 00:00 reset: plain calendar days, and Monday includes the weekend.
        assert_eq!(format_instant(trading_day_start(date("2026-10-21"), ny(), NaiveTime::MIN)), "2026-10-21T04:00:00.000Z");
        assert_eq!(format_instant(trading_day_start(date("2026-10-19"), ny(), NaiveTime::MIN)), "2026-10-17T04:00:00.000Z");
    }

    #[test]
    fn the_start_agrees_with_trading_day_across_daylight_saving() {
        let tz = ny();
        for reset in [at(17, 0), NaiveTime::MIN, at(18, 30)] {
            // Weeks around the March and November 2026 changes.
            for day in ["2026-03-06", "2026-03-09", "2026-03-10", "2026-10-30", "2026-11-02", "2026-11-03"] {
                let d = date(day);
                let start = trading_day_start(d, tz, reset);
                assert_eq!(trading_day(start, tz, reset), d, "{day} {reset}");
                assert_eq!(trading_day(start - Duration::seconds(1), tz, reset), previous_trading_day(d), "{day} {reset}");
            }
        }
        // Cairo moves its clocks at midnight on a Friday in late April: with a 00:00 reset that Friday's local
        // midnight doesn't exist, and the start is the first minute that does.
        let cairo = parse_tz("Africa/Cairo").unwrap();
        for day in ["2026-04-23", "2026-04-24", "2026-04-27", "2026-10-29", "2026-10-30", "2026-11-02"] {
            let d = date(day);
            let start = trading_day_start(d, cairo, NaiveTime::MIN);
            assert_eq!(trading_day(start, cairo, NaiveTime::MIN), d, "Cairo {day}");
            assert_eq!(trading_day(start - Duration::seconds(1), cairo, NaiveTime::MIN), previous_trading_day(d), "Cairo {day}");
        }
    }

    #[test]
    fn reads_every_accounts_inputs_in_one_call() {
        let mut conn = db();
        let a = accounts::create(&mut conn, account_input("Eval A")).unwrap();
        let b = accounts::create(&mut conn, account_input("Eval B")).unwrap();
        trades::create(&mut conn, TradeInput {
            account_id: a.id.clone(), symbol: "ES".into(), side: "long".into(), quantity: "1".into(),
            entry_at: "2026-10-20T14:00:00Z".into(), entry_price: "5000".into(), exit_at: Some("2026-10-20T15:00:00Z".into()),
            exit_price: Some("5001".into()), fees: None, realized_pnl: None, notes: None,
        }).unwrap();
        let checkpoint = |value: &str, observed: &str, confirmation: &str| ObservationInput {
            account_id: a.id.clone(), kind: "balance".into(), value: Some(value.into()), currency: "USD".into(), basis: "balance".into(),
            observed_at: observed.into(), source_category: "firm_dashboard".into(), source_reference: "Dashboard".into(),
            confirmation: confirmation.into(), confidence: "user_reported".into(), valid_until: None, actor: "local_user".into(), note: None,
        };
        evidence::create(&mut conn, checkpoint("50000", "2026-10-19T20:00:00Z", "user_confirmed")).unwrap();
        evidence::create(&mut conn, checkpoint("50100", "2026-10-20T20:00:00Z", "unconfirmed")).unwrap();
        conn.execute(
            "INSERT INTO import_batches (id, account_id, file_name, file_sha256, file_size, mapping_snapshot_json, source_timezone, status,
               row_count, imported_count, skipped_count, duplicate_count, failed_count, error_summary, created_at, completed_at)
             VALUES ('f1', ?1, 'bad.csv', ?2, 1, '{}', 'UTC', 'failed', 0, 0, 0, 0, 0, 'unreadable', '2026-10-21T12:00:00.000Z', '2026-10-21T12:00:01.000Z')",
            rusqlite::params![b.id, "0".repeat(64)],
        ).unwrap();

        let rows = list_at(&conn, "2026-10-21T18:00:00Z").unwrap();
        assert_eq!(rows.len(), 2);
        let ra = rows.iter().find(|r| r.account_id == a.id).unwrap();
        assert_eq!(ra.current_trading_day, "2026-10-21");
        assert_eq!(ra.trading_day_starts.len(), TRADING_DAY_STARTS);
        assert_eq!(&ra.trading_day_starts[..3], ["2026-10-20T21:00:00.000Z", "2026-10-19T21:00:00.000Z", "2026-10-16T21:00:00.000Z"]);
        assert_eq!(ra.next_trading_day_start, "2026-10-21T21:00:00.000Z");
        assert!(ra.last_manual_trade_at.is_some());
        assert_eq!(ra.last_committed_import_at, None);
        // Only the confirmed checkpoint counts; the newer unconfirmed one doesn't.
        assert_eq!(ra.last_confirmed_checkpoint_at.as_deref(), Some("2026-10-19T20:00:00.000Z"));
        let rb = rows.iter().find(|r| r.account_id == b.id).unwrap();
        assert_eq!(rb.last_failed_import_at.as_deref(), Some("2026-10-21T12:00:01.000Z"));
        assert_eq!((rb.last_committed_import_at.as_deref(), rb.last_manual_trade_at.as_deref(), rb.last_confirmed_checkpoint_at.as_deref()), (None, None, None));

        // A deleted manual trade no longer counts.
        conn.execute("UPDATE trades SET deleted_at = '2026-10-21T13:00:00.000Z' WHERE account_id = ?1", [&a.id]).unwrap();
        assert_eq!(list_at(&conn, "2026-10-21T18:00:00Z").unwrap().iter().find(|r| r.account_id == a.id).unwrap().last_manual_trade_at, None);
    }

    #[test]
    fn rejects_an_instant_without_an_offset() {
        let conn = db();
        assert!(matches!(list_at(&conn, "2026-10-21T18:00:00"), Err(AppError::Validation { .. })));
    }
}
