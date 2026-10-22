# TASK-012 — Fix: archive schema validation uses an exact allow-list for sqlite internal objects

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-005 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TR-001 |
| Source card / date | Stage 1 audit 2026-10-22 (02 TR-001; 05 F-05) |
| Wave | W1 |
| Effort / risk | S–M / Medium (all restore paths) |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 4d4e66d (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 nits from 10 §8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 4d4e66d (HEAD at r3; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
A tampered/crafted archive can install hidden triggers (e.g. `CREATE TRIGGER sqlitex_t …`) because `name NOT LIKE 'sqlite_%'` treats `_` as a wildcard.

## Trigger / reproduction
Owner restores an archive built or modified by someone else.

## Root cause / evidence
`src-tauri/src/data_controls/archive.rs:466` (`schema()`) and `:77` (`dump()`) filter with LIKE; restore candidate opened via `db::open_file` with `trusted_schema` ON (`src-tauri/src/data_controls/restore.rs:73, 116`).

## Expected change scope
`src-tauri/src/data_controls/archive.rs` (`schema`, `dump`); `src-tauri/src/data_controls/restore.rs` and `src-tauri/src/db/mod.rs` (`open_file` migrates internally: add a restore-only open variant that sets `trusted_schema=OFF` before `migrate`; do not change the shared `configure`/`open_file` in this PR); `src-tauri/src/data_controls/security_tests.rs` (new cases). The live-connection `trusted_schema=OFF` change is **deferred to V1.1** (08 §C.1 ISSUE-005, G1); when scheduled it must run `db/upgrade_tests.rs` on the v3/v4/v8 fixtures.

## Out of scope
Archive format changes; dump format changes; cap changes (TASK-013).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Replace the LIKE filter with an exact allow-list by `(type, name)`: tables `sqlite_sequence`, `sqlite_stat1`, `sqlite_stat4`; indexes whose name starts with `sqlite_autoindex_` and whose `sql IS NULL`. Any other object whose name begins case-insensitively with `sqlite` fails validation with `Integrity`.
3. Apply the same rule in `dump()` so hidden tables cannot escape `data.json` equality; existing v1 archives must still match.
4. Ensure the restore candidate connection has `PRAGMA trusted_schema=OFF` before any migration runs via the restore-only open variant (shared `configure`/`open_file` unchanged).
5. Security tests: archives with `CREATE TRIGGER sqlitex_evil`, `CREATE TABLE SQLITE1(x)`, `CREATE VIEW sqliteA AS SELECT 1`, and a `sqlite_x` trigger planted via `PRAGMA writable_schema` → `Integrity`; a journal with a non-empty `sqlite_sequence`, and one with `sqlite_stat1` after `ANALYZE`, still export and restore.
6. Previous-version rollback test: run `ANALYZE` on the live test journal (so `sqlite_stat1` exists; `sqlite_sequence` already exists via the AUTOINCREMENT table), prepare a restore through the unchanged `prepare`/`snapshot` path, and rewrite the pending marker to the `installing` phase as `data_controls/tests.rs:280-286` does, so the operation folder has the same shape a previous version leaves. Recovery takes the `installing` branch (`restore.rs:336-337`) and must roll back: `rollback` validates `safety.db` with `archive::validate_database` (`restore.rs:345-346`, which compares `schema()` against a fresh reference at `archive.rs:476-487`), so the new allow-list must accept that copy.

## Prerequisites, dependencies and conflicts
- Prerequisites: None (first in W1).
- Likely shared-file conflicts: `archive.rs` shared with TASK-013/014/016/017 — merge first.

## Acceptance criteria (pass/fail)
- [ ] `apps/desktop/src-tauri`: `cargo test --offline --locked security_tests` → new cases pass; they fail on the pre-fix code (record).
- [ ] Existing archive tests pass: `cargo test --offline --locked data_controls` → exit 0.
- [ ] The previous-version rollback test (step 6) passes both before and after the change (it guards rollback, so it is exempt from the fails-before rule): after recovery the journal's `dump` equals its pre-restore `dump`.
- [ ] Full Rust checks: `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially); `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check (the Rust fixture tests rewrite tracked fixtures whenever the variable is set, to any value); never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing: `data_controls/security_tests.rs`, `data_controls/tests.rs`, `current_schema_tests.rs`. New: the four crafted archives plus the `sqlite_sequence`/`sqlite_stat1` positive cases.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`. Rollback: revert (code-only).

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- Added a test that a safety copy prepared by the previous version (`installing` phase) still rolls back (`restore.rs:336-337, 345-346`) (10 §8.3 TASK-012).
- Live-connection `trusted_schema=OFF` is now stated as deferred to V1.1, matching 08 §C.1 (10 §8.1, G1).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.3): nits only — applied in r3.
Independent review r3 (2026-10-22): CHANGES on 012, 024, 026 (citations, test construction, scope lines); applied. READY.
