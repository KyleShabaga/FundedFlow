# TASK-034 — Gate: real-journal-copy upgrade with a safe procedure

| Field | Value |
|---|---|
| Status | Ready for Approval (r5) |
| Type | Test |
| Audit priority | Gate (kept, TASK-008 = A) / P2 test safety |
| Roadmap lane | Build 10.5 gate |
| Mandatory gate | Yes — ISSUE-052 (kept by TASK-008 = A) |
| Severity | Medium |
| Confidence | Medium |
| Canonical issue | ISSUE-052, ISSUE-038 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-006 |
| Source card / date | docs/build-10-5-closeout.md:66; src-tauri/src/db/upgrade_tests.rs:426-459 |
| Wave | W3c (code) / W5 (owner run) |
| Effort / risk | S / Low |
| Verification platform | Any OS (test) + Windows (owner run) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r5 (2026-10-22; r4 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
The ignored test opens the source path directly without checking the journal lock and prints trade ids/days with `--nocapture`.

## Trigger / reproduction
Running the gate.

## Root cause / evidence
Test design.

## Expected change scope
`apps/desktop/src-tauri/src/db/upgrade_tests.rs` (`upgrade_copy_of_a_real_journal`): copy the source file (and -wal/-shm if present) into a temp dir first; refuse if `fundedflow.lock` is held; redact output to counts only, including assertion and panic messages (today `assert_eq!(dump_like(&conn, &before), before)` at `upgrade_tests.rs:451` Debug-prints both full table dumps of the real journal on failure, and panic output is shown even without `--nocapture`; on success the `println!` at `upgrade_tests.rs:457` prints the id of every trade whose trading day changed, so it is redacted to a count too); fix the doc comment at `upgrade_tests.rs:426-428`, which tells the runner to set `FUNDEDFLOW_UPGRADE_DB=%APPDATA%\com.fundedflow.desktop\fundedflow.db` (the live path) and to add `--nocapture` — it must instead point at the offline copy and suggest `--nocapture` only once output is redacted; doc update in `docs/data-model.md` (upgrade test instructions). The code change lands in W3c, before TASK-029 freezes the candidate SHA; only the owner run is W5.

## Out of scope
Running against the live `%APPDATA%` path while the app is open.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)

Code change (W3c, merged before TASK-029):
2. Implement the safety changes: redact output to counts only; refuse a held lock; replace the whole-dump `assert_eq!` at `upgrade_tests.rs:451` (and any other comparison in this test) with a comparison that never Debug-prints rows: on mismatch it fails with a message giving only per-table row counts before/after and the number of mismatched rows per table (no ids, no column values); rewrite the `upgrade_tests.rs:426-428` doc comment to point `FUNDEDFLOW_UPGRADE_DB` at the copied `fundedflow.db`, never the live `%APPDATA%` path.

Owner run (W5, after TASK-029 is recorded):
3. Kyle makes a folder copy of the journal (with -wal/-shm) with the app closed — the test never touches the live path or takes its lock.
4. Set `FUNDEDFLOW_UPGRADE_DB` to the copied `fundedflow.db` (read at `upgrade_tests.rs:432`), never the live `%APPDATA%` path, then run in `apps/desktop/src-tauri`: `cargo test --offline --locked --lib upgrade_copy -- --ignored` against the copy; add `--nocapture` only after redaction is verified. Record both the source SHA and the copy's SHA-256.

## Prerequisites, dependencies and conflicts
- Prerequisites (code change, W3c): none beyond approval (TASK-008 r3 approved Option A: gate kept). Must merge before TASK-029 builds the candidate (09 G7); independent of W1 and W2.
- Prerequisites (owner run, W5): the code change merged; TASK-029 recorded (the run uses the candidate SHA).
- Likely shared-file conflicts: TASK-041 edits `db/upgrade_tests.rs` (its fixture CSV constant near `:19-24`) if Kyle chooses removal of value-level copies; this card edits the same file (`:426-459`). Different regions, but merge one before opening the other (recommended: this card first, W3c). TASK-040 formats the same file (merge TASK-040 first).

## Acceptance criteria (pass/fail)
- [ ] Code change merged before TASK-029's candidate SHA (the candidate SHA contains it).
- [ ] The `upgrade_tests.rs:426-428` doc comment names an offline copy for `FUNDEDFLOW_UPGRADE_DB`, not the live `%APPDATA%` path, and no longer suggests `--nocapture` before redaction.
- [ ] The same command in `docs/data-model.md:572` is corrected the same way (it gives the live `%APPDATA%` path and `--nocapture` today).
- [ ] Test refuses when the lock is held (unit-tested with a temp lock).
- [ ] Output contains no trade ids, on success and on failure: assertion and panic messages included.
- [ ] Output redacted to counts only, including assertion and panic messages: no comparison in `upgrade_copy_of_a_real_journal` Debug-prints rows (`upgrade_tests.rs:451` replaced); a mismatch reports only per-table row counts and mismatch counts; the success output prints no trade ids (the per-trade `println!` at `upgrade_tests.rs:457` replaced by a count).
- [ ] Deliberate-failure check on a synthetic DB: a test (or a recorded one-off run) points the comparison at a synthetic journal with a known marker value and a forced mismatch; the captured failure output shows per-table counts only and contains neither the marker nor any trade id or row content (record command and the redacted output).
- [ ] Owner-recorded run result (counts, PASS/FAIL).
- [ ] Run record includes the source SHA and the copy's SHA-256, and shows `FUNDEDFLOW_UPGRADE_DB` set to the copy.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Owner run on Windows.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo fmt --check` → exit 0 (once TASK-040 has merged; CI then runs it)
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Source is copied first; the real journal is only read for copying; app must be closed.

## Definition of done
Tests merged after review; they fail against a deliberately broken variant or the pre-fix code where stated, and pass on the final code; results recorded.

## Changes in r3
- 10 §8.2 TASK-034 (G7): split into a code change in W3c (merged before TASK-029) and an owner run in W5; Wave field set to `W3c (code) / W5 (owner run)`; prerequisites split accordingly.
- 10 §8.2 TASK-034 (G7): `FUNDEDFLOW_UPGRADE_DB` is set to the copy, never the live path (step 4 and run-record criterion).
- 10 §8.2 TASK-034 (G7): fix the doc comment at `upgrade_tests.rs:428` (verified: it gives the live `%APPDATA%` path and `--nocapture`); scope, step 2 and criterion added.
- r3 review fix: the identical live-path command in `docs/data-model.md:572` is corrected with the doc comment (independent r3 review).
- Source re-check at b01e2b9: test span corrected from `upgrade_tests.rs:426-457` to `426-459`.
- 10 §8.3 fixture rule: fixture line says `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).

## Changes in r4
- Gate is unconditional: title, Audit priority, Mandatory gate, step 2 and the code-change prerequisite no longer say "conditional" / "if kept" / "only if TASK-008 keeps the gate", because TASK-008 r3 was approved with Option A (keep the real-journal-copy upgrade gate). The W3c code / W5 owner-run split is unchanged.
- Independent review (review3_B), nit: added `cargo fmt --check` (after TASK-040 merges) to the standard checks.
- Independent review (review3_B), nit: listed the `db/upgrade_tests.rs` conflict with TASK-041 (new card for value-level copies) and TASK-040 under conflicts.

## Changes in r5
- Scope, step 2 and criteria: the whole-dump `assert_eq!` at `upgrade_tests.rs:451` Debug-prints both table dumps of the real journal on failure (shown even without `--nocapture`); comparisons must not Debug-print rows and report only per-table row counts and mismatch counts (board review 2026-10-22).
- Criteria: "output redacted to counts only" and "no trade ids" now cover assertion and panic messages, with a deliberate-failure check on a synthetic DB proving no row content is printed (board review 2026-10-22).
- Scope, step 2 and criteria: the doc comment is cited as `upgrade_tests.rs:426-428` (the three `///` lines at 92e7980; the old `:428` was only its last line); the per-trade `println!` at `upgrade_tests.rs:457`, which prints trade ids on success, is named under redact-to-counts (board review re-check 2026-10-22).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: W3c code / W5 owner-run split with code before TASK-029 (G7); `FUNDEDFLOW_UPGRADE_DB` set to the copy; `upgrade_tests.rs:428` doc-comment fix; fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review r4 (review3_B, 2026-10-22): READY; nits applied (see "Changes in r4"). Status stays Proposed until approval.
Independent review (currency pass, 2026-10-22): two reviewers plus a re-check of the blocking fixes; READY at r4.
Board review (2026-10-22, against main 92e7980): CHANGES REQUESTED; fixes folded in at r5. Independent re-check of r5 (two reviewers, 2026-10-22): blocking items applied; READY at r5.
