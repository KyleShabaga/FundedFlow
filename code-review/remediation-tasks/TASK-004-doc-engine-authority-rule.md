# TASK-004 — Document the engine-authority decision in CLAUDE.md and packages.md

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Documentation |
| Audit priority | P1 |
| Roadmap lane | P0-02 / Build 16 (governance) |
| Mandatory gate | No |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-012 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | UI-002 |
| Source card / date | As TASK-003 |
| Wave | W0 |
| Effort / risk | S / Low |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Make the project rule match the decided authority so future work is not misdirected.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Expected change scope
`CLAUDE.md` ("Rust is authoritative for stored calculations" bullet); `docs/architecture/packages.md` §Parity fixtures (~line 126) and §Financial evidence.

## Out of scope
Code; fixtures.

## Implementation approach
1. Apply wording reflecting TASK-003's decision; cite `docs/handoffs/build-16.md` and `src-tauri/src/store/risk_promotion.rs:1-15`.
2. State explicitly which calculations are TS-authoritative and which parity fixtures pin them (`packages/domain/test/fixtures/engine-math.json` is Rust-generated; `engine-contract.json` is TS-generated).

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-003.
- Likely shared-file conflicts: CLAUDE.md (any other doc task).

## Acceptance criteria (pass/fail)
- [ ] CLAUDE.md and packages.md state the decided authority; every cited path/line exists at the merge SHA.
- [ ] Repository root: `npm test` still exits 0 (docs only; sanity).

## Verification plan
Review the diff against cited sources.

## Safety, rollback and side effects
None.

## Definition of done
Documents updated; every factual statement checked against the cited source (file:line/workflow line) at the recorded SHA; reviewed.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
