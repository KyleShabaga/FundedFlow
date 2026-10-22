# TASK-009 — Owner decisions: fees, duplicate collapse, ledger UI, recovery-copy retention, archive format

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Owner Decision |
| Audit priority | P2 (decisions; V1.1 inputs) |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-034, ISSUE-035, ISSUE-037, ISSUE-018 (D-RET), ISSUE-004/002 (D-ARCH), ISSUE-021 (optional input) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TSD-008, DATA-020, UI-020, DATA-012 (linked) |
| Source card / date | Stage 1 audit 2026-10-22; CLAUDE.md money rules |
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
Policies that determine V1.1 work: blank manual fees stored as 0 (`src-tauri/src/domain.rs:330-331`); identical ID-less CSV rows collapse (`src-tauri/src/csv_import/dedup.rs:11-13`); no ledger-entry UI while `CalculationSettings.tsx:14-15` asks about ledger completeness; recovery copies keep deleted-account data; whether archive format may change to export without missing attachments or larger caps.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
Fees: keep 0 + coverage statement / nullable 'fees unknown' (migration, V1.1). Dedup: keep / add override. Ledger UI: V1 / V1.1 / remove the settings question. Retention: accept disclosed retention / add pruning (V1.1). Archive format: keep v1 strict / v1.1 with missing-attachment manifest. Optional: export/restore to UNC/network paths (ISSUE-021, V1.1 path validator) — allow / reject network paths.

## Expected change scope
Decisions only.

## Out of scope
Any implementation (V1.1).

## Implementation approach
1. Present each option set.
2. Record each decision (or explicit deferral).

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Five decisions (plus the optional ISSUE-021 network-path question) recorded or explicitly deferred with source.

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
