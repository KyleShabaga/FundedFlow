# TASK-016 — Fix: stray files under attachments/ no longer block restore and erase

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-003 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-002 |
| Source card / date | Stage 1 audit 2026-10-22 (01 DATA-002; 05 F-03) |
| Wave | W1 |
| Effort / risk | M / High |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
`validate_managed` requires on-disk files == DB inventory; a stray screenshot or `.part` file (crash between rename and commit, power loss under synchronous=NORMAL, failed `remove_file`) blocks restore prepare and the whole-journal erase preview with a misleading 'shared history' message.

## Trigger / reproduction
Crash or power loss shortly after adding a screenshot.

## Root cause / evidence
`src-tauri/src/data_controls/restore.rs:212-255` (`managed_files`/`validate_managed`/`copy_managed`), `deletion.rs:211-213`; `src-tauri/src/store/attachments.rs:200-291` produces strays.

## Expected change scope
`restore.rs` (`validate_managed`, `copy_managed`, `prepare`), `deletion.rs` (`preview`), `data_controls/mod.rs` (`Code` enum: new distinct code), TS `apps/desktop/src/features/data-controls/api/data-controls.ts` (message) and `packages/domain` data-controls contracts (new code), domain wire fixture `packages/domain/test/fixtures/data-controls-wire.json` only if the error-code list is fixture-pinned (name it in the PR); tests.

## Out of scope
Startup sweep of orphans (optional later); attachment write ordering change.

## Implementation approach
1. Classify unreferenced files under `attachments/`: names matching `screenshots/<uuid>.<ext>` or `.<uuid>.part` are 'unowned managed extras'; anything else stays UnsafePath.
2. Restore prepare: copy extras into the safety copy (`safety-attachments/`) so no bytes are lost; do not install them into the restored journal.
3. Whole-journal erase preview: list extras in the preview and remove them on confirm (bytes are being erased anyway).
4. Add a distinct error code/message for genuinely ambiguous ownership; replace the 'shared history' wording.
5. Tests: plant `attachments/screenshots/<uuid>.png` and `.<uuid>.part`; restore prepare succeeds with the extra preserved in the safety copy; erase preview lists it.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-015.
- Likely shared-file conflicts: `restore.rs`/`deletion.rs` with TASK-014/015/017; `mod.rs` Code enum with TASK-017.

## Acceptance criteria (pass/fail)
- [ ] New tests pass and fail before the change.
- [ ] `data_controls/tests.rs:198, 450, 520, 748` and `store/journal_review_tests.rs:493` pass.
- [ ] Root `npm test` passes (TS mapping) and full Rust checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Contract change: if the TS error-code union changes, run `npm run typecheck` and the data-controls wire tests.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`. Extras are preserved in the safety copy before anything is replaced.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.
