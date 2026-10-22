# TASK-015 — Fix: deletion cleanup markers are atomic and cannot block journal startup

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-001 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-001 |
| Source card / date | Stage 1 audit 2026-10-22 (01 DATA-001; 05 F-01) |
| Wave | W1 |
| Effort / risk | M / High (startup, erase) |
| Verification platform | Any OS (+ Windows in TASK-032) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
A truncated/malformed `data-controls-cleanup/<op>.json`, a non-regular entry, or a persistent file lock makes every startup fail with a message naming no file.

## Trigger / reproduction
Crash/power loss while the marker is written (`write_new` = create_new+write+sync, not temp+rename) or AV lock on a file being removed.

## Root cause / evidence
`src-tauri/src/data_controls/deletion.rs:287-293` (non-atomic write), `:321-386` (`recover_cleanup` returns Err on any problem); `src-tauri/src/runtime.rs:352-356` turns that into OpenFailed.

## Expected change scope
`src-tauri/src/data_controls/deletion.rs`, `src-tauri/src/data_controls/filesystem.rs` (atomic write helper mirroring `restore.rs::write_pending`), `src-tauri/src/runtime.rs` (cleanup failure non-fatal with status detail), `src-tauri/src/runtime/tests.rs`, `src-tauri/src/data_controls/tests.rs`.

## Out of scope
Recovery-copy pruning (V1.1, TASK-009 D-RET); restore marker semantics (installing phase stays fail-closed).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Write cleanup markers via NamedTempFile + sync + persist in the queue directory.
3. In `recover_cleanup`, move an unparseable/oversized/non-regular marker to a sibling `data-controls-quarantine/` in the data root (NOT inside `data-controls-cleanup/`, whose non-regular entries are rejected at `deletion.rs:327-330`, and NOT inside `data-controls/`, see `deletion.rs:104`); add `data-controls-quarantine` to the data-root key allow-list in `recover_cleanup` (`deletion.rs:361-366`); never delete it. Whole-journal erase also removes this directory and the preview says so (copy text only; no DeletionPreview/wire change).
4. Make the pending/quarantined state observable without breaking the Ready contract: `runtime.ts` superRefine requires `failure: null` when Ready, so either add a new status field (Rust `runtime.rs` + `apps/desktop/src/lib/data/runtime.ts` schema + UI + docs, named in the PR) or surface it through the existing `retry_data_cleanup` path. Choose one in the PR and record it.
5. Treat per-file removal failure as a recorded pending cleanup; `Runtime::open` returns Ready.
6. Keep the owned-row check: never remove a file any row references. Note: a quarantined marker means its listed files remain as strays (handled by TASK-016 classification).
7. Cover both call sites: startup and `prepare_restore` (`runtime.rs:230`).

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-014 (shared deletion.rs merge order).
- Likely shared-file conflicts: `deletion.rs` with TASK-014/016/017; `runtime.rs` with TASK-018.

## Acceptance criteria (pass/fail)
- [ ] Runtime test: zero-byte `data-controls-cleanup/<uuid>.json` → `Runtime::start` reaches Ready; marker moved to quarantine.
- [ ] Runtime test: listed attachment replaced by a directory → Ready with cleanup pending; nothing deleted.
- [ ] Existing `data_controls/tests.rs:580` (`committed_delete_reports_cleanup_pending_and_retry_is_safe`) still passes.
- [ ] Full Rust and root checks → exit 0.
- [ ] Test: malformed marker present when `prepare_restore` runs (`runtime.rs:230`) → restore prepare proceeds; marker quarantined.
- [ ] Runtime status contract unchanged for existing states (`runtime.ts` schema tests pass); the chosen observable is tested.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Windows: optional AV-lock check in TASK-032 (manual recovery gate).

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`. Quarantine never deletes; revert loses nothing.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
