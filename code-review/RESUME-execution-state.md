# Stage 2 execution: resume point (saved 2026-10-22 21:40 MDT)

Coordinator: the Claude Code board-review session. Kyle's standing permissions for this workstream:
- merge remediation PRs after an independent review and green CI;
- watch PRs and fix CI failures within scope;
- create and update Notion cards.

Kyle approves; Claude never records an approval.

## Remaining plan (as of 2026-10-23 19:10 MDT; Kyle raised the usage limit to 99%)
000000. **Gate tests in progress, driven by Claude in Windows Sandbox on THIS PC.**
   - Final test 1 PASSED 14/14. TASK-022 and TASK-023 are Verified.
   - TASK-030 run S1 is in progress. Output goes to `C:\FFSandbox\out030s1`. The driver is `C:\FFSandbox\kitfdriver.ps1` plus `helpers.ps1`/`cases.ps1`; the host queues steps with `hoststep2.ps1` (`$env:FFOUT=out030s1`). The WebView2 workaround (`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`) is built into `cases.ps1`.
   - S1 results so far:
     - 1 PASS (hash), 2 PASS (no UAC or SmartScreen, `%LOCALAPPDATA%\FundedFlow`, HKCU entry, Publisher Kyle Shabaga, 0.1.1), 3 PASS (offline).
     - 4 PASS (Before you start, Draft documents, both docs at 0.2.1-draft), L1 PASS.
     - 4a: files PASS. The file lists Rust 232 + npm 58; the in-app view says "293 components"; check the npm count in the app.
     - 5 PASS, 6 PASS (5 trades after reopen), 7 PASS (no dev items; F12 and Ctrl+Shift+I do nothing; the `#/settings/developer` URL is not testable without an address bar).
   - Remaining in S1: L2, B5, B2-j, 8, 9, 10, R1 (Kyle). Then S2 (B1), S3 (B4) and S4 (B7b; Not Run here because the sandbox always has the host's WebView2). B7a is also Not Run here.
   - Then TASK-031, TASK-032, and the sandbox-capable rows of TASK-033. TASK-034 is Kyle's.
   - Save the reports to `C:\FFGate\<nn-task>eport.md` and copy them to `execution/sandbox/results-*` on this branch.

## Plan as of 2026-10-23 14:30 MDT, after the candidate (weekly usage 91%)
00000. **Candidate recorded.** TASK-029 has Gate State Passed: 0.1.1 at `1d13c43`, run 40014761941, EXE SHA-256 60091daf…, stored in `FundedFlow-release-artifacts\0.1.1-1d13c43`. 35 PRs merged; the latest are #138 (TASK-023 close veto plus the TASK-022 back-navigation fix, `1d13c43`) and #139 (smoke checklist, `cbc47aa`).
   - **TASK-022 and TASK-023:** Implemented. Their Windows recheck is §1 on the Notion page "Final manual tests" (4021bd4b6bde8095871ec9c99a69b300), with the candidate details filled in.
   - **Gate prompts for TASK-030 to TASK-034:** `execution/gate-test-prompts-030-034.md`. An agent is putting them on that Notion page as child pages.
   - **Kyle's decisions:** TASK-031 4a is Not Run. TASK-030 accepts Sandbox as the Windows 11 leg; the Windows 10 leg is Not Run and a TASK-036 known gap.
   - **Kyle runs the gates later.** Do not wait for them.
   - **Next for Claude:**
     - When gate reports arrive, record them on the cards and in the log.
     - TASK-035: the evidence register and NA-7 release notes. Known gaps so far: backup limit about 50k trades; Windows 10 leg; 4a; B2 OneDrive; the restore-inspect junction gap; the legal record written through a junction.
     - TASK-036: go/no-go (Kyle).
   - **Kyle still to do:** dismiss the CodeQL test-code alerts.

## Earlier plan (2026-10-23 15:30 MDT)
0000. Every W1–W3 task is Verified. Merged: #135 TASK-045 (c0c7c2f) and #136 TASK-004 line references (eaf7ee3). 32 PRs merged in total. Execution log: `code-review/11-remediation-execution-log.md`.
   - TASK-011(b) is done (all evidence in `execution/sandbox/results-2026-10-23`).
   - Kyle is rerunning TASK-011 (a) and (c), case B6 and the TASK-022 X1/Alt+Left check in Windows Sandbox on another PC (prompt given, CSV kit at `execution/sandbox/kit`). When the report comes in, record the results, mark TASK-011 Verified and close out the TASK-022 check.
   - Then TASK-029. Kyle chose to WAIT for those reruns before building. When ready, dispatch release-installer.yml on the main SHA, record it, and store the files in `FundedFlow-release-artifacts\0.1.1-<sha>`.
   - Kyle still needs to dismiss the CodeQL test-code alerts: 3 on #135, plus the earlier ones.

## Earlier plan (2026-10-23 12:45 MDT; save point before Kyle restarts the PC)
000. Merged: #133 (smoke checklist B3, f2f9c33) and #134 TASK-018 (eeda9a1; cards updated; the manual junction check moves to TASK-030). 30 PRs merged in total.
   - TASK-045 PR #135: the review fixes were pushed at f289149. Kyle confirmed the 8 KiB bound applies from the 2nd calculation on (comment on the approval card). After the restart, check whether the re-review of 9fac5f9..f289149 finished; if not, run it again. Then wait for CI and merge.
   - TASK-011: (a) and (c) are recorded (`execution/task-011-windows-baseline-results.md`). TASK-023 is Not Needed. The backup limit is a V1 known gap, tracked on the Development Board card 4021bd4b6bde81249483d1071c21c6e6.
   - TASK-011(b) in Windows Sandbox: Kyle is enabling Sandbox on THIS PC and then restarting it.
     - Scripts are in `scratchpad/sandbox/` (`run-cases.ps1`, `ff-old.wsb`, `ff-new.wsb`; output goes to `out\`).
     - The old installer is at `kit/old`. The new one comes from release-installer run 39991525917 (eeda9a1) and goes into `kit/new` once the run finishes.
     - Run `WindowsSandbox.exe ff-old.wsb`, wait for `out\old\done.txt`, close the sandbox, then do the same for new.
   - Kyle wants every question asked in this coordinator session, because he is remote.
00. #131 TASK-028 MERGED (aebd450), #132 TASK-042 MERGED (97deff5; review fix 0f41b2c; Triage cards 4021bd4b6bde8123… and 4021bd4b6bde8198… filed). 28 PRs merged. TASK-045 (migration 0023) running as a worktree agent on `feat/task-045-calc-snapshot-dedup`. TASK-011 kit for Kyle: artifact https://claude.ai/artifact/3DKXuyuHS4C1bzn1b7rge2 (CI installer run 39971011229, FundedFlow_0.1.1_x64-setup.exe, sha256 18ebc9ae…, source 819f967). Usage: 5-hour 27%, weekly 84%.
0b. #130 TASK-026 MERGED (819f967); 25 PRs merged in total. TASK-028 is running as a worktree agent (it uses the TASK-011-unmeasured branches).
0a. Merged (2026-10-23): #129 TASK-044 (00ddb23) and #128 TASK-043 (4144cb6, marked Verified). 24 PRs merged in total. Running: TASK-026 (worktree agent) and TASK-042 (worktree agent; migration 0022, Kyle's 4 rules). Next: TASK-045 after 042 merges, then TASK-028 after 026. Usage: 5-hour 15%, weekly 83%.
0. #120 TASK-027 MERGED (cc63bc5). TASK-026 is running as a worktree agent. #128 (043) and #129 (044) are reviewed MERGE-READY; merge when CI is green.
1. DONE: #127 TASK-017 MERGED (af85fdb, 2026-10-23); its cards are updated. 21 PRs are merged in total. Earlier note: merge #127 (TASK-017) when CI is green. Sessions 043 (`local_edae2b8f-…`), 044 (`local_e3adc06c-…`) and 027-rebase (`local_13090c1d-…`) wait for that merge and then start.
2. Review and merge each of their PRs. TASK-027 → then TASK-026 r5 (install docs).
3. After 043 is Verified/merged: TASK-042 r2 (migration 0022, Kyle's four rules), then TASK-045 r2 (migration 0023, OD answers recorded on the card).
4. Then TASK-028 r7, once 025 and 026 are merged. Its B1/B3 expected results branch on TASK-011 results ("unmeasured" is allowed).
5. Blocked on Kyle's TASK-011 run: TASK-018, the TASK-023 decision, and TASK-029 onward (release gates W4–W6).
- New work from automated turns: start sessions only on Kyle's own turns. Otherwise use Agent with `isolation: worktree`. Cold sessions (`local_fbf73df1`, `local_ff0fffc4`, `local_2c4b47ab`, `local_e213f3e8`) cost $3–5 to wake; don't message them.

## Usage rule (Kyle, 2026-10-22)
Check `get_usage` after each merge or handoff. If the 5-hour or weekly limit reaches 95%, stop at a clean point (no half-sent briefs, no mid-merge), update this file and tell Kyle. At 23:10 MDT: 5-hour 25%, weekly 79% (resets 2026-10-25 03:59 MDT).

## Later merges
#119 TASK-014, #121 TASK-015, #122 TASK-025, #107 (Kyle's MIT and legal), #123 flaky-journey fix. #124 TASK-040 MERGED (5ed15da; CodeQL flagged the same 4 false positives in `attempt_tests.rs`, which Kyle will dismiss). #126 TASK-041 partial B MERGED (2135d79; the command-wire v3/v4 sections are accepted as part of the .db residual under the standing rule). #125 TASK-016 MERGED (c08fc20). TASK-017 has been sent to the data-controls session; after 017 merges: TASK-044 to session `local_e213f3e8-…`, TASK-027 (#120) rebase and merge, TASK-026 after 027, then 043 (018 waits on the VM). Earlier: TASK-016 was sent to the data-controls session (`local_fbf73df1-…`). Next: TASK-041 (partial B), run as a worktree agent, since a session can't be started from an automated turn.

## Merged (10)
| PR | Task |
|---|---|
| #108 | 019 |
| #109 | 012 |
| #110 | 038 |
| #111 | 022 (Implemented; Kyle's Windows X1/Alt+← check pending) |
| #112 | 020 (Kyle to dismiss 4 CodeQL false positives in `attempt_tests.rs`) |
| #113 | 004 |
| #114 | 037 r3 |
| #115 | 024 |
| #116 | 034 code part (W5 owner run pending) |
| #118 | 013 |

## In flight
- **#117 TASK-021 r5: MERGED** (the CI re-run was green; the earlier failure was a flake). Cards are updated. Next: send TASK-027 r6 to session `local_2c4b47ab-0110-40a2-864f-bdf55a7870c4`.
- **TASK-014: MERGED #119.** TASK-015 is PR #121; the review fixes (read_marker quarantine and DeletionDialog finally) were sent back. Merge once those are fixed and CI is green.
- **TASK-027: PR #120** reviewed as correct. HOLD until 017 merges, then rebase and re-check that the fixture diff is still only producerVersion. Conflicts with #107 (no longer a draft) in package.json files; whichever lands second re-runs notices.
- **PR #107 MERGED** (8067cc1, Kyle's MIT and 0.2.1-draft legal track). TASK-025 r6 was sent to session `local_e213f3e8-…`. Plan: after #121 merges, run TASK-040 (cargo fmt) in session `local_ff0fffc4-…` BEFORE sending TASK-016, then TASK-041 after 040.
- **TASK-045 r2 APPROVED by Kyle** (card 4021bd4b6bde81ee936fed0a92e3e851; OD-1 B, OD-2 compact, OD-3 V1, OD-4 still v1, OD-5 no VACUUM, OD-6 none, OD-7 (1)+(2)). It sits at the end of the chain: 017 → 018 → 043 → 042 → 045 (migration 0023), and it is a TASK-029 prerequisite. The 08/09 plan docs still need syncing: add 045, and add it to 029's prerequisites.
- **PR #122 (TASK-025):** reviewed as correct. Waiting on CI, then merge.
- **PR #121:** the CI re-run is waiting on the flaky journey. A Triage card was filed (4021bd4b6bde81199bcaf15ca7315c02).
- **TASK-010: VERIFIED.** 64 MiB is reachable, and Kyle chose ISSUE-002 → P0 with a D-ARCH draft. TASK-045 is being drafted by an agent into `code-review/remediation-tasks/TASK-045-d-arch-calculation-snapshot-dedup.md`. Next: independent review, publish the card, Kyle approves.
- (old) **TASK-014 r5: PR #119 open** (head dc71846; all 7 local checks pass). Needs an independent review (high risk: preview tokens, safety copy, the one `requiredFreeBytes` fixture value), then CI, then merge. Roadmap card 27.32 is at Reviewing. Session `local_fbf73df1-5346-429c-b349-7f975029d09a`, the data-controls chain. After merge: 015 → 016 → 017 → (018: VM) → 043 → 042.
- **TASK-010 r2:** session `local_e213f3e8-2e8a-4189-bbd8-50f23b2598c3`, a measurement. If 64 MiB is reachable in 12 months, escalate.
- **Idle:**
  - session `local_2c4b47ab-0110-40a2-864f-bdf55a7870c4` (019/020/021). Next: TASK-027 r6 once #117 merges. 027 merges after 017; conflicts with #107 are noted in the spec.
  - session `local_ff0fffc4-0d7e-4241-a725-64da94fbdeef` (privacy). TASK-041 is blocked until 040, which needs #107.

## Process per PR
1. Run an independent review agent: the three-dot diff against the spec on `claude/practical-turing-wmii06`.
2. Wait for CI.
3. Merge with `--merge`.
4. Set the roadmap card to Done.
5. Set the approval card's Execution Status to Implemented, Merged to ✓, and Merged PR to the PR URL.
6. Send the next task to the session.

## Blocked on Kyle
- PR #107 merge. This unblocks 040, then 041, plus 025, 026, 028, 030 and 044.
- ~~Download the 0.1.0 artifact~~ DONE 2026-10-23. It's at `C:\Users\Kyle\Documents\FundedFlow-release-artifacts\0.1.0-7679edc\` and the SHA-256 matches.
- Windows VM work: 011 and 018.
- The TASK-022 Windows check.
- Dismissing the CodeQL alerts on #112.
