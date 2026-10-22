# TASK-031 — Gate: upgrade, reinstall, downgrade and uninstall (ticked and unticked) on the candidate

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | NA-5 |
| Mandatory gate | Yes — ISSUE-042 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-042 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | N/A (existing gate/decision); WIN-003, WIN-004 (linked) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd; docs/build-26.75-evidence.md:17 |
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
Confirm data survives upgrade/reinstall, record what a downgrade does (no migration exists between candidates, so the older build is expected to open normally; NewerSchema appears only across a schema change), record NSIS's own downgrade prompt behaviour, and confirm the uninstall checkbox removes exactly what TASK-026 documents.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
VM procedure with a synthetic journal; results only.

## Out of scope
Real journal.

## Implementation approach
1. Install previous candidate, create synthetic data and screenshots, export an archive outside %APPDATA%.
2. Upgrade to the candidate; verify data.
3. Reinstall same version; verify.
4. Install an older build over newer; record the NSIS prompt (if any) and whether the app opens normally.
5. Uninstall unticked → data remains; uninstall ticked → list remaining folders.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029; TASK-027 unique versions.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Each step recorded with SHA/EXE hash/environment; uninstall result compared to TASK-026 text.

## Verification plan
—

## Safety, rollback and side effects
Synthetic data on disposable VMs.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
