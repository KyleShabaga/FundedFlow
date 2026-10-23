-- FundedFlow migration 23: frozen risk sources (TASK-045, D-ARCH / ISSUE-002c).
-- Forward-only; 0001-0022 are unchanged. Reference: docs/data-model.md#frozen-risk-sources
--
-- Every engine calculation (account_snapshots) froze a full copy of its account's source lists (trades,
-- observations, ledger, ...) in explanation_json, so the journal grew with trades x calculations. From this
-- version each distinct record version is stored once per account (risk_frozen_records), and which versions
-- were in each list at each generation is recorded as spans (risk_frozen_spans). A calculation stored in the
-- `frozen-v1` form names its generation instead of repeating the lists; reading it rebuilds exactly the
-- explanation it was saved with (store/frozen_v1.rs).
--
-- Both tables are append-only while their account exists: records never change, and a span only closes
-- (to_generation NULL -> a later generation) once. Deleting the account removes them with it.
--
-- The Rust step that runs this file then rewrites existing eligible calculations into the compact form
-- (migration rule exceptions OD-7(1) and OD-7(2), approved by the owner for this migration only).

CREATE TABLE risk_frozen_records (
    account_id  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('assignments', 'ledger', 'ledgerHistory', 'observations',
                                              'phaseHistory', 'rulebookVersions', 'trades')),
    -- sha256 (lowercase hex) of record_json.
    record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
    -- The record exactly as the calculation froze it, as canonical engine JSON.
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    PRIMARY KEY (account_id, kind, record_hash)
) STRICT;

CREATE TABLE risk_frozen_spans (
    account_id      TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    record_hash     TEXT NOT NULL,
    -- The record version is in the list from this generation ...
    from_generation INTEGER NOT NULL CHECK (from_generation >= 1),
    -- ... until (not including) this one; NULL while it is still in the account's latest list.
    to_generation   INTEGER CHECK (to_generation IS NULL OR to_generation > from_generation),
    -- How many times the list holds this exact record version.
    multiplicity    INTEGER NOT NULL CHECK (multiplicity >= 1),
    PRIMARY KEY (account_id, kind, record_hash, from_generation),
    FOREIGN KEY (account_id, kind, record_hash)
        REFERENCES risk_frozen_records (account_id, kind, record_hash) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER risk_frozen_record_no_update BEFORE UPDATE ON risk_frozen_records
BEGIN SELECT RAISE(ABORT, 'frozen risk records are immutable'); END;

CREATE TRIGGER risk_frozen_record_no_delete BEFORE DELETE ON risk_frozen_records
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id)
BEGIN SELECT RAISE(ABORT, 'frozen risk records are immutable'); END;

CREATE TRIGGER risk_frozen_span_close_once BEFORE UPDATE ON risk_frozen_spans
WHEN OLD.to_generation IS NOT NULL OR NEW.to_generation IS NULL
  OR NEW.account_id IS NOT OLD.account_id OR NEW.kind IS NOT OLD.kind OR NEW.record_hash IS NOT OLD.record_hash
  OR NEW.from_generation IS NOT OLD.from_generation OR NEW.multiplicity IS NOT OLD.multiplicity
BEGIN SELECT RAISE(ABORT, 'a frozen span only closes, once'); END;

CREATE TRIGGER risk_frozen_span_no_delete BEFORE DELETE ON risk_frozen_spans
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id)
BEGIN SELECT RAISE(ABORT, 'frozen spans are immutable'); END;
