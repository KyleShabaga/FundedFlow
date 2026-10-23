//! App settings: key → JSON value in the `settings` table. Keys are lower-case
//! dotted names; values are any JSON up to 64 KiB. Nothing here is a secret
//! store: the journal holds no credentials.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::domain::now;
use crate::error::{AppError, AppResult};

pub const MAX_VALUE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: serde_json::Value,
    pub updated_at: String,
}

fn valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    key.len() <= 64
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '.'))
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<(String, String, String)> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
}

fn setting((key, value_json, updated_at): (String, String, String)) -> AppResult<Setting> {
    let value = serde_json::from_str(&value_json).map_err(|e| AppError::Database {
        message: format!("setting '{key}' holds invalid JSON: {e}"),
    })?;
    Ok(Setting {
        key,
        value,
        updated_at,
    })
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<Setting>> {
    conn.query_row(
        "SELECT key, value_json, updated_at FROM settings WHERE key = ?1",
        [key],
        row,
    )
    .optional()?
    .map(setting)
    .transpose()
}

pub fn list(conn: &Connection) -> AppResult<Vec<Setting>> {
    let mut stmt = conn.prepare("SELECT key, value_json, updated_at FROM settings ORDER BY key")?;
    let rows = stmt
        .query_map([], row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(setting).collect()
}

/// Insert or replace one setting.
pub fn set(conn: &Connection, key: &str, value: &serde_json::Value) -> AppResult<Setting> {
    if !valid_key(key) {
        return Err(AppError::invalid(
            "key",
            "use lower-case letters, digits, '_' and '.', starting with a letter (max 64)",
        ));
    }
    let text =
        serde_json::to_string(value).map_err(|e| AppError::invalid("value", e.to_string()))?;
    if text.len() > MAX_VALUE_BYTES {
        return Err(AppError::invalid(
            "value",
            format!("must be at most {} KiB", MAX_VALUE_BYTES / 1024),
        ));
    }
    conn.execute(
        "INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![key, text, now()],
    )?;
    get(conn, key)?.ok_or_else(|| AppError::not_found("setting", key))
}

/// Remove a setting; a key that is not set is a no-op.
pub fn remove(conn: &Connection, key: &str) -> AppResult<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
    Ok(())
}
