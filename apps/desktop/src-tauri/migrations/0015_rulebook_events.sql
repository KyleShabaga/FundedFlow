-- Rulebook audit log (Build 19).
--
-- Who did what to a rulebook version, and why: a draft created, saved or
-- discarded, a version published or verified, a version assigned to an
-- account, a source conflict recorded. Draft rows are mutable until they are
-- published, so their edit history lives here and nowhere else. Rows are
-- append-only. Actor labels are local, unauthenticated names ("local_user").
--
-- Nothing is backfilled: versions and assignments written before v15 keep
-- their own timestamps (created_at, verified_at, assigned_at), which the UI
-- shows as such. The version and account ids are plain text so the log
-- outlives a discarded draft; the rulebook id cascades with its rulebook.

CREATE TABLE rulebook_events (
    id                  TEXT PRIMARY KEY,
    rulebook_id         TEXT NOT NULL REFERENCES rulebooks (id) ON DELETE CASCADE,
    rulebook_version_id TEXT NOT NULL,
    account_id          TEXT,
    assignment_id       TEXT,
    action              TEXT NOT NULL CHECK (action IN
        ('draft_created', 'draft_saved', 'draft_discarded', 'published', 'verified', 'assigned', 'conflict_flagged')),
    actor               TEXT NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 200),
    reason              TEXT CHECK (reason IS NULL OR length(reason) <= 2000),
    occurred_at         TEXT NOT NULL,
    CHECK ((action = 'assigned') = (assignment_id IS NOT NULL)),
    CHECK (action <> 'assigned' OR account_id IS NOT NULL)
) STRICT;

CREATE INDEX ix_rulebook_events_rulebook ON rulebook_events (rulebook_id, occurred_at);
CREATE INDEX ix_rulebook_events_account ON rulebook_events (account_id, occurred_at);

CREATE TRIGGER trg_rulebook_events_no_update BEFORE UPDATE ON rulebook_events
BEGIN SELECT RAISE(ABORT, 'rulebook events are append-only'); END;

CREATE TRIGGER trg_rulebook_events_no_delete BEFORE DELETE ON rulebook_events
WHEN (SELECT 1 FROM rulebooks WHERE id = OLD.rulebook_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'rulebook events are append-only'); END;
