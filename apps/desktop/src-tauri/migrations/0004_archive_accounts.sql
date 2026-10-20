-- FundedFlow migration 0004: accounts are archived, never hard-deleted by the
-- app. Reference: docs/data-model.md#relationships-and-delete-behaviour

-- Set when the user archives the account. Archived accounts are hidden and
-- read-only; their trades, journal entries and imports are kept.
ALTER TABLE accounts ADD COLUMN archived_at TEXT;

-- An archived account must not block re-adding the same broker account number.
DROP INDEX ux_accounts_broker_ref;
CREATE UNIQUE INDEX ux_accounts_broker_ref
    ON accounts (broker COLLATE NOCASE, external_ref)
    WHERE external_ref IS NOT NULL AND archived_at IS NULL;
