# TASK-010 — Verification: measure journal growth per risk calculation (ISSUE-002 escalation check)

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Verification |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High (mechanism) / Medium (rate) |
| Canonical issue | ISSUE-002 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-004 |
| Source card / date | Stage 1 audit 2026-10-22 (01 DATA-004; 05 §E) |
| Wave | W0 |
| Effort / risk | M / Low |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Decide whether ISSUE-002 escalates to P0: each calculation stores the account's full trade list (`src-tauri/src/store/evidence.rs:314`), nothing vacuums, and `archive::dump` refuses >64 MiB of pages including free pages (`src-tauri/src/data_controls/archive.rs:72-76`).

## Trigger / reproduction
Normal use over months.

## Root cause / evidence
Frozen inputs + no VACUUM + page_count cap.

## Expected change scope
A disposable measurement (no repository change), e.g. a temporary test or the existing `cargo run --example seed-demo-journal` against an isolated directory, recording `page_count`, `freelist_count` and file size after N trades × K calculations. Any helper code stays out of the repository unless a later task adopts it.

## Out of scope
Fixing the cap (TASK-013/014).

## Implementation approach
1. Create an isolated directory (never `%APPDATA%`).
2. Seed a journal with realistic trade counts (e.g. 500, 2,000, 10,000 trades).
3. Run K calculations (e.g. 1, 50, 250) through the existing capture/promote path in a test harness.
4. Record DB size, page_count, freelist_count; extrapolate to 12 months of expected use; record whether 64 MiB is reachable.

## Prerequisites, dependencies and conflicts
- Prerequisites: Approval of this task (it runs cargo with disposable data).
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Measurement table recorded with SHA and environment.
- [ ] Escalation decision for ISSUE-002 (P0 if ≤12 months) recorded and reflected in TASK-013 priority.

## Verification plan
Recorded results only.

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`.

## Definition of done
Results recorded in `code-review/11-remediation-execution-log.md` with tester, date, source SHA (and installer EXE SHA-256 where applicable), environment and raw observations; the linked decision/escalation is updated. No code change is implied.
