# TASK-002 — Owner decision: provenance of test_csvimport CSV files

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Owner Decision |
| Audit priority | P1 (decision) |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | Yes — before any tag/candidate |
| Severity | Informational |
| Confidence | Low (provenance unknown) |
| Canonical issue | ISSUE-036 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TR-020 |
| Source card / date | Stage 1 audit 2026-10-22 (02 TR-020; Phase 1 R-19) |
| Wave | W0 |
| Effort / risk | S / Low |
| Verification platform | N/A |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Determine whether `test_csvimport/Performance.csv`, `Performance Oct 20.csv` and `Performance Oct 20(1).csv` are real trade exports in a source-available repository (`README.md:118` says `Performance.csv` must stay unedited; the other two are unreferenced). Rows were deliberately not read by the audit.

## Trigger / reproduction
Repository is published or shared.

## Root cause / evidence
Unknown.

## Options and consequences (owner decides)
(A) Synthetic — no action. (B) Real — anonymise/remove copies; decide whether git history must be rewritten (owner-only, destructive).

## Expected change scope
No code in this task. If real: follow-up task(s) to anonymise/remove the unreferenced copies and decide on history rewrite; `Performance.csv` changes need explicit approval because Rust tests read it.

## Out of scope
Editing fixtures; history rewrite.

## Implementation approach
1. Ask Kyle whether the three files are synthetic or real exports.
2. Record the answer; if real, list follow-ups.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: Fixture `test_csvimport/Performance.csv` (Rust tests).

## Acceptance criteria (pass/fail)
- [ ] Decision recorded with source.
- [ ] If real: follow-up tasks created and W4 (TASK-029) blocked until handled.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
Do not print or copy CSV rows.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.
