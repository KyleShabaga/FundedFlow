-- FundedFlow migration 0011: account lifecycle. Forward-only; 0001-0010 are unchanged.
-- Reference: docs/data-model.md#account-lifecycle-attempts-archive-and-history
--
-- 1. A failed (or passed, or closed) account stays a full account. Its status
--    changes are history rows, and a status change may carry a user-entered cause.
-- 2. An evaluation reset starts a NEW account (new id) linked to the attempt it
--    follows. `parent_account_id` keeps its meaning (evaluation -> funded
--    successor); a reset is a different relationship and has its own table.
-- 3. A broker account number is unique among accounts that can still trade
--    (active or paused, not archived). Failed, passed, closed and archived
--    attempts keep their number, so a provider may reuse it for the next attempt.
-- 4. Archiving and restoring are recorded.

-- Why the status changed, as the user entered it. NULL means unknown; nothing
-- is inferred from losses or rule breaches. The existing `note` holds evidence.
ALTER TABLE account_status_events ADD COLUMN cause TEXT
    CHECK (cause IS NULL OR length(cause) <= 500);

DROP INDEX ux_accounts_broker_ref;
CREATE UNIQUE INDEX ux_accounts_broker_ref
    ON accounts (broker COLLATE NOCASE, external_ref)
    WHERE external_ref IS NOT NULL AND archived_at IS NULL AND status IN ('active', 'paused');

CREATE TABLE account_attempt_links (
    id                     TEXT PRIMARY KEY,
    predecessor_account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    successor_account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    link_kind              TEXT NOT NULL DEFAULT 'evaluation_reset' CHECK (link_kind IN ('evaluation_reset')),
    -- The user's confirmed outcome of the predecessor; never inferred.
    prior_outcome          TEXT NOT NULL CHECK (prior_outcome IN ('passed', 'failed', 'closed')),
    effective_at           TEXT NOT NULL,
    reason                 TEXT CHECK (reason IS NULL OR length(reason) <= 500),
    source                 TEXT NOT NULL CHECK (source IN ('user_entered', 'provider_email', 'provider_dashboard', 'other')),
    -- Whether a rulebook was assigned to the successor at creation or the
    -- user chose to decide later. An undecided attempt shows no rule meter.
    rulebook_decision      TEXT NOT NULL CHECK (rulebook_decision IN ('assigned', 'deferred')),
    created_at             TEXT NOT NULL,
    CHECK (predecessor_account_id <> successor_account_id),
    -- An attempt has at most one predecessor and one successor.
    UNIQUE (predecessor_account_id),
    UNIQUE (successor_account_id)
) STRICT;

-- Append-only, like account_phase_events. RESTRICT on both keys means an
-- account in a chain cannot be hard-deleted until permanent delete (Build 24)
-- defines what happens to its neighbours.
CREATE TRIGGER trg_account_attempt_links_no_update
BEFORE UPDATE ON account_attempt_links
BEGIN
    SELECT RAISE(ABORT, 'account attempt links are append-only');
END;
CREATE TRIGGER trg_account_attempt_links_no_delete
BEFORE DELETE ON account_attempt_links
BEGIN
    SELECT RAISE(ABORT, 'account attempt links are append-only');
END;

CREATE TABLE account_archive_events (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    action      TEXT NOT NULL CHECK (action IN ('archived', 'restored')),
    occurred_at TEXT NOT NULL,
    created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX ix_account_archive_events_account ON account_archive_events (account_id, occurred_at);

-- Accounts archived before this migration keep their archive date as history.
INSERT INTO account_archive_events (id, account_id, action, occurred_at, created_at)
SELECT 'migrated-archive-' || id, id, 'archived', archived_at, archived_at
FROM accounts WHERE archived_at IS NOT NULL;
