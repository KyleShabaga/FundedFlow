-- FundedFlow collector database, migration 1 (Build 29).
--
-- This database belongs to the collector only. It is never the FundedFlow app database and holds no rule
-- candidates, programmes, phases, review decisions or approved rulebooks.
--
-- Instants are UTC text in the app's format: YYYY-MM-DDTHH:MM:SS.sssZ.
-- fetch_attempts, discovered_links and policy_events are append-only; source_snapshots are immutable.

CREATE TABLE collector_firms (
    id               TEXT PRIMARY KEY,
    firm_key         TEXT NOT NULL UNIQUE CHECK (
        length(firm_key) BETWEEN 2 AND 64 AND firm_key GLOB '[a-z0-9]*' AND firm_key NOT GLOB '*[^a-z0-9-]*'),
    display_name     TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
    homepage_url     TEXT NOT NULL CHECK (homepage_url GLOB 'https://?*' OR homepage_url GLOB 'http://?*'),
    enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    disabled_reason  TEXT,
    max_fetches      INTEGER CHECK (max_fetches IS NULL OR max_fetches BETWEEN 1 AND 300),
    max_depth        INTEGER CHECK (max_depth IS NULL OR max_depth BETWEEN 0 AND 5),
    excluded_paths   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(excluded_paths) AND json_type(excluded_paths) = 'array'),
    created_at       TEXT NOT NULL CHECK (created_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    updated_at       TEXT NOT NULL CHECK (updated_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    CHECK (enabled = 1 OR disabled_reason IS NOT NULL)
) STRICT;

CREATE TABLE collector_hosts (
    id                         TEXT PRIMARY KEY,
    firm_id                    TEXT NOT NULL REFERENCES collector_firms (id) ON DELETE RESTRICT,
    host                       TEXT NOT NULL CHECK (host = lower(host) AND length(host) BETWEEN 1 AND 253
        AND host NOT GLOB '*[^a-z0-9.-]*'),
    role                       TEXT NOT NULL CHECK (role IN ('homepage', 'help_center', 'docs', 'asset')),
    terms_url                  TEXT CHECK (terms_url IS NULL OR terms_url GLOB 'https://?*' OR terms_url GLOB 'http://?*'),
    terms_decision             TEXT CHECK (terms_decision IS NULL
        OR terms_decision IN ('allowed', 'allowed_with_limits', 'prohibited', 'unclear')),
    terms_reviewed_at          TEXT CHECK (terms_reviewed_at IS NULL OR terms_reviewed_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    terms_notes                TEXT,
    terms_min_delay_seconds    REAL CHECK (terms_min_delay_seconds IS NULL OR terms_min_delay_seconds >= 1.0),
    unclear_terms_accepted_at  TEXT CHECK (unclear_terms_accepted_at IS NULL OR unclear_terms_accepted_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    created_at                 TEXT NOT NULL,
    updated_at                 TEXT NOT NULL,
    UNIQUE (firm_id, host),
    CHECK ((terms_decision IS NULL) = (terms_reviewed_at IS NULL)),
    CHECK (unclear_terms_accepted_at IS NULL OR terms_decision = 'unclear')
) STRICT;
CREATE INDEX ix_collector_hosts_host ON collector_hosts (host);

-- Circuit state is per host, not per firm: a block applies to the host whichever firm asked.
CREATE TABLE host_circuits (
    host            TEXT PRIMARY KEY,
    state           TEXT NOT NULL CHECK (state IN ('closed', 'rate_limited', 'blocked_bot_protection', 'access_denied')),
    reason          TEXT,
    tripped_at      TEXT,
    cooldown_until  TEXT,
    run_id          TEXT,
    updated_at      TEXT NOT NULL,
    CHECK (state <> 'rate_limited' OR cooldown_until IS NOT NULL)
) STRICT;

CREATE TABLE robots_cache (
    host             TEXT PRIMARY KEY,
    fetched_at       TEXT NOT NULL,
    status_class     TEXT NOT NULL CHECK (status_class IN ('parsed', 'unavailable', 'unreachable')),
    http_status      INTEGER,
    body             TEXT,
    content_signals  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(content_signals))
) STRICT;

CREATE TABLE collector_sources (
    id                  TEXT PRIMARY KEY,
    firm_id             TEXT NOT NULL REFERENCES collector_firms (id) ON DELETE RESTRICT,
    canonical_url       TEXT NOT NULL CHECK (canonical_url GLOB 'https://?*' OR canonical_url GLOB 'http://?*'),
    kind                TEXT NOT NULL CHECK (kind IN ('page', 'pdf', 'sitemap', 'zendesk')),
    source_channel      TEXT NOT NULL CHECK (source_channel IN
        ('manual_capture', 'platform_api', 'seed', 'sitemap', 'link')),
    requires_js         INTEGER NOT NULL DEFAULT 0 CHECK (requires_js IN (0, 1)),
    js_disabled         INTEGER NOT NULL DEFAULT 0 CHECK (js_disabled IN (0, 1)),
    enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    priority            INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
    label               TEXT,
    etag                TEXT,
    last_modified       TEXT,
    sitemap_lastmod     TEXT,
    last_attempt_at     TEXT,
    last_success_at     TEXT,
    last_outcome        TEXT,
    latest_snapshot_id  TEXT REFERENCES source_snapshots (id) DEFERRABLE INITIALLY DEFERRED,
    zendesk_cursor      INTEGER,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (firm_id, canonical_url),
    CHECK (NOT (requires_js = 1 AND js_disabled = 1))
) STRICT;

CREATE TABLE crawl_runs (
    id                 TEXT PRIMARY KEY,
    batch_id           TEXT NOT NULL,
    firm_id            TEXT NOT NULL REFERENCES collector_firms (id) ON DELETE RESTRICT,
    command            TEXT NOT NULL CHECK (command IN ('discover', 'fetch')),
    started_at         TEXT NOT NULL CHECK (started_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    finished_at        TEXT,
    status             TEXT NOT NULL CHECK (status IN ('running', 'completed', 'deadline_exceeded', 'aborted')),
    fetches_used       INTEGER NOT NULL DEFAULT 0 CHECK (fetches_used >= 0),
    options            TEXT NOT NULL CHECK (json_valid(options)),
    config_sha256      TEXT NOT NULL,
    collector_version  TEXT NOT NULL,
    CHECK ((status = 'running') = (finished_at IS NULL))
) STRICT;
CREATE INDEX ix_crawl_runs_firm ON crawl_runs (firm_id, started_at);

CREATE TABLE fetch_attempts (
    id                TEXT PRIMARY KEY,
    run_id            TEXT REFERENCES crawl_runs (id) ON DELETE RESTRICT,
    firm_id           TEXT NOT NULL REFERENCES collector_firms (id) ON DELETE RESTRICT,
    source_id         TEXT REFERENCES collector_sources (id) ON DELETE RESTRICT,
    requested_url     TEXT NOT NULL,
    final_url         TEXT,
    redirect_chain    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(redirect_chain)),
    fetch_method      TEXT NOT NULL CHECK (fetch_method IN
        ('http', 'browser', 'platform_api', 'manual_capture', 'fixture_replay')),
    started_at        TEXT NOT NULL CHECK (started_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    duration_ms       INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    resolved_ip       TEXT,
    conditional       INTEGER NOT NULL DEFAULT 0 CHECK (conditional IN (0, 1)),
    http_status       INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
    response_headers  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(response_headers)),
    bytes             INTEGER CHECK (bytes IS NULL OR bytes >= 0),
    raw_sha256        TEXT CHECK (raw_sha256 IS NULL OR (length(raw_sha256) = 71
        AND raw_sha256 GLOB 'sha256:*' AND substr(raw_sha256, 8) NOT GLOB '*[^0-9a-f]*')),
    outcome           TEXT NOT NULL,
    policy_reason     TEXT,
    error_detail      TEXT,
    parser_name       TEXT,
    parser_version    TEXT,
    snapshot_id       TEXT REFERENCES source_snapshots (id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (fetch_method = 'manual_capture' OR run_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_fetch_attempts_run ON fetch_attempts (run_id);
CREATE INDEX ix_fetch_attempts_source ON fetch_attempts (source_id, started_at);
CREATE INDEX ix_fetch_attempts_snapshot ON fetch_attempts (snapshot_id);

CREATE TRIGGER fetch_attempts_no_update BEFORE UPDATE ON fetch_attempts
BEGIN SELECT RAISE(ABORT, 'fetch_attempts are append-only'); END;
CREATE TRIGGER fetch_attempts_no_delete BEFORE DELETE ON fetch_attempts
BEGIN SELECT RAISE(ABORT, 'fetch_attempts are append-only'); END;

CREATE TABLE discovered_links (
    id               TEXT PRIMARY KEY,
    run_id           TEXT NOT NULL REFERENCES crawl_runs (id) ON DELETE RESTRICT,
    firm_id          TEXT NOT NULL REFERENCES collector_firms (id) ON DELETE RESTRICT,
    url              TEXT NOT NULL,
    via              TEXT NOT NULL CHECK (via IN ('sitemap', 'robots_sitemap', 'link', 'zendesk', 'seed')),
    from_attempt_id  TEXT,
    anchor_text      TEXT,
    sitemap_lastmod  TEXT,
    depth            INTEGER NOT NULL CHECK (depth >= 0),
    relevance        INTEGER NOT NULL DEFAULT 0,
    decision         TEXT NOT NULL,
    discovered_at    TEXT NOT NULL
) STRICT;
CREATE INDEX ix_discovered_links_firm ON discovered_links (firm_id, url);

CREATE TRIGGER discovered_links_no_update BEFORE UPDATE ON discovered_links
BEGIN SELECT RAISE(ABORT, 'discovered_links are append-only'); END;
CREATE TRIGGER discovered_links_no_delete BEFORE DELETE ON discovered_links
BEGIN SELECT RAISE(ABORT, 'discovered_links are append-only'); END;

CREATE TABLE source_snapshots (
    id                     TEXT PRIMARY KEY,
    source_id              TEXT NOT NULL REFERENCES collector_sources (id) ON DELETE RESTRICT,
    firm_id                TEXT NOT NULL REFERENCES collector_firms (id) ON DELETE RESTRICT,
    content_hash           TEXT NOT NULL CHECK (length(content_hash) = 71 AND content_hash GLOB 'sha256:*'
        AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
    normalization_version  TEXT NOT NULL,
    captured_at            TEXT NOT NULL CHECK (captured_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    first_attempt_id       TEXT NOT NULL REFERENCES fetch_attempts (id) DEFERRABLE INITIALLY DEFERRED,
    requested_url          TEXT NOT NULL,
    final_url              TEXT NOT NULL,
    redirect_chain         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(redirect_chain)),
    http_status            INTEGER,
    title                  TEXT,
    text                   TEXT NOT NULL,
    structure              TEXT NOT NULL CHECK (json_valid(structure)),
    content_type           TEXT NOT NULL,
    fetch_method           TEXT NOT NULL CHECK (fetch_method IN
        ('http', 'browser', 'platform_api', 'manual_capture', 'fixture_replay')),
    source_channel         TEXT NOT NULL,
    parser_name            TEXT NOT NULL,
    parser_version         TEXT NOT NULL,
    warnings               TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings)),
    raw_sha256             TEXT,
    platform_metadata      TEXT CHECK (platform_metadata IS NULL OR json_valid(platform_metadata)),
    UNIQUE (source_id, content_hash)
) STRICT;
CREATE INDEX ix_source_snapshots_firm ON source_snapshots (firm_id, captured_at);

CREATE TRIGGER source_snapshots_no_update BEFORE UPDATE ON source_snapshots
BEGIN SELECT RAISE(ABORT, 'source_snapshots are immutable'); END;
CREATE TRIGGER source_snapshots_no_delete BEFORE DELETE ON source_snapshots
BEGIN SELECT RAISE(ABORT, 'source_snapshots are immutable'); END;

-- Raw bytes, only when raw.retain = true; pruned by `collector prune-raw`. Snapshots never depend on them.
CREATE TABLE raw_payloads (
    sha256        TEXT PRIMARY KEY,
    bytes         BLOB NOT NULL,
    content_type  TEXT,
    stored_at     TEXT NOT NULL,
    expires_at    TEXT NOT NULL
) STRICT;

CREATE TABLE policy_events (
    id       TEXT PRIMARY KEY,
    at       TEXT NOT NULL,
    host     TEXT,
    firm_id  TEXT REFERENCES collector_firms (id) ON DELETE RESTRICT,
    kind     TEXT NOT NULL CHECK (kind IN ('terms_recorded', 'unclear_terms_accepted', 'circuit_tripped',
        'circuit_reenabled', 'circuit_expired', 'robots_fetched', 'content_signal_seen', 'host_added',
        'firm_disabled', 'firm_enabled')),
    detail   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
    run_id   TEXT
) STRICT;
CREATE INDEX ix_policy_events_host ON policy_events (host, at);

CREATE TRIGGER policy_events_no_update BEFORE UPDATE ON policy_events
BEGIN SELECT RAISE(ABORT, 'policy_events are append-only'); END;
CREATE TRIGGER policy_events_no_delete BEFORE DELETE ON policy_events
BEGIN SELECT RAISE(ABORT, 'policy_events are append-only'); END;

CREATE TABLE export_batches (
    export_id       TEXT NOT NULL,
    generated_at    TEXT NOT NULL,
    path            TEXT NOT NULL,
    firm_keys       TEXT NOT NULL CHECK (json_valid(firm_keys)),
    snapshot_count  INTEGER NOT NULL CHECK (snapshot_count >= 0),
    file_sha256     TEXT NOT NULL,
    schema_version  INTEGER NOT NULL,
    PRIMARY KEY (export_id, generated_at, path)
) STRICT;
