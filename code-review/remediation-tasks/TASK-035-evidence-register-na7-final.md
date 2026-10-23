# TASK-035 — Documentation/gate: final evidence register and NA-7 release notes

| Field | Value |
|---|---|
| Status | Ready for Approval (r4) |
| Type | Documentation |
| Audit priority | Gate |
| Roadmap lane | NA-7 |
| Mandatory gate | Yes — ISSUE-049 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-049 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | N/A (existing gate/decision) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd; docs/build-26.75-evidence.md:145-166 |
| Wave | W6 |
| Effort / risk | S / Low |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 4d4e66d (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 4d4e66d (HEAD at r3; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
NA-7 notes are stale; the final evidence register must reflect the actual candidate and gate results.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
Evidence register document and NA-7 notes.

## Out of scope
—

## Implementation approach
1. Compile gate states from TASK-029..034 and decisions TASK-001..011, and add the register rows TASK-036 step 1 presents (each with state and source; a missing item is shown as missing, never assumed):
   - TASK-023 state: Verified (contained in the candidate SHA), closed Not Needed with the TASK-011(a) evidence, or Deferred with the window-close gap (ISSUE-009) listed for Kyle's explicit acceptance in TASK-036 (TASK-029 (r6 or later)).
   - TASK-007 dispositions: P0-05 waived (owner-only), P0-09 with link to existing reconciliation evidence, P0-10 deferred, D5 closed (as approved in TASK-007).
   - TASK-010 outcome: whether ISSUE-002 was escalated to P0 (with the TASK-010 evidence).
   - TASK-030 R1 (owner-run real-export import, counts by kind only): present only while the TASK-007 r4 condition on the P0-05 waiver is approved; otherwise the row records "not required (TASK-007 condition not approved)".
   - TASK-037, TASK-038, TASK-039 (with Kyle's separate disposition and, for option B or C, its execution task state), TASK-040, TASK-041 (with Kyle's ruling: remove, or accept as residual low-risk), TASK-042 and TASK-043 (when Kyle confirmed TASK-009 r4 decision 1; otherwise each row records "not started: TASK-009 r4 decision 1 not confirmed") and TASK-044: state, and for code tasks whether the change is contained in the candidate SHA.
2. Finalize NA-7 against observed candidate behaviour.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-029..TASK-034 (TASK-034 is unconditional: TASK-008 decided Option A, gate kept).
- Likely shared-file conflicts: Docs only.

## Acceptance criteria (pass/fail)
- [ ] Every gate row has state, source SHA, installer EXE SHA-256, environment and evidence link; NA-7 statements match observed behaviour.
- [ ] Every row's source SHA and installer SHA-256 equal the candidate recorded by TASK-029 (from `SHA256SUMS.txt`, not the artifact ZIP digest); a row from a different build is marked as such and does not count toward the gate. Decision and verification rows (TASK-001..011) record the installer hash as N/A.
- [ ] The register contains the TASK-023 state row, the TASK-007 dispositions row (P0-05 waived, P0-09 with its reconciliation evidence link, P0-10 deferred, D5 closed), the TASK-010 outcome row (ISSUE-002 escalated or not), the TASK-030 R1 row (or its "not required" entry) and one row each for TASK-037 to TASK-044 (TASK-042/043 as "not started" if TASK-009 r4 decision 1 was not confirmed), as listed in step 1, matching the inputs of TASK-036 step 1.

## Verification plan
Reviewer.

## Safety, rollback and side effects
Docs only.

## Definition of done
Documents updated; every factual statement checked against the cited source (file:line/workflow line) at the recorded SHA; reviewed.

## Changes in r3
- Acceptance now requires each row's source SHA and installer SHA-256 to match the TASK-029 candidate (10 §8.3 TASK-033/035).

## Changes in r4
- Prerequisites: TASK-034 is unconditional (TASK-008 decided A), replacing "TASK-034 if kept" (board review 2026-10-22).
- Step 1 and acceptance: decisions range TASK-001..009 corrected to TASK-001..011, matching TASK-036 step 1 (board review 2026-10-22).
- Step 1 and a new acceptance criterion: register rows added for the TASK-023 state (Verified / Deferred / Not Needed with TASK-011(a) evidence), TASK-030 R1 (conditional on TASK-007) and TASK-037–044, matching TASK-036 step 1 (board review 2026-10-22).
- Step 1 and the register criterion: added the TASK-007 dispositions row (P0-05 waived, P0-09 linked to existing reconciliation evidence, P0-10 deferred, D5 closed) and the TASK-010 outcome row, both inputs of TASK-036 step 1; TASK-042/043 rows are conditional on Kyle confirming TASK-009 r4 decision 1; TASK-029 cited as "(r6 or later)" as in TASK-036; "Decision rows" reworded to "Decision and verification rows" (TASK-010/011 are verification tasks) (board review re-check 2026-10-22).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.3): nits only — applied in r3.
Independent review r3 (2026-10-22): CHANGES on 012, 024, 026 (citations, test construction, scope lines); applied. READY.
Board review (2026-10-22, against main 92e7980): CHANGES REQUESTED (stale TASK-034 condition, decision range, missing register rows); fixes folded in at r4. Independent re-check of r4: pending.
