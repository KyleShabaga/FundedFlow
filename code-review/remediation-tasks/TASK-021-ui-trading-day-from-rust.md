# TASK-021 — Fix: UI uses the Rust trading day for 'in use' rulebook, badges and reset default

| Field | Value |
|---|---|
| Status | Ready for Approval (r4) |
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
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r4 (2026-10-22; r3 + approved-task audit fixes + owner amendment folded in) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 9430f2a (HEAD at r4; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
After the reset time and at weekends the UI shows the wrong rulebook version 'in use', risk claims come from that version (risk shows Unknown), and a false 'not today' badge appears.

## Trigger / reproduction
Every evening after the account reset and every weekend.

## Root cause / evidence
`apps/desktop/src/features/accounts/setup.ts:32-35` (`currentAssignment` uses `zonedDay`), `rulebooks/components/context.ts:15`, `CalculationExplanation.tsx:54-55`, `LifecycleDialogs.tsx:282-293` (the reset `effectiveFrom` is `zonedDay` of the selected `effectiveAt`, `:282-283`), `AssignDialog.tsx:30`, `features/accounts/components/presentation.tsx:73` (`useAccountFacts`, used by the Accounts list and Today, calls `currentAssignment` with `account.timezone`).

Staleness: the freshness read is cached with `asOf` = fetch time (`features/accounts/hooks/freshness.ts:37`). It re-reads only on focus/visibility, successful mutations, or the policy timer, which exists only where `useAccountFreshness` is mounted (`AccountSwitcher.tsx:25`) and is not armed when `nextChangeAt` is null (attention state or no records, `features/accounts/freshness.ts:126,147-150`). A window left open across the reset therefore keeps the old trading day.

## Expected change scope
Those files, including `features/accounts/components/presentation.tsx`; source the day from the existing `list_account_freshness` `currentTradingDay` (`apps/desktop/src/lib/data/freshness.ts`) or `facts.effectiveTradingDay` where loaded. For the reset dialog, the day comes from `freshnessGateway.list(asOf)` (`lib/data/freshness.ts:19-21`) with `asOf` = the selected `effectiveAt` (owner amendment). A small hook next to `features/accounts/hooks/freshness.ts` may be added for the `asOf` read.
Test boundary: `apps/desktop/src/test/boundaries.ts` (the `list_account_freshness` mock, `:26,43,63`, today returns `freshness: []` and ignores `asOf`) and the existing tests that rely on an in-use version once the fail-closed rule applies: `features/rulebooks/rulebooks.test.tsx:441-443`, `features/today/today.test.tsx`, `features/accounts/overview-cards.test.tsx`, `features/accounts/account-risk.test.tsx`, `journeys/workflows.journey.test.tsx` (seed freshness rows; do not weaken assertions). New tests (fake clock) in `features/accounts`, `features/rulebooks`, `features/today`.

## Out of scope
New Rust command/DTO; batched overview (ISSUE-014, V1.1); freshness adapter routing (ISSUE-016, V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Change `currentAssignment(assignments, tradingDay)` to take a trading day; update callers to pass the Rust trading day.
3. Badge: compare `snapshot.tradingDay` with the Rust trading day.
4. Reset dialog (owner amendment, 2026-10-22): the `effectiveFrom` sent with an Assign decision is the Rust trading day for the **selected** `effectiveAt`, read through the existing freshness `asOf` support (`list_account_freshness(asOf = effectiveAt)`, `currentTradingDay` of this account's row); no TypeScript calendar maths. It is recomputed whenever `effectiveAt` (or the account) changes; a response for an earlier `effectiveAt` is ignored (key the read by `[accountId, asOf]`, separate from `accountFreshnessKey`). While the value is unresolved (loading, error, no row) or outdated (not for the current `effectiveAt`), submitting the Assign decision is blocked with the existing `Button disabledReason`; the unresolved state shows the existing `StatusIndicator status="unknown"`. Under TASK-020's strict equality, today's trading day is wrong for a backdated reset, so this is the only accepted source. The block applies only to the Assign decision: "Decide later" (`LifecycleDialogs.tsx:442`) sends no `effectiveFrom` and stays submittable while the day is unresolved (recommended, because it sends no date; Kyle confirms it when re-approving this revision).
5. Fake-clock tests at 2026-10-23T22:30Z (America/New_York, reset 17:00) and Saturday noon → assignment effective 2026-10-26 is 'in use'; no false badge.
6. Fail closed: if the Rust trading day (freshness) is unavailable, show 'unknown' rather than falling back to `zonedDay`.
6a. Boundary re-read: wherever the Rust trading day is used for 'in use', the badge or a default, re-read freshness at the row's `nextTradingDayStart` (a timer that does not depend on `nextChangeAt` or on `AccountSwitcher` being mounted), so an open window crosses the reset without a focus event.
6b. Test boundary: change the `list_account_freshness` mock in `test/boundaries.ts` to answer per `asOf` from a lookup table of fixed rows (no trading-day computation in TypeScript, CLAUDE.md parity rule), with a way to defer an answer so out-of-order responses can be tested. Seed rows in the existing tests listed in scope that need an in-use version.
7. AssignDialog's default effective date comes from the Rust trading day and is never a weekend (today it is `zonedDay(...)`, `AssignDialog.tsx:30, 36`); the existing weekend rejection at `:48` stays.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-020.
- Likely shared-file conflicts: `LifecycleDialogs.tsx` with TASK-024; `test/boundaries.ts` with TASK-015 (option A); a new hook next to `features/accounts/hooks/freshness.ts`, which `AccountSwitcher.tsx` (TASK-022, TASK-024) imports.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] Reset dialog, backdated (owner amendment): with the clock on a weekday and `effectiveAt` set to an earlier date, the decision sent carries the mocked Rust `currentTradingDay` for that `asOf`, not today's trading day; the mock records the `asOf` it was called with.
- [ ] Reset dialog, edits and weekend (owner amendment): changing `effectiveAt` across the reset time, and to a Saturday, re-reads with the new `asOf` and sends the new mocked day (the following trading day / Monday).
- [ ] Reset dialog, out of order (owner amendment): when the response for an earlier `effectiveAt` resolves after the response for the current one, the current one wins.
- [ ] Reset dialog, blocked submit (owner amendment): while the trading day for the current `effectiveAt` is unresolved (pending, error, no row) or outdated, the Assign decision cannot be submitted and the reason is shown.
- [ ] Boundary re-read: with a fake clock and no focus or visibility event, crossing the mocked `nextTradingDayStart` triggers a new freshness read, and 'in use' and the badge follow the new mocked `currentTradingDay`.
- [ ] Reset dialog default at the boundary (fake clock, America/New_York, reset 17:00): at 2026-10-23T22:30Z (Friday after reset) the default `effectiveFrom` is the Rust trading day 2026-10-26, not 2026-10-23; just before the reset it is 2026-10-23.
- [ ] Freshness unavailable (`list_account_freshness` errors or has no entry for the account): 'in use', the badge and the reset default show the 'unknown' state; a test asserts no `zonedDay` fallback value is rendered.
- [ ] AssignDialog never defaults to a Saturday or Sunday: a fake-clock test on a Saturday asserts the default "First trading day" is the Rust trading day (the following Monday), and that submitting a Saturday is still rejected with the weekday message (`AssignDialog.tsx:48`). The field stays a native date input (`AssignDialog.tsx:82`); no custom picker is in scope.
- [ ] Repository root: `npm run test -w @fundedflow/desktop -- src/features/rulebooks src/features/accounts src/features/today` → exit 0.
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

## Changes in r4
- Owner amendment, 2026-10-22 (previously only on the Notion card) folded into step 4: the reset `effectiveFrom` is the Rust trading day for the selected `effectiveAt` through the existing freshness `asOf` read, recomputed after edits, and an unresolved or outdated value blocks submission. Reason: audit MUST (traceability).
- Removed the alternative "(or let TASK-020's validation message guide the user)", which the amendment rejects. Reason: audit MUST / owner amendment.
- Added acceptance criteria for the amendment's backdated, boundary/weekend-edit, out-of-order and blocked-submit cases. Reason: audit MUST / owner amendment.
- Added `test/boundaries.ts` (an `asOf`-aware, deferrable lookup-table mock) and the existing tests that need seeded freshness rows to scope (step 6b). Reason: audit SHOULD (the mock returns `[]` and ignores `asOf`).
- Added a re-read at `nextTradingDayStart` (step 6a) with a fake-clock criterion that needs no focus event. Reason: audit SHOULD (`hooks/freshness.ts:37`, `features/accounts/freshness.ts:126,147-150`).
- Added `features/accounts/components/presentation.tsx:73` to root cause and scope, and `src/features/today` to the targeted test command. Reason: audit SHOULD.
- Noted the shared-file risks with TASK-015 (`test/boundaries.ts`) and TASK-022/024 (freshness hook). Reason: audit cross-task note.
- Baseline row: stale `a7310fd (HEAD)` replaced with `9430f2a (HEAD at r4; application source unchanged)` (independent review (review4), reviewer B nit).
- Step 4: stated that "Decide later" stays submittable while the trading day is unresolved (independent review (review4), reviewer B nit; audit NIT).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: tests for reset-dialog boundary default, unknown state without freshness, no weekend dates in AssignDialog (G10); fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r4.
