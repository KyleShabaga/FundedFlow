//! Account offer selections (Build 9.4): which commercial offer and promotion an
//! account was bought under, with a frozen copy of the terms and provenance.
//! Append-only. Commercial terms never feed rule calculations.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::catalogue;
use super::{account_ctx, require_account};
use crate::domain::{format_instant, new_id, now, parse_payload_time};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfferSelectionInput {
    pub account_id: String,
    pub commercial_offer_id: String,
    pub promotion_id: Option<String>,
    /// When the user bought or activated under these terms. Defaults to now.
    pub selected_at: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferSelection {
    pub id: String,
    pub account_id: String,
    pub catalogue_version_id: String,
    pub commercial_offer_id: String,
    pub promotion_id: Option<String>,
    pub selected_at: String,
    pub recorded_at: String,
    pub note: Option<String>,
    /// The terms as they stood when recorded: the offer (null price = unknown, "0" = free), the
    /// promotion, each source with its verification state, and the version's review state.
    pub terms: serde_json::Value,
}

const SELECT: &str = "SELECT id, account_id, catalogue_version_id, commercial_offer_id, promotion_id, selected_at,
        recorded_at, note, terms_json FROM account_offer_selections";

fn from_row(r: &rusqlite::Row) -> rusqlite::Result<OfferSelection> {
    let text: String = r.get(8)?;
    Ok(OfferSelection {
        id: r.get(0)?,
        account_id: r.get(1)?,
        catalogue_version_id: r.get(2)?,
        commercial_offer_id: r.get(3)?,
        promotion_id: r.get(4)?,
        selected_at: r.get(5)?,
        recorded_at: r.get(6)?,
        note: r.get(7)?,
        terms: serde_json::from_str(&text)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(e)))?,
    })
}

/// Readable for archived accounts. Oldest first.
pub fn list(conn: &Connection, account_id: &str) -> AppResult<Vec<OfferSelection>> {
    require_account(conn, account_id)?;
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE account_id = ?1 ORDER BY selected_at, id"))?;
    let rows = stmt.query_map([account_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Record the offer an account was bought under. The offer must belong to the account's selected
/// catalogue version (and to its selected path when the offer names one); a promotion must be its
/// provider's, linked to that offer, and valid on the selection date. Nothing is inferred: an
/// account with no catalogue version cannot select an offer.
pub fn select(conn: &mut Connection, input: OfferSelectionInput) -> AppResult<OfferSelection> {
    let selected_at = match input.selected_at.as_deref() {
        None => now(),
        Some(s) => format_instant(parse_payload_time(s).map_err(|m| AppError::invalid("selectedAt", m))?),
    };
    let note = input.note.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
    if note.as_ref().is_some_and(|n| n.chars().count() > 2_000) {
        return Err(AppError::invalid("note", "must be at most 2000 characters"));
    }
    let tx = conn.transaction()?;
    account_ctx(&tx, &input.account_id)?;
    let (provider, version, path): (Option<String>, Option<String>, Option<String>) = tx.query_row(
        "SELECT provider_id, catalogue_version_id, selected_phase_path_id FROM accounts WHERE id = ?1",
        [&input.account_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let version = version.ok_or_else(|| {
        AppError::invalid("commercialOfferId", "select the account's catalogue version before recording an offer")
    })?;

    let snapshot = catalogue::load(&tx)?;
    let offer = snapshot
        .graph
        .commercial_offers
        .iter()
        .find(|o| o.id == input.commercial_offer_id)
        .ok_or_else(|| AppError::invalid("commercialOfferId", "unknown commercial offer"))?;
    if offer.catalogue_version_id != version {
        return Err(AppError::invalid("commercialOfferId", "the offer belongs to a different catalogue version than the account's"));
    }
    if offer.phase_path_id.is_some() && offer.phase_path_id != path {
        return Err(AppError::invalid("commercialOfferId", "the offer is for a different path than the account's selected one"));
    }
    // Instants are stored in one fixed format, so text order is time order. Open bounds overlap everything.
    let inside = |from: &Option<String>, to: &Option<String>| {
        from.as_ref().is_none_or(|f| *f <= selected_at) && to.as_ref().is_none_or(|t| selected_at < *t)
    };
    if !inside(&offer.effective_from, &offer.effective_to) {
        return Err(AppError::invalid("selectedAt", "the offer was not in effect on the selection date"));
    }

    let promotion = match &input.promotion_id {
        None => None,
        Some(id) => {
            let p = snapshot
                .graph
                .promotions
                .iter()
                .find(|p| &p.id == id)
                .ok_or_else(|| AppError::invalid("promotionId", "unknown promotion"))?;
            if Some(&p.provider_id) != provider.as_ref() {
                return Err(AppError::invalid("promotionId", "the promotion belongs to a different provider"));
            }
            let link = snapshot
                .graph
                .promotion_offers
                .iter()
                .find(|l| &l.promotion_id == id && l.commercial_offer_id == offer.id)
                .ok_or_else(|| AppError::invalid("promotionId", "the promotion does not apply to this offer"))?;
            if !inside(&p.valid_from, &p.valid_to) || !inside(&link.valid_from, &link.valid_to) {
                return Err(AppError::invalid("promotionId", "the promotion was not valid on the selection date"));
            }
            Some((p, link))
        }
    };

    let sources: Vec<_> = {
        let mut ids: Vec<&String> = offer.source_ids.iter().collect();
        if let Some((p, _)) = &promotion {
            ids.extend(p.source_ids.iter());
        }
        ids.sort();
        ids.dedup();
        ids.into_iter().filter_map(|id| snapshot.sources.iter().find(|s| &s.id == id)).collect()
    };
    let version_row = snapshot.graph.catalogue_versions.iter().find(|v| v.id == version);
    let terms = serde_json::json!({
        "offer": offer,
        "promotion": promotion.as_ref().map(|(p, _)| p),
        "promotionOfferWindow": promotion.as_ref().map(|(_, l)| l),
        "sources": sources,
        "catalogueVersion": version_row.map(|v| serde_json::json!({
            "id": v.id,
            "versionNumber": v.version_number,
            "verificationStatus": v.verification_status,
            "verifiedBy": v.verified_by,
            "verifiedAt": v.verified_at,
            "contentHash": v.content_hash,
        })),
    });

    let id = new_id();
    tx.execute(
        "INSERT INTO account_offer_selections (id, account_id, catalogue_version_id, commercial_offer_id, promotion_id,
                                               selected_at, recorded_at, note, terms_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            input.account_id,
            version,
            offer.id,
            input.promotion_id,
            selected_at,
            now(),
            note,
            serde_json::to_string(&terms).map_err(|e| AppError::Database { message: e.to_string() })?
        ],
    )?;
    let saved = tx.query_row(&format!("{SELECT} WHERE id = ?1"), [&id], from_row).optional()?;
    tx.commit()?;
    saved.ok_or_else(|| AppError::not_found("offer selection", &id))
}
