-- migrate: rebuild-tables
-- FundedFlow collector database, migration 2 (Build 29.25): comparison publishers and directory observations.
--
-- A comparison publisher (a third-party directory site such as a prop-firm comparison table) is its own registry
-- concept, `directory_publishers`, and is never a `collector_firms` row. Both kinds of registry entry own hosts,
-- sources, runs, attempts and snapshots through `collection_owners`: the `firm_id` column of those tables now
-- holds a collection owner id, which is a firm id or a publisher id (`collection_owners.kind` says which).
-- Every existing row keeps its id and content; only the foreign keys are re-pointed, using SQLite's documented
-- table-rebuild procedure (foreign keys off, copy, drop, rename, then `PRAGMA foreign_key_check`).
--
-- Directory observations are unverified third-party claims. Nothing here is a rule, an approval or a write to the
-- FundedFlow app database.

CREATE TABLE collection_owners (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('firm', 'publisher')),
    created_at  TEXT NOT NULL
) STRICT;

INSERT INTO collection_owners (id, kind, created_at) SELECT id, 'firm', created_at FROM collector_firms;

CREATE TRIGGER collector_firms_owner AFTER INSERT ON collector_firms
BEGIN INSERT INTO collection_owners (id, kind, created_at) VALUES (NEW.id, 'firm', NEW.created_at); END;
CREATE TRIGGER collection_owners_no_update BEFORE UPDATE ON collection_owners
BEGIN SELECT RAISE(ABORT, 'collection_owners are immutable'); END;
CREATE TRIGGER collection_owners_no_delete BEFORE DELETE ON collection_owners
BEGIN SELECT RAISE(ABORT, 'collection_owners are immutable'); END;

-- collector_hosts: firm_id now references collection_owners.
CREATE TABLE collector_hosts_v2 (
    id                         TEXT PRIMARY KEY,
    firm_id                    TEXT NOT NULL REFERENCES collection_owners (id) ON DELETE RESTRICT,
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
INSERT INTO collector_hosts_v2 (id, firm_id, host, role, terms_url, terms_decision, terms_reviewed_at, terms_notes, terms_min_delay_seconds, unclear_terms_accepted_at, created_at, updated_at)
    SELECT id, firm_id, host, role, terms_url, terms_decision, terms_reviewed_at, terms_notes, terms_min_delay_seconds, unclear_terms_accepted_at, created_at, updated_at FROM collector_hosts;
DROP TABLE collector_hosts;
ALTER TABLE collector_hosts_v2 RENAME TO collector_hosts;
CREATE INDEX ix_collector_hosts_host ON collector_hosts (host);

-- collector_sources: firm_id now references collection_owners.
CREATE TABLE collector_sources_v2 (
    id                  TEXT PRIMARY KEY,
    firm_id             TEXT NOT NULL REFERENCES collection_owners (id) ON DELETE RESTRICT,
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
INSERT INTO collector_sources_v2 (id, firm_id, canonical_url, kind, source_channel, requires_js, js_disabled, enabled, priority, label, etag, last_modified, sitemap_lastmod, last_attempt_at, last_success_at, last_outcome, latest_snapshot_id, zendesk_cursor, created_at, updated_at)
    SELECT id, firm_id, canonical_url, kind, source_channel, requires_js, js_disabled, enabled, priority, label, etag, last_modified, sitemap_lastmod, last_attempt_at, last_success_at, last_outcome, latest_snapshot_id, zendesk_cursor, created_at, updated_at FROM collector_sources;
DROP TABLE collector_sources;
ALTER TABLE collector_sources_v2 RENAME TO collector_sources;

-- crawl_runs: firm_id now references collection_owners.
CREATE TABLE crawl_runs_v2 (
    id                 TEXT PRIMARY KEY,
    batch_id           TEXT NOT NULL,
    firm_id            TEXT NOT NULL REFERENCES collection_owners (id) ON DELETE RESTRICT,
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
INSERT INTO crawl_runs_v2 (id, batch_id, firm_id, command, started_at, finished_at, status, fetches_used, options, config_sha256, collector_version)
    SELECT id, batch_id, firm_id, command, started_at, finished_at, status, fetches_used, options, config_sha256, collector_version FROM crawl_runs;
DROP TABLE crawl_runs;
ALTER TABLE crawl_runs_v2 RENAME TO crawl_runs;
CREATE INDEX ix_crawl_runs_firm ON crawl_runs (firm_id, started_at);

-- fetch_attempts: firm_id now references collection_owners.
CREATE TABLE fetch_attempts_v2 (
    id                TEXT PRIMARY KEY,
    run_id            TEXT REFERENCES crawl_runs (id) ON DELETE RESTRICT,
    firm_id           TEXT NOT NULL REFERENCES collection_owners (id) ON DELETE RESTRICT,
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
INSERT INTO fetch_attempts_v2 (id, run_id, firm_id, source_id, requested_url, final_url, redirect_chain, fetch_method, started_at, duration_ms, resolved_ip, conditional, http_status, response_headers, bytes, raw_sha256, outcome, policy_reason, error_detail, parser_name, parser_version, snapshot_id)
    SELECT id, run_id, firm_id, source_id, requested_url, final_url, redirect_chain, fetch_method, started_at, duration_ms, resolved_ip, conditional, http_status, response_headers, bytes, raw_sha256, outcome, policy_reason, error_detail, parser_name, parser_version, snapshot_id FROM fetch_attempts;
DROP TABLE fetch_attempts;
ALTER TABLE fetch_attempts_v2 RENAME TO fetch_attempts;
CREATE INDEX ix_fetch_attempts_run ON fetch_attempts (run_id);
CREATE INDEX ix_fetch_attempts_source ON fetch_attempts (source_id, started_at);
CREATE INDEX ix_fetch_attempts_snapshot ON fetch_attempts (snapshot_id);
CREATE TRIGGER fetch_attempts_no_update BEFORE UPDATE ON fetch_attempts
BEGIN SELECT RAISE(ABORT, 'fetch_attempts are append-only'); END;
CREATE TRIGGER fetch_attempts_no_delete BEFORE DELETE ON fetch_attempts
BEGIN SELECT RAISE(ABORT, 'fetch_attempts are append-only'); END;

-- discovered_links: firm_id now references collection_owners.
CREATE TABLE discovered_links_v2 (
    id               TEXT PRIMARY KEY,
    run_id           TEXT NOT NULL REFERENCES crawl_runs (id) ON DELETE RESTRICT,
    firm_id          TEXT NOT NULL REFERENCES collection_owners (id) ON DELETE RESTRICT,
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
INSERT INTO discovered_links_v2 (id, run_id, firm_id, url, via, from_attempt_id, anchor_text, sitemap_lastmod, depth, relevance, decision, discovered_at)
    SELECT id, run_id, firm_id, url, via, from_attempt_id, anchor_text, sitemap_lastmod, depth, relevance, decision, discovered_at FROM discovered_links;
DROP TABLE discovered_links;
ALTER TABLE discovered_links_v2 RENAME TO discovered_links;
CREATE INDEX ix_discovered_links_firm ON discovered_links (firm_id, url);
CREATE TRIGGER discovered_links_no_update BEFORE UPDATE ON discovered_links
BEGIN SELECT RAISE(ABORT, 'discovered_links are append-only'); END;
CREATE TRIGGER discovered_links_no_delete BEFORE DELETE ON discovered_links
BEGIN SELECT RAISE(ABORT, 'discovered_links are append-only'); END;

-- source_snapshots: firm_id now references collection_owners.
CREATE TABLE source_snapshots_v2 (
    id                     TEXT PRIMARY KEY,
    source_id              TEXT NOT NULL REFERENCES collector_sources (id) ON DELETE RESTRICT,
    firm_id                TEXT NOT NULL REFERENCES collection_owners (id) ON DELETE RESTRICT,
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
INSERT INTO source_snapshots_v2 (id, source_id, firm_id, content_hash, normalization_version, captured_at, first_attempt_id, requested_url, final_url, redirect_chain, http_status, title, text, structure, content_type, fetch_method, source_channel, parser_name, parser_version, warnings, raw_sha256, platform_metadata)
    SELECT id, source_id, firm_id, content_hash, normalization_version, captured_at, first_attempt_id, requested_url, final_url, redirect_chain, http_status, title, text, structure, content_type, fetch_method, source_channel, parser_name, parser_version, warnings, raw_sha256, platform_metadata FROM source_snapshots;
DROP TABLE source_snapshots;
ALTER TABLE source_snapshots_v2 RENAME TO source_snapshots;
CREATE INDEX ix_source_snapshots_firm ON source_snapshots (firm_id, captured_at);
CREATE TRIGGER source_snapshots_no_update BEFORE UPDATE ON source_snapshots
BEGIN SELECT RAISE(ABORT, 'source_snapshots are immutable'); END;
CREATE TRIGGER source_snapshots_no_delete BEFORE DELETE ON source_snapshots
BEGIN SELECT RAISE(ABORT, 'source_snapshots are immutable'); END;

-- policy_events: firm_id now references collection_owners.
CREATE TABLE policy_events_v2 (
    id       TEXT PRIMARY KEY,
    at       TEXT NOT NULL,
    host     TEXT,
    firm_id  TEXT REFERENCES collection_owners (id) ON DELETE RESTRICT,
    kind     TEXT NOT NULL CHECK (kind IN ('terms_recorded', 'unclear_terms_accepted', 'circuit_tripped',
        'circuit_reenabled', 'circuit_expired', 'robots_fetched', 'content_signal_seen', 'host_added',
        'firm_disabled', 'firm_enabled', 'publisher_added', 'publisher_updated', 'publisher_enabled',
        'publisher_disabled')),
    detail   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
    run_id   TEXT
) STRICT;
INSERT INTO policy_events_v2 (id, at, host, firm_id, kind, detail, run_id)
    SELECT id, at, host, firm_id, kind, detail, run_id FROM policy_events;
DROP TABLE policy_events;
ALTER TABLE policy_events_v2 RENAME TO policy_events;
CREATE INDEX ix_policy_events_host ON policy_events (host, at);
CREATE TRIGGER policy_events_no_update BEFORE UPDATE ON policy_events
BEGIN SELECT RAISE(ABORT, 'policy_events are append-only'); END;
CREATE TRIGGER policy_events_no_delete BEFORE DELETE ON policy_events
BEGIN SELECT RAISE(ABORT, 'policy_events are append-only'); END;

-- ---------------------------------------------------------------- comparison publishers

CREATE TABLE directory_publishers (
    id               TEXT PRIMARY KEY REFERENCES collection_owners (id) ON DELETE RESTRICT,
    publisher_key    TEXT NOT NULL UNIQUE CHECK (
        length(publisher_key) BETWEEN 2 AND 64 AND publisher_key GLOB '[a-z0-9]*'
        AND publisher_key NOT GLOB '*[^a-z0-9-]*'),
    display_name     TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
    homepage_url     TEXT NOT NULL CHECK (homepage_url GLOB 'https://?*' OR homepage_url GLOB 'http://?*'),
    adapter          TEXT NOT NULL CHECK (length(adapter) BETWEEN 1 AND 64),
    capture_mode     TEXT NOT NULL DEFAULT 'auto' CHECK (capture_mode IN ('auto', 'manual_only')),
    enabled          INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    disabled_reason  TEXT,
    max_fetches      INTEGER CHECK (max_fetches IS NULL OR max_fetches BETWEEN 1 AND 300),
    max_depth        INTEGER CHECK (max_depth IS NULL OR max_depth BETWEEN 0 AND 5),
    allowed_paths    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_paths) AND json_type(allowed_paths) = 'array'),
    excluded_paths   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(excluded_paths) AND json_type(excluded_paths) = 'array'),
    notes            TEXT,
    policy_review    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(policy_review)),
    preset_version   TEXT,
    created_at       TEXT NOT NULL CHECK (created_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    updated_at       TEXT NOT NULL,
    CHECK (enabled = 1 OR disabled_reason IS NOT NULL),
    CHECK (capture_mode = 'auto' OR enabled = 0)
) STRICT;

CREATE TRIGGER directory_publishers_owner_kind BEFORE INSERT ON directory_publishers
WHEN (SELECT kind FROM collection_owners WHERE id = NEW.id) IS NOT 'publisher'
BEGIN SELECT RAISE(ABORT, 'a publisher needs a collection_owners row of kind publisher'); END;

-- One row per (snapshot, adapter version): what the adapter made of a stored page.
CREATE TABLE directory_extractions (
    id               TEXT PRIMARY KEY,
    publisher_id     TEXT NOT NULL REFERENCES directory_publishers (id) ON DELETE RESTRICT,
    source_id        TEXT NOT NULL REFERENCES collector_sources (id) ON DELETE RESTRICT,
    snapshot_id      TEXT NOT NULL REFERENCES source_snapshots (id) ON DELETE RESTRICT,
    attempt_id       TEXT NOT NULL REFERENCES fetch_attempts (id) ON DELETE RESTRICT,
    adapter_name     TEXT NOT NULL,
    adapter_version  TEXT NOT NULL,
    page_kind        TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('collected', 'no_records', 'js_unavailable', 'structure_changed',
        'parse_error', 'unsupported_page')),
    detail           TEXT,
    record_count     INTEGER NOT NULL CHECK (record_count >= 0),
    warnings         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings)),
    extracted_at     TEXT NOT NULL CHECK (extracted_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    UNIQUE (snapshot_id, adapter_name, adapter_version)
) STRICT;
CREATE INDEX ix_directory_extractions_source ON directory_extractions (source_id, extracted_at);

CREATE TRIGGER directory_extractions_no_update BEFORE UPDATE ON directory_extractions
BEGIN SELECT RAISE(ABORT, 'directory_extractions are append-only'); END;
CREATE TRIGGER directory_extractions_no_delete BEFORE DELETE ON directory_extractions
BEGIN SELECT RAISE(ABORT, 'directory_extractions are append-only'); END;

-- One field value as one publisher displayed it on one page version, with its full provenance.
CREATE TABLE directory_observations (
    id                   TEXT PRIMARY KEY,
    extraction_id        TEXT NOT NULL REFERENCES directory_extractions (id) ON DELETE RESTRICT,
    publisher_id         TEXT NOT NULL REFERENCES directory_publishers (id) ON DELETE RESTRICT,
    source_id            TEXT NOT NULL REFERENCES collector_sources (id) ON DELETE RESTRICT,
    snapshot_id          TEXT NOT NULL REFERENCES source_snapshots (id) ON DELETE RESTRICT,
    record_key           TEXT NOT NULL,
    publisher_entry_id   TEXT,
    entry_url            TEXT,
    firm_name            TEXT NOT NULL CHECK (length(firm_name) BETWEEN 1 AND 200),
    firm_norm            TEXT NOT NULL,
    programme_name       TEXT,
    programme_norm       TEXT NOT NULL DEFAULT '',
    variant              TEXT,
    variant_norm         TEXT NOT NULL DEFAULT '',
    account_size_raw     TEXT,
    account_size         TEXT CHECK (account_size IS NULL OR account_size NOT GLOB '*[^0-9.]*'),
    currency             TEXT,
    phase                TEXT NOT NULL CHECK (phase IN ('evaluation', 'evaluation_step_1', 'evaluation_step_2',
        'evaluation_step_3', 'simulated_funded', 'instant_funded', 'unspecified')),
    market               TEXT NOT NULL CHECK (market IN ('futures', 'forex_cfd', 'crypto', 'stocks', 'multiple',
        'unspecified')),
    first_party_url      TEXT,
    field                TEXT NOT NULL,
    raw_label            TEXT NOT NULL,
    raw_value            TEXT NOT NULL,
    value_kind           TEXT NOT NULL CHECK (value_kind IN ('value', 'unknown', 'none', 'not_applicable',
        'see_rules')),
    normalized           TEXT CHECK (normalized IS NULL OR json_valid(normalized)),
    confidence           TEXT NOT NULL CHECK (confidence IN ('observed', 'uncertain')),
    uncertain_reason     TEXT,
    publisher_qualifier  TEXT,
    location             TEXT NOT NULL,
    page_url             TEXT NOT NULL,
    observed_at          TEXT NOT NULL CHECK (observed_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    content_hash         TEXT NOT NULL CHECK (length(content_hash) = 71 AND content_hash GLOB 'sha256:*'),
    adapter_name         TEXT NOT NULL,
    adapter_version      TEXT NOT NULL,
    capture_channel      TEXT NOT NULL CHECK (capture_channel IN
        ('http', 'browser', 'platform_api', 'manual_capture', 'fixture_replay')),
    CHECK (value_kind = 'value' OR normalized IS NULL),
    CHECK (confidence = 'observed' OR uncertain_reason IS NOT NULL)
) STRICT;
CREATE INDEX ix_directory_observations_record ON directory_observations (record_key, field);
CREATE INDEX ix_directory_observations_firm ON directory_observations (firm_norm, publisher_id);
CREATE INDEX ix_directory_observations_extraction ON directory_observations (extraction_id);

CREATE TRIGGER directory_observations_no_update BEFORE UPDATE ON directory_observations
BEGIN SELECT RAISE(ABORT, 'directory_observations are immutable'); END;
CREATE TRIGGER directory_observations_no_delete BEFORE DELETE ON directory_observations
BEGIN SELECT RAISE(ABORT, 'directory_observations are immutable'); END;

-- Operator review actions: identity mappings, notes, dismissals and official-verification records. Append-only;
-- the latest action for a subject wins. They never change an observation, a firm rule or the FundedFlow app.
CREATE TABLE directory_review_actions (
    id                    TEXT PRIMARY KEY,
    at                    TEXT NOT NULL CHECK (at GLOB
        '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9].[0-9][0-9][0-9]Z'),
    action                TEXT NOT NULL CHECK (action IN ('map_firm', 'unmap_firm', 'keep_separate', 'annotate',
        'dismiss', 'verify_official', 'unverify')),
    subject_type          TEXT NOT NULL CHECK (subject_type IN ('firm_name', 'record', 'observation',
        'review_item')),
    subject_key           TEXT NOT NULL CHECK (length(subject_key) BETWEEN 1 AND 300),
    firm_key              TEXT,
    official_snapshot_id  TEXT REFERENCES source_snapshots (id) ON DELETE RESTRICT,
    note                  TEXT,
    CHECK (action <> 'map_firm' OR firm_key IS NOT NULL),
    CHECK (action <> 'verify_official' OR (official_snapshot_id IS NOT NULL AND length(note) >= 3)),
    CHECK (action NOT IN ('annotate', 'dismiss') OR length(note) >= 1)
) STRICT;
CREATE INDEX ix_directory_review_subject ON directory_review_actions (subject_type, subject_key, at);

CREATE TRIGGER directory_review_actions_no_update BEFORE UPDATE ON directory_review_actions
BEGIN SELECT RAISE(ABORT, 'directory_review_actions are append-only'); END;
CREATE TRIGGER directory_review_actions_no_delete BEFORE DELETE ON directory_review_actions
BEGIN SELECT RAISE(ABORT, 'directory_review_actions are append-only'); END;
