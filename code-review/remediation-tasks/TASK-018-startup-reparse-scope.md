# TASK-018 — Fix: startup tolerates reparse points above the app data folder (Windows)

| Field | Value |
|---|---|
| Status | Ready for Approval |
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
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
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
`filesystem.rs` (root-anchored check), all app-owned `no_symlink_components` call sites (21 of 24 non-test sites at a7310fd; user paths `archive.rs:223, 331, 552` keep the old check) switched to the root-anchored check (inventory them in the PR; e.g. `recover_cleanup` at `deletion.rs:323` runs at startup) — user-chosen export/restore paths keep the old check; `data_controls/mod.rs::filesystem_ownership`; `runtime.rs` and `apps/desktop/src/lib/data/runtime.ts` (`failureCategories` + stage map: new non-retry category — contract change), UI copy and docs; Windows-gated tests. First evaluate std `FileType::is_symlink()` / `symlink_metadata` on Windows (may cover junctions without a new dependency); only if insufficient declare `windows-sys` in `Cargo.toml` — **dependency change requires explicit approval**, plus `npm run check:notices` and a `Cargo.lock` diff check.

## Out of scope
Export/restore user-path validation (TR-007/WIN-002, V1.1); hard-link checks (ISSUE-024, unassigned; record a Triage card).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Split the check: trust the OS-resolved `app_data_dir()` prefix; apply link checks only to the app folder and paths beneath it.
3. On Windows, read the reparse tag and reject only IO_REPARSE_TAG_SYMLINK / MOUNT_POINT (junction) for app-owned components; keep current behaviour on Unix.
4. Add a distinct failure category/message ('The data folder is behind a link FundedFlow does not trust') that does not suggest retry.
5. `cfg(windows)` tests: app root under a junctioned parent → Ready; app root itself a junction → refused with the new category.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-017 (merge order on data_controls); TASK-011 (b) results to confirm cases; approval of the `windows-sys` declaration only if std `is_symlink` proves insufficient.
- Likely shared-file conflicts: `filesystem.rs` shared with TASK-015; `runtime.rs` with TASK-015.

## Acceptance criteria (pass/fail)
- [ ] Windows CI: the `ci.yml` `cargo test` step (windows-latest, `ci.yml:69`) runs the new `cfg(windows)` tests → pass.
- [ ] Manual Windows check (owner/VM, recorded): junctioned profile layout starts Ready; standard profile unaffected.
- [ ] Full Rust and root checks → exit 0.
- [ ] All app-owned call sites (21 of 24 at a7310fd) listed in the PR and each uses the root-anchored check; user-path call sites unchanged.
- [ ] `runtime.ts` failure-category tests updated deliberately; root `npm run typecheck` and `npm test` → exit 0.
- [ ] If a dependency is declared: `npm run check:notices` → exit 0 and the `Cargo.lock` diff is limited to the declaration.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Windows only for the reparse cases (note: CI runs plain `cargo test`, so the new tests must not depend on `--locked`/offline flags to be picked up); Linux CI still runs Unix tests.

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

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
