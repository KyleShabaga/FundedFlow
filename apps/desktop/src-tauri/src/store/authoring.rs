//! Catalogue authoring (Build 9.2): create and edit a *draft* catalogue version
//! with its owned child records, and record corrections as superseding versions.
//!
//! Only drafts are editable. A reviewed version is frozen by triggers, and this
//! module refuses edits to any version that is not a draft with a clear message,
//! so `needs_review` content cannot drift after it was submitted. A correction is
//! a new draft that names the version it supersedes and why; publishing it is the
//! usual review path (`store::catalogue::transition_version`), and the old version
//! moves to `superseded` only once its replacement is verified.
//!
//! Sources are append-only: a source is created here and never edited, so a claim's
//! provenance cannot change after the fact.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Deserialize;

use super::catalogue;
use crate::catalogue::{BillingModel, CatalogueVersion, PathStatus, PhaseKey, SourceType};
use crate::domain::{format_instant, new_id, now, parse_decimal, parse_payload_time, to_micros};
use crate::catalogue::sql_text;
use crate::error::{AppError, AppResult, Issues};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceInput {
    pub source_type: SourceType,
    /// http(s) address. A source needs a URL or a descriptor.
    pub url: Option<String>,
    pub descriptor: Option<String>,
    pub publisher: Option<String>,
    pub published_at: Option<String>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    /// `sha256:` plus 64 lower-case hex digits.
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimInput {
    pub field: String,
    pub origin: crate::catalogue::ClaimOrigin,
    pub source_id: Option<String>,
    pub provider_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PathInput {
    pub path_key: String,
    pub provider_label: String,
    pub is_default: bool,
    pub display_order: i64,
    pub record_status: PathStatus,
    pub rulebook_version_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseInput {
    pub phase_key: PhaseKey,
    pub provider_label: String,
    pub display_order: i64,
    pub default_rulebook_version_id: Option<String>,
    #[serde(default)]
    pub paths: Vec<PathInput>,
}

/// Which phase and path an offer covers, by the keys that are unique within one version.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseRef {
    pub phase_key: PhaseKey,
    pub provider_label: String,
    pub path_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfferInput {
    /// Absent: the offer covers the whole variant.
    pub phase: Option<PhaseRef>,
    pub billing_model: BillingModel,
    pub currency: Option<String>,
    /// Decimal text. Absent = unknown; "0" = known free.
    pub list_price: Option<String>,
    pub sale_price: Option<String>,
    pub reset_fee: Option<String>,
    pub activation_fee: Option<String>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftInput {
    pub programme_variant_id: String,
    pub revision_label: Option<String>,
    pub captured_at: String,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    /// A correction names the version it supersedes (same variant) and why.
    pub supersedes_version_id: Option<String>,
    pub correction_reason: Option<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
    #[serde(default)]
    pub claims: Vec<ClaimInput>,
    #[serde(default)]
    pub phases: Vec<PhaseInput>,
    #[serde(default)]
    pub offers: Vec<OfferInput>,
}

fn instant(issues: &mut Issues, field: &str, v: &Option<String>) -> Option<String> {
    match v.as_deref().map(parse_payload_time).transpose() {
        Ok(t) => t.map(format_instant),
        Err(m) => {
            issues.add(field, m);
            None
        }
    }
}

fn money(issues: &mut Issues, field: &str, v: &Option<String>) -> Option<i64> {
    v.as_deref().and_then(|s| match parse_decimal(s).and_then(to_micros) {
        Some(m) if m >= 0 => Some(m),
        _ => {
            issues.add(field, "must be zero or a positive number; leave it empty when unknown");
            None
        }
    })
}

fn text(v: &Option<String>) -> Option<String> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Create a source. Sources are never edited afterwards.
pub fn create_source(conn: &mut Connection, input: SourceInput) -> AppResult<crate::catalogue::SourceReference> {
    let mut issues = Issues::default();
    let url = text(&input.url);
    let descriptor = text(&input.descriptor);
    if url.as_ref().is_some_and(|u| !(u.starts_with("http://") || u.starts_with("https://")) || u.len() < 9) {
        issues.add("url", "must start with http:// or https://");
    }
    if url.is_none() && descriptor.is_none() {
        issues.add("descriptor", "give a URL or describe where this came from");
    }
    let published_at = instant(&mut issues, "publishedAt", &input.published_at);
    let effective_from = instant(&mut issues, "effectiveFrom", &input.effective_from);
    let effective_to = instant(&mut issues, "effectiveTo", &input.effective_to);
    if matches!((&effective_from, &effective_to), (Some(f), Some(t)) if t <= f) {
        issues.add("effectiveTo", "must be after effectiveFrom");
    }
    let hash = text(&input.content_hash);
    if hash.as_ref().is_some_and(|h| h.len() != 71 || !h.starts_with("sha256:") || !h[7..].chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))) {
        issues.add("contentHash", "must be sha256: followed by 64 lower-case hex digits");
    }
    issues.into_result()?;
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO catalogue_sources (id, source_type, url, descriptor, publisher, captured_at, published_at,
                                        effective_from, effective_to, content_hash, verification_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'draft')",
        params![id, sql_text(&input.source_type), url, descriptor, text(&input.publisher), now(), published_at, effective_from, effective_to, hash],
    )?;
    tx.commit()?;
    catalogue::load(conn)?
        .sources
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::not_found("source", &id))
}

struct Checked {
    captured_at: String,
    effective_from: Option<String>,
    effective_to: Option<String>,
    revision_label: Option<String>,
    correction_reason: Option<String>,
}

fn check(input: &DraftInput) -> AppResult<Checked> {
    let mut issues = Issues::default();
    let captured_at = instant(&mut issues, "capturedAt", &Some(input.captured_at.clone())).unwrap_or_default();
    let effective_from = instant(&mut issues, "effectiveFrom", &input.effective_from);
    let effective_to = instant(&mut issues, "effectiveTo", &input.effective_to);
    if matches!((&effective_from, &effective_to), (Some(f), Some(t)) if t <= f) {
        issues.add("effectiveTo", "must be after effectiveFrom");
    }
    let correction_reason = text(&input.correction_reason);
    if input.supersedes_version_id.is_some() && correction_reason.is_none() {
        issues.add("correctionReason", "say why this version corrects the earlier one");
    }
    if input.supersedes_version_id.is_none() && correction_reason.is_some() {
        issues.add("supersedesVersionId", "a correction reason needs the version it corrects");
    }
    for (i, c) in input.claims.iter().enumerate() {
        if c.field.trim().is_empty() {
            issues.add(&format!("claims[{i}].field"), "required");
        }
    }
    for (i, p) in input.phases.iter().enumerate() {
        if p.provider_label.trim().is_empty() {
            issues.add(&format!("phases[{i}].providerLabel"), "required");
        }
        if p.paths.iter().filter(|x| x.is_default).count() > 1 {
            issues.add(&format!("phases[{i}].paths"), "at most one default path");
        }
    }
    for (i, o) in input.offers.iter().enumerate() {
        let mut m = |f: &str, v: &Option<String>| money(&mut issues, &format!("offers[{i}].{f}"), v);
        let prices = [m("listPrice", &o.list_price), m("salePrice", &o.sale_price), m("resetFee", &o.reset_fee), m("activationFee", &o.activation_fee)];
        let any_price = o.list_price.is_some() || o.sale_price.is_some() || o.reset_fee.is_some() || o.activation_fee.is_some();
        let _ = prices;
        if any_price && text(&o.currency).is_none() {
            issues.add(&format!("offers[{i}].currency"), "prices need a currency");
        }
        if text(&o.currency).is_some_and(|c| c.len() != 3 || !c.chars().all(|ch| ch.is_ascii_uppercase())) {
            issues.add(&format!("offers[{i}].currency"), "must be a 3-letter code such as USD");
        }
    }
    issues.into_result()?;
    Ok(Checked {
        captured_at,
        effective_from,
        effective_to,
        revision_label: text(&input.revision_label),
        correction_reason,
    })
}

fn write_children(tx: &Transaction, version_id: &str, input: &DraftInput) -> AppResult<()> {
    for source in &input.source_ids {
        tx.execute("INSERT INTO catalogue_version_sources (catalogue_version_id, source_id) VALUES (?1, ?2)", params![version_id, source])
            .map_err(|_| AppError::invalid("sourceIds", format!("unknown or repeated source '{source}'")))?;
    }
    for (position, c) in input.claims.iter().enumerate() {
        tx.execute(
            "INSERT INTO catalogue_field_claims (catalogue_version_id, position, field, origin, source_id, provider_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![version_id, position as i64, c.field.trim(), sql_text(&c.origin), c.source_id, text(&c.provider_text)],
        )?;
    }
    for p in &input.phases {
        let phase_id = new_id();
        tx.execute(
            "INSERT INTO programme_phases (id, catalogue_version_id, phase_key, provider_label, display_order, default_rulebook_version_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![phase_id, version_id, sql_text(&p.phase_key), p.provider_label.trim(), p.display_order, p.default_rulebook_version_id],
        )?;
        for path in &p.paths {
            tx.execute(
                "INSERT INTO phase_paths (id, programme_phase_id, path_key, provider_label, is_default, display_order, record_status, rulebook_version_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![new_id(), phase_id, path.path_key, path.provider_label.trim(), path.is_default, path.display_order, sql_text(&path.record_status), path.rulebook_version_id],
            )?;
        }
    }
    for (i, o) in input.offers.iter().enumerate() {
        let (phase_id, path_id) = match &o.phase {
            None => (None, None),
            Some(r) => {
                let phase: Option<String> = tx
                    .query_row(
                        "SELECT id FROM programme_phases WHERE catalogue_version_id = ?1 AND phase_key = ?2 AND provider_label = ?3",
                        params![version_id, sql_text(&r.phase_key), r.provider_label.trim()],
                        |row| row.get(0),
                    )
                    .optional()?;
                let phase = phase.ok_or_else(|| AppError::invalid(&format!("offers[{i}].phase"), "names a phase that this version does not have"))?;
                let path = match &r.path_key {
                    None => None,
                    Some(k) => Some(
                        tx.query_row("SELECT id FROM phase_paths WHERE programme_phase_id = ?1 AND path_key = ?2", params![phase, k], |row| row.get::<_, String>(0))
                            .optional()?
                            .ok_or_else(|| AppError::invalid(&format!("offers[{i}].phase.pathKey"), "names a path that this phase does not have"))?,
                    ),
                };
                (Some(phase), path)
            }
        };
        let offer_id = new_id();
        // Already validated by `check`.
        let micros = |_: &str, v: &Option<String>| v.as_deref().and_then(|s| parse_decimal(s).and_then(to_micros));
        tx.execute(
            "INSERT INTO commercial_offers (id, catalogue_version_id, programme_phase_id, phase_path_id, billing_model, currency,
                    list_price_micros, sale_price_micros, reset_fee_micros, activation_fee_micros, effective_from, effective_to)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                offer_id,
                version_id,
                phase_id,
                path_id,
                sql_text(&o.billing_model),
                text(&o.currency),
                micros("listPrice", &o.list_price),
                micros("salePrice", &o.sale_price),
                micros("resetFee", &o.reset_fee),
                micros("activationFee", &o.activation_fee),
                o.effective_from.as_deref().and_then(|s| parse_payload_time(s).ok()).map(format_instant),
                o.effective_to.as_deref().and_then(|s| parse_payload_time(s).ok()).map(format_instant),
            ],
        )?;
        for source in &o.source_ids {
            tx.execute("INSERT INTO commercial_offer_sources (commercial_offer_id, source_id) VALUES (?1, ?2)", params![offer_id, source])
                .map_err(|_| AppError::invalid(&format!("offers[{i}].sourceIds"), format!("unknown or repeated source '{source}'")))?;
        }
    }
    Ok(())
}

fn version(conn: &Connection, id: &str) -> AppResult<CatalogueVersion> {
    catalogue::load(conn)?
        .graph
        .catalogue_versions
        .into_iter()
        .find(|v| v.id == id)
        .ok_or_else(|| AppError::not_found("catalogue version", id))
}

/// Create the next draft version of a programme variant, with its sources, claims, phases, paths and offers,
/// in one transaction. A failure anywhere leaves the catalogue unchanged.
pub fn create_draft(conn: &mut Connection, input: DraftInput) -> AppResult<CatalogueVersion> {
    let c = check(&input)?;
    let id = new_id();
    let tx = conn.transaction()?;
    let exists: bool = tx.query_row("SELECT EXISTS (SELECT 1 FROM programme_variants WHERE id = ?1)", [&input.programme_variant_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::invalid("programmeVariantId", "unknown programme variant"));
    }
    if let Some(old) = &input.supersedes_version_id {
        let same: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM catalogue_versions WHERE id = ?1 AND programme_variant_id = ?2)",
            params![old, input.programme_variant_id],
            |r| r.get(0),
        )?;
        if !same {
            return Err(AppError::invalid("supersedesVersionId", "a correction supersedes a version of the same programme variant"));
        }
    }
    let number: i64 = tx.query_row(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM catalogue_versions WHERE programme_variant_id = ?1",
        [&input.programme_variant_id],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO catalogue_versions (id, programme_variant_id, version_number, revision_label, verification_status,
                captured_at, effective_from, effective_to, created_by, supersedes_version_id, correction_reason)
         VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7, 'manual', ?8, ?9)",
        params![id, input.programme_variant_id, number, c.revision_label, c.captured_at, c.effective_from, c.effective_to, input.supersedes_version_id, c.correction_reason],
    )?;
    write_children(&tx, &id, &input)?;
    tx.commit()?;
    version(conn, &id)
}

/// Replace a draft's contents. Only a draft can be edited: anything submitted for review or reviewed is
/// corrected by a new superseding version. Phases and paths are recreated, so a draft whose phase or path is
/// already referenced (an applicability row, an account, a phase event) cannot be replaced, and nothing changes.
pub fn replace_draft(conn: &mut Connection, version_id: &str, input: DraftInput) -> AppResult<CatalogueVersion> {
    let c = check(&input)?;
    let tx = conn.transaction()?;
    let (status, variant): (String, String) = tx
        .query_row("SELECT verification_status, programme_variant_id FROM catalogue_versions WHERE id = ?1", [version_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::not_found("catalogue version", version_id))?;
    if status != "draft" {
        return Err(AppError::invalid(
            "id",
            format!("a {status} version cannot be edited; create a superseding version to correct it"),
        ));
    }
    if variant != input.programme_variant_id {
        return Err(AppError::invalid("programmeVariantId", "a version cannot move to another programme variant"));
    }
    tx.execute("DELETE FROM commercial_offers WHERE catalogue_version_id = ?1", [version_id])?;
    tx.execute("DELETE FROM programme_phases WHERE catalogue_version_id = ?1", [version_id])?;
    tx.execute("DELETE FROM catalogue_field_claims WHERE catalogue_version_id = ?1", [version_id])?;
    tx.execute("DELETE FROM catalogue_version_sources WHERE catalogue_version_id = ?1", [version_id])?;
    tx.execute(
        "UPDATE catalogue_versions SET revision_label = ?2, captured_at = ?3, effective_from = ?4, effective_to = ?5,
                supersedes_version_id = ?6, correction_reason = ?7 WHERE id = ?1",
        params![version_id, c.revision_label, c.captured_at, c.effective_from, c.effective_to, input.supersedes_version_id, c.correction_reason],
    )?;
    write_children(&tx, version_id, &input)?;
    tx.commit()?;
    version(conn, version_id)
}
