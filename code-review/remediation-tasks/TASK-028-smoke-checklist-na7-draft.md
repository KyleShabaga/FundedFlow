# TASK-028 — Documentation: correct the smoke checklist (first-run gate etc.) and refresh NA-7 draft notes

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Documentation |
| Audit priority | Gate work |
| Roadmap lane | NA-2 / NA-5 / NA-7 |
| Mandatory gate | Yes — instrument for ISSUE-041/043; ISSUE-049 draft |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-041, ISSUE-049 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-002 |
| Source card / date | docs/build-26.75-evidence.md:111-166 |
| Wave | W3 |
| Effort / risk | S / Low |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Step 4 expects the runtime gate then Today, but any artifact since `1a0d8af` shows the first-run agreement first; checklist lacks junction, OneDrive export, title-bar close, ticked uninstall, second instance and DPI steps.

## Trigger / reproduction
Running the smoke on a current artifact.

## Root cause / evidence
Stale checklist.

## Expected change scope
`docs/build-26.75-evidence.md` (or a new `docs/build-<n>-candidate-evidence.md` per repo convention — reviewer decides) checklist and NA-7 draft; record fields for SHA, EXE SHA-256, Windows build, WebView2 version, tester, date.

## Out of scope
Running the gates (TASK-030..033).

## Implementation approach
1. Rewrite step 4: first-run screen shows owner-only v1.1 texts → Accept → Today.
2. Add steps: data root behind a junction; export to OneDrive Documents; title-bar close with unsaved text; ticked uninstall after an export (list folders removed); second instance; 125/150/200% scaling.
3. Refresh NA-7 draft text consistent with TASK-026.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-025, TASK-026.
- Likely shared-file conflicts: Same doc as TASK-026.

## Acceptance criteria (pass/fail)
- [ ] Checklist reviewed against current app behaviour and source; every step has an expected result and evidence fields.

## Verification plan
Reviewer.

## Safety, rollback and side effects
Docs only.

## Definition of done
Documents updated; every factual statement checked against the cited source (file:line/workflow line) at the recorded SHA; reviewed.
