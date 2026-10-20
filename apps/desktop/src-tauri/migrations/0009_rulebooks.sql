-- FundedFlow migration 0009: reusable, versioned rulebooks (Build 9.5).
-- Reference: docs/data-model.md#rulebooks, docs/rulebook-migration.md and
-- packages/domain/src/rulebook.
--
-- The legacy account-owned tables from 0001 are renamed, not dropped; the Rust
-- step 10 (`convert_legacy_rulebooks`) converts their rows into these tables
-- and they stay as the read-only record of what was converted. RENAME also
-- rewrites the account_snapshots foreign key and the legacy triggers.
--
-- Conventions as in 0006: STRICT, TEXT ids, UTC instants with milliseconds and
-- 'Z', trading days as YYYY-MM-DD. Rule parameters are the Zod-validated JSON
-- of packages/domain/src/rulebook/rules.ts, checked again in Rust before writing.

ALTER TABLE rulebook_versions RENAME TO legacy_account_rulebook_versions;
ALTER TABLE rules RENAME TO legacy_account_rules;

-- ---------------------------------------------------------------------------
-- Rulebooks and versions
-- ---------------------------------------------------------------------------

-- A catalogue rulebook (owner_account_id NULL) belongs to a provider and is
-- reused by phases and paths. An account-private rulebook holds one account's
-- own rules and goes with the account.
CREATE TABLE rulebooks (
    id               TEXT PRIMARY KEY,
    provider_id      TEXT REFERENCES providers (id) ON DELETE RESTRICT,
    owner_account_id TEXT REFERENCES accounts (id) ON DELETE CASCADE,
    slug             TEXT NOT NULL UNIQUE CHECK (
        length(slug) BETWEEN 1 AND 100 AND slug NOT GLOB '*[^a-z0-9-]*'
        AND slug NOT GLOB '-*' AND slug NOT GLOB '*-' AND slug NOT GLOB '*--*'),
    display_name     TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    description      TEXT,
    record_status    TEXT NOT NULL CHECK (record_status IN ('active', 'archived')),
    created_at       TEXT NOT NULL CHECK (created_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    updated_at       TEXT NOT NULL CHECK (updated_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    CHECK (owner_account_id IS NOT NULL OR provider_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_rulebooks_owner ON rulebooks (owner_account_id);

-- A rulebook's owner and provider never change.
CREATE TRIGGER trg_rulebooks_identity_immutable
BEFORE UPDATE OF id, provider_id, owner_account_id ON rulebooks
WHEN NEW.id IS NOT OLD.id OR NEW.provider_id IS NOT OLD.provider_id
  OR NEW.owner_account_id IS NOT OLD.owner_account_id
BEGIN SELECT RAISE(ABORT, 'rulebook owner and provider are immutable'); END;

CREATE TABLE rulebook_versions (
    id                    TEXT PRIMARY KEY,
    rulebook_id           TEXT NOT NULL REFERENCES rulebooks (id) ON DELETE CASCADE,
    version_number        INTEGER NOT NULL CHECK (version_number >= 1),
    schema_version        INTEGER NOT NULL CHECK (schema_version = 1),
    verification_status   TEXT NOT NULL CHECK (verification_status IN
        ('draft', 'needs_review', 'verified', 'stale', 'superseded', 'rejected')),
    origin                TEXT NOT NULL CHECK (origin IN
        ('catalogue', 'user_authored', 'legacy_manual', 'legacy_template', 'legacy_copied')),
    captured_at           TEXT NOT NULL CHECK (captured_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    effective_from        TEXT CHECK (effective_from IS NULL OR effective_from GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    effective_to          TEXT CHECK (effective_to IS NULL OR effective_to GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    verified_by           TEXT,
    verified_at           TEXT CHECK (verified_at IS NULL OR verified_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    -- The user's own check of a private version; never provider verification.
    user_confirmed_at     TEXT CHECK (user_confirmed_at IS NULL OR user_confirmed_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    change_reason         TEXT,
    supersedes_version_id TEXT,
    record_status         TEXT NOT NULL CHECK (record_status IN ('active', 'archived')),
    created_at            TEXT NOT NULL CHECK (created_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    updated_at            TEXT NOT NULL CHECK (updated_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    UNIQUE (rulebook_id, version_number),
    UNIQUE (id, rulebook_id),
    -- A correction supersedes a version of the same rulebook.
    FOREIGN KEY (supersedes_version_id, rulebook_id) REFERENCES rulebook_versions (id, rulebook_id) ON DELETE RESTRICT,
    CHECK (supersedes_version_id IS NULL OR supersedes_version_id <> id),
    CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
    CHECK (verification_status <> 'verified' OR verified_by IS NOT NULL),
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to > effective_from)
) STRICT;

-- Status changes follow canTransitionVerification (no stale -> needs_review).
-- An account-private version is never provider-verified.
CREATE TRIGGER trg_rb_versions_transition
BEFORE UPDATE OF verification_status ON rulebook_versions
WHEN NEW.verification_status IS NOT OLD.verification_status
 AND NOT ((OLD.verification_status = 'draft' AND NEW.verification_status IN ('needs_review', 'rejected'))
       OR (OLD.verification_status = 'needs_review' AND NEW.verification_status IN ('draft', 'verified', 'rejected'))
       OR (OLD.verification_status = 'verified' AND NEW.verification_status IN ('stale', 'superseded'))
       OR (OLD.verification_status = 'stale' AND NEW.verification_status IN ('verified', 'superseded')))
BEGIN SELECT RAISE(ABORT, 'invalid rulebook version verification transition'); END;

CREATE TRIGGER trg_rb_versions_private_unverified_insert
BEFORE INSERT ON rulebook_versions
WHEN NEW.verification_status IN ('verified', 'stale')
 AND (SELECT owner_account_id FROM rulebooks WHERE id = NEW.rulebook_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'an account-private rulebook version is never provider-verified'); END;
CREATE TRIGGER trg_rb_versions_private_unverified_update
BEFORE UPDATE OF verification_status ON rulebook_versions
WHEN NEW.verification_status IN ('verified', 'stale')
 AND (SELECT owner_account_id FROM rulebooks WHERE id = NEW.rulebook_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'an account-private rulebook version is never provider-verified'); END;

-- Only a never-verified draft is editable. Afterwards the status, the record
-- status and updated_at may change; anything else is a new version.
CREATE TRIGGER trg_rb_versions_frozen
BEFORE UPDATE ON rulebook_versions
WHEN (OLD.verification_status <> 'draft' OR OLD.verified_at IS NOT NULL)
 AND NOT (NEW.id IS OLD.id
          AND NEW.rulebook_id IS OLD.rulebook_id
          AND NEW.version_number IS OLD.version_number
          AND NEW.schema_version IS OLD.schema_version
          AND NEW.origin IS OLD.origin
          AND NEW.captured_at IS OLD.captured_at
          AND NEW.effective_from IS OLD.effective_from
          AND NEW.effective_to IS OLD.effective_to
          AND NEW.user_confirmed_at IS OLD.user_confirmed_at
          AND NEW.change_reason IS OLD.change_reason
          AND NEW.supersedes_version_id IS OLD.supersedes_version_id
          AND NEW.created_at IS OLD.created_at
          AND (NEW.verified_by IS OLD.verified_by AND NEW.verified_at IS OLD.verified_at
               -- The one write of the sign-off, on needs_review -> verified.
               OR (OLD.verified_at IS NULL AND OLD.verification_status = 'needs_review'
                   AND NEW.verification_status = 'verified')))
BEGIN SELECT RAISE(ABORT, 'rulebook version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_rb_versions_frozen_delete
BEFORE DELETE ON rulebook_versions
WHEN (OLD.verification_status <> 'draft' OR OLD.verified_at IS NOT NULL)
 AND (SELECT 1 FROM rulebooks WHERE id = OLD.rulebook_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'rulebook version is frozen; archive it instead'); END;

-- ---------------------------------------------------------------------------
-- Rule definitions and their source claims
-- ---------------------------------------------------------------------------

CREATE TABLE rule_definitions (
    id                       TEXT PRIMARY KEY,
    rulebook_version_id      TEXT NOT NULL REFERENCES rulebook_versions (id) ON DELETE CASCADE,
    rule_key                 TEXT NOT NULL CHECK (length(rule_key) BETWEEN 1 AND 100
        AND rule_key NOT GLOB '*[^a-z0-9_:]*'),
    rule_type                TEXT NOT NULL CHECK (rule_type IN (
        'profit_target', 'daily_loss_limit', 'max_drawdown', 'min_trading_days', 'consistency',
        'max_position_size', 'max_trades_per_day', 'payout_eligibility', 'payout_count_transition',
        'scaling_plan', 'trading_restriction', 'manual_check', 'unknown')),
    parameter_schema_version INTEGER NOT NULL CHECK (parameter_schema_version = 1),
    parameters_json          TEXT NOT NULL CHECK (json_valid(parameters_json) AND json_type(parameters_json) = 'object'),
    provider_label           TEXT,
    display_label            TEXT,
    source_text              TEXT,
    support_status           TEXT NOT NULL CHECK (support_status IN ('supported', 'manual_only', 'unsupported', 'needs_setup')),
    override_kind            TEXT CHECK (override_kind IS NULL OR override_kind = 'personal_limit'),
    display_order            INTEGER NOT NULL CHECK (display_order >= 0),
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL,
    UNIQUE (rulebook_version_id, rule_key),
    CHECK (rule_type NOT IN ('trading_restriction', 'manual_check', 'unknown')
           OR support_status IN ('manual_only', 'unsupported')),
    CHECK (override_kind IS NULL OR provider_label IS NULL)
) STRICT;

CREATE TRIGGER trg_rule_definitions_frozen_insert BEFORE INSERT ON rule_definitions
WHEN EXISTS (SELECT 1 FROM rulebook_versions WHERE id = NEW.rulebook_version_id
             AND (verification_status <> 'draft' OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'rules of a published rulebook version cannot change'); END;
CREATE TRIGGER trg_rule_definitions_frozen_update BEFORE UPDATE ON rule_definitions
WHEN EXISTS (SELECT 1 FROM rulebook_versions WHERE id IN (OLD.rulebook_version_id, NEW.rulebook_version_id)
             AND (verification_status <> 'draft' OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'rules of a published rulebook version cannot change'); END;
CREATE TRIGGER trg_rule_definitions_frozen_delete BEFORE DELETE ON rule_definitions
WHEN EXISTS (SELECT 1 FROM rulebook_versions WHERE id = OLD.rulebook_version_id
             AND (verification_status <> 'draft' OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'rules of a published rulebook version cannot change'); END;

-- Evidence for a rule from one source. A claim's status is reviewed on its
-- own, so a conflict can be recorded against a published version.
CREATE TABLE rule_claims (
    id                 TEXT PRIMARY KEY,
    rule_definition_id TEXT NOT NULL REFERENCES rule_definitions (id) ON DELETE CASCADE,
    source_id          TEXT NOT NULL REFERENCES catalogue_sources (id) ON DELETE RESTRICT,
    field              TEXT,
    origin             TEXT NOT NULL CHECK (origin IN ('observed', 'provider_stated', 'user_entered',
                                                       'extracted_candidate', 'verified_catalogue', 'unknown')),
    provider_text      TEXT,
    claim_status       TEXT NOT NULL CHECK (claim_status IN ('candidate', 'verified', 'rejected', 'stale', 'conflicting')),
    note               TEXT,
    reviewed_by        TEXT,
    reviewed_at        TEXT CHECK (reviewed_at IS NULL OR reviewed_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    created_at         TEXT NOT NULL,
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
    CHECK (claim_status <> 'verified' OR reviewed_by IS NOT NULL)
) STRICT;
CREATE INDEX ix_rule_claims_rule ON rule_claims (rule_definition_id);
CREATE INDEX ix_rule_claims_source ON rule_claims (source_id);

CREATE TRIGGER trg_rule_claims_frozen_insert BEFORE INSERT ON rule_claims
WHEN NEW.claim_status <> 'conflicting'
 AND EXISTS (SELECT 1 FROM rule_definitions d JOIN rulebook_versions v ON v.id = d.rulebook_version_id
             WHERE d.id = NEW.rule_definition_id
               AND (v.verification_status <> 'draft' OR v.verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'only a conflicting claim can be added to a published rulebook version'); END;
CREATE TRIGGER trg_rule_claims_content_immutable BEFORE UPDATE ON rule_claims
WHEN NOT (NEW.id IS OLD.id AND NEW.rule_definition_id IS OLD.rule_definition_id AND NEW.source_id IS OLD.source_id
          AND NEW.field IS OLD.field AND NEW.origin IS OLD.origin AND NEW.provider_text IS OLD.provider_text
          AND NEW.created_at IS OLD.created_at)
BEGIN SELECT RAISE(ABORT, 'a claim records what a source said; only its review can change'); END;
CREATE TRIGGER trg_rule_claims_frozen_delete BEFORE DELETE ON rule_claims
WHEN EXISTS (SELECT 1 FROM rule_definitions d JOIN rulebook_versions v ON v.id = d.rulebook_version_id
             WHERE d.id = OLD.rule_definition_id
               AND (v.verification_status <> 'draft' OR v.verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'claims of a published rulebook version are kept'); END;

-- ---------------------------------------------------------------------------
-- Applicability to catalogue phases and paths
-- ---------------------------------------------------------------------------

CREATE TABLE rule_applicability (
    id                   TEXT PRIMARY KEY,
    rulebook_version_id  TEXT NOT NULL REFERENCES rulebook_versions (id) ON DELETE CASCADE,
    catalogue_version_id TEXT NOT NULL,
    programme_phase_id   TEXT NOT NULL,
    phase_path_id        TEXT,
    -- The phase belongs to the catalogue version, and the path to the phase.
    FOREIGN KEY (programme_phase_id, catalogue_version_id)
        REFERENCES programme_phases (id, catalogue_version_id) ON DELETE RESTRICT,
    FOREIGN KEY (phase_path_id, programme_phase_id)
        REFERENCES phase_paths (id, programme_phase_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX ux_rule_applicability_target
    ON rule_applicability (rulebook_version_id, programme_phase_id, ifnull(phase_path_id, ''));
CREATE INDEX ix_rule_applicability_phase ON rule_applicability (programme_phase_id, phase_path_id);

-- Only a catalogue rulebook of the same provider applies, and only while the
-- version is a draft; publishing reviews the applicability with the rules.
CREATE TRIGGER trg_rule_applicability_check_insert
BEFORE INSERT ON rule_applicability
BEGIN
    SELECT RAISE(ABORT, 'applicability of a published rulebook version cannot change')
    WHERE EXISTS (SELECT 1 FROM rulebook_versions WHERE id = NEW.rulebook_version_id
                  AND (verification_status <> 'draft' OR verified_at IS NOT NULL));
    SELECT RAISE(ABORT, 'an account-private rulebook does not apply to catalogue phases')
    WHERE (SELECT b.owner_account_id FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
           WHERE v.id = NEW.rulebook_version_id) IS NOT NULL;
    SELECT RAISE(ABORT, 'rulebook and catalogue version belong to different providers')
    WHERE (SELECT b.provider_id FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
           WHERE v.id = NEW.rulebook_version_id) IS NOT
          (SELECT pv.provider_id FROM catalogue_versions cv JOIN programme_variants pv ON pv.id = cv.programme_variant_id
           WHERE cv.id = NEW.catalogue_version_id);
END;
CREATE TRIGGER trg_rule_applicability_no_update BEFORE UPDATE ON rule_applicability
BEGIN SELECT RAISE(ABORT, 'applicability rows are replaced, not updated'); END;
CREATE TRIGGER trg_rule_applicability_frozen_delete BEFORE DELETE ON rule_applicability
WHEN EXISTS (SELECT 1 FROM rulebook_versions WHERE id = OLD.rulebook_version_id
             AND (verification_status <> 'draft' OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'applicability of a published rulebook version cannot change'); END;

-- Phase and path rulebook references (0006 columns without a foreign key)
-- must name a catalogue rulebook version that exists.
CREATE TRIGGER trg_programme_phases_rulebook_insert BEFORE INSERT ON programme_phases
WHEN NEW.default_rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    WHERE v.id = NEW.default_rulebook_version_id AND b.owner_account_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'phase rulebook version must be an existing catalogue rulebook version'); END;
CREATE TRIGGER trg_programme_phases_rulebook_update BEFORE UPDATE OF default_rulebook_version_id ON programme_phases
WHEN NEW.default_rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    WHERE v.id = NEW.default_rulebook_version_id AND b.owner_account_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'phase rulebook version must be an existing catalogue rulebook version'); END;
CREATE TRIGGER trg_phase_paths_rulebook_insert BEFORE INSERT ON phase_paths
WHEN NEW.rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    WHERE v.id = NEW.rulebook_version_id AND b.owner_account_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'path rulebook version must be an existing catalogue rulebook version'); END;
CREATE TRIGGER trg_phase_paths_rulebook_update BEFORE UPDATE OF rulebook_version_id ON phase_paths
WHEN NEW.rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    WHERE v.id = NEW.rulebook_version_id AND b.owner_account_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'path rulebook version must be an existing catalogue rulebook version'); END;
CREATE TRIGGER trg_rb_versions_referenced_delete BEFORE DELETE ON rulebook_versions
WHEN EXISTS (SELECT 1 FROM programme_phases WHERE default_rulebook_version_id = OLD.id)
  OR EXISTS (SELECT 1 FROM phase_paths WHERE rulebook_version_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'rulebook version is referenced by a catalogue phase or path'); END;

-- ---------------------------------------------------------------------------
-- Account assignments
-- ---------------------------------------------------------------------------

-- Which version governs an account from a trading day, half-open
-- [effective_from, effective_to). Never switched automatically.
CREATE TABLE account_rulebook_assignments (
    id                     TEXT PRIMARY KEY,
    account_id             TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    -- NO ACTION, not RESTRICT: deleting an account removes its assignments and
    -- private rulebook in one statement, checked at its end.
    rulebook_version_id    TEXT NOT NULL REFERENCES rulebook_versions (id) ON DELETE NO ACTION,
    programme_phase_id     TEXT REFERENCES programme_phases (id) ON DELETE RESTRICT,
    phase_path_id          TEXT,
    account_phase_event_id TEXT REFERENCES account_phase_events (id) ON DELETE RESTRICT,
    effective_from         TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    effective_to           TEXT CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    assigned_at            TEXT NOT NULL CHECK (assigned_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    assignment_source      TEXT NOT NULL CHECK (assignment_source IN
        ('user', 'catalogue_selection', 'legacy_manual', 'legacy_template', 'legacy_copied')),
    FOREIGN KEY (phase_path_id, programme_phase_id) REFERENCES phase_paths (id, programme_phase_id) ON DELETE RESTRICT,
    CHECK (phase_path_id IS NULL OR programme_phase_id IS NOT NULL),
    CHECK (effective_to IS NULL OR effective_to > effective_from)
) STRICT;
CREATE INDEX ix_assignments_account ON account_rulebook_assignments (account_id, effective_from);
CREATE INDEX ix_assignments_version ON account_rulebook_assignments (rulebook_version_id);

-- A new assignment uses an assignable version (a verified catalogue version,
-- or a published private version of the same account) and does not overlap
-- another assignment of the account.
CREATE TRIGGER trg_assignments_check_insert
BEFORE INSERT ON account_rulebook_assignments
BEGIN
    SELECT RAISE(ABORT, 'rulebook version cannot be assigned to this account')
    WHERE NOT EXISTS (
        SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
        WHERE v.id = NEW.rulebook_version_id AND v.record_status = 'active'
          AND ((b.owner_account_id IS NULL AND v.verification_status = 'verified')
               OR (b.owner_account_id = NEW.account_id AND v.verification_status = 'needs_review')));
    SELECT RAISE(ABORT, 'assignment overlaps another rulebook assignment of the account')
    WHERE EXISTS (
        SELECT 1 FROM account_rulebook_assignments a
        WHERE a.account_id = NEW.account_id
          AND (a.effective_to IS NULL OR a.effective_to > NEW.effective_from)
          AND (NEW.effective_to IS NULL OR NEW.effective_to > a.effective_from));
END;

-- Assignments are history: the only change is closing an open one.
CREATE TRIGGER trg_assignments_close_only
BEFORE UPDATE ON account_rulebook_assignments
WHEN NOT (OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
          AND NEW.id IS OLD.id AND NEW.account_id IS OLD.account_id
          AND NEW.rulebook_version_id IS OLD.rulebook_version_id
          AND NEW.programme_phase_id IS OLD.programme_phase_id AND NEW.phase_path_id IS OLD.phase_path_id
          AND NEW.account_phase_event_id IS OLD.account_phase_event_id
          AND NEW.effective_from IS OLD.effective_from AND NEW.assigned_at IS OLD.assigned_at
          AND NEW.assignment_source IS OLD.assignment_source)
BEGIN SELECT RAISE(ABORT, 'rulebook assignments are history; only an open one can be closed'); END;
