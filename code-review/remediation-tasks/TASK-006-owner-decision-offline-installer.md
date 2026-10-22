# TASK-006 — Owner decision: WebView2 install mode (bootstrapper vs offline installer)

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Owner Decision |
| Audit priority | P1 (decision) |
| Roadmap lane | NA-7 / NA-2 |
| Mandatory gate | Yes — affects offline gate and NA-7 text |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-023 (D-OFF); ISSUE-058 (decided parts) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | WIN-005 (linked) |
| Source card / date | docs/build-26.75-evidence.md:35-44, 97-100 (owner decision 2026-10-21) |
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
`webviewInstallMode: downloadBootstrapper` (`tauri.conf.json:49-52`) needs Microsoft's network when WebView2 is missing. The app itself is offline after install. Signing/updater/currentUser stay as decided 2026-10-21.

## Trigger / reproduction
Installing on a Windows image without the Evergreen runtime while offline.

## Root cause / evidence
Configuration choice.

## Options and consequences (owner decides)
(A) Keep downloadBootstrapper; document that the installer needs internet when WebView2 is missing. (B) `offlineInstaller` (+~127 MB, fully offline). (C) `fixedVersion` (bundled runtime the owner must patch).

## Expected change scope
Decision only; TASK-026 documents; a config change (if chosen) is part of TASK-027's scope only when the decision says so.

## Out of scope
Signing; auto-update.

## Implementation approach
1. Present options.
2. Record decision.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Decision recorded with source.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
