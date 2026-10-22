# TASK-017 — Fix: missing/changed attachment files no longer block erase and restore

| Field | Value |
|---|---|
| Status | Ready for Approval (r5) |
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
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r5 (2026-10-22; r4 + approved-task audit fixes + owner amendment folded in) |
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
`restore.rs` (`prepare`: keep `safety-inventory.json` present-only, record missing/changed files in a separate `safety-missing.json`, and preserve changed bytes in `safety-changed-attachments/` (owner amendment); `validate_managed` in `copy_managed` (`restore.rs:129`) accepts files recorded as **changed**, which are on disk but left out of the present-only list; the whole-journal erase preview's `validate_managed` call (`deletion.rs:213`) validates against present and changed keys only, see step 4; `inspect` warning), `deletion.rs` (`preview`), `archive.rs` (an inventory variant that reports rather than fails), `mod.rs`. Missing/changed attachments (original file name, else id) are carried in the **existing** `warnings` arrays — `DeletionPreview.warnings` (`deletion.rs:32`, built at `:234-236`) and `RestorePreview.warnings` (`restore.rs:26`, built in `inspect` at `:81-83`) — with **no new field**; TASK-016's extras field is not touched. The data-controls dialogs do not render `warnings` today (`features/data-controls/components/DeletionDialog.tsx`, `RestoreArchiveDialog.tsx`); render the missing-attachment warning there (step 3b). Reuse the optional `detail` field added by TASK-013. The wire test scenario has no missing files, so `packages/domain/test/fixtures/data-controls-wire.json` is expected unchanged; if a missing-id example is added, its diff is limited to that `warnings`/`detail` example (reviewed). Export keeps strict behaviour, so `data_controls/tests.rs:49` (export) must not change; add restore and erase tests instead.

## Out of scope
**Export** with missing attachments: TASK-009 decision (5) keeps archive v1 strict, and missing-attachment support in archives is a separate versioned change, not this card. This card changes no archive format: `safety-missing.json` is an operation-folder file, and archive import validation is unchanged. Repair command (V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Add an inventory mode returning (present, missing/changed) lists.
3. Restore prepare: `safety-inventory.json` lists present, verified files only; missing/changed live files go to `safety-missing.json`. Missing files are absent from disk and from the present-only list, so `validate_managed` already accepts them; only **changed** files (on disk, not in the list) need `validate_managed` to accept them as recorded. Rollback (`restore.rs:345-349`) uses only `safety-inventory.json` and needs no change. A missing `safety-missing.json` (a restore prepared by the previous version, which writes only `safety-inventory.json` at `restore.rs:134-137`) means an empty list, not an error; the new build always writes it, even when empty. Restore preview (`inspect`) adds a `warnings` entry naming the missing/changed attachments.
3a. Changed-bytes preservation (owner amendment, 2026-10-22): existing changed attachment bytes are preserved separately from verified attachments before restore replaces them, in `data-controls/<op>/safety-changed-attachments/<storage key>`, never in `safety-attachments/`. Each `safety-missing.json` entry records `id`, `storageKey`, the recorded `byteSize` and `sha256`, `state` (`missing` or `changed`), and for `changed` the actual byte size and SHA-256 of the preserved copy. A file is preserved only if it is safely readable: `regular()` (no reparse point, one link), at most `MAX_ENTRY`, within `hash_file`'s limit, copied hash-verified (hash the source, copy, re-hash), after a `space()` check for the copies. Preservation happens in `prepare` before `write_pending` (`restore.rs:144`); if any changed file cannot be preserved, `prepare` fails before `write_pending`, so replacement is blocked and the live journal and `attachments/` are untouched. The preserved copies stay in the operation folder after a successful restore and after a rollback; rollback does not reinstate them into `attachments/` (as TASK-016 does for extras), so after rollback the journal shows that attachment as missing.
3b. Warnings (audit SHOULD 017-S3): each missing/changed entry is one `warnings` string with a stable prefix (for example `Missing or changed attachment: `) followed by the attachment's original file name where it has one, else its id. The dialogs render only the warnings with that prefix, so the three fixed erase warnings (`deletion.rs:234-236`) are not shown twice next to "What stays".
4. Erase preview: report missing/changed files in `DeletionPreview.warnings` (step 3b) and proceed (their bytes are being erased). The journal-scope `attachments` list, and so the cleanup marker, includes every attachments row, missing and changed ones too (audit SHOULD 017-S4): `recover_cleanup` already skips absent paths (`deletion.rs:342`), and changed bytes are then erased without relying on TASK-016's `screenshots/` name re-derivation, which misses other keys (for example `opaque/file.png`, `data_controls/tests.rs:54`). The erase preview validates the managed root (`deletion.rs:213`, which requires the files on disk to equal the expected keys, `restore.rs:249-252`) against the present and changed keys only (or `validate_managed` accepts recorded-missing keys as absent), so missing rows do not make it fail with `UnsupportedOwnership`; the marker and the `attachments` list still carry every row. The erase dialog's "removed from disk" line (`DeletionDialog.tsx:162-164`) keeps counting every listed row with its recorded size; the missing-attachment warning shown with it (step 3b) says which are already absent.
5. Export behaviour unchanged except `detail` names the missing attachment ids.
6. Tests: delete one live screenshot → restore prepare and erase preview succeed and their `warnings` name it; rollback with a recorded-missing file succeeds (guard: passes on today's code too, because rollback reads only `safety-inventory.json`); rollback of a restore prepared by the previous version (operation folder with `safety-inventory.json` and no `safety-missing.json`, `installing` phase) succeeds (guard); export error detail names it. Owner amendment: overwrite one live screenshot with different bytes of the **same size** (checksum mismatch only) → `prepare` succeeds, the changed bytes are in `safety-changed-attachments/` with `state: changed` and their actual hash in `safety-missing.json`, and not in `safety-attachments/`; they are still there after `recover` installs and, in a separate run, after rollback (`recover_failing`); when the changed file cannot be preserved (for example replaced by a non-regular entry or a too-small free-space check), `prepare` fails, no `data-controls-pending.json` is written and the live files are unchanged; an erase marker lists the missing and changed rows.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-016; TASK-013 (`detail`, previously only a transitive dependency).
- Likely shared-file conflicts: Same files as TASK-016.

## Acceptance criteria (pass/fail)
- [ ] New restore/erase tests pass and fail before the change; the two rollback tests named as guards in step 6 pass before and after.
- [ ] Owner amendment: same-size checksum-mismatch test passes: changed bytes preserved in `safety-changed-attachments/`, separate from `safety-attachments/`, and present after both a successful restore and a rollback.
- [ ] Owner amendment: when preservation fails, `prepare` fails before `write_pending` and nothing is replaced.
- [ ] A new build's prepare always writes `safety-missing.json` (empty array when nothing is missing or changed).
- [ ] Each missing/changed attachment appears as a prefixed `warnings` entry (original file name, else id) in `DeletionPreview.warnings` and `RestorePreview.warnings`; no new preview field is added (TS schema `packages/domain/src/contracts/data-controls.ts` preview objects unchanged).
- [ ] Rollback of a restore prepared by the previous version (no `safety-missing.json`) succeeds.
- [ ] Repository root: `npm run test -w @fundedflow/desktop -- src/features/data-controls` → exit 0, and it asserts that DeletionDialog and RestoreArchiveDialog render a prefixed preview `warnings` entry naming a missing attachment, and do not render the fixed erase warnings.
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

## Changes in r4
- Out of scope: replaced "needs archive format decision TASK-009 D-ARCH; V1.1" with the approved TASK-009 decision (5): archive v1 stays strict; missing-attachment support in archives is a separate versioned change. Stated that this card's erase/restore changes (live-side inventory, `safety-missing.json` in the operation folder, preview `warnings`, export error `detail`) change no archive format, so the card is consistent with that decision.

## Changes in r5
- Scope, step 3a, step 6 and criteria: changed attachment bytes are preserved in `safety-changed-attachments/`, separate from verified attachments, before restore replaces them; they remain after success and rollback; a same-size checksum-mismatch test is required; a preservation failure blocks replacement (owner amendment, 2026-10-22).
- Step 3a: the persistence design is fixed: folder name, `safety-missing.json` fields, always written by the new build, rollback does not reinstate changed bytes (audit SHOULD 017-S1). Also "safely readable" defined and preservation placed before `write_pending` (`restore.rs:144`) (audit NITs).
- Scope and step 3: corrected two statements. `validate_managed` only needs to accept **changed** files (missing files already pass), and rollback needs no change. The two rollback tests are labelled guards (audit SHOULD 017-S2).
- Step 3b and criterion: a stable warning prefix, dialogs render only prefixed warnings, and the original file name is used where it exists (audit SHOULD 017-S3).
- Step 4: the erase marker lists every attachments row, including missing and changed ones (audit SHOULD 017-S4).
- Prerequisites: TASK-013 made explicit (audit NIT).
- Fixture rule unchanged: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).
- Scope and step 4: the whole-journal erase preview's `validate_managed` call (`deletion.rs:213`) checks only present and changed keys (or treats recorded-missing keys as absent); without this the full list from step 4 makes the erase preview fail with `UnsupportedOwnership` (`restore.rs:249-252`) (independent review (review4), reviewer A B3).
- Scope and criterion: missing/changed attachments are named by original file name, else id, matching step 3b (independent review (review4), reviewer A N1).
- Step 4: the erase dialog's "removed from disk" count includes missing rows; stated, with the warning explaining it (independent review (review4), reviewer A N2).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: missing ids in existing preview `warnings`, no new field (G12); missing `safety-missing.json` = empty list, previous-version rollback test (G12); export step limited to `detail`; fixture rule "unset (not `0`)".
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review (currency pass, 2026-10-22): two reviewers plus a re-check of the blocking fixes; READY at r4.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r5.
