# TASK-013 — Fix: live-journal size checks count used pages and name the component over the limit

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Fix |
| Audit priority | P1 (P0 if TASK-010 escalates) |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-002 (part a) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-004 |
| Source card / date | Stage 1 audit 2026-10-22 (01 DATA-004; 05 F-02) |
| Wave | W1 |
| Effort / risk | M / High (export/restore/erase) |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
`archive::dump` refuses journals whose `page_count × page_size` (including free pages) exceeds 64 MiB, which blocks export, restore-over, erase and account deletion with a generic `LimitExceeded`.

## Trigger / reproduction
Large or never-vacuumed journal (growth from frozen calculation inputs).

## Root cause / evidence
`src-tauri/src/data_controls/archive.rs:72-76` uses `page_count` without subtracting `freelist_count`; the error does not identify the component.

## Expected change scope
`src-tauri/src/data_controls/archive.rs` (`dump` size check, error detail); export and restore-prepare snapshot copies (they copy free pages through the backup API, so either `VACUUM` the snapshot/temporary copy before the size check, or limit acceptance to the live-side checks — decide in the PR and record); Contract change (named): add an optional `detail` field to the Rust `ControlError` (`src-tauri/src/data_controls/mod.rs`, today `{code, message}`), to the Zod schema in `packages/domain/src/contracts/data-controls.ts`, and render it in `apps/desktop/src/features/data-controls/api/data-controls.ts` (today only `CODE_COPY[code]`); update `packages/domain/test/fixtures/data-controls-wire.json` deliberately in the same PR with the diff reviewed (this card authorises that one fixture). Tests in `src-tauri/src/data_controls/tests.rs` and the TS data-controls tests.

## Out of scope
Raising archive caps or changing archive format (owner decision TASK-009 D-ARCH); stream hashing (TASK-014); frozen-input redesign (depends on TASK-003, V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Compute used bytes as `(page_count − freelist_count) × page_size` for the live-side size check; for export/restore-prepare snapshots apply the option chosen in the PR (VACUUM the temporary snapshot, never the live journal, or narrowed acceptance).
3. When any cap is exceeded, return the existing code with `detail` naming the component (database pages / rows / data.json / total archive / entry count) and the measured value.
4. Render the detail in user-facing copy that says which limit was exceeded.
5. Tests: a journal with >64 MiB free pages but small live data → erase preview succeeds; export succeeds if VACUUM was chosen, otherwise its error detail names database pages; a journal over a real cap → error detail names the component.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-012 (same file, merge order); TASK-010 result (priority).
- Likely shared-file conflicts: `archive.rs::dump` with TASK-012/014.

## Acceptance criteria (pass/fail)
- [ ] New test with large freelist passes; it fails before the change.
- [ ] Over-cap test asserts the component name.
- [ ] `apps/desktop/src-tauri`: `cargo test --offline --locked data_controls` → exit 0.
- [ ] Full Rust and root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing: `data_controls/tests.rs:30,147,198,450`, `security_tests.rs:117`.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`. The `data.json` byte format must not change.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
