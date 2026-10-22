# TASK-033 — Gate: manual accessibility and window/DPI matrix on the candidate

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | Build 26 §9 / P0-08 / NA-5 |
| Mandatory gate | Yes — ISSUE-045, ISSUE-046 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-045, ISSUE-046 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-007 (cross-ref); WIN-009 (linked) |
| Source card / date | docs/architecture/build-26-accessibility-journeys.md:227-238; docs/design/window-support-matrix.md |
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
NVDA with WebView2, contrast, 125/150% scaling, 200% zoom, reduced motion, native chooser focus and the D1–D11 window matrix have never been executed.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
Manual procedure; results only.

## Out of scope
Fixes (new tasks).

## Implementation approach
1. Run the §9 checklist and the window matrix on the candidate.
2. Record each row.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Every checklist/matrix row recorded with environment; gate state set.

## Verification plan
—

## Safety, rollback and side effects
Synthetic data.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.
