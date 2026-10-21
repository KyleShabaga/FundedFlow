-- FundedFlow migration 0017: trade corrections, trade reviews, the review library
-- (strategies, checklists, tags) and screenshot attachments (Build 20).
-- Reference: docs/data-model.md#trade-journal-and-reviews-build-20
--
-- The review, library and attachment tables were reserved by 0001 with no
-- commands. This migration adds only what they lack: account ownership,
-- snapshots of the labels a review was made with, revisions and archive flags.
-- It changes no existing row except to fill the new trade_reviews.account_id
-- from the review's trade (no command wrote reviews before this version).

-- ---------------------------------------------------------------------------
-- Trade corrections: append-only history of edits, deletes and restores
-- ---------------------------------------------------------------------------

CREATE TABLE trade_corrections (
    id             TEXT PRIMARY KEY,
    trade_id       TEXT NOT NULL REFERENCES trades (id) ON DELETE CASCADE,
    -- No foreign key: the row goes with its trade, never on its own (see the delete trigger).
    account_id     TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('edit', 'delete', 'restore', 'import_restore')),
    corrected_at   TEXT NOT NULL CHECK (corrected_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    -- Local and unauthenticated, like rulebook_events: 'local_user' or 'csv_import'.
    actor          TEXT NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 80),
    reason         TEXT CHECK (reason IS NULL OR length(reason) <= 2000),
    -- Field names (camelCase, as in the Trade DTO) whose stored value changed.
    changed_fields TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changed_fields) AND json_type(changed_fields) = 'array'),
    -- The stored trade before and after, as the Trade DTO fields (money as decimal text).
    before_json    TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json     TEXT CHECK (after_json IS NULL OR json_valid(after_json))
) STRICT;
CREATE INDEX ix_trade_corrections_trade ON trade_corrections (trade_id, corrected_at);
CREATE INDEX ix_trade_corrections_account ON trade_corrections (account_id, corrected_at);

CREATE TRIGGER trg_trade_corrections_same_account
BEFORE INSERT ON trade_corrections
WHEN (SELECT account_id FROM trades WHERE id = NEW.trade_id) IS NOT NEW.account_id
BEGIN
    SELECT RAISE(ABORT, 'trade correction must belong to the trade''s account');
END;

CREATE TRIGGER trg_trade_corrections_append_only_update
BEFORE UPDATE ON trade_corrections
BEGIN
    SELECT RAISE(ABORT, 'trade corrections are append-only');
END;

-- Rows go only with their trade (permanent account deletion, Build 24).
CREATE TRIGGER trg_trade_corrections_append_only_delete
BEFORE DELETE ON trade_corrections
WHEN EXISTS (SELECT 1 FROM trades WHERE id = OLD.trade_id)
BEGIN
    SELECT RAISE(ABORT, 'trade corrections are append-only');
END;

-- ---------------------------------------------------------------------------
-- Library: archive flags (nothing a review used is ever hard-deleted)
-- ---------------------------------------------------------------------------

ALTER TABLE tags ADD COLUMN archived_at TEXT;
ALTER TABLE checklists ADD COLUMN description_md TEXT;

-- ---------------------------------------------------------------------------
-- Trade reviews: ownership, revision and snapshots
-- ---------------------------------------------------------------------------

ALTER TABLE trade_reviews ADD COLUMN account_id TEXT REFERENCES accounts (id) ON DELETE CASCADE;
-- Optimistic concurrency: a save names the revision it started from.
ALTER TABLE trade_reviews ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
-- The strategy and checklist as they read when chosen; renaming or archiving
-- the template never re-labels the review.
ALTER TABLE trade_reviews ADD COLUMN strategy_name_snapshot TEXT;
ALTER TABLE trade_reviews ADD COLUMN checklist_id TEXT REFERENCES checklists (id) ON DELETE SET NULL;
ALTER TABLE trade_reviews ADD COLUMN checklist_name_snapshot TEXT;

UPDATE trade_reviews SET account_id = (SELECT account_id FROM trades WHERE trades.id = trade_reviews.trade_id)
WHERE account_id IS NULL;

CREATE INDEX ix_trade_reviews_account ON trade_reviews (account_id);

CREATE TRIGGER trg_trade_reviews_same_account_insert
BEFORE INSERT ON trade_reviews
WHEN NEW.account_id IS NULL OR (SELECT account_id FROM trades WHERE id = NEW.trade_id) IS NOT NEW.account_id
BEGIN
    SELECT RAISE(ABORT, 'trade review must belong to the trade''s account');
END;

CREATE TRIGGER trg_trade_reviews_identity_immutable
BEFORE UPDATE OF trade_id, account_id, created_at ON trade_reviews
WHEN NEW.trade_id IS NOT OLD.trade_id OR NEW.account_id IS NOT OLD.account_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'trade review trade and account are immutable');
END;

-- The tag as it read when added to the review.
ALTER TABLE trade_review_tags ADD COLUMN label_snapshot TEXT;
ALTER TABLE trade_review_tags ADD COLUMN kind_snapshot TEXT
    CHECK (kind_snapshot IS NULL OR kind_snapshot IN ('setup', 'mistake', 'emotion', 'general'));

-- ---------------------------------------------------------------------------
-- Attachments: account ownership and image dimensions
-- ---------------------------------------------------------------------------

-- Bytes live in <app data>/attachments/<storage_key> (the Build 24 archive
-- convention). account_id is the owner; a review link must be in the same account.
ALTER TABLE attachments ADD COLUMN account_id TEXT REFERENCES accounts (id) ON DELETE CASCADE;
ALTER TABLE attachments ADD COLUMN width INTEGER CHECK (width IS NULL OR width > 0);
ALTER TABLE attachments ADD COLUMN height INTEGER CHECK (height IS NULL OR height > 0);
CREATE INDEX ix_attachments_account ON attachments (account_id);

CREATE TRIGGER trg_attachment_links_review_same_account
BEFORE INSERT ON attachment_links
WHEN NEW.trade_review_id IS NOT NULL
 AND (SELECT account_id FROM attachments WHERE id = NEW.attachment_id) IS NOT NULL
 AND (SELECT account_id FROM attachments WHERE id = NEW.attachment_id)
     IS NOT (SELECT account_id FROM trade_reviews WHERE id = NEW.trade_review_id)
BEGIN
    SELECT RAISE(ABORT, 'attachment must belong to the review''s account');
END;

CREATE TRIGGER trg_attachments_owner_immutable
BEFORE UPDATE OF account_id, storage_key, sha256, byte_size ON attachments
WHEN OLD.account_id IS NOT NULL AND (NEW.account_id IS NOT OLD.account_id OR NEW.storage_key IS NOT OLD.storage_key
     OR NEW.sha256 IS NOT OLD.sha256 OR NEW.byte_size IS NOT OLD.byte_size)
BEGIN
    SELECT RAISE(ABORT, 'attachment owner and content are immutable');
END;
