# TASK-001 — Owner decision: 0BSD licence allow-list

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Owner Decision |
| Audit priority | P1 (decision) |
| Roadmap lane | Final Push V1 (open disposition) |
| Mandatory gate | Yes — blocks candidate notices |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-057 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | N/A (existing gate/decision); TEST-008 (linked) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd (0BSD acceptance, 2026-10-22) |
| Wave | W0 |
| Effort / risk | S / Low |
| Verification platform | N/A |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Decide whether the 0BSD licence remains on the third-party allow-list. 0BSD is allow-listed in `scripts/third-party-notices.mjs:38` and `apps/desktop/src-tauri/about.toml:27` and is in use by tslib 2.8.1 (`apps/desktop/THIRD_PARTY_NOTICES.txt:2078-2083`).

## Trigger / reproduction
N/A (decision).

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
(A) Accept: candidate notices unchanged. (B) Reject: dependency change before the candidate; delays W4.

## Expected change scope
No code. Record the decision in `code-review/11-remediation-execution-log.md` (decision section) and, if rejected, raise a follow-up task to replace the dependency.

## Out of scope
Changing dependencies; regenerating notices.

## Implementation approach
1. Present options: (A) accept 0BSD — no change; (B) reject — identify packages using 0BSD (currently tslib), propose replacement as a separate task.
2. Record Kyle's choice verbatim with date and source.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Decision recorded as Decided with Kyle's words, date and source.
- [ ] If (B): a new follow-up task exists and TASK-025/TASK-029 are marked Blocked until it is done.

## Verification plan
Owner confirmation only.

## Safety, rollback and side effects
None (no code).

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.
