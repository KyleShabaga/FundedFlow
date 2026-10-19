-- FundedFlow migration 0003: paired-fill (round-trip) import details and
-- import warnings. Reference: docs/data-model.md#csv-import

-- Source values of a trade imported from a round-trip performance export
-- (one buy fill paired with one sell fill). Kept exactly as supplied so the
-- normalized trade can be audited; never edited.
CREATE TABLE trade_round_trips (
    trade_id          TEXT PRIMARY KEY REFERENCES trades (id) ON DELETE CASCADE,
    buy_fill_id       TEXT,
    sell_fill_id      TEXT,
    buy_price         TEXT NOT NULL,
    sell_price        TEXT NOT NULL,
    -- Parsed (UTC) and original text of both fill times.
    bought_at         TEXT NOT NULL CHECK (bought_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    sold_at           TEXT NOT NULL CHECK (sold_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    bought_at_source  TEXT NOT NULL,
    sold_at_source    TEXT NOT NULL,
    duration_source   TEXT,
    duration_seconds  INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    price_format      TEXT,
    price_format_type TEXT,
    tick_size         TEXT,
    -- Which fill opened the trade: the buy (long), the sell (short, the
    -- "sold before bought" case), or both in the same second (taken as long).
    entry_basis       TEXT NOT NULL CHECK (entry_basis IN ('buy_first', 'sell_first', 'same_time')),
    CHECK ((entry_basis = 'buy_first') = (bought_at < sold_at)),
    CHECK ((entry_basis = 'sell_first') = (sold_at < bought_at))
) STRICT;
CREATE INDEX ix_round_trips_fills ON trade_round_trips (buy_fill_id, sell_fill_id);

CREATE TRIGGER trg_round_trips_immutable
BEFORE UPDATE ON trade_round_trips
BEGIN
    SELECT RAISE(ABORT, 'round-trip source values are immutable');
END;

-- Non-blocking findings per row (e.g. sell fill earlier than buy fill).
ALTER TABLE import_rows ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(warnings_json));

ALTER TABLE import_batches ADD COLUMN source_format TEXT NOT NULL DEFAULT 'generic'
    CHECK (source_format IN ('generic', 'performance'));
-- Rows (of any status) that carried at least one warning.
ALTER TABLE import_batches ADD COLUMN warning_count INTEGER NOT NULL DEFAULT 0
    CHECK (warning_count >= 0);
