# TASK-021 — Fix: UI uses the Rust trading day for 'in use' rulebook, badges and reset default

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
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
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
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
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Change `currentAssignment(assignments, tradingDay)` to take a trading day; update callers to pass the Rust trading day.
3. Badge: compare `snapshot.tradingDay` with the Rust trading day.
4. Reset dialog: derive default `effectiveFrom` from the Rust trading day (or let TASK-020's validation message guide the user).
5. Fake-clock tests at 2026-10-23T22:30Z (America/New_York, reset 17:00) and Saturday noon → assignment effective 2026-10-26 is 'in use'; no false badge.
6. Fail closed: if the Rust trading day (freshness) is unavailable, show 'unknown' rather than falling back to `zonedDay`.
7. AssignDialog's default effective date comes from the Rust trading day and is never a weekend (today it is `zonedDay(...)`, `AssignDialog.tsx:30, 36`); the existing weekend rejection at `:48` stays.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-020.
- Likely shared-file conflicts: `LifecycleDialogs.tsx` with TASK-024.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] Reset dialog default at the boundary (fake clock, America/New_York, reset 17:00): at 2026-10-23T22:30Z (Friday after reset) the default `effectiveFrom` is the Rust trading day 2026-10-26, not 2026-10-23; just before the reset it is 2026-10-23.
- [ ] Freshness unavailable (`list_account_freshness` errors or has no entry for the account): 'in use', the badge and the reset default show the 'unknown' state; a test asserts no `zonedDay` fallback value is rendered.
- [ ] AssignDialog never defaults to a Saturday or Sunday: a fake-clock test on a Saturday asserts the default "First trading day" is the Rust trading day (the following Monday), and that submitting a Saturday is still rejected with the weekday message (`AssignDialog.tsx:48`). The field stays a native date input (`AssignDialog.tsx:82`); no custom picker is in scope.
- [ ] Repository root: `npm run test -w @fundedflow/desktop -- src/features/rulebooks src/features/accounts` → exit 0.
- [ ] Full root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

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

## Changes in r3
- 10 §8.2 TASK-021 (G10): added acceptance tests for the reset-dialog default at the reset boundary (step 4), the 'unknown' state when freshness is unavailable (step 6) and no weekend dates in AssignDialog (step 7).
- 10 §8.3 fixture rule: fixture line says `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).
- r3 review fix: the AssignDialog criterion now tests the default date and the existing weekend rejection, because the field is a native date input (independent r3 review).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: tests for reset-dialog boundary default, unknown state without freshness, no weekend dates in AssignDialog (G10); fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
