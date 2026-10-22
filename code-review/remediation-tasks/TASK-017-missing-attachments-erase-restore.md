# TASK-017 — Fix: missing/changed attachment files no longer block erase and restore

| Field | Value |
|---|---|
| Status | Proposed (r3; awaiting independent review) |
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
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
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
`restore.rs` (`prepare`: keep `safety-inventory.json` present-only and record missing/changed files in a separate `safety-missing.json`; relax `validate_managed` in `copy_managed` (`restore.rs:129`) for recorded-missing files; `rollback`; `inspect` warning), `deletion.rs` (`preview`), `archive.rs` (an inventory variant that reports rather than fails), `mod.rs`. Missing/changed attachment ids are carried in the **existing** `warnings` arrays — `DeletionPreview.warnings` (`deletion.rs:32`, built at `:234-236`) and `RestorePreview.warnings` (`restore.rs:26`, built in `inspect` at `:81-83`) — with **no new field**; TASK-016's extras field is not touched. The data-controls dialogs do not render `warnings` today (`features/data-controls/components/DeletionDialog.tsx`, `RestoreArchiveDialog.tsx`); render the missing-attachment warning there. Reuse the optional `detail` field added by TASK-013. The wire test scenario has no missing files, so `packages/domain/test/fixtures/data-controls-wire.json` is expected unchanged; if a missing-id example is added, its diff is limited to that `warnings`/`detail` example (reviewed). Export keeps strict behaviour, so `data_controls/tests.rs:49` (export) must not change; add restore and erase tests instead.

## Out of scope
**Export** without missing attachments (needs archive format decision TASK-009 D-ARCH; V1.1). Repair command (V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Add an inventory mode returning (present, missing/changed) lists.
3. Restore prepare: `safety-inventory.json` lists present files only; missing/changed live files go to `safety-missing.json`; rollback and `copy_managed` accept files listed there. A missing `safety-missing.json` (a restore prepared by the previous version, which writes only `safety-inventory.json` at `restore.rs:134-137`) means an empty list, not an error. Restore preview (`inspect`) adds a `warnings` entry naming the missing/changed ids.
4. Erase preview: report missing files by id in `DeletionPreview.warnings` and proceed (their bytes are being erased).
5. Export behaviour unchanged except `detail` names the missing attachment ids.
6. Tests: delete one live screenshot → restore prepare and erase preview succeed and their `warnings` name it; rollback with a recorded-missing file succeeds; rollback of a restore prepared by the previous version (operation folder with `safety-inventory.json` and no `safety-missing.json`, `installing` phase) succeeds; export error detail names it.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-016.
- Likely shared-file conflicts: Same files as TASK-016.

## Acceptance criteria (pass/fail)
- [ ] New restore/erase/rollback tests pass and fail before the change.
- [ ] Missing ids appear in `DeletionPreview.warnings` and `RestorePreview.warnings`; no new preview field is added (TS schema `packages/domain/src/contracts/data-controls.ts` preview objects unchanged).
- [ ] Rollback of a restore prepared by the previous version (no `safety-missing.json`) succeeds.
- [ ] Export behaviour unchanged except `detail` names the ids; `data_controls/tests.rs:49` unchanged and passing.
- [ ] `packages/domain/test/fixtures/data-controls-wire.json` unchanged, or its diff limited to a reviewed missing-id `warnings`/`detail` example.
- [ ] Full Rust and root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

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

## Changes in r3
- 10 §8.2 TASK-017 (G12): missing ids are carried in the existing `DeletionPreview.warnings` and `RestorePreview.warnings`, with no new field; consistent with TASK-016, which adds one extras field and leaves `warnings` unchanged.
- 10 §8.2 TASK-017 (G12): a missing `safety-missing.json` means an empty list; added a test for rollback of a restore prepared by the previous version.
- 10 §8.2 TASK-017 (G12): export step reworded to "export behaviour unchanged except `detail` names the ids", with a matching criterion.
- 10 §8.3 fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` must be unset (not `0`).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: missing ids in existing preview `warnings`, no new field (G12); missing `safety-missing.json` = empty list, previous-version rollback test (G12); export step limited to `detail`; fixture rule "unset (not `0`)".
