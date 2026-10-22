# TASK-014 — Fix: restore/deletion preview tokens hash the live journal without a capped full dump

| Field | Value |
|---|---|
| Status | Ready for Approval |
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
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
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
`src-tauri/src/data_controls/restore.rs` (`content_hash`, `counts`), `src-tauri/src/data_controls/deletion.rs` (`preview`), possibly a streaming hash helper in `archive.rs`; tests. Also replace `archive::dump(&simulation)` at `deletion.rs:175` and the per-account counts at `deletion.rs:190-205`.

## Out of scope
Export-side caps (archive format, owner decision).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Introduce a streaming, deterministic hash of live table contents covering the same tables as `dump` and including rowids, in the same table/row order, without the size cap.
3. Use it for the restore `token`, the deletion preview tokens and the deletion simulation comparison (`deletion.rs:175`).
4. Compute per-table and per-account counts (`deletion.rs:190-205`) with `count(*)` queries, not a full dump; `replacedEntities` output must stay byte-identical (`packages/domain/test/fixtures/data-controls-wire.json` unchanged).
5. Tests: erase preview and restore inspect succeed on a journal over the dump cap; token changes when any row (incl. rowid-only change) changes.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-013.
- Likely shared-file conflicts: `restore.rs`/`deletion.rs` with TASK-015/016/017.

## Acceptance criteria (pass/fail)
- [ ] New over-cap preview tests pass; fail before.
- [ ] Stale-token tests still pass (`data_controls/tests.rs` stale-preview cases).
- [ ] Full Rust and root checks → exit 0.
- [ ] `replacedEntities` and `packages/domain/test/fixtures/data-controls-wire.json` are byte-identical to before (fixture test passes without regeneration).
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

## Independent review notes
Independent review (Block 3, 2026-10-22): CHANGES REQUIRED on r1. All listed corrections applied in r2 (see 08 index §H for the per-card list). Re-check by the approving reviewer recommended before execution.
