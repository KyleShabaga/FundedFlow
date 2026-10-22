# TASK-035 — Documentation/gate: final evidence register and NA-7 release notes

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Documentation |
| Audit priority | Gate |
| Roadmap lane | NA-7 |
| Mandatory gate | Yes — ISSUE-049 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-049 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | N/A (existing gate/decision) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd; docs/build-26.75-evidence.md:145-166 |
| Wave | W6 |
| Effort / risk | S / Low |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
NA-7 notes are stale; the final evidence register must reflect the actual candidate and gate results.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
Evidence register document and NA-7 notes.

## Out of scope
—

## Implementation approach
1. Compile gate states from TASK-029..034 and decisions TASK-001..009.
2. Finalize NA-7 against observed candidate behaviour.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029..TASK-033 (and TASK-034 if kept).
- Likely shared-file conflicts: Docs only.

## Acceptance criteria (pass/fail)
- [ ] Every gate row has state, SHA, EXE hash, environment and evidence link; NA-7 statements match observed behaviour.

## Verification plan
Reviewer.

## Safety, rollback and side effects
Docs only.

## Definition of done
Documents updated; every factual statement checked against the cited source (file:line/workflow line) at the recorded SHA; reviewed.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
