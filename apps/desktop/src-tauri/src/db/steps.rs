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

/// Migration 10: convert the legacy account-owned rulebooks (renamed by 0009
/// to `legacy_account_rulebook_versions` / `legacy_account_rules`) into
/// account-private rulebooks, as specified field by field in
/// docs/rulebook-migration.md:
///
/// - one private rulebook per account that has legacy versions;
/// - each version and rule keeps its legacy ID, so snapshot references resolve;
/// - drafts stay drafts, active and retired versions become published
///   (`needs_review`), never provider-verified; legacy `verified_at` becomes
///   `user_confirmed_at`;
/// - each version that was ever active gets an assignment from its
///   `effective_from` to the next such version's;
/// - `source_reference` becomes a user-manual source with a candidate claim per rule.
///
/// The legacy rows are left as they are. Versions already converted (by ID)
/// are skipped, so running it again changes nothing.
pub(crate) fn convert_legacy_rulebooks(conn: &Connection) -> rusqlite::Result<()> {
    use crate::rulebook::{convert_legacy_rule, legacy_rule_key};

    let started = now();
    let versions: Vec<LegacyVersion> = conn
        .prepare(
            "SELECT v.id, v.account_id, v.version_number, v.status, v.source, v.source_reference, v.verified_at,
                    v.notes_md, v.created_at, v.updated_at, v.deleted_at
             FROM legacy_account_rulebook_versions v
             WHERE NOT EXISTS (SELECT 1 FROM rulebook_versions n WHERE n.id = v.id)
             ORDER BY v.account_id, v.version_number",
        )?
        .query_map([], |r| {
            Ok(LegacyVersion {
                id: r.get(0)?,
                account_id: r.get(1)?,
                version_number: r.get(2)?,
                status: r.get(3)?,
                source: r.get(4)?,
                source_reference: r.get(5)?,
                verified_at: r.get(6)?,
                notes: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
                deleted_at: r.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    for v in &versions {
        let rulebook_id = account_rulebook(conn, &v.account_id, &started)?;
        let created = stored_instant(&v.created_at, &started);
        conn.execute(
            "INSERT INTO rulebook_versions (id, rulebook_id, version_number, schema_version, verification_status, origin,
                                            captured_at, user_confirmed_at, change_reason, record_status,
                                            created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, 'draft', ?4, ?5, ?6, ?7, ?8, ?5, ?9)",
            params![
                v.id,
                rulebook_id,
                v.version_number,
                format!("legacy_{}", v.source),
                created,
                v.verified_at.as_deref().and_then(parse_instant).map(format_instant),
                v.notes,
                if v.deleted_at.is_some() { "archived" } else { "active" },
                stored_instant(&v.updated_at, &created),
            ],
        )?;

        let source_id = match v.source_reference.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => None,
            Some(reference) => {
                let id = new_id();
                conn.execute(
                    "INSERT INTO catalogue_sources (id, source_type, descriptor, captured_at, verification_status)
                     VALUES (?1, 'user_manual', ?2, ?3, 'needs_review')",
                    params![id, reference, created],
                )?;
                Some(id)
            }
        };

        let mut select = conn.prepare(
            "SELECT id, rule_type, origin, evaluation, value_state, params_json, label, sort_order, created_at, updated_at
             FROM legacy_account_rules WHERE rulebook_version_id = ?1 ORDER BY sort_order, id",
        )?;
        let rules = select
            .query_map([&v.id], |r| {
                Ok(LegacyRule {
                    id: r.get(0)?,
                    rule_type: r.get(1)?,
                    origin: r.get(2)?,
                    evaluation: r.get(3)?,
                    value_state: r.get(4)?,
                    params_json: r.get(5)?,
                    label: r.get(6)?,
                    sort_order: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for rule in rules {
            let (rule_type, parameters, support) =
                convert_legacy_rule(&rule.rule_type, &rule.evaluation, &rule.value_state, &rule.params_json);
            let rule_created = stored_instant(&rule.created_at, &created);
            conn.execute(
                "INSERT INTO rule_definitions (id, rulebook_version_id, rule_key, rule_type, parameter_schema_version,
                                               parameters_json, display_label, support_status, override_kind,
                                               display_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    rule.id,
                    v.id,
                    legacy_rule_key(&rule.rule_type, &rule.origin, rule.sort_order),
                    rule_type,
                    parameters.to_string(),
                    rule.label,
                    support,
                    (rule.origin == "personal").then_some("personal_limit"),
                    rule.sort_order.max(0),
                    rule_created,
                    stored_instant(&rule.updated_at, &rule_created),
                ],
            )?;
            if let Some(source_id) = &source_id {
                conn.execute(
                    "INSERT INTO rule_claims (id, rule_definition_id, source_id, origin, claim_status, created_at)
                     VALUES (?1, ?2, ?3, 'user_entered', 'candidate', ?4)",
                    params![new_id(), rule.id, source_id, created],
                )?;
            }
        }

        if v.status != "draft" {
            conn.execute("UPDATE rulebook_versions SET verification_status = 'needs_review' WHERE id = ?1", [&v.id])?;
        }
    }

    // Assignments for every converted version that was ever in force.
    let mut select = conn.prepare(
        "SELECT v.id, v.account_id, v.effective_from,
                LEAD(v.effective_from) OVER (PARTITION BY v.account_id ORDER BY v.effective_from, v.version_number),
                v.source, coalesce(v.activated_at, v.created_at)
         FROM legacy_account_rulebook_versions v
         WHERE v.status IN ('active', 'retired') AND v.deleted_at IS NULL",
    )?;
    let intervals = select
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (version_id, account_id, from, to, source, assigned_at) in intervals {
        // Two versions from one day: the earlier one never governed a day.
        if to.as_deref() == Some(from.as_str())
            || exists(conn, "SELECT 1 FROM account_rulebook_assignments WHERE rulebook_version_id = ?1", [&version_id])?
        {
            continue;
        }
        conn.execute(
            "INSERT INTO account_rulebook_assignments (id, account_id, rulebook_version_id, effective_from, effective_to,
                                                       assigned_at, assignment_source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![new_id(), account_id, version_id, from, to, stored_instant(&assigned_at, &started), format!("legacy_{source}")],
        )?;
    }
    Ok(())
}

struct LegacyVersion {
    id: String,
    account_id: String,
    version_number: i64,
    status: String,
    source: String,
    source_reference: Option<String>,
    verified_at: Option<String>,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

struct LegacyRule {
    id: String,
    rule_type: String,
    origin: String,
    evaluation: String,
    value_state: String,
    params_json: String,
    label: Option<String>,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

/// The account's private rulebook for converted versions, created on first use.
fn account_rulebook(conn: &Connection, account_id: &str, at: &str) -> rusqlite::Result<String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT b.id FROM rulebooks b JOIN rulebook_versions v ON v.rulebook_id = b.id
             WHERE b.owner_account_id = ?1 AND v.origin LIKE 'legacy_%' LIMIT 1",
            [account_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let (name, provider_id, archived): (String, Option<String>, bool) = conn.query_row(
        "SELECT name, provider_id, archived_at IS NOT NULL FROM accounts WHERE id = ?1",
        [account_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let display = format!("{name} rules");
    let slug = unique_slug(&slug(&display, "account-rules"), |s| exists(conn, "SELECT 1 FROM rulebooks WHERE slug = ?1", [s]))?;
    let id = new_id();
    conn.execute(
        "INSERT INTO rulebooks (id, provider_id, owner_account_id, slug, display_name, record_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, provider_id, account_id, slug, display, if archived { "archived" } else { "active" }, at],
    )?;
    Ok(id)
}
