# Stage 2 execution: resume point (saved 2026-10-22 21:40 MDT)

Coordinator: the Claude Code board-review session. Kyle's standing permissions for this workstream:
- merge remediation PRs after an independent review and green CI;
- watch PRs and fix CI failures within scope;
- create and update Notion cards.

Kyle approves; Claude never records an approval.

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
- **TASK-014: MERGED #119.** TASK-015 r5 has been sent to the data-controls session.
- **TASK-027 r6:** sent to session `local_2c4b47ab-0110-40a2-864f-bdf55a7870c4`. Hold the merge until TASK-017 is merged.
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
- Download the 0.1.0 artifact before 2026-11-20 (TASK-031 step 0).
- Windows VM work: 011 and 018.
- The TASK-022 Windows check.
- Dismissing the CodeQL alerts on #112.
