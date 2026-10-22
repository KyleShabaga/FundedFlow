# TASK-007 — Owner decisions: P0-05 cohort, P0-09 evidence, P0-10 studies, D5 wrappers

| Field | Value |
|---|---|
| Status | Proposed (r3; awaiting independent review) |
| Type | Owner Decision |
| Audit priority | Gate / decision |
| Roadmap lane | Final Push V1 |
| Mandatory gate | Yes — go/no-go inputs |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-047, ISSUE-048, ISSUE-055, ISSUE-056 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | N/A (existing gate/decision); TEST-008 (linked) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd (open baseline, 2026-10-22) |
| Wave | W0 |
| Effort / risk | S / Low |
| Verification platform | N/A |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Four Final Push items have no recorded disposition in the repository (grep finds 0 hits for P0-09/P0-10; D5 is ambiguous: `docs/design/window-support-matrix.md:26` vs `docs/architecture/prop-firm-collector.md:470`; P0-05 cohort: `docs/architecture/p0-04-csv-contracts.md:169`).

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
See steps; any 'run' choice creates a separate gate task. A 'run' or 'keep' choice for P0-05 (cohort) or P0-10 (studies) blocks TASK-035 until that follow-up task is Verified.

## Expected change scope
Record each decision; no code.

## Out of scope
Running studies; implementing wrappers.

## Implementation approach
1. For each item present options: P0-05 (run cohort / waive for owner-only V1); P0-09 (identify evidence location / declare missing); P0-10 (run / defer / waive); D5 (clarify which D5, then dispose).
2. Record each decision separately.
3. For every run/keep/adopt choice, create the follow-up task (proposed card, Triage card per CLAUDE.md) and mark TASK-035 Blocked until that follow-up is Verified; a waive/defer/declare-missing choice creates no follow-up.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Dependants: TASK-035 (evidence register) — Blocked while any P0-05 cohort or P0-10 studies follow-up task created here is not Verified.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Four decisions recorded, each Decided or explicitly Deferred with source; none inferred by Claude.
- [ ] Any run/keep/adopt choice creates a follow-up task. TASK-035 (cohort, studies) is marked Blocked until it is Verified; the follow-up task ID and the Blocked state are recorded in the execution log.
- [ ] Fixture rule: N/A (decision only; no checks run). Any later check run for this task keeps `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)**.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Changes in r3
- 10 §8.2 TASK-007 (G5, G10): added the criterion that any run/keep/adopt choice creates a follow-up task and TASK-035 (cohort, studies) is marked Blocked until it is Verified; matching step 3 and Dependants line.
- 10 §8.3 fixture rule: fixture line says `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).
- Source re-check at b01e2b9: P0-05 cohort citation corrected from `p0-04-csv-contracts.md:170` to `:169`.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: follow-up-task criterion with TASK-035 Blocked until Verified (G5, G10); fixture rule unset (not 0); P0-05 citation line fix.
