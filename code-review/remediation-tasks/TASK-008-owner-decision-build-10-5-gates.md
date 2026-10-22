# TASK-008 — Owner decisions: real-journal-copy upgrade gate and cargo fmt gate

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Owner Decision |
| Audit priority | Gate / decision |
| Roadmap lane | Build 10.5 gates (historical, V1) |
| Mandatory gate | Yes |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-052, ISSUE-053 (+ ISSUE-038) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-006 (linked) |
| Source card / date | docs/build-10-5-closeout.md:61,66 |
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
Build 10.5 left two gates: an owner-approved upgrade test on a copy of the real journal (never run) and `cargo fmt` (failed historically, not in CI).

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
Upgrade gate: (A) keep — run TASK-034 on an offline copy; (B) waive for owner-only V1. cargo fmt: (A) adopt — format crate in a dedicated task + CI step; (B) drop the gate. Choosing (A) for cargo fmt blocks TASK-029 until the fmt follow-up task is Verified. Choosing (A) for the upgrade gate makes TASK-034 the follow-up (its code change in W3c, before TASK-029; its owner run in W5).

## Expected change scope
Decisions only; TASK-034 executes the upgrade gate if kept.

## Out of scope
Running fmt; touching the real journal.

## Implementation approach
1. Present options for each.
2. Record decisions.
3. For a keep/adopt choice, create or name the follow-up task: the fmt task (new card, Triage card per CLAUDE.md) for cargo fmt; TASK-034 for the upgrade gate. If cargo fmt is adopted, mark TASK-029 Blocked until the fmt task is Verified.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Dependants: TASK-029 (candidate) — Blocked until the fmt follow-up task is Verified if cargo fmt is adopted; TASK-034 runs only if the upgrade gate is kept.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Both decisions recorded with source.
- [ ] Any run/keep/adopt choice creates a follow-up task. TASK-029 (fmt) is marked Blocked until the fmt task is Verified; the follow-up task ID and the Blocked state are recorded in the execution log. A kept upgrade gate names TASK-034 as its follow-up.
- [ ] Fixture rule: N/A (decision only; no checks run). Any later check run for this task keeps `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)**.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Changes in r3
- 10 §8.2 TASK-008 (G5, G10): added the criterion that any run/keep/adopt choice creates a follow-up task and TASK-029 (fmt) is marked Blocked until it is Verified; matching step 3 and Dependants line; kept upgrade gate names TASK-034.
- 10 §8.3 fixture rule: fixture line says `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: follow-up-task criterion with TASK-029 (fmt) Blocked until Verified (G5, G10); fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
