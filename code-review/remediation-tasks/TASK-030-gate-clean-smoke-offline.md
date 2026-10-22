# TASK-030 — Gate: clean Windows smoke and offline acceptance on the candidate

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
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
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
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
2. Run every checklist step including offline steps 3–10 and the TASK-028 added steps B1–B7 (junction, OneDrive, close, ticked uninstall, second instance, DPI, install without WebView2 online and offline). This card executes B4 and B7 but does not own V-023; TASK-028 owns it (08 §D, G2).
3. Record Pass/Fail per step with screenshots.

**Pass rule (r3).** The gate is **Passed** only if every mandatory step below is run on the candidate and its observed result matches the expected result written in the TASK-028 checklist, on both a clean Windows 11 VM and a clean Windows 10 22H2 VM (B7 needs an image without WebView2; one such image is enough). A "known limitation (V1.1)" result counts as a pass only where the checklist says that is the expected result. Any mandatory step that fails gives **Failed**; any mandatory step not run (for example, no image without WebView2 available) gives **Blocked** or **Not Run**, never Passed.
- Mandatory: 1 (hash matches `SHA256SUMS.txt`), 2 (install, no UAC), 3 (offline from here to step 10), 4 (first-run agreement → Accept → Today, offline), 4a (installed legal files and in-app notices), 5 (journal path), 6 (data survives reopen), 7 (no developer tools), 8 (unticked uninstall keeps the journal), 9 (reinstall opens the data), 10 (over-install keeps the journal), B1–B7.
- Optional: 11 (network observation); record it if run.
- Legal prompt: the first launch of a fresh install shows the first-run agreement (step 4). If the VM profile already holds an acceptance of an earlier legal version (for example, after installing over an older build), the candidate shows the agreement again — expect this legal re-prompt; it is not a failure (`apps/desktop/src/legal/index.ts:40-43` requires every current document's version and digest). A same-version reinstall after an unticked uninstall (steps 9–10) keeps `legal-acceptance.json` in `%APPDATA%\com.fundedflow.desktop` and does not re-prompt.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029, TASK-028.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Every step recorded Pass/Fail with SHA, EXE hash, Windows build, WebView2 version, tester, date; gate state set by the pass rule above (Passed only if every listed mandatory step, including B1–B7, passes on both VMs).
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
—

## Safety, rollback and side effects
Disposable VMs only; never the real journal.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Changes in r3
- Added an explicit pass rule listing the mandatory steps (1–10, 4a, B1–B7), the optional step (11) and how Failed/Blocked/Not Run are decided (10 §8.2 TASK-030; G9).
- Expect the legal re-prompt after an upgrade; a same-version reinstall does not re-prompt (10 §8.2 TASK-030 and §8.3 TASK-030/031 nit; G9).
- V-023: this card runs B4 and B7 but no longer claims V-023; TASK-028 owns it (10 §8.1 §D; G2).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: explicit pass rule with mandatory steps; legal re-prompt after upgrade expected; V-023 not claimed (owned by TASK-028); fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
