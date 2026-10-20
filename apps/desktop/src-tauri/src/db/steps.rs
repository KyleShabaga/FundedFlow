//! Rust data steps run by migrations (`Step::Rust`). Each runs inside its
//! migration's transaction and must be idempotent.

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::{format_instant, new_id, now, parse_instant, parse_reset_time, parse_tz, trading_day};

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

/// Migration 7: map the legacy `firms` to `providers` and `programmes` to
/// `programme_families` (one row each, linked by `legacy_firm_id` /
/// `legacy_programme_id`), then fill `accounts.provider_id` from `firm_id`.
///
/// Slugs come from the name (see `slug`); a collision gets `-2`, `-3`, ... in
/// creation order. Record status is `unknown`, or `archived` for a
/// soft-deleted firm or programme. A family's category is its programme's
/// `programme_type`. Nothing else is inferred: no variant, version, phase or
/// path is created, and no phase event comes from `account_type`. The legacy
/// rows are not changed. Mapped rows are skipped, so it is idempotent.
pub(crate) fn map_legacy_catalogue(conn: &Connection) -> rusqlite::Result<()> {
    let firms: Vec<String> = conn
        .prepare("SELECT id FROM firms ORDER BY created_at, id")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for firm in firms {
        provider_for_firm(conn, &firm)?;
    }

    let programmes = conn
        .prepare(
            "SELECT g.id, g.name, g.programme_type, g.created_at, g.updated_at, g.deleted_at, p.id
             FROM programmes g JOIN providers p ON p.legacy_firm_id = g.firm_id
             WHERE NOT EXISTS (SELECT 1 FROM programme_families f WHERE f.legacy_programme_id = g.id)
             ORDER BY g.created_at, g.id",
        )?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, name, category, created_at, updated_at, deleted_at, provider) in programmes {
        let slug = unique_slug(&slug(&name, "programme"), |s| {
            exists(conn, "SELECT 1 FROM programme_families WHERE provider_id = ?1 AND slug = ?2", params![provider, s])
        })?;
        let now = now();
        conn.execute(
            "INSERT INTO programme_families (id, provider_id, slug, display_name, category, record_status,
                                             legacy_programme_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                new_id(),
                provider,
                slug,
                name,
                category,
                if deleted_at.is_some() { "archived" } else { "unknown" },
                id,
                stored_instant(&created_at, &now),
                stored_instant(&updated_at, &now),
            ],
        )?;
    }

    conn.execute(
        "UPDATE accounts SET provider_id = (SELECT p.id FROM providers p WHERE p.legacy_firm_id = accounts.firm_id)
         WHERE provider_id IS NULL AND firm_id IS NOT NULL",
        [],
    )?;
    Ok(())
}

/// The provider mapped from a legacy firm, created on first use (by
/// migration 7, and by the account store when it creates a firm). `None` if
/// there is no such firm.
pub(crate) fn provider_for_firm(conn: &Connection, firm_id: &str) -> rusqlite::Result<Option<String>> {
    let existing: Option<String> = conn
        .query_row("SELECT id FROM providers WHERE legacy_firm_id = ?1", [firm_id], |r| r.get(0))
        .optional()?;
    if existing.is_some() {
        return Ok(existing);
    }
    let firm = conn
        .query_row(
            "SELECT name, website, notes_md, created_at, updated_at, deleted_at FROM firms WHERE id = ?1",
            [firm_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((name, website, notes, created_at, updated_at, deleted_at)) = firm else {
        return Ok(None);
    };
    let slug = unique_slug(&slug(&name, "provider"), |s| exists(conn, "SELECT 1 FROM providers WHERE slug = ?1", [s]))?;
    // Only an http(s) address fits website_url; anything else stays on the firm.
    let website = website.map(|w| w.trim().to_string()).filter(|w| {
        w.strip_prefix("https://").or_else(|| w.strip_prefix("http://")).is_some_and(|rest| !rest.is_empty())
    });
    let now = now();
    let id = new_id();
    conn.execute(
        "INSERT INTO providers (id, slug, display_name, website_url, notes, record_status, legacy_firm_id,
                                created_at, updated_at, archived_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            slug,
            name,
            website,
            notes,
            if deleted_at.is_some() { "archived" } else { "unknown" },
            firm_id,
            stored_instant(&created_at, &now),
            stored_instant(&updated_at, &now),
            deleted_at.map(|d| stored_instant(&d, &now)),
        ],
    )?;
    Ok(Some(id))
}

/// Longest slug before a collision suffix, well inside the 100-character limit.
const MAX_SLUG: usize = 90;

/// A catalogue slug from a display name: ASCII letters and digits in lower
/// case, every other run of characters one hyphen, and no hyphen at either
/// end. `fallback` when nothing is left (a name with no ASCII letters).
pub(crate) fn slug(name: &str, fallback: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.truncate(MAX_SLUG);
    let out = out.trim_end_matches('-');
    if out.is_empty() { fallback.to_string() } else { out.to_string() }
}

/// `base`, or the first free one of `base-2`, `base-3`, ...
fn unique_slug(base: &str, taken: impl Fn(&str) -> rusqlite::Result<bool>) -> rusqlite::Result<String> {
    let mut candidate = base.to_string();
    let mut n = 1;
    while taken(&candidate)? {
        n += 1;
        candidate = format!("{base}-{n}");
    }
    Ok(candidate)
}

fn exists(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> rusqlite::Result<bool> {
    conn.query_row(sql, params, |_| Ok(())).optional().map(|o| o.is_some())
}

/// A legacy timestamp in the catalogue's strict instant format (UTC, ms, `Z`).
fn stored_instant(s: &str, fallback: &str) -> String {
    parse_instant(s).map(format_instant).unwrap_or_else(|| fallback.to_string())
}
