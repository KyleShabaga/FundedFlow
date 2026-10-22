# TASK-028 — Documentation: correct the smoke checklist (first-run gate etc.) and refresh NA-7 draft notes

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Documentation |
| Audit priority | Gate work |
| Roadmap lane | NA-2 / NA-5 / NA-7 |
| Mandatory gate | Yes — instrument for ISSUE-041/043; ISSUE-049 draft |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-041, ISSUE-049 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-002 |
| Source card / date | docs/build-26.75-evidence.md:117-166 (checklist 117-145; NA-7 draft 147-166) |
| Wave | W3 |
| Effort / risk | S / Low |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Step 4 expects the runtime gate then Today, but any artifact since `1a0d8af` shows the first-run agreement first; checklist lacks junction, OneDrive export, title-bar close, ticked uninstall, second instance, DPI and install-without-WebView2 (online and offline) steps.

**V-023 ownership (r3).** V-023 (07 §G.1: ticked NSIS uninstall; install with no WebView2, online and offline) belongs to this card, per the 08 §D correction (10 §8.1, G2). This card adds the mandatory checklist steps that cover it (steps B4 and B7 below); TASK-030 executes them. TASK-030, TASK-031 and TASK-033 do not claim V-023.

## Trigger / reproduction
Running the smoke on a current artifact.

## Root cause / evidence
Stale checklist.

## Expected change scope
Target file (r3): `docs/build-26.75-evidence.md` only — the "Clean-machine smoke checklist" section (lines 117-145: header table 121-128, steps 130-143, evidence line 145) and the NA-7 draft "Install and verify (for the NA-7 release notes)" (lines 147-166). Lines 145-166 belong to this card, not TASK-026 (TASK-026 is limited to lines 51-70). Record fields for SHA, EXE SHA-256, Windows build, WebView2 version, tester, date.

## Out of scope
Running the gates (TASK-030..033).

## Implementation approach
1. Rewrite step 4: first-run screen shows owner-only v1.1 texts → Accept → Today.
2. Add the steps below to the checklist table. Each row states its expected result, its evidence fields and whether it is mandatory (a mandatory step that fails or is not run means the TASK-030 gate cannot be Passed). Every row also records Pass/Fail, tester and date.

| # | Step | Expected result | Evidence fields | Mandatory |
|---|---|---|---|---|
| B1 | Data root behind a junction: on a test account, place `%APPDATA%` (or the relocated profile) behind a junction, then launch. | After TASK-018: the app reaches the first-run agreement / Today with the journal under the junctioned path; no "retry" failure. If the app folder itself is a junction: refused with TASK-018's non-retry message. | Junction command used and `dir /AL` (or `fsutil reparsepoint query`) output for the junctioned folder; resolved journal path; runtime screen screenshot; message text if refused. | Yes |
| B2 | Export to OneDrive Documents (Files On-Demand on) and to a junctioned folder. | Known limitation (V1.1): the export is refused with a clear message and the journal is unchanged, unless TASK-011(b) recorded that it works, in which case the archive is saved and its name, size and SHA-256 are shown. | Target path; OneDrive Files On-Demand state; on-screen result (screenshot); archive SHA-256 if produced; whether any file was left at the target. | Yes |
| B3 | Title-bar close (X) and Alt+F4 with unsaved text in a trade review and a daily review. | After TASK-023: a prompt asks before discarding; Cancel keeps the text; Leave closes. If TASK-023 closed as Not Needed, the native prompt recorded in TASK-011(a) appears. A clean window closes immediately. | Screen and field dirtied; screenshot of the prompt; result of Cancel and of Leave; text present after Cancel. | Yes |
| B4 | Ticked uninstall after an export: export an archive to a folder outside `%APPDATA%` and `%LOCALAPPDATA%`, then uninstall with "Delete the application data" ticked. (Part of V-023.) | Removes exactly the folders listed by TASK-026 (`%APPDATA%\com.fundedflow.desktop` and `%LOCALAPPDATA%\com.fundedflow.desktop`) plus the program folder, shortcuts and uninstall entry; the exported archive remains. | `dir` of `%LOCALAPPDATA%\FundedFlow`, `%APPDATA%\com.fundedflow.desktop`, `%LOCALAPPDATA%\com.fundedflow.desktop` before and after; `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` entry before/after; archive path still present; any leftover listed exactly. | Yes |
| B5 | Second instance: with the app open, launch it again from the Start menu. | Known limitation (V1.1, ISSUE-031/WIN-012): the second window may show a failure screen; the first instance keeps working and the journal opens normally on the next launch. Any data loss is a Fail. | Screenshots of both windows; message text; first instance still saves; next-launch result. | Yes |
| B6 | Windows scaling 125%, 150% and 200% (first-run agreement, Today, Settings). | Every primary action reachable, nothing clipped that blocks a task; the full matrix is TASK-033. | Scaling, physical resolution, screenshots per scaling. | Yes |
| B7 | Install without WebView2, online and offline (V-023): on a Windows image whose Installed apps lists no "Microsoft Edge WebView2 Runtime", run the installer (a) with the network on, (b) on a fresh copy of the image with the network off. | Per the TASK-006 decision, as documented by TASK-026. Option A (`downloadBootstrapper`, `tauri.conf.json:49-52` today): (a) the installer downloads the runtime from Microsoft and the app launches; (b) the runtime cannot be fetched — pass if the installer stops with a message or the app reports that WebView2 is missing, no journal is created or changed, and the behaviour matches the NA-7 "needs internet when WebView2 is missing" sentence; record the exact message. Options B/C: both (a) and (b) install and launch without network. | Windows edition and build; proof that WebView2 was absent before (Installed apps screenshot); network state; installer screens/messages; WebView2 version after install (or "absent"); first-launch result. | Yes |

3. Refresh the NA-7 draft (lines 147-166) so it is consistent with TASK-026 (uninstall list, WebView2/network wording per TASK-006) and with the corrected step 4 (first-run agreement).

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-025, TASK-026, TASK-011 (results recorded: (a) sets the B3 expected result, (b) the B1/B2 expected results).
- Likely shared-file conflicts: Same doc as TASK-026 (TASK-026 owns lines 51-70; this card owns 117-166).

## Acceptance criteria (pass/fail)
- [ ] Checklist reviewed against current app behaviour and source; every step has an expected result and evidence fields.
- [ ] Each added step B1–B7 is in `docs/build-26.75-evidence.md` with its expected result, its evidence fields and a "Mandatory: Yes/No" marker as in the table above.
- [ ] Export to junction/OneDrive targets has expected result 'known limitation (V1.1)' unless TASK-011(b) shows it works.
- [ ] V-023 is covered: B4 (ticked uninstall) and B7 (install without WebView2, online and offline) are present and marked mandatory.
- [ ] NA-7 draft (lines 147-166): the WebView2/network sentence matches the TASK-006 decision and the TASK-026 wording; the "Uninstalling" sentence matches the TASK-026 removal list; it is still labelled a draft (final text is TASK-035); every statement cites a checked source line at the merge SHA.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Reviewer.

## Safety, rollback and side effects
Docs only.

## Definition of done
Documents updated; every factual statement checked against the cited source (file:line/workflow line) at the recorded SHA; reviewed.

## Changes in r3
- Target file named: `docs/build-26.75-evidence.md` lines 117-145 (checklist) and 147-166 (NA-7 draft); the "or a new doc" option removed (10 §8.2 TASK-028; G10).
- Added steps B1–B7 (junction, OneDrive, title-bar close, ticked uninstall, second instance, DPI, install without WebView2 online and offline), each with expected result, evidence fields and Mandatory yes/no (10 §8.2 TASK-028; G2, G10).
- Added the NA-7 draft acceptance criterion (10 §8.2 TASK-028; G10).
- Added TASK-011 as a prerequisite (10 §8.2 TASK-028; G10).
- NA-7 lines 145-166 stated as owned by this card, not TASK-026 (10 §8.2 TASK-028; G2).
- V-023 ownership made explicit: this card owns it; TASK-030 executes it; TASK-030/031/033 do not claim it (10 §8.1 §D; G2).
- Source-card citation corrected from `:111-166` to `:117-166` (lines 111-116 are the CI-evidence table, not the checklist).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: target file named; steps B1–B7 with expected result, evidence and mandatory flag; NA-7 draft criterion; TASK-011 prerequisite; NA-7 lines 145-166 owned here; V-023 ownership; fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
