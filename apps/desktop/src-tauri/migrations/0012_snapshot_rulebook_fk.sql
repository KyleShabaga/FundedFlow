-- FundedFlow migration 12: repoint account_snapshots at the rulebook tables.
-- Forward-only; 0001-0011 are unchanged.
--
-- Migration 9 renamed the 0001 `rulebook_versions` to `legacy_account_rulebook_versions`,
-- and SQLite rewrote account_snapshots.rulebook_version_id to follow the rename.
-- A snapshot of an account on a reusable rulebook (Build 9.5) therefore could not
-- be stored: its version id is in the new `rulebook_versions`, not the legacy table.
--
-- Rebuild the table with the key on `rulebook_versions`. Migration 10 kept every
-- legacy version id, so existing snapshots keep their reference; one naming an id
-- that was not converted is kept with no rulebook rather than blocking the upgrade.
-- RESTRICT replaces CASCADE: deleting a rulebook version must not delete the
-- end-of-day history that eod_trailing drawdown depends on.

CREATE TABLE account_snapshots_new (
    id                          TEXT PRIMARY KEY,
    account_id                  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    rulebook_version_id         TEXT REFERENCES rulebook_versions (id) ON DELETE RESTRICT,
    trading_day                 TEXT NOT NULL CHECK (trading_day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    is_end_of_day               INTEGER NOT NULL CHECK (is_end_of_day IN (0, 1)),
    data_as_of                  TEXT,
    data_source                 TEXT NOT NULL CHECK (data_source IN ('csv_import', 'manual', 'mixed', 'none')),
    calculated_at               TEXT NOT NULL,
    engine_version              TEXT NOT NULL,
    inputs_hash                 TEXT NOT NULL,
    fees_included               INTEGER NOT NULL DEFAULT 1 CHECK (fees_included IN (0, 1)),
    unrealized_included         INTEGER NOT NULL DEFAULT 0 CHECK (unrealized_included IN (0, 1)),
    balance_micros              INTEGER NOT NULL,
    realized_day_pnl_micros     INTEGER NOT NULL,
    unrealized_pnl_micros       INTEGER,
    daily_loss_limit_micros     INTEGER,
    daily_loss_remaining_micros INTEGER,
    drawdown_mode               TEXT CHECK (drawdown_mode IS NULL OR drawdown_mode IN ('static', 'eod_trailing', 'intraday_trailing')),
    high_water_mark_micros      INTEGER,
    drawdown_floor_micros       INTEGER,
    drawdown_headroom_micros    INTEGER,
    drawdown_locked             INTEGER NOT NULL DEFAULT 0 CHECK (drawdown_locked IN (0, 1)),
    profit_target_micros        INTEGER,
    trading_days_completed      INTEGER NOT NULL DEFAULT 0,
    trading_days_required       INTEGER,
    status                      TEXT NOT NULL CHECK (status IN ('safe', 'caution', 'stop', 'unknown', 'needs_setup')),
    status_reasons_json         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(status_reasons_json)),
    explanation_json            TEXT NOT NULL CHECK (json_valid(explanation_json))
) STRICT;

INSERT INTO account_snapshots_new
SELECT id, account_id,
       CASE WHEN EXISTS (SELECT 1 FROM rulebook_versions v WHERE v.id = s.rulebook_version_id)
            THEN s.rulebook_version_id END,
       trading_day, is_end_of_day, data_as_of, data_source, calculated_at, engine_version, inputs_hash,
       fees_included, unrealized_included, balance_micros, realized_day_pnl_micros, unrealized_pnl_micros,
       daily_loss_limit_micros, daily_loss_remaining_micros, drawdown_mode, high_water_mark_micros,
       drawdown_floor_micros, drawdown_headroom_micros, drawdown_locked, profit_target_micros,
       trading_days_completed, trading_days_required, status, status_reasons_json, explanation_json
FROM account_snapshots s;

DROP TABLE account_snapshots;
ALTER TABLE account_snapshots_new RENAME TO account_snapshots;
CREATE INDEX ix_snapshots_account_day ON account_snapshots (account_id, trading_day, calculated_at);
CREATE UNIQUE INDEX ux_snapshots_eod
    ON account_snapshots (account_id, trading_day, engine_version, inputs_hash) WHERE is_end_of_day = 1;
