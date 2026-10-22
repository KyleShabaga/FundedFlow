# TASK-021 — Fix: UI uses the Rust trading day for 'in use' rulebook, badges and reset default

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-007 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | UI-001, UI-009, UI-010 (UI part) |
| Source card / date | Stage 1 audit 2026-10-22 (03; 05 F-07) |
| Wave | W2 |
| Effort / risk | M / Medium |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
After the reset time and at weekends the UI shows the wrong rulebook version 'in use', risk claims come from that version (risk shows Unknown), and a false 'not today' badge appears.

## Trigger / reproduction
Every evening after the account reset and every weekend.

## Root cause / evidence
`apps/desktop/src/features/accounts/setup.ts:32-35` (`currentAssignment` uses `zonedDay`), `rulebooks/components/context.ts:15`, `CalculationExplanation.tsx:54-55`, `LifecycleDialogs.tsx:282-293`, `AssignDialog.tsx:30`.

## Expected change scope
Those files; source the day from the existing `list_account_freshness` `currentTradingDay` (`apps/desktop/src/lib/data/freshness.ts`) or `facts.effectiveTradingDay` where loaded; tests (fake clock) in `features/accounts`, `features/rulebooks`.

## Out of scope
New Rust command/DTO; batched overview (ISSUE-014, V1.1); freshness adapter routing (ISSUE-016, V1.1).

## Implementation approach
1. Change `currentAssignment(assignments, tradingDay)` to take a trading day; update callers to pass the Rust trading day.
2. Badge: compare `snapshot.tradingDay` with the Rust trading day.
3. Reset dialog: derive default `effectiveFrom` from the Rust trading day (or let TASK-020's validation message guide the user).
4. Fake-clock tests at 2026-10-23T22:30Z (America/New_York, reset 17:00) and Saturday noon → assignment effective 2026-10-26 is 'in use'; no false badge.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-020.
- Likely shared-file conflicts: `LifecycleDialogs.tsx` with TASK-024.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] `apps/desktop`: `npm run test -w @fundedflow/desktop -- src/features/rulebooks` → exit 0.
- [ ] Full root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing `rulebooks.test.tsx:443`.

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
UI-only; no data writes beyond existing commands.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.
