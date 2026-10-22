# TASK-036 — Owner decision: P0-18 human go/no-go

| Field | Value |
|---|---|
| Status | Proposed (r3; awaiting independent review) |
| Type | Owner Decision |
| Audit priority | Gate |
| Roadmap lane | P0-18 (V1) |
| Mandatory gate | Yes — ISSUE-054 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-054 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | N/A (existing gate/decision) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd |
| Wave | W6 |
| Effort / risk | S / Low |
| Verification platform | N/A |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + currency update for approved decisions) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Kyle decides go/no-go for owner-only V1 use based on the evidence register. Never inferred from audit or test results.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
Go / No-go / Go with recorded conditions.

## Expected change scope
Decision only.

## Out of scope
—

## Implementation approach
1. Present the evidence register (TASK-035), open P1 items and waived gates. The inputs, each with its state and source:
   - Gate rows TASK-029..TASK-034 for the one candidate recorded by TASK-029 (TASK-034 is a kept gate: TASK-008 Option A).
   - Owner decisions TASK-001..TASK-011 as recorded.
   - TASK-007 dispositions: P0-05 exporter/rule cohort **waived for owner-only V1** (no broad support claims); P0-09 existing reconciliation evidence linked in the register (TASK-035); P0-10 multi-user studies **deferred** until before external release; D5 **deferred** pending identification. None of these is a run/keep/adopt choice, so no TASK-007 follow-up task exists.
   - TASK-002 follow-ups: TASK-037 (synthetic `Performance.csv` fixture and Rust tests), TASK-038 (remove two unreferenced real exports), TASK-039 (Git-history exposure assessment) and Kyle's separate disposition of TASK-039's result.
   - TASK-008 follow-up: TASK-040 (`cargo fmt` formatting-only change and CI check).
   - TASK-010 outcome (whether ISSUE-002 was escalated to P0).
2. Record Kyle's decision verbatim.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-035. Through TASK-029 this includes TASK-037, TASK-038 and TASK-039 resolved and TASK-040 Verified (TASK-002 and TASK-008 decisions; these four are r1 drafts on the Notion board with no repository specification yet).
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] The presented inputs cover every item listed in step 1, each with its state (Verified, Waived, Deferred, Decided or open) and source; a missing item is shown as missing, never assumed.
- [ ] Decision recorded with date and source.

## Verification plan
Owner.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Changes in r3
- TASK-007 r3 approved (2026-10-22, Notion approval board): step 1 now lists its waivers and deferrals (P0-05 waived for owner-only V1; P0-10 and D5 deferred; P0-09 via TASK-035) as named go/no-go inputs, since "waived gates" was unspecific.
- TASK-002 and TASK-008 approved with follow-ups TASK-037, 038, 039 and TASK-040 (Notion r1 drafts): added to step 1 and to Prerequisites (they gate TASK-029, so TASK-035 and this card depend on them); TASK-039's separate owner disposition is listed as its own input.
- TASK-008 Option A keeps the TASK-034 gate: step 1 names it among the gate rows.
- TASK-010 approved with a possible ISSUE-002 escalation: its outcome is listed as an input.
- Added a pass/fail criterion that the presented inputs cover step 1, so the presentation step is checkable.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
