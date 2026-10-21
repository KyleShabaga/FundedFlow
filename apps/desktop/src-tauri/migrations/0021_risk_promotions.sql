-- FundedFlow migration 21: which stored risk calculations were promoted to current (P0-02).
--
-- account_snapshots keeps every calculation as immutable history. A row here records that one of them was
-- promoted: natively re-read sources for its own cutoff matched its frozen inputs, reconciliation revisions and
-- prior-breach history inside the same write transaction as this insert. The newest row per account is that
-- account's current result; whether it is still eligible is re-checked against the sources on every read.
--
-- Nothing is backfilled: calculations saved before this version stay readable history but are never treated as
-- promoted. Rows are append-only while their account exists (an account deletion removes them with it).
CREATE TABLE risk_promotions (
    seq                INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id         TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    snapshot_id        TEXT NOT NULL REFERENCES account_snapshots(id) ON DELETE CASCADE,
    -- sha256 of the canonical captured sources (inputs, reconciliation revisions, prior breaches).
    source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
    promoted_at        TEXT NOT NULL
);
CREATE INDEX ix_risk_promotions_account ON risk_promotions (account_id, seq);

CREATE TRIGGER risk_promotion_same_account BEFORE INSERT ON risk_promotions
WHEN NOT EXISTS (SELECT 1 FROM account_snapshots WHERE id = NEW.snapshot_id AND account_id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'a promotion must name a calculation of the same account'); END;

CREATE TRIGGER risk_promotion_no_update BEFORE UPDATE ON risk_promotions
BEGIN SELECT RAISE(ABORT, 'risk promotions are immutable'); END;

CREATE TRIGGER risk_promotion_no_delete BEFORE DELETE ON risk_promotions
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id)
BEGIN SELECT RAISE(ABORT, 'risk promotions are immutable'); END;
