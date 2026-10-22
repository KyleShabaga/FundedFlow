# TASK-003 — Owner decision: authority for stored risk verdicts (TS engine vs Rust)

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Owner Decision |
| Audit priority | P1 (decision) |
| Roadmap lane | P0-02 / Build 16 (merged) — governance |
| Mandatory gate | No |
| Severity | Medium (governance) |
| Confidence | High |
| Canonical issue | ISSUE-012 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | UI-002 |
| Source card / date | docs/handoffs/build-16.md:11,83; src-tauri/src/store/risk_promotion.rs:1-15; Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd |
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
Stored risk status/figures are computed by the TypeScript engine (`apps/desktop/src/lib/data/calculate-risk.ts:66-77`); Rust verifies consistency and source freshness only (`src-tauri/src/store/snapshots.rs:407-458`). CLAUDE.md and `docs/architecture/packages.md:126` say Rust is authoritative for stored calculations.

## Trigger / reproduction
N/A.

## Root cause / evidence
Deliberate Build 16 design not reflected in the project rule; verdict logic has no second implementation.

## Options and consequences (owner decides)
(A) TS engine is the authority for risk verdicts: amend CLAUDE.md/packages.md; keep arithmetic parity fixtures; optional verdict golden fixtures in V1.1. (B) Rust must be authoritative: requires a Rust verdict implementation (L) — V1.1+; V1 keeps current behaviour documented as an exception. Either choice also decides whether ISSUE-002c (frozen trade copies) may be redesigned.

## Expected change scope
Decision only; documentation follows in TASK-004.

## Out of scope
Implementing Rust verdict fixtures (deferred, V1.1).

## Implementation approach
1. Present options and consequences.
2. Record Kyle's decision.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Decision recorded verbatim with date/source.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.
