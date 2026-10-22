# FundedFlow Stage 1 audit: coverage matrix

| Field | Value |
|---|---|
| Created | 2026-10-22, Phase 1 |
| Baseline revision | `92e79802593f97d907bdf8b403a088304e203676` on branch `claude/practical-turing-wmii06` |
| Working tree at baseline | Clean (no tracked or untracked changes before the audit) |
| Host | Linux container (not Windows, not WSL) |
| Last updated by | Phase 1 |

## How later phases update this file

- Compare the HEAD you are reviewing against the baseline above. List any changed paths in the change log at the bottom, and revalidate the rows those paths affect.
- Update **Status**, **Depth / evidence** and **Remaining** for each row you examine. Add finding IDs in the Findings column.
- Allowed status values:
  - Inspected
  - Partially inspected
  - Not yet inspected
  - Excluded with reason
- Phase 1 "Inspected" means the area was *mapped for architecture*, not audited for defects. Each deep-review phase must record its own depth.
- Risk levels: High, Medium, Low.
- `R-nn` references point to the preliminary risk list in `00-repository-discovery.md` §9.

## A. Rust host and storage (`apps/desktop/src-tauri`)

| # | Area / file group | Purpose | Phase(s) | Risk | Status (Phase 1) | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| A1 | `src/lib.rs`, `src/main.rs` | Entry, plugin setup, command registry, debug gating | 3, 5 | High | Inspected | Read in full at 92e7980 | Shutdown and lifecycle (R-09); debug gating (R-27) | — |
| A2 | `src/runtime.rs`, `runtime/tests.rs` | Readiness state, single connection, lock, restore handoff | 2, 3 | High | Partially inspected | Lock, initialize and open flow read; tests counted (14) | Failure paths, poison handling, R-05 | — |
| A3 | `src/db/mod.rs`, `db/steps.rs`, `migrations/*.sql` (1–21) | PRAGMAs, migrations, pre-upgrade backup | 2 | High | Partially inspected | Backup and PRAGMA code read; migration table mapped; SQL bodies not read | Per-step transactions, Rust steps 5/7/10/16, R-06, R-28 | — |
| A4 | `src/db/*_tests.rs`, `db/fixtures/*.db` | Upgrade, catalogue and rulebook tests; synthetic legacy journals | 2, 5 | Medium | Partially inspected | Counted (about 70 tests); fixtures not opened (read-only) | Coverage vs failure modes | — |
| A5 | `src/commands.rs` | 108 IPC command wrappers | 3 | High | Partially inspected | Async model and wrapper pattern verified | Per-command argument validation; R-01 | — |
| A6 | `src/store/*` (21 repositories + 12 test files) | Accounts, trades, reviews, attachments, library, ledger, evidence, reconciliation, snapshots, risk promotion, rulebooks, catalogue, settings, freshness, insights, daily reviews | 2, 3 | High | Partially inspected | Outlined by specialist; unwrap sites listed | Transaction bundles, attachments (R-02), panics (R-10) | — |
| A7 | `src/store/attachments.rs` | Screenshot bytes outside the DB | 2, 3 | High | Partially inspected | Write ordering mapped | R-02, R-03 | — |
| A8 | `src/csv_import/*` | Parse, detect, normalize, dedup, target, commit | 2, 3, 4 | High | Partially inspected | Pipeline and token mapped | Commit atomicity, failed-batch record, lineage | — |
| A9 | `src/data_controls/archive.rs` | Export ZIP v1 / CSV, inspect | 2, 3 | High | Partially inspected | Format and limits mapped | R-07, R-08, ZIP parsing safety | — |
| A10 | `src/data_controls/restore.rs` | Staged restore and recovery | 2, 3 | High | Partially inspected | Phases mapped | R-03, R-04, R-05 | — |
| A11 | `src/data_controls/deletion.rs` | Account and journal permanent deletion, cleanup queue | 2, 3 | High | Partially inspected | Flow mapped | R-05, R-06, R-09 | — |
| A12 | `src/data_controls/filesystem.rs`, `mod.rs` | Path, symlink and space checks; lock | 2, 3, 5 | High | Partially inspected | `sync_dir` and lock verified | R-03, R-08, Windows hard links | — |
| A13 | `src/legal.rs` | `legal-acceptance.json` | 2, 3, 5 | Medium | Partially inspected | Writer mapped | Sync command I/O; export/restore/erase boundary | — |
| A14 | `src/domain.rs` | Trading day, P&L, money rules | 2, 4 | High | Not yet inspected | — | Parity with TS; DST and reset | — |
| A15 | `src/rulebook.rs`, `src/catalogue.rs`, `src/error.rs` | DTOs, `AppError` | 3 | Medium | Not yet inspected | `catalogue.rs:25` `panic!` noted | Error mapping to TS | — |
| A16 | `src/parity.rs`, `src/wire_contract.rs`, `src/insights.rs` (test only) | Fixture generators | 4, 5 | Medium | Partially inspected | Role mapped; `FUNDEDFLOW_UPDATE_FIXTURES` checks noted (R-24) | — | — |
| A17 | `src/dev_tools/*`, `examples/seed-demo-journal.rs` | Debug-only seed and reset | 3, 5 | Medium | Partially inspected | Gating verified (`lib.rs:10,145-163`) | Release exclusion on the built artifact | — |
| A18 | `tauri.conf.json`, `capabilities/default.json` | Window, CSP, bundle, permissions | 3, 5 | High | Inspected | Read in full | `core:default` expansion (gen schema is git-ignored) | — |
| A19 | `Cargo.toml`, `Cargo.lock`, `.cargo/audit.toml`, `about.toml`, `build.rs`, `icons/` | Dependencies, audit ignore, notices config | 3, 5 | Medium | Partially inspected | Dependencies summarized; `about.toml` and icons not read | Advisory status; 0BSD allow-list | — |

## B. Frontend (`apps/desktop/src`) and desktop config

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| B1 | `main.tsx`, `App.tsx`, `app/` (providers, shell, RuntimeProvider, error boundary) | Boot, routing, runtime state | 4 | High | Inspected (map) | Boot and gates traced | Lifecycle and cleanup | — |
| B2 | `components/` (RuntimeGate, recovery notice, AccountLifecycle, CsvImportSection, DataModelPanel, ConfirmDialog) | Shared gates and legacy panels | 4 | Medium | Partially inspected | Gate behaviour verified | DataModelPanel dev-only status | — |
| B3 | `lib/data/` (tauri-repository, api, runtime, legal, freshness, data-controls, calculate-risk, schemas, wire tests) | IPC bridge | 3, 4 | High | Partially inspected | All invoke sites listed; freshness and calc-risk verified | Contract mismatches; R-14, R-16 | — |
| B4 | `features/shared/` (submissions, operations, query keys, mutation and query hooks, errors, UncertainOutcomeReview) | Read/write lifecycle | 4 | High | Partially inspected | Mapped | R-11, R-12, R-13 | — |
| B5 | `features/accounts`, `features/rulebooks` | Accounts, attempts, rulebook editor | 4 | High | Not yet inspected | Imports only | W3, W8, R-17, R-29 | — |
| B6 | `features/today`, `features/insights` | Dashboard, risk, analytics | 4 | High | Not yet inspected | Imports only | W9, W11, R-16 | — |
| B7 | `features/journal`, `features/daily-reviews`, `features/reviews`, `features/library`, `features/trades` | Journal, trade detail, reviews, drafts | 4 | High | Not yet inspected | Draft storage noted | W4, W6, W7, R-18 | — |
| B8 | `features/imports` | CSV wizard | 4 | High | Not yet inspected | Raw preview mutation noted | W5 | — |
| B9 | `features/data-controls`, `features/settings` | Export, restore, deletion, display zone | 4 | High | Partially inspected | Lock and dialog use noted | W12–W14, R-14 | — |
| B10 | `features/legal`, `legal/` | First run and documents | 4, 5 | Medium | Partially inspected | Fail-open and draft tests verified | R-15, R-23 | — |
| B11 | `features/evidence`, `features/ledger`, `features/references` | Financial evidence data hooks | 4 | Medium | Not yet inspected | — | W10 | — |
| B12 | `design-system/` (incl. `format.ts`) | Components, money and time formatting | 4 | Medium | Partially inspected | `format.ts` money/time functions mapped | R-17 | — |
| B13 | `journeys/`, `test/` (harness, app-store, axe, fixtures) | Journey, accessibility and wire tests | 4, 5 | Medium | Partially inspected | Counted; mocks identified | Coverage vs workflows; jsdom limits | — |
| B14 | `app/dev-tools/` | Developer panel (DEV only) | 3, 5 | Low | Partially inspected | Gating noted | Production exclusion on the artifact | — |
| B15 | `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `index.html`, `scripts/check-no-dev-tools.mjs`, `scripts/smoke-shell.mjs` | Build and test config | 4, 5 | Medium | Partially inspected | Scripts listed | R-29; smoke script unused | — |
| B16 | `THIRD_PARTY_NOTICES.txt`, `legal/third-party-summary.json` | Bundled notices | 5 | Medium | Partially inspected | Presence and counts | Currency vs lockfiles (needs cargo-about) | — |

## C. Shared domain (`packages/domain`)

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| C1 | `src/contracts`, `src/ports` | Zod DTOs, `JournalRepository` | 3, 4 | High | Partially inspected | Mapped; `Number()` checks noted | Rust/TS mismatches; R-17 | — |
| C2 | `src/primitives/money.ts` | bigint micro-units | 4 | High | Partially inspected | API mapped | Parity results | — |
| C3 | `src/engine`, `src/risk` | TS risk engine, hashing, promotion | 4 | High | Not yet inspected | — | R-16 | — |
| C4 | `src/rulebook`, `src/catalogue`, `src/insights` | Contracts and metrics | 4 | Medium | Not yet inspected | — | — | — |
| C5 | `test/` (17 files) + `test/fixtures` (10 JSON) | Parity and contract tests | 4, 5 | Medium | Partially inspected | Listed | Run in Phase 5 | — |
| C6 | `scripts/` (clean, boundaries, dist, engine runtimes, fixture generator) | Build and boundary checks | 5 | Medium | Partially inspected | Side effects noted (`clean` deletes `dist`; generator rewrites a fixture; engine-runtimes needs Chromium) | — | — |

## D. Repository tooling, CI and docs

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| D1 | Root `package.json`, `package-lock.json` | Workspaces, scripts | 5 | Medium | Inspected | Read | — | — |
| D2 | `scripts/audit-guard.mjs` + test | Advisory-audit wrapper | 5 | Medium | Inspected | NOT RUN exit-0 path verified (`:111-115`) | R-22 | — |
| D3 | `scripts/dev-test-journal.mjs`, `reset-test-data.mjs`, `dev-reset-handoff.mjs` + tests | Dev journal tooling | 3, 5 | Medium | Partially inspected | Real-journal default noted | R-25 | — |
| D4 | `scripts/third-party-notices.mjs` + test + `licenses/` | Notices generator (needs network and cargo-about) | 5 | Medium | Partially inspected | Side effects noted | 0BSD allow-list | — |
| D5 | `.github/workflows/ci.yml` | Windows CI and dependency audit | 5 | High | Partially inspected | Jobs mapped | R-21, R-22 | — |
| D6 | `.github/workflows/release-installer.yml` | NSIS build, EXE SHA-256 | 5 | High | Partially inspected | Mapped | R-21 | — |
| D7 | `.github/workflows/dev-tools.yml` | Dev-script tests (ubuntu and windows) | 5 | Low | Partially inspected | Mapped | — | — |
| D8 | `test_csvimport/` | CSV fixtures and contract vectors | 2, 5 | Medium | Partially inspected | Shapes only; rows not read | R-19 | — |
| D9 | `docs/data-model.md`, `docs/architecture/*` | Data model and contracts | All | Medium | Partially inspected | `packages.md` and data-model §§ migrations/startup read | R-26 (stale delete row) | — |
| D10 | `docs/build-*-evidence.md`, closeouts, handoffs, `docs/evidence/` | Historical acceptance evidence | 5, 6 | High | Partially inspected | 26.75 and 26.9 summarized with their SHAs | R-20, R-26 | — |
| D11 | `docs/design/` (README, screens, mockups, references, components) | UI specs (visual references) | 4 | Low | Partially inspected | README headline only | Per-screen spec checks in Phase 4 | — |
| D12 | `docs/brand/`, `docs/contracts/*.schema.json` | Brand assets, collector schemas | — | Low | Excluded with reason | Brand images carry no behaviour. Schemas belong to the collector (see E1). | — | — |
| D13 | `CLAUDE.md`, `README.md`, `LICENSE`, `.gitignore`, `.gitattributes`, `.vscode/` | Conventions and config | 1 | Low | Inspected | Read | — | — |

## E. Separate tool (secondary coverage)

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| E1 | `tools/prop-firm-collector` (src, tests, config, docs, `pyproject.toml`, `uv.lock`) + `.github/workflows/prop-firm-collector.yml` | Standalone, network-capable public-page collector with its own DB; no desktop consumer (deferred to V1.5) | 3 (static network and storage review), 5 (offline checks only if the environment already exists) | Medium (separate) | Partially inspected | Layout, network controls, DB guard and CI mapped | Static review of the collection restrictions; no live fetching. Its intended networking is **not** a desktop privacy regression. | — |

## F. Excluded

| Path | Reason |
|---|---|
| `node_modules/`, `packages/domain/dist/`, `apps/desktop/dist/`, `apps/desktop/src-tauri/target/`, `src-tauri/gen/schemas`, Python caches | Generated or dependency output (git-ignored). The `gen/schemas` permission expansion is to be checked in Phase 3 if it can be generated offline. |
| Real `%APPDATA%\com.fundedflow.desktop` journal | Real user data: never opened in this audit |
| `db/fixtures/*.db` contents | Read-only synthetic fixtures; to be exercised only through existing tests |

## Workflow coverage (W-IDs from `00-repository-discovery.md` §7)

| Workflow | Phases | End-to-end traced? (Phase 1) |
|---|---|---|
| W1 startup, upgrade, recovery | 2, 3, 5 | Mapped at the module level |
| W2 first run | 3, 4, 5 | Mapped |
| W3–W11 journal features | 2, 4 | Command mapping only |
| W12–W14 export, restore, delete | 2, 3, 4 | Mapped at the module level |
| W15 uncertain writes | 4 | Mapped |
| W16 install, upgrade, uninstall | 5 | Docs only |
| W17 dev tools | 3, 5 | Mapped |

## Change log

| Phase | Date | HEAD | Source changes since baseline | Notes |
|---|---|---|---|---|
| 1 | 2026-10-22 | 92e7980 | — (baseline) | Created. No checks executed. |
