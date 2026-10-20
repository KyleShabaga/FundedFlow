use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use super::{opt_text, trades};
use crate::domain::{
    format_reset_time, is_allowed_reset_time, micros_to_string, new_id, now, parse_decimal, parse_reset_time,
    parse_tz, to_micros, MAX_NOTES_CHARS,
};
use crate::error::{AppError, AppResult, Issues};

pub const ACCOUNT_TYPES: &[&str] = &["evaluation", "sim_funded", "live_funded", "personal", "demo", "other"];
pub const ACCOUNT_STATUSES: &[&str] = &["active", "paused", "passed", "failed", "closed"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInput {
    pub name: String,
    pub broker: Option<String>,
    pub prop_firm: Option<String>,
    pub external_ref: Option<String>,
    pub account_type: String,
    pub status: String,
    pub currency: String,
    /// Decimal string in the account currency, e.g. "50000".
    pub starting_balance: String,
    /// IANA zone, e.g. "America/New_York".
    pub timezone: String,
    /// "HH:MM" in `timezone`; "00:00" for calendar days.
    pub trading_day_reset_time: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub broker: Option<String>,
    pub prop_firm: Option<String>,
    pub external_ref: Option<String>,
    pub account_type: String,
    pub status: String,
    pub currency: String,
    pub starting_balance: String,
    pub timezone: String,
    pub trading_day_reset_time: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

struct Valid {
    name: String,
    broker: Option<String>,
    prop_firm: Option<String>,
    external_ref: Option<String>,
    account_type: String,
    status: String,
    currency: String,
    starting_balance_micros: i64,
    timezone: String,
    reset: String,
    notes: Option<String>,
}

fn validate(input: AccountInput) -> AppResult<Valid> {
    let mut issues = Issues::default();
    let mut limit = |field: &str, value: &Option<String>, max: usize| {
        if value.as_ref().is_some_and(|v| v.chars().count() > max) {
            issues.add(field, format!("must be at most {max} characters"));
        }
    };
    let name = input.name.trim().to_string();
    let broker = opt_text(input.broker);
    let prop_firm = opt_text(input.prop_firm);
    let external_ref = opt_text(input.external_ref);
    let notes = opt_text(input.notes);
    limit("broker", &broker, 100);
    limit("propFirm", &prop_firm, 100);
    limit("externalRef", &external_ref, 100);
    limit("notes", &notes, MAX_NOTES_CHARS);

    if name.is_empty() || name.chars().count() > 100 {
        issues.add("name", "must be 1–100 characters");
    }
    if !ACCOUNT_TYPES.contains(&input.account_type.as_str()) {
        issues.add("accountType", format!("must be one of {}", ACCOUNT_TYPES.join(", ")));
    }
    if !ACCOUNT_STATUSES.contains(&input.status.as_str()) {
        issues.add("status", format!("must be one of {}", ACCOUNT_STATUSES.join(", ")));
    }
    let currency = input.currency.trim().to_ascii_uppercase();
    if currency.len() != 3 || !currency.chars().all(|c| c.is_ascii_uppercase()) {
        issues.add("currency", "must be a 3-letter ISO 4217 code such as USD");
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
    let timezone = parse_tz(&input.timezone);
    if timezone.is_none() {
        issues.add("timezone", "must be an IANA time zone such as America/New_York");
    }
    let reset = parse_reset_time(&input.trading_day_reset_time).filter(|t| is_allowed_reset_time(*t));
    if reset.is_none() {
        issues.add("tradingDayResetTime", "must be 00:00 or a time from 12:00 to 23:59 (HH:MM, 24-hour)");
    }
    issues.into_result()?;

    Ok(Valid {
        name,
        broker,
        prop_firm,
        external_ref,
        account_type: input.account_type,
        status: input.status,
        currency,
        starting_balance_micros,
        timezone: timezone.unwrap().name().to_string(),
        reset: format_reset_time(reset.unwrap()),
        notes,
    })
}

const SELECT: &str = "SELECT a.id, a.name, a.broker, f.name, a.external_ref, a.account_type, a.status,
        a.currency, a.starting_balance_micros, a.timezone, a.trading_day_reset_time, a.notes_md,
        a.created_at, a.updated_at
    FROM accounts a LEFT JOIN firms f ON f.id = a.firm_id";

fn from_row(r: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        broker: r.get(2)?,
        prop_firm: r.get(3)?,
        external_ref: r.get(4)?,
        account_type: r.get(5)?,
        status: r.get(6)?,
        currency: r.get(7)?,
        starting_balance: micros_to_string(r.get(8)?),
        timezone: r.get(9)?,
        trading_day_reset_time: r.get(10)?,
        notes: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE a.archived_at IS NULL ORDER BY a.name COLLATE NOCASE, a.created_at"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Account> {
    conn.query_row(&format!("{SELECT} WHERE a.id = ?1 AND a.archived_at IS NULL"), [id], from_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("account", id))
}

/// Find a prop firm by name (case-insensitive) or create it.
fn firm_id(tx: &Transaction, name: Option<&str>, now: &str) -> AppResult<Option<String>> {
    let Some(name) = name else { return Ok(None) };
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM firms WHERE name = ?1 COLLATE NOCASE AND deleted_at IS NULL",
            [name],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(existing);
    }
    let id = new_id();
    tx.execute(
        "INSERT INTO firms (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, now],
    )?;
    Ok(Some(id))
}

/// The catalogue provider mapped from the account's firm (`db::provider_for_firm`),
/// so firms created after migration 7 are mapped too.
fn provider_id(tx: &Transaction, firm_id: Option<&str>) -> AppResult<Option<String>> {
    match firm_id {
        Some(firm) => Ok(crate::db::provider_for_firm(tx, firm)?),
        None => Ok(None),
    }
}

fn record_status(tx: &Transaction, account_id: &str, status: &str, now: &str) -> AppResult<()> {
    tx.execute(
        "INSERT INTO account_status_events (id, account_id, status, effective_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![new_id(), account_id, status, now],
    )?;
    Ok(())
}

fn friendly(e: rusqlite::Error) -> AppError {
    match AppError::from(e) {
        AppError::Conflict { message } if message.contains("accounts.broker") => AppError::Conflict {
            message: "another account already uses this broker and account number".into(),
        },
        other => other,
    }
}

pub fn create(conn: &mut Connection, input: AccountInput) -> AppResult<Account> {
    let v = validate(input)?;
    let now = now();
    let id = new_id();
    let tx = conn.transaction()?;
    let firm = firm_id(&tx, v.prop_firm.as_deref(), &now)?;
    let provider = provider_id(&tx, firm.as_deref())?;
    tx.execute(
        "INSERT INTO accounts (id, firm_id, name, broker, external_ref, account_type, status, currency,
                               starting_balance_micros, timezone, trading_day_reset_time, notes_md,
                               created_at, updated_at, provider_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14)",
        params![
            id, firm, v.name, v.broker, v.external_ref, v.account_type, v.status, v.currency,
            v.starting_balance_micros, v.timezone, v.reset, v.notes, now, provider
        ],
    )
    .map_err(friendly)?;
    record_status(&tx, &id, &v.status, &now)?;
    tx.commit()?;
    get(conn, &id)
}

/// Replace an account's editable fields. Changing its currency, timezone or
/// reset time re-derives every trade's trading day and P&L in the same transaction.
pub fn update(conn: &mut Connection, id: &str, input: AccountInput) -> AppResult<Account> {
    let v = validate(input)?;
    let now = now();
    let tx = conn.transaction()?;
    let old = tx
        .query_row(
            "SELECT status, currency, timezone, trading_day_reset_time FROM accounts WHERE id = ?1",
            [id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("account", id))?;
    let firm = firm_id(&tx, v.prop_firm.as_deref(), &now)?;
    let provider = provider_id(&tx, firm.as_deref())?;
    tx.execute(
        "UPDATE accounts SET firm_id = ?2, name = ?3, broker = ?4, external_ref = ?5, account_type = ?6,
                status = ?7, currency = ?8, starting_balance_micros = ?9, timezone = ?10,
                trading_day_reset_time = ?11, notes_md = ?12, updated_at = ?13, provider_id = ?14
         WHERE id = ?1",
        params![
            id, firm, v.name, v.broker, v.external_ref, v.account_type, v.status, v.currency,
            v.starting_balance_micros, v.timezone, v.reset, v.notes, now, provider
        ],
    )
    .map_err(friendly)?;
    if old.0 != v.status {
        record_status(&tx, id, &v.status, &now)?;
    }
    if (old.1, old.2, old.3) != (v.currency.clone(), v.timezone.clone(), v.reset.clone()) {
        trades::rederive_account(&tx, id)?;
    }
    tx.commit()?;
    get(conn, id)
}

/// Archive an account: it disappears from lists and can no longer be read or
/// written, but its trades, journal entries and imports are kept.
pub fn archive(conn: &Connection, id: &str) -> AppResult<()> {
    match conn.execute(
        "UPDATE accounts SET archived_at = ?2, updated_at = ?2 WHERE id = ?1 AND archived_at IS NULL",
        params![id, now()],
    )? {
        0 => Err(AppError::not_found("account", id)),
        _ => Ok(()),
    }
}
