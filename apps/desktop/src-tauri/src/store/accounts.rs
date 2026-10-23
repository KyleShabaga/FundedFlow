use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use serde::{Deserialize, Serialize};

use super::{opt_text, trades};
use crate::domain::{
    MAX_NOTES_CHARS, format_instant, format_reset_time, is_allowed_reset_time, micros_to_string,
    new_id, now, parse_decimal, parse_payload_time, parse_reset_time, parse_tz, to_micros,
};
use crate::error::{AppError, AppResult, Issues};

pub const ACCOUNT_TYPES: &[&str] = &[
    "evaluation",
    "sim_funded",
    "live_funded",
    "personal",
    "demo",
    "other",
];
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
    /// Set while the account is archived: hidden from live views and read-only.
    pub archived_at: Option<String>,
    /// The attempt this account is an evaluation reset of, if any.
    pub predecessor_account_id: Option<String>,
    /// The reset attempt that follows this account, if any.
    pub successor_account_id: Option<String>,
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
        issues.add(
            "accountType",
            format!("must be one of {}", ACCOUNT_TYPES.join(", ")),
        );
    }
    if !ACCOUNT_STATUSES.contains(&input.status.as_str()) {
        issues.add(
            "status",
            format!("must be one of {}", ACCOUNT_STATUSES.join(", ")),
        );
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
        issues.add(
            "timezone",
            "must be an IANA time zone such as America/New_York",
        );
    }
    let reset =
        parse_reset_time(&input.trading_day_reset_time).filter(|t| is_allowed_reset_time(*t));
    if reset.is_none() {
        issues.add(
            "tradingDayResetTime",
            "must be 00:00 or a time from 12:00 to 23:59 (HH:MM, 24-hour)",
        );
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
        a.created_at, a.updated_at, a.archived_at,
        (SELECT l.predecessor_account_id FROM account_attempt_links l WHERE l.successor_account_id = a.id),
        (SELECT l.successor_account_id FROM account_attempt_links l WHERE l.predecessor_account_id = a.id)
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
        archived_at: r.get(14)?,
        predecessor_account_id: r.get(15)?,
        successor_account_id: r.get(16)?,
    })
}

/// Accounts that are not archived, whatever their status. Failed, passed and
/// closed accounts are listed; callers choose what counts as live
/// (`status = 'active'` is what risk views use).
pub fn list(conn: &Connection) -> AppResult<Vec<Account>> {
    list_with(conn, false)
}

/// Accounts that can trade now: `active`, not archived. This is what risk
/// views (Today) read. Paused, passed, failed, closed and archived accounts
/// are history, and a reset's predecessor is already failed/passed/closed.
pub fn list_active(conn: &Connection) -> AppResult<Vec<Account>> {
    Ok(list(conn)?
        .into_iter()
        .filter(|a| a.status == "active")
        .collect())
}

/// As `list`, optionally with archived accounts, for history and restore.
pub fn list_with(conn: &Connection, include_archived: bool) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE (?1 OR a.archived_at IS NULL) ORDER BY a.name COLLATE NOCASE, a.created_at"
    ))?;
    let rows = stmt.query_map([include_archived], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Account> {
    conn.query_row(
        &format!("{SELECT} WHERE a.id = ?1 AND a.archived_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("account", id))
}

/// Read one account whether or not it is archived (read-only browsing).
pub fn get_any(conn: &Connection, id: &str) -> AppResult<Account> {
    conn.query_row(&format!("{SELECT} WHERE a.id = ?1"), [id], from_row)
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
    record_status_event(tx, account_id, status, now, None, None)
}

/// A status history row. `effective_at` is when the status took effect (the
/// user's date, not necessarily now); `cause` and `note` are the user's own
/// words and are never inferred.
pub(crate) fn record_status_event(
    tx: &Connection,
    account_id: &str,
    status: &str,
    effective_at: &str,
    cause: Option<&str>,
    note: Option<&str>,
) -> AppResult<()> {
    tx.execute(
        "INSERT INTO account_status_events (id, account_id, status, effective_at, note, created_at, cause)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![new_id(), account_id, status, effective_at, note, now(), cause],
    )?;
    Ok(())
}

pub(crate) fn friendly(e: rusqlite::Error) -> AppError {
    match AppError::from(e) {
        AppError::Conflict { message } if message.contains("accounts.broker") => {
            AppError::Conflict {
                message:
                    "another active or paused account already uses this broker and account number"
                        .into(),
            }
        }
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
            "SELECT status, currency, timezone, trading_day_reset_time FROM accounts WHERE id = ?1 AND archived_at IS NULL",
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

/// Archive an account: it leaves live lists and becomes read-only, but its
/// trades, journal entries, imports and history are kept and it can be
/// restored. Archiving never changes its status.
pub fn archive(conn: &mut Connection, id: &str) -> AppResult<()> {
    let at = now();
    let tx = conn.transaction()?;
    match tx.execute(
        "UPDATE accounts SET archived_at = ?2, updated_at = ?2 WHERE id = ?1 AND archived_at IS NULL",
        params![id, at],
    )? {
        0 => return Err(AppError::not_found("account", id)),
        _ => record_archive_event(&tx, id, "archived", &at)?,
    }
    tx.commit()?;
    Ok(())
}

/// Restore an archived account to the lists. Its status is left exactly as it
/// was: a restored failed account stays failed. If it could trade (active or
/// paused) and another such account already holds its broker account number,
/// restoring is refused and nothing changes.
pub fn restore(conn: &mut Connection, id: &str) -> AppResult<Account> {
    let at = now();
    let tx = conn.transaction()?;
    let row: Option<(Option<String>, Option<String>, String, bool)> = tx
        .query_row(
            "SELECT broker, external_ref, status, archived_at IS NOT NULL FROM accounts WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let (broker, external_ref, status, archived) =
        row.ok_or_else(|| AppError::not_found("account", id))?;
    if !archived {
        return Err(AppError::invalid("id", "The account is not archived"));
    }
    if let (Some(broker), Some(external_ref), true) = (
        &broker,
        &external_ref,
        matches!(status.as_str(), "active" | "paused"),
    ) {
        let holder: Option<String> = tx
            .query_row(
                "SELECT name FROM accounts
                 WHERE id <> ?1 AND broker = ?2 COLLATE NOCASE AND external_ref = ?3
                   AND archived_at IS NULL AND status IN ('active', 'paused')",
                params![id, broker, external_ref],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(name) = holder {
            return Err(AppError::Conflict {
                message: format!(
                    "cannot restore: '{name}' is already an active or paused account using {broker} account {external_ref}"
                ),
            });
        }
    }
    tx.execute(
        "UPDATE accounts SET archived_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, at],
    )
    .map_err(friendly)?;
    record_archive_event(&tx, id, "restored", &at)?;
    tx.commit()?;
    get(conn, id)
}

fn record_archive_event(
    tx: &Connection,
    account_id: &str,
    action: &str,
    at: &str,
) -> AppResult<()> {
    tx.execute(
        "INSERT INTO account_archive_events (id, account_id, action, occurred_at, created_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![new_id(), account_id, action, at],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusChangeInput {
    pub status: String,
    /// When the status took effect, any ISO 8601 instant with an offset. Defaults to now.
    pub effective_at: Option<String>,
    /// The user's own words for why; absent means unknown. Never inferred from losses.
    pub cause: Option<String>,
    /// Optional evidence or notes.
    pub note: Option<String>,
}

/// Change an account's status (for example mark it failed) with the user's
/// effective time, cause and notes. It changes nothing else: the account is
/// not archived, deleted or reset, and no rule breach is inferred.
pub fn change_status(
    conn: &mut Connection,
    id: &str,
    input: StatusChangeInput,
) -> AppResult<Account> {
    let mut issues = Issues::default();
    if !ACCOUNT_STATUSES.contains(&input.status.as_str()) {
        issues.add(
            "status",
            format!("must be one of {}", ACCOUNT_STATUSES.join(", ")),
        );
    }
    let cause = opt_text(input.cause);
    let note = opt_text(input.note);
    if cause.as_ref().is_some_and(|c| c.chars().count() > 500) {
        issues.add("cause", "must be at most 500 characters");
    }
    if note
        .as_ref()
        .is_some_and(|n| n.chars().count() > MAX_NOTES_CHARS)
    {
        issues.add(
            "note",
            format!("must be at most {MAX_NOTES_CHARS} characters"),
        );
    }
    let effective_at = match input.effective_at.as_deref() {
        None => now(),
        Some(s) => match parse_payload_time(s) {
            Ok(t) => format_instant(t),
            Err(message) => {
                issues.add("effectiveAt", message);
                String::new()
            }
        },
    };
    issues.into_result()?;

    let tx = conn.transaction()?;
    let (old, archived): (String, bool) = tx
        .query_row(
            "SELECT status, archived_at IS NOT NULL FROM accounts WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("account", id))?;
    if archived {
        return Err(AppError::invalid(
            "id",
            "Restore the account before changing its status",
        ));
    }
    if old == input.status {
        return Err(AppError::invalid(
            "status",
            format!("The account is already {old}"),
        ));
    }
    tx.execute(
        "UPDATE accounts SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, input.status, now()],
    )
    .map_err(friendly)?;
    record_status_event(
        &tx,
        id,
        &input.status,
        &effective_at,
        cause.as_deref(),
        note.as_deref(),
    )?;
    tx.commit()?;
    get(conn, id)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub status: String,
    pub effective_at: String,
    pub cause: Option<String>,
    pub note: Option<String>,
    pub recorded_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEvent {
    /// `archived` or `restored`.
    pub action: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountHistory {
    pub status_events: Vec<StatusEvent>,
    pub archive_events: Vec<ArchiveEvent>,
}

/// An account's status and archive history, oldest first. Readable for archived accounts.
pub fn history(conn: &Connection, id: &str) -> AppResult<AccountHistory> {
    get_any(conn, id)?;
    let mut stmt = conn.prepare(
        "SELECT status, effective_at, cause, note, created_at FROM account_status_events
         WHERE account_id = ?1 ORDER BY effective_at, created_at, id",
    )?;
    let status_events = stmt
        .query_map([id], |r| {
            Ok(StatusEvent {
                status: r.get(0)?,
                effective_at: r.get(1)?,
                cause: r.get(2)?,
                note: r.get(3)?,
                recorded_at: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare(
        "SELECT action, occurred_at FROM account_archive_events WHERE account_id = ?1 ORDER BY occurred_at, id",
    )?;
    let archive_events = stmt
        .query_map([id], |r| {
            Ok(ArchiveEvent {
                action: r.get(0)?,
                occurred_at: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(AccountHistory {
        status_events,
        archive_events,
    })
}
