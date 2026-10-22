# TASK-012 — Fix: archive schema validation uses an exact allow-list for sqlite internal objects

| Field | Value |
|---|---|
| Status | Proposed |
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
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
A tampered/crafted archive can install hidden triggers (e.g. `CREATE TRIGGER sqlitex_t …`) because `name NOT LIKE 'sqlite_%'` treats `_` as a wildcard.

## Trigger / reproduction
Owner restores an archive built or modified by someone else.

## Root cause / evidence
`src-tauri/src/data_controls/archive.rs:466` (`schema()`) and `:77` (`dump()`) filter with LIKE; restore candidate opened via `db::open_file` with `trusted_schema` ON (`src-tauri/src/data_controls/restore.rs:73, 116`).

## Expected change scope
`src-tauri/src/data_controls/archive.rs` (`schema`, `dump`); `src-tauri/src/data_controls/restore.rs` (candidate open: set `trusted_schema=OFF` before migration); `src-tauri/src/data_controls/security_tests.rs` (new cases). Optional (separate commit, same task): `trusted_schema=OFF` in `src-tauri/src/db/mod.rs::configure` for the live connection.

## Out of scope
Archive format changes; dump format changes; cap changes (TASK-013).

## Implementation approach
1. Replace the LIKE filter with: exclude exactly `sqlite_sequence`, `sqlite_stat1`, `sqlite_stat4` and `sqlite_autoindex_%` rows whose `sql IS NULL`; any other name beginning case-insensitively with `sqlite` (including `sqlite_` objects with non-NULL sql) makes validation fail with `Integrity`.
2. Apply the same rule in `dump()` so hidden tables cannot escape `data.json` equality; keep `sqlite_sequence`/`sqlite_stat*` excluded so existing v1 archives still match.
3. Set `PRAGMA trusted_schema=OFF` on the restore candidate connection before migrating.
4. Add security tests: archives containing `CREATE TRIGGER sqlitex_evil`, `CREATE TABLE SQLITE1(x)`, `CREATE VIEW sqliteA AS SELECT 1` → `Integrity`; an untouched current export still restores.

## Prerequisites, dependencies and conflicts
- Prerequisites: None (first in W1).
- Likely shared-file conflicts: `archive.rs` shared with TASK-013/014/016/017 — merge first.

## Acceptance criteria (pass/fail)
- [ ] `apps/desktop/src-tauri`: `cargo test --offline --locked security_tests` → new cases pass; they fail on the pre-fix code (record).
- [ ] Existing archive tests pass: `cargo test --offline --locked data_controls` → exit 0.
- [ ] Full Rust checks: `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially); `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing: `data_controls/security_tests.rs`, `data_controls/tests.rs`, `current_schema_tests.rs`. New: the three crafted-name archives.

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
