# TASK-007 — Owner decisions: P0-05 cohort, P0-09 evidence, P0-10 studies, D5 wrappers

| Field | Value |
|---|---|
| Status | Ready for Approval |
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
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Four Final Push items have no recorded disposition in the repository (grep finds 0 hits for P0-09/P0-10; D5 is ambiguous: `docs/design/window-support-matrix.md:26` vs `docs/architecture/prop-firm-collector.md:470`; P0-05 cohort: `docs/architecture/p0-04-csv-contracts.md:170`).

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
See steps; any 'run' choice creates a separate gate task.

## Expected change scope
Record each decision; no code.

## Out of scope
Running studies; implementing wrappers.

## Implementation approach
1. For each item present options: P0-05 (run cohort / waive for owner-only V1); P0-09 (identify evidence location / declare missing); P0-10 (run / defer / waive); D5 (clarify which D5, then dispose).
2. Record each decision separately.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Four decisions recorded, each Decided or explicitly Deferred with source; none inferred by Claude.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
