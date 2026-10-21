-- Build 10.5: phase/path bindings must stay inside their catalogue provider.
-- Existing inconsistent rows are retained as evidence and fail closed in applicable reads.

CREATE TRIGGER trg_programme_phases_rulebook_provider_insert
BEFORE INSERT ON programme_phases
WHEN NEW.default_rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    JOIN catalogue_versions c ON c.id = NEW.catalogue_version_id JOIN programme_variants p ON p.id = c.programme_variant_id
    WHERE v.id = NEW.default_rulebook_version_id AND b.owner_account_id IS NULL AND b.provider_id = p.provider_id)
BEGIN SELECT RAISE(ABORT, 'binding must name an existing catalogue rulebook version for the same provider'); END;

CREATE TRIGGER trg_programme_phases_rulebook_provider_update
BEFORE UPDATE OF default_rulebook_version_id, catalogue_version_id ON programme_phases
WHEN NEW.default_rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    JOIN catalogue_versions c ON c.id = NEW.catalogue_version_id JOIN programme_variants p ON p.id = c.programme_variant_id
    WHERE v.id = NEW.default_rulebook_version_id AND b.owner_account_id IS NULL AND b.provider_id = p.provider_id)
BEGIN SELECT RAISE(ABORT, 'binding must name an existing catalogue rulebook version for the same provider'); END;

CREATE TRIGGER trg_phase_paths_rulebook_provider_insert
BEFORE INSERT ON phase_paths
WHEN NEW.rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    JOIN programme_phases ph ON ph.id = NEW.programme_phase_id JOIN catalogue_versions c ON c.id = ph.catalogue_version_id JOIN programme_variants p ON p.id = c.programme_variant_id
    WHERE v.id = NEW.rulebook_version_id AND b.owner_account_id IS NULL AND b.provider_id = p.provider_id)
BEGIN SELECT RAISE(ABORT, 'binding must name an existing catalogue rulebook version for the same provider'); END;

CREATE TRIGGER trg_phase_paths_rulebook_provider_update
BEFORE UPDATE OF rulebook_version_id, programme_phase_id ON phase_paths
WHEN NEW.rulebook_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rulebook_versions v JOIN rulebooks b ON b.id = v.rulebook_id
    JOIN programme_phases ph ON ph.id = NEW.programme_phase_id JOIN catalogue_versions c ON c.id = ph.catalogue_version_id JOIN programme_variants p ON p.id = c.programme_variant_id
    WHERE v.id = NEW.rulebook_version_id AND b.owner_account_id IS NULL AND b.provider_id = p.provider_id)
BEGIN SELECT RAISE(ABORT, 'binding must name an existing catalogue rulebook version for the same provider'); END;
