# TASK-018 — Fix: startup tolerates reparse points above the app data folder (Windows)

| Field | Value |
|---|---|
| Status | Proposed |
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
| Specification revision | r1 (2026-10-22) |
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
`filesystem.rs` (new function checking only components at/below the app data folder; reparse-tag-aware check for symlink/junction/mount-point via a Windows helper), `data_controls/mod.rs::filesystem_ownership`, `runtime.rs` (distinct non-retry 'unsafe directory' category/message), `Cargo.toml` (declare `windows-sys` directly — **dependency change requires explicit approval in this task's approval scope**; it is already in `Cargo.lock` transitively), Windows-gated tests.

## Out of scope
Export/restore user-path validation (TR-007/WIN-002, V1.1); hard-link checks (TASK-V1.1 ISSUE-024).

## Implementation approach
1. Split the check: trust the OS-resolved `app_data_dir()` prefix; apply link checks only to the app folder and paths beneath it.
2. On Windows, read the reparse tag and reject only IO_REPARSE_TAG_SYMLINK / MOUNT_POINT (junction) for app-owned components; keep current behaviour on Unix.
3. Add a distinct failure category/message ('The data folder is behind a link FundedFlow does not trust') that does not suggest retry.
4. `cfg(windows)` tests: app root under a junctioned parent → Ready; app root itself a junction → refused with the new category.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-017 (merge order on data_controls); TASK-011 (b) results to confirm cases; approval of the `windows-sys` declaration.
- Likely shared-file conflicts: `filesystem.rs` shared with TASK-015; `runtime.rs` with TASK-015.

## Acceptance criteria (pass/fail)
- [ ] Windows CI: `cargo test --offline --locked` (windows-latest) runs the new `cfg(windows)` tests → pass.
- [ ] Manual Windows check (owner/VM, recorded): junctioned profile layout starts Ready; standard profile unaffected.
- [ ] Full Rust and root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Windows only for the reparse cases; Linux CI still runs Unix tests.

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
