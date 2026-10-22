# TASK-015 — Fix: deletion cleanup markers are atomic and cannot block journal startup

| Field | Value |
|---|---|
| Status | Proposed (r4; awaiting independent review) |
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
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + approved-task audit fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
A truncated/malformed `data-controls-cleanup/<op>.json`, a non-regular entry, or a persistent file lock makes every startup fail with a message naming no file. A valid marker over 1 MiB has the same effect: the marker is written with no size limit (`deletion.rs:291`) but read with a 1 MiB limit (`deletion.rs:330`), and one attachment entry is about 211 bytes, so an erase listing about 4,970 or more attachments writes a marker the reader rejects.

## Trigger / reproduction
Crash/power loss while the marker is written (`write_new` = create_new+write+sync, not temp+rename) or AV lock on a file being removed.

## Root cause / evidence
`src-tauri/src/data_controls/deletion.rs:287-293` (non-atomic write, no size limit at `:291`), `:330` (1 MiB read limit), `:321-386` (`recover_cleanup` returns Err on any problem); `src-tauri/src/runtime.rs:352-356` turns that into OpenFailed.

## Expected change scope
`src-tauri/src/data_controls/deletion.rs`, `src-tauri/src/data_controls/filesystem.rs` (the existing no-clobber `publish()` helper, `filesystem.rs:145-150`, which syncs the temp file, `persist_noclobber`s it and syncs the parent; a no-clobber move for quarantine), `src-tauri/src/commands.rs` (`permanently_delete_data`, `retry_data_cleanup`, `:639-645`; option A status update), `src-tauri/src/runtime.rs` (cleanup failure non-fatal with status detail), `src-tauri/src/runtime/tests.rs`, `src-tauri/src/data_controls/tests.rs`; erase copy in TS only (`apps/desktop/src/features/data-controls/components/DataControlsPage.tsx:225` and/or `DeletionDialog.tsx`). The Rust preview `warnings` (`deletion.rs:234-236`) are pinned in `packages/domain/test/fixtures/data-controls-wire.json` and are **not** changed by this card. Runtime-contract consumers, depending on the step 4 choice, are listed in step 4.

## Out of scope
Recovery-copy pruning (V1.1, TASK-009 D-RET); restore marker semantics (installing phase stays fail-closed).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Write cleanup markers via NamedTempFile created **in the data root** (as `write_pending` does, `restore.rs:170`), then publish with the existing `publish()` (`filesystem.rs:145-150`: sync, `persist_noclobber`, sync parent) to `data-controls-cleanup/` + sync the data root; the destination name must not already exist (a collision fails before the commit). The temp file never sits in the queue directory, where `recover_cleanup` (this build or an older one) would read it as a marker. `sync_dir` does nothing on Windows (`filesystem.rs:134-144`); state that in the PR.
2a. Marker size enforced at write time (audit MUST 015-M1): one constant, the reader's existing 1 MiB limit (`deletion.rs:330`), bounds every marker the new build writes. When the serialized `Cleanup` would exceed it, split `attachments` across several markers for the same `operationId`, named `<op>-<n>.json` (`n` from 1), each with the same `whole_journal` value and each within the limit; `recovery_copies` go in the first marker only. Every marker is published before the database commit (as the single marker is today, `deletion.rs:291` before `:294-308`). A marker that cannot fit even with no attachments fails the erase before the commit with `LimitExceeded` and TASK-013's `detail` naming the cleanup marker. The `Cleanup` schema is unchanged, and the reader processes each file in the queue independently (`deletion.rs:327-384`), so a 92e7980 build still parses and completes every marker (see the 015/016 declaration, unchanged). Interrupted publishing before the commit is safe: the listed files are still owned and `erase_operation` is not yet set, so nothing is removed.
3. In `recover_cleanup`, move a marker whose bytes do not parse as `Cleanup`, or a non-regular entry, to a sibling `data-controls-quarantine/` in the data root (NOT inside `data-controls-cleanup/`, whose non-regular entries are rejected at `deletion.rs:327-330`, and NOT inside `data-controls/`, see `deletion.rs:104`); never delete it. **Never quarantine a marker that parses** (audit MUST 015-M1): read markers with a bound no smaller than `MAX_TOTAL` (`filesystem.rs:10`), for example `serde_json::from_reader` over a `take()`-limited reader, so a valid marker over 1 MiB written by an older build is processed normally. A marker above that bound is left in place and reported as pending, never quarantined. The quarantine move is no-clobber with a unique name (`std::fs::rename` replaces an existing target on Windows and Unix); a failed move (for example a Windows sharing violation) is non-fatal: the marker stays where it is and is reported as pending. Do **not** add `data-controls-quarantine` to the `recovery_copies` allow-list (`deletion.rs:361-365`) or list it in any marker: an older build rejects that key with `UnsafePath` and fails startup. Instead, when the new build completes a whole-journal marker whose `operationId` equals `app_meta` `data_controls.erase_operation` (`deletion.rs:351-358`), it also removes `data-controls-quarantine/` (see the 015/016 declaration below). The erase copy says so in TS only (step scope above); no `DeletionPreview`, `warnings` or wire change.
4. Make the pending/quarantined state observable without breaking the Ready contract: `runtime.ts` superRefine (`apps/desktop/src/lib/data/runtime.ts:50-73`) requires `failure: null` when Ready. **Option A is selected** (Kyle approved TASK-015 r3 Option A on 2026-10-22: "Approve option A"; recorded on the Notion approval board). Option B is kept below for reference only and is **not authorized**:
   - **Option A — new status field.** Rust `runtime.rs` status + `runtime.ts` schema + UI + docs (`docs/data-model.md#startup-and-recovery`, referenced at `runtime.ts:2`). Lifecycle (audit SHOULD 015-S2): Rust sets the field at startup and updates it, through a `Runtime` setter, after `retry_data_cleanup` and `permanently_delete_data` (`commands.rs:639-645`); the frontend re-reads runtime status after those commands, because `RuntimeProvider` stops polling once Ready (`RuntimeProvider.tsx:58`) and `begin_initialize` returns false when Ready (`runtime.rs:260-262`). Every runtime-contract consumer must be updated and named in the PR: `apps/desktop/src/lib/data/runtime.ts:41-73` (schema; stage map at `:61`); `apps/desktop/src/test/runtime-fixtures.ts:4-22` (status literals; the failed-status body is `:14-17`); `apps/desktop/src/lib/diagnostics.ts:65`; `apps/desktop/src/components/RuntimeGate.tsx` (`TITLES`/`GUIDANCE` at `:9-22`, `RuntimeRecoveryNotice`); `apps/desktop/src/design-system/GallerySections.tsx:312` (runtime diagnostic sample); `apps/desktop/src/app/RuntimeProvider.tsx:60`; journeys `apps/desktop/src/journeys/recovery.journey.test.tsx:40-50` (own status literal and stage map), `first-run.journey.test.tsx:129`, `data-controls.journey.test.tsx:198`; tests `lib/data/runtime.test.ts`, `app/RuntimeProvider.test.tsx`, `app/RuntimeRecovery.test.tsx`, `components/RuntimeGate.test.tsx`. Option A also covers every hand-written `RuntimeStatus` literal in tests (find them with `grep -rn supportedSchemaVersion apps/desktop/src`), including `apps/desktop/src/test/boundaries.ts:10-11`, `App.test.tsx:24`, `app/AppShell.test.tsx:40`, `app/dev-tools/dev-tools.test.tsx:23`, `lib/diagnostics.test.ts:14`, `features/data-controls/data-controls.test.tsx:71`, and the ready-status read in `features/data-controls/components/DataControlsPage.tsx:73`. If a banner is added, `apps/desktop/src/app/AppShell.tsx` (renders `RuntimeRecoveryNotice` at `:265`).
   - **Option B — existing `retry_data_cleanup` path** (`src-tauri/src/commands.rs:643`). Returning a status instead of `()` changes its `null` output: this card then authorises exactly one fixture edit, the `retry_data_cleanup` entry of `packages/domain/test/fixtures/data-controls-wire.json` together with the hard-coded `null` at `src-tauri/src/data_controls/wire_tests.rs:85`, with the diff reviewed and limited to that entry. Option B contract consumers, each updated and named in the PR: a new output schema in `packages/domain/src/contracts/data-controls.ts`; `packages/domain/src/ports/journal-repository.ts:359` (`retryCleanup` return type); `apps/desktop/src/lib/data/data-controls.ts:70-71` (`z.null()` parser); `packages/domain/test/data-controls/contracts.test.ts:26-28` (null assertion); `apps/desktop/src/lib/data/data-controls.test.ts:20-21`; `apps/desktop/src/features/data-controls/api/data-controls.ts:90`; `DeletionDialog.tsx:70-72`; `features/data-controls/data-controls.test.tsx:107`. With option B, `npm run test -w @fundedflow/domain` must pass with the `retry_data_cleanup` row parsed by the new schema, not by a null check.
5. Treat per-file removal failure as a recorded pending cleanup; `Runtime::open` returns Ready. `recover_cleanup` keeps going through the remaining markers after one fails (today the loop exits on the first `?`) and returns an explicit outcome that distinguishes "nothing left", "only quarantined" and "parseable marker still pending" (or `Err` for the last two). Its callers keep their meaning (audit SHOULD 015-S1): `execute` reports `completed` only when nothing is left and nothing was quarantined in that pass, otherwise `cleanup_pending` (`deletion.rs:309`); `retry_data_cleanup` (`commands.rs:643`) still fails while anything is pending, so the dialog's "File cleanup finished" toast (`DeletionDialog.tsx:72-75`) appears only on real completion; the erase entry check (`deletion.rs:252`) still refuses a new erase while a parseable marker is pending. The non-fatal mapping lives in `runtime.rs` only.
6. Keep the owned-row check: never remove a file any row references. Note: a quarantined marker means its listed files remain as strays (handled by TASK-016 classification).
7. Cover both call sites: startup and `prepare_restore` (`runtime.rs:230`). Startup is non-fatal (step 5). Restore prepare (audit MUST 015-M2): only quarantined (unparseable or non-regular) markers stop blocking it; while a parseable marker is still pending after `recover_cleanup`, `prepare_restore` returns `RecoveryRequired` and writes nothing, as today's `?` does. Otherwise a restore installed past a pending whole-journal cleanup changes `erase_operation`, so the next `recover_cleanup` skips the recovery-copy removal (`deletion.rs:358`) and then deletes the marker (`deletion.rs:382`), leaving the pre-erase recovery copies on disk with no status showing it.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-014 (shared deletion.rs merge order).
- Likely shared-file conflicts: `deletion.rs` with TASK-014/016/017; `runtime.rs` with TASK-018; `apps/desktop/src/lib/data/runtime.ts` with TASK-018; `apps/desktop/src/app/AppShell.tsx` with TASK-022 (only if this card adds a banner).
- Owner decision: Kyle confirms the 015/016 downgrade declaration (runbook 10 §9, row "Downgrade with a pending cleanup") before implementation.

## Acceptance criteria (pass/fail)
- [ ] Whichever option is chosen (A or B), every contract consumer listed for it in step 4 is updated and listed in the PR; with option B, `npm run test -w @fundedflow/domain` → exit 0 with the `retry_data_cleanup` row parsed by the new schema, not by a null check.
- [ ] Runtime test: zero-byte `data-controls-cleanup/<uuid>.json` → `Runtime::start` reaches Ready; marker moved to quarantine.
- [ ] Runtime test: listed attachment replaced by a directory → Ready with cleanup pending; nothing deleted.
- [ ] Existing `data_controls/tests.rs:580` (`committed_delete_reports_cleanup_pending_and_retry_is_safe`) still passes.
- [ ] Full Rust and root checks → exit 0.
- [ ] Test: malformed marker present when `prepare_restore` runs (`runtime.rs:230`) → restore prepare proceeds; marker quarantined.
- [ ] Guard test (015-M2; passes on today's code, fails if restore is allowed past a pending marker): a well-formed whole-journal marker still pending (a listed attachment replaced by a directory) when `prepare_restore` runs → `RecoveryRequired`; no `data-controls-pending.json`, the marker stays in `data-controls-cleanup/`, and the listed recovery copies still exist.
- [ ] Test (015-M1, reader): a valid marker larger than 1 MiB (hand-built `Cleanup` JSON, as a 92e7980 build could write) → processed: unowned listed files removed, marker removed, nothing quarantined. Fails before the change (today `LimitExceeded`).
- [ ] Test (015-M1, writer): a cleanup whose serialized size exceeds 1 MiB (synthetic attachment entries) is written as several markers, each at most 1 MiB, whose attachment lists together equal the original, and each deserializes with the test-only 92e7980 `Cleanup` struct.
- [ ] Test (015-S1): `execute` reports `cleanup_pending` and `retry_data_cleanup` fails while a marker remains; with two markers where the first cannot finish, the second is still processed.
- [ ] Test (015-S3): quarantining a second marker with the same file name keeps both files in `data-controls-quarantine/`.
- [ ] Windows test (015-S4): a `#[cfg(windows)]` cargo test holds a listed file open with `share_mode(0)` → `Runtime::start` reaches Ready with cleanup pending and nothing deleted (CI runs on `windows-latest`).
- [ ] With option A: a test shows the status field changes after `retry_data_cleanup` succeeds and after an erase leaves cleanup pending, without a restart.
- [ ] Runtime status contract unchanged for existing states (`runtime.ts` schema tests pass); the chosen observable is tested; with option A every consumer in step 4 is updated and listed in the PR.
- [ ] Wire fixture: unchanged with option A; with option B the diff is limited to the `retry_data_cleanup` entry. The erase preview `warnings` entry is unchanged in both cases.
- [ ] Downgrade compatibility test: account and whole-journal markers written by the new build deserialize with a test-only copy of the 92e7980 `Cleanup` struct (`deny_unknown_fields`, `deletion.rs:49-56`), and every `recoveryCopies` key passes the 92e7980 allow-list predicate (`deletion.rs:361-363`).
- [ ] Test: during marker write the temp file is created in the data root, never in `data-controls-cleanup/`.
- [ ] Test: whole-journal erase with a quarantined marker present removes `data-controls-quarantine/`; account deletion leaves it.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

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

**015/016 declaration (downgrade with a pending cleanup): supported, by keeping the old marker schema.** TASK-015 and TASK-016 add no field to the `Cleanup` marker (`deletion.rs:49-56`, `deny_unknown_fields` at `deletion.rs:50`) and no key to the `recovery_copies` allow-list (`deletion.rs:361-365`); the temporary marker file is created in the data root and only the finished marker is renamed into `data-controls-cleanup/`. `data-controls-quarantine/` (TASK-015) and unowned managed extras (TASK-016) are never written into a marker: the new build removes them itself when it completes a whole-journal marker whose `operationId` equals `app_meta` `data_controls.erase_operation`. A build with the 92e7980 marker code therefore parses and completes every marker a new build writes, and ignores `data-controls-quarantine/` (its only data-root scan, `deletion.rs:110-118`, matches `fundedflow.db.before-v*.bak` only). Known limit: if such an older build completes a whole-journal cleanup, `data-controls-quarantine/` and any managed extras stay on disk (no bytes lost, startup not blocked once the cleanup can finish; like today, an older build stops with OpenFailed while a cleanup it cannot finish is pending, `runtime.rs:352-356`; the older build's restore/erase may refuse the extras as strays, as it does today) until a later whole-journal erase by a new build. Kyle confirms this choice (runbook 10 §9, row "Downgrade with a pending cleanup"); TASK-031 tests downgrade against it.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- 10 §8.2 TASK-015 (G11): option B (`retry_data_cleanup`) changes its `null` output and fixture entry; named and authorised that single fixture edit (`data-controls-wire.json` entry + `wire_tests.rs:85`) only if B is chosen.
- 10 §8.2 TASK-015 (G11): the erase preview `warnings` come from Rust (`deletion.rs:234-236`) and are fixture-pinned, so the quarantine copy is TS-only (`DataControlsPage.tsx:225` / `DeletionDialog.tsx`).
- 10 §8.2 TASK-015 (G11): named the runtime-contract consumers (`runtime.ts:61`, `test/runtime-fixtures.ts` — §8.2's `:14-17` is the failed-status body, the literals span `:4-22` —, `lib/diagnostics.ts:65`, `RuntimeGate.tsx`, `GallerySections.tsx:312`, journeys, plus `RuntimeProvider.tsx:60` and the runtime unit tests).
- 10 §8.2 TASK-015 (G11): added `runtime.ts` (TASK-018) and `AppShell.tsx` (TASK-022) to conflicts.
- 10 §8.2 TASK-015 (G8): downgrade — kept the old marker schema (no `recovery_copies` key for `data-controls-quarantine`; removal derived from `erase_operation`); wrote the 015/016 declaration with Kyle's confirmation and a compatibility test. §8.2 cites the allow-list as `deletion.rs:361-364`; the full check is `:361-365`.
- 10 §8.3 TASK-015: temp marker is created in the data root like `write_pending` (`restore.rs:170`), not in the queue directory.
- 10 §8.3 fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` must be unset (not `0`).
- r3 review fix: option B names its TS contract consumers and a domain-test criterion; option A covers every `RuntimeStatus` literal in tests (independent r3 review).

## Changes in r4
- Purpose, root cause, step 2a, step 3 and criteria: a parseable marker is never quarantined; the new build splits a large cleanup into several markers within the reader's 1 MiB limit (enforced at write time, before the commit), and the reader accepts valid oversized markers from older builds (audit MUST 015-M1: marker written uncapped at `deletion.rs:291`, read with a 1 MiB cap at `:330`). Splitting keeps the `Cleanup` schema, so the 015/016 downgrade declaration, which Kyle confirmed, stays as written.
- Step 7 and criterion: `prepare_restore` keeps returning `RecoveryRequired` while a well-formed cleanup is pending; only quarantined markers stop blocking it (audit MUST 015-M2, `deletion.rs:358, 382`).
- Step 5: `recover_cleanup` outcome and caller semantics defined, and the loop continues past a failing marker (audit SHOULD 015-S1).
- Step 4 option A and scope: status-field lifecycle after `retry_data_cleanup`/`permanently_delete_data`, `commands.rs` added (audit SHOULD 015-S2).
- Steps 2-3: use the existing `publish()` (`filesystem.rs:145-150`; the audit cites `:505-510`, which does not exist in this file), no-clobber unique quarantine move, non-fatal move failure, `sync_dir` no-op on Windows stated (audit SHOULD 015-S3 and NIT).
- Criterion: `#[cfg(windows)]` share-mode lock test (audit SHOULD 015-S4).
- Fixture rule unchanged: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).
- Step 4 records Kyle's approved choice, Option A (approval of r3, 2026-10-22, Notion record); Option B is not authorized and its fixture edit no longer applies.

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: option B fixture edit named; TS-only erase copy; runtime-contract consumers named; `runtime.ts`/`AppShell.tsx` conflicts; 015/016 downgrade declaration (old marker schema kept); temp marker in data root; fixture rule "unset (not `0`)".
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
