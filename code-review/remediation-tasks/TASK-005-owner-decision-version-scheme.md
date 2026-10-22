# TASK-005 — Owner decision: candidate version scheme

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Owner Decision |
| Audit priority | P1 (decision) |
| Roadmap lane | NA-2 / P0-06 (release) |
| Mandatory gate | Yes — before candidate |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-022 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | WIN-004 (linked) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd; .github/workflows/release-installer.yml:67-69 |
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
Every build is 0.1.0 (`apps/desktop/src-tauri/tauri.conf.json:4`, `Cargo.toml:3`); NSIS and Installed apps cannot distinguish candidates, and downgrade testing (gate ISSUE-042) is meaningless.

## Trigger / reproduction
N/A.

## Root cause / evidence
N/A.

## Options and consequences (owner decides)
(A) Bump to a new SemVer per candidate (0.1.1, 0.1.2…): simple, tag must match. (B) Pre-release suffix (0.2.0-rc.N): check NSIS/WiX version compatibility first. (C) Keep 0.1.0 and record commit SHA only: downgrade gate stays unverifiable. Knock-on for A/B (implemented by TASK-027): `tauri.conf.json:4`, `Cargo.toml:3`, `Cargo.lock`, `package-lock.json`, workspace `package.json` versions, the notices header/summary `appVersion` (`npm run notices`), and `producerVersion` in `packages/domain/test/fixtures/data-controls-wire.json`.

## Expected change scope
Decision only; TASK-027 implements.

## Out of scope
Implementation.

## Implementation approach
1. Present options.
2. Record decision.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None.

## Acceptance criteria (pass/fail)
- [ ] Scheme recorded with source as exactly one of options A–C (e.g. A: `0.1.1`; B: `0.2.0-rc.1`; C: keep `0.1.0`).

## Verification plan
Owner confirmation.

## Safety, rollback and side effects
None.

## Definition of done
Kyle's explicit choice recorded verbatim with date and source (trusted conversation or attributable Notion decision). Claude may prepare options but cannot decide, waive a gate, or infer approval.

## Independent review notes
Independent review (Block 3, 2026-10-22): CHANGES REQUIRED on r1. All listed corrections applied in r2 (see 08 index §H for the per-card list). Re-check by the approving reviewer recommended before execution.
