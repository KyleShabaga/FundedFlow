# TASK-015 — Fix: deletion cleanup markers are atomic and cannot block journal startup

| Field | Value |
|---|---|
| Status | Proposed |
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
| Specification revision | r1 (2026-10-22) |
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
1. Write cleanup markers via NamedTempFile + sync + persist in the queue directory.
2. In `recover_cleanup`, move an unparseable/oversized/non-regular marker to a sibling quarantine directory `data-controls-quarantine/` in the data root — NOT inside `data-controls-cleanup/` (`recover_cleanup` rejects non-regular queue entries, `deletion.rs:327-330`) and NOT inside `data-controls/` (`recovery_copies` rejects non-UUID entries, `deletion.rs:104`) — and continue; never delete it. Whole-journal erase must also remove this directory (add it to the erase recovery-copy list) and say so in the preview.
3. Treat per-file removal failure as a recorded pending cleanup; `Runtime::open` must still return Ready with the pending state visible in status detail.
4. Keep the owned-row check: never remove a file any row references.
5. Name the marker/file path in `failure.detail` when any cleanup issue is reported.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-014 (shared deletion.rs merge order).
- Likely shared-file conflicts: `deletion.rs` with TASK-014/016/017; `runtime.rs` with TASK-018.

## Acceptance criteria (pass/fail)
- [ ] Runtime test: zero-byte `data-controls-cleanup/<uuid>.json` → `Runtime::start` reaches Ready; marker moved to quarantine.
- [ ] Runtime test: listed attachment replaced by a directory → Ready with cleanup pending; nothing deleted.
- [ ] Existing `data_controls/tests.rs:580` (`committed_delete_reports_cleanup_pending_and_retry_is_safe`) still passes.
- [ ] Full Rust and root checks → exit 0.
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
