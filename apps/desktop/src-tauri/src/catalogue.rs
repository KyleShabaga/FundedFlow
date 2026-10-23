//! Provider catalogue DTOs (Build 9), mirroring the Zod contracts in
//! `packages/domain/src/catalogue`. Field names and enum values are the wire
//! names; unknown fields are rejected like `z.strictObject` (one difference:
//! serde reads a missing nullable field as null, where Zod requires it). Money is
//! canonical decimal text, stored as `*_micros` (`domain::to_micros`).
//!
//! The tables are in `migrations/0006_provider_catalogue.sql`. These structs
//! check the wire shape only; cross-record rules are the schema's
//! constraints and triggers, with `checkCatalogueGraph` as the TypeScript
//! mirror. `parity.rs` round-trips `packages/domain/test/fixtures/catalogue.json`
//! through them, and `db/catalogue_tests.rs` through the database.

// `store::catalogue` reads the catalogue and writes review transitions, account links and
// phase history. Some wire structs are only built by tests and the importer.
#![cfg_attr(not(test), allow(dead_code))]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A `snake_case` enum as its SQL text value.
pub fn sql_text<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(s)) => s,
        other => panic!("not a string enum: {other:?}"),
    }
}

macro_rules! wire_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    };
}

wire_enum!(
    /// Record status of a catalogue entry. Says nothing about a provider's legitimacy.
    RecordStatus { Active, Inactive, Archived, Unknown }
);
wire_enum!(ProgrammeCategory {
    EvaluationToFunded,
    InstantFunding,
    Other,
    Unknown
});
wire_enum!(VerificationStatus {
    Draft,
    NeedsReview,
    Verified,
    Stale,
    Superseded,
    Rejected
});
wire_enum!(ClaimOrigin {
    Observed,
    ProviderStated,
    UserEntered,
    ExtractedCandidate,
    VerifiedCatalogue,
    Unknown
});
wire_enum!(SourceType {
    Official,
    Secondary,
    UserManual,
    Unknown
});
wire_enum!(VersionCreator { Manual, Importer });
wire_enum!(PhaseKey {
    Evaluation,
    SimulatedFunded,
    LiveFunded,
    Other,
    Unknown
});
wire_enum!(PathStatus {
    Active,
    Inactive,
    Archived
});
wire_enum!(BillingModel {
    OneTime,
    Recurring,
    Unknown
});
wire_enum!(AccountFieldSource {
    UserEntered,
    Imported,
    CatalogueDerived,
    Unknown
});
wire_enum!(PhaseEventSource {
    UserEntered,
    Imported,
    CatalogueDerived,
    System,
    Unknown
});
wire_enum!(PhaseEventActor {
    User,
    System,
    Importer
});

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub slug: String,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub website_url: Option<String>,
    pub jurisdiction: Option<String>,
    pub notes: Option<String>,
    pub record_status: RecordStatus,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammeFamily {
    pub id: String,
    pub provider_id: String,
    pub slug: String,
    pub display_name: String,
    pub provider_label: Option<String>,
    pub description: Option<String>,
    pub category: ProgrammeCategory,
    pub record_status: RecordStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// A descriptive variant attribute: text, a flag, or null.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MetadataValue {
    Text(String),
    Flag(bool),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammeVariant {
    pub id: String,
    pub provider_id: String,
    pub programme_family_id: String,
    pub slug: String,
    pub display_name: String,
    pub provider_label: Option<String>,
    pub size_label: Option<String>,
    pub size_amount: Option<String>,
    pub size_currency: Option<String>,
    pub platforms: Vec<String>,
    pub metadata: BTreeMap<String, Option<MetadataValue>>,
    pub record_status: RecordStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceReference {
    pub id: String,
    pub source_type: SourceType,
    pub url: Option<String>,
    pub descriptor: Option<String>,
    pub publisher: Option<String>,
    pub captured_at: String,
    pub published_at: Option<String>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    pub content_hash: Option<String>,
    pub importer_version: Option<String>,
    pub verification_status: VerificationStatus,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldClaim {
    pub field: String,
    pub origin: ClaimOrigin,
    pub source_id: Option<String>,
    pub provider_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogueVersion {
    pub id: String,
    pub programme_variant_id: String,
    pub version_number: i64,
    pub revision_label: Option<String>,
    pub verification_status: VerificationStatus,
    pub captured_at: String,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    pub created_by: VersionCreator,
    pub importer_version: Option<String>,
    pub verified_by: Option<String>,
    pub verified_at: Option<String>,
    pub supersedes_version_id: Option<String>,
    pub correction_reason: Option<String>,
    pub content_hash: Option<String>,
    pub source_ids: Vec<String>,
    pub claims: Vec<FieldClaim>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammePhase {
    pub id: String,
    pub catalogue_version_id: String,
    pub phase_key: PhaseKey,
    pub provider_label: String,
    pub display_order: i64,
    pub default_rulebook_version_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhasePath {
    pub id: String,
    pub programme_phase_id: String,
    pub path_key: String,
    pub provider_label: String,
    pub is_default: bool,
    pub display_order: i64,
    pub record_status: PathStatus,
    pub rulebook_version_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommercialOffer {
    pub id: String,
    pub catalogue_version_id: String,
    pub programme_phase_id: Option<String>,
    pub phase_path_id: Option<String>,
    pub billing_model: BillingModel,
    pub currency: Option<String>,
    pub list_price: Option<String>,
    pub sale_price: Option<String>,
    pub reset_fee: Option<String>,
    pub activation_fee: Option<String>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    pub source_ids: Vec<String>,
}

/// Discount structure, when the source states it (`promotionDiscountSchema`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PromotionDiscount {
    Amount { amount: String, currency: String },
    Percent { percent: String },
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Promotion {
    pub id: String,
    pub provider_id: String,
    pub code: Option<String>,
    pub provider_label: String,
    pub discount: PromotionDiscount,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub verification_status: VerificationStatus,
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionOffer {
    pub promotion_id: String,
    pub commercial_offer_id: String,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
}

/// `CatalogueGraph` in `integrity.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogueGraph {
    pub providers: Vec<Provider>,
    pub programme_families: Vec<ProgrammeFamily>,
    pub programme_variants: Vec<ProgrammeVariant>,
    pub catalogue_versions: Vec<CatalogueVersion>,
    pub programme_phases: Vec<ProgrammePhase>,
    pub phase_paths: Vec<PhasePath>,
    pub commercial_offers: Vec<CommercialOffer>,
    pub promotions: Vec<Promotion>,
    pub promotion_offers: Vec<PromotionOffer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountCatalogueLink {
    pub account_id: String,
    pub provider_id: Option<String>,
    pub programme_variant_id: Option<String>,
    pub catalogue_version_id: Option<String>,
    pub selected_phase_path_id: Option<String>,
    pub parent_account_id: Option<String>,
    pub size_source: AccountFieldSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountPhaseEvent {
    pub id: String,
    pub account_id: String,
    pub from_phase: Option<PhaseKey>,
    pub to_phase: PhaseKey,
    pub provider_label: Option<String>,
    pub occurred_at: Option<String>,
    pub recorded_at: String,
    pub source: PhaseEventSource,
    pub actor: PhaseEventActor,
    pub note: Option<String>,
    pub correction_of_event_id: Option<String>,
    pub catalogue_version_id: Option<String>,
    pub programme_phase_id: Option<String>,
    pub phase_path_id: Option<String>,
}
