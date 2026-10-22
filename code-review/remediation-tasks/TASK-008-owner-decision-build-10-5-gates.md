# TASK-008 — Owner decisions: real-journal-copy upgrade gate and cargo fmt gate

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Owner Decision |
| Audit priority | Gate / decision |
| Roadmap lane | Build 10.5 gates (historical, V1) |
| Mandatory gate | Yes |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-052, ISSUE-053 (+ ISSUE-038) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-006 (linked) |
| Source card / date | docs/build-10-5-closeout.md:61,66 |
| Wave | W0 |
| Effort / risk | S / Low |
| Verification platform | N/A |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Build 10.5 left two gates: an owner-approved upgrade test on a copy of the real journal (never run) and `cargo fmt` (failed historically, not in CI).

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
Upgrade gate: (A) keep — run TASK-034 on an offline copy; (B) waive for owner-only V1. cargo fmt: (A) adopt — format crate in a dedicated task + CI step; (B) drop the gate.

## Expected change scope
Decisions only; TASK-034 executes the upgrade gate if kept.

## Out of scope
Running fmt; touching the real journal.

## Implementation approach
1. Present options for each.
2. Record decisions.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Both decisions recorded with source.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
