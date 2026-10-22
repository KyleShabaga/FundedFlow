# TASK-017 — Fix: missing/changed attachment files no longer block erase and restore

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-004 (erase/restore part) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-003 |
| Source card / date | Stage 1 audit 2026-10-22 (01 DATA-003; 05 F-04) |
| Wave | W1 |
| Effort / risk | M / High |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
`archive::inventory` fails with MissingAttachment if any attachments row (including soft-deleted) has a missing or changed file; this blocks restore prepare and the erase preview.

## Trigger / reproduction
AV quarantine, AppData tidying, disk damage.

## Root cause / evidence
`src-tauri/src/data_controls/archive.rs:154-173`; callers `restore.rs:127`, `deletion.rs:211`.

## Expected change scope
`restore.rs` (`prepare`: keep `safety-inventory.json` present-only and record missing/changed files in a separate `safety-missing.json`; relax `validate_managed` in `copy_managed` (`restore.rs:129`) for recorded-missing files; `rollback`), `deletion.rs` (`preview`), `archive.rs` (an inventory variant that reports rather than fails), `mod.rs`. Contract change (named): add an optional `detail` field to the Rust `ControlError` (`src-tauri/src/data_controls/mod.rs`, today `{code, message}`), to the Zod schema in `packages/domain/src/contracts/data-controls.ts`, and render it in `apps/desktop/src/features/data-controls/api/data-controls.ts` (today only `CODE_COPY[code]`); update `packages/domain/test/fixtures/data-controls-wire.json` deliberately in the same PR with the diff reviewed (this card authorises that one fixture). Export keeps strict behaviour, so `data_controls/tests.rs:49` (export) must not change; add restore and erase tests instead.

## Out of scope
**Export** without missing attachments (needs archive format decision TASK-009 D-ARCH; V1.1). Repair command (V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Add an inventory mode returning (present, missing/changed) lists.
3. Restore prepare: `safety-inventory.json` lists present files only; missing/changed live files go to `safety-missing.json`; rollback and `copy_managed` accept files listed there.
4. Erase preview: report missing files by id and proceed (their bytes are being erased).
5. Export keeps today's strict behaviour; its error `detail` names the missing attachment ids.
6. Tests: delete one live screenshot → restore prepare and erase preview succeed and report it; rollback with a recorded-missing file succeeds; export error detail names it.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-016.
- Likely shared-file conflicts: Same files as TASK-016.

## Acceptance criteria (pass/fail)
- [ ] New restore/erase/rollback tests pass and fail before the change.
- [ ] `data_controls/tests.rs:49` unchanged and passing.
- [ ] Full Rust and root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Rollback test with a missing file in the safety inventory.

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
