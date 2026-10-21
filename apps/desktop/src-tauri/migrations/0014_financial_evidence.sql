-- Raw evidence is separate from calculated account_snapshots. No historical
-- completeness is inferred/backfilled from accounts, imports or empty tables.
CREATE TABLE financial_observations (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 supersedes_id TEXT UNIQUE REFERENCES financial_observations(id),
 value_micros INTEGER,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 recorded_at TEXT NOT NULL
);
CREATE INDEX financial_observations_account ON financial_observations(account_id, recorded_at, id);
CREATE TRIGGER observation_same_attempt BEFORE INSERT ON financial_observations
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM financial_observations WHERE id = NEW.supersedes_id AND account_id = NEW.account_id
) BEGIN SELECT RAISE(ABORT, 'observation correction must stay in its account'); END;
CREATE TRIGGER observation_no_update BEFORE UPDATE ON financial_observations
BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;
CREATE TRIGGER observation_no_delete BEFORE DELETE ON financial_observations
WHEN EXISTS(SELECT 1 FROM accounts WHERE id = OLD.account_id)
BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;

CREATE TABLE ledger_revisions (
 id TEXT PRIMARY KEY,
 entry_id TEXT NOT NULL REFERENCES account_ledger_entries(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 operation TEXT NOT NULL CHECK(operation IN ('baseline','create','update','remove')),
 entry_json TEXT NOT NULL CHECK(json_valid(entry_json)),
 deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
 recorded_at TEXT NOT NULL,
 actor TEXT NOT NULL,
 reason TEXT NOT NULL,
 supersedes_id TEXT UNIQUE REFERENCES ledger_revisions(id)
);
CREATE INDEX ledger_revisions_account ON ledger_revisions(account_id, recorded_at, id);
-- This is a frozen migration-time baseline, not reconstructed lost history.
INSERT INTO ledger_revisions
SELECT 'legacy:' || id, id, account_id, 'baseline',
 json_object('id',id,'accountId',account_id,'kind',kind,
 'amount', CASE WHEN amount_micros = 0 THEN '0' ELSE
 (CASE WHEN amount_micros < 0 THEN '-' ELSE '' END) || rtrim(rtrim(printf('%lld.%06lld', abs(amount_micros / 1000000), abs(amount_micros % 1000000)), '0'), '.') END,
 'affectsBalance',json(CASE WHEN affects_balance THEN 'true' ELSE 'false' END),
 'effectiveAt',effective_at,'tradingDay',trading_day,'note',note,'createdAt',created_at,'updatedAt',updated_at),
 deleted_at IS NOT NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'migration:v14',
 'Frozen current state; pre-v14 edits cannot be reconstructed', NULL
FROM account_ledger_entries;
CREATE TRIGGER ledger_revision_no_update BEFORE UPDATE ON ledger_revisions
BEGIN SELECT RAISE(ABORT, 'ledger revisions are immutable'); END;
CREATE TRIGGER ledger_revision_no_delete BEFORE DELETE ON ledger_revisions
WHEN EXISTS(SELECT 1 FROM accounts WHERE id = OLD.account_id)
BEGIN SELECT RAISE(ABORT, 'ledger revisions are immutable'); END;

CREATE TABLE financial_reconciliations (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 recorded_at TEXT NOT NULL
);
CREATE INDEX financial_reconciliations_account ON financial_reconciliations(account_id, recorded_at, id);
CREATE TRIGGER reconciliation_no_update BEFORE UPDATE ON financial_reconciliations
BEGIN SELECT RAISE(ABORT, 'reconciliations are immutable'); END;
CREATE TRIGGER reconciliation_no_delete BEFORE DELETE ON financial_reconciliations
WHEN EXISTS(SELECT 1 FROM accounts WHERE id = OLD.account_id)
BEGIN SELECT RAISE(ABORT, 'reconciliations are immutable'); END;
CREATE TABLE reconciliation_resolutions (
 id TEXT PRIMARY KEY,
 reconciliation_id TEXT NOT NULL REFERENCES financial_reconciliations(id) ON DELETE CASCADE,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), recorded_at TEXT NOT NULL
);
CREATE INDEX resolutions_parent ON reconciliation_resolutions(reconciliation_id, recorded_at, id);
CREATE TRIGGER resolution_no_update BEFORE UPDATE ON reconciliation_resolutions
BEGIN SELECT RAISE(ABORT, 'resolutions are immutable'); END;
CREATE TRIGGER resolution_no_delete BEFORE DELETE ON reconciliation_resolutions
WHEN EXISTS(SELECT 1 FROM financial_reconciliations WHERE id = OLD.reconciliation_id)
BEGIN SELECT RAISE(ABORT, 'resolutions are immutable'); END;
