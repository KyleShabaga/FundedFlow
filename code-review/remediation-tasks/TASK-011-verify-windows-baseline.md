# TASK-011 — Verification: Windows baseline measurements on a throwaway build (close, junction, write timing)

| Field | Value |
|---|---|
| Status | Proposed (r3; awaiting independent review) |
| Type | Verification |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No (results do not count toward gates) |
| Severity | Medium |
| Confidence | Medium |
| Canonical issue | ISSUE-009, ISSUE-006, ISSUE-010 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | DATA-008, UI-005, WIN-001, WIN-002, DATA-006, DATA-007 |
| Source card / date | Stage 1 audit 2026-10-22; 07 §G.1 (V-006, V-009, V-010) |
| Wave | W0 |
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
Answer three Windows-only questions that size fixes: (a) does title-bar close show any prompt with unsaved review text under WebView2? (b) does the app start when the profile or Roaming is behind a junction, and in Windows Sandbox? does export to OneDrive Documents work? (c) how long do a 50k-row CSV commit and a large export take?

## Trigger / reproduction
See purpose.

## Root cause / evidence
See linked findings.

## Expected change scope
Owner-executed on a disposable Windows VM/profile using a build of the current SHA, isolated from the real journal (a separate Windows user profile or VM). Step (b) must use the release EXE (installer build); (a) and (c) may use a debug or release build. No repository change.

## Out of scope
Fixes; counting results toward gates.

## Implementation approach
1. Build from the current SHA (CI workflow_dispatch or local `npm run tauri build`).
2. On a disposable VM/profile: dirty a trade review and a daily review, click the title-bar X; record behaviour.
3. Create a junction for `%APPDATA%` (or relocated profile) on a test account; install and launch the **release EXE**; record runtime status. Repeat in Windows Sandbox. Do not set `FUNDEDFLOW_DEV_DATA_DIR` and do not use `npm run dev:test-journal` for this step: that variable replaces the OS-resolved `app_data_dir()` (`src-tauri/src/lib.rs:181`, override at `lib.rs:185-195`, debug builds only), so it would bypass the very path being tested.
4. Export to OneDrive\Documents (Files On-Demand on) and to a junctioned folder; record result.
5. Import a synthetic 50k-row CSV and export a large synthetic journal; time both.

## Prerequisites, dependencies and conflicts
- Prerequisites: Approval; a Windows VM. Synthetic CSV must not contain real trades.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Each of (a)–(c) recorded with SHA, Windows build, WebView2 version, tester, date.
- [ ] (b) recorded as run on the release EXE (installer EXE SHA-256 recorded), with `FUNDEDFLOW_DEV_DATA_DIR` unset and without `dev:test-journal`; a (b) result from a debug build or with that variable set does not count.
- [ ] No fixture is regenerated: `FUNDEDFLOW_UPDATE_FIXTURES` stays **unset (not `0`)** for any check run on the test VM.
- [ ] TASK-023 scope confirmed or reduced from (a); TASK-018 test cases from (b); ISSUE-010 escalation from (c) recorded.

## Verification plan
Recorded results.

## Safety, rollback and side effects
Disposable VM/profile only; never the real journal.

## Definition of done
Results recorded in `code-review/11-remediation-execution-log.md` with tester, date, source SHA (and installer EXE SHA-256 where applicable), environment and raw observations; the linked decision/escalation is updated. No code change is implied.

## Changes in r3
- 10 §8.2 TASK-011 (G14): step (b) uses the release EXE and forbids `FUNDEDFLOW_DEV_DATA_DIR` and `dev:test-journal`; cited the override at `lib.rs:185-195` (comment at 185, `#[cfg(debug_assertions)]` block 188-195) and the `app_data_dir()` call at `lib.rs:181`; added a matching acceptance criterion.
- 10 §8.3 fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` must be unset (not `0`).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: release EXE and no `FUNDEDFLOW_DEV_DATA_DIR`/`dev:test-journal` for step (b) (G14); fixture rule "unset (not `0`)".
