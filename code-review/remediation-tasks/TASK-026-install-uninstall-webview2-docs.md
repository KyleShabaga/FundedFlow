# TASK-026 — Documentation: uninstall scope, WebView2/offline wording and workflow facts

| Field | Value |
|---|---|
| Status | Proposed (r4; awaiting independent review) |
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
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + approved-task audit fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 4d4e66d (HEAD at r3; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Uninstall text omits screenshots, restore safety copies, the legal record and the cleanup queue; docs do not say the installer needs internet when WebView2 is missing; workflow trigger/retention text is stale (`docs/build-26.75-evidence.md:63,70`; `README.md:72`).

## Trigger / reproduction
Owner relies on docs during install/uninstall.

## Root cause / evidence
Docs drift.

## Expected change scope
`README.md` (Windows installer section, `:68-81`, including the required WebView2/offline statement at `:78`; and the "nothing leaves the machine" sentence at `:85`, see step 2), `docs/build-26.75-evidence.md:51-71` only (the "Uninstall and data" paragraph and the release-workflow facts; lines 117-166, the smoke checklist and NA-7 draft, belong to TASK-028), wording input for `apps/desktop/src/legal/index.ts` (implemented in TASK-025).

## Out of scope
Changing installer behaviour (TASK-006/027).

## Implementation approach
1. List what 'Delete the application data' is expected to remove: NSIS removes `%APPDATA%\com.fundedflow.desktop` (journal, WAL, screenshots, pre-upgrade backups, restore safety copies, cleanup queue, legal-acceptance.json) and also `%LOCALAPPDATA%\com.fundedflow.desktop` (WebView2 data). State these as *expected* until TASK-031 verifies them; advise exporting first.
2. State WebView2 network behaviour per the TASK-006 decision. TASK-006 was approved as Option A on 2026-10-22 (recorded on the Notion approval board, TASK-006 Decision Notes, with Kyle's words; the repository card carries no approval record yet): keep `downloadBootstrapper` (`src-tauri/tauri.conf.json:49-52`), so the installer needs internet when WebView2 is missing, while the installed app works offline.
   - **Required change:** `README.md:78` currently says only "If WebView2 is missing, the installer downloads it from Microsoft once." It does not say that internet is needed, what happens offline, or that the installed app then works offline. Replace it with a statement along the lines of: "If WebView2 is missing, the installer needs an internet connection to download it from Microsoft; once installed, FundedFlow works offline." The evidence lines `docs/build-26.75-evidence.md:18-19, 35-43` are outside 51-71 and may be edited only if a statement is found wrong, with that line named in the PR checklist.
   - Do not add or keep an absolute "makes no network connections" claim (that phrase is not in `README.md` or `docs/`; it appears only in `apps/desktop/src/legal/privacy-notice.ts:12, 30`, which TASK-025 replaces). Align `README.md:85` ("…and nothing leaves the machine") with the approved owner-only package wording: FundedFlow does not automatically upload journal contents or check for updates; the package deliberately does not promise that the operating system or third-party runtime never connects. The same absolute phrase in `src-tauri/tauri.conf.json:35` (`longDescription`) is a config change owned by TASK-027; record it there or as a Triage card, do not edit it here.
3. Correct trigger paths and retention (3 days for pull requests, 30 otherwise: `.github/workflows/release-installer.yml:116` at 9430f2a) in `docs/build-26.75-evidence.md:63-71` and `README.md:72`, which both say 30 days only. This card runs after TASK-027 has merged (TASK-027 rewrites `release-installer.yml`, widening the pull-request paths and adding a checks gate): describe the trigger paths and retention as they are in the workflow at this card's merge SHA, citing those lines (at 9430f2a the paths are `release-installer.yml:11-21`).

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-006; TASK-027 merged (ordering: the workflow facts documented here must be the post-TASK-027 ones).
- Likely shared-file conflicts: `README.md` with TASK-027/028.

## Acceptance criteria (pass/fail)
- [ ] `README.md` (in the Windows installer section, replacing the sentence at `:78`) states that the installer needs an internet connection only if WebView2 is missing, and that FundedFlow works offline once installed; this statement is a mandatory row in the checklist below, checked against `src-tauri/tauri.conf.json:49-52`.
- [ ] `README.md` contains no absolute "nothing leaves the machine" / "makes no network connections" claim; the `:85` sentence matches the approved owner-only package wording.
- [ ] The PR description contains a checklist with one row per changed statement: the statement, its doc file:line, and the source file:line it was checked against at the merge SHA (for example `.github/workflows/release-installer.yml:116` for retention, `tauri.conf.json:49-52` for the WebView2 install mode). Every row is ticked.
- [ ] No line of `docs/build-26.75-evidence.md` outside 51-71 is changed by this card, except a line named in the checklist under step 2.
- [ ] Root `npm test` → exit 0 (sanity).

## Verification plan
Per-statement checklist (above); NSIS behaviour confirmed later in TASK-031.

## Safety, rollback and side effects
Docs only.

## Definition of done
Documents updated; every factual statement checked against the cited source (file:line/workflow line) at the recorded SHA; reviewed.

## Changes in r3
- Limited the evidence-doc scope to `docs/build-26.75-evidence.md:51-71` (§8.3 says 51-70; the retention sentence ends on line 71); lines 117-166 belong to TASK-028 (10 §8.3 TASK-026).
- Replaced "reviewer verifies" with a per-statement source-line checklist in the PR (10 §8.3 TASK-026).
- Step 2 records the approved TASK-006 Option A (bootstrapper; internet needed only when WebView2 is missing).
- Step 3 cites the retention rule at `release-installer.yml:116`.

## Changes in r4
- Step 2: the claim that the current text already meets TASK-006 Option A is removed. `README.md:78` lacks the "internet needed if WebView2 is missing, then offline" statement, so rewriting it is now a required change with its own acceptance criterion and checklist row (approved-task audit, MUST).
- Step 2: "Keep 'FundedFlow itself makes no network connections'" removed. That phrase exists nowhere in `README.md` or `docs/` (only in `privacy-notice.ts:12, 30`, replaced by TASK-025) and conflicts with the approved package, which scopes the claim. `README.md:85` is aligned with the package wording; `tauri.conf.json:35` is left to TASK-027 or a Triage card because it is config (approved-task audit, SHOULD). Note: the absolute claim is not shown to be false by a network trace; it is replaced because it is broader than the approved owner text.
- Ordering: TASK-027 merged is now a prerequisite, and step 3 documents the workflow facts at this card's merge SHA (approved-task audit, SHOULD).
- Trigger-path citation corrected from `release-installer.yml:10-21` to `:11-21` (approved-task audit, NIT).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.3): nits only — applied in r3.
Independent review r3 (2026-10-22): CHANGES on 012, 024, 026 (citations, test construction, scope lines); applied. READY.
