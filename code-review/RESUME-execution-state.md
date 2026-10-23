# Stage 2 execution: resume point (saved 2026-10-22 21:40 MDT)

Coordinator: the Claude Code board-review session. Kyle's standing permissions for this workstream:
- merge remediation PRs after an independent review and green CI;
- watch PRs and fix CI failures within scope;
- create and update Notion cards.

Kyle approves; Claude never records an approval.

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
