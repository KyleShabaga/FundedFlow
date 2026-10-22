# TASK-030 — Gate: clean Windows smoke and offline acceptance on the candidate

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | NA-2 / NA-5 |
| Mandatory gate | Yes — ISSUE-041, ISSUE-043 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-041, ISSUE-043 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-002 (instrument) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd |
| Wave | W5 |
| Effort / risk | M / Low |
| Verification platform | Windows only |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Run the corrected checklist (TASK-028) on clean Windows 11 and Windows 10 22H2 VMs (full VM preferred over Sandbox).

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
Owner/approved VM procedure; results only.

## Out of scope
Fixing failures (new tasks).

## Implementation approach
1. Verify EXE SHA-256.
2. Run every checklist step including offline steps 3–10 and the added junction/OneDrive/close/uninstall/second-instance/DPI steps.
3. Record Pass/Fail per step with screenshots.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029, TASK-028.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Every step recorded Pass/Fail with SHA, EXE hash, Windows build, WebView2 version, tester, date; gate state set Passed only if all mandatory steps pass.

## Verification plan
—

## Safety, rollback and side effects
Disposable VMs only; never the real journal.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.
