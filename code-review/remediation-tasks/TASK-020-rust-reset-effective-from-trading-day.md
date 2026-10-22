# TASK-020 — Fix: Rust enforces trading-day effective_from for resets and assignments

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-007 (persistence part) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | UI-010 |
| Source card / date | Stage 1 audit 2026-10-22 (03 UI-010; 05 F-07) |
| Wave | W2 |
| Effort / risk | S / Low–Medium |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r2 (2026-10-22; r1 + independent-review corrections) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
The reset dialog sends the calendar day as `effectiveFrom` and Rust `assign_in` checks only the date format, so a weekend or pre-reset day can be stored.

## Trigger / reproduction
Attempt reset after the reset time or at a weekend.

## Root cause / evidence
`apps/desktop/src/features/accounts/components/LifecycleDialogs.tsx:282-293`; `src-tauri/src/store/rulebooks.rs:829-835` (`assign_in`), `src-tauri/src/store/attempts.rs:262`.

## Expected change scope
`src-tauri/src/store/rulebooks.rs`, `src-tauri/src/store/attempts.rs`; Rust tests. **No wire change** (option b: reject a mismatched `effective_from`). Deliberate, reviewed edits to existing data that becomes invalid: `db/rulebook_tests.rs:266-270` (Saturday 2026-10-10) and `:296` (Sunday 2026-11-01), and the dev-tools seed `seed.rs:528`.

## Out of scope
Changing the `RulebookDecision` contract (option a); UI changes (TASK-021).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. In reset: require `effective_from == domain::trading_day(effective_at, tz, reset)` using the successor account's time zone and reset time; else Validation error naming the expected day.
3. In `assign_in`: reject Saturday/Sunday `effective_from`.
4. Tests: reset at 2026-10-24T15:00Z (Saturday) with effectiveFrom 2026-10-24 → validation error; with 2026-10-26 → ok.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: None with W1.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] Existing rulebook/attempt tests pass (`store/attempt_tests.rs`, `db/rulebook_editor_tests.rs`).
- [ ] Full Rust checks → exit 0.
- [ ] The edits to `db/rulebook_tests.rs:266-270, 296` and `seed.rs:528` are listed in the PR as deliberate and reviewed.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing data unaffected (validation on new writes only).

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
Use only disposable test journals and temporary directories created by tests. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. Do not edit shipped migrations, `test_csvimport/Performance.csv` or `src-tauri/src/db/fixtures/*.db`.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Independent review notes
Independent review (Block 3, 2026-10-22): CHANGES REQUIRED on r1. All listed corrections applied in r2 (see 08 index §H for the per-card list). Re-check by the approving reviewer recommended before execution.
