# TASK-029 — Gate: build and record the release candidate (CI green, advisory result, EXE SHA-256)

| Field | Value |
|---|---|
| Status | Ready for Approval (r4) |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | NA-2 / P0-06 |
| Mandatory gate | Yes — ISSUE-040, ISSUE-050, ISSUE-051 (+ ISSUE-030 checks) |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-040, ISSUE-050, ISSUE-051 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | WIN-007, TEST-001, TEST-004 (linked); TR-012/TR-013 observation |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd; .github/workflows/ci.yml, release-installer.yml |
| Wave | W4 |
| Effort / risk | S / Low |
| Verification platform | GitHub Actions + Windows (hash check) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + currency update for approved decisions) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
No valid candidate exists: `7679edc` lacks LegalGate/notices; `b94fb1b` is 14 commits behind `92e7980`.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
No code. Choose the final SHA after W1–W3 merge; confirm a green `ci.yml` run on that exact SHA from a push to `main` or a `workflow_dispatch` (the run's head SHA equals the recorded SHA; a `pull_request` run does not count, because it tests GitHub's temporary merge commit, not the SHA). Read the dependency-audit job summary for 'NOT RUN': on a push run an outage is only a warning and the job stays green, so if either audit says 'NOT RUN', run `ci.yml` by `workflow_dispatch` while `main`'s head is still the recorded SHA. On `workflow_dispatch` (and `schedule`) `--fail-on-outage` is applied automatically (`ci.yml:109, 124`); the workflow has no inputs (`ci.yml:11`), so the flag cannot be passed in. Dispatch the release workflow; record run ID, version (TASK-005 Option A: `0.1.1` for the first candidate, then `0.1.2`…; each candidate a new version higher than every earlier candidate and than the recorded `0.1.0` artifact; set by TASK-027; if the release run is from a tag, the tag is `v<version>`, which the workflow enforces at `.github/workflows/release-installer.yml:67-68`), toolchain, artifact name/expiry and the EXE SHA-256 from `SHA256SUMS.txt` (not the artifact ZIP digest); during the build confirm the dev-tools dist check line and, if possible, that the binary lacks `dev_reset_handoff`/`dev_seed_fake_data` strings.

## Out of scope
Installing (TASK-030).

## Implementation approach
1. Record final SHA.
2. Record CI run URL/result, its event (`push` or `workflow_dispatch`) and its head SHA.
3. Record advisory result text.
4. Dispatch release; download artifact; `Get-FileHash` the EXE; compare with SHA256SUMS.txt.
5. Record all fields in the evidence register.

## Prerequisites, dependencies and conflicts
- Prerequisites: All W1–W3 tasks Verified (incl. TASK-025, TASK-026, TASK-027). W1–W3 here means the code and documentation tasks.
- Decisions (approved 2026-10-22): TASK-001 (A), TASK-002 (B + cleanup), TASK-005 (A), TASK-006 (A), TASK-008 (A for both gates).
- TASK-002 follow-ups resolved (this card stays **Blocked** until then, per the TASK-002 decision): TASK-037 (synthetic replacement for `test_csvimport/Performance.csv` and its Rust tests) Verified and merged into the candidate SHA; TASK-038 (removal of the two unreferenced exports) Verified and merged; TASK-039 (Git-history exposure) assessed, Kyle's separate owner disposition recorded and, if he chose option B (make the repository private) or option C (rewrite history), its separate execution task **Verified** (for C, the candidate SHA is taken from the rewritten history). If Kyle rules (TASK-041) that the value-level copies of real rows must be removed, TASK-041 Verified and merged into the candidate SHA is a prerequisite too; if he accepts them as low-risk, it is not.
- TASK-040 (`cargo fmt` formatting and CI check, the TASK-008 cargo-fmt follow-up) **Verified** and contained in the candidate SHA (TASK-008 = A: adopt; G5).
- TASK-034 code change (W3c) merged and contained in the candidate SHA (TASK-008 = A: gate kept). Its W5 owner run is **not** a prerequisite (it runs on this candidate).
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Evidence register row complete: SHA, CI run, advisory result (not 'NOT RUN'), release run, version (`0.1.1` or later and higher than every earlier candidate, TASK-005 = A; equal to the `FundedFlow_<version>_x64-setup.exe` file name and, for a tag run, to the tag `v<version>`), EXE SHA-256 (matches SHA256SUMS.txt), artifact expiry ≥ 30 days.
- [ ] The candidate SHA contains the merged TASK-037, TASK-038, TASK-040 and TASK-034 (code) changes, and TASK-039's owner disposition is recorded and, if option B or C was chosen, its execution task is Verified (for C, the SHA is from the rewritten history); TASK-041 is merged if Kyle chose removal; the CI run on that SHA includes the TASK-040 `cargo fmt` check, green.
- [ ] The CI run is a `push` to `main` or a `workflow_dispatch` run whose head SHA equals the recorded SHA (not a `pull_request` merge-commit run); if the push run's audit said 'NOT RUN', a `workflow_dispatch` run on the same SHA is green (`--fail-on-outage` applied automatically, `ci.yml:109, 124`).
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
—

## Safety, rollback and side effects
No user data.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build of the machine that ran `Get-FileHash`), tester, date and evidence. A planning document or inferred result is not a pass.

## Changes in r3
- Prerequisites: added "TASK-008 decided; the fmt task Verified if the gate is kept" (10 §8.2 TASK-029; G5).
- r3 review fix: the TASK-034 code change (W3c) must be in the candidate SHA; its W5 owner run is not a prerequisite, which removes the 029↔034 deadlock (independent r3 review).
- CI evidence: a `push`-to-`main` or `workflow_dispatch` run on the exact SHA, not a PR merge commit; `--fail-on-outage` is applied automatically on dispatch (`ci.yml:109, 124`, verified at b01e2b9) and cannot be passed in (no `workflow_dispatch` inputs, `ci.yml:11`); added a matching acceptance criterion (10 §8.2 TASK-029; G14).
- Dropped the WebView2 field from the Definition of Done (10 §8.2 TASK-029; G14).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Changes in r4
- Prerequisites: added TASK-037, TASK-038 and TASK-039 resolved; this card stays Blocked until then (TASK-002 r2 approved: the test_csvimport CSVs are real exports; Option B + cleanup).
- Prerequisites: "the fmt task Verified if the gate is kept" replaced by TASK-040 Verified (TASK-008 r3 approved, cargo fmt Option A adopt; TASK-040 is the follow-up).
- Prerequisites: the TASK-034 code change is now unconditional (TASK-008 r3 approved, upgrade gate Option A keep); its W5 owner run is still not a prerequisite.
- Prerequisites: "TASK-00x decided" replaced by the decided options (decisions 2026-10-22).
- Version: recorded version must follow TASK-005 Option A (`0.1.1` onward, increasing per candidate, tag matches) in scope and acceptance (TASK-005 r2 approved); the tag check applies to tag runs only (`release-installer.yml:7-9, 67-68`: `workflow_dispatch` and `v*` tag triggers; mismatch check only when the ref is a tag).
- Acceptance: added a criterion that the candidate SHA contains the TASK-037/038/040/034 changes, TASK-039 is recorded and the CI run includes the TASK-040 fmt check (follows from the prerequisites above).
- Independent review (review3_B), blocking: the TASK-039 prerequisite and acceptance now match TASK-039's own gate: disposition recorded **and**, if option B or C is chosen, its execution task Verified (for C, the candidate SHA comes from the rewritten history).
- Independent review (review3_B), nit: TASK-041 (value-level copies of real rows, split from TASK-037) added as a conditional prerequisite, only if Kyle chooses removal. The matching TASK-029 row in `08-stage2-remediation-task-index.md:52` still shows r3 prerequisites and is to be updated in the index pass (not edited here).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: TASK-008/fmt prerequisite; CI evidence on exact SHA via push or workflow_dispatch with automatic `--fail-on-outage`; WebView2 field dropped from DoD; fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review (currency pass, 2026-10-22): two reviewers plus a re-check of the blocking fixes; READY at r4.
