# Build 29: prop-firm source registry and safe page-fetching collector

Card: https://app.notion.com/p/3fe1bd4b6bde81c791c5ccbfbbad4190 · branch `feat/build-29-prop-firm-collector`.
Status: **architecture checkpoint, awaiting owner approval.** No collector code exists yet.

The card's "Research addendum — safety and block-avoidance" (October 20, 2026, with the relaxed-defaults
revision) is authoritative wherever it conflicts with the older sections below it. This document follows the
addendum. Section numbers like "§4" refer to the addendum.

## 1. Scope in one paragraph

A standalone Windows Python 3.12 command-line tool under `tools/prop-firm-collector/`. The operator registers
fictitious or real prop firms, authorises their first-party hosts, records a terms-of-use decision per host, and
runs explicit, sequential, polite collection commands. The tool discovers public pages (seed URLs, sitemaps,
Zendesk Help Center article listings, bounded link following), fetches them through a DNS-pinned HTTP client
behind a fail-closed policy pipeline, extracts readable text with structure, and stores immutable,
content-addressed snapshots in its **own** SQLite file. Pages can also be imported from files the operator saved
in a browser, with no network access. A versioned JSON envelope exports the snapshots as **unverified evidence**
for Build 31. Build 29 does not interpret rules, approve anything, write to the FundedFlow app database, or use AI.

## 2. Baseline and independence check (checked 2026-10-20)

| Area | State on `main` (`970306b`) | Consequence for Build 29 |
|---|---|---|
| Python | No `.py` files, no `pyproject.toml`, no `tools/` directory | Greenfield project; no precedent to follow or break |
| Licence | Proprietary, source-available (`LICENSE`) | Permissive dependencies only (MIT/BSD/Apache/PSF). PyMuPDF (AGPL) rejected |
| CI | `ci.yml` (npm + Rust, `windows-latest`), `dev-tools.yml` (path-filtered) | New path-filtered workflow; existing workflows untouched |
| Build 9 catalogue | `packages/domain/src/catalogue/*`, migration 6 `catalogue_sources` | Read-only design constraint. Export fields line up with `sourceReferenceSchema` (§9.4) |
| Build 9.5 rulebooks | `packages/domain/src/rulebook/*`, migration 9 | Not touched. No rule values in the export |
| Phase enum | `phaseKeys = evaluation, simulated_funded, live_funded, other, unknown` | Never appears as a field in the export; Build 31 owns classification |
| Hash convention | `sha256:` + 64 lowercase hex (`sourceReferenceSchema.contentHash`, migration 6 CHECK) | Collector uses exactly this format |
| Instant format | `catalogueInstant`: `YYYY-MM-DDTHH:MM:SS.sssZ` | Collector stores and exports UTC instants in exactly this format |
| `.gitignore` | Ignores `*.db`, `logs`, `.env*` | Add Python caches/venv entries for `tools/prop-firm-collector/` |
| Build 29.5 | Not started (regression fixtures for **extraction**) | Build 29 owns fetch/policy/parser/schema tests only |
| Build 31 | Not started (TS pattern extraction from snapshots) | Consumes the v1 envelope later; not needed now |
| Build 32 | Not started (review queue, approval) | No review states, no approvals in Build 29 |
| Build 40 | Not started, Stage 2 (hosted crawler, scheduler) | No scheduler, no hosted service, no Firecrawl/Apify/Crawl4AI |

Everything Build 29 needs (Python runtime, SQLite, HTTP, parsers, CI runner) is available without any other
build. The card was audited at `7740d26`; reconciled with `970306b`: migrations 14–17 and Builds 15.5–20 landed
in between, none of which touch catalogue sources or add Python. No conflicts.

**CLAUDE.md note.** CLAUDE.md says "P2 and Web V2 items are not V1 work". The card is now `P1 — V1.5`, and the
card owns scope, so Build 29 proceeds. I'll add the collector's checks to CLAUDE.md's "Checks" section (one
line) so future sessions run them.

## 3. Repository layout

```
tools/prop-firm-collector/
  pyproject.toml            # hatchling backend, Python >=3.12, console script `collector`
  uv.lock                   # hash-locked; the CI banned-dependency check reads it
  README.md                 # setup, commands, "Being a good citizen", links to the guide
  docs/
    USER_GUIDE.md           # D8, written last from real runs (13 sections from §10c)
    permission-request.md   # template email asking a firm for permission or a machine-readable source
  config/
    collector.example.toml  # global settings (UA info URL, pacing, budgets, browser fallback)
    firms/example-firm.toml # synthetic firm definition for `firm import`
  src/fundedflow_collector/
    __init__.py             # __version__, USER_AGENT_TOKEN = "FundedFlowCollector"
    __main__.py             # `python -m fundedflow_collector`
    cli/                    # Typer apps: main, firm, host, source, run/inspect, export, doctor
      exit_codes.py         # stable exit codes (§5.3)
      output.py             # plain tables; `--json` machine output on read commands
    config.py               # TOML (tomllib) -> Pydantic v2 settings with hard floors/ceilings
    paths.py                # data dir resolution, app-database guard
    outcomes.py             # Outcome enum and circuit states (single source of truth)
    db/
      connection.py         # sqlite3, WAL, foreign_keys=ON, busy_timeout, backups before upgrade
      migrate.py            # versioned SQL migrations with checksums
      migrations/0001_initial.sql
      registry.py  runs.py  snapshots.py  policy_log.py   # repositories, plain SQL
    policy/
      urls.py               # parse, canonicalise, allowlist, excluded paths, URL caps
      addresses.py          # "globally routable" check for IPv4/IPv6 (ipaddress module)
      terms.py              # terms gate
      robots.py             # protego wrapper, RFC 9309 status matrix, Content-Signal capture, cache
      circuit.py            # host circuit breaker and cooldowns
      pacing.py             # per-host delay, adaptive slow-down, jitter
      budget.py             # per-run fetch budget and deadline
      pipeline.py           # ordered checks -> Decision(allowed | blocked(outcome, reason))
    net/
      resolver.py           # Resolver protocol; system resolver via socket.getaddrinfo
      pinned_backend.py     # custom httpcore NetworkBackend: resolve once, validate, connect to IP
      transport.py          # httpx BaseTransport over httpcore.ConnectionPool(network_backend=...)
      client.py             # GET only, manual redirect loop, conditional headers, byte caps, retries
      challenge.py          # bot-challenge detection (headers and body markers)
      fixture_transport.py  # offline replay of a fixture site directory (§5.4)
    discovery/
      sitemaps.py           # defusedxml, .xml.gz streaming cap, index depth <=2, cycle detection
      links.py              # bounded link following from fetched HTML
      relevance.py          # URL/anchor keyword ranking (prioritisation only, not extraction)
      zendesk.py            # Help Center list/incremental articles adapter
    parse/
      html.py               # byte cap, trafilatura + bs4/lxml; headings, tables, link context
      pdf.py                # parent side: child process, timeout, psutil memory watchdog, caps
      pdf_worker.py         # child side: pypdf text extraction (run with `python -I -m`)
      text.py               # plain-text capture
      normalise.py          # canonical text normalisation (versioned)
      hashing.py            # canonical payload -> sha256:<hex>
    render/
      browser.py            # optional Playwright adapter, route allowlist, host-resolver-rules
    capture.py              # D7 manual capture import (zero network)
    runner.py               # one firm run: discover -> queue -> policy -> fetch -> parse -> store
    export/
      envelope.py           # Pydantic models for envelope v1, deterministic serialisation
      validate.py           # jsonschema (Draft 2020-12) validation against the checked-in schema
      csv_diag.py           # optional diagnostic CSV (URLs and snapshot metadata only)
    logging_setup.py        # JSON-lines file log + redaction filter
    safety.py               # banned-dependency list shared by `doctor` and tests
  tests/
    conftest.py             # pytest-socket on; temp data dirs; fake resolver/backends
    fixtures/
      site/                 # synthetic fixture sites (two fictitious firms, .test hosts)
      captures/             # saved HTML/PDF/TXT for import-capture tests
      collector-snapshot-v1.json   # D5 synthetic export fixture
    unit/  integration/  contract/  security/
docs/contracts/collector-snapshot-v1.schema.json   # D5 checked-in JSON Schema
docs/architecture/prop-firm-collector.md           # this document
.github/workflows/prop-firm-collector.yml          # new Windows Python CI job
```

The root `README.md` gets one row in its layout table pointing at `tools/prop-firm-collector`. Nothing under
`apps/` or `packages/` changes.

## 4. Dependencies

Exact versions are locked (with hashes) in `uv.lock` at implementation time, using the newest patched releases.
Licences were checked against the proprietary repo.

| Purpose | Package | Licence | Notes |
|---|---|---|---|
| CLI | `typer` (brings `click`, `rich`) | MIT/BSD | Chosen over argparse for typed sub-commands and generated help |
| Config/models | `pydantic` v2 | MIT | Config validation and export models |
| Export validation | `jsonschema` | MIT | Draft 2020-12 |
| HTTP | `httpx`, `httpcore` (both pinned exactly), `brotli` | BSD-3 / MIT | `brotli` only so `Accept-Encoding: br` is honest; HTTP/1.1 only |
| robots.txt | `protego` | BSD-3 | Newest release (past ReDoS advisory) |
| XML | `defusedxml`, `lxml` | PSF / BSD-3 | |
| HTML | `trafilatura` (>=1.8, Apache-2.0), `beautifulsoup4` | Apache-2.0 / MIT | `trafilatura.downloads`/`fetch_url` banned by a ruff `banned-api` rule: all I/O goes through our client |
| PDF | `pypdf` (newest patched), `psutil` | BSD-3 | Child process only |
| Browser (extra `[browser]`) | `playwright` | Apache-2.0 | Optional; plain Chromium |
| Dev | `pytest`, `respx`, `pytest-socket`, `ruff`, `mypy`, `pip-audit`, type stubs | MIT/BSD/Apache | |

**Banned** (CI fails if any appear in `uv.lock`; `doctor` checks installed distributions): `crawl4ai`,
`playwright-stealth`, `undetected-chromedriver`, `cloudscraper`, `curl_cffi`, `pymupdf`/`fitz`, `selenium-stealth`,
`scrapingbee`, `firecrawl`/`firecrawl-py`, `apify-client`, `brightdata`/`brightdata-sdk`, `zenrows`,
`scraperapi`. The list lives in `safety.py` so one edit updates both checks.

## 5. CLI and operator workflow

Entry point: `collector` (console script), run as `uv run collector …` from PowerShell. Read commands accept
`--json`. Every network command processes one firm, or `--all` firms one after another, never in parallel.

### 5.1 Commands

| Command | Purpose |
|---|---|
| `collector --help`, `--version` | Help and version |
| `collector doctor` | Python version, data dir, DB schema version, UA info URL set, banned packages absent, browser extra installed or not (and Chromium present), per-host terms status and expiry, open circuits and cooldowns |
| `collector init-db [--data-dir PATH]` | Create the data dir and apply migrations (idempotent) |
| `collector firm add KEY --name … --homepage URL [--max-fetches N] [--max-depth N] [--exclude PATTERN …]` | Register a firm (`KEY` is a slug, e.g. `example-firm`) |
| `collector firm list` / `show KEY` / `update KEY …` / `disable KEY --reason …` / `enable KEY` | Registry maintenance |
| `collector firm import --file firm.toml` | Create or update a firm, its hosts and sources from a TOML file (deterministic upsert) |
| `collector host add --firm KEY --host HOST --role homepage\|help_center\|docs\|asset` | Authorise a first-party host. `asset` hosts are browser sub-resources only, never fetched as documents |
| `collector host list [--firm KEY]` | Hosts with terms decision, review age, circuit state |
| `collector host terms --firm KEY --host HOST --decision allowed\|allowed_with_limits\|prohibited\|unclear --terms-url URL [--notes …] [--min-delay SECONDS] [--accept-unclear-terms]` | Record the operator's terms review. `--accept-unclear-terms` is required for `unclear` to permit fetching and is logged with a timestamp |
| `collector host reenable --host HOST --reason …` | Close a circuit after a block (the only way out of `blocked_bot_protection` and `access_denied`) |
| `collector source add --firm KEY --url URL --kind page\|pdf\|sitemap\|zendesk [--requires-js] [--no-js] [--label …] [--priority N]` | Add a seed source |
| `collector source list [--firm KEY]` / `update ID …` / `disable ID` | Source maintenance |
| `collector discover (--firm KEY \| --all) [--dry-run]` | robots, sitemaps and Zendesk listings into `discovered_links`; no snapshots |
| `collector fetch (--firm KEY \| --all) [--dry-run] [--force] [--no-discover] [--no-browser] [--headed] [--max-fetches N] [--fixture-site DIR]` | Full run: discovery (unless `--no-discover`), then seeds and ranked discovered links within budget, bounded link following, snapshots |
| `collector import-capture --firm KEY --url URL --file PATH [--captured-at UTC]` | D7 manual capture (`.html`/`.htm`, `.pdf`, `.txt`); zero network |
| `collector runs [--firm KEY] [--limit N]` / `runs show RUN_ID` | Runs and their attempts with outcomes |
| `collector snapshots [--firm KEY] [--url URL]` / `snapshots show ID [--text]` | Snapshots; `show` is the minimal local inspector (escaped plain text, never rendered HTML) |
| `collector export (--firm KEY … \| --all) [--out PATH] [--include-attempts] [--generated-at UTC] [--csv PATH]` | Write and self-validate an envelope v1 file |
| `collector validate FILE` | Validate any envelope file against the checked-in schema |
| `collector prune-raw` | Delete raw bytes past retention (snapshots are never deleted) |
| `collector reset --yes` | Delete the collector database, logs and exports in the collector data dir only |

`--dry-run` makes no network calls and writes nothing. It prints every candidate target with `allowed` or the
blocking outcome (not allowlisted, excluded path, terms, cached robots verdict or "robots.txt not cached: would
fetch first", open circuit, over budget).

### 5.2 Operator workflow

1. `uv sync` (optionally `uv sync --extra browser` + `uv run playwright install chromium`), then `collector doctor`.
2. Set `user_agent.info_url` in `collector.toml`. Live fetching refuses to start without it.
3. `collector init-db`.
4. `firm add` (or `firm import`), `host add` for each first-party host, `host terms …` after reading the terms
   page, `source add` for seeds.
5. `collector fetch --firm KEY --dry-run`, check allowed vs blocked.
6. `collector fetch --firm KEY` (about 2.5–3 minutes at the default 75 fetches and 2 s pacing).
7. For blocked or `prohibited` hosts: save pages in the browser and `import-capture` them.
8. `collector runs`, `collector snapshots`, then `collector export --all --out …` for Build 31.

### 5.3 Exit codes

| Code | Meaning |
|---|---|
| 0 | Command completed; every target ended `new_snapshot`, `matched_earlier_snapshot`, `unchanged` or `skipped_lastmod` |
| 2 | Usage error (Typer/Click default) |
| 3 | Configuration or registry validation error (bad URL, unknown firm, missing UA info URL, invalid TOML) |
| 4 | Run completed, but at least one target was blocked by policy (robots, terms, allowlist, circuit, budget) |
| 5 | Run completed, but at least one target failed to fetch or parse (network, HTTP error, timeout, parse) |
| 6 | Export or envelope failed schema validation |
| 7 | Database error (migration checksum mismatch, constraint violation, locked) or app-database guard refusal |
| 1 | Unexpected internal error |

When both 4 and 5 apply, 5 wins. A blocked host is a normal, logged outcome; the distinct code lets scripts tell
"done, some hosts said no" from "done, everything fetched".

### 5.4 Fixture replay mode

`fetch --fixture-site DIR` replaces the network transport with a file-backed `httpx.MockTransport` serving a
fixture directory (`robots.txt`, sitemaps, HTML, PDF, plus an optional `_responses.toml` for status codes and
headers such as `ETag`, `Retry-After` or `cf-mitigated`). No DNS, no sockets. The whole policy pipeline,
parsing, storage and export run unchanged. Attempts and snapshots record `fetch_method = fixture_replay`, so
replayed data can never pass as live evidence. In browser mode, `page.route` fulfils requests from the same
directory. This drives the integration tests, the user-guide walkthrough and the PR's Windows evidence.

## 6. Configuration

Global settings live in `collector.toml` (default path: the data dir; override with `--config` or
`FFC_CONFIG`). Pydantic validates it; out-of-range values fail with exit 3 instead of being clamped silently.

| Setting | Default | Bound |
|---|---|---|
| `user_agent.info_url` | none (live fetch refuses) | `https` URL |
| `user_agent.contact` | none | optional email or URL |
| `pacing.min_delay_seconds` | 2.0 | floor 1.0 |
| `pacing.unclear_terms_delay_seconds` | 5.0 | floor 5.0 |
| `pacing.jitter_ms` | 250 | 0–500 |
| `budget.fetches_per_firm_run` | 75 | ceiling 300 |
| `budget.run_deadline_minutes` | 20 | ceiling 120 |
| `limits.max_depth` | 2 | ceiling 5 |
| `limits.max_response_bytes` | 5 MiB (HTML), 20 MiB (PDF) | ceilings 10 / 50 MiB |
| `limits.timeout_seconds` | connect 10, read 20, total 30 | |
| `pdf.timeout_seconds` / `max_pages` / `max_memory_mib` | 30 / 50 / 512 | |
| `browser.enabled` | `auto` (used if installed) | `auto`, `off` |
| `browser.min_text_chars` | 300 | |
| `raw.retain` / `raw.retention_days` | `false` / 90 | |

There are no settings for proxies, User-Agent replacement, cookies, ports other than 80/443, private addresses
or robots/terms bypass. The Pydantic model forbids unknown keys, so `proxy = …` or `stealth = true` is a
configuration error, and a test asserts that.

Firm-level limits (`max_fetches`, `max_depth`, excluded paths) may only tighten the global ones. A host's terms
`--min-delay` may only slow pacing down.

**Data directory.** Default `%LOCALAPPDATA%\FundedFlow\Collector\` (`collector.db`, `logs\`, `exports\`), override
with `--data-dir` or `FFC_DATA_DIR`. `paths.py` refuses any database path inside
`%APPDATA%\com.fundedflow.desktop\` or named `fundedflow.db` (exit 7). The collector never opens the app database.

## 7. SQLite schema and migrations

One file, `collector.db`. `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. All tables `STRICT`.
IDs are text. Instants are `YYYY-MM-DDTHH:MM:SS.sssZ` with `GLOB` CHECKs matching migration 6's style.

**Migrations.** `db/migrations/NNNN_name.sql`, shipped as package data, applied in order inside a transaction and
recorded in `schema_migrations (version, name, sha256, applied_at)`. A changed checksum for an applied migration
stops the tool (exit 7). Before applying a migration to an existing database, the tool writes a backup copy with
the sqlite3 backup API (`collector.db.bak-<version>`). At startup, runs left `running` by a crash are marked
`aborted` (recovery test).

| Table | Purpose and key constraints | Mutability |
|---|---|---|
| `collector_firms` | `id`, `firm_key` UNIQUE slug, `display_name`, `homepage_url`, `enabled`, `disabled_reason`, firm limits, `excluded_paths` (JSON array), timestamps | Updatable (registry) |
| `collector_hosts` | `firm_id`, `host` (lowercase, IDNA A-label), `role`, `terms_url`, `terms_decision`, `terms_reviewed_at`, `terms_notes`, `terms_min_delay_seconds`, `unclear_terms_accepted_at`; UNIQUE(`firm_id`, `host`) | Updatable (registry) |
| `host_circuits` | Per host (not per firm): `state` (`closed`, `rate_limited`, `blocked_bot_protection`, `access_denied`), `reason`, `tripped_at`, `cooldown_until`, `tripped_run_id` | Updatable |
| `robots_cache` | `host`, `fetched_at`, `status_class` (`parsed`, `unavailable`, `unreachable`), `http_status`, `body` (≤500 KiB), `content_signals` (JSON) | Replaced after 24 h |
| `collector_sources` | `id`, `firm_id`, `canonical_url`, `kind` (`page`, `pdf`, `sitemap`, `zendesk`), `source_channel` (`manual_capture`, `platform_api`, `sitemap`, `link`, `seed`), `requires_js`, `js_disabled`, `enabled`, `priority`, `label`; last-state columns `etag`, `last_modified`, `sitemap_lastmod`, `last_attempt_at`, `last_success_at`, `last_outcome`, `latest_snapshot_id`, `zendesk_cursor`; UNIQUE(`firm_id`, `canonical_url`) | Registry fields and last state updatable; never deleted (disable instead) |
| `crawl_runs` | `id`, `batch_id` (shared by an `--all` run), `firm_id`, `command`, `started_at`, `finished_at`, `status` (`running`, `completed`, `deadline_exceeded`, `aborted`), `fetches_used`, `options` (JSON), `config_sha256`, `collector_version` | Insert, then one completion update |
| `fetch_attempts` | `id`, `run_id` (NULL for manual capture), `firm_id`, `source_id`, `requested_url`, `final_url`, `redirect_chain` (JSON), `fetch_method` (`http`, `browser`, `platform_api`, `manual_capture`, `fixture_replay`), `started_at`, `duration_ms`, `resolved_ip`, `conditional` (sent `If-None-Match`/`If-Modified-Since`), `http_status`, `response_headers` (allow-listed subset, redacted), `bytes`, `raw_sha256`, `outcome`, `policy_reason`, `error_detail`, `parser_name`, `parser_version`, `snapshot_id` | **Append-only** (triggers reject UPDATE/DELETE) |
| `discovered_links` | `id`, `run_id`, `firm_id`, `url` (canonical), `via` (`sitemap`, `robots_sitemap`, `link`, `zendesk`), `from_attempt_id`, `anchor_text`, `sitemap_lastmod`, `depth`, `relevance`, `decision` (`queued` or the blocking outcome), `discovered_at` | Append-only |
| `source_snapshots` | `id`, `source_id`, `firm_id`, `content_hash`, `normalization_version`, `captured_at`, `first_attempt_id`, `final_url`, `title`, `text`, `structure` (JSON: headings, tables, links), `content_type`, `fetch_method`, `parser_name`, `parser_version`, `warnings` (JSON), `raw_sha256`, `platform_metadata` (JSON, e.g. Zendesk article id and `updated_at`); UNIQUE(`source_id`, `content_hash`) | **Immutable** (triggers reject UPDATE/DELETE) |
| `raw_payloads` | `sha256` PK, `bytes`, `content_type`, `stored_at`, `expires_at` | Only when `raw.retain = true`; pruned by `prune-raw` |
| `policy_events` | `id`, `at`, `host`, `firm_id`, `kind` (`terms_recorded`, `unclear_terms_accepted`, `circuit_tripped`, `circuit_reenabled`, `robots_fetched`, `content_signal_seen`), `detail` (JSON), `run_id` | Append-only (the policy log) |
| `export_batches` | `export_id`, `generated_at`, `path`, `firm_keys` (JSON), `snapshot_count`, `file_sha256`, `schema_version` | Insert-only |

There are no tables for rule candidates, programmes, account sizes, phases, review decisions or approved rulebooks.

**Snapshot identity and dedupe.** `snapshot_id = "snap_" + first 32 hex of sha256(firm_key | canonical_url |
content_hash)`, so the same evidence gets the same ID in any database. `source_id` is derived the same way from
`firm_key | canonical_url`. Run and attempt IDs are random UUIDv4 because they are events.

- Same hash as the source's latest snapshot, or a 304 → attempt `unchanged`, no new snapshot.
- New hash → new immutable snapshot, attempt `new_snapshot`.
- Hash equal to an *earlier* (not latest) snapshot, content went A → B → A → attempt `matched_earlier_snapshot`
  pointing at the existing row; `latest_snapshot_id` moves back. No duplicate row.
- Failed or blocked attempts never touch snapshots.

First/last-seen and observation counts are computed from `fetch_attempts` at export time; they're not stored on
the immutable snapshot row.

## 8. Fetch, policy and security architecture

### 8.1 Policy pipeline (fail closed, in this order, for every URL including robots, sitemaps and API URLs)

```
URL -> 1 parse & canonicalise -> 2 allowlist & excluded paths -> 3 firm/source enabled
    -> 4 terms gate -> 5 circuit breaker -> 6 budget & deadline -> 7 robots.txt (RFC 9309)
    -> 8 sitemap lastmod skip -> 9 pacing wait -> 10 DNS-pinned GET (per redirect hop: repeat 1, 2, 4, 5, 7)
    -> 11 response classification (challenge, status, type, size) -> 12 parse -> 13 store
```

Each step returns `allow` or `block(outcome, reason)`; the first block ends processing for that URL, is written
as a `fetch_attempts` row (with no request made for steps 1–9), and the runner moves on, or stops the host if the
circuit tripped.

1. **URLs.** `http`/`https` only; no userinfo; ports 80/443 only; length ≤ 2,048; host lowercased and
   IDNA-encoded; default port dropped; path percent-encoding normalised; fragment stripped for fetching (original
   kept); query kept but sorted keys are **not** reordered (servers may care). Literal IP hosts rejected.
2. **Allowlist.** Host must be an authorised non-`asset` host of the firm (exact match; subdomains need their own
   entry). Excluded path patterns (glob) apply. Sitemap and robots `Sitemap:` references to other hosts are
   dropped and logged.
3. **Terms gate (§4).** Live fetch only when the host's decision is `allowed`, `allowed_with_limits`, or `unclear`
   with `unclear_terms_accepted_at` set, and `terms_reviewed_at` is within 365 days. No review, a stale review or
   `prohibited` → `terms_blocked` (manual capture only). The tool never decides terms itself.
4. **Circuit breaker.** Open circuit → `circuit_open` without a request.
5. **Budget.** Each request counts toward the per-firm budget except robots.txt. Deadline per firm run.
6. **robots.txt (§3).** Fetched through the same pinned client, ≤ 500 KiB, ≤ 5 redirects within authorised hosts,
   cached ≤ 24 h. 2xx → parse with protego, match product token `FundedFlowCollector` then `*`; 4xx except 429 →
   `unavailable` (allowed, but the terms gate has already required a passing review); 429, 5xx, timeout, network
   error → `unreachable` = disallow all (`robots_unreachable`). `Crawl-delay`/`Request-rate` slow pacing if
   stricter. `Content-Signal` lines are captured raw, logged in `policy_events` and exported per host.
7. **Lastmod skip.** If a sitemap `lastmod` is not newer than the source's last successful snapshot →
   `skipped_lastmod`, unless `--force`.
8. **Pacing (§2).** One host at a time, concurrency 1. Delay = max(2 s, 5 s if unclear-terms, terms
   `--min-delay`, robots crawl-delay/request-rate), plus 0–250 ms jitter only to avoid lockstep. Adaptive: if a
   response takes longer than 3 s, the next delay becomes max(delay, 2 × response time), capped at 60 s.

### 8.2 DNS-pinned transport (§6)

- `PinnedNetworkBackend` implements httpcore's `NetworkBackend.connect_tcp(host, port, …)`: resolve `host` once
  via the injected `Resolver`, reject if **any** returned address is not globally routable (loopback, private,
  link-local incl. `169.254.169.254`, CGNAT, multicast, reserved, unspecified, IPv4-mapped/6to4/Teredo forms
  unwrapped and checked), then open the socket to the validated IP. httpcore still passes the original hostname
  for TLS SNI and the `Host` header comes from the request URL, so certificates are verified against the real name.
- `PinnedTransport` is a thin `httpx.BaseTransport` over `httpcore.ConnectionPool(network_backend=…, http1=True,
  http2=False, retries=0)` with a fresh pool per host per run (no reuse across hosts).
- `httpx.Client(transport=PinnedTransport, trust_env=False, follow_redirects=False, cookies=None, verify=True)`.
  A cookie jar that discards everything is installed; `Set-Cookie` is ignored and never sent.
- Redirects: manual loop, max 5; each hop re-runs canonicalisation, allowlist, terms, circuit and robots before
  the next request, and re-resolves and re-validates DNS in the backend.
- Caps: response headers ≤ 64 KiB total; body read with `iter_bytes()` (decoded) and aborted past the byte cap
  (`too_large`), which also caps gzip/br decompression bombs.
- `httpx` and `httpcore` are pinned exactly because the backend uses httpcore's backend interface. A test fails
  loudly if the installed versions differ from the tested ones.

### 8.3 Requests and responses

- `GET` only. Headers: `User-Agent: Mozilla/5.0 (compatible; FundedFlowCollector/0.1; +<info_url>[; <contact>])`,
  truthful `Accept` per expected type (`text/html,application/xhtml+xml` / `application/xml` / `application/pdf` /
  `application/json` for Zendesk), `Accept-Language: en`, `Accept-Encoding: gzip, deflate, br`, plus
  `If-None-Match`/`If-Modified-Since` when stored.
- HTTP mode never fetches images, fonts, CSS or JS. Content types outside HTML, XHTML, XML, PDF, plain text and
  JSON (API only) → `unsupported_content_type`.

### 8.4 Retry and circuit-breaker matrix

| Response | Retry | Attempt outcome | Host circuit |
|---|---|---|---|
| 200 | — | parse → `new_snapshot` / `unchanged` / `matched_earlier_snapshot` | — |
| 304 | — | `unchanged` (no body) | — |
| 401 or 451 | none | `access_denied` | `access_denied`, manual re-enable |
| 403 with challenge markers | none | `blocked_bot_protection` | `blocked_bot_protection`, manual re-enable |
| 403 without markers | once after 60 s | `access_denied` if it persists | `access_denied`, manual re-enable |
| Challenge page on any status (`cf-mitigated: challenge`, "Just a moment…", `/cdn-cgi/challenge-platform`, equivalent Akamai/PerimeterX/DataDome/Imperva markers) | none | `blocked_bot_protection` | `blocked_bot_protection`, manual re-enable |
| 429 (1st, 2nd in run) | honour `Retry-After` (cap 5 min; default 60 s if absent) | `rate_limited` if retries exhausted | — |
| 429 (3rd in run) | none | `rate_limited` | `rate_limited`, auto-expires after 24 h |
| 404, 410, other 4xx | none | `http_error` | — |
| 5xx | twice, backoff 5 s then 15 s | `server_error` | — |
| Timeout / connection error | once after 10 s | `timeout` / `network_error` | — |

When a circuit trips, every remaining queued URL on that host ends `circuit_open` and the run continues with other
hosts of the same firm. No retry via another path, subdomain, method or channel.

### 8.5 Outcome codes

`new_snapshot`, `matched_earlier_snapshot`, `unchanged`, `skipped_lastmod`, `not_allowlisted`, `excluded_path`,
`url_rejected`, `address_blocked` (non-global IP), `terms_blocked`, `robots_blocked`, `robots_unreachable`,
`circuit_open`, `budget_exhausted`, `deadline_exceeded`, `access_denied`, `blocked_bot_protection`,
`rate_limited`, `http_error`, `server_error`, `timeout`, `network_error`, `too_large`,
`unsupported_content_type`, `parse_error`, `parse_timeout`, `thin_content` (too little text and no browser
available), `render_unavailable`, `render_error`. One enum in `outcomes.py`; the user guide's outcome table is
generated from it and checked by a test so they can't drift.

### 8.6 Logging and data handling

JSON-lines log in `logs\collector-YYYYMMDD.jsonl` plus readable console output. A redaction filter removes
`Authorization`, `Cookie`, `Set-Cookie` and token-like query values (`token`, `key`, `sig`, `signature`,
`session`, `auth`, `code`, `password`, JWT-shaped or long hex values) before anything is logged or stored in
`response_headers`. Raw bytes are not stored by default; when enabled they expire after 90 days. Normalised text
is kept (Build 31 needs it). Repo fixtures are synthetic only.

## 9. Adapters, extraction and export

### 9.1 Discovery

- **Seeds** from `collector_sources`.
- **Sitemaps**: robots `Sitemap:` lines (authorised hosts only) plus `/sitemap.xml` on each authorised host.
  `defusedxml` parsing; `.xml.gz` decompressed by streaming with a cap; ≤ 50,000 URLs per file; index depth ≤ 2;
  cycle detection by canonical URL; each sitemap fetch counts toward the budget.
- **Zendesk Help Center** (`kind = zendesk`, source URL = `https://help.example.test/hc/en-us`): list-articles
  endpoint, anonymous, paginated, then the documented incremental endpoint with the stored cursor time on later
  runs (exact paths and pagination confirmed against Zendesk's docs during implementation). Each article becomes a
  source whose `canonical_url` is the article's `html_url` and whose content is the API `body` HTML, so one API
  page can yield many snapshots without fetching each article page. Every API call goes through the full
  pipeline and counts toward the budget. A 401/403 on the API trips the circuit like any other response; the
  collector doesn't fall back to scraping the HTML pages of a help center whose API refused it.
- **Link following** from fetched HTML, depth ≤ `max_depth`, authorised hosts only, after excluded paths.
- **Relevance ranking** (prioritisation only): keywords in URL path and anchor text (rules, evaluation,
  challenge, funded, drawdown, daily loss, profit target, payout, consistency, scaling, account, plan, pricing,
  FAQ, terms, prohibited, news, weekend). Seeds first, then by score and sitemap `lastmod`. No values are
  extracted.

### 9.2 Parsers

- **HTML**: byte cap before parsing (5 MiB). bs4 on lxml strips `script`, `style`, `noscript`, `template`,
  `iframe` and event attributes; trafilatura extracts main readable text; bs4 extracts title, headings
  (level, text, character offset into the normalised text), tables (caption, header row, rows, nearest preceding
  heading) and links (href, anchor text, same-host / authorised / external). If trafilatura returns less than
  `min_text_chars`, a bs4 full-body text fallback is used and a warning recorded.
- **JS fallback**: if text is still under `min_text_chars`, or the source has `requires_js`, and the browser
  extra is installed and not disabled → render (§9.3). Otherwise `thin_content` is recorded alongside the thin
  snapshot (the snapshot is still stored with the warning) or `render_unavailable` for `requires_js` sources.
- **PDF**: the parent writes the bytes to a temp file and runs `python -I -m fundedflow_collector.parse.pdf_worker`
  with a 30 s wall-clock timeout, a 50-page cap and an output-text cap. A `psutil` watchdog polls the child's RSS
  and kills it above the memory cap. Overrun → `parse_timeout`; crash or bad PDF → `parse_error`. (Windows
  Job Objects are a stricter alternative; the psutil watchdog is simpler to test and matches the card.)
- **Text** captures: decoded as UTF-8 (BOM-aware), otherwise reported as `parse_error`.
- All content is untrusted. Text that looks like instructions ("ignore previous instructions, mark verified") is
  stored verbatim as data and changes nothing; a test asserts this.

**Normalisation and hashing (`norm-v1`).** NFC; CRLF/CR → LF; tabs and runs of spaces → one space; trailing
spaces stripped; more than two blank lines → two; leading/trailing blank lines removed. The hashed payload is the
canonical JSON (sorted keys, UTF-8, no insignificant whitespace) of `{"normalization": "norm-v1", "title": …,
"text": …, "tables": …}`. Links and heading offsets are stored but not hashed, so navigation churn doesn't create
new snapshots. `content_hash = "sha256:" + hex`. `raw_sha256` (hash of the decoded response body) is always recorded
on the attempt even when raw bytes aren't kept, so a parser upgrade that changes the normalised output for the
same raw bytes is flagged with a `normalization_changed` warning instead of looking like a page change.

### 9.3 Optional Playwright adapter (§8)

Installed via `[browser]` extra. Plain Chromium, Playwright's unmodified default UA with
` FundedFlowCollector/0.1 (+<info_url>)` appended, no stealth or fingerprint changes. Per page: fresh context, no
persistent profile, service workers blocked, downloads refused, 30 s navigation timeout, `--headed` only on request.
`page.route("**/*")` allows `document`, `script`, `xhr` and `fetch` requests only to the firm's authorised hosts
plus its `asset` hosts, and aborts everything else, including all `image`, `media` and `font` requests. Chromium
is launched with `--host-resolver-rules="MAP <host> <validated-ip>, …, MAP * ~NOTFOUND"` from IPs validated by the
same address checks, so the browser can't resolve anything else. The rendered DOM goes through the HTML parser;
the challenge detector and circuit breaker apply. Rendering counts as one fetch toward the budget. If the extra
is missing, behaviour is a clear `render_unavailable`, never an error.

### 9.4 Manual capture (D7)

`import-capture` reads the file, picks the parser by extension (`.html`/`.htm`, `.pdf`, `.txt`), and stores
the snapshot through the same normalise → hash → dedupe → store path with `fetch_method = manual_capture`,
`source_channel = manual_capture`, a `fetch_attempts` row with `run_id = NULL`, and `captured_at` from
`--captured-at` (UTC) or now. The URL's host must be registered for the firm (any terms decision, including
`prohibited`), so provenance stays first-party. A test runs it under `pytest-socket` with the resolver and
transport replaced by fakes that fail on any call. MHTML ("single file") captures are a follow-up, not Build 29.

### 9.5 Export envelope v1 (D5)

`docs/contracts/collector-snapshot-v1.schema.json` (JSON Schema Draft 2020-12, `additionalProperties: false`
throughout). Shape:

```jsonc
{
  "schema_version": 1,
  "kind": "fundedflow.collector.evidence",
  "export_id": "exp_<32 hex>",           // sha256 of the canonical body without export_id/generated_at
  "generated_at": "2026-10-21T12:00:00.000Z",
  "verification_status": "unverified",   // const; not a value of the app's verificationStatuses enum
  "notice": "Unverified source evidence collected by FundedFlowCollector. Not rules, not verified provider data.",
  "producer": { "name": "fundedflow-collector", "version": "0.1.0",
                "normalization_version": "norm-v1", "hash_algorithm": "sha256" },
  "firms": [{
    "firm_key": "example-firm", "display_name": "Example Prop Firm (synthetic)",
    "homepage_url": "https://www.example-firm.test/",
    "hosts": [{ "host": "help.example-firm.test", "role": "help_center",
                "authorisation": "operator_approved_first_party",
                "terms_decision": "allowed", "terms_reviewed_at": "…", "terms_url": "…",
                "content_signals": ["search=yes, ai-train=no"] }],
    "sources": [{ "source_id": "src_…", "canonical_url": "…", "kind": "page",
                  "source_channel": "sitemap",
                  "latest_attempt": { "at": "…", "outcome": "unchanged", "http_status": 304, "policy_reason": null } }]
  }],
  "snapshots": [{
    "snapshot_id": "snap_…", "firm_key": "example-firm", "source_id": "src_…",
    "requested_url": "…", "final_url": "…", "canonical_url": "…", "redirect_chain": ["…"],
    "captured_at": "…", "fetch_method": "http", "source_channel": "sitemap",
    "http_status": 200, "content_type": "text/html",
    "title": "…", "text": "…",
    "headings": [{ "level": 2, "text": "Daily loss limit", "offset": 1234 }],
    "tables": [{ "caption": null, "preceding_heading": "Account sizes",
                 "headers": ["Plan", "Profit target"], "rows": [["…", "…"]] }],
    "links": [{ "href": "…", "text": "…", "scope": "same_host" }],
    "content_hash": "sha256:…", "raw_sha256": "sha256:…",
    "parser": { "name": "trafilatura+bs4", "version": "…" },
    "extraction_warnings": ["thin_content"],
    "stated_dates": { "published_at": null, "effective_at": null },   // always null in Build 29
    "platform_metadata": null,              // e.g. { "zendesk": { "article_id": 1, "updated_at": "…", "locale": "en-us" } }
    "observations": { "first_seen_at": "…", "last_seen_at": "…", "observation_count": 3 }
  }],
  "attempts": []                            // only with --include-attempts
}
```

- **Deterministic:** firms by `firm_key`, sources by `canonical_url`, snapshots by `(firm_key, canonical_url,
  captured_at)`; sorted keys, UTF-8, `\n` endings, no floats anywhere. The same database and `--generated-at`
  give byte-identical files; `export_id` is stable for the same evidence regardless of `generated_at`.
- **Not in the payload:** inferred rules, account sizes, money amounts, phases/stages, programme or variant keys,
  verification approvals, app catalogue IDs, pricing. The schema has no field for any of these.
- Every export is validated before it's written; a failure exits 6 and leaves no partial file. The checked-in
  fixture `tests/fixtures/collector-snapshot-v1.json` is generated from the synthetic walkthrough and pinned by a
  test.
- Optional `--csv` diagnostic: one row per snapshot with URLs, hashes, times, outcome; no text.

**How Build 31/32 map it to existing contracts later** (documented in the schema's `description` and the README):

| Envelope | `sourceReferenceSchema` (`packages/domain/src/catalogue/provenance.ts`) |
|---|---|
| `final_url` | `url` |
| `host.authorisation = operator_approved_first_party` | `sourceType: "official"` only after a reviewer agrees; otherwise `"unknown"` |
| `display_name` | `publisher` |
| manual capture | `descriptor: "Manual capture by operator, <captured_at>"` (URL still kept) |
| `captured_at` | `capturedAt` (same instant format) |
| `stated_dates.*` (null) | `publishedAt`, `effectiveFrom` stay null unless a reviewer sets them; capture time is never an effective date |
| `content_hash` | `contentHash` (same `sha256:` format; change detection only, as the app's comment says) |
| `producer.version` + `parser.version` | `importerVersion` (e.g. `fundedflow-collector/0.1.0 norm-v1`) |
| `verification_status: "unverified"` | `verificationStatus: "draft"` or `"needs_review"`, never `verified` |

Money and phases are Build 31's job: amounts found in text must become canonical decimal text / micro-units with an
explicit currency (never floats, unknown ≠ zero), and stage wording must map to `evaluation`, `simulated_funded`,
`live_funded`, `other` or `unknown` (never `sim_funded`, never silently evaluation ↔ simulated funded).

## 10. Testing strategy

All tests run offline. `pytest-socket` is on for the whole suite (`--disable-socket --allow-hosts=127.0.0.1`
only for the loopback backend test that injects a test-only address policy in code; no config can do that).

| Area | Tests |
|---|---|
| Config | defaults; floors/ceilings rejected; unknown keys (`proxy`, `stealth`, `user_agent.override`) rejected; missing info URL blocks live fetch |
| Paths | app-database guard refuses `%APPDATA%\com.fundedflow.desktop\…` and `fundedflow.db`; full walkthrough with `APPDATA` pointed at a temp dir creates nothing there |
| URLs | schemes, userinfo, ports, IDNA/Unicode, percent-encoding, fragments, duplicates, length caps, literal IPs, excluded paths, subdomain not implied |
| Addresses | IPv4 and IPv6 private/loopback/link-local/metadata/CGNAT/multicast/reserved, mapped and 6to4/Teredo forms, mixed results where one address is bad |
| DNS pinning | fake resolver: connect goes to the validated IP; SNI/Host keep the name; rebinding (second resolution returns 127.0.0.1) cannot change the connected IP; each redirect hop re-resolves; redirect to private host blocked; redirect off-allowlist blocked; > 5 redirects |
| robots | full status-code matrix (2xx, 401/403/404/410, 429, 5xx, timeout, network error, redirect in/out of allowlist); product-token vs `*` groups; longest match; crawl-delay/request-rate; oversize file; `Content-Signal` capture; 24 h cache |
| Terms | refuses `prohibited`, `unclear` without acknowledgement, missing and > 365-day-old reviews; `--accept-unclear-terms` recorded with timestamp; 5 s pacing applied |
| Circuit | 401, 451, challenge headers and body markers, 403 retried once then trip, 3 × 429 trip, `Retry-After` honoured and capped, 24 h auto-expiry, manual re-enable for bot protection, no retry via other path |
| Pacing/budget | delays honoured with a fake clock, adaptive slow-down, jitter bounds, 75 default and 300 ceiling, deadline |
| Fetch | 304 conditional path; byte caps incl. gzip/br bombs; header cap; content-type rejection; cookies never sent; GET only |
| Sitemaps | index depth, cycles, 50k cap, gzip cap, malformed XML, XXE/billion-laughs rejected, cross-host entries dropped, lastmod skip and `--force` |
| Zendesk | pagination, incremental cursor, article → source mapping, API 401/403 trips circuit and no HTML fallback |
| Parsers | malformed HTML, script stripping, tables and headings, Unicode, thin-content fallback; PDF fixture text; malformed PDF; PDF timeout and memory kill (a worker that sleeps/allocates under test) |
| Browser (marker `browser`, skipped if the extra or Chromium is missing) | route blocking of off-allowlist hosts and images/fonts; JS-rendered fixture text; host-resolver-rules applied; challenge detection |
| Storage | migrations from empty and re-run idempotent; checksum mismatch refused; backup written; crash recovery marks runs aborted; immutability triggers; unique constraints; unchanged → one snapshot and many attempts; changed → new snapshot; A→B→A; failures keep old snapshots |
| Capture | HTML/PDF/TXT import with zero network; host must belong to firm; same dedupe as live |
| Export | schema-valid; determinism (byte-identical twice); `export_id` stable; invalid envelopes rejected; no forbidden fields; consumer test parses the fixture with only `json` + `jsonschema` (no collector imports) |
| Hostile content | instruction-like text stored verbatim; nothing becomes verified or changes policy |
| Supply chain | banned packages absent from `uv.lock`; `httpx`/`httpcore` exact pins match |
| CLI | `--help` for every command; exit codes 0/3/4/5/6/7; `--dry-run` makes no requests and writes nothing; end-to-end synthetic walkthrough with `--fixture-site` (register two firms → discover → fetch HTML/PDF/rendered → rerun unchanged → mutate fixture → refetch → inspect → export → validate) |

### CI

New `.github/workflows/prop-firm-collector.yml`, `windows-latest`, triggered on pull requests and pushes to
`main` that touch `tools/prop-firm-collector/**`, `docs/contracts/collector-*` or the workflow file. Existing
workflows are not modified.

1. `astral-sh/setup-uv` (pinned) and Python 3.12; `uv sync --locked --all-extras --dev`.
2. Banned-dependency check on `uv.lock`.
3. `ruff check`, `ruff format --check`, `mypy --strict src tests`.
4. `pytest` (socket-disabled), including contract validation and the CLI walkthrough.
5. `uv run playwright install chromium`, then `pytest -m browser`.
6. `pip-audit` against the exported locked requirements.

## 11. Commit plan

Small commits on this branch, roughly: architecture doc → project skeleton, config, paths, CI workflow →
schema and migrations → URL/address policy → DNS-pinned transport → robots, terms, circuit, pacing →
fetch client and fixture replay → sitemaps, links, Zendesk → HTML/PDF/text parsers → runner and CLI →
manual capture → export, schema, fixture → browser adapter → README and user guide from real runs → PR.

## 12. Risks

| Risk | Mitigation |
|---|---|
| The pinned backend relies on httpcore's backend interface, which can change between releases | Exact pins, a version-check test, the backend kept small with its own tests |
| trafilatura output changes between versions cause snapshot churn | `parser_version` and `norm-v1` recorded; `raw_sha256` comparison flags `normalization_changed` |
| protego ReDoS / slow matching | Newest release, 500 KiB and URL-length caps, oversized patterns dropped with a warning; match time measured and a slow host treated as `robots_unreachable` |
| pypdf DoS CVEs | Newest patched pin, child process, timeout, page/text caps, psutil memory watchdog, `pip-audit` in CI |
| Chromium does its own DNS | `--host-resolver-rules` with `MAP * ~NOTFOUND`, route allowlist, tested |
| Many real firms will be `prohibited` or block the collector | Expected; manual capture is first-class and recommended for the first real firms |
| Local machine has Python 3.13 and no `uv` | `uv` installs and manages Python 3.12 itself; see open question 1 |
| A WAF block can affect the operator's own browsing of a firm's site | Conservative defaults, honest UA, immediate stop, VPN guidance in the user guide |

## 13. Open decisions for the owner

Defaults in **bold** are what I'll build unless you say otherwise.

1. **Local toolchain.** This PC has Python 3.13.15 and no `uv`. I need to install `uv`
   (`winget install astral-sh.uv`), which then installs Python 3.12 for the project. **Install it.**
2. **UA info URL.** Live fetching requires one. Tests use `https://example.invalid/fundedflow-collector`.
   Proposed recommendation in the guide: **the repository URL (`https://github.com/KyleShabaga/FundedFlow`) or a
   page you control; you set it, nothing is hard-coded.**
3. **401/451/persistent 403.** The card says "stop that host for the run" and only specifies persistence for
   429 and bot challenges. Proposed: **treat these as `access_denied` that needs a manual `host reenable`**
   (fail closed). Alternative: run-only.
4. **`fetch` runs discovery first** by default (`--no-discover` to skip), so one command covers the routine.
   **Yes.**
5. **`--fixture-site` replay in the shipped CLI**, recorded as `fetch_method = fixture_replay`. It makes the
   Windows walkthrough and offline mode possible without weakening the loopback/private-address block. **Yes.**
6. **Raw bytes:** off by default; when on, stored in `raw_payloads` inside `collector.db` for 90 days. **Yes.**
7. **Browser tests in CI:** install Chromium in the same workflow and run `pytest -m browser` as a required
   step (fully offline via `route.fulfill`). **Yes**; I'll mark it non-blocking only if it proves flaky.
8. **Exit codes** as in §5.3 (blocked hosts give 4, not 0). **Yes.**
9. **CLAUDE.md** gets one line listing the collector checks under "Checks". **Yes.**
