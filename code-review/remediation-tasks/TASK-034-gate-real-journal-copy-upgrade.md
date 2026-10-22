# TASK-034 — Gate (conditional): real-journal-copy upgrade with a safe procedure

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Test |
| Audit priority | Gate (if kept) / P2 test safety |
| Roadmap lane | Build 10.5 gate |
| Mandatory gate | Yes if TASK-008 keeps it — ISSUE-052 |
| Severity | Medium |
| Confidence | Medium |
| Canonical issue | ISSUE-052, ISSUE-038 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-006 |
| Source card / date | docs/build-10-5-closeout.md:66; src-tauri/src/db/upgrade_tests.rs:426-457 |
| Wave | W5 |
| Effort / risk | S / Low |
| Verification platform | Any OS (test) + Windows (owner run) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
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
`apps/desktop/src-tauri/src/db/upgrade_tests.rs` (`upgrade_copy_of_a_real_journal`): copy the source file (and -wal/-shm if present) into a temp dir first; refuse if `fundedflow.lock` is held; redact output to counts only; doc update in `docs/data-model.md` (upgrade test instructions).

## Out of scope
Running against the live `%APPDATA%` path while the app is open.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Implement the safety changes (only if TASK-008 keeps the gate): redact output to counts only; refuse a held lock.
3. Kyle makes a folder copy of the journal (with -wal/-shm) with the app closed — the test never touches the live path or takes its lock.
4. Set `FUNDEDFLOW_UPGRADE_DB` to the copied `fundedflow.db` (`upgrade_tests.rs:432`), then run in `apps/desktop/src-tauri`: `cargo test --offline --locked --lib upgrade_copy -- --ignored` against the copy; add `--nocapture` only after redaction is verified. Record both the source SHA and the copy's SHA-256.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-008 (keep), TASK-029.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Test refuses when the lock is held (unit-tested with a temp lock).
- [ ] Output contains no trade ids.
- [ ] Owner-recorded run result (counts, PASS/FAIL).
- [ ] Run record includes the source SHA and the copy's SHA-256.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Owner run on Windows.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Source is copied first; the real journal is only read for copying; app must be closed.

## Definition of done
Tests merged after review; they fail against a deliberately broken variant or the pre-fix code where stated, and pass on the final code; results recorded.

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
