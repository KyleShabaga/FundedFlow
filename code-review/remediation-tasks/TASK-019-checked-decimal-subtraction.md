# TASK-019 — Fix (optional pull-in): checked Decimal subtraction in P&L and planned risk

| Field | Value |
|---|---|
| Status | Ready for Approval |
| Type | Fix |
| Audit priority | P2 (recommended pull-in to W1) |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium/Low |
| Confidence | High |
| Canonical issue | ISSUE-008 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TR-002, TR-003 |
| Source card / date | Stage 1 audit 2026-10-22 (02 TR-002/003; 05 F-08) |
| Wave | W1 (optional) |
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
`(entry - stop).abs()` (`src-tauri/src/store/reviews.rs:530`) and `(exit - t.entry_price)` (`src-tauri/src/domain.rs:410`) panic on overflow; a stored review with ~29-digit planned prices panics on every later review/Insights read; `rederive_account` (`store/trades.rs:625-670`) can block an account currency change.

## Trigger / reproduction
Extreme prices entered or present in a restored archive.

## Root cause / evidence
Unchecked rust_decimal `Sub`.

## Expected change scope
`src-tauri/src/store/reviews.rs` (`risk_from_plan`), `src-tauri/src/domain.rs` (`realized_pnl`); tests in-file / `store/journal_review_tests.rs`.

## Out of scope
Bounded price validation (behaviour change for CSV imports; V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Use `checked_sub`; on overflow return `None` (risk) or the existing 'P&L is too large to store' error (trade).
3. Tests: review saved with entry `79228162514264337593543950335`, stop `-1` → `get_trade_review` returns `risk: None`, no panic; trade create with such prices → validation error.

## Prerequisites, dependencies and conflicts
- Prerequisites: None (independent; recommended alongside W1).
- Likely shared-file conflicts: None in W1 files.

## Acceptance criteria (pass/fail)
- [ ] New tests pass and panic before the change.
- [ ] Full Rust checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
`domain.rs` tests, `insights_tests.rs`, `journal_review_tests.rs`.

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
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
