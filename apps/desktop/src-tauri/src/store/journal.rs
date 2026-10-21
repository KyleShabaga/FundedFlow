use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use super::{account_ctx, opt_text};
use crate::domain::{format_instant, new_id, now, parse_payload_time};
use crate::error::{AppError, AppResult, Issues};

pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_BODY_CHARS: usize = 100_000;
pub const MAX_TAGS: usize = 20;
pub const MAX_TAG_CHARS: usize = 40;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalEntryInput {
    pub account_id: String,
    /// Optional trade of the same account.
    pub trade_id: Option<String>,
    /// ISO 8601 with offset.
    pub entry_at: String,
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub account_id: String,
    pub trade_id: Option<String>,
    pub entry_at: String,
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

struct Valid {
    trade_id: Option<String>,
    entry_at: String,
    title: String,
    body: String,
    tags: Vec<String>,
}

fn validate(conn: &Connection, input: JournalEntryInput) -> AppResult<Valid> {
    account_ctx(conn, &input.account_id)?;
    let mut issues = Issues::default();

    let title = input.title.trim().to_string();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        issues.add("title", format!("must be 1–{MAX_TITLE_CHARS} characters"));
    }
    if input.body.chars().count() > MAX_BODY_CHARS {
        issues.add("body", "is too long");
    }
    let entry_at = match parse_payload_time(&input.entry_at) {
        Ok(t) => format_instant(t),
        Err(m) => {
            issues.add("entryAt", m);
            String::new()
        }
    };

    // Trim, drop blanks, de-duplicate case-insensitively keeping the first spelling.
    let mut tags: Vec<String> = Vec::new();
    for tag in input.tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        if tag.chars().count() > MAX_TAG_CHARS {
            issues.add("tags", format!("each tag must be at most {MAX_TAG_CHARS} characters"));
        } else if !tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            tags.push(tag.to_string());
        }
    }
    if tags.len() > MAX_TAGS {
        issues.add("tags", format!("at most {MAX_TAGS} tags"));
    }

    let trade_id = opt_text(input.trade_id);
    if let Some(trade_id) = &trade_id {
        let trade: Option<(String, Option<String>)> = conn
            .query_row("SELECT account_id, deleted_at FROM trades WHERE id = ?1", [trade_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        match trade {
            None | Some((_, Some(_))) => issues.add("tradeId", "trade not found"),
            Some((account, None)) if account != input.account_id => {
                issues.add("tradeId", "trade belongs to a different account")
            }
            _ => {}
        }
    }
    issues.into_result()?;
    Ok(Valid { trade_id, entry_at, title, body: input.body, tags })
}

const SELECT: &str = "SELECT j.id, j.account_id, j.trade_id, j.entry_at, j.title, j.body_md,
        (SELECT json_group_array(name) FROM (
            SELECT t.name FROM journal_entry_tags jt JOIN tags t ON t.id = jt.tag_id
            WHERE jt.journal_entry_id = j.id ORDER BY t.name COLLATE NOCASE)),
        j.created_at, j.updated_at
    FROM journal_entries j";

fn from_row(r: &Row) -> rusqlite::Result<JournalEntry> {
    let tags_json: String = r.get(6)?;
    let tags = serde_json::from_str(&tags_json)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(JournalEntry {
        id: r.get(0)?,
        account_id: r.get(1)?,
        trade_id: r.get(2)?,
        entry_at: r.get(3)?,
        title: r.get(4)?,
        body: r.get(5)?,
        tags,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

/// Entries of an account, newest first.
pub fn list(conn: &Connection, account_id: &str) -> AppResult<Vec<JournalEntry>> {
    super::require_account(conn, account_id)?;
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE j.account_id = ?1 ORDER BY j.entry_at DESC, j.id"))?;
    let rows = stmt.query_map([account_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<JournalEntry> {
    conn.query_row(&format!("{SELECT} WHERE j.id = ?1"), [id], from_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("journal entry", id))
}

fn set_tags(tx: &Transaction, entry_id: &str, tags: &[String], now: &str) -> AppResult<()> {
    tx.execute("DELETE FROM journal_entry_tags WHERE journal_entry_id = ?1", [entry_id])?;
    for name in tags {
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM tags WHERE kind = 'general' AND name = ?1 COLLATE NOCASE AND deleted_at IS NULL",
                [name],
                |r| r.get(0),
            )
            .optional()?;
        let tag_id = match existing {
            Some(id) => id,
            None => {
                let id = new_id();
                tx.execute(
                    "INSERT INTO tags (id, name, kind, created_at, updated_at) VALUES (?1, ?2, 'general', ?3, ?3)",
                    params![id, name, now],
                )?;
                id
            }
        };
        tx.execute(
            "INSERT INTO journal_entry_tags (journal_entry_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
            params![entry_id, tag_id, now],
        )?;
    }
    Ok(())
}

pub fn create(conn: &mut Connection, input: JournalEntryInput) -> AppResult<JournalEntry> {
    let account_id = input.account_id.clone();
    let v = validate(conn, input)?;
    let id = new_id();
    let now = now();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO journal_entries (id, account_id, trade_id, entry_at, title, body_md, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, account_id, v.trade_id, v.entry_at, v.title, v.body, now],
    )?;
    set_tags(&tx, &id, &v.tags, &now)?;
    tx.commit()?;
    get(conn, &id)
}

pub fn update(conn: &mut Connection, id: &str, input: JournalEntryInput) -> AppResult<JournalEntry> {
    let account_id: String = conn
        .query_row("SELECT account_id FROM journal_entries WHERE id = ?1", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::not_found("journal entry", id))?;
    if account_id != input.account_id {
        return Err(AppError::invalid("accountId", "a journal entry cannot be moved to another account"));
    }
    let v = validate(conn, input)?;
    let now = now();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE journal_entries SET trade_id = ?2, entry_at = ?3, title = ?4, body_md = ?5, updated_at = ?6
         WHERE id = ?1",
        params![id, v.trade_id, v.entry_at, v.title, v.body, now],
    )?;
    set_tags(&tx, id, &v.tags, &now)?;
    tx.commit()?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let entry = get(conn, id)?;
    account_ctx(conn, &entry.account_id)?;
    match conn.execute("DELETE FROM journal_entries WHERE id = ?1", [id])? {
        0 => Err(AppError::not_found("journal entry", id)),
        _ => Ok(()),
    }
}
