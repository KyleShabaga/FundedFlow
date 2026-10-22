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

