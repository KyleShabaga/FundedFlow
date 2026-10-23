-- FundedFlow migration 0022: whether a trade's fees were recorded (TASK-042).
-- Forward-only; 0001-0021 are unchanged. Reference: docs/data-model.md#trades
--
-- A blank fee and an explicit zero were both stored as fees_micros = 0, so
-- "fees unknown" could not be told apart from "no fees". fees_recorded is 1
-- when the trader or the import gave a fee (an explicit 0 included) and 0 when
-- none was given; then fees_micros is 0. Stored P&L does not change: for a
-- trade without recorded fees net_pnl_micros stays gross - 0, and views show
-- its net as unknown.
--
-- ADD COLUMN only (no table rebuild). DEFAULT 1 exists so the column can be
-- added to rows whose fees are above zero; every insert sets it explicitly.
ALTER TABLE trades ADD COLUMN fees_recorded INTEGER NOT NULL DEFAULT 1
    CHECK (fees_recorded IN (0, 1) AND (fees_recorded = 1 OR fees_micros = 0));

-- Existing rows: a zero cannot be classified (a blank and an explicit zero were
-- stored the same way, and Performance imports are always 0), so it is "not
-- recorded"; fees above zero were recorded. updated_at, fees_micros and
-- net_pnl_micros are not touched, so daily-review change detection and stored
-- calculations are unaffected.
UPDATE trades SET fees_recorded = 0 WHERE fees_micros = 0;
