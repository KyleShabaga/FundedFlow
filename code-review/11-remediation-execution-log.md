# 11 — Stage 2 remediation execution log

This log is the record the task specs call "the execution log". The detailed evidence for each task (tests that failed before and passed after, check exit codes, fixture diffs) is in the merged PR body, linked below. This log adds the owner rulings, deviations and known gaps that the specs say must be recorded here.

The post-merge verification sweep ran on 2026-10-23 against `main` at c0c7c2f. Three read-only agents checked every acceptance criterion against the code on main, the tests on main and the evidence recorded in each PR.

## Status at c0c7c2f

| Task | PR | Merge | Status | Pending, and where it moves |
|---|---|---|---|---|
| TASK-004 r4 | #113 | — | Implemented | `packages.md:140-141` line references have drifted; fix PR in progress |
| TASK-010 r2 | — | — | Verified | Measurement (`execution/task-010-journal-growth-results.md`) |
| TASK-011 r3 | — | — | In Progress | (a) and (c) recorded; (b) not run (`execution/task-011-windows-baseline-results.md`); scripted Sandbox run with Kyle |
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
| TASK-022 r5 | #111 | — | Verified | Owner X1/Alt+← check → TASK-030 (assigned 2026-10-23) |
| TASK-023 | — | — | Closed Not Needed | TASK-011(a) evidence |
| TASK-024 r5 | #115 | — | Verified | — |
| TASK-025 r6 | #122 | — | Verified | Packaged first-run check → TASK-030 |
| TASK-026 r5 | #130 | 819f967 | Verified | — |
| TASK-027 r6 | #120 | cc63bc5 | Implemented | Three Actions observations in progress (src-only trigger, failing check blocks packaging, ci.yml dispatch) |
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
- **TASK-023 (2026-10-23):** closed Not Needed. TASK-011(a) shows a prompt on both X and Alt+F4 in every dirty editor; Cancel keeps the text.
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

1. TASK-004 line-reference fix merged → Verified.
2. TASK-027 observations recorded → Verified.
3. Then TASK-029: dispatch `release-installer.yml` on the chosen main SHA, record the run, advisory result, version and EXE SHA-256, and store the artifact outside GitHub.
