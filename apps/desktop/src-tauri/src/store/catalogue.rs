//! Production catalogue operations (Build 9 / Build 10): read the whole provider
//! catalogue, move a catalogue version through its review states, link an
//! account to a programme, and append to an account's phase history.
//!
//! Writing catalogue *content* (providers, families, versions, offers) is the
//! importer's job and is not exposed here: reviewed versions are frozen by
//! triggers, and content arrives as new draft versions from tooling, not from
//! the desktop UI. Every rule in the schema's triggers still applies to what
//! these functions write, and a violation comes back as a conflict.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::{account_ctx, require_account};
use crate::catalogue::*;
use crate::domain::{micros_to_string, new_id, now, parse_payload_time};
use crate::error::{AppError, AppResult, Issues};

fn money(m: Option<i64>) -> Option<String> {
    m.map(micros_to_string)
}

/// An enum column as its wire type; an unknown value is a corrupt row, not a panic.
fn wire<T: DeserializeOwned>(text: String) -> rusqlite::Result<T> {
    serde_json::from_value(serde_json::Value::String(text.clone()))
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, format!("'{text}': {e}").into()))
}

fn json<T: DeserializeOwned>(text: String) -> rusqlite::Result<T> {
    serde_json::from_str(&text).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))
}

fn source_ids(conn: &Connection, table: &str, owner: &str, id: &str) -> rusqlite::Result<Vec<String>> {
    conn.prepare(&format!("SELECT source_id FROM {table} WHERE {owner} = ?1 ORDER BY source_id"))?
        .query_map([id], |r| r.get(0))?
        .collect()
}

fn all<T>(conn: &Connection, sql: &str, map: impl Fn(&Row) -> rusqlite::Result<T>) -> rusqlite::Result<Vec<T>> {
    conn.prepare(sql)?.query_map([], |r| map(r))?.collect()
}

/// Everything the catalogue holds, plus the sources its claims cite. Read-only.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueSnapshot {
    pub graph: CatalogueGraph,
    pub sources: Vec<SourceReference>,
}

/// Read every catalogue record into its DTO, ordered by id.
pub fn load(conn: &Connection) -> AppResult<CatalogueSnapshot> {
    Ok(load_all(conn)?)
}

fn load_all(conn: &Connection) -> rusqlite::Result<CatalogueSnapshot> {
    let providers = all(conn, "SELECT * FROM providers ORDER BY id", |r| {
        Ok(Provider {
            id: r.get("id")?,
            slug: r.get("slug")?,
            display_name: r.get("display_name")?,
            aliases: json(r.get("aliases")?)?,
            website_url: r.get("website_url")?,
            jurisdiction: r.get("jurisdiction")?,
            notes: r.get("notes")?,
            record_status: wire(r.get("record_status")?)?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            archived_at: r.get("archived_at")?,
        })
    })?;
    let programme_families = all(conn, "SELECT * FROM programme_families ORDER BY id", |r| {
        Ok(ProgrammeFamily {
            id: r.get("id")?,
            provider_id: r.get("provider_id")?,
            slug: r.get("slug")?,
            display_name: r.get("display_name")?,
            provider_label: r.get("provider_label")?,
            description: r.get("description")?,
            category: wire(r.get("category")?)?,
            record_status: wire(r.get("record_status")?)?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    })?;
    let programme_variants = all(conn, "SELECT * FROM programme_variants ORDER BY id", |r| {
        Ok(ProgrammeVariant {
            id: r.get("id")?,
            provider_id: r.get("provider_id")?,
            programme_family_id: r.get("programme_family_id")?,
            slug: r.get("slug")?,
            display_name: r.get("display_name")?,
            provider_label: r.get("provider_label")?,
            size_label: r.get("size_label")?,
            size_amount: money(r.get("size_amount_micros")?),
            size_currency: r.get("size_currency")?,
            platforms: json(r.get("platforms")?)?,
            metadata: json(r.get("metadata")?)?,
            record_status: wire(r.get("record_status")?)?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    })?;
    let catalogue_versions = all(conn, "SELECT * FROM catalogue_versions ORDER BY id", |r| {
        let id: String = r.get("id")?;
        Ok(CatalogueVersion {
            source_ids: source_ids(conn, "catalogue_version_sources", "catalogue_version_id", &id)?,
            claims: conn
                .prepare(
                    "SELECT field, origin, source_id, provider_text FROM catalogue_field_claims
                     WHERE catalogue_version_id = ?1 ORDER BY position",
                )?
                .query_map([&id], |c| {
                    Ok(FieldClaim {
                        field: c.get(0)?,
                        origin: wire(c.get(1)?)?,
                        source_id: c.get(2)?,
                        provider_text: c.get(3)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?,
            id,
            programme_variant_id: r.get("programme_variant_id")?,
            version_number: r.get("version_number")?,
            revision_label: r.get("revision_label")?,
            verification_status: wire(r.get("verification_status")?)?,
            captured_at: r.get("captured_at")?,
            effective_from: r.get("effective_from")?,
            effective_to: r.get("effective_to")?,
            created_by: wire(r.get("created_by")?)?,
            importer_version: r.get("importer_version")?,
            verified_by: r.get("verified_by")?,
            verified_at: r.get("verified_at")?,
            supersedes_version_id: r.get("supersedes_version_id")?,
            correction_reason: r.get("correction_reason")?,
            content_hash: r.get("content_hash")?,
        })
    })?;
    let programme_phases = all(conn, "SELECT * FROM programme_phases ORDER BY id", |r| {
        Ok(ProgrammePhase {
            id: r.get("id")?,
            catalogue_version_id: r.get("catalogue_version_id")?,
            phase_key: wire(r.get("phase_key")?)?,
            provider_label: r.get("provider_label")?,
            display_order: r.get("display_order")?,
            default_rulebook_version_id: r.get("default_rulebook_version_id")?,
        })
    })?;
    let phase_paths = all(conn, "SELECT * FROM phase_paths ORDER BY id", |r| {
        Ok(PhasePath {
            id: r.get("id")?,
            programme_phase_id: r.get("programme_phase_id")?,
            path_key: r.get("path_key")?,
            provider_label: r.get("provider_label")?,
            is_default: r.get("is_default")?,
            display_order: r.get("display_order")?,
            record_status: wire(r.get("record_status")?)?,
            rulebook_version_id: r.get("rulebook_version_id")?,
        })
    })?;
    let commercial_offers = all(conn, "SELECT * FROM commercial_offers ORDER BY id", |r| {
        let id: String = r.get("id")?;
        Ok(CommercialOffer {
            source_ids: source_ids(conn, "commercial_offer_sources", "commercial_offer_id", &id)?,
            id,
            catalogue_version_id: r.get("catalogue_version_id")?,
            programme_phase_id: r.get("programme_phase_id")?,
            phase_path_id: r.get("phase_path_id")?,
            billing_model: wire(r.get("billing_model")?)?,
            currency: r.get("currency")?,
            list_price: money(r.get("list_price_micros")?),
            sale_price: money(r.get("sale_price_micros")?),
            reset_fee: money(r.get("reset_fee_micros")?),
            activation_fee: money(r.get("activation_fee_micros")?),
            effective_from: r.get("effective_from")?,
            effective_to: r.get("effective_to")?,
        })
    })?;
    let promotions = all(conn, "SELECT * FROM promotions ORDER BY id", |r| {
        let id: String = r.get("id")?;
        let discount = match r.get::<_, String>("discount_kind")?.as_str() {
            "amount" => PromotionDiscount::Amount {
                amount: money(r.get("discount_amount_micros")?).unwrap_or_default(),
                currency: r.get("discount_currency")?,
            },
            "percent" => PromotionDiscount::Percent { percent: money(r.get("discount_percent_micros")?).unwrap_or_default() },
            _ => PromotionDiscount::Unknown,
        };
        Ok(Promotion {
            source_ids: source_ids(conn, "promotion_sources", "promotion_id", &id)?,
            id,
            provider_id: r.get("provider_id")?,
            code: r.get("code")?,
            provider_label: r.get("provider_label")?,
            discount,
            valid_from: r.get("valid_from")?,
            valid_to: r.get("valid_to")?,
            verification_status: wire(r.get("verification_status")?)?,
        })
    })?;
    let promotion_offers = all(conn, "SELECT * FROM promotion_offers ORDER BY promotion_id, commercial_offer_id", |r| {
        Ok(PromotionOffer {
            promotion_id: r.get("promotion_id")?,
            commercial_offer_id: r.get("commercial_offer_id")?,
            valid_from: r.get("valid_from")?,
            valid_to: r.get("valid_to")?,
        })
    })?;
    let sources = all(conn, "SELECT * FROM catalogue_sources ORDER BY id", |r| {
        Ok(SourceReference {
            id: r.get("id")?,
            source_type: wire(r.get("source_type")?)?,
            url: r.get("url")?,
            descriptor: r.get("descriptor")?,
            publisher: r.get("publisher")?,
            captured_at: r.get("captured_at")?,
            published_at: r.get("published_at")?,
            effective_from: r.get("effective_from")?,
            effective_to: r.get("effective_to")?,
            content_hash: r.get("content_hash")?,
            importer_version: r.get("importer_version")?,
            verification_status: wire(r.get("verification_status")?)?,
            reviewed_by: r.get("reviewed_by")?,
            reviewed_at: r.get("reviewed_at")?,
        })
    })?;
    Ok(CatalogueSnapshot {
        graph: CatalogueGraph {
            providers,
            programme_families,
            programme_variants,
            catalogue_versions,
            programme_phases,
            phase_paths,
            commercial_offers,
            promotions,
            promotion_offers,
        },
        sources,
    })
}

// ---------------------------------------------------------------------------
// Version review
// ---------------------------------------------------------------------------

const TRANSITIONS: &[&str] = &["draft", "needs_review", "verified", "stale", "superseded", "rejected"];

/// Move a catalogue version along its review states. The schema's trigger
/// decides which moves are legal (`canTransitionVerification`); this adds the
/// reviewer. `verified` needs a named reviewer, and the time is recorded now.
/// A version that was ever verified stays frozen: only its status changes.
pub fn transition_version(
    conn: &mut Connection,
    version_id: &str,
    to: &str,
    reviewer: Option<&str>,
) -> AppResult<CatalogueVersion> {
    if !TRANSITIONS.contains(&to) {
        return Err(AppError::invalid("to", format!("must be one of {}", TRANSITIONS.join(", "))));
    }
    let reviewer = reviewer.map(str::trim).filter(|r| !r.is_empty());
    if to == "verified" && reviewer.is_none() {
        return Err(AppError::invalid("reviewer", "name the person who verified this version"));
    }
    if reviewer.is_some_and(|r| r.chars().count() > 200) {
        return Err(AppError::invalid("reviewer", "must be at most 200 characters"));
    }
    let tx = conn.transaction()?;
    let found: Option<String> = tx
        .query_row("SELECT verification_status FROM catalogue_versions WHERE id = ?1", [version_id], |r| r.get(0))
        .optional()?;
    let from = found.ok_or_else(|| AppError::not_found("catalogue version", version_id))?;
    if from == to {
        return Err(AppError::invalid("to", format!("the version is already {to}")));
    }
    let changed = if to == "verified" {
        // First verification signs it; a stale version being re-verified keeps its original sign-off.
        tx.execute(
            "UPDATE catalogue_versions SET verification_status = 'verified',
                    verified_by = COALESCE(verified_by, ?2), verified_at = COALESCE(verified_at, ?3)
             WHERE id = ?1",
            params![version_id, reviewer, now()],
        )?
    } else {
        tx.execute("UPDATE catalogue_versions SET verification_status = ?2 WHERE id = ?1", params![version_id, to])?
    };
    debug_assert_eq!(changed, 1);
    tx.commit()?;
    load(conn)?
        .graph
        .catalogue_versions
        .into_iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| AppError::not_found("catalogue version", version_id))
}

// ---------------------------------------------------------------------------
// Account link and phase history
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountLinkInput {
    pub account_id: String,
    pub programme_variant_id: Option<String>,
    pub catalogue_version_id: Option<String>,
    pub selected_phase_path_id: Option<String>,
    pub size_source: AccountFieldSource,
}

pub fn get_link(conn: &Connection, account_id: &str) -> AppResult<AccountCatalogueLink> {
    require_account(conn, account_id)?;
    Ok(conn.query_row(
        "SELECT id, provider_id, programme_variant_id, catalogue_version_id, selected_phase_path_id, parent_account_id,
                size_source FROM accounts WHERE id = ?1",
        [account_id],
        |r| {
            Ok(AccountCatalogueLink {
                account_id: r.get(0)?,
                provider_id: r.get(1)?,
                programme_variant_id: r.get(2)?,
                catalogue_version_id: r.get(3)?,
                selected_phase_path_id: r.get(4)?,
                parent_account_id: r.get(5)?,
                size_source: wire(r.get(6)?)?,
            })
        },
    )?)
}

/// Link an account to a programme variant, version and path (or clear them). The provider
/// follows the variant. The schema checks that each belongs to the one above it; selecting a
/// newer version is always an explicit call, and adding a version never changes an account.
pub fn set_link(conn: &mut Connection, input: AccountLinkInput) -> AppResult<AccountCatalogueLink> {
    let tx = conn.transaction()?;
    account_ctx(&tx, &input.account_id)?;
    let provider: Option<String> = match &input.programme_variant_id {
        Some(variant) => Some(
            tx.query_row("SELECT provider_id FROM programme_variants WHERE id = ?1", [variant], |r| r.get(0))
                .optional()?
                .ok_or_else(|| AppError::invalid("programmeVariantId", "unknown programme variant"))?,
        ),
        None => {
            if input.catalogue_version_id.is_some() || input.selected_phase_path_id.is_some() {
                return Err(AppError::invalid("programmeVariantId", "a version or path needs its programme variant"));
            }
            tx.query_row("SELECT provider_id FROM accounts WHERE id = ?1", [&input.account_id], |r| r.get(0))?
        }
    };
    tx.execute(
        "UPDATE accounts SET provider_id = ?2, programme_variant_id = ?3, catalogue_version_id = ?4,
                selected_phase_path_id = ?5, size_source = ?6, updated_at = ?7 WHERE id = ?1",
        params![
            input.account_id,
            provider,
            input.programme_variant_id,
            input.catalogue_version_id,
            input.selected_phase_path_id,
            sql_text(&input.size_source),
            now()
        ],
    )?;
    tx.commit()?;
    get_link(conn, &input.account_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseEventInput {
    pub account_id: String,
    pub from_phase: Option<PhaseKey>,
    pub to_phase: PhaseKey,
    pub provider_label: Option<String>,
    /// When the transition happened, if known (ISO 8601 with offset).
    pub occurred_at: Option<String>,
    pub source: PhaseEventSource,
    pub note: Option<String>,
    /// Names the event this one corrects; the corrected event stays stored.
    pub correction_of_event_id: Option<String>,
    pub catalogue_version_id: Option<String>,
    pub programme_phase_id: Option<String>,
    pub phase_path_id: Option<String>,
}

const EVENT: &str = "SELECT id, account_id, from_phase, to_phase, provider_label, occurred_at, recorded_at, source, actor,
        note, correction_of_event_id, catalogue_version_id, programme_phase_id, phase_path_id FROM account_phase_events";

fn event_row(r: &Row) -> rusqlite::Result<AccountPhaseEvent> {
    Ok(AccountPhaseEvent {
        id: r.get(0)?,
        account_id: r.get(1)?,
        from_phase: r.get::<_, Option<String>>(2)?.map(wire).transpose()?,
        to_phase: wire(r.get(3)?)?,
        provider_label: r.get(4)?,
        occurred_at: r.get(5)?,
        recorded_at: r.get(6)?,
        source: wire(r.get(7)?)?,
        actor: wire(r.get(8)?)?,
        note: r.get(9)?,
        correction_of_event_id: r.get(10)?,
        catalogue_version_id: r.get(11)?,
        programme_phase_id: r.get(12)?,
        phase_path_id: r.get(13)?,
    })
}

/// Recording order (then id), which is the order the history applies in. Readable for archived accounts.
pub fn list_phase_events(conn: &Connection, account_id: &str) -> AppResult<Vec<AccountPhaseEvent>> {
    require_account(conn, account_id)?;
    let mut stmt = conn.prepare(&format!("{EVENT} WHERE account_id = ?1 ORDER BY recorded_at, id"))?;
    let rows = stmt.query_map([account_id], event_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Append an event. Phase history is append-only: nothing is edited or deleted, and phase is
/// never inferred from `account_type` or status. The actor is always the user.
pub fn record_phase_event(conn: &mut Connection, input: PhaseEventInput) -> AppResult<AccountPhaseEvent> {
    let mut issues = Issues::default();
    let label = input.provider_label.as_deref().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string);
    let note = input.note.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
    let occurred_at = match input.occurred_at.as_deref().map(parse_payload_time).transpose() {
        Ok(t) => t.map(crate::domain::format_instant),
        Err(m) => {
            issues.add("occurredAt", m);
            None
        }
    };
    if matches!(input.source, PhaseEventSource::System | PhaseEventSource::CatalogueDerived) {
        issues.add("source", "an entry made here is user_entered, imported or unknown");
    }
    issues.into_result()?;

    let id = new_id();
    let tx = conn.transaction()?;
    account_ctx(&tx, &input.account_id)?;
    tx.execute(
        "INSERT INTO account_phase_events (id, account_id, from_phase, to_phase, provider_label, occurred_at, recorded_at,
                                           source, actor, note, correction_of_event_id, catalogue_version_id,
                                           programme_phase_id, phase_path_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'user', ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            input.account_id,
            input.from_phase.as_ref().map(sql_text),
            sql_text(&input.to_phase),
            label,
            occurred_at,
            now(),
            sql_text(&input.source),
            note,
            input.correction_of_event_id,
            input.catalogue_version_id,
            input.programme_phase_id,
            input.phase_path_id
        ],
    )?;
    tx.commit()?;
    Ok(conn.query_row(&format!("{EVENT} WHERE id = ?1"), [&id], event_row)?)
}
