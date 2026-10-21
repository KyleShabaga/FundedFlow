-- FundedFlow migration 0018: daily reviews (Build 22): the pre-session plan,
-- the post-session reflection, day-level checklist answers and the trades a
-- review was saved with, for one account attempt and one trading day.
-- Reference: docs/data-model.md#daily-reviews-build-22
--
-- New tables only. journal_entries (generic notes) and the reserved
-- checklist_results.journal_entry_id / attachment_links.journal_entry_id
-- columns are left as they are: a generic note is never turned into a review.

-- ---------------------------------------------------------------------------
-- One review per account attempt and trading day
-- ---------------------------------------------------------------------------

CREATE TABLE daily_reviews (
    id                         TEXT PRIMARY KEY,
    -- An evaluation reset creates a new account, so a reset attempt never shares a review.
    account_id                 TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    -- The account's trading day (Rust domain::trading_day), never a browser date.
    -- Trading days run Monday to Friday.
    trading_day                TEXT NOT NULL CHECK (trading_day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
                                                    AND date(trading_day) = trading_day
                                                    AND strftime('%w', trading_day) NOT IN ('0', '6')),
    status                     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
    -- Optimistic concurrency: a save names the revision it started from.
    revision                   INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    -- The account's session settings when the review was last saved; a later
    -- change re-derives trades' trading days but never moves the review.
    timezone_snapshot          TEXT NOT NULL CHECK (length(timezone_snapshot) BETWEEN 1 AND 64),
    reset_time_snapshot        TEXT NOT NULL CHECK (reset_time_snapshot GLOB '[0-2][0-9]:[0-5][0-9]'),

    -- Before the session (self-reported intentions, not firm rules).
    plan_focus                 TEXT CHECK (plan_focus IS NULL OR length(plan_focus) <= 20000),
    plan_setups                TEXT CHECK (plan_setups IS NULL OR length(plan_setups) <= 20000),
    plan_no_trade_conditions   TEXT CHECK (plan_no_trade_conditions IS NULL OR length(plan_no_trade_conditions) <= 20000),
    plan_commitments           TEXT CHECK (plan_commitments IS NULL OR length(plan_commitments) <= 20000),
    -- Self-imposed maximum risk for the day, account currency. NULL is not stated, never zero.
    plan_max_risk_micros       INTEGER CHECK (plan_max_risk_micros IS NULL OR plan_max_risk_micros > 0),
    plan_notes                 TEXT CHECK (plan_notes IS NULL OR length(plan_notes) <= 20000),
    -- When the plan first had content, and whether that was before the session.
    plan_authored_at           TEXT,
    plan_timing                TEXT CHECK (plan_timing IS NULL OR plan_timing IN ('pre_session', 'retrospective')),

    -- After the session.
    market_context             TEXT CHECK (market_context IS NULL OR length(market_context) <= 20000),
    went_well                  TEXT CHECK (went_well IS NULL OR length(went_well) <= 20000),
    mistakes                   TEXT CHECK (mistakes IS NULL OR length(mistakes) <= 20000),
    emotions                   TEXT CHECK (emotions IS NULL OR length(emotions) <= 20000),
    key_lesson                 TEXT CHECK (key_lesson IS NULL OR length(key_lesson) <= 20000),
    next_action                TEXT CHECK (next_action IS NULL OR length(next_action) <= 20000),
    reflection_notes           TEXT CHECK (reflection_notes IS NULL OR length(reflection_notes) <= 20000),
    -- The trader states they did not trade this day by choice (distinct from "no trades recorded").
    no_trade_day               INTEGER NOT NULL DEFAULT 0 CHECK (no_trade_day IN (0, 1)),

    -- The daily checklist as it read when chosen.
    checklist_id               TEXT REFERENCES checklists (id) ON DELETE SET NULL,
    checklist_name_snapshot    TEXT,

    completed_at               TEXT,
    first_completed_at         TEXT,
    edited_after_completion_at TEXT,
    reopened_at                TEXT,
    created_at                 TEXT NOT NULL,
    updated_at                 TEXT NOT NULL,
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CHECK ((plan_authored_at IS NULL) = (plan_timing IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_daily_reviews_account_day ON daily_reviews (account_id, trading_day);

CREATE TRIGGER trg_daily_reviews_identity_immutable
BEFORE UPDATE OF account_id, trading_day, created_at ON daily_reviews
WHEN NEW.account_id IS NOT OLD.account_id OR NEW.trading_day IS NOT OLD.trading_day
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'daily review account and trading day are immutable');
END;

-- ---------------------------------------------------------------------------
-- Day-level checklist answers (Build 20's checklist_results belong to a trade
-- review or a generic journal entry; daily answers are kept apart).
-- An unanswered item has no row; it is never a failure.
-- ---------------------------------------------------------------------------

CREATE TABLE daily_review_answers (
    id                  TEXT PRIMARY KEY,
    daily_review_id     TEXT NOT NULL REFERENCES daily_reviews (id) ON DELETE CASCADE,
    -- Items are archived, never deleted, so the reference stays.
    checklist_item_id   TEXT NOT NULL REFERENCES checklist_items (id) ON DELETE RESTRICT,
    item_label_snapshot TEXT NOT NULL CHECK (length(trim(item_label_snapshot)) > 0),
    sort_order_snapshot INTEGER NOT NULL,
    result              TEXT NOT NULL CHECK (result IN ('followed', 'missed', 'not_applicable')),
    note                TEXT CHECK (note IS NULL OR length(note) <= 2000),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX ux_daily_review_answers_item ON daily_review_answers (daily_review_id, checklist_item_id);

-- ---------------------------------------------------------------------------
-- The trades the review was last saved with, by stable trade id. Compared
-- with the day's trades now, this shows trades added, corrected, deleted or
-- moved to another day since; the review text never moves.
-- ---------------------------------------------------------------------------

CREATE TABLE daily_review_trades (
    daily_review_id        TEXT NOT NULL REFERENCES daily_reviews (id) ON DELETE CASCADE,
    trade_id               TEXT NOT NULL REFERENCES trades (id) ON DELETE CASCADE,
    trading_day_snapshot   TEXT NOT NULL,
    net_pnl_micros_snapshot INTEGER,
    pnl_status_snapshot    TEXT NOT NULL,
    trade_updated_at_snapshot TEXT NOT NULL,
    linked_at              TEXT NOT NULL,
    PRIMARY KEY (daily_review_id, trade_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_daily_review_trades_trade ON daily_review_trades (trade_id);

CREATE TRIGGER trg_daily_review_trades_same_account
BEFORE INSERT ON daily_review_trades
WHEN (SELECT account_id FROM trades WHERE id = NEW.trade_id)
     IS NOT (SELECT account_id FROM daily_reviews WHERE id = NEW.daily_review_id)
BEGIN
    SELECT RAISE(ABORT, 'a daily review links only trades of its own account');
END;

-- ---------------------------------------------------------------------------
-- History: created, saved, completed, edited, reopened, relinked. Append-only.
-- ---------------------------------------------------------------------------

CREATE TABLE daily_review_events (
    id              TEXT PRIMARY KEY,
    daily_review_id TEXT NOT NULL REFERENCES daily_reviews (id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('created', 'saved', 'completed', 'edited', 'reopened', 'relinked')),
    revision        INTEGER NOT NULL CHECK (revision >= 1),
    at              TEXT NOT NULL
) STRICT;
CREATE INDEX ix_daily_review_events_review ON daily_review_events (daily_review_id, at);

CREATE TRIGGER trg_daily_review_events_append_only_update
BEFORE UPDATE ON daily_review_events
BEGIN
    SELECT RAISE(ABORT, 'daily review events are append-only');
END;

-- Rows go only with their review (permanent account deletion, Build 24).
CREATE TRIGGER trg_daily_review_events_append_only_delete
BEFORE DELETE ON daily_review_events
WHEN EXISTS (SELECT 1 FROM daily_reviews WHERE id = OLD.daily_review_id)
BEGIN
    SELECT RAISE(ABORT, 'daily review events are append-only');
END;
