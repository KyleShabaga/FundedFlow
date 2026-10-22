# TASK-029 — Gate: build and record the release candidate (CI green, advisory result, EXE SHA-256)

| Field | Value |
|---|---|
| Status | Proposed (r3; awaiting independent review) |
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
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
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
No code. Choose the final SHA after W1–W3 merge; confirm a green `ci.yml` run on that exact SHA from a push to `main` or a `workflow_dispatch` (the run's head SHA equals the recorded SHA; a `pull_request` run does not count, because it tests GitHub's temporary merge commit, not the SHA). Read the dependency-audit job summary for 'NOT RUN': on a push run an outage is only a warning and the job stays green, so if either audit says 'NOT RUN', run `ci.yml` by `workflow_dispatch` while `main`'s head is still the recorded SHA. On `workflow_dispatch` (and `schedule`) `--fail-on-outage` is applied automatically (`ci.yml:109, 124`); the workflow has no inputs (`ci.yml:11`), so the flag cannot be passed in. Dispatch the release workflow; record run ID, version, toolchain, artifact name/expiry and the EXE SHA-256 from `SHA256SUMS.txt` (not the artifact ZIP digest); during the build confirm the dev-tools dist check line and, if possible, that the binary lacks `dev_reset_handoff`/`dev_seed_fake_data` strings.

## Out of scope
Installing (TASK-030).

## Implementation approach
1. Record final SHA.
2. Record CI run URL/result, its event (`push` or `workflow_dispatch`) and its head SHA.
3. Record advisory result text.
4. Dispatch release; download artifact; `Get-FileHash` the EXE; compare with SHA256SUMS.txt.
5. Record all fields in the evidence register.

## Prerequisites, dependencies and conflicts
- Prerequisites: All W1–W3 tasks Verified (incl. TASK-025, TASK-026, TASK-027); TASK-001, TASK-002, TASK-005, TASK-006 decided; TASK-008 decided; the fmt task Verified if the `cargo fmt` gate is kept (G5).
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Evidence register row complete: SHA, CI run, advisory result (not 'NOT RUN'), release run, version, EXE SHA-256 (matches SHA256SUMS.txt), artifact expiry ≥ 30 days.
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
- CI evidence: a `push`-to-`main` or `workflow_dispatch` run on the exact SHA, not a PR merge commit; `--fail-on-outage` is applied automatically on dispatch (`ci.yml:109, 124`, verified at b01e2b9) and cannot be passed in (no `workflow_dispatch` inputs, `ci.yml:11`); added a matching acceptance criterion (10 §8.2 TASK-029; G14).
- Dropped the WebView2 field from the Definition of Done (10 §8.2 TASK-029; G14).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: TASK-008/fmt prerequisite; CI evidence on exact SHA via push or workflow_dispatch with automatic `--fail-on-outage`; WebView2 field dropped from DoD; fixture rule unset (not 0).
