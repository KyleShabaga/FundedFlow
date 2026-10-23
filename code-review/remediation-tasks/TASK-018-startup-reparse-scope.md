# TASK-018 — Fix: startup tolerates reparse points above the app data folder (Windows)

| Field | Value |
|---|---|
| Status | Ready for Approval (r5) |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High (code) / Medium (frequency) |
| Canonical issue | ISSUE-006 (startup part) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | WIN-001 (WIN-002 user-path part deferred to V1.1 with TR-007) |
| Source card / date | Stage 1 audit 2026-10-22 (04 WIN-001; 05 F-06) |
| Wave | W1 |
| Effort / risk | M–L / High (startup) |
| Verification platform | Windows only (+ Any OS for regression) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r5 (2026-10-22; r4 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
`no_symlink_components` rejects any FILE_ATTRIBUTE_REPARSE_POINT on every ancestor from the drive; `filesystem_ownership` applies it to the data root at every start, so a junctioned profile/Roaming or mount point permanently blocks the journal with a misleading 'retry' message.

## Trigger / reproduction
Profile or `C:\Users` relocated via junction; redirected Roaming; mount point; possibly Windows Sandbox; drive-relative `C:` first component.

## Root cause / evidence
`src-tauri/src/data_controls/filesystem.rs:89-109` (walk from `components()` incl. bare prefix), `data_controls/mod.rs:155-168`, `runtime.rs:330-335, 130`.

## Expected change scope
`filesystem.rs` (root-anchored check), all app-owned `no_symlink_components` call sites (24 non-test calls at 9430f2a, 21 app-owned; the inventory is re-taken at the rebased SHA, because TASK-014/015/017 add or remove call sites, for example TASK-015 removes the `write_new` call at `deletion.rs:291`; user paths `archive.rs:223, 331, 552` keep the old check, and `write_new` is split as in the acceptance criteria) switched to the root-anchored check (inventory them in the PR; e.g. `recover_cleanup` at `deletion.rs:323` runs at startup) — user-chosen export/restore paths keep the old check; `data_controls/mod.rs::filesystem_ownership`; `runtime.rs` (`FailureCategory`/`failure()`, `runtime.rs:126-135`) and `apps/desktop/src/lib/data/runtime.ts` (`failureCategories` + stage map: new non-retry category — contract change), UI copy and docs; Windows-gated tests. App-owned paths are the data root and everything FundedFlow creates beneath it: `fundedflow.db` (+ `-wal`/`-shm`/`-journal`), `fundedflow.lock`, `legal-acceptance.json`, `attachments/`, `data-controls/`, `data-controls-cleanup/`, `data-controls-work/`, `data-controls-pending.json`, `data-controls-quarantine/` (added by TASK-015) and `fundedflow.db.before-v*.bak`. This list classifies paths; the change itself switches only the **existing** `no_symlink_components` call sites on app-owned paths (for example the data root and `fundedflow.lock` via `data_controls/mod.rs:157, 159`, the `data-controls*` paths in `deletion.rs` and `restore.rs`, and the attachment files read for export at `archive.rs:163`; the full inventory goes in the PR as stated above).

**Explicitly out of scope in r4 (no `no_symlink_components` call today; follow-up note below):**
- `fundedflow.db` and its `-wal`/`-shm`/`-journal` files: SQLite opens and creates them itself, and the WAL/SHM files cannot be checked before SQLite creates them.
- Pre-upgrade backups: `fundedflow.db.before-v*.bak` (`db/mod.rs:245-246`, written by `VACUUM INTO` at `:283`) and the retained `previous-*.bak` copy (`db/mod.rs:273`).
- `legal-acceptance.json`: has its own `fs::symlink_metadata` check (`legal.rs:84`).
- `attachments/` writes and status checks in `store/attachments.rs`: they use their own `fs::symlink_metadata` calls (`store/attachments.rs:200-206` `write_new`, called at `:262`; `file_status` at `:302`). (The existing export-time call on attachment files, `data_controls/archive.rs:163`, is in scope.)
These paths are still protected by the anchored check on the data root at startup (`data_controls/mod.rs:157`), but a link created at or below them is not checked by this card. Follow-up: record a Triage card ("apply the root-anchored link check to the database, backup, legal-record and attachment paths") with its own tests; do not widen this card to cover them.

Runtime-contract consumers of the new category (each updated and named in the PR): `apps/desktop/src/lib/data/runtime.ts:12-18` (`failureCategories`) and `:61` (stage map); `apps/desktop/src/test/runtime-fixtures.ts:11-22` (`failed()` with its own stage map at `:12`; failed-status body `:14-17`); `apps/desktop/src/lib/diagnostics.ts:65`; `apps/desktop/src/components/RuntimeGate.tsx:9-22` (`TITLES`/`GUIDANCE`, exhaustive per category); `apps/desktop/src/design-system/GallerySections.tsx:312` (runtime diagnostic sample); `apps/desktop/src/app/RuntimeProvider.tsx:60` (category routing: decide whether the new non-retry category maps to `unavailable` or its own state); journeys `apps/desktop/src/journeys/recovery.journey.test.tsx:40-50, 57` (own stage map and category list), `first-run.journey.test.tsx:129`, `data-controls.journey.test.tsx:198`; tests `lib/data/runtime.test.ts`, `app/RuntimeProvider.test.tsx`, `app/RuntimeRecovery.test.tsx`, `components/RuntimeGate.test.tsx`. No new dependency is approved (owner, 2026-10-22). Use std (`Path::is_symlink`/`symlink_metadata`, which on Windows reports name-surrogate reparse points including junctions). If std is insufficient, stop and report.

## Out of scope
Export/restore user-path validation (TR-007/WIN-002, V1.1); hard-link checks (ISSUE-024, unassigned; record a Triage card).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Split the check: trust the OS-resolved `app_data_dir()` prefix; apply link checks only to the app folder and paths beneath it.
3. On Windows, reject an app-owned component that std reports as a link (`symlink_metadata(..)?.file_type().is_symlink()`, true for name-surrogate reparse points such as symlinks and junctions/mount points); no new dependency (see scope). Keep current behaviour on Unix.
4. Add a distinct failure category/message ('The data folder is behind a link FundedFlow does not trust') that does not suggest retry.
5. `cfg(windows)` tests: app root under a junctioned parent → Ready; app root itself a junction → refused with the new category.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-017 (merge order on data_controls); TASK-011 (b) results to confirm cases. No new dependency is approved (owner, 2026-10-22); if std proves insufficient, stop and report.
- Likely shared-file conflicts: `filesystem.rs` shared with TASK-015; `runtime.rs` and `apps/desktop/src/lib/data/runtime.ts` with TASK-015.

## Acceptance criteria (pass/fail)
- [ ] Windows CI: the `ci.yml` `cargo test` step (windows-latest, `ci.yml:69`) runs the new `cfg(windows)` tests → pass.
- [ ] Manual Windows check (owner/VM, recorded): junctioned profile layout starts Ready; standard profile unaffected. Record per case: tester; date; Windows edition and build; WebView2 version; tested source SHA; installer EXE SHA-256 (release EXE, `FUNDEDFLOW_DEV_DATA_DIR` unset); case (standard profile / junctioned profile or `C:\Users` / redirected Roaming / mount point / Windows Sandbox / junction at the app folder itself); the link setup (command used, link path → target); the resolved data folder path; observed runtime state and failure category; expected vs observed; pass/fail; screenshot or log reference.
- [ ] Every **existing** `no_symlink_components` call site on an app-owned path (including the one for `data-controls-quarantine/` added by TASK-015) uses the root-anchored check (except `write_new`, split as stated in the call-site inventory criterion below). The paths listed as out of scope (database and WAL/SHM/journal files, `before-v*`/`previous-*` backups, `legal-acceptance.json`, attachment writes and status checks in `store/attachments.rs`) are not required to use it, and the follow-up Triage card for them is recorded in the execution log.
- [ ] Every runtime-contract consumer listed in the scope is updated and named in the PR.
- [ ] Full Rust and root checks → exit 0.
- [ ] All app-owned call sites are listed in the PR (inventory re-taken at the rebased SHA and its count recorded; 21 of the 24 non-test calls at 9430f2a, a count TASK-014/015/017 change) and use the root-anchored check, except that `write_new` (`filesystem.rs:116-117`) keeps the full-walk check for the export temp folder (`archive.rs:243`, inside the `tempdir_in` of the user-chosen destination's parent at `:229`; `export_csv` at `:245`/`:552`). Its app-path callers (at 9430f2a `deletion.rs:291`, removed by TASK-015's `publish()`; `restore.rs:134, 138, 196`, `archive.rs:386`; as found at the rebased SHA) use an anchored variant. User-path call sites (`archive.rs:223, 331, 552`) are unchanged.
- [ ] `runtime.ts` failure-category tests updated deliberately; root `npm run typecheck` and `npm test` → exit 0.
- [ ] No dependency is added: `Cargo.toml` and `Cargo.lock` unchanged (owner, 2026-10-22: no new dependency approved).
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Windows only for the reparse cases (note: CI runs plain `cargo test`, so the new tests must not depend on `--locked`/offline flags to be picked up). CI is Windows-only (`ci.yml:25`); Unix tests run locally.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`. Must not allow a junction inside the data folder.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- 10 §8.2 TASK-018 (G14): replaced "Linux CI still runs Unix tests" with "CI is Windows-only (`ci.yml:25`); Unix tests run locally".
- 10 §8.2 TASK-018 (G11): named the runtime-contract consumers as in TASK-015 (`runtime.ts:12-18, 61`, `test/runtime-fixtures.ts`, `lib/diagnostics.ts:65`, `RuntimeGate.tsx:9-22`, `GallerySections.tsx:312`, `RuntimeProvider.tsx:60`, journeys, runtime unit tests) and added a matching criterion; added `runtime.ts` to the TASK-015 conflict.
- 10 §8.2 TASK-018 (G11): listed the app-owned paths, including `data-controls-quarantine/`, with a matching criterion.
- 10 §8.2 TASK-018 (G14): listed the manual record fields.
- 10 §8.3 fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` must be unset (not `0`).
- r3 review fix: added `RuntimeProvider.tsx:60` so the consumer list matches TASK-015 (independent r3 review).

## Changes in r4
- Acceptance criterion reworded from "every app-owned path listed in the scope uses the root-anchored check" to "every existing `no_symlink_components` call site on an app-owned path": the database and its `-wal`/`-shm`/`-journal` files, the pre-upgrade backups (`db/mod.rs:245-246, 273`), `legal-acceptance.json` (`legal.rs:84`) and the attachment writes and status checks (`store/attachments.rs:200-206, 262, 302`) never go through `no_symlink_components`, so the old criterion could only be met by unreviewed new checks on a High-risk startup task (approved-task audit, MUST). Call sites re-counted at 9430f2a: 24 non-test calls.
- Scope: those paths listed explicitly as out of scope, with a follow-up Triage-card note (approved-task audit, MUST).
- Not applied (audit SHOULD items, design changes outside this fix brief): name-surrogate rule via std `is_symlink()` (S-018-2), cloud/sync-folder policy (S-018-3), fail-closed anchor (S-018-4), link-inside-data-folder tests and `mklink /J` recipe (S-018-5), TASK-011(b) as input rather than blocker (S-018-6).
- Scope and acceptance criteria: the "21 of 24 at a7310fd" criterion is replaced by the split of `write_new` (`filesystem.rs:116-117`) into an anchored variant for its app-path callers (`deletion.rs:291`, `restore.rs:134, 138, 196`, `archive.rs:386`) and the full-walk check for the export temp folder (`archive.rs:229, 243`); `write_new` serves both, so the old criterion could not be met. This applies audit SHOULD S-018-1, previously skipped (independent review (review4), reviewer C blocking 1).

## Changes in r5
- Scope, step 3, prerequisites and criteria: the conditional `windows-sys` path is removed; no new dependency is approved (owner, 2026-10-22, condition of approving r3 "as written"); use std `Path::is_symlink`/`symlink_metadata`, and if std is insufficient, stop and report; the dependency criterion becomes "`Cargo.toml` and `Cargo.lock` unchanged" (board review 2026-10-22).
- Scope and criteria: the call-site inventory is re-taken at the rebased SHA, because TASK-014/015/017 add or remove call sites (TASK-015 removes the `write_new` call at `deletion.rs:291`); the 9430f2a count (21 of 24) is kept as reference only (board review 2026-10-22).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: Windows-only CI wording (G14); runtime-contract consumers named (G11); `data-controls-quarantine/` among app-owned paths (G11); manual record fields (G14); fixture rule "unset (not `0`)".
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r4.
Board review (2026-10-22, against main 92e7980): APPROVE WITH NOTE; notes folded in at r5. Independent re-check of r5: pending.
