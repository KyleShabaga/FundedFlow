# TASK-026 — Documentation: uninstall scope, WebView2/offline wording and workflow facts

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Documentation |
| Audit priority | P1 |
| Roadmap lane | NA-7 / P0-13 (V1) |
| Mandatory gate | Supports ISSUE-049 |
| Severity | Medium/Low |
| Confidence | High |
| Canonical issue | ISSUE-023 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | WIN-003, WIN-005, TR-014 |
| Source card / date | docs/build-26.75-evidence.md; README.md; Stage 1 2026-10-22 |
| Wave | W3 |
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
Uninstall text omits screenshots, restore safety copies, the legal record and the cleanup queue; docs do not say the installer needs internet when WebView2 is missing; workflow trigger/retention text is stale (`docs/build-26.75-evidence.md:63,70`; `README.md:72`).

## Trigger / reproduction
Owner relies on docs during install/uninstall.

## Root cause / evidence
Docs drift.

## Expected change scope
`README.md` (Windows installer section), `docs/build-26.75-evidence.md` (uninstall, triggers, retention), wording input for `apps/desktop/src/legal/index.ts` (implemented in TASK-025).

## Out of scope
Changing installer behaviour (TASK-006/027).

## Implementation approach
1. List what 'Delete the application data' is expected to remove: NSIS removes `%APPDATA%\com.fundedflow.desktop` (journal, WAL, screenshots, pre-upgrade backups, restore safety copies, cleanup queue, legal-acceptance.json) and also `%LOCALAPPDATA%\com.fundedflow.desktop` (WebView2 data). State these as *expected* until TASK-031 verifies them; advise exporting first.
2. State WebView2 network behaviour per TASK-006 decision; keep 'FundedFlow itself makes no network connections'.
3. Correct trigger paths and retention (3 days PR / 30 otherwise) from `.github/workflows/release-installer.yml`.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-006.
- Likely shared-file conflicts: `README.md` with TASK-027/028.

## Acceptance criteria (pass/fail)
- [ ] Each changed statement cites a checked source line at the merge SHA (reviewer verifies).
- [ ] Root `npm test` → exit 0 (sanity).

## Verification plan
Reviewer cross-check; NSIS behaviour confirmed later in TASK-031.

## Safety, rollback and side effects
Docs only.

## Definition of done
Documents updated; every factual statement checked against the cited source (file:line/workflow line) at the recorded SHA; reviewed.

## Independent review notes
Independent review (Block 3, 2026-10-22): CHANGES REQUIRED on r1. All listed corrections applied in r2 (see 08 index §H for the per-card list). Re-check by the approving reviewer recommended before execution.
