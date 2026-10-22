# TASK-014 — Fix: restore/deletion preview tokens hash the live journal without a capped full dump

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-002 (part b) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-004 |
| Source card / date | Stage 1 audit 2026-10-22 |
| Wave | W1 |
| Effort / risk | M / High (destructive flows' safety token) |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Restore inspect (`src-tauri/src/data_controls/restore.rs:56-67, 77`) and deletion preview (`deletion.rs:133`) call `archive::dump(live)` and inherit its caps, so a large journal cannot be erased or restored over.

## Trigger / reproduction
Large live journal.

## Root cause / evidence
Live-side token derived from a capped, fully materialised dump.

## Expected change scope
`src-tauri/src/data_controls/restore.rs` (`content_hash`, `counts`), `src-tauri/src/data_controls/deletion.rs` (`preview`), possibly a streaming hash helper in `archive.rs`; tests.

## Out of scope
Export-side caps (archive format, owner decision).

## Implementation approach
1. Introduce a streaming, deterministic hash of live table contents (same table/row ordering as `dump`) without the size cap.
2. Use it for restore `token` and deletion preview tokens; keep the token prefix versions (`restore-v1`, `deletion-v1`) or bump them (tokens are transient).
3. Deletion preview still needs per-table counts — compute with `count(*)` queries, not a full dump.
4. Tests: erase preview and restore inspect succeed on a journal over the dump cap; token changes when any row changes.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-013.
- Likely shared-file conflicts: `restore.rs`/`deletion.rs` with TASK-015/016/017.

## Acceptance criteria (pass/fail)
- [ ] New over-cap preview tests pass; fail before.
- [ ] Stale-token tests still pass (`data_controls/tests.rs` stale-preview cases).
- [ ] Full Rust and root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing stale-preview and erase tests in `data_controls/tests.rs`; `current_schema_tests.rs`.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.
