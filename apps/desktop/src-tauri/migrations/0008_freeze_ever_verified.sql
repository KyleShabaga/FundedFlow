-- FundedFlow migration 0008: a catalogue version that has ever been verified
-- stays frozen (Build 9 hotfix).
-- Reference: docs/data-model.md#provider-catalogue and packages/domain/src/catalogue.
--
-- 0006 froze versions by their current status, and allowed stale ->
-- needs_review. That path left the frozen set, so a verified version and its
-- phases, paths, offers, claims and sources became editable again, and could
-- then move back to verified keeping the original verified_by / verified_at.
--
-- From here on a version is frozen if its status is reviewed OR verified_at is
-- set. verified_at is itself frozen, so once a version is verified it is
-- frozen for good. A re-review is a new version with supersedes_version_id.
--
-- Rows are not changed; only the triggers are replaced. 0006 is left as shipped.

DROP TRIGGER trg_catalogue_versions_transition;
DROP TRIGGER trg_catalogue_versions_frozen;
DROP TRIGGER trg_catalogue_versions_frozen_delete;
DROP TRIGGER trg_programme_phases_frozen_insert;
DROP TRIGGER trg_programme_phases_frozen_update;
DROP TRIGGER trg_programme_phases_frozen_delete;
DROP TRIGGER trg_phase_paths_frozen_insert;
DROP TRIGGER trg_phase_paths_frozen_update;
DROP TRIGGER trg_phase_paths_frozen_delete;
DROP TRIGGER trg_commercial_offers_frozen_insert;
DROP TRIGGER trg_commercial_offers_frozen_update;
DROP TRIGGER trg_commercial_offers_frozen_delete;
DROP TRIGGER trg_commercial_offer_sources_frozen_insert;
DROP TRIGGER trg_commercial_offer_sources_frozen_delete;
DROP TRIGGER trg_catalogue_version_sources_frozen_insert;
DROP TRIGGER trg_catalogue_version_sources_frozen_delete;
DROP TRIGGER trg_catalogue_field_claims_frozen_insert;
DROP TRIGGER trg_catalogue_field_claims_frozen_update;
DROP TRIGGER trg_catalogue_field_claims_frozen_delete;

-- Transitions follow canTransitionVerification without stale -> needs_review.
-- A version that was verified before this migration and has since been sent
-- back to draft or needs_review may only be rejected: verifying it again would
-- sign off edited content with the original reviewer and time.
CREATE TRIGGER trg_catalogue_versions_transition
BEFORE UPDATE OF verification_status ON catalogue_versions
WHEN NEW.verification_status IS NOT OLD.verification_status
 AND (NOT ((OLD.verification_status = 'draft' AND NEW.verification_status IN ('needs_review', 'rejected'))
        OR (OLD.verification_status = 'needs_review' AND NEW.verification_status IN ('draft', 'verified', 'rejected'))
        OR (OLD.verification_status = 'verified' AND NEW.verification_status IN ('stale', 'superseded'))
        OR (OLD.verification_status = 'stale' AND NEW.verification_status IN ('verified', 'superseded')))
      OR (OLD.verified_at IS NOT NULL AND OLD.verification_status IN ('draft', 'needs_review')
          AND NEW.verification_status <> 'rejected'))
BEGIN
    SELECT RAISE(ABORT, 'invalid catalogue version verification transition');
END;

CREATE TRIGGER trg_catalogue_versions_frozen
BEFORE UPDATE ON catalogue_versions
WHEN (OLD.verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR OLD.verified_at IS NOT NULL)
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
WHEN OLD.verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR OLD.verified_at IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version');
END;

-- Contents follow their version. Deleting a draft version that was never
-- verified still cascades through them (the parent row is already gone, so
-- the lookup finds nothing and the guard does not fire).
CREATE TRIGGER trg_programme_phases_frozen_insert BEFORE INSERT ON programme_phases
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = NEW.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_programme_phases_frozen_update BEFORE UPDATE ON programme_phases
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id IN (OLD.catalogue_version_id, NEW.catalogue_version_id)
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_programme_phases_frozen_delete BEFORE DELETE ON programme_phases
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = OLD.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_phase_paths_frozen_insert BEFORE INSERT ON phase_paths
WHEN EXISTS (SELECT 1 FROM programme_phases p JOIN catalogue_versions v ON v.id = p.catalogue_version_id
             WHERE p.id = NEW.programme_phase_id
               AND (v.verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR v.verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_phase_paths_frozen_update BEFORE UPDATE ON phase_paths
WHEN EXISTS (SELECT 1 FROM programme_phases p JOIN catalogue_versions v ON v.id = p.catalogue_version_id
             WHERE p.id IN (OLD.programme_phase_id, NEW.programme_phase_id)
               AND (v.verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR v.verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_phase_paths_frozen_delete BEFORE DELETE ON phase_paths
WHEN EXISTS (SELECT 1 FROM programme_phases p JOIN catalogue_versions v ON v.id = p.catalogue_version_id
             WHERE p.id = OLD.programme_phase_id
               AND (v.verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR v.verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_commercial_offers_frozen_insert BEFORE INSERT ON commercial_offers
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = NEW.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_commercial_offers_frozen_update BEFORE UPDATE ON commercial_offers
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id IN (OLD.catalogue_version_id, NEW.catalogue_version_id)
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_commercial_offers_frozen_delete BEFORE DELETE ON commercial_offers
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = OLD.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_commercial_offer_sources_frozen_insert BEFORE INSERT ON commercial_offer_sources
WHEN EXISTS (SELECT 1 FROM commercial_offers o JOIN catalogue_versions v ON v.id = o.catalogue_version_id
             WHERE o.id = NEW.commercial_offer_id
               AND (v.verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR v.verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_commercial_offer_sources_frozen_delete BEFORE DELETE ON commercial_offer_sources
WHEN EXISTS (SELECT 1 FROM commercial_offers o JOIN catalogue_versions v ON v.id = o.catalogue_version_id
             WHERE o.id = OLD.commercial_offer_id
               AND (v.verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR v.verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_catalogue_version_sources_frozen_insert BEFORE INSERT ON catalogue_version_sources
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = NEW.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_catalogue_version_sources_frozen_delete BEFORE DELETE ON catalogue_version_sources
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = OLD.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;

CREATE TRIGGER trg_catalogue_field_claims_frozen_insert BEFORE INSERT ON catalogue_field_claims
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = NEW.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_catalogue_field_claims_frozen_update BEFORE UPDATE ON catalogue_field_claims
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id IN (OLD.catalogue_version_id, NEW.catalogue_version_id)
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
CREATE TRIGGER trg_catalogue_field_claims_frozen_delete BEFORE DELETE ON catalogue_field_claims
WHEN EXISTS (SELECT 1 FROM catalogue_versions WHERE id = OLD.catalogue_version_id
             AND (verification_status IN ('verified', 'stale', 'superseded', 'rejected') OR verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'catalogue version is frozen; create a superseding version'); END;
