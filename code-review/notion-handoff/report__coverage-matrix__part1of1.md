| Field | Value |
|---|---|
| Created | 2026-10-22, Phase 1 |
| Baseline revision | `92e79802593f97d907bdf8b403a088304e203676` on branch `claude/practical-turing-wmii06` |
| Working tree at baseline | Clean (no tracked or untracked changes before the audit) |
| Host | Linux container (not Windows, not WSL) |
| Last updated by | **Phase 6 final** (2026-10-22, HEAD 7ca8c7f; app source identical to 92e7980) |

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
| A1 | `src/lib.rs`, `src/main.rs` | Entry, plugin setup, command registry, debug gating | 3, 5 | High | Inspected (Phase 3) | P3: registry 108+5, cfg gating, setup, no lifecycle hooks verified | Phase 5: release artifact check | TR-012 |
| A2 | `src/runtime.rs`, `runtime/tests.rs` | Readiness state, single connection, lock, restore handoff | 2, 3 | High | Inspected (Phase 2) | P2: initialize/open/recover/with/prepare_restore read in full; tests mapped (14) | Phase 3: async/blocking, lifecycle | DATA-001, DATA-005, DATA-007 |
| A3 | `src/db/mod.rs`, `db/steps.rs`, `migrations/*.sql` (1–21) | PRAGMAs, migrations, pre-upgrade backup | 2 | High | Inspected (Phase 2) | P2: `db/mod.rs:145-286` read; steps idempotency and migration SQL for PRAGMA/BEGIN/rebuilds checked (L1) | Run upgrade tests (Phase 5) | DATA-010, DATA-011, DATA-016, DATA-017, DATA-019 |
| A4 | `src/db/*_tests.rs`, `db/fixtures/*.db` | Upgrade, catalogue and rulebook tests; synthetic legacy journals | 2, 5 | Medium | Partially inspected | P2: test names and coverage mapped (01 §9); not run (no offline crates); fixtures not opened | Execute in Phase 5 | — |
| A5 | `src/commands.rs` | 108 IPC command wrappers | 3 | High | Inspected (Phase 3) | P3: all commands mapped to TS callers; arg keys cross-checked; async/blocking model | — | TR-004, TR-005, TR-008 |
| A6 | `src/store/*` (21 repositories + 12 test files) | Accounts, trades, reviews, attachments, library, ledger, evidence, reconciliation, snapshots, risk promotion, rulebooks, catalogue, settings, freshness, insights, daily reviews | 2, 3 | High | Partially inspected | P2: write paths of trades, accounts, reviews, daily_reviews, rulebooks, journal, ledger, library, settings, attachments traced for transactions and revisions (L3, L1); catalogue/authoring/offers/evidence internals sampled only | Phase 3: panics (R-10), argument validation | DATA-006, DATA-015 |
| A7 | `src/store/attachments.rs` | Screenshot bytes outside the DB | 2, 3 | High | Inspected (Phase 2) | P2: `:190-300`, `:374-383` read | — | DATA-002, DATA-003 |
| A8 | `src/csv_import/*` | Parse, detect, normalize, dedup, target, commit | 2, 3, 4 | High | Inspected (Phase 2, persistence) | P2: commit atomicity, token binding, retry/duplicate behaviour, failed-batch record traced (L3; lead read `mod.rs:608-624`) | Phase 3: input validation/limits; Phase 4: UI | DATA-007, DATA-013, DATA-020 |
| A9 | `src/data_controls/archive.rs` | Export ZIP v1 / CSV, inspect | 2, 3 | High | Inspected (Phases 2, 3) | P2: dump/inventory/caps read; inspect safeguards mapped (L2) | — | DATA-003, DATA-004, DATA-018, TR-001, TR-007, TR-015, TR-016 |
| A10 | `src/data_controls/restore.rs` | Staged restore and recovery | 2, 3 | High | Inspected (Phase 2) | P2: `:68-360` state machine read; R-04 not an issue | Phase 3: path trust | DATA-001, DATA-002, DATA-012, DATA-014 |
| A11 | `src/data_controls/deletion.rs` | Account and journal permanent deletion, cleanup queue | 2, 3 | High | Inspected (Phase 2) | P2: preview/execute/recover_cleanup traced; lead read key ranges | — | DATA-001, DATA-004, DATA-012, DATA-018 |
| A12 | `src/data_controls/filesystem.rs`, `mod.rs` | Path, symlink and space checks; lock | 2, 3, 5 | High | Inspected (Phases 2, 5) | P2: write_new, sync_dir, publish, lock read | — | DATA-001, DATA-017, TR-007, WIN-001, WIN-002, TEST-005 |
| A13 | `src/legal.rs` | `legal-acceptance.json` | 2, 3, 5 | Medium | Inspected (Phase 2, persistence) | P2: atomic write and corrupt-record behaviour; boundary vs export/restore/erase confirmed | Phase 3: sync command I/O | — (no finding) |
| A14 | `src/domain.rs` | Trading day, P&L, money rules | 2, 4 | High | Not yet inspected | — | Parity with TS; DST and reset | — |
| A15 | `src/rulebook.rs`, `src/catalogue.rs`, `src/error.rs` | DTOs, `AppError` | 3 | Medium | Inspected (Phase 3) | P3: AppError serde vs TS; catalogue panic site unreachable; draft size caps | — | TR-017 |
| A16 | `src/parity.rs`, `src/wire_contract.rs`, `src/insights.rs` (test only) | Fixture generators | 4, 5 | Medium | Partially inspected | Role mapped; `FUNDEDFLOW_UPDATE_FIXTURES` checks noted (R-24) | — | — |
| A17 | `src/dev_tools/*`, `examples/seed-demo-journal.rs` | Debug-only seed and reset | 3, 5 | Medium | Inspected (Phase 3) | P3: isolation rules, refusal without fallback, spawn without shell verified | Phase 5: release artifact | TR-012 |
| A18 | `tauri.conf.json`, `capabilities/default.json` | Window, CSP, bundle, permissions | 3, 5 | High | Inspected (Phase 3) | P3: CSP, capabilities, plugins, bundle reviewed | `core:default` expansion vs generated schema | TR-013, TR-014 |
| A19 | `Cargo.toml`, `Cargo.lock`, `.cargo/audit.toml`, `about.toml`, `build.rs`, `icons/` | Dependencies, audit ignore, notices config | 3, 5 | Medium | Partially inspected | P3: profile, network crates (no TLS), audit ignore reviewed; icons/about not reviewed | Phase 5: advisories, 0BSD | — |

## B. Frontend (`apps/desktop/src`) and desktop config

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| B1 | `main.tsx`, `App.tsx`, `app/` (providers, shell, RuntimeProvider, error boundary) | Boot, routing, runtime state | 4 | High | Inspected (Phase 4) | P4: providers, runtime state machine, StrictMode, root boundary | — | UI-012 |
| B2 | `components/` (RuntimeGate, recovery notice, AccountLifecycle, CsvImportSection, DataModelPanel, ConfirmDialog) | Shared gates and legacy panels | 4 | Medium | Inspected (Phase 4) | P4: gate behaviour; legacy panels confirmed DEV-only | Bundle exclusion (Phase 5) | UI-006 |
| B3 | `lib/data/` (tauri-repository, api, runtime, legal, freshness, data-controls, calculate-risk, schemas, wire tests) | IPC bridge | 3, 4 | High | Inspected (Phase 3, IPC) | P3: every invoke mapped; Zod parsing; error mapping | Phase 4: calculate-risk | TR-008, TR-009, TR-010, TR-011 |
| B4 | `features/shared/` (submissions, operations, query keys, mutation and query hooks, errors, UncertainOutcomeReview) | Read/write lifecycle | 4 | High | Inspected (Phases 2, 4) | P4: hooks, scopes, invalidation, leave guard, R-13 dismissed | — | DATA-006–008, UI-005, UI-016, UI-017 |
| B5 | `features/accounts`, `features/rulebooks` | Accounts, attempts, rulebook editor | 4 | High | Inspected (Phase 4) | P4: active account, lifecycle dialogs, current assignment, calculation explanation | — | UI-001, UI-003, UI-004, UI-009, UI-010 |
| B6 | `features/today`, `features/insights` | Dashboard, risk, analytics | 4 | High | Inspected (Phase 4) | P4: Today hooks/fan-out, risk flow, Insights view models and parity | — | UI-002, UI-008, UI-018 |
| B7 | `features/journal`, `features/daily-reviews`, `features/reviews`, `features/library`, `features/trades` | Journal, trade detail, reviews, drafts | 4 | High | Inspected (Phase 4) | P4: delete/restore, review flows, daily review uncertain path, journal model ratios | Native close (Phase 5) | DATA-008, DATA-009, UI-004, UI-006, UI-011, UI-014 |
| B8 | `features/imports` | CSV wizard | 4 | High | Inspected (Phase 4) | P4: preview freshness, double click, quick-import effect, invalidation | — | UI-016, UI-017 |
| B9 | `features/data-controls`, `features/settings` | Export, restore, deletion, display zone | 4 | High | Inspected (Phase 4) | P4: stale-token UX, settings locks, display-zone scope vs spec | — | UI-003, UI-017, UI-020 |
| B10 | `features/legal`, `legal/` | First run and documents | 4, 5 | Medium | Inspected (Phase 4) | P4: gate states, preload timeout, fail-open (by design) / fail-closed read | Draft text (Phase 5 gate) | UI-012 |
| B11 | `features/evidence`, `features/ledger`, `features/references` | Financial evidence data hooks | 4 | Medium | Partially inspected | P4: callers mapped; ledger hooks unused in production | Card check for ledger UI | UI-020 |
| B12 | `design-system/` (incl. `format.ts`) | Components, money and time formatting | 4 | Medium | Inspected (Phase 4) | P4: money/sum/time functions, DST resolution, latent unknown→0 props | — | UI-013, UI-018 |
| B13 | `journeys/`, `test/` (harness, app-store, axe, fixtures) | Journey, accessibility and wire tests | 4, 5 | Medium | Inspected (Phase 4) | P4: workflow-to-test matrix; fake fidelity; axe coverage | Run tests (Phase 5) | UI-006, UI-007, UI-019 |
| B14 | `app/dev-tools/` | Developer panel (DEV only) | 3, 5 | Low | Inspected (Phase 3) | P3: DEV gating and dist marker check | Bundle verification (Phase 5) | TR-012 |
| B15 | `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `index.html`, `scripts/check-no-dev-tools.mjs`, `scripts/smoke-shell.mjs` | Build and test config | 4, 5 | Medium | Partially inspected | P4: tsconfig strictness noted | Phase 5 build | — |
| B16 | `THIRD_PARTY_NOTICES.txt`, `legal/third-party-summary.json` | Bundled notices | 5 | Medium | Partially inspected | Presence and counts | Currency vs lockfiles (needs cargo-about) | — |

## C. Shared domain (`packages/domain`)

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| C1 | `src/contracts`, `src/ports` | Zod DTOs, `JournalRepository` | 3, 4 | High | Inspected (Phases 3, 4) | P4: refines, nullability vs Rust | — | UI-015 |
| C2 | `src/primitives/money.ts` | bigint micro-units | 4 | High | Inspected (Phase 4) | P4: rounding/range match Rust | Run parity tests (Phase 5) | — |
| C3 | `src/engine`, `src/risk` | TS risk engine, hashing, promotion | 4 | High | Partially inspected | P4: inputs/provenance boundary, unknown gating, fixture provenance; full rule algorithms not line-reviewed | Owner decision UI-002 | UI-002 |
| C4 | `src/rulebook`, `src/catalogue`, `src/insights` | Contracts and metrics | 4 | Medium | Partially inspected | P4: insights selector/summarize parity and day arithmetic verified; catalogue/rulebook contracts sampled | — | — |
| C5 | `test/` (17 files) + `test/fixtures` (10 JSON) | Parity and contract tests | 4, 5 | Medium | Partially inspected | Listed | Run in Phase 5 | — |
| C6 | `scripts/` (clean, boundaries, dist, engine runtimes, fixture generator) | Build and boundary checks | 5 | Medium | Partially inspected | Side effects noted (`clean` deletes `dist`; generator rewrites a fixture; engine-runtimes needs Chromium) | — | — |

## D. Repository tooling, CI and docs

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| D1 | Root `package.json`, `package-lock.json` | Workspaces, scripts | 5 | Medium | Inspected (Phase 5) | P5: scripts' side effects inspected; four built-in-only scripts executed | — | — |
| D2 | `scripts/audit-guard.mjs` + test | Advisory-audit wrapper | 5 | Medium | Inspected (Phase 5) | P5: `test:ci-scripts` 8/8 passed at aad865f | — | TEST-004 |
| D3 | `scripts/dev-test-journal.mjs`, `reset-test-data.mjs`, `dev-reset-handoff.mjs` + tests | Dev journal tooling | 3, 5 | Medium | Inspected (Phase 5) | P5: `test:dev-scripts` 20/20 passed (temp dirs) | Windows detached helper unrun | — |
| D4 | `scripts/third-party-notices.mjs` + test + `licenses/` | Notices generator (needs network and cargo-about) | 5 | Medium | Inspected (Phase 5) | P5: `test:notices` 10/10 passed; generator/check:notices not run; 0BSD allow-listed and in use | Owner 0BSD disposition | TEST-008 |
| D5 | `.github/workflows/ci.yml` | Windows CI and dependency audit | 5 | High | Inspected (Phase 5) | P5: read fully; logs not read | Read candidate run | TEST-004, TEST-010 |
| D6 | `.github/workflows/release-installer.yml` | NSIS build, EXE SHA-256 | 5 | High | Inspected (Phase 5) | P5: read fully | — | WIN-006, WIN-007, WIN-008 |
| D7 | `.github/workflows/dev-tools.yml` | Dev-script tests (ubuntu and windows) | 5 | Low | Inspected (Phase 5) | P5 | — | — |
| D8 | `test_csvimport/` | CSV fixtures and contract vectors | 2, 5 | Medium | Partially inspected | Shapes only; rows not read | R-19 | — |
| D9 | `docs/data-model.md`, `docs/architecture/*` | Data model and contracts | All | Medium | Partially inspected | `packages.md` and data-model §§ migrations/startup read | R-26 (stale delete row) | — |
| D10 | `docs/build-*-evidence.md`, closeouts, handoffs, `docs/evidence/` | Historical acceptance evidence | 5, 6 | High | Inspected (Phase 5) | P5: each doc's SHA, ancestry and commits-behind recorded (04 §6) | — | WIN-007, TEST-002, TEST-011 |
| D11 | `docs/design/` (README, screens, mockups, references, components) | UI specs (visual references) | 4 | Low | Partially inspected | P4: specs for Today, Import, Trade detail, Daily review, Data controls, Rulebook, First run read | Other screen specs | UI-020 |
| D12 | `docs/brand/`, `docs/contracts/*.schema.json` | Brand assets, collector schemas | — | Low | Excluded with reason | Brand images carry no behaviour. Schemas belong to the collector (see E1). | — | — |
| D13 | `CLAUDE.md`, `README.md`, `LICENSE`, `.gitignore`, `.gitattributes`, `.vscode/` | Conventions and config | 1 | Low | Inspected | Read | — | — |

## E. Separate tool (secondary coverage)

| # | Area | Purpose | Phase(s) | Risk | Status | Depth / evidence | Remaining | Findings |
|---|---|---|---|---|---|---|---|---|
| E1 | `tools/prop-firm-collector` (src, tests, config, docs, `pyproject.toml`, `uv.lock`) + `.github/workflows/prop-firm-collector.yml` | Standalone, network-capable public-page collector with its own DB; no desktop consumer (deferred to V1.5) | 3 (static), 5 (offline checks only if the environment already exists) | Medium (separate) | Partially inspected (Phase 3 static) | P3: net/client, pinned backend, URL/address policy, robots, PDF subprocess, DB guard reviewed statically; no live fetch | Playwright WebSocket/port hypothesis | TR-019 |

## F. Excluded

| Path | Reason |
|---|---|
| `node_modules/`, `packages/domain/dist/`, `apps/desktop/dist/`, `apps/desktop/src-tauri/target/`, `src-tauri/gen/schemas`, Python caches | Generated or dependency output (git-ignored). The `gen/schemas` permission expansion is to be checked in Phase 3 if it can be generated offline. |
| Real `%APPDATA%\com.fundedflow.desktop` journal | Real user data: never opened in this audit |
| `db/fixtures/*.db` contents | Read-only synthetic fixtures; to be exercised only through existing tests |

## Workflow coverage (W-IDs from `00-repository-discovery.md` §7)

| Workflow | Phases | End-to-end traced? (Phase 1) |
|---|---|---|
| W1 startup, upgrade, recovery | 2, 3, 5 | **Traced end to end (Phase 2)** |
| W2 first run | 3, 4, 5 | Traced (Phases 3, 4); native gate unrun |
| W3–W11 journal features | 2, 4 | Traced end to end at source level (Phases 2, 4); workflow-to-test matrix in 03 §9 / L3 |
| W12–W14 export, restore, delete | 2, 3, 4 | **Traced end to end at the native level (Phase 2)**; UI in Phase 4 |
| W15 uncertain writes | 4 | **Traced end to end (Phases 2, 4)** |
| W16 install, upgrade, uninstall | 5 | Config and docs traced (Phase 5); **packaged run Not Run** |
| W17 dev tools | 3, 5 | Mapped |

## Change log

| Phase | Date | HEAD | Source changes since baseline | Notes |
|---|---|---|---|---|
| 1 | 2026-10-22 | 92e7980 | — (baseline) | Created. No checks executed. |
| 1 (verification pass) | 2026-10-22 | 92e7980 | None | Added the drift from `8c3dd34` (116 commits: migrations, db, runtime, data_controls and capabilities unchanged; `lib.rs` +1 command; `tauri.conf.json` minimum window size 800×480 and bundled resources; workflows changed). Added §9.1 confidence ratings and §9.2 test-gap mapping to the discovery report. Reports committed as `24e5c9e` at the stop hook's request (see discovery §11.2). |
| 2 | 2026-10-22 | 4fee79e | None in application source (only `code-review/`) | Phase 2 data integrity: DATA-001 to DATA-020. No tests run (no offline crates or node_modules). Rows A2–A4, A6–A13, B4, B7–B9 and W1, W3–W15 updated. |
| 3 | 2026-10-22 | feb00e2 | None in application source (`feb00e2` added the Phase 2 report, committed at the stop hook's request) | Phase 3 Tauri/Rust/IPC/security: TR-001 to TR-020. No checks run (no offline crates or node_modules). Rows A1, A5, A9, A15, A17–A19, B3, B14, E1 updated. |
| 4 | 2026-10-22 | feb00e2 (+ uncommitted 02 report) | None in application source | Phase 4 React/TS: UI-001 to UI-020. No checks run (no node_modules). Rows B1–B15, C1–C4, D11 and W2, W3–W11, W15 updated. |
| 5 | 2026-10-22 | aad865f | None in application source (`aad865f` added Phase 3/4 reports at the stop hook's request) | Phase 5: WIN-001–012, TEST-001–011, gate register. Executed: check:boundaries, test:dev-scripts, test:ci-scripts, test:notices (all pass). Blocked: typecheck, vitest, build, check:dist, cargo test/clippy, collector (no installed deps). |
| 6 | 2026-10-22 | 7ca8c7f | None in application source (`7ca8c7f` added the Phase 5 report at the stop hook's request) | Final consolidation: findings merged into F-01–F-31 plus O-01 (05 §D). Adversarial verifier confirmed C1–C9, C12, C13; partially C10, C11. No new checks executed. |

## Final coverage status (Phase 6)

| Group | Final status | Notes |
|---|---|---|
| A. Rust host and storage | **Inspected** (A1–A3, A5, A7–A13, A15, A17, A18); **Partially inspected** (A4 tests not run, A6 store internals for catalogue/authoring/offers/evidence sampled, A14 `domain.rs` traced for trading day/P&L only, A16, A19) | No Rust tests executed (no offline crates) |
| B. Frontend | **Inspected** (B1–B10, B12–B14); **Partially inspected** (B11 evidence/ledger UI absent by design, B15 build config) | No Vitest executed (no node_modules) |
| C. Domain | **Inspected** (C1, C2); **Partially inspected** (C3 engine rule algorithms not line-reviewed, C4 catalogue/rulebook contracts sampled, C5, C6) | `check:boundaries` executed: OK |
| D. Tooling/CI/docs | **Inspected** (D1–D7, D10, D13); **Partially inspected** (D8 fixture rows deliberately unread, D9, D11 seven specs read); **Excluded** (D12) | Script tests executed: 38/38 pass |
| E. Collector | **Partially inspected** (static, secondary) | No checks run (no venv) |
| Workflows | W1, W2, W12–W15 traced end to end at source level; W3–W11 traced UI→IPC→store; **W16 install/upgrade/uninstall: config/docs only, packaged run Not Run**; W17 dev tools traced | — |
| Significant remaining gaps | Executed TS/Rust test results at HEAD; any Windows/WebView2/NSIS runtime behaviour; engine rule-algorithm line review; CI log content | See 05 §O |
