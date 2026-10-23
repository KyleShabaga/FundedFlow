# FundedFlow prop-firm collector (Build 29, 29.25)

A standalone Windows command-line tool that collects **public** prop-firm rule pages as **unverified evidence**:
a source registry, a polite and fail-closed fetching pipeline, an immutable snapshot archive in its own SQLite
file, and a versioned JSON export for Build 31. Since Build 29.25 it can also read **comparison publishers**
(third-party sites that compare many firms) into unverified, field-level observations, kept apart from the firms'
own sources and exported in their own format.

It does **not** interpret rules, log in, approve anything, use AI, or touch the FundedFlow app or its database.

- Plain-language guide for operators: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- Architecture and design decisions: [`../../docs/architecture/prop-firm-collector.md`](../../docs/architecture/prop-firm-collector.md)
- Export contract (JSON Schema): [`../../docs/contracts/collector-snapshot-v1.schema.json`](../../docs/contracts/collector-snapshot-v1.schema.json)
- Comparison publishers: adapter guide and source matrix [`docs/adapters.md`](docs/adapters.md); export contract
  [`../../docs/contracts/collector-directory-observations-v1.schema.json`](../../docs/contracts/collector-directory-observations-v1.schema.json)
- Asking a firm for permission: [`docs/permission-request.md`](docs/permission-request.md)

## License

The collector is MIT-licensed; see [LICENSE](LICENSE) (the same text as the repository root license).
Dependencies retain their own licenses. Collected pages, PDFs and other third-party content are not
relicensed under MIT by being fetched, stored or exported by the collector. Existing source-permission,
robots.txt and dependency checks still apply.

## Being a good citizen

The collector avoids being blocked by being a low-volume, honest, well-behaved visitor, **never by disguising
itself**. When a site says no, it stops for that host, records why, and points you to manual capture. A blocked
host is a valid, logged outcome, not a bug to work around.

**Never, in code or configuration:** stealth or fingerprint spoofing, fake or rotating browser User-Agents,
proxies/VPN/IP rotation, CAPTCHA or challenge solving, cookie replay, logins, paywalls, or hosted scraping or
unblocker services. No setting can turn any of these on (unknown settings are rejected), and CI fails if a banned
package (`crawl4ai`, `playwright-stealth`, `undetected-chromedriver`, `cloudscraper`, `curl_cffi`, PyMuPDF, Firecrawl,
Apify, ScrapingBee, Bright Data, …) appears in `uv.lock`.

**Honest identity.** `Mozilla/5.0 (compatible; FundedFlowCollector/0.1; +<your info URL>)`. Live fetching is refused
until you set `user_agent.info_url`.

**Permission first.** Every host must be authorised by you (`host add`) and have a current terms-of-use review
(`host terms`, valid 365 days): `allowed` or `allowed_with_limits` permit fetching; `unclear` only with
`--accept-unclear-terms` and slower 5 s pacing; `prohibited` means manual capture only. robots.txt is obeyed per
RFC 9309 (product token `FundedFlowCollector`, falling back to `*`); an unreachable robots.txt means disallow-all.

**Light footprint.** GET only, one host at a time, at least 2 s between requests (or the site's `Crawl-delay`
if slower), slower again when responses get slow, 75 requests per firm per run by default (300 maximum),
conditional requests (`If-None-Match`/`If-Modified-Since`) and sitemap `lastmod` to skip unchanged pages, no
images/fonts/CSS/JS in HTTP mode, no cookies, and system proxies ignored. Runs happen only when you type a command.
There is no scheduler.

**Stops when told.** 401, 451, a 403 that persists after one retry, or any bot challenge stops the host until you run
`host reenable`. The third 429 in a run stops it for 24 hours. The collector never retries through another path,
subdomain, method or channel.

**Manual capture always works.** Save the page in your browser (Save page as, or Print to PDF) and run
`import-capture`. It makes no network requests and is the recommended path for the first real firms.

**Network safety.** Only http(s) on ports 80/443 to hosts you authorised. DNS is resolved once per connection and
the connection goes to that validated public IP (private, loopback, link-local, metadata and reserved addresses are
refused, including after redirects and DNS rebinding). Response sizes, decompression, PDFs (separate process with
time, page and memory limits) and sitemaps (no DTDs or entities) are all bounded. All page content is treated as
untrusted data.

## Install (Windows 10/11, PowerShell)

```powershell
winget install --id astral-sh.uv -e
cd tools\prop-firm-collector
uv sync                       # Python 3.12 and the hash-locked dependencies
uv run collector doctor
```

Optional JavaScript rendering (plain Playwright Chromium, used automatically when a page has too little text):

```powershell
uv sync --extra browser
uv run playwright install chromium
```

Prefer a window? `uv run collector-gui` (or `.\scripts\create-shortcut.ps1` for a desktop shortcut) opens a desktop
window with the same functions: Setup, Firms, Fetch, Manual capture, Results and Export. It is plain tkinter (part of
Python), adds no dependencies or network services, and calls the same code as the commands below.

Data lives in `%LOCALAPPDATA%\FundedFlow\Collector\` (`collector.db`, `collector.toml`, `logs\`, `exports\`).
Override with `--data-dir` or `FFC_DATA_DIR`. The collector refuses any path inside the FundedFlow app's data folder
(`%APPDATA%\com.fundedflow.desktop\`) or named `fundedflow.db`.

## Commands

Run as `uv run collector <command>`; every command has `--help`.

| Command | Purpose |
|---|---|
| `doctor` | Installation, safety settings, terms reviews, stopped hosts |
| `init-db` | Create the data folder, database and an example `collector.toml` |
| `firm add / list / show / update / disable / enable / import` | Register firms (`import --file` reads a TOML definition such as [`config/firms/example-firm.toml`](config/firms/example-firm.toml)) |
| `host add / list / terms / reenable` | Authorise a firm's own hosts, record terms reviews, re-enable a stopped host |
| `source add / list / update / disable / enable` | Seed URLs: `page`, `pdf`, `sitemap`, `zendesk` (`https://help.example.com/hc/en-us`) |
| `discover` | robots.txt sitemaps, `/sitemap.xml` and Zendesk listings → candidate URLs (no snapshots) |
| `fetch` | Discovery (unless `--no-discover`), then seeds and relevant pages within the budget. `--dry-run` shows allowed vs blocked with no network; `--force` ignores lastmod/304; `--no-browser`; `--headed`; `--max-fetches N` |
| `import-capture` | Store a page you saved from your browser (`.html`, `.htm`, `.pdf`, `.txt`), no network |
| `runs`, `runs show RUN` | Runs and every attempt with its outcome and reason |
| `snapshots`, `snapshots show ID [--text]` | Stored snapshots and their provenance |
| `export` / `validate` | Write / check the v1 evidence envelope (`--csv` adds a diagnostic CSV without page text) |
| `prune-raw` | Delete expired raw bytes (only when `raw.retain = true`; snapshots are never deleted) |
| `reset --yes` | Delete the collector's own database, logs and exports |
| `gui` | Open the desktop window (same as `collector-gui`) |
| `directory presets / add-preset / add / list / show / update / enable / disable` | Comparison publishers: the four presets (installed **disabled**), other permitted publishers, scope and limits |
| `directory host-add / terms / seed-add` | A publisher's own hosts (never a firm's), terms reviews, starting pages |
| `directory fetch` | Collect from publishers through the same pipeline (`--publisher KEY` repeatable or `--all`, `--dry-run`, `--fixture-site`) |
| `directory capture` | Import a saved publisher page (also `import-capture --publisher`), no network |
| `directory observations / show-observation` | Unverified values with status, provenance, history and the firm's own stored pages |
| `directory review list / map / separate / note / verify / unverify` | Conflicts, duplicates, uncertain identities, stale pages; mappings and notes (never approvals) |
| `directory export` | Write `collector-directory-observations-v1` (`validate` checks it) |

`--fixture-site DIR` (on `discover` and `fetch`) replays a local folder instead of the network. The synthetic
fixture in [`examples/fixture-site`](examples/fixture-site) is what the tests and the user guide use; anything
collected that way is recorded as `fetch_method = fixture_replay`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done; everything fetched, unchanged or skipped as unchanged |
| 2 | Usage error |
| 3 | Configuration or registry error (bad URL, unknown firm, missing info URL, invalid settings) |
| 4 | Done, but some targets were blocked by policy (robots, terms, allowlist, stopped host, budget) |
| 5 | Done, but some targets failed (HTTP error, timeout, parse error) |
| 6 | Export or file failed schema validation |
| 7 | Database problem, or a path inside the FundedFlow app data folder |
| 130 | Interrupted (Ctrl+C); work so far is saved and the run is marked aborted |

## What gets stored

Every run and attempt (URL, final URL and redirects, method, time, HTTP status, selected headers, outcome, policy
reason, parser) goes into append-only tables. Each distinct normalised document becomes an immutable snapshot keyed
by `sha256:<hex>` of its normalised content (`norm-v1`). An unchanged page adds an attempt, not a snapshot; a page
that changes back reuses its earlier snapshot. Failed or blocked attempts never touch existing snapshots. A changed
hash means the page text changed, **not** that a rule changed.

## Export for Build 31

`collector export` writes `schema_version: 1`, `verification_status: "unverified"` JSON with firms, hosts (terms
decision, robots `Content-Signal` lines, circuit state), sources and snapshots (requested/final URL, capture time,
method, text, headings, tables, links, hashes, parser, warnings, observation counts). It contains no rules, money,
phases, programmes, prices or approvals. The schema's description documents how Build 31 maps a snapshot onto
`sourceReferenceSchema` in `packages/domain`. A synthetic consumer fixture is in
[`tests/fixtures/collector-snapshot-v1.json`](tests/fixtures/collector-snapshot-v1.json).

## Development

```powershell
uv sync --all-extras
uv run playwright install chromium
uv run python scripts/check_lockfile.py
uv run ruff check src tests scripts
uv run ruff format --check src tests scripts
uv run mypy src tests
uv run pytest
```

Tests never touch the network: `pytest-socket` blocks sockets, and HTTP goes through mock transports or the fixture
site. Browser tests fulfil every request from the fixture site and point Chromium's resolver at nothing. After an
intentional change to the export, regenerate the fixture with `$env:FFC_UPDATE_FIXTURES=1; uv run pytest
tests/contract` and review the diff. `tests/make_fixtures.py` regenerates the synthetic firm sites and
`tests/make_directory_fixtures.py` the synthetic publisher pages (invented firms; never real publisher content).

CI: [`.github/workflows/prop-firm-collector.yml`](../../.github/workflows/prop-firm-collector.yml) (Windows, Python 3.12,
runs only when collector files change).

## Known limitations

- Zendesk is the only platform adapter. Intercom, Help Scout and GitBook need their documentation reviewed first.
- robots.txt applies to Zendesk API URLs exactly as to pages, so a help center whose robots.txt disallows `/api/`
  is `robots_blocked` by design; use manual capture for it.
- A page that renders its text with JavaScript, behind an unchanged HTML shell, answers 304 and is reported
  `unchanged`; use `--force` to re-render it.
- MHTML ("single file") captures are not supported; save as HTML, PDF or text.
- `published_at`/`effective_at` are always null: Build 29 never infers business dates.
- PDF memory limits are enforced by a watchdog that samples every 50 ms, not a hard OS limit.
- Comparison publishers: the four adapters were written against the publishers' public page structure as reviewed on
  2026-10-21 and tested on synthetic pages only. No live run against those sites has been made or verified; their
  terms are unclear or prohibit automated access, and Prop Firm Match refuses automated requests, so it is manual
  capture only. A redesign shows as `structure_changed` (nothing is guessed): see [`docs/adapters.md`](docs/adapters.md).
- Publishers use their seed pages and their adapter's links only; sitemap discovery (and sitemap `lastmod`) is not
  used for them. Conditional requests (ETag, Last-Modified) and content hashing work as for firms.
- Values are read from visible tables only, never from scripts' embedded data or private APIs, so a list that a site
  builds in the browser needs the `[browser]` extra or a manual capture.
