-- FundedFlow migration 0006: provider catalogue (Build 10, from the Build 9 contracts).
-- Reference: docs/data-model.md#provider-catalogue and packages/domain/src/catalogue.
--
-- Same conventions as 0001: STRICT tables, UUIDv7 TEXT ids, UTC instants with
-- millisecond precision and a 'Z' suffix, money as INTEGER micro-units. DTO
-- money (canonical decimal text) is stored as *_micros >= 0, where NULL means
-- unknown and 0 means a known zero. Windows are half-open [from, to); every
-- instant has the same fixed-width format, so text comparison orders them.
--
-- Nothing here is filled from the legacy firms/programmes tables; migration 7
-- (a Rust step) maps them. The catalogue is additive: firms, programmes and
-- the accounts columns that point at them are kept unchanged.

-- ---------------------------------------------------------------------------
-- Providers and programmes
-- ---------------------------------------------------------------------------

CREATE TABLE providers (
    id             TEXT PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE CHECK (
        length(slug) BETWEEN 1 AND 100 AND slug NOT GLOB '*[^a-z0-9-]*'
        AND slug NOT GLOB '-*' AND slug NOT GLOB '*-' AND slug NOT GLOB '*--*'),
    display_name   TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    -- JSON array of alternate spellings, matched case-insensitively.
    aliases        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases) AND json_type(aliases) = 'array'),
    website_url    TEXT CHECK (website_url IS NULL OR website_url GLOB 'http://?*' OR website_url GLOB 'https://?*'),
    jurisdiction   TEXT,
    notes          TEXT,
    record_status  TEXT NOT NULL CHECK (record_status IN ('active', 'inactive', 'archived', 'unknown')),
    -- The legacy firm this provider was mapped from (migration 7), if any.
    legacy_firm_id TEXT UNIQUE REFERENCES firms (id) ON DELETE RESTRICT,
    created_at     TEXT NOT NULL CHECK (created_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    updated_at     TEXT NOT NULL CHECK (updated_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    archived_at    TEXT CHECK (archived_at IS NULL OR archived_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE TABLE programme_families (
    id                   TEXT PRIMARY KEY,
    provider_id          TEXT NOT NULL REFERENCES providers (id) ON DELETE RESTRICT,
    slug                 TEXT NOT NULL CHECK (
        length(slug) BETWEEN 1 AND 100 AND slug NOT GLOB '*[^a-z0-9-]*'
        AND slug NOT GLOB '-*' AND slug NOT GLOB '*-' AND slug NOT GLOB '*--*'),
    display_name         TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    provider_label       TEXT CHECK (provider_label IS NULL OR length(trim(provider_label)) > 0),
    description          TEXT,
    category             TEXT NOT NULL
        CHECK (category IN ('evaluation_to_funded', 'instant_funding', 'other', 'unknown')),
    record_status        TEXT NOT NULL CHECK (record_status IN ('active', 'inactive', 'archived', 'unknown')),
    -- The legacy programme this family was mapped from (migration 7), if any.
    legacy_programme_id  TEXT UNIQUE REFERENCES programmes (id) ON DELETE RESTRICT,
    created_at           TEXT NOT NULL CHECK (created_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    updated_at           TEXT NOT NULL CHECK (updated_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    UNIQUE (provider_id, slug),
    UNIQUE (id, provider_id)
) STRICT;

CREATE TABLE programme_variants (
    id                  TEXT PRIMARY KEY,
    provider_id         TEXT NOT NULL REFERENCES providers (id) ON DELETE RESTRICT,
    programme_family_id TEXT NOT NULL,
    slug                TEXT NOT NULL CHECK (
        length(slug) BETWEEN 1 AND 100 AND slug NOT GLOB '*[^a-z0-9-]*'
        AND slug NOT GLOB '-*' AND slug NOT GLOB '*-' AND slug NOT GLOB '*--*'),
    display_name        TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    provider_label      TEXT CHECK (provider_label IS NULL OR length(trim(provider_label)) > 0),
    -- Size as the provider writes it ("50K"); never parsed into the amount.
    size_label          TEXT,
    size_amount_micros  INTEGER CHECK (size_amount_micros IS NULL OR size_amount_micros >= 0),
    size_currency       TEXT CHECK (size_currency IS NULL OR size_currency GLOB '[A-Z][A-Z][A-Z]'),
    platforms           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(platforms) AND json_type(platforms) = 'array'),
    -- Namespaced descriptive attributes ("platform.copy_trading"); never rule terms or prices.
    metadata            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
    record_status       TEXT NOT NULL CHECK (record_status IN ('active', 'inactive', 'archived', 'unknown')),
    created_at          TEXT NOT NULL CHECK (created_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    updated_at          TEXT NOT NULL CHECK (updated_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    -- The family must belong to the same provider.
    FOREIGN KEY (programme_family_id, provider_id)
        REFERENCES programme_families (id, provider_id) ON DELETE RESTRICT,
    UNIQUE (programme_family_id, slug),
    UNIQUE (id, provider_id),
    CHECK ((size_amount_micros IS NULL) = (size_currency IS NULL))
) STRICT;
CREATE INDEX ix_programme_variants_provider ON programme_variants (provider_id);

-- ---------------------------------------------------------------------------
-- Sources and catalogue versions
-- ---------------------------------------------------------------------------

CREATE TABLE catalogue_sources (
    id                  TEXT PRIMARY KEY,
    source_type         TEXT NOT NULL CHECK (source_type IN ('official', 'secondary', 'user_manual', 'unknown')),
    url                 TEXT CHECK (url IS NULL OR url GLOB 'http://?*' OR url GLOB 'https://?*'),
    descriptor          TEXT,
    publisher           TEXT,
    -- When FundedFlow recorded it; never a substitute for effective_from.
    captured_at         TEXT NOT NULL CHECK (captured_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    published_at        TEXT CHECK (published_at IS NULL OR published_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    effective_from      TEXT CHECK (effective_from IS NULL OR effective_from GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    effective_to        TEXT CHECK (effective_to IS NULL OR effective_to GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    content_hash        TEXT CHECK (content_hash IS NULL OR (length(content_hash) = 71
        AND content_hash GLOB 'sha256:*' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*')),
    importer_version    TEXT,
    verification_status TEXT NOT NULL CHECK (verification_status IN
        ('draft', 'needs_review', 'verified', 'stale', 'superseded', 'rejected')),
    reviewed_by         TEXT,
    reviewed_at         TEXT CHECK (reviewed_at IS NULL OR reviewed_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    CHECK (url IS NOT NULL OR length(trim(coalesce(descriptor, ''))) > 0),
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to > effective_from),
    CHECK (verification_status <> 'verified' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
) STRICT;

CREATE TABLE catalogue_versions (
    id                    TEXT PRIMARY KEY,
    programme_variant_id  TEXT NOT NULL REFERENCES programme_variants (id) ON DELETE RESTRICT,
    version_number        INTEGER NOT NULL CHECK (version_number >= 1),
    revision_label        TEXT,
    verification_status   TEXT NOT NULL CHECK (verification_status IN
        ('draft', 'needs_review', 'verified', 'stale', 'superseded', 'rejected')),
    -- When this revision was captured; not its effective date.
    captured_at           TEXT NOT NULL CHECK (captured_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    effective_from        TEXT CHECK (effective_from IS NULL OR effective_from GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    effective_to          TEXT CHECK (effective_to IS NULL OR effective_to GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    created_by            TEXT NOT NULL CHECK (created_by IN ('manual', 'importer')),
    importer_version      TEXT,
    verified_by           TEXT,
    verified_at           TEXT CHECK (verified_at IS NULL OR verified_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    supersedes_version_id TEXT,
    correction_reason     TEXT,
    content_hash          TEXT CHECK (content_hash IS NULL OR (length(content_hash) = 71
        AND content_hash GLOB 'sha256:*' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*')),
    UNIQUE (programme_variant_id, version_number),
    UNIQUE (id, programme_variant_id),
    -- A correction supersedes a version of the same variant.
    FOREIGN KEY (supersedes_version_id, programme_variant_id)
        REFERENCES catalogue_versions (id, programme_variant_id) ON DELETE RESTRICT,
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to > effective_from),
    CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
    CHECK (verification_status <> 'verified' OR verified_by IS NOT NULL),
    CHECK (supersedes_version_id IS NULL
           OR (supersedes_version_id <> id AND length(trim(coalesce(correction_reason, ''))) > 0)),
    CHECK (created_by <> 'importer' OR importer_version IS NOT NULL)
) STRICT;

-- Reviewed versions (verified, stale, superseded, rejected) are frozen: the
-- only permitted change is the status, along canTransitionVerification
-- (packages/domain/src/catalogue/provenance.ts). A correction is a new
-- version with supersedes_version_id. Status changes on unreviewed versions
-- follow the same transitions.
CREATE TRIGGER trg_catalogue_versions_transition
BEFORE UPDATE OF verification_status ON catalogue_versions
WHEN NEW.verification_status IS NOT OLD.verification_status
 AND NOT ((OLD.verification_status = 'draft' AND NEW.verification_status IN ('needs_review', 'rejected'))
       OR (OLD.verification_status = 'needs_review' AND NEW.verification_status IN ('draft', 'verified', 'rejected'))
       OR (OLD.verification_status = 'verified' AND NEW.verification_status IN ('stale', 'superseded'))
       OR (OLD.verification_status = 'stale' AND NEW.verification_status IN ('needs_review', 'verified', 'superseded')))
BEGIN
    SELECT RAISE(ABORT, 'invalid catalogue version verification transition');
END;

CREATE TRIGGER trg_catalogue_versions_frozen
BEFORE UPDATE ON catalogue_versions
WHEN OLD.verification_status IN ('verified', 'stale', 'superseded', 'rejected')
 AND NOT (NEW.id IS OLD.id
          AND NEW.programme_variant_id IS OLD.programme_variant_id
          AND NEW.version_number IS OLD.version_number
          AND NEW.revision_label IS OLD.revision_label
          AND NEW.captured_at IS OLD.captured_at
          AND NEW.effective_from IS OLD.effective_from
          AND NEW.effective_to IS OLD.effective_to
          AND NEW.created_by IS OLD.created_by
          AND NEW.importer_version IS OLD.importer_version
          AND NEW.verified_by IS OLD.verified_by
          AND NEW.verified_at IS OLD.verified_at
          AND NEW.supersedes_version_id IS OLD.supersedes_version_id
          AND NEW.correction_reason IS OLD.correction_reason
          AND NEW.content_hash IS OLD.content_hash)
BEGIN
    SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version');
END;

CREATE TRIGGER trg_catalogue_versions_frozen_delete
BEFORE DELETE ON catalogue_versions
WHEN OLD.verification_status IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN
    SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version');
END;

-- The DTO's sourceIds array.
CREATE TABLE catalogue_version_sources (
    catalogue_version_id TEXT NOT NULL REFERENCES catalogue_versions (id) ON DELETE CASCADE,
    source_id            TEXT NOT NULL REFERENCES catalogue_sources (id) ON DELETE RESTRICT,
    PRIMARY KEY (catalogue_version_id, source_id)
) STRICT;
CREATE INDEX ix_catalogue_version_sources_source ON catalogue_version_sources (source_id);

-- The DTO's claims array, in order.
CREATE TABLE catalogue_field_claims (
    catalogue_version_id TEXT NOT NULL REFERENCES catalogue_versions (id) ON DELETE CASCADE,
    position             INTEGER NOT NULL CHECK (position >= 0),
    -- DTO field path, e.g. 'offers[evaluation].salePrice'.
    field                TEXT NOT NULL CHECK (length(field) > 0),
    origin               TEXT NOT NULL CHECK (origin IN ('observed', 'provider_stated', 'user_entered',
                                                          'extracted_candidate', 'verified_catalogue', 'unknown')),
    source_id            TEXT REFERENCES catalogue_sources (id) ON DELETE RESTRICT,
    -- Exact wording read from the source.
    provider_text        TEXT,
    PRIMARY KEY (catalogue_version_id, position),
    CHECK (origin IN ('unknown', 'user_entered') OR source_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_catalogue_field_claims_source ON catalogue_field_claims (source_id);

-- ---------------------------------------------------------------------------
-- Phases and paths
-- ---------------------------------------------------------------------------

CREATE TABLE programme_phases (
    id                          TEXT PRIMARY KEY,
    catalogue_version_id        TEXT NOT NULL REFERENCES catalogue_versions (id) ON DELETE CASCADE,
    phase_key                   TEXT NOT NULL
        CHECK (phase_key IN ('evaluation', 'simulated_funded', 'live_funded', 'other', 'unknown')),
    provider_label              TEXT NOT NULL CHECK (length(trim(provider_label)) > 0),
    display_order               INTEGER NOT NULL CHECK (display_order >= 0),
    -- Catalogue rulebook version (Build 9.5). No foreign key until that table exists.
    default_rulebook_version_id TEXT,
    UNIQUE (catalogue_version_id, phase_key, provider_label),
    UNIQUE (id, catalogue_version_id)
) STRICT;

CREATE TABLE phase_paths (
    id                  TEXT PRIMARY KEY,
    programme_phase_id  TEXT NOT NULL REFERENCES programme_phases (id) ON DELETE CASCADE,
    path_key            TEXT NOT NULL CHECK (
        length(path_key) BETWEEN 1 AND 100 AND path_key NOT GLOB '*[^a-z0-9-]*'
        AND path_key NOT GLOB '-*' AND path_key NOT GLOB '*-' AND path_key NOT GLOB '*--*'),
    provider_label      TEXT NOT NULL CHECK (length(trim(provider_label)) > 0),
    is_default          INTEGER NOT NULL CHECK (is_default IN (0, 1)),
    display_order       INTEGER NOT NULL CHECK (display_order >= 0),
    record_status       TEXT NOT NULL CHECK (record_status IN ('active', 'inactive', 'archived')),
    -- Overrides the phase's default rulebook version (Build 9.5; no foreign key yet).
    rulebook_version_id TEXT,
    UNIQUE (programme_phase_id, path_key),
    UNIQUE (id, programme_phase_id)
) STRICT;
CREATE UNIQUE INDEX ux_phase_paths_one_default ON phase_paths (programme_phase_id) WHERE is_default = 1;

-- ---------------------------------------------------------------------------
-- Commercial offers and promotions
-- ---------------------------------------------------------------------------

-- Prices and fees never feed drawdown, loss-limit, consistency or payout rules.
CREATE TABLE commercial_offers (
    id                     TEXT PRIMARY KEY,
    catalogue_version_id   TEXT NOT NULL REFERENCES catalogue_versions (id) ON DELETE CASCADE,
    -- NULL for an offer covering the whole variant.
    programme_phase_id     TEXT,
    phase_path_id          TEXT,
    billing_model          TEXT NOT NULL CHECK (billing_model IN ('one_time', 'recurring', 'unknown')),
    currency               TEXT CHECK (currency IS NULL OR currency GLOB '[A-Z][A-Z][A-Z]'),
    -- NULL = unknown, 0 = known zero ("FREE").
    list_price_micros      INTEGER CHECK (list_price_micros IS NULL OR list_price_micros >= 0),
    sale_price_micros      INTEGER CHECK (sale_price_micros IS NULL OR sale_price_micros >= 0),
    reset_fee_micros       INTEGER CHECK (reset_fee_micros IS NULL OR reset_fee_micros >= 0),
    activation_fee_micros  INTEGER CHECK (activation_fee_micros IS NULL OR activation_fee_micros >= 0),
    effective_from         TEXT CHECK (effective_from IS NULL OR effective_from GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    effective_to           TEXT CHECK (effective_to IS NULL OR effective_to GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    -- The phase must belong to the version, and the path to the phase.
    FOREIGN KEY (programme_phase_id, catalogue_version_id)
        REFERENCES programme_phases (id, catalogue_version_id) ON DELETE CASCADE,
    FOREIGN KEY (phase_path_id, programme_phase_id)
        REFERENCES phase_paths (id, programme_phase_id) ON DELETE CASCADE,
    CHECK (phase_path_id IS NULL OR programme_phase_id IS NOT NULL),
    CHECK (currency IS NOT NULL OR (list_price_micros IS NULL AND sale_price_micros IS NULL
                                    AND reset_fee_micros IS NULL AND activation_fee_micros IS NULL)),
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to > effective_from)
) STRICT;
CREATE INDEX ix_commercial_offers_version ON commercial_offers (catalogue_version_id);
CREATE INDEX ix_commercial_offers_phase ON commercial_offers (programme_phase_id);
CREATE INDEX ix_commercial_offers_path ON commercial_offers (phase_path_id);

CREATE TABLE commercial_offer_sources (
    commercial_offer_id TEXT NOT NULL REFERENCES commercial_offers (id) ON DELETE CASCADE,
    source_id           TEXT NOT NULL REFERENCES catalogue_sources (id) ON DELETE RESTRICT,
    PRIMARY KEY (commercial_offer_id, source_id)
) STRICT;
CREATE INDEX ix_commercial_offer_sources_source ON commercial_offer_sources (source_id);

-- Phases, paths, offers, claims and sources of a reviewed version are frozen
-- with it. Deleting a draft version cascades through them (the parent row is
-- already gone, so the status lookup is NULL and the guard does not fire).
CREATE TRIGGER trg_programme_phases_frozen_insert BEFORE INSERT ON programme_phases
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = NEW.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_programme_phases_frozen_update BEFORE UPDATE ON programme_phases
WHEN (SELECT verification_status FROM catalogue_versions WHERE id IN (OLD.catalogue_version_id, NEW.catalogue_version_id)
      AND verification_status IN ('verified', 'stale', 'superseded', 'rejected')) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_programme_phases_frozen_delete BEFORE DELETE ON programme_phases
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = OLD.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_phase_paths_frozen_insert BEFORE INSERT ON phase_paths
WHEN (SELECT v.verification_status FROM programme_phases p JOIN catalogue_versions v ON v.id = p.catalogue_version_id
      WHERE p.id = NEW.programme_phase_id) IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_phase_paths_frozen_update BEFORE UPDATE ON phase_paths
WHEN (SELECT v.verification_status FROM programme_phases p JOIN catalogue_versions v ON v.id = p.catalogue_version_id
      WHERE p.id IN (OLD.programme_phase_id, NEW.programme_phase_id)
        AND v.verification_status IN ('verified', 'stale', 'superseded', 'rejected')) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_phase_paths_frozen_delete BEFORE DELETE ON phase_paths
WHEN (SELECT v.verification_status FROM programme_phases p JOIN catalogue_versions v ON v.id = p.catalogue_version_id
      WHERE p.id = OLD.programme_phase_id) IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_commercial_offers_frozen_insert BEFORE INSERT ON commercial_offers
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = NEW.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_commercial_offers_frozen_update BEFORE UPDATE ON commercial_offers
WHEN (SELECT verification_status FROM catalogue_versions WHERE id IN (OLD.catalogue_version_id, NEW.catalogue_version_id)
      AND verification_status IN ('verified', 'stale', 'superseded', 'rejected')) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_commercial_offers_frozen_delete BEFORE DELETE ON commercial_offers
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = OLD.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_commercial_offer_sources_frozen_insert BEFORE INSERT ON commercial_offer_sources
WHEN (SELECT v.verification_status FROM commercial_offers o JOIN catalogue_versions v ON v.id = o.catalogue_version_id
      WHERE o.id = NEW.commercial_offer_id) IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_commercial_offer_sources_frozen_update BEFORE UPDATE ON commercial_offer_sources
BEGIN SELECT RAISE(ABORT, 'offer sources are replaced, not updated'); END;
CREATE TRIGGER trg_commercial_offer_sources_frozen_delete BEFORE DELETE ON commercial_offer_sources
WHEN (SELECT v.verification_status FROM commercial_offers o JOIN catalogue_versions v ON v.id = o.catalogue_version_id
      WHERE o.id = OLD.commercial_offer_id) IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_catalogue_version_sources_frozen_insert BEFORE INSERT ON catalogue_version_sources
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = NEW.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_catalogue_version_sources_frozen_update BEFORE UPDATE ON catalogue_version_sources
BEGIN SELECT RAISE(ABORT, 'version sources are replaced, not updated'); END;
CREATE TRIGGER trg_catalogue_version_sources_frozen_delete BEFORE DELETE ON catalogue_version_sources
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = OLD.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_catalogue_field_claims_frozen_insert BEFORE INSERT ON catalogue_field_claims
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = NEW.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_catalogue_field_claims_frozen_update BEFORE UPDATE ON catalogue_field_claims
WHEN (SELECT verification_status FROM catalogue_versions WHERE id IN (OLD.catalogue_version_id, NEW.catalogue_version_id)
      AND verification_status IN ('verified', 'stale', 'superseded', 'rejected')) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_catalogue_field_claims_frozen_delete BEFORE DELETE ON catalogue_field_claims
WHEN (SELECT verification_status FROM catalogue_versions WHERE id = OLD.catalogue_version_id)
     IN ('verified', 'stale', 'superseded', 'rejected')
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

-- A provider-scoped promotion. The discount columns follow discount_kind.
CREATE TABLE promotions (
    id                      TEXT PRIMARY KEY,
    provider_id             TEXT NOT NULL REFERENCES providers (id) ON DELETE RESTRICT,
    code                    TEXT CHECK (code IS NULL OR length(code) > 0),
    provider_label          TEXT NOT NULL CHECK (length(trim(provider_label)) > 0),
    discount_kind           TEXT NOT NULL CHECK (discount_kind IN ('amount', 'percent', 'unknown')),
    discount_amount_micros  INTEGER CHECK (discount_amount_micros IS NULL OR discount_amount_micros >= 0),
    discount_currency       TEXT CHECK (discount_currency IS NULL OR discount_currency GLOB '[A-Z][A-Z][A-Z]'),
    -- Percent in micro-units: 12.5% = 12_500_000; 0 < p <= 100.
    discount_percent_micros INTEGER CHECK (discount_percent_micros IS NULL
                                           OR discount_percent_micros BETWEEN 1 AND 100000000),
    valid_from              TEXT CHECK (valid_from IS NULL OR valid_from GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    valid_to                TEXT CHECK (valid_to IS NULL OR valid_to GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    verification_status     TEXT NOT NULL CHECK (verification_status IN
        ('draft', 'needs_review', 'verified', 'stale', 'superseded', 'rejected')),
    CHECK (CASE discount_kind
        WHEN 'amount' THEN discount_amount_micros IS NOT NULL AND discount_currency IS NOT NULL
                           AND discount_percent_micros IS NULL
        WHEN 'percent' THEN discount_percent_micros IS NOT NULL
                            AND discount_amount_micros IS NULL AND discount_currency IS NULL
        ELSE discount_amount_micros IS NULL AND discount_currency IS NULL AND discount_percent_micros IS NULL
    END),
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to > valid_from)
) STRICT;
CREATE INDEX ix_promotions_provider ON promotions (provider_id);

CREATE TABLE promotion_sources (
    promotion_id TEXT NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
    source_id    TEXT NOT NULL REFERENCES catalogue_sources (id) ON DELETE RESTRICT,
    PRIMARY KEY (promotion_id, source_id)
) STRICT;
CREATE INDEX ix_promotion_sources_source ON promotion_sources (source_id);

CREATE TABLE promotion_offers (
    promotion_id        TEXT NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
    commercial_offer_id TEXT NOT NULL REFERENCES commercial_offers (id) ON DELETE CASCADE,
    valid_from          TEXT CHECK (valid_from IS NULL OR valid_from GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    valid_to            TEXT CHECK (valid_to IS NULL OR valid_to GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    PRIMARY KEY (promotion_id, commercial_offer_id),
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to > valid_from)
) STRICT;
CREATE INDEX ix_promotion_offers_offer ON promotion_offers (commercial_offer_id);

-- checkCatalogueGraph: a promotion applies only to its own provider's offers,
-- and the link, promotion and offer windows must all overlap (open bounds
-- overlap everything). Checked when the link is written.
CREATE TRIGGER trg_promotion_offers_check_insert
BEFORE INSERT ON promotion_offers
BEGIN
    SELECT RAISE(ABORT, 'promotion and offer belong to different providers')
    WHERE (SELECT provider_id FROM promotions WHERE id = NEW.promotion_id) IS NOT
          (SELECT pv.provider_id FROM commercial_offers o
             JOIN catalogue_versions cv ON cv.id = o.catalogue_version_id
             JOIN programme_variants pv ON pv.id = cv.programme_variant_id
           WHERE o.id = NEW.commercial_offer_id);
    SELECT RAISE(ABORT, 'promotion, offer and link windows do not overlap')
    FROM promotions p, commercial_offers o
    WHERE p.id = NEW.promotion_id AND o.id = NEW.commercial_offer_id
      AND (NEW.valid_to <= p.valid_from OR p.valid_to <= NEW.valid_from
        OR NEW.valid_to <= o.effective_from OR o.effective_to <= NEW.valid_from
        OR p.valid_to <= o.effective_from OR o.effective_to <= p.valid_from);
END;

CREATE TRIGGER trg_promotion_offers_check_update
BEFORE UPDATE ON promotion_offers
BEGIN
    SELECT RAISE(ABORT, 'promotion and offer belong to different providers')
    WHERE (SELECT provider_id FROM promotions WHERE id = NEW.promotion_id) IS NOT
          (SELECT pv.provider_id FROM commercial_offers o
             JOIN catalogue_versions cv ON cv.id = o.catalogue_version_id
             JOIN programme_variants pv ON pv.id = cv.programme_variant_id
           WHERE o.id = NEW.commercial_offer_id);
    SELECT RAISE(ABORT, 'promotion, offer and link windows do not overlap')
    FROM promotions p, commercial_offers o
    WHERE p.id = NEW.promotion_id AND o.id = NEW.commercial_offer_id
      AND (NEW.valid_to <= p.valid_from OR p.valid_to <= NEW.valid_from
        OR NEW.valid_to <= o.effective_from OR o.effective_to <= NEW.valid_from
        OR p.valid_to <= o.effective_from OR o.effective_to <= p.valid_from);
END;

-- ---------------------------------------------------------------------------
-- Account catalogue links
-- ---------------------------------------------------------------------------

-- All nullable: legacy, manual-only and unknown-programme accounts stay valid.
-- firm_id, programme_id and parent_account_id are unchanged. provider_id is
-- backfilled from firm_id by migration 7; the variant, version and path are
-- never backfilled, because a catalogue match must be chosen, not guessed.
ALTER TABLE accounts ADD COLUMN provider_id TEXT REFERENCES providers (id) ON DELETE RESTRICT;
ALTER TABLE accounts ADD COLUMN programme_variant_id TEXT REFERENCES programme_variants (id) ON DELETE RESTRICT;
-- The exact version selected; a later version never replaces it silently.
ALTER TABLE accounts ADD COLUMN catalogue_version_id TEXT REFERENCES catalogue_versions (id) ON DELETE RESTRICT;
ALTER TABLE accounts ADD COLUMN selected_phase_path_id TEXT REFERENCES phase_paths (id) ON DELETE RESTRICT;
-- Where account_size_micros came from (AccountCatalogueLink.sizeSource).
ALTER TABLE accounts ADD COLUMN size_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (size_source IN ('user_entered', 'imported', 'catalogue_derived', 'unknown'));
CREATE INDEX ix_accounts_provider ON accounts (provider_id);
CREATE INDEX ix_accounts_programme_variant ON accounts (programme_variant_id);
CREATE INDEX ix_accounts_catalogue_version ON accounts (catalogue_version_id);
CREATE INDEX ix_accounts_selected_phase_path ON accounts (selected_phase_path_id);

-- checkAccountCatalogueLink: the variant belongs to the provider, the version
-- to the variant and the path to the version. (ALTER TABLE cannot add the
-- composite foreign keys that express this, so triggers do.)
CREATE TRIGGER trg_accounts_catalogue_link_insert
BEFORE INSERT ON accounts
WHEN NEW.provider_id IS NOT NULL OR NEW.programme_variant_id IS NOT NULL
  OR NEW.catalogue_version_id IS NOT NULL OR NEW.selected_phase_path_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'account programme variant is not one of its provider''s')
    WHERE NEW.programme_variant_id IS NOT NULL AND NEW.provider_id IS NOT
          (SELECT provider_id FROM programme_variants WHERE id = NEW.programme_variant_id);
    SELECT RAISE(ABORT, 'account catalogue version is not one of its programme variant''s')
    WHERE NEW.catalogue_version_id IS NOT NULL AND NEW.programme_variant_id IS NOT
          (SELECT programme_variant_id FROM catalogue_versions WHERE id = NEW.catalogue_version_id);
    SELECT RAISE(ABORT, 'account phase path is not in its catalogue version')
    WHERE NEW.selected_phase_path_id IS NOT NULL AND NEW.catalogue_version_id IS NOT
          (SELECT p.catalogue_version_id FROM phase_paths pp JOIN programme_phases p ON p.id = pp.programme_phase_id
           WHERE pp.id = NEW.selected_phase_path_id);
END;

CREATE TRIGGER trg_accounts_catalogue_link_update
BEFORE UPDATE OF provider_id, programme_variant_id, catalogue_version_id, selected_phase_path_id ON accounts
BEGIN
    SELECT RAISE(ABORT, 'account programme variant is not one of its provider''s')
    WHERE NEW.programme_variant_id IS NOT NULL AND NEW.provider_id IS NOT
          (SELECT provider_id FROM programme_variants WHERE id = NEW.programme_variant_id);
    SELECT RAISE(ABORT, 'account catalogue version is not one of its programme variant''s')
    WHERE NEW.catalogue_version_id IS NOT NULL AND NEW.programme_variant_id IS NOT
          (SELECT programme_variant_id FROM catalogue_versions WHERE id = NEW.catalogue_version_id);
    SELECT RAISE(ABORT, 'account phase path is not in its catalogue version')
    WHERE NEW.selected_phase_path_id IS NOT NULL AND NEW.catalogue_version_id IS NOT
          (SELECT p.catalogue_version_id FROM phase_paths pp JOIN programme_phases p ON p.id = pp.programme_phase_id
           WHERE pp.id = NEW.selected_phase_path_id);
END;

-- ---------------------------------------------------------------------------
-- Account phase history
-- ---------------------------------------------------------------------------

-- Append-only. A correction is a new event naming the one it corrects; the
-- current phase is derived (derivePhaseHistory), never stored. Phase is
-- separate from accounts.status, and no event is inferred from the legacy
-- accounts.account_type. RESTRICT: an account with phase history cannot be
-- hard-deleted (the app archives accounts; Build 24 owns permanent delete).
CREATE TABLE account_phase_events (
    id                     TEXT PRIMARY KEY,
    account_id             TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    from_phase             TEXT CHECK (from_phase IS NULL
        OR from_phase IN ('evaluation', 'simulated_funded', 'live_funded', 'other', 'unknown')),
    to_phase               TEXT NOT NULL
        CHECK (to_phase IN ('evaluation', 'simulated_funded', 'live_funded', 'other', 'unknown')),
    provider_label         TEXT CHECK (provider_label IS NULL OR length(trim(provider_label)) > 0),
    occurred_at            TEXT CHECK (occurred_at IS NULL OR occurred_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    -- Events apply in recording order (then id).
    recorded_at            TEXT NOT NULL CHECK (recorded_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    source                 TEXT NOT NULL
        CHECK (source IN ('user_entered', 'imported', 'catalogue_derived', 'system', 'unknown')),
    actor                  TEXT NOT NULL CHECK (actor IN ('user', 'system', 'importer')),
    note                   TEXT,
    correction_of_event_id TEXT,
    -- Snapshot of the configuration active at the transition.
    catalogue_version_id   TEXT REFERENCES catalogue_versions (id) ON DELETE RESTRICT,
    programme_phase_id     TEXT,
    phase_path_id          TEXT,
    UNIQUE (id, account_id),
    -- A correction names an earlier event of the same account.
    FOREIGN KEY (correction_of_event_id, account_id)
        REFERENCES account_phase_events (id, account_id) ON DELETE RESTRICT,
    FOREIGN KEY (programme_phase_id, catalogue_version_id)
        REFERENCES programme_phases (id, catalogue_version_id) ON DELETE RESTRICT,
    FOREIGN KEY (phase_path_id, programme_phase_id)
        REFERENCES phase_paths (id, programme_phase_id) ON DELETE RESTRICT,
    CHECK (correction_of_event_id IS NULL OR correction_of_event_id <> id),
    CHECK (phase_path_id IS NULL OR programme_phase_id IS NOT NULL),
    CHECK (programme_phase_id IS NULL OR catalogue_version_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_account_phase_events_account ON account_phase_events (account_id, recorded_at, id);

CREATE TRIGGER trg_account_phase_events_no_update
BEFORE UPDATE ON account_phase_events
BEGIN
    SELECT RAISE(ABORT, 'phase history is append-only; record a correcting event');
END;

CREATE TRIGGER trg_account_phase_events_no_delete
BEFORE DELETE ON account_phase_events
BEGIN
    SELECT RAISE(ABORT, 'phase history is append-only; record a correcting event');
END;
