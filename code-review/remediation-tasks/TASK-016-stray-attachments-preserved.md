# TASK-016 — Fix: stray files under attachments/ no longer block restore and erase

| Field | Value |
|---|---|
| Status | Ready for Approval (r4) |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-003 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-002 |
| Source card / date | Stage 1 audit 2026-10-22 (01 DATA-002; 05 F-03) |
| Wave | W1 |
| Effort / risk | M / High |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + approved-task audit fixes + owner amendment folded in) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
`validate_managed` requires on-disk files == DB inventory; a stray screenshot or `.part` file (crash between rename and commit, power loss under synchronous=NORMAL, failed `remove_file`) blocks restore prepare and the whole-journal erase preview with a misleading 'shared history' message.

## Trigger / reproduction
Crash or power loss shortly after adding a screenshot.

## Root cause / evidence
`src-tauri/src/data_controls/restore.rs:212-255` (`managed_files`/`validate_managed`/`copy_managed`), `deletion.rs:211-213`; `src-tauri/src/store/attachments.rs:200-291` produces strays.

## Expected change scope
`restore.rs` (`validate_managed`, `copy_managed`, `prepare`), `deletion.rs` (`preview`; `recover_cleanup` re-derives extras for a completed whole-journal erase — the `Cleanup` marker struct, `deletion.rs:49-56`, is **not** changed: no new field, see the 015/016 declaration), `data_controls/mod.rs` (`Code` enum: new distinct code), `packages/domain/src/contracts/data-controls.ts` (new code + one new `DeletionPreview` extras field, proposed `extraFiles`: storage keys of unowned managed extras), `apps/desktop/src/features/data-controls/api/data-controls.ts` (message); `apps/desktop/src/features/data-controls/components/DeletionDialog.tsx` (extra-files confirmation, owner amendment) and `apps/desktop/src/features/data-controls/data-controls.test.tsx` (its regression test); `packages/domain/test/fixtures/data-controls-wire.json` regeneration is **mandatory** (DeletionPreview changes) and its diff is reviewed in the PR; tests. This card does not change `DeletionPreview.warnings` or `RestorePreview.warnings`; TASK-017 carries missing ids in those existing `warnings` and adds no field.

## Out of scope
Startup sweep of orphans (optional later); attachment write ordering change.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Classify unreferenced files under `attachments/`: names matching `screenshots/<uuid>.<ext>` or the temp name `screenshots/.<uuid>.part` (`store/attachments.rs:207`) are 'unowned managed extras', where `<uuid>` is the lowercase hyphenated form `crate::domain::new_id()` produces (`Uuid::now_v7().to_string()`, `domain.rs:74-76`) and `<ext>` is `png`, `jpg` or `webp` (`store/attachments.rs:108, 134, 161`). Error codes per case (audit SHOULD 016-S1; today `validate_managed` returns `UnsupportedOwnership` for any mismatch, `restore.rs:252`):
   - non-regular entries, symlinks/reparse points, hard links and invalid names → `UnsafePath` (unchanged);
   - an unrecognised **regular** file (not a managed extra) → the new distinct code from step 5, with its copy in `CODE_COPY`.
   Known limit (audit SHOULD 016-S3, owner-level, not decided here): unrecognised safe regular files such as Windows Explorer `Thumbs.db`/`desktop.ini` still block restore and whole-journal erase with the new code.
   Known limit (re-derivation): the preview token binds only the preview-to-confirm window. The step 4a re-derivation in `recover_cleanup` can also remove a managed-name stray created after the confirmation (for example while a cleanup stays pending and is retried later); the confirmation copy ("leftover files like these") covers it.
3. Restore prepare: copy extras into the safety copy (`safety-attachments/`) so no bytes are lost; extras have no inventory hash, so copy them hash-verified (hash the source with `hash_file`, copy, re-hash the destination; `hash_file`'s size limit applies); do not install them into the restored journal. Rollback restores only the files listed in `safety-inventory.json`: `rollback` (`restore.rs:345-349`) → `replace_attachments` (`restore.rs:273-281`, which removes `attachments/` at `:276-278`) → `copy_inventory` (`restore.rs:178-202`, listed files only). So after rollback the extras are **not** reinstated into `attachments/`; they survive in the operation folder `data-controls/<op>/safety-attachments/`.
4. Whole-journal erase preview: list extras in the new extras field and remove them on confirm (bytes are being erased anyway). `extraFiles` is part of what the user confirms (audit SHOULD 016-S2): include it in the preview-token payload (today `deletion.rs:224-231`; TASK-014 replaces the hashing), so an extra that appears or disappears after the preview makes confirm fail with `StalePreview`. Account scope returns an empty `extraFiles` array.
4a. Extra-files erase confirmation (owner amendment, 2026-10-22): when a whole-journal erase preview has `extraFiles`, `DeletionDialog.tsx` shows them visibly before the confirmation input, next to the existing "removed from disk" line (`DeletionDialog.tsx:162-164`): a count plus a short list of file names (not raw storage keys), and copy saying that leftover files like these, which belong to no record, are removed with the journal. Nothing extra is shown when the list is empty or for account deletion. Do not record extras in the `Cleanup` marker: after the commit, `recover_cleanup` (`deletion.rs:321-386`), when completing a whole-journal marker whose `operationId` equals `app_meta` `data_controls.erase_operation`, removes unreferenced files under `attachments/` that match the step 2 managed-extra names (the owned-row check still applies), so a pending cleanup retries them without a marker field.
5. Add a distinct error code/message for genuinely ambiguous ownership; replace the 'shared history' wording.
6. Tests: plant `attachments/screenshots/<uuid>.png` and `.<uuid>.part`; a planted extra after the preview makes confirm return `StalePreview`; an unrecognised regular file returns the new code and a symlink returns `UnsafePath`; frontend (owner amendment): `data-controls.test.tsx` renders a whole-journal erase preview with `extraFiles` and asserts the count, a listed file name and the removal copy are visible, and that a preview with an empty `extraFiles` shows no extra-files text; restore prepare succeeds with the extra preserved in the safety copy; erase preview lists it; after a rollback (installing phase) the extra is absent from `attachments/` and present in `data-controls/<op>/safety-attachments/`; an interrupted whole-journal cleanup removes the extra on retry.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-015. The 015/016 downgrade declaration (runbook 10 §9, row "Downgrade with a pending cleanup") is confirmed by Kyle. Record: Notion board, TASK-015 Decision Notes, 2026-10-22: Kyle approved TASK-015 r3 Option A ("Approve option A") in reply to the recommendation that disclosed the 015/016 downgrade limitation; the note states "This confirms the shared downgrade declaration".
- Likely shared-file conflicts: `restore.rs`/`deletion.rs` with TASK-014/015/017; `mod.rs` Code enum with TASK-017; `DeletionDialog.tsx` and `data-controls.test.tsx` with TASK-015 (erase copy) and TASK-017 (warnings); `api/data-controls.ts` with TASK-013 (`detail`).

## Acceptance criteria (pass/fail)
- [ ] New tests pass and fail before the change.
- [ ] `data_controls/tests.rs:198, 450, 520, 748` and `store/journal_review_tests.rs:493` pass.
- [ ] Root `npm test` passes (TS mapping) and full Rust checks → exit 0.
- [ ] Owner amendment: repository root `npm run test -w @fundedflow/desktop -- src/features/data-controls` → exit 0, and it asserts the extra-files confirmation (count, a file name, removal copy) for a whole-journal preview with `extraFiles`, and its absence when the list is empty. The test fails before the change.
- [ ] A preview token test: adding or removing an extra between preview and confirm gives `StalePreview`.
- [ ] Error-code tests: unrecognised regular file → new code; symlink/non-regular entry → `UnsafePath`.
- [ ] After restore commit and after rollback, the extra exists in `data-controls/<op>/safety-attachments/` and is not reinstated into `attachments/` (rollback test required).
- [ ] Downgrade compatibility test: a whole-journal marker written when extras exist deserializes with a test-only copy of the 92e7980 `Cleanup` struct (`deny_unknown_fields`, `deletion.rs:50`) and contains no extras.
- [ ] `packages/domain/test/fixtures/data-controls-wire.json` diff limited to the new preview field/code (`warnings` entries unchanged).
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Contract change: if the TS error-code union changes, run `npm run typecheck` and the data-controls wire tests.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`. Extras are preserved in the safety copy before anything is replaced, and remain in the operation folder after rollback.

**015/016 declaration (downgrade with a pending cleanup): supported, by keeping the old marker schema.** TASK-015 and TASK-016 add no field to the `Cleanup` marker (`deletion.rs:49-56`, `deny_unknown_fields` at `deletion.rs:50`) and no key to the `recovery_copies` allow-list (`deletion.rs:361-365`); the temporary marker file is created in the data root and only the finished marker is renamed into `data-controls-cleanup/`. `data-controls-quarantine/` (TASK-015) and unowned managed extras (TASK-016) are never written into a marker: the new build removes them itself when it completes a whole-journal marker whose `operationId` equals `app_meta` `data_controls.erase_operation`. A build with the 92e7980 marker code therefore parses and completes every marker a new build writes, and ignores `data-controls-quarantine/` (its only data-root scan, `deletion.rs:110-118`, matches `fundedflow.db.before-v*.bak` only). Known limit: if such an older build completes a whole-journal cleanup, `data-controls-quarantine/` and any managed extras stay on disk (no bytes lost, startup not blocked once the cleanup can finish; like today, an older build stops with OpenFailed while a cleanup it cannot finish is pending, `runtime.rs:352-356`; the older build's restore/erase may refuse the extras as strays, as it does today) until a later whole-journal erase by a new build. Kyle confirmed this choice (runbook 10 §9, row "Downgrade with a pending cleanup"; Notion TASK-015 Decision Notes, 2026-10-22, see Prerequisites); TASK-031 tests downgrade against it.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- 10 §8.2 TASK-016 (G8): `Cleanup` has `deny_unknown_fields` (`deletion.rs:50`); chose to keep extras out of the marker (no new field; `recover_cleanup` re-derives them for a completed whole-journal erase) instead of declaring downgrade unsupported; added the 015/016 declaration (identical in TASK-015), Kyle's confirmation as a prerequisite, and a compatibility test. TASK-031 references it as "the 015/016 declaration".
- 10 §8.2 TASK-016 (G12): stated that rollback restores only inventory files, so extras survive in `data-controls/<op>/safety-attachments/` and are not reinstated; added a rollback test. §8.2 cites `restore.rs:262-270`, which is inside `replace_database` (WAL/SHM removal); the rollback path is `restore.rs:345-349` → `replace_attachments` `:273-281` → `copy_inventory` `:178-202`.
- 10 §8.2 TASK-017 / G12 consistency: this card adds one extras field and leaves `warnings` unchanged; TASK-017 uses `warnings` with no new field.
- 10 §8.3 fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` must be unset (not `0`).

## Changes in r4
- Scope, step 4a, step 6, criterion and conflicts: visible extra-files erase confirmation in `DeletionDialog.tsx` with a frontend regression test (owner amendment, 2026-10-22). Display is a count plus file names, not raw storage keys; account scope returns an empty array (audit NIT on the amendment).
- Step 2: error code per case (`UnsafePath` for unsafe entries, the new code for unrecognised regular files) (audit SHOULD 016-S1); the extras name pattern is limited to `png|jpg|webp` and the `Uuid::now_v7()` string form (audit NIT); `Thumbs.db`/`desktop.ini` recorded as a known limit (audit SHOULD 016-S3, owner-level, not decided here).
- Step 4 and criterion: `extraFiles` bound into the preview token, so a change after preview gives `StalePreview` (audit SHOULD 016-S2).
- Step 3: extras copied hash-verified (audit NIT).
- Conflicts: `DeletionDialog.tsx`, `data-controls.test.tsx`, `api/data-controls.ts` added (audit NIT).
- The 015/016 downgrade declaration is unchanged.
- Prerequisites, declaration and this section: Kyle's confirmation of the 015/016 downgrade declaration now cites its record (Notion TASK-015 Decision Notes, 2026-10-22: "Approve option A", "This confirms the shared downgrade declaration") instead of asserting it unsupported (independent review (review4), reviewer A B2).
- Step 2: recorded the residual that the re-derivation can remove a managed-name stray created after the confirmation (independent review (review4), reviewer A N1).
- Fixture rule unchanged: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: extras kept out of the `Cleanup` marker and 015/016 downgrade declaration (G8); rollback semantics of extras stated and tested, citation corrected to `restore.rs:345-349`/`273-281` (G12); `warnings` left to TASK-017; fixture rule "unset (not `0`)".
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r4.
