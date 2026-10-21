//! Account ledger: non-trade money movements (payouts, balance corrections,
//! resets and fees). Payouts, resets and corrections change the bookkeeping
//! balance; evaluation, activation and reset fees do not
//! (`affects_balance = 0`) but are kept for later account-ROI reporting
//! (V1.5; nothing here computes ROI). Amounts are signed decimal text in the
//! account currency; a payout is negative.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::{account_ctx, opt_text, require_account};
use crate::domain::{
    format_instant, micros_to_string, new_id, now, parse_decimal, parse_payload_time, to_micros,
    trading_day, MAX_NOTES_CHARS,
};
use crate::error::{AppError, AppResult, Issues};

pub const KINDS: &[&str] = &[
    "balance_correction",
    "payout",
    "reset",
    "evaluation_fee",
    "activation_fee",
    "reset_fee",
    "other",
];
const FEES: &[&str] = &["evaluation_fee", "activation_fee", "reset_fee"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LedgerEntryInput {
    pub account_id: String,
    pub kind: String,
    /// Signed decimal. Payouts and fees are negative; a correction may be either sign.
    pub amount: String,
    /// Defaults by kind: true for payout, reset and balance_correction, false for fees.
    /// Required (no default) for `other`.
    pub affects_balance: Option<bool>,
    pub effective_at: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    pub account_id: String,
    pub kind: String,
    pub amount: String,
    pub affects_balance: bool,
    pub effective_at: String,
    /// Derived from the account's time zone and trading-day reset time.
    pub trading_day: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

struct Valid {
    kind: String,
    amount_micros: i64,
    affects_balance: bool,
    effective_at: chrono::DateTime<chrono::Utc>,
    note: Option<String>,
}

fn validate(input: &LedgerEntryInput) -> AppResult<Valid> {
    let mut issues = Issues::default();
    if !KINDS.contains(&input.kind.as_str()) {
        issues.add("kind", format!("must be one of {}", KINDS.join(", ")));
    }
    let amount_micros =
        match parse_decimal(&input.amount).and_then(|d| to_micros(d).map(|m| (d, m))) {
            None => {
                issues.add("amount", "must be a number");
                0
            }
            Some((d, _)) if d.is_zero() => {
                issues.add("amount", "must not be zero");
                0
            }
            Some((d, m)) => {
                if (input.kind == "payout" || FEES.contains(&input.kind.as_str()))
                    && d.is_sign_positive()
                {
                    issues.add(
                        "amount",
                        format!("a {} is negative", input.kind.replace('_', " ")),
                    );
                }
                m
            }
        };
    let affects_balance = match (input.kind.as_str(), input.affects_balance) {
        ("other", None) => {
            issues.add(
                "affectsBalance",
                "say whether this changes the account balance",
            );
            false
        }
        (k, Some(true)) if FEES.contains(&k) => {
            issues.add(
                "affectsBalance",
                "fees do not change the balance the rules see",
            );
            false
        }
        (k, Some(false)) if matches!(k, "payout" | "reset" | "balance_correction") => {
            issues.add(
                "affectsBalance",
                format!("a {} always changes the balance", k.replace('_', " ")),
            );
            true
        }
        (_, Some(v)) => v,
        (k, None) => !FEES.contains(&k),
    };
    let effective_at = match parse_payload_time(&input.effective_at) {
        Ok(t) => t,
        Err(m) => {
            issues.add("effectiveAt", m);
            chrono::DateTime::UNIX_EPOCH
        }
    };
    let note = opt_text(input.note.clone());
    if note
        .as_ref()
        .is_some_and(|n| n.chars().count() > MAX_NOTES_CHARS)
    {
        issues.add(
            "note",
            format!("must be at most {MAX_NOTES_CHARS} characters"),
        );
    }
    issues.into_result()?;
    Ok(Valid {
        kind: input.kind.clone(),
        amount_micros,
        affects_balance,
        effective_at,
        note,
    })
}

const SELECT: &str =
    "SELECT id, account_id, kind, amount_micros, affects_balance, effective_at, trading_day, note,
        created_at, updated_at FROM account_ledger_entries";

fn from_row(r: &rusqlite::Row) -> rusqlite::Result<LedgerEntry> {
    Ok(LedgerEntry {
        id: r.get(0)?,
        account_id: r.get(1)?,
        kind: r.get(2)?,
        amount: micros_to_string(r.get(3)?),
        affects_balance: r.get(4)?,
        effective_at: r.get(5)?,
        trading_day: r.get(6)?,
        note: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

/// Non-deleted entries, oldest first. Readable for archived accounts.
pub fn list(conn: &Connection, account_id: &str) -> AppResult<Vec<LedgerEntry>> {
    require_account(conn, account_id)?;
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE account_id = ?1 AND deleted_at IS NULL ORDER BY effective_at, id"
    ))?;
    let rows = stmt.query_map([account_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<LedgerEntry> {
    conn.query_row(
        &format!("{SELECT} WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("ledger entry", id))
}

pub fn create(conn: &mut Connection, input: LedgerEntryInput) -> AppResult<LedgerEntry> {
    let v = validate(&input)?;
    let id = new_id();
    let tx = conn.transaction()?;
    let ctx = account_ctx(&tx, &input.account_id)?;
    let day = trading_day(v.effective_at, ctx.tz, ctx.reset)
        .format("%Y-%m-%d")
        .to_string();
    let at = now();
    tx.execute(
        "INSERT INTO account_ledger_entries (id, account_id, kind, amount_micros, affects_balance, effective_at,
                                             trading_day, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, input.account_id, v.kind, v.amount_micros, v.affects_balance, format_instant(v.effective_at), day, v.note, at],
    )?;
    record_revision(&tx, &id, "create", false, &legacy_metadata("create"))?;
    tx.commit()?;
    get(conn, &id)
}

/// Replace an entry's editable fields. It never moves to another account.
pub fn update(conn: &mut Connection, id: &str, input: LedgerEntryInput) -> AppResult<LedgerEntry> {
    update_with_metadata(conn, id, input, legacy_metadata("update"))
}

pub fn update_with_metadata(
    conn: &mut Connection,
    id: &str,
    input: LedgerEntryInput,
    metadata: super::evidence::CorrectionMetadata,
) -> AppResult<LedgerEntry> {
    metadata.validate()?;
    let v = validate(&input)?;
    let tx = conn.transaction()?;
    let owner: String = tx
        .query_row(
            "SELECT account_id FROM account_ledger_entries WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("ledger entry", id))?;
    if owner != input.account_id {
        return Err(AppError::invalid(
            "accountId",
            "an entry cannot move to another account",
        ));
    }
    let ctx = account_ctx(&tx, &owner)?;
    let day = trading_day(v.effective_at, ctx.tz, ctx.reset)
        .format("%Y-%m-%d")
        .to_string();
    tx.execute(
        "UPDATE account_ledger_entries SET kind = ?2, amount_micros = ?3, affects_balance = ?4, effective_at = ?5,
                trading_day = ?6, note = ?7, updated_at = ?8 WHERE id = ?1",
        params![id, v.kind, v.amount_micros, v.affects_balance, format_instant(v.effective_at), day, v.note, now()],
    )?;
    record_revision(&tx, id, "update", false, &metadata)?;
    tx.commit()?;
    get(conn, id)
}

/// Soft delete: the entry leaves lists and balance sums but the row is kept.
pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    delete_with_metadata(conn, id, legacy_metadata("remove"))
}

pub fn delete_with_metadata(
    conn: &mut Connection,
    id: &str,
    metadata: super::evidence::CorrectionMetadata,
) -> AppResult<()> {
    metadata.validate()?;
    let tx = conn.transaction()?;
    let owner: String = tx
        .query_row(
            "SELECT account_id FROM account_ledger_entries WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("ledger entry", id))?;
    account_ctx(&tx, &owner)?; // archived accounts are read-only
    let at = now();
    record_revision(&tx, id, "remove", true, &metadata)?;
    tx.execute(
        "UPDATE account_ledger_entries SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, at],
    )?;
    tx.commit()?;
    Ok(())
}

/// Sum of the balance-affecting entries, as exact decimal text (zero when there are none).
pub fn balance_adjustment(conn: &Connection, account_id: &str) -> AppResult<String> {
    require_account(conn, account_id)?;
    let micros: i64 = conn.query_row(
        "SELECT COALESCE(SUM(amount_micros), 0) FROM account_ledger_entries
         WHERE account_id = ?1 AND deleted_at IS NULL AND affects_balance = 1",
        [account_id],
        |r| r.get(0),
    )?;
    Ok(micros_to_string(micros))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRevision {
    pub id: String,
    pub entry_id: String,
    pub account_id: String,
    pub operation: String,
    pub entry: LedgerEntry,
    pub deleted: bool,
    pub recorded_at: String,
    pub actor: String,
    pub reason: String,
    pub supersedes_id: Option<String>,
}
fn legacy_metadata(operation: &str) -> super::evidence::CorrectionMetadata {
    super::evidence::CorrectionMetadata {
        actor: "local_user:legacy_api".into(),
        reason: format!("Legacy ledger.{operation}; no reason supplied by caller"),
    }
}
fn record_revision(
    conn: &Connection,
    id: &str,
    operation: &str,
    deleted: bool,
    metadata: &super::evidence::CorrectionMetadata,
) -> AppResult<()> {
    let entry = get(conn, id)?;
    let previous: Option<String> = conn
        .query_row(
            "SELECT id FROM ledger_revisions WHERE entry_id=?1 ORDER BY rowid DESC LIMIT 1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    conn.execute("INSERT INTO ledger_revisions(id,entry_id,account_id,operation,entry_json,deleted,recorded_at,actor,reason,supersedes_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![new_id(), id, entry.account_id, operation, super::evidence::encode(&entry)?, deleted, now(), metadata.actor, metadata.reason, previous])?;
    Ok(())
}
/// Immutable state after each operation, including deleted entries and the migration baseline.
pub fn history(conn: &Connection, account_id: &str) -> AppResult<Vec<LedgerRevision>> {
    require_account(conn, account_id)?;
    let mut stmt=conn.prepare("SELECT id,entry_id,account_id,operation,entry_json,deleted,recorded_at,actor,reason,supersedes_id FROM ledger_revisions WHERE account_id=?1 ORDER BY rowid")?;
    let rows = stmt.query_map([account_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, bool>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
            r.get::<_, Option<String>>(9)?,
        ))
    })?;
    rows.map(|row| {
        let (
            id,
            entry_id,
            account_id,
            operation,
            json,
            deleted,
            recorded_at,
            actor,
            reason,
            supersedes_id,
        ) = row?;
        Ok(LedgerRevision {
            id,
            entry_id,
            account_id,
            operation,
            entry: super::evidence::decode(&json)?,
            deleted,
            recorded_at,
            actor,
            reason,
            supersedes_id,
        })
    })
    .collect()
}
