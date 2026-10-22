# TASK-033 — Gate: manual accessibility and window/DPI matrix on the candidate

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Verification |
| Audit priority | Gate |
| Roadmap lane | Build 26 §9 / P0-08 / NA-5 |
| Mandatory gate | Yes — ISSUE-045, ISSUE-046 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-045, ISSUE-046 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-007 (cross-ref); WIN-009 (linked) |
| Source card / date | docs/architecture/build-26-accessibility-journeys.md:227-238; docs/design/window-support-matrix.md |
| Wave | W5 |
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
NVDA with WebView2, contrast, 125/150% scaling, 200% zoom, reduced motion, native chooser focus and the D1–D11 window matrix have never been executed.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
Manual procedure; results only.

## Out of scope
Fixes (new tasks).

## Implementation approach
1. Verify the installer EXE SHA-256 against TASK-029's record, then run the §9 checklist and the window matrix on the candidate.
2. Record each row.

**Pass rule (r3, G9).** The gate is **Passed** only if every mandatory row below is run on the installed candidate and passes as defined in its source document. Any mandatory row that fails gives **Failed**; any not run (including missing hardware) gives **Blocked** or **Not Run**, never Passed, unless Kyle waives that row in writing in the execution log.
- Mandatory, `docs/architecture/build-26-accessibility-journeys.md` §9 (lines 231-237): visible focus in both themes; contrast in both themes; scaling 125% and 150% and zoom 200%; overflow and reflow at narrow widths; NVDA + WebView2 reading order, headings, landmarks, table headers and status announcements; native file chooser focus return; reduced motion. The §9 row "Native smoke and destructive cases in §8" (line 238) is covered on the same SHA by TASK-030 (non-destructive smoke) and TASK-032 scenario R0 (export → erase → restore round trip), not re-run here.
- Mandatory, `docs/design/window-support-matrix.md`: D1–D11 (D5 and W19 need a real ultrawide display and two monitors with different scaling) and W1–W10, W12, W14–W20.
- Record-only (not part of the pass rule): W11 (the matrix says "record limits, don't call it supported"); W13 is N/A in V1.
- Legal prompt: if the VM profile already holds an acceptance from an earlier build, the candidate shows the first-run agreement again after the upgrade (`apps/desktop/src/legal/index.ts:40-43`); expect this legal re-prompt; it is not a failure.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Every checklist/matrix row recorded with environment; gate state set by the pass rule above.
- [ ] The record names the tested source SHA and the installer EXE SHA-256, and the EXE's `Get-FileHash` matches TASK-029's `SHA256SUMS.txt` value.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
—

## Safety, rollback and side effects
Synthetic data.

## Definition of done
Gate state recorded Passed/Failed/Not Run/Blocked with source SHA, installer EXE SHA-256, environment (Windows build, WebView2 version), tester, date and evidence. A planning document or inferred result is not a pass.

## Changes in r3
- Added an explicit pass rule listing the mandatory §9 rows and matrix rows (D1–D11, W1–W10, W12, W14–W20) and the record-only rows (W11, W13) (10 §8.2 TASK-033; G9).
- Expect the legal re-prompt after an upgrade (10 §8.2 TASK-030/032/033; G9).
- Added the source SHA and the installer EXE SHA-256 to acceptance (10 §8.3 TASK-033 nit; G9).
- No V-023 claim on this card; V-023 is owned by TASK-028 (10 §8.1 §D; G2).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3 fixture nit).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: explicit pass rule with mandatory rows; legal re-prompt expected; source SHA and EXE SHA-256 in acceptance; fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
