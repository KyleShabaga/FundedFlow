-- FundedFlow migration 13: commercial and provenance snapshots for accounts (Build 9.4).
-- Forward-only; 0001-0012 are unchanged.
--
-- An account may record which commercial offer (and promotion) it was bought
-- under. The row keeps a frozen copy of the terms and their provenance as they
-- stood when it was recorded (`terms_json`: prices with unknown = null and free
-- = 0, dates, the promotion, each source with its verification state, and the
-- version's review state). Later edits to a draft offer, or any new catalogue
-- version, cannot change what the account recorded. The offer and promotion
-- keys are RESTRICT, so a referenced offer cannot be deleted either.
--
-- Commercial terms are kept apart from rules: nothing here is read by any
-- drawdown, loss-limit, consistency or payout calculation.

CREATE TABLE account_offer_selections (
    id                   TEXT PRIMARY KEY,
    account_id           TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    catalogue_version_id TEXT NOT NULL REFERENCES catalogue_versions (id) ON DELETE RESTRICT,
    commercial_offer_id  TEXT NOT NULL REFERENCES commercial_offers (id) ON DELETE RESTRICT,
    promotion_id         TEXT REFERENCES promotions (id) ON DELETE RESTRICT,
    -- When the user bought or activated under these terms.
    selected_at          TEXT NOT NULL CHECK (selected_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    recorded_at          TEXT NOT NULL CHECK (recorded_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    note                 TEXT,
    terms_json           TEXT NOT NULL CHECK (json_valid(terms_json) AND json_type(terms_json) = 'object')
) STRICT;
CREATE INDEX ix_account_offer_selections_account ON account_offer_selections (account_id, selected_at, id);

CREATE TRIGGER trg_account_offer_selections_no_update
BEFORE UPDATE ON account_offer_selections
BEGIN
    SELECT RAISE(ABORT, 'offer selections are append-only; record a new selection');
END;
CREATE TRIGGER trg_account_offer_selections_no_delete
BEFORE DELETE ON account_offer_selections
BEGIN
    SELECT RAISE(ABORT, 'offer selections are append-only; record a new selection');
END;
