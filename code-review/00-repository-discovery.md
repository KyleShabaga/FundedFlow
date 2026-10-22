# FundedFlow Stage 1 audit, Phase 1 of 6: repository discovery and architecture map

| Field | Value |
|---|---|
| Review date | 2026-10-22 |
| Phase | 1 of 6: repository discovery, architecture mapping and audit planning |
| Scope status | **Complete** for discovery and mapping (see §11 for the depth limits). No findings are confirmed in this phase. |
| Repository root | `/home/user/FundedFlow` (cloud container clone of `KyleShabaga/FundedFlow`) |
| Branch / HEAD | `claude/practical-turing-wmii06` at `92e79802593f97d907bdf8b403a088304e203676` (merge of PR #106, `feat/p0-d24-review-controls`) |
| Working tree at start | Clean: no tracked or untracked changes. There was no `code-review/` folder and no prior audit reports. |
| Relation to snapshots | HEAD **equals** the 2026-10-22 handoff snapshot `92e7980`, so there is no source drift against it. The earlier tailoring snapshot `8c3dd34` is an ancestor, 116 commits behind HEAD (499 files changed). The relevant differences are in §0. The clone is shallow, but both snapshot commits and `7679edc` are present. |
| Host | Linux x86_64 container (kernel 6.18), bash. **This is not Windows and not WSL**, so no Windows runtime, WebView2, NSIS or installer behaviour could be observed. |
| Tooling present | Node v22.22.0, npm 10.9.4, cargo/rustc 1.97.0, Python 3.13.16, uv 0.11.32. |
| Checks executed | None. Phase 1 is read-only discovery: no build, test, lint, install, fetch or network command was run. Read-only `git`, `grep`, `find`, `sed` and `wc` were used. |
| Instruction files read | `CLAUDE.md` (repo root). There is no `.claude/` directory, no `.claude/rules/` and no `AGENTS.md`. Nothing in CLAUDE.md conflicts with this read-only audit. Its card, branch and PR conventions apply only to future approved implementation. |
| Input reports | None exist. This report is the first audit output. |
| Agents | Lead plus three read-only specialists: (1) frontend and shared domain, (2) Rust, Tauri and storage, (3) tooling, CI, evidence docs and the collector. All three returned. The lead re-checked the high-impact claims (lock, PRAGMAs, backup path, command registry, async command model, `sync_dir`, legal fail-open, freshness gateway, TS risk calculation, audit-guard, `.gitignore`, draft legal assertions) against source. |

---

## 0. Revision differences from the earlier tailoring snapshot (`8c3dd34` → `92e7980`)

`git diff --stat 8c3dd34 92e7980` reports 499 files changed (+18,635 / −1,057). Most of the change is UI cards, specs and evidence. The differences relevant to the pinned prompt facts:

| Path | Change | Effect on the prompt's pinned facts |
|---|---|---|
| `apps/desktop/src-tauri/migrations/`, `src/db/mod.rs`, `src/runtime.rs`, `src/legal.rs`, `src/data_controls/`, `capabilities/` | **No change** | Schema version 21, the storage layout and the permissions are the same as in the tailoring snapshot |
| `src-tauri/src/lib.rs` | Adds `commands::list_account_freshness` (P0-D06) | 108 release commands at HEAD |
| `src-tauri/tauri.conf.json` | Minimum window size 1024×640 → **800×480**; bundles `LICENSE` and `THIRD_PARTY_NOTICES.txt` as resources | Windows scaling and minimum-size checks (Phase 5) apply to the new minimum |
| `src-tauri/src/db/legacy_rulebook_tests.rs` | `ee52ec9`: "retain legacy fixture journals until connections close" (the fixture-lifetime fix) | Historical `legacy_rulebook_tests` failures (`docs/build-26.9-evidence.md:44`) are not current results |
| `.github/workflows/ci.yml` (+57 lines), `release-installer.yml` (+13) | Audit-guard resilience, notices check, broader PR path filter | Docs that describe the older workflow have drifted (R-26) |
| `apps/desktop/src/legal/{index,third-party,third-party-summary}` | Third-party summary added | The legal documents are still `0.1.0-draft` (§12) |
| `scripts/third-party-notices*` | New notices generator and test | Inventoried in §3 and the coverage matrix (D4) |

## 1. Executive architecture summary

FundedFlow is a single-window **Tauri 2** desktop app (Rust host plus a React 19/TypeScript UI in WebView2). It is a local-first trading journal for funded-account (prop-firm) futures traders. The repository is an **npm workspaces monorepo** with three parts:

- `apps/desktop` (`@fundedflow/desktop`) holds the React UI and the Rust crate in `apps/desktop/src-tauri`.
- `packages/domain` (`@fundedflow/domain`) holds framework-free Zod contracts, the bigint money primitives, the `JournalRepository` port, and the TypeScript risk engine, rulebook, catalogue and insights logic.
- `tools/prop-firm-collector` is a **separate** Python/uv tool. It is network-capable, but the desktop app does not consume its output.

All persistent journal data lives in **one bundled-SQLite file** (`rusqlite 0.40.2`, `bundled`) at `%APPDATA%\com.fundedflow.desktop\fundedflow.db`. Several other files sit beside it:

- managed attachment files (screenshots);
- pre-upgrade `VACUUM INTO` backups;
- restore staging and safety copies;
- a deletion-cleanup queue;
- an exclusive `fundedflow.lock`;
- the separate `legal-acceptance.json` first-run record.

The frontend never touches SQL or the filesystem. It calls **108 release Tauri commands** (plus 5 debug-only ones) through a typed, Zod-validated repository adapter. Startup opens, locks, backs up and migrates the journal (to schema `user_version` **21**) on a background thread. The UI gates data screens on a runtime state machine, so a broken journal never stops the window from opening.

The codebase is mature for its stage. Many earlier risks already have explicit, tested safeguards:

- per-migration transactions with pre-upgrade backups;
- refusal of a newer schema;
- a cross-process lock;
- a write lifecycle that handles uncertain outcomes;
- preview-digest-bound CSV commits;
- exact bigint money;
- Rust-generated parity and wire fixtures.

The largest open items are **evidence**, not code:

- No packaged Windows build of the current source has been smoke-tested on a clean machine.
- The owner-only legal text (v1.1 package) is not integrated; the repository still ships `0.1.0-draft` documents.

The code risks most worth deep review in later phases are:

- filesystem/DB atomicity on Windows (attachments, restore swap, erase);
- blocking work inside async commands holding the single connection mutex;
- fail-closed recovery states that could block startup;
- unbounded retained recovery copies;
- uncertain-write state held only in memory in the UI.

## 2. Technology and dependency overview

| Layer | Technology (version evidence) |
|---|---|
| Desktop host | Tauri 2 (`tauri 2.12.4`, `wry 0.57.0`, `tao 0.37.1`, `webview2-com 0.39.1` per `Cargo.lock`); `tauri-plugin-dialog 2.8.3` is the only registered plugin (`src-tauri/src/lib.rs:174`) |
| Rust crate | `apps/desktop/src-tauri/Cargo.toml:23-48`: serde/serde_json, rusqlite 0.40.2 `bundled`+`backup`, chrono 0.4 + chrono-tz 0.10, csv 1.3, rust_decimal 1.36, sha2, base64, uuid v7, zip 9 (no default features), tempfile, fs2 0.4. Release: LTO, `codegen-units=1`, `strip`, unwinding panics on purpose (no `panic=abort`). 460 crates in the lockfile. |
| Frontend | Versions from `apps/desktop/package.json` (ranges; exact versions are in the lockfile): React `^19.1.0`, `react-router-dom` `^7.18.4` (`HashRouter`), `@tanstack/react-query` `^5.104.5`, Zod `^4.6.7`, Radix dialog, dropdown, select, tabs and tooltip, `@tauri-apps/api` `^2`, `@tauri-apps/plugin-dialog` `^2.8.3`. Dev dependencies: TypeScript `~6.0.3`, Vite `^8.0.16`, Vitest `^5.0.3`, `@tauri-apps/cli` `^2`. TypeScript is strict. |
| Shared domain | `packages/domain`: ESM, `zod` is the only runtime dependency, enforced by `packages/domain/scripts/check-boundaries.mjs` |
| Tests | Vitest 5 (node by default; 53 desktop files opt into jsdom), Testing Library, user-event, axe-core 4.14 (`apps/desktop/src/test/axe.ts`); Rust `#[test]` (393 annotated functions in `src-tauri/src`); Node `--test` for scripts; pytest/ruff/mypy for the collector |
| Package management | npm workspaces, one root `package-lock.json` (lockfileVersion 3), `engines.node >=22`. There is no `.nvmrc` and no `rust-toolchain` file. |
| Packaging | NSIS only, `installMode: currentUser`, `webviewInstallMode: downloadBootstrapper` (silent), unsigned, no updater (`src-tauri/tauri.conf.json:29-57`) |
| CI | GitHub Actions on `windows-latest`: `ci.yml`, `release-installer.yml`, `dev-tools.yml` (ubuntu and windows), `prop-firm-collector.yml` |
| Collector | Python ≥3.12, hatchling, httpx (pinned), lxml, trafilatura, pypdf, optional Playwright; its own SQLite DB under `%LOCALAPPDATA%\FundedFlow\Collector` |

## 3. Repository structure and module responsibilities

The repository has 1,266 tracked files.

| Path | Responsibility |
|---|---|
| `CLAUDE.md`, `README.md`, `LICENSE` | Project rules (Notion card-first workflow, design system, money and time rules, checks), the developer and user guide, and the proprietary source-available licence |
| `package.json`, `package-lock.json` | Workspace root and scripts: `build`, `typecheck`, `test`, `check`, `dev:test-journal`, `seed`/`reset:test-journal`, `test:dev-scripts`, `notices`, `check:notices`, `test:notices`, `test:ci-scripts` |
| `apps/desktop/src/` | React app, 319 tracked files (details in §4) |
| `apps/desktop/src-tauri/` | Rust host, 130 tracked files, about 34k lines of `.rs` (details in §5) |
| `apps/desktop/src-tauri/migrations/` | 18 SQL migrations (versions 1–4, 6, 8, 9, 11–21). Versions 5, 7, 10 and 16 are Rust steps; 16 also embeds `0016_rulebook_events.sql`. |
| `apps/desktop/src-tauri/src/db/fixtures/` | Synthetic legacy journals `fundedflow-v3.db`, `-v4.db` and `-v8-legacy-rules.db` plus generators. Read-only for this audit. |
| `apps/desktop/scripts/` | `check-no-dev-tools.mjs` (fails a production `dist` that contains dev markers) and `smoke-shell.mjs` (Build 12 Linux CDP smoke; not wired to any npm script or CI) |
| `apps/desktop/THIRD_PARTY_NOTICES.txt` | Generated notices, bundled as an installer resource |
| `packages/domain/` | `src/` (43 files: contracts, engine, catalogue, insights, rulebook, risk, ports, primitives), `test/` (17 test files plus 10 JSON parity/contract fixtures), `scripts/` (`clean.mjs`, `check-boundaries.mjs`, `check-dist.mjs`, `check-engine-runtimes.mjs`, `generate-engine-contract-fixture.mjs`) |
| `scripts/` | `audit-guard.mjs`, `dev-test-journal.mjs`, `reset-test-data.mjs`, `dev-reset-handoff.mjs`, `third-party-notices.mjs`, each with a `node --test` suite |
| `test_csvimport/` | `Performance.csv` (Rust fixture; must stay unedited), JSON contract vectors (`build17/`, `identity/`, `limits/`), and two **unreferenced** CSVs, `Performance Oct 20.csv` and `Performance Oct 20(1).csv`, added in PR #25 (see R-19) |
| `docs/` | Data model (1,045 lines), architecture and contract notes per build, evidence and closeout docs, design specs (298 screen files, 85 mockups, references), brand assets, development guides, collector JSON schemas |
| `.github/workflows/` | 4 workflows, all with `permissions: contents: read` |
| `tools/prop-firm-collector/` | Standalone collector: 87 src files, 31 test files, `uv.lock`, its own README and docs |

Excluded from inspection as generated or dependency output: `node_modules/`, `packages/domain/dist/`, `apps/desktop/dist/`, `apps/desktop/src-tauri/target/` (ignored by `src-tauri/.gitignore`), `src-tauri/gen/schemas` (ignored), and Python caches.

## 4. Frontend architecture

**Boot** (`apps/desktop/src/main.tsx:11`):

1. The app awaits `preloadLegalAcceptance()`, which races against a 2 s timeout (`lib/data/legal.ts:47-60`).
2. It renders `<App/>` in StrictMode.
3. The providers nest in this order (`app/AppProviders.tsx:9-27`): `RootErrorBoundary` → `HashRouter` → `QueryClientProvider` (`retry:false`, `refetchOnWindowFocus:false`) → `RuntimeProvider` → `ToastProvider`.

**Gates:**

- **`LegalGate`** (`features/legal/components/LegalGate.tsx:15-23`) wraps every route. If the acceptance record cannot be saved, Accept still lets the user continue for the session (`features/legal/hooks.ts:33-48`; documented as intentional: "never trapped behind the screen").
- **`RuntimeGate`** wraps each data route (`App.tsx:30-41`). It renders nothing until the runtime has been ready once. After that, while the runtime is not ready, it keeps content mounted inside a disabled, `inert` fieldset (`components/RuntimeGate.tsx:108-121`).
- **Settings and data controls are deliberately left ungated** (`App.tsx:42`) so recovery remains possible.

**`RuntimeProvider`** (`app/RuntimeProvider.tsx:29-108`) is the only runtime state machine (`checking | recovering | ready | unavailable | unsupported-schema`):

- It polls `runtime_status` with a backoff of 500 ms → 8 s, at most 8 checks per cycle.
- Only an explicit Retry calls `retry_runtime`.
- While ready, it rechecks when the window regains focus.

**Routing** (`App.tsx:29-52`), using `HashRouter`:

| Route | Screen |
|---|---|
| `/` | Today |
| `/journal` | Journal: day, log and library views |
| `/journal/trades/:tradeId` | Trade detail |
| `/journal/days/:tradingDay` | Daily review |
| `/insights` | Insights |
| `/accounts`, `/accounts/:accountId` | Accounts |
| `/accounts/:id/rulebook[/versions/:vid]` | Rulebook |
| `/import`, `/import/quick`, `/import/history` | Imports |
| `/settings` | Settings |
| `/settings/developer` | Developer tools (lazy-loaded, `import.meta.env.DEV` only) |

**Feature folders** (`apps/desktop/src/features/`, 194 files, 38 test files):

- Screen features: accounts, today, journal, daily-reviews, insights, rulebooks, imports, settings, data-controls, legal.
- Data-only folders: evidence, ledger, library, references, reviews, trades.
- `shared/`.

**State.** TanStack Query is the cache. All feature keys come from one factory rooted at `["fundedflow","features"]` (`features/shared/query-keys.ts:6-69`). The legal key sits outside that root.

**Reads** go through `useFeatureQuery` (`features/shared/hooks/use-feature-query.ts:37-78`):

- enabled only while the runtime is ready;
- `staleTime` 30 s;
- one retry, for timeout or unexpected errors only;
- cached data is invalidated without a refetch when the runtime drops;
- a 10 s bounded read (60 s for CSV preview) via `features/shared/operations.ts:7-24`.

**Writes** go through `useFeatureMutation` (`features/shared/hooks/use-feature-mutation.ts:17-85`) and `features/shared/submissions.ts`:

- A per-scope lock is reserved synchronously.
- `WRITE_TIMEOUT_MS` is 30 s. A timeout, a `database`-kind write error, a non-repository error or a failed post-write DTO mapping becomes **uncertain-outcome**.
- The lock stays held until the user reviews re-read records and acknowledges.
- The UI for this is `UncertainOutcomeReview.tsx` plus per-feature `*WriteReview.tsx` components.

These write paths do **not** use that lifecycle:

- legal accept (raw `useMutation`);
- CSV preview (raw `useMutation`);
- data controls (a module-global lock with no timeout, `features/data-controls/hooks/data-controls.ts:14-46`).

**Shared preferences** are stored as journal settings:

- `accounts.active_account_id`;
- `display.time_zone`, an app-wide display-zone preference. It affects display only; trading days come from Rust.

**WebView storage:**

- `localStorage` holds only the sidebar-collapsed flag (`app/AppShell.tsx:46,60`).
- `sessionStorage` holds unsaved drafts **in plaintext**: trade review (`features/journal/components/ReviewCard.tsx:108-122`), daily review (`features/daily-reviews/components/DailyReviewPage.tsx:93-105`) and rulebook form (`features/rulebooks/components/unsaved.ts:15-29`). They are restored through `as` casts with shallow checks.
- There is no IndexedDB and there are no cookies.
- There is no `fetch`, XHR, WebSocket, `window.open` or shell/opener call in app source.

**Money and time.**

- Money is decimal text on the wire and bigint micro-units in the domain package (`packages/domain/src/primitives/money.ts`) and the design system (`design-system/format.ts:63-130`). Unknown values show as `—`.
- `moneyToNumberForDisplay` (`format.ts:169-171`) is used for chart geometry and in `features/journal/components/journal-model.ts:137-138`.
- Some domain refinements use `Number(v)` sign checks on decimal text (`packages/domain/src/contracts/fields.ts:10-11`, `account-lifecycle.ts:78`, `reviews.ts:252`, `daily-reviews.ts:194`). The architecture document (`docs/architecture/packages.md` §Money) acknowledges these as legacy.

**TypeScript.** The desktop is `strict` but lacks `noUncheckedIndexedAccess`; the domain package has it. There is no `any` in non-test source. About 84 non-test `as` casts exist, concentrated in the rulebook form view-models.

**Calculations in TypeScript.**

- The risk engine runs in TypeScript (`apps/desktop/src/lib/data/calculate-risk.ts:59-77`). Rust's `promote_account_risk` accepts the result only if the sources are unchanged inside its transaction.
- Insights metrics also run in TypeScript (`packages/domain/src/insights`).
- Both carry Rust-generated parity fixtures. Phase 4 must check this against the CLAUDE.md rule "Rust is authoritative for stored calculations".

**Frontend tests** (counts are approximate, by grep):

- Desktop: about 955 cases in 85 files. Of these, about 98–118 are journey cases in `src/journeys/`: accessibility, accounts, data-controls, first-run, recovery, risk-promotion, uncertain-writes ×3, workflows.
- Domain: about 189 cases.
- No `.skip`, `.only` or `.todo` was found.
- Journeys render the real `<App/>` over an in-memory store (`src/test/harness.tsx`, `src/test/app-store.ts`) with mocked Tauri `invoke` and dialog. **This is jsdom evidence, not WebView2 or native evidence.**

## 5. Rust and Tauri architecture

**Entry and startup.**

- `main.rs` (release `windows_subsystem="windows"`) calls `lib.rs:172 run()`. That registers `tauri_plugin_dialog`, then the setup hook (`lib.rs:175-205`) does the following:
  1. Resolves `app_data_dir()` and `app_config_dir()`. Both are `%APPDATA%\com.fundedflow.desktop` on Windows.
  2. In debug builds, `FUNDEDFLOW_DEV_DATA_DIR` can redirect both to an isolated test journal; a refused value fails closed instead of falling back.
  3. Manages `legal::LegalStore` and `runtime::Runtime::new(path)` (state `Initializing`).
  4. Spawns `commands::initialize_in_background` on a plain `std::thread`.
- The only fatal path is `.run(...).expect(...)` (`lib.rs:208`).

**Runtime** (`src/runtime.rs`, 410 lines; tests in `runtime/tests.rs`):

- It holds one `Mutex<Option<Connection>>` (no pool), a status mutex and an ownership mutex.
- A poisoned lock is recovered with `into_inner` (`runtime.rs:188-193`).
- `initialize` (`runtime.rs:282-324`) holds the connection mutex for the whole attempt. `open` (`runtime.rs:326-361`) then:
  1. runs `create_dir_all`;
  2. takes an exclusive `fs2` lock on `<data>/fundedflow.lock`, after symlink and reparse-point checks (`data_controls/mod.rs:155-168`); it is held for the runtime's lifetime, so a second instance fails with `open_failed`;
  3. runs `data_controls::recover` to finish or roll back a pending restore;
  4. peeks at the schema version read-only;
  5. calls `db::open_file`;
  6. runs `recover_cleanup` for the deletion queue.
- Failure categories are `data_directory`, `open_failed`, `backup_failed`, `migration_failed` and `newer_schema`. While not ready, data commands return `AppError::Unavailable` at once (`runtime.rs:389-400`). `retry_runtime` re-runs initialization, with no overlapping attempts.

**Shutdown.** There is **no** `RunEvent`, `ExitRequested` or `on_window_event` handling, no explicit connection close and no WAL checkpoint on exit. Resources are released when the process ends, and SQLite WAL recovery happens on the next open. The only explicit close-and-checkpoint path is the debug-only `release_for_handoff` (`runtime.rs:366-380`).

**Commands** (`src/commands.rs`, 690 lines):

- They are thin `#[tauri::command] async fn` wrappers around `Runtime::with` or `with_controls`. The module comment says "Commands are `async` so database work runs off the main (UI) thread" (`commands.rs:5`).
- The work inside each command is synchronous (std `Mutex`, rusqlite, file I/O). There is no `spawn_blocking` anywhere in `src/`.
- Exceptions: `runtime_status`, `retry_runtime` and the legal commands are sync. `get_legal_acceptance` and `record_legal_acceptance` do file I/O and fsync.
- The registry (`lib.rs:29-163`) has 108 release commands in these groups: evidence/reconciliation, data controls, runtime, accounts/attempts, catalogue, ledger, settings, snapshots/risk, trades, reviews/library, journal, CSV, rulebooks, daily reviews, insights, legal.
- The five dev commands (`dev_tools_status`, `dev_seed_fake_data`, `dev_reset_preview`, `dev_reset_handoff`, `dev_dismiss_reset_report`) are registered only under `cfg(debug_assertions)`. The module itself compiles under `any(debug_assertions, test)` (`lib.rs:10`).

**Modules:**

- `store/`: 21 repositories, about 9.1k lines, with 12 test files.
- `csv_import/`: parse, detect, normalize, values, dedup, target.
- `data_controls/`: archive, restore, deletion, filesystem.
- `db/`: `mod.rs` (migrations, PRAGMAs, backup) and `steps.rs` (Rust steps).
- `domain.rs`: trading day, P&L and money rules.
- `rulebook.rs`, `catalogue.rs`, `error.rs`.
- `legal.rs`.
- `dev_tools/` (debug only).
- `insights.rs`, `parity.rs`, `wire_contract.rs`: test only.

**Configuration** (`src-tauri/tauri.conf.json`):

- Identifier `com.fundedflow.desktop`, version 0.1.0.
- One window, `main` (1280×800, minimum 800×480, `dragDropEnabled:false`).
- A strict production CSP:
  - `script-src 'self'`;
  - `style-src 'self' 'unsafe-inline'`;
  - `connect-src ipc: http://ipc.localhost`;
  - `object-src 'none'`;
  - `frame-ancestors 'none'`.
- `devCsp` adds inline scripts and `ws://localhost:1420`.

**Capabilities** (`src-tauri/capabilities/default.json`), window `main` only: `core:default`, `core:window:allow-close`, `dialog:allow-open`, `dialog:allow-save`. There are no shell, fs, opener, http or updater plugins. `tauri-plugin-fs` appears in `Cargo.lock` only as a dependency of the dialog plugin and is neither registered nor permitted. The exact expansion of `core:default` was not checked against the generated schema, which is git-ignored; Phase 3 should check it.

**Debug and release boundary:**

- Rust: `cfg(debug_assertions)`.
- Frontend: lazy imports under `import.meta.env.DEV`.
- `apps/desktop/scripts/check-no-dev-tools.mjs` runs in `build:app` and again in the release workflow.

## 6. Data persistence map

| Store | Location | Writer → reader | Mechanism / atomicity (as coded; Phase 2 verifies) | Criticality |
|---|---|---|---|---|
| **Journal DB** | `%APPDATA%\com.fundedflow.desktop\fundedflow.db` (+`-wal`, `-shm`) | All `store/*`, `csv_import`, `data_controls` → same | Bundled SQLite. `foreign_keys=ON`, `recursive_triggers=OFF`, `busy_timeout` 5 s (`db/mod.rs:152-157`); `journal_mode=WAL`, `synchronous=NORMAL` set only after the newer-schema refusal (`db/mod.rs:259-264`). One transaction per command (the "commit bundle"). | **Critical**: the whole journal |
| Migrations | `user_version` 1→21 (`db/mod.rs:38-144`) | `db::migrate_with` | One transaction per step together with its version bump (`db/mod.rs:214-242`); newer schema refused twice (`:218`, `:259-262`) | Critical |
| Pre-upgrade backups | `fundedflow.db.before-v21.bak`, `…before-vN.previous-<uuidv7>.bak` | `db/mod.rs:266-284` → user, manually | `VACUUM INTO` only when `0 < current < latest`; an existing backup is first copied with `sync_all`, then removed. **Never pruned.** | High: recovery point, and retains old data |
| Lock | `fundedflow.lock` | `data_controls/mod.rs:155-168` | `fs2::try_lock_exclusive`, held for the runtime's lifetime | High: multi-instance safety |
| Attachments | `attachments/screenshots/<uuid>.<ext>` | `store/attachments.rs:200-291` → `attachments.rs:353`, archive | `.part` file with `create_new` + fsync + rename, written **before** the DB commit and removed on commit failure; the directory is not fsynced. Limits of 10 MiB × 20 per trade (`attachments.rs:34-35`). | High: user content outside the DB |
| Restore staging | `data-controls/<uuid>/{candidate.db, candidate-attachments/, safety.db, safety-attachments/, *-inventory.json}` and `data-controls-pending.json` | `data_controls/restore.rs:86-177` → `recover` `:284-344` at next startup | `write_new` + fsync, SQLite backup API, `sync_tree`; pending state is tempfile + `persist`; the live DB swap is tempfile + `persist` after deleting `-wal`/`-shm` (`restore.rs:256-272`). Safety folders kept indefinitely. | Critical: replaces the whole journal |
| Archive work dir | `data-controls-work/<tmp>/` | `archive::inspect_to` | `TempDir`; left behind after a crash | Low |
| Deletion cleanup queue | `data-controls-cleanup/<op>.json` | `data_controls/deletion.rs:287-293` → `:321-386` (also at startup) | `write_new` + fsync. Whole-journal erase overwrites the live DB from a migrated in-memory DB via the backup API (`deletion.rs:296-307`). | Critical: irreversible deletion |
| Export archive / CSV | Destination chosen by the user | `data_controls/archive.rs:214-323, 543-625` | NamedTempFile in the destination directory + `persist_noclobber` (`filesystem.rs:145-150`). ZIP v1 has stored entries only and is re-inspected before publishing. Caps: 64 MiB per entry, 256 MiB total, 4,096 entries. | High: the user's portability and backup path |
| `legal-acceptance.json` | `app_config_dir()` (the same folder on Windows) | `src-tauri/src/legal.rs:83-107` | NamedTempFile + fsync + `persist`; separate from journal data | Medium: install state, not journal data |
| Settings and preferences | `settings` table (e.g. `accounts.active_account_id`, `display.time_zone`, freshness policy) | `store/settings` via `get`/`set_setting` | In the journal DB | Medium |
| WebView `sessionStorage` | WebView2 profile | Review and rulebook draft components | Plaintext JSON drafts, cleared by session lifetime | Medium: unsaved user text |
| WebView `localStorage` | WebView2 profile | `AppShell.tsx` | Sidebar collapsed flag | Low |
| Dev-only reset report | `<identifier>.dev-reset.json` / `.log`, sibling of the data dir | `dev_tools/reset.rs` (debug) and `scripts/dev-reset-handoff.mjs` | Plain write | Dev only |
| Dev test journal | `<repo>/.dev-journal/com.fundedflow.desktop` (git-ignored) | `scripts/dev-test-journal.mjs` | Isolated directory | Dev only |
| Collector DB (separate tool) | `%LOCALAPPDATA%\FundedFlow\Collector\collector.db` (`FFC_DATA_DIR`) | `tools/prop-firm-collector` | Its own migrations. `guard_against_app_database` refuses the desktop journal path (`tools/prop-firm-collector/src/fundedflow_collector/paths.py:62-72`). | Separate scope |

**Import and export:**

- CSV import passes **file content as a string** over IPC, never a path (`csv_import/mod.rs:58`). Limits are 10 MiB and 50,000 rows (`parse.rs:8-9`).
- The preview token is SHA-256 over the account, lineage, request and classification (`csv_import/target.rs:175-179`).
- The commit re-verifies the token inside an IMMEDIATE transaction (`csv_import/mod.rs:472-484`).
- Journal export, inspect and restore, plus trade CSV export, use **path strings supplied by the webview** (`data_controls/mod.rs:113-153`, `restore.rs:13-15`). The paths come from native dialogs in the UI, but the backend does not bind them to a dialog scope.

## 7. Important application workflows

| # | Workflow | Path (UI → command → Rust) | Phase(s) |
|---|---|---|---|
| W1 | Startup, recovery and upgrade | `main.tsx` → `RuntimeProvider` → `runtime_status`/`retry_runtime` → `Runtime::initialize` → lock → restore recover → `open_file` (backup, migrate) → cleanup recover | 2, 3, 5 |
| W2 | First-run acknowledgement | `preloadLegalAcceptance` → `LegalGate` → `get`/`record_legal_acceptance` → `legal.rs` (`legal-acceptance.json`) | 3, 4, 5 |
| W3 | Account lifecycle | Accounts → `create`/`update`/`archive`/`restore`/`change_status`/`reset_account_attempt` → `store/accounts`, `store/attempts` | 2, 4 |
| W4 | Manual trade create/edit/delete/restore | Journal → `create`/`update`/`delete`/`restore_trade` → `store/trades` (soft delete, corrections log) | 2, 4 |
| W5 | CSV import | `/import` → `preview_csv_import` (digest) → `commit_csv_import` (token re-check, IMMEDIATE transaction, lineage, dedup and restore) → `csv_import/*` | 2, 3, 4 |
| W6 | Trade review and screenshots | Trade detail → `save_trade_review`, `add`/`read`/`remove_trade_screenshot` → `store/reviews`, `store/attachments` | 2, 3, 4 |
| W7 | Daily review | `/journal/days/:day` → `save`/`reopen_daily_review`, `relink_daily_review_trades` → `store/daily_reviews` | 2, 4 |
| W8 | Rulebook authoring and assignment | Rulebook → draft/validate/publish/assign → `store/rulebooks` (append-only events) | 2, 4 |
| W9 | Risk calculation and promotion | Today/Rulebook → `get_account_risk_inputs` → TS engine → `promote_account_risk` (source-fingerprint gate) → `store/risk_promotion` | 2, 4 |
| W10 | Financial evidence and reconciliation | `VerifyBalanceDialog` → observations, ledger revisions, reconcile/resolve → `store/evidence`, `store/reconciliation` | 2, 4 |
| W11 | Insights | `/insights` → `get_insights_dataset` → TS `summarize` | 4 |
| W12 | Export journal / trades CSV | Settings → dialog save → `export_journal_archive` / `export_trade_csv` → `data_controls/archive` | 2, 3, 4 |
| W13 | Restore journal | Settings → dialog open → `inspect_journal_archive` → `restore_journal_archive` ("REPLACE ENTIRE JOURNAL" + token) → staging → runtime Failed → next initialize installs or rolls back | 2, 3, 4, 5 |
| W14 | Permanent deletion (account or journal) | Settings → `preview_permanent_deletion` → `permanently_delete_data` → `retry_data_cleanup` → `data_controls/deletion` | 2, 3, 4 |
| W15 | Uncertain write review | Any write → timeout or ambiguous error → per-scope lock → re-read → acknowledge | 4 |
| W16 | Install, upgrade, uninstall | NSIS currentUser → WebView2 bootstrapper → first run → upgrade keeps `%APPDATA%` → uninstall "Delete the application data" checkbox | 5 |
| W17 | Developer seed and reset (debug only) | `dev:test-journal`, `seed`/`reset:test-journal`, `dev_reset_handoff` → isolated directory | 3, 5 |

## 8. Major dependencies and integration boundaries

1. **WebView ↔ Rust IPC.** The typed boundary is `apps/desktop/src/lib/data/tauri-repository.ts`. The input is validated with Zod before `invoke` and the output after. Rejections parse to `AppError`, with a fallback of `{kind:"database"}`.
   - Three paths sit **outside** the repository adapter: `lib/data/runtime.ts` (single-flight gateway, 10 s timeout, strict status schema), `lib/data/legal.ts`, and `lib/data/freshness.ts` (raw `invoke` with Zod and no `AppError` mapping, `freshness.ts:20`).
   - `lib/data/data-controls.ts` has its own `call` and error type.
2. **Domain contracts ↔ Rust serde.** The two sides are pinned by Rust-generated fixtures: `packages/domain/test/fixtures/*.json` and `apps/desktop/src/test/fixtures/{command,evidence,risk-promotion,rulebook,csv-duration}-wire.json`. Vitest replays them; `cargo test` fails on drift.
3. **Fixture regeneration is controlled by `FUNDEDFLOW_UPDATE_FIXTURES`, and the test files check it inconsistently.**
   - Exact value `"1"`: `parity.rs:34`, `wire_contract.rs:278`.
   - Any value (`is_some()`): `data_controls/wire_tests.rs:90`, `store/engine_snapshot_tests.rs:219`, `store/evidence_tests.rs:454,790`, `store/risk_promotion_tests.rs:1103`, `db/rulebook_editor_tests.rs:549`, `csv_import/wire_limit_tests.rs:216`.
   - Later phases must make sure the variable is unset for any check they run.
4. **SQLite ↔ filesystem.** Attachments, restore staging and deletion cleanup coordinate DB rows and files across two durability domains.
5. **OS / WebView2 / installer.** NSIS currentUser and the WebView2 bootstrapper, which needs Microsoft's network only when the runtime is absent. `LICENSE` and `THIRD_PARTY_NOTICES.txt` are bundled.
6. **Native dialogs.** `@tauri-apps/plugin-dialog` open and save (`features/data-controls/api/data-controls.ts:108,116`).
7. **CI ↔ advisory services.** npm audit and cargo-audit run through `scripts/audit-guard.mjs`. On push and PR events, an outage is reported as `NOT RUN` and **exits 0** (`scripts/audit-guard.mjs:111-115`). It fails only on schedule or `workflow_dispatch`.
8. **Collector ↔ desktop.** There is no runtime coupling. Grep finds no consumer in `apps/` or `packages/`. The desktop consumer is deferred to V1.5 (`docs/architecture/prop-firm-collector.md` §2). The schemas in `docs/contracts/*.schema.json` mirror the collector's export schemas.

## 9. Preliminary risk areas (hypotheses, not findings)

These are leads for later phases. Each has an `R-` number for traceability only. When later phases confirm or reject them, they assign their own `DATA-`/`TR-`/`UI-`/`WIN-`/`TEST-` IDs and should cite the R-number.

| R-ID | Area | Evidence | Why it matters | Phase |
|---|---|---|---|---|
| R-01 | Blocking work in async commands under one mutex | `commands.rs:5,36-50`, no `spawn_blocking` in `src/`; `runtime.rs:389-400`. Long holders: export (up to 256 MiB of hashing), restore prepare (double inspect), deletion preview (dump + clone). | Possible worker starvation and UI timeouts, which the UI then turns into uncertain outcomes | 3 |
| R-02 | Attachment file vs DB commit ordering | `store/attachments.rs:200-291`; ownership checks `restore.rs:246-255`, `deletion.rs:213` | A crash between rename and commit leaves stray bytes that may block restore or erase | 2 |
| R-03 | No directory fsync on Windows | `data_controls/filesystem.rs:134-144` (`sync_dir` is a no-op when not unix) | Durability of renames for the pending marker, attachments and the restore swap depends on NTFS | 2, 5 |
| R-04 | Restore DB swap ordering | `restore.rs:256-272` removes `-wal`/`-shm` before `persist` | A crash window relies on the "installing" rollback | 2 |
| R-05 | Fail-closed recovery can block startup | `restore.rs:296-300`, `deletion.rs:327-333`, `runtime.rs:336-356` | One malformed pending or cleanup file might make the journal unopenable until manual repair. This may be intended, so check the user-facing recovery path. | 2 |
| R-06 | Recovery copies never pruned | `db/mod.rs:266-284`, `data-controls/<id>` safety images, `docs/data-model.md:532-538` | Disk growth, and data removed by an account deletion persists in old backups | 2, 3 |
| R-07 | Export and restore size caps vs attachment allowance | `filesystem.rs:5-7`, `archive.rs:72-91,196` vs `attachments.rs:34-35` | A large journal may become impossible to export or restore | 2 |
| R-08 | Webview-supplied paths for export and restore | `data_controls/mod.rs:113-153`, `restore.rs:13-15`; checks: symlink components, `persist_noclobber`, unix-only hard-link check (`filesystem.rs:79-85`) | IPC path trust boundary | 3 |
| R-09 | No shutdown hook or checkpoint; erase leaves WAL pages | `lib.rs:172-209`; `deletion.rs:296-307` | Whether erased data persists in the WAL until a checkpoint, and behaviour during Windows shutdown | 2, 3 |
| R-10 | Panics in shipping code | About 20 non-dev `unwrap`/`expect`/`unreachable!`/`panic!` sites (e.g. `catalogue.rs:25`, `store/daily_reviews.rs:893,1111,1139`, `store/rulebooks.rs:414,782`, `store/accounts.rs:135-136`, `csv_import/mod.rs:292-293,388`) | Most are validated-then-unwrap. Unwinding plus poison recovery needs a check that transactions roll back. | 3 |
| R-11 | Uncertain-write lock held only in memory | `features/shared/submissions.ts:8-53` | Reload or restart forgets the uncertain state, so a resubmit could duplicate a write | 4 |
| R-12 | Late success after the 30 s timeout is dropped | `submissions.ts:35`; the import commit may exceed 30 s | Expected uncertain outcomes on long writes | 4 |
| R-13 | `acknowledgeUncertainOutcome` uses the render-time spec | `use-feature-mutation.ts:43,61` vs `:66-67` | Could clear the wrong scope | 4 |
| R-14 | Write and error paths that bypass the shared lifecycle | `lib/data/freshness.ts:20`; data-controls lock with no timeout (`data-controls.ts:14-46`); CSV preview and legal raw mutations | Inconsistent unavailable/uncertain handling; a hung data-control operation stays locked until reload | 4 |
| R-15 | Legal acceptance fails open for the session | `features/legal/hooks.ts:33-48` | Matches the documented intent; confirm against the NA-3/P0-13 acceptance criteria | 4, 5 |
| R-16 | TypeScript computes the promoted risk result | `lib/data/calculate-risk.ts:59-77`; Rust gates on source fingerprint only | Tension with "Rust is authoritative for stored calculations"; check parity coverage | 4 |
| R-17 | `Number()` checks on decimal text and the display-zone default | `packages/domain/src/contracts/fields.ts:10-11`, etc.; `formatInstant` without a zone in `AccountsPage.tsx:126`, `RulebookPage.tsx:108` | Sub-micro edge cases; times shown in the wrong zone vs the CLAUDE.md account-zone rule | 4 |
| R-18 | Plaintext drafts in `sessionStorage` restored by cast | `ReviewCard.tsx:108-122`, `DailyReviewPage.tsx:93-105`, `unsaved.ts:15-29` | A stale draft against a newer revision; privacy of the WebView profile | 4 |
| R-19 | Unreferenced CSVs of unknown provenance in a source-available repo | `test_csvimport/Performance Oct 20.csv`, `…(1).csv` (PR #25, 2026-10-20) | May be real trade exports (privacy). The owner should confirm they are synthetic or remove them. **Rows were deliberately not read.** | 3, 5 |
| R-20 | No packaged Windows acceptance for the current source | `docs/build-26.75-evidence.md:8,117-143` (checklist blank; status "Not Done"); recorded installer SHA `7679edc…` is 124 commits behind HEAD | Readiness evidence gap, not a code defect | 5, 6 |
| R-21 | The release workflow runs no tests; the PR path filter omits UI and domain | `.github/workflows/release-installer.yml:41-51, 80-115`; `ci.yml` has no tag trigger | A `v*` tag could build an installer from an untested commit | 5 |
| R-22 | Advisory audit can be green while NOT RUN | `scripts/audit-guard.mjs:111-115`; `ci.yml:109,124`; toolchain and cargo-audit unpinned | A green job is not advisory evidence | 5 |
| R-23 | Draft legal text pinned by tests; privacy claim vs WebView2 bootstrapper | `apps/desktop/src/legal/privacy-notice.ts:8-11`, `user-agreement.ts:7-10`, `legal.test.ts:11-20`; `legal/index.ts:12-14` ("no internet connection") vs `tauri.conf.json` `downloadBootstrapper` | Open P0-13/NA-3 integration work; wording accuracy for installer-time network use | 5 |
| R-24 | `FUNDEDFLOW_UPDATE_FIXTURES` inconsistently checked | §8 item 3 | Running checks with the variable set to `0` still rewrites fixtures | 5 |
| R-25 | `reset-test-data.mjs` defaults to the real journal | `scripts/reset-test-data.mjs:12-17,70`; `docs/development/reset-test-data.md:11-18` | Guarded (preview, `--yes`, process check, rename-to-backup), but it targets real data | 3, 5 |
| R-26 | Stale documentation | `docs/data-model.md:362` says permanent delete is "Not implemented", but `data_controls/deletion.rs` implements it; `docs/build-26.75-evidence.md:63,71` disagree with the current release workflow triggers and PR retention (3 days) | Misleading acceptance and recovery guidance | 5, 6 |
| R-27 | Debug gating relies solely on `cfg(debug_assertions)` | `lib.rs:10,145-163` | A custom profile with debug assertions enabled would ship dev commands. Mitigated by `check-no-dev-tools.mjs` for the frontend only. | 3, 5 |
| R-28 | Future table rebuilds could cascade into `risk_promotions` | `migrations/0021_risk_promotions.sql:13` (`ON DELETE CASCADE`) with the `DROP TABLE account_snapshots` rebuild pattern (`0012:57`, `0015:44`) under `foreign_keys=ON` | Latent maintenance hazard; safe today | 2 (Informational) |
| R-29 | Desktop `tsconfig` lacks `noUncheckedIndexedAccess`; about 84 casts | `apps/desktop/tsconfig.json` | Maintainability and type safety | 4 |

### 9.1 Confidence that each lead warrants deep review

These ratings are for prioritising later work only. They are not a judgement that a defect exists.

| Confidence | R-IDs | Basis |
|---|---|---|
| High: code behaviour verified by the lead in source; open question is impact | R-01, R-03, R-09 (no shutdown hook), R-14 (`freshness.ts:20`), R-15, R-16, R-20, R-22, R-23, R-26 | The lead read the cited lines |
| Medium: mapped by a specialist with file:line evidence; not re-read by the lead | R-02, R-04, R-05, R-06, R-07, R-08, R-10, R-11, R-12, R-13, R-17, R-18, R-21, R-24, R-25, R-27 | Specialist report; Phase 2–5 must re-read |
| Low: latent or provenance question | R-19, R-28, R-29 | Needs an owner answer, or is not reachable today |

### 9.2 Areas with limited direct tests (existing tests mapped first)

Test counts are by grep at 92e7980. The tests were not run.

- **Rust, well covered by dedicated suites:**
  - migrations and upgrade (`db/*tests.rs`, about 70 tests, including real legacy journals);
  - store repositories (about 151 tests);
  - CSV import (about 79);
  - data controls (34: `tests.rs` 21, `current_schema_tests.rs` 7, `security_tests.rs` 5, `wire_tests.rs` 1);
  - runtime (14, `runtime/tests.rs`);
  - legal record (5 inline).
- **Rust, thin or absent:**
  - `commands.rs` and `lib.rs` have no tests. Startup wiring, command registration and the async-to-blocking path are only exercised indirectly.
  - Shutdown and exit have no tests (there is no hook to test, R-09).
  - Crash windows *between* filesystem and DB steps (attachment rename vs commit, restore swap, erase vs WAL) are not visible as dedicated tests from file names. Phase 2 should confirm this by reading `data_controls/tests.rs`, `store/journal_review_tests.rs` and `runtime/tests.rs`.
  - Windows-specific filesystem semantics (no `sync_dir`, reparse points, hard links) cannot be exercised by the Linux test run.
- **Frontend, by feature folder** (non-test source files / test files):

  | Folder | Source files | Test files |
  |---|---|---|
  | rulebooks | 25 | 2 |
  | insights | 14 | 1 |
  | imports | 14 | 3 |
  | data-controls | 6 | 1 |
  | settings | 5 | 1 |
  | legal | 5 | 1 |
  | evidence, ledger, library, references, reviews, trades | 2–3 each | 0 each |
  | accounts | 20 | 8 |
  | journal | 15 | 6 |
  | today | 11 | 5 |
  | shared | 11 | 8 |

  The journeys (`src/journeys/`, 10 files) add whole-app coverage for accounts, data controls, first run, recovery, risk promotion, uncertain writes and workflows. Phase 4 must check whether the rulebook editor, Insights and the import wizard are covered there before treating them as untested.
- **Platform:** there is no automated packaged-app, WebView2 or installer test. `apps/desktop/scripts/smoke-shell.mjs` is Linux-only and not wired in. The engine-runtime parity check (`check:engine-runtimes`) needs Chromium and is not in CI. Infrastructure proposals should come only after Phase 5 confirms these gaps.

## 10. Recommended detailed investigation order

1. **Phase 2 (data integrity).** Work in this order: W1 upgrade, backup and recovery (R-05, R-06) → W13 restore (R-03, R-04) → W14 deletion and erase (R-09) → W6 attachments (R-02) → W5 import commit → W3/W4/W7/W8/W10 commit bundles → W12 export caps (R-07) → legal record boundary (export, restore and erase scope).
2. **Phase 3 (Tauri, Rust, security).** The async/blocking model (R-01) → IPC contracts, including the three adapters outside the repository (R-14) → path trust for data controls (R-08) → `core:default` expansion, CSP and dev gating (R-27) → panics (R-10) → lifecycle and shutdown (R-09) → collector network surface, reviewed statically as separate coverage → R-19.
3. **Phase 4 (React/TS).** The uncertain-write lifecycle (R-11 to R-14) → the TS risk engine vs Rust authority (R-16) → money and time display (R-17) → drafts (R-18) → feature-by-feature workflows W3–W12 → journeys and accessibility coverage.
4. **Phase 5 (Windows/testing).** Run the validation sequence offline and serially → packaging, WebView2 and offline claims (R-23) → release and CI evidence (R-20 to R-22, R-24) → reinstall and uninstall data retention → the gate register.
5. **Phase 6.** Independent re-verification and the readiness verdict.

## 11. Unknowns and coverage limitations

- **Platform.** This is a Linux container. No Windows, WebView2, NSIS, `%APPDATA%` or NTFS behaviour was observed. A Windows runtime claim from any phase run here must be marked unverified.
- **Nothing executed.** Pass/fail state of the typecheck, Vitest, cargo test, clippy and builds at HEAD is unknown to this audit. The historical results in docs carry their own SHAs: `docs/build-26.9-evidence.md:44,48` records 4 `legacy_rulebook_tests` failures and UI timing flakes in a sandbox, with no SHA. PR #105 (`test/stabilise-cpu-contention-timeouts`) has since merged.
- **Depth.** Store modules, migration SQL bodies, `dev_tools` internals, design-system component internals, the large feature pages (Today, Insights, Rulebook editor, Import wizard), design specs and mockups, and collector test bodies were mapped by outline or grep, not read line by line.
- **Not opened, deliberately.** The binary DB fixtures, any real user journal, the rows of the CSV fixtures, and git-ignored `gen/schemas`. As a result, the exact `core:default` permission set is unverified.
- **External evidence not refreshed.** The Notion board, Final Push V1, the P0 audit, and GitHub Actions runs and artifacts (`39735646149`, `39730672821`, `39691474111`) were not fetched. Their status in §12 comes from the supplied 2026-10-22 snapshot and is **unverified** here.
- **Counts are approximate** (grep-based): test cases, `as` casts, `unwrap` sites.

### 11.1 Commands executed in Phase 1 (all read-only, offline)

Working directory: the repository root unless stated.

| Command | Exit code |
|---|---|
| `pwd`, `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain=v1 -uall`, `git log --oneline -5` | 0 |
| `git cat-file -t`, `git merge-base --is-ancestor`, `git rev-list --count`, `git diff --stat`/`--name-only` between `8c3dd34`, `7679edc` and `92e7980` | 0 |
| `uname -a`, `node --version`, `npm --version`, `cargo --version`, `rustc --version`, `python3 --version`, `uv --version` (version queries only) | 0 |
| `cat`, `sed -n`, `grep`, `find`, `wc`, `ls` over tracked files | 0 (`ls code-review` / `.claude` returned "not found" at the start, as expected) |

- **Not run, by design:** no npm, cargo, uv or pytest invocation (typecheck, test, build, clippy, notices, audit). These checks are scheduled for Phase 5.

### 11.2 Process deviation and final Git state

- **Commit and push.** The prompt says not to commit or push. After the reports were written, the session's stop hook required the untracked reports to be committed and pushed, and the cloud container would otherwise have discarded them.
  - The two report files only were committed as `24e5c9e` on `claude/practical-turing-wmii06` and pushed to `origin`, which created that remote branch.
  - Nothing was merged or tagged, and no PR was opened. No application file is in the commit.
  - This verification update is a further edit to the same two Markdown files.
- **Final Git state.** After the commit, `git status` was clean apart from these report edits. No unexpected changes were found and nothing was discarded.

## 12. Owner-only scope, prior-audit snapshot and reconciliation register

### 12.1 Copied scope snapshot (2026-10-22; preserve in later phases)

- **Target:** Kyle's personal-use Windows desktop V1. External-user agreements, counsel sign-off and the identified MPL/NSIS legal reviews are **V2**. Technical privacy and security, the existing third-party notices, data safety and packaged validation remain **V1**. This audit infers no distribution approval.
- **Source of the snapshot:** "Final Push V1" (Notion `4001bd4b6bde8044ab04f75d167950cd`), as copied in the Phase 1 prompt. The owner-only decision in it supersedes older external-user and legal-gate wording. The older "P0 Audit — completed docs and Notion comparison — 2026-10-21" is history: keep its original revision and results, and apply the later owner decisions to it.
- **Claimed state:** P0-01 to P0-04 merged; all 31 P0-D UI cards merged; triage follow-ups moved to "P1 - V1.1". Audit severity and priority do **not** change a roadmap lane.
- **Open baseline from the snapshot:**
  - P0-13/NA-3 integration of the owner-only v1.1 notice package: owner-use statement `1.0.1-owner-only`, privacy notice `1.0.0-owner-only`;
  - a fresh candidate installer with a clean Windows smoke test;
  - manual recovery, accessibility, cohort and offline acceptance;
  - P0-09 evidence;
  - NA-7 notes;
  - the P0-18 human go/no-go.
- **Needs explicit owner disposition if unresolved:** P0-10 studies and walkthroughs, D5 wrappers, 0BSD allow-list acceptance, and the P0-05 cohort. Do not silently waive or implement them.
- **CI and installer provenance (from the snapshot; not re-fetched):**
  - Main `92e7980` Windows CI run `39735646149` succeeded. A green job is not packaged acceptance, and the audit guard can report NOT RUN and still pass.
  - PR installer run `39730672821` at `b94fb1b8f945c0cbfb2fdee07d3cc6a00834a504` produced artifact `fundedflow-0.1.0-b94fb1b-windows-nsis`, which expires 2026-10-25. It predates main.
  - The `7679edc` artifact in `docs/build-26.75-evidence.md` is historical.
  - A ZIP digest is not the EXE SHA-256.
  - A final candidate needs: source SHA, EXE SHA-256, environment, and actual acceptance results.

### 12.2 Reconciliation register

Verification status uses: Confirmed / Partially Confirmed / Unverified / Already Resolved / Not Applicable. "Repo evidence" means what this checkout shows at `92e7980`.

| Prior ID (source, date) | Claimed state | Current repo evidence (HEAD 92e7980) | Verification | Remaining acceptance / decision |
|---|---|---|---|---|
| P0-01 to P0-04 (Final Push V1, 2026-10-22) | Merged | Design docs present: `docs/architecture/p0-01-p0-03.md`, `p0-02-risk-promotion.md`, `p0-04-csv-contracts.md`. P0-02 code: `promote_account_risk`, migration 21, `store/risk_promotion_tests.rs` (1,457 lines). P0-04: `test_csvimport/limits/byte-limit-v1.json`, `csv_import/wire_limit_tests.rs`. | Partially Confirmed (present in source; tests not run in Phase 1) | Phases 2–4 verify behaviour; Phase 5 runs the tests |
| P0-D01 to D31 UI cards (Final Push V1) | All 31 merged | Many cards are referenced in source and specs (e.g. P0-D06 freshness `lib/data/freshness.ts:1`, P0-D24 review controls in HEAD's merge `f7bcf29`, `docs/design/screens/p0-d17/`). A per-card source mapping was not done. | Unverified per card | Phase 4 samples the key workflows; Phase 6 reconciles |
| Triage follow-ups (Final Push V1) | Moved to P1 - V1.1 | Not visible in the repo | Unverified (Notion) | Owner. No new V1 work is inferred. |
| P0-13 / NA-3 owner-only notice v1.1 (statement `1.0.1-owner-only`, privacy `1.0.0-owner-only`) | Open | Source still ships `0.1.0-draft` documents (`apps/desktop/src/legal/privacy-notice.ts:8-11`, `user-agreement.ts:7-10`). `legal.test.ts:11-20` asserts draft state. Repo-wide grep finds **no** `owner-only` text. The first-run gate and the acceptance record (id + version + digest, `legal/index.ts:40-43`; `legal.rs`) exist. | Confirmed open | Integrate the v1.1 text, digests, versions, summary and tests under P0-13/NA-3 (implementation is not authorized by this audit) |
| Fresh candidate installer + clean Windows smoke | Open | `docs/build-26.75-evidence.md:8` "Not Done"; checklist `:121-143` blank; recorded artifact at `7679edc` (124 commits behind HEAD). The release workflow computes EXE SHA-256 (`release-installer.yml`). | Confirmed open (unrun gate) | Build the candidate from the chosen SHA; record the EXE SHA-256, environment and results |
| Manual recovery / accessibility / cohort / offline acceptance | Open | Automated jsdom journeys exist (`src/journeys/{recovery,accessibility,…}.test.tsx`). Docs mark packaged/manual runs pending (`docs/build-10-5-closeout.md:65,67`; `docs/architecture/build-26-accessibility-journeys.md:17`; `build-26.5-26.7-recovery-reliability.md:11,187-194`). | Confirmed open (unrun gates) | Manual Windows runs on the candidate |
| P0-09 evidence | Open | No P0-09-specific evidence document found by filename | Unverified | Owner and Phase 5 to identify the evidence |
| NA-7 release notes | Open | Install, verify and uninstall wording is in `docs/build-26.75-evidence.md` ("Install and verify for the NA-7 release notes") and `README.md` §Windows installer; the doc has drifted from the workflow (R-26) | Partially Confirmed (draft exists) | Reconcile the notes with the current workflow and candidate |
| P0-18 human go/no-go | Open | Not represented in the repo | Not Applicable to source; owner decision | The owner decides; no audit verdict implies it |
| P0-10 studies / walkthroughs | Needs disposition | Not represented in the repo | Unverified | Owner disposition |
| D5 wrappers | Needs disposition | Not identified in the repo by name | Unverified | Owner disposition |
| 0BSD allow-list acceptance | Needs disposition | The notices allow-list is in `scripts/third-party-notices.mjs:27-40` and `src-tauri/about.toml`. Whether 0BSD is accepted was not checked in Phase 1. | Unverified | Owner disposition; Phase 5 inspects the allow-list |
| P0-05 cohort | Needs disposition | Not represented in the repo | Unverified | Owner disposition |
| MPL/NSIS legal reviews | Deferred to V2 | `docs/build-26.75-evidence.md:97-100` notes the open NSIS licence question | Not Applicable for V1 (deferred) | V2 |
| Prior "P0 Audit 2026-10-21" findings | Historical | Not available offline | Unverified | Reconcile per finding in Phases 2–6 when relevant; preserve the original IDs |
| Collector (Build 29 / 29.25; P0-14 consumer deferred to V1.5, owner decision 2026-10-21) | Standalone; consumer deferred | No desktop consumer (grep). Separate CI. DB guard refuses the desktop journal. | Confirmed | Secondary coverage only; its intended network fetching is not a desktop privacy regression |

### 12.3 Separation of categories (as of Phase 1)

| Category | Items |
|---|---|
| Already resolved in code | Cross-process lock; refusal of newer schema; per-migration transactions with backup; preview-token-bound import commit; debug command exclusion from release registration |
| Confirmed defects | **None yet.** Phase 1 does not confirm defects. |
| Unrun gates | Candidate installer and clean Windows smoke; manual recovery, accessibility, cohort and offline acceptance; P0-09 evidence |
| Open implementation work (existing cards) | P0-13/NA-3 v1.1 notice integration and the matching legal test update; NA-7 notes reconciliation |
| Owner decisions | P0-18 go/no-go; P0-10, D5, 0BSD and P0-05 dispositions; signing and auto-update stay owner choices; provenance of R-19 CSVs |
| Deferred | External-user agreements, counsel sign-off, MPL/NSIS reviews (V2); collector desktop consumer (V1.5); Web V2 |

---

*Finding conventions for Phases 2–6:* `DATA-`, `TR-`, `UI-`, `WIN-`, `TEST-` with stable numeric suffixes (e.g. `DATA-001`). Verification: Confirmed / Partially Confirmed / Unverified / Already Resolved / Not Applicable; "Duplicate of X" is a relationship, not a status. Severity: Critical / High / Medium / Low / Informational. Priority: P0 blocker, P1 important Stage 1 correction, P2 justified maintainability/performance, P3 deferred.
