# TASK-029 — Gate: build and record the release candidate (CI green, advisory result, EXE SHA-256)

| Field | Value |
|---|---|
| Status | Ready for Approval |
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
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
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
No code. Choose the final SHA after W1–W3 merge; confirm green `ci.yml` on that exact SHA; read the dependency-audit job summary for 'NOT RUN' (or dispatch with `--fail-on-outage`); dispatch the release workflow; record run ID, version, toolchain, artifact name/expiry and the EXE SHA-256 from `SHA256SUMS.txt` (not the artifact ZIP digest); during the build confirm the dev-tools dist check line and, if possible, that the binary lacks `dev_reset_handoff`/`dev_seed_fake_data` strings.

## Out of scope
Installing (TASK-030).

## Implementation approach
1. Record final SHA.
2. Record CI run URL/result.
3. Record advisory result text.
4. Dispatch release; download artifact; `Get-FileHash` the EXE; compare with SHA256SUMS.txt.
5. Record all fields in the evidence register.

## Prerequisites, dependencies and conflicts
- Prerequisites: All W1–W3 tasks Verified (incl. TASK-025, TASK-026, TASK-027); TASK-001, TASK-002, TASK-005, TASK-006 decided.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Evidence register row complete: SHA, CI run, advisory result (not 'NOT RUN'), release run, version, EXE SHA-256 (matches SHA256SUMS.txt), artifact expiry ≥ 30 days.

## Verification plan
—

## Safety, rollback and side effects
No user data.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
