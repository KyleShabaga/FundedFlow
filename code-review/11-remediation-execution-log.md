# 11 — Stage 2 remediation execution log

This log is the record the task specs call "the execution log". The detailed evidence for each task (tests that failed before and passed after, check exit codes, fixture diffs) is in the merged PR body, linked below. This log adds the owner rulings, deviations and known gaps that the specs say must be recorded here.

The post-merge verification sweep ran on 2026-10-23 against `main` at c0c7c2f. Three read-only agents checked every acceptance criterion against the code on main, the tests on main and the evidence recorded in each PR.

## Status at c0c7c2f

| Task | PR | Merge | Status | Pending, and where it moves |
|---|---|---|---|---|
| TASK-004 r4 | #113, #136 | eaf7ee3 | Verified | Drifted line references fixed in #136 |
| TASK-010 r2 | — | — | Verified | Measurement (`execution/task-010-journal-growth-results.md`) |
| TASK-011 r3 | — | — | Verified | (a), (b) and (c) measured with full environment (sandbox rerun 2026-10-23) |
| TASK-012 r3 | #109 | — | Verified | — |
| TASK-013 r4 | #118 | — | Verified | — |
| TASK-014 r5 | #119 | — | Verified | — |
| TASK-015 r5 | #121 | — | Verified | — |
| TASK-016 r5 | #125 | — | Verified | — |
| TASK-017 r6 | #127 | af85fdb | Verified | — |
| TASK-018 r5 | #134 | eeda9a1 | Verified | Manual Windows junction check → TASK-030 (B1/B2) |
| TASK-019 r2 | #108 | — | Verified | — |
| TASK-020 r2 | #112 | — | Verified | — |
| TASK-021 r5 | #117 | — | Verified | — |
| TASK-022 r5 | #111, #138 | 1d13c43 | Implemented | Back-navigation fix merged in #138; Windows recheck on the candidate pending (Final manual tests §1) |
| TASK-023 r3 | #138 | 1d13c43 | Implemented | Kyle approved 2026-10-23; close veto merged; Windows recheck on the candidate pending (Final manual tests §1) |
| TASK-024 r5 | #115 | — | Verified | — |
| TASK-025 r6 | #122 | — | Verified | Packaged first-run check → TASK-030 |
| TASK-026 r5 | #130 | 819f967 | Verified | — |
| TASK-027 r6 | #120 | cc63bc5 | Verified | Actions observations: src-only PR runs 39999226696 (installer built); failing check run 39999274705 (packaging skipped, no artifact); ci.yml dispatch 39999179989 (success) |
| TASK-028 r7 | #131, #133 | aebd450, f2f9c33 | Verified | B1/B2 stay "unmeasured" until TASK-011(b) runs → TASK-036 known gaps |
| TASK-037 r3 | #114 | — | Verified | — |
| TASK-038 r1 | #110 | — | Verified | — |
| TASK-040 r3 | #124 | 5ed15da | Verified | — |
| TASK-041 r2 | #126 | 2135d79 | Verified | Partial-B ruling (below) |
| TASK-042 r2 | #132 | 97deff5 | Verified | — |
| TASK-043 r2 | #128 | 4144cb6 | Verified | — |
| TASK-044 r3 | #129 | 00ddb23 | Verified | Packaged-text check → TASK-030 |
| TASK-045 r2 | #135 | c0c7c2f | Verified | Restore-cost deviation (below) |

A "—" in the Merge column means the merge SHA is in the PR's record and is not repeated here.

## Owner rulings and decisions recorded here

- **TASK-041 (Kyle, 2026-10-22, approval card):** partial B. Test, fixture and mockup copies of real rows are replaced. The v3/v4 `.db` upgrade fixtures, `generate.rs.txt` and the `v3Upgraded`/`v4Upgraded` sections of `command-wire.json` are an accepted residual. The criterion "`fundedflow-v3.db`/`-v4.db` regenerated" is waived.
- **TASK-025 (Kyle, 2026-10-22):** draft-status option A. The `0.2.1-draft` documents ship as drafts, and the "About this draft" paragraph is accepted for V1. The mapping from each r5 criterion to the #107 line that satisfies it (or "superseded") is in the body of PR #122.
- **TASK-039 (Kyle, 2026-10-22):** option A. No history rewrite, so there is no execution task.
- **TASK-023 (2026-10-23):** first closed Not Needed on Kyle's manual run, then **reopened** after the sandbox rerun, which Kyle ruled is the truth: no prompt on X or Alt+F4.
- **TASK-011(c) backup limit (Kyle, 2026-10-23):** a full backup is refused once `data.json` exceeds 64 MiB (about 50,000 trades). This is accepted as a V1 known gap for the release notes (TASK-035) and TASK-036. The fix is planned for V1.1 (Development Board card 4021bd4b6bde81249483d1071c21c6e6).
- **TASK-045 (Kyle, 2026-10-23):** the 8 KiB per-calculation growth bound applies from the 2nd calculation on.
- **TASK-018 (2026-10-23, auto-approve rule):** TASK-011(b) is not a blocker. The manual check moves to TASK-030.
- **TASK-022 (2026-10-23, auto-approve rule):** the owner X1/Alt+← check moves to TASK-030.

## Deviations and known gaps

- **TASK-022:** a history entry without `history.state.idx` (one created outside the router) is not guarded. This is covered by `leave-guard-history.test.tsx:174` as a known gap.
- **TASK-018:** restore inspect and prepare under a junctioned profile still fail with `unsafe_path`, because `export_csv` is a user path and keeps the full walk. Triage card 4021bd4b6bde81f7b23fddb43ca43a1c.
- **TASK-045:** restore cost was measured at K = 45 instead of K = 50. A schema-22 archive at K = 50 cannot exist, because it would exceed the 64 MiB cap. Peak disk was 223 MB against 1.09 GB `required_free_bytes`. Read-time memory peaks at about 2.2 GB for shape (iv) at N = 2,000 and K = 250; this is the size of the decoded result, and the baseline returns a result of the same size.
- **TASK-037:** a low-risk scan hit remains at `docs/design/mockups/TradeDetail.dc.html:54-56` (round-number y-axis tick labels).
- **CodeQL:** the alerts are false positives in test code, and Kyle dismisses them. Three are from #135 (`frozen_v1_tests.rs:1279, 1332`, `data_controls/tests.rs:2596`), and earlier ones are in `attempt_tests.rs`.

## Remaining before TASK-029 (release candidate)

1. Done: TASK-004 and TASK-027 Verified (2026-10-23).
2. Next, TASK-029: dispatch `release-installer.yml` on the chosen main SHA, record the run, advisory result, version and EXE SHA-256, and store the artifact outside GitHub.

## TASK-029: release candidate recorded (2026-10-23)

| Field | Value |
|---|---|
| Source SHA | `1d13c438c2cfa4752fb57fba8cef693ad3398d8f` (main after #138) |
| Release run | https://github.com/KyleShabaga/FundedFlow/actions/runs/40014761941 (`workflow_dispatch`) |
| Check jobs | `checks / build-and-test`, `checks / dependency-audit` and `nsis-installer` all succeeded. Each reported checked-out commit `1d13c43`, and the installer job asserted that it equals `SOURCE_SHA`. `cargo fmt --check` ran in build-and-test. |
| Advisory result | npm audit and cargo audit: "no blocking advisories" (both run with `--fail-on-outage`) |
| Version | 0.1.1, the first recorded candidate (TASK-005 option A). It matches the file name and `SHA256SUMS.txt`. |
| Artifact | `fundedflow-0.1.1-1d13c43-windows-nsis` (the GitHub copy expires 2026-11-22) |
| Installer | `FundedFlow_0.1.1_x64-setup.exe`, 5,386,814 bytes |
| EXE SHA-256 | `60091dafd5bd8e6cdf9d40eb4610f75b735c15e0fbf7be3e5f3b94a7e0048646` (Get-FileHash; matches `SHA256SUMS.txt`) |
| Hashed on | Windows 11 Pro 25H2, build 26200.9711 (coordinator PC) |
| Stored copy | `C:\Users\Kyle\Documents\FundedFlow-release-artifacts\0.1.1-1d13c43\` |
| Contains | TASK-037, 038, 040 and 034 (code). TASK-039 disposition A is recorded. |
| TASK-023 state | Implemented in the candidate (#138). Its Windows recheck runs on this candidate (TASK-030 / Final manual tests §1). |

The earlier 0.1.1 builds (`819f967`, `eeda9a1`) were throwaway TASK-011 builds, not candidates.

## Gate decisions (Kyle, 2026-10-23)

- **TASK-031 step 4a:** recorded as Not Run. Migrations 0022 and 0023 were added after the spec, so 0.1.0 refuses the 0.1.1 journal as NewerSchema before its cleanup recovery runs. The TASK-015/016 note "an older build finishes the cleanup" no longer applies for 0.1.0 → 0.1.1. Step 4 still records the refusal.
- **TASK-030:** Windows Sandbox counts as the clean Windows 11 leg. The Windows 10 22H2 leg is Not Run and is listed as a TASK-036 known gap.
- **Gate prompts:** `execution/gate-test-prompts-030-034.md`, mirrored on the Notion "Final manual tests" page.
- **OneDrive export (Kyle, 2026-10-23):** removed from V1 test scope (smoke checklist B2, the TASK-030 prompt, and a note on the TASK-030 spec). It is listed as an untested known gap for TASK-035 and TASK-036: "Exporting a full backup into a OneDrive-synced Documents folder (Files On-Demand) is untested." Checklist PR #140.
- **TASK-030 Windows 10 22H2 leg:** skipped (Kyle reconfirmed 2026-10-23).

## Known gaps for TASK-035 / TASK-036 (running list)
1. A full backup is refused above about 45,000–50,000 trades, because data.json is over 64 MiB. Fix planned for V1.1 (Development Board card 4021bd4b6bde81249483d1071c21c6e6).
2. Exporting to a OneDrive-synced Documents folder (Files On-Demand) is untested.
3. Windows 10 22H2 is untested; only Windows 11 (Sandbox) was tested.
4. TASK-031 step 4a (an older build finishing an interrupted cleanup after a downgrade) was Not Run: 0.1.0 refuses a schema-23 journal.
5. With a junctioned profile, inspecting or preparing a restore fails with `unsafe_path` (Triage card 4021bd4b6bde81f7b23fddb43ca43a1c).
6. When the app data folder is itself a junction, "Acknowledge and continue" writes `legal-acceptance.json` through the junction before the folder is refused (Triage card 4021bd4b6bde818f8b81cacaf66ff026).
7. TASK-022: a history entry without `history.state.idx` is not guarded (by design; covered by a test).
8. While an editor is dirty, a hung page makes X and Alt+F4 do nothing; the fallback is Task Manager (Triage card 4021bd4b6bde81808ce7ff147801d4e7).

## Final manual test 1: unsaved-edit guards on the candidate (2026-10-23)

PASS, 14 of 14 (G1–G10, C1–C4), on candidate 0.1.1 at `1d13c43` (EXE 60091daf…). Run in Windows Sandbox on the coordinator PC (sandbox build 26100.9711, WebView2 155.0.4283.62), driven by Claude Code. The report and key screenshots are in `execution/sandbox/results-2026-10-23-guards/`.
- TASK-023 close veto: the dialog showed on X and Alt+F4 for the rulebook draft, the trade review and the daily review. Cancel kept the text, Leave closed the window, clean windows closed at once, and first-run Close closed the app.
- TASK-022 back navigation: X1 and Alt+Left on dirty editors showed the dialog. Stay kept the text, and Leave went back exactly once.
- Sandbox note: this host's sandbox has a stale WebView2 pv (.60, runtime folder .62), so startup failed until `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` was set inside the sandbox. This is not a FundedFlow defect; a low-priority triage item is proposed.

## TASK-030 on the candidate (2026-10-23, Claude Code in Windows Sandbox on the coordinator PC)

Every sandbox-runnable mandatory step passes: 1–10, 4a, L1 (TASK-025), L2 (TASK-044), B1 (TASK-018 recheck), B2 junction, B3/B8 (from Final test 1), B4 and B5.

Open items:
- R1: Kyle's real broker export.
- B7: this host's sandbox always has WebView2, so it can't be set up here. B7a was observed on the other PC's sandbox with build eeda9a1.
- B6: scaling, on Kyle's real PC.

Gate state: **Blocked**, pending R1, B6 and B7.

Note: the app shows 293 third-party components while the file lists 290 (232 + 58); a low-priority triage item.

Report: `execution/sandbox/results-2026-10-23-task030/report.md`.

## TASK-031 on the candidate (2026-10-23, Claude Code in Windows Sandbox)

**PASSED.** All three pass rules hold:
- (a) Data is intact after the 0.1.0 → 0.1.1 upgrade (schema 23, `before-v23.bak` written, acknowledgment shown) and after a same-version reinstall.
- (b) The unticked uninstall keeps the journal and its recovery copies.
- (c) The ticked uninstall removes exactly the TASK-026 list; the exported archive is unchanged.

Step 4 (downgrade): 0.1.0 refuses with "This journal needs a newer FundedFlow… Your data has not been changed", with no Retry. 4-back restores everything. 4a is Not Run (owner decision).

Observations:
- 0.1.0 checkpoints the WAL into the main db file before refusing it, so the bytes change while the data does not (low-priority triage item).
- Screenshot attachments were not exercised.

Report: `execution/sandbox/results-2026-10-23-task031/report.md`.

## TASK-032 on the candidate (2026-10-23, Claude Code in Windows Sandbox)

**PASSED.** R0–R8 all pass with no data loss: export/erase/restore, locked journal, corrupt header, failed migration rollback, newer-schema refusal, interrupted restore (pre-restore or fully restored, never a mix), malformed cleanup markers, stray and missing screenshots, and the large journal (vacuumed snapshot export; over-cap refusal).

R9 and R10 are Not Run. Triage needed for R10.

Notes: the corrupt-journal message uses the lock-oriented text; an unrecognised file in the attachments root blocks restore by design; an interrupted restore leaves files in data-controls-work.

Report: `execution/sandbox/results-2026-10-23-task032/report.md`.
