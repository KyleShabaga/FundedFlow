# TASK-013 — Fix: live-journal size checks count used pages and name the component over the limit

| Field | Value |
|---|---|
| Status | Proposed (r4; awaiting independent review) |
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
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + currency update for approved decisions) |
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
`src-tauri/src/data_controls/archive.rs` (`dump` size check, error detail); export and restore-prepare snapshot copies: `archive::snapshot` (`archive.rs:174-200`, used by export at `archive.rs:231` and restore prepare at `restore.rs:126`) copies free pages through the backup API, so it **must** run `VACUUM` on the temporary snapshot (the `target` connection, after the backup step and before the file-size check at `archive.rs:196-198`) — never on the live journal. Contract change (named): add an optional `detail` field to the Rust `ControlError` (`src-tauri/src/data_controls/mod.rs:40-43`, today `{code, message}`) as `detail: Option<String>` with `#[serde(skip_serializing_if = "Option::is_none")]`, so errors without detail serialize exactly as today; add `detail: z.string().optional()` to `dataControlErrorSchema` in `packages/domain/src/contracts/data-controls.ts:20-23`; `DataControlProblem` (`apps/desktop/src/features/data-controls/api/data-controls.ts:56-61`, constructed in `native()` at `:67-74`, today only `CODE_COPY[code]`) must carry `detail` and render it; update `packages/domain/test/fixtures/data-controls-wire.json` deliberately in the same PR with the diff reviewed and limited to `detail` (this card authorises that one fixture). Tests in `src-tauri/src/data_controls/tests.rs` and the TS data-controls tests (`apps/desktop/src/features/data-controls/data-controls.test.tsx`).

## Out of scope
Raising archive caps or changing archive format: TASK-009 decision (5) keeps archive v1 strict, and any format change is a separate versioned change; stream hashing (TASK-014); frozen-input redesign (ISSUE-002c): TASK-003 Option A requires a separate review before frozen trade copies are redesigned, and if TASK-010 escalates ISSUE-002 to P0, TASK-010 proposes that redesign as a separate task.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Compute used bytes as `(page_count − freelist_count) × page_size` for the live-side size check; in `archive::snapshot`, `VACUUM` the temporary snapshot (never the live journal) before its size check, so export and restore-prepare snapshots carry no free pages.
3. When any cap is exceeded, return the existing code with `detail` naming the component (database pages / rows / data.json / total archive / entry count) and the measured value.
4. Carry `detail` through `DataControlProblem` and render it in user-facing copy that says which limit was exceeded.
5. Tests: a journal with >64 MiB free pages but small live data → erase preview succeeds and export succeeds; a journal over a real cap → error detail names the component; the desktop data-controls test asserts the rendered detail text.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-012 (same file, merge order); TASK-010 result (priority).
- Likely shared-file conflicts: `archive.rs::dump` with TASK-012/014.

## Acceptance criteria (pass/fail)
- [ ] New test with large freelist passes; it fails before the change.
- [ ] Export of a journal with >64 MiB free pages (small live data) succeeds; the test fails before the change.
- [ ] The live journal is never vacuumed: the test journal's `page_count` and `freelist_count` are unchanged after export and restore prepare.
- [ ] Over-cap test asserts the component name.
- [ ] Repository root: `npm run test -w @fundedflow/desktop -- src/features/data-controls` → exit 0, and it asserts the rendered `detail` text.
- [ ] `packages/domain/test/fixtures/data-controls-wire.json` diff is limited to `detail`: errors without detail serialize unchanged, and one new error row carrying `detail` (for example `LimitExceeded` naming database pages) is added so the TS schema parses `detail` from the fixture.
- [ ] `apps/desktop/src-tauri`: `cargo test --offline --locked data_controls` → exit 0.
- [ ] Full Rust and root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check (the wire test rewrites the fixture whenever the variable is set, to any value: `src-tauri/src/data_controls/wire_tests.rs:90`); never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

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

## Changes in r3
- 10 §8.2 TASK-013 (G3): VACUUM of the temporary snapshot in `archive::snapshot` (`archive.rs:174-200`) is mandatory, never the live journal; the "narrowed acceptance" option is removed from scope and step 2.
- 10 §8.2 TASK-013 (G10): added the criterion "export of a journal with >64 MiB free pages succeeds" (and a check that the live journal is not vacuumed).
- 10 §8.2 TASK-013 (G10): added the criterion that `npm run test -w @fundedflow/desktop -- src/features/data-controls` asserts the detail text and that the wire fixture diff is limited to `detail`.
- 10 §8.2 TASK-013 (G3): specified `#[serde(skip_serializing_if = "Option::is_none")]` on Rust `detail` and `.optional()` on the Zod schema; `DataControlProblem` must carry `detail` (class at `api/data-controls.ts:56-61`, built in `native()` at `:67-74`).
- 10 §8.3 fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` must be unset (not `0`).

## Changes in r4
- Out of scope: replaced "owner decision TASK-009 D-ARCH" with the approved TASK-009 decision (5): archive v1 stays strict; a format change is a separate versioned change.
- Out of scope: replaced "frozen-input redesign (depends on TASK-003, V1.1)" with the approved TASK-003 Option A (a separate review before frozen trade copies are redesigned) and the approved TASK-010 escalation path (a separate redesign task if ISSUE-002 becomes P0).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: mandatory VACUUM of the temporary snapshot and no narrowed acceptance (G3); >64 MiB free-pages export criterion (G10); desktop data-controls detail test and `detail`-only fixture diff (G10); `skip_serializing_if`/`.optional()`; `DataControlProblem` carries `detail`; fixture rule "unset (not `0`)".
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
