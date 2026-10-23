# TASK-029 — Gate: build and record the release candidate (CI green, advisory result, EXE SHA-256)

| Field | Value |
|---|---|
| Status | Ready for Approval (r7) |
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
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r7 (2026-10-22; r6 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision, including the TASK-023 acknowledgement under "Prerequisites") |

## Purpose / risk
No valid candidate exists: `7679edc` lacks LegalGate/notices; `b94fb1b` is 14 commits behind `92e7980`.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
No code. Choose the final SHA after W1–W3 merge (it must contain TASK-027 r5's reusable check workflow). The CI evidence is the release run itself: dispatch `release-installer.yml` on that SHA (or push the `v<version>` tag); its check jobs (TASK-027 r5: the reusable `checks.yml`, including `cargo fmt --check` and both audits with `fail-on-outage` true on dispatch and tag runs) run on `SOURCE_SHA` and must all succeed, every job must report a checked-out commit equal to `SOURCE_SHA`, and packaging runs only after they pass. A separate `ci.yml` run is not required; a `pull_request` installer run never counts as a candidate. If an audit has no result the run fails; re-run the release workflow on the same SHA and version, and record the new run ID. From the passing release run, record run ID, version (TASK-005 Option A: `0.1.1` for the first candidate, then `0.1.2`…; each candidate a new version higher than every earlier candidate and than the recorded `0.1.0` artifact; set by TASK-027; if the release run is from a tag, the tag is `v<version>`, which the workflow enforces at `.github/workflows/release-installer.yml:67-68`), toolchain, artifact name/expiry and the EXE SHA-256 from `SHA256SUMS.txt` (not the artifact ZIP digest); during the build confirm the dev-tools dist check line and, if possible, that the binary lacks `dev_reset_handoff`/`dev_seed_fake_data` strings.

## Out of scope
Installing (TASK-030).

## Implementation approach
1. Record final SHA; dispatch the release workflow on it (or push the `v<version>` tag).
2. Record the release run URL, its event (`workflow_dispatch` or tag `push`), `SOURCE_SHA`, each check job's result and reported checked-out commit, and both audit results.
3. Record advisory result text.
4. From that run, download the artifact (the hashed `FundedFlow_<version>_x64-setup.exe` and `SHA256SUMS.txt`) promptly; `Get-FileHash` the EXE; compare with SHA256SUMS.txt. Keep both files outside GitHub Actions (owner-controlled storage, path recorded in the evidence register), because dispatch and tag artifacts expire 30 days after the run (`.github/workflows/release-installer.yml:116`) and TASK-030/W5 may run later; W5 installs this kept copy after re-checking its SHA-256 against the recorded value.
5. Record all fields in the evidence register.

## Prerequisites, dependencies and conflicts
- Prerequisites: All W1–W3 tasks Verified (incl. TASK-025, TASK-026, TASK-027 and TASK-044 (TASK-009 decision 4), and TASK-042 and TASK-043 when Kyle confirms TASK-009 r4 decision 1; without that confirmation they are not started and are not prerequisites), except TASK-023 (below). W1–W3 here means the code and documentation tasks.
- TASK-023 (native window-close veto, W2; Deferred by Kyle pending TASK-011(a)): TASK-023 Verified, closed Not Needed with evidence, or still Deferred with the window-close gap explicitly accepted by Kyle in TASK-036. In the last case this card may proceed, the gap (ISSUE-009 window close) is recorded in the evidence register for TASK-036, and the candidate cannot be Go unless Kyle accepts it there.
- **Owner acknowledgement required at approval:** the "still Deferred" route above (`:50`, first added in r6, see Changes in r6) lets TASK-023, a release-blocking task, stay Deferred or Not Needed and unfixed when this card runs, instead of Verified. Kyle's approval of this revision must state explicitly that he accepts this route; without that statement, TASK-023 Verified or closed Not Needed with TASK-011(a) evidence remains a prerequisite.
- Decisions (approved 2026-10-22): TASK-001 (A), TASK-002 (B + cleanup), TASK-005 (A), TASK-006 (A), TASK-008 (A for both gates).
- TASK-002 follow-ups resolved (this card stays **Blocked** until then, per the TASK-002 decision): TASK-037 (synthetic replacement for `test_csvimport/Performance.csv` and its Rust tests) Verified and merged into the candidate SHA; TASK-038 (removal of the two unreferenced exports) Verified and merged; TASK-039 (Git-history exposure) assessed, Kyle's separate owner disposition recorded and, if he chose option B (make the repository private) or option C (rewrite history), its separate execution task **Verified** (for C, the candidate SHA is taken from the rewritten history). If Kyle rules (TASK-041) that the value-level copies of real rows must be removed, TASK-041 Verified and merged into the candidate SHA is a prerequisite too; if he accepts them as low-risk, it is not.
- TASK-040 (`cargo fmt` formatting and CI check, the TASK-008 cargo-fmt follow-up) **Verified** and contained in the candidate SHA (TASK-008 = A: adopt; G5).
- TASK-034 code change (W3c) merged and contained in the candidate SHA (TASK-008 = A: gate kept). Its W5 owner run is **not** a prerequisite (it runs on this candidate).
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Evidence register row complete: SHA, release run (with its check jobs), advisory result (not 'NOT RUN'), version (`0.1.1` or later and higher than every earlier candidate, TASK-005 = A; equal to the `FundedFlow_<version>_x64-setup.exe` file name and, for a tag run, to the tag `v<version>`), EXE SHA-256 (matches SHA256SUMS.txt), artifact expiry ≥ 30 days, and the storage location of the kept EXE and `SHA256SUMS.txt` copies (step 4).
- [ ] The candidate SHA contains the merged TASK-037, TASK-038, TASK-040 and TASK-034 (code) changes, and TASK-039's owner disposition is recorded and, if option B or C was chosen, its execution task is Verified (for C, the SHA is from the rewritten history); TASK-041 is merged if Kyle chose removal; the release run's check jobs on that SHA include the TASK-040 `cargo fmt` check, green.
- [ ] The release run (event `workflow_dispatch` or a `v<version>` tag push, not `pull_request`) has every check job green on `SOURCE_SHA` = the recorded SHA, every job's reported checked-out commit equals it, both audits produced a result (not 'NOT RUN'; `fail-on-outage` true on these events per TASK-027 r5), and the packaging job ran after them.
- [ ] TASK-023's state is recorded with the candidate: Verified (contained in the candidate SHA), closed Not Needed (with the TASK-011(a) evidence), or Deferred (with the window-close gap listed for Kyle's explicit acceptance in TASK-036).
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

## Changes in r5
- CI evidence now comes from the release run's own check jobs on `SOURCE_SHA` (TASK-027 r5 reusable `checks.yml`), with each job's checked-out commit recorded; a separate `ci.yml` push or dispatch run is no longer required, and a `pull_request` run never counts (owner-directed, 2026-10-22).
- Audit result: dispatch and tag release runs fail on an audit with no result (`fail-on-outage` input), so 'NOT RUN' cannot reach a candidate; the old re-dispatch-`ci.yml` workaround is removed.
- Step 2 and the acceptance criteria updated to match; prerequisite unchanged (TASK-027 is already in W1–W3).
- Independent review fixes: dispatch happens in step 1 before the run is recorded; duplicate "release run" and "Dispatch" wording removed; a re-run after an audit outage keeps the same SHA and version with a new run ID recorded.

## Changes in r6
- Prerequisites: the TASK-023 dependency changed from an implicit "Verified" (via "All W1–W3 tasks Verified" and the Notion relation) to "TASK-023 Verified, closed Not Needed with evidence, or still Deferred with the window-close gap explicitly accepted by Kyle in TASK-036", because Kyle deferred TASK-023 pending TASK-011(a) and the board has no way to record "Not Needed" as Verified (approved-task audit, MUST, process item).
- Acceptance: added a criterion recording TASK-023's state with the candidate (follows from the prerequisite change).
- Prerequisites name TASK-042, TASK-043 and TASK-044 (V1 work created by TASK-009 r3).
- Re-approval note: the "still Deferred, with the gap accepted by Kyle in TASK-036" route goes beyond the audit's "Verified or Not Needed with evidence" and lets a Release-Blocking: Yes task (TASK-023) stay unfixed for this build; Kyle should see this explicitly when he re-approves r6. Still open outside this card: the Notion 029→023 relation, 08 §A/§C.1 and 10a still say TASK-023 is expected (audit M3) (independent review (review4), reviewer C nits).

## Changes in r7
- Step 4 and acceptance: download the hashed EXE and `SHA256SUMS.txt` from the release run and keep them outside Actions, since dispatch/tag artifacts expire 30 days after the run (`release-installer.yml:116`) and W5 may run later (board review 2026-10-22).
- Prerequisites and approval evidence: added an explicit owner acknowledgement that the r6 route (`:50`) lets release-blocking TASK-023 stay Deferred/Not Needed at TASK-029 time (board review 2026-10-22).
- Prerequisites: TASK-042 and TASK-043 are prerequisites only when Kyle confirms TASK-009 r4 decision 1 (TASK-009 r4: without it they are not started); TASK-044 stays unconditional (decision 4) (board review re-check 2026-10-22).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: TASK-008/fmt prerequisite; CI evidence on exact SHA via push or workflow_dispatch with automatic `--fail-on-outage`; WebView2 field dropped from DoD; fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review (currency pass, 2026-10-22): two reviewers plus a re-check of the blocking fixes; READY at r4.
Independent review r5 (2026-10-22, owner-directed CI gate): CHANGES applied, re-check READY.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r6.
Board review (2026-10-22, against main 92e7980): CHANGES (artifact expiry before W5; implicit TASK-023 route); fixes folded in at r7. Independent re-check of r7 (two reviewers, 2026-10-22): blocking items applied; READY at r7.
