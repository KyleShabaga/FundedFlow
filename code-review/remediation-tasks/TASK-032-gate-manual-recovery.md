# TASK-032 — Gate: manual recovery acceptance on the candidate (incl. ISSUE-001–004 scenarios)

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | Build 26.5–26.7 / Build 10.5 gate 6 |
| Mandatory gate | Yes — ISSUE-044 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-044 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-007 (canonical here) |
| Source card / date | docs/architecture/build-26.5-26.7-recovery-reliability.md:187-194 |
| Wave | W5 |
| Effort / risk | M / Low |
| Verification platform | Windows only |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Manual recovery checks have never run on a packaged build.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
VM procedure: locked/corrupt journal, failed migration simulation (disposable), interrupted restore, malformed cleanup marker (TASK-015), stray/missing screenshot (TASK-016/017), large journal export (TASK-013/014), AV lock if feasible.

## Out of scope
Real journal.

## Implementation approach
1. Run each scenario on a disposable profile; record outcome and message.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Each scenario recorded with expected vs actual; gate Passed only if all mandatory scenarios recover without data loss.

## Verification plan
—

## Safety, rollback and side effects
Disposable profile/VM; synthetic data.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
