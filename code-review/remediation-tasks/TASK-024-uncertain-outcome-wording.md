# TASK-024 — Fix: uncertain write outcomes are not reported as definite failures

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Fix |
| Audit priority | P1 (wording only) |
| Roadmap lane | Unassigned (owner); P0-03 rule (merged) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-011 (wording part) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | UI-004, UI-003 (toast wording only) |
| Source card / date | Stage 1 audit 2026-10-22 (03; 06 §3) |
| Wave | W2 |
| Effort / risk | S / Low |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 4d4e66d (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 nits from 10 §8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 4d4e66d (HEAD at r3; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Toasts/dialogs say 'wasn't archived', 'wasn't restored', 'The trade wasn't restored', 'The active account wasn't changed' even when the error category is `uncertain-outcome`, contradicting the merged P0-03 rule.

## Trigger / reproduction
Timeout/`database`-kind error on those writes.

## Root cause / evidence
`apps/desktop/src/features/accounts/components/LifecycleDialogs.tsx:166,191`; `journal/components/TradeLogView.tsx:146`; `TradeDetailPage.tsx:270`; `accounts/components/AccountSwitcher.tsx:45`; `AccountActions.tsx:37`.

## Expected change scope
Those files; reuse the pattern in `journal/components/LibraryView.tsx:287-293` / `Screenshots.tsx:163`.

## Out of scope
Settings auto-acknowledge and daily-review acknowledge flow (ISSUE-011 rest, V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Branch on `error.category === 'uncertain-outcome'`: show 'may have been archived/restored/changed — check before trying again' and say where to check (the page or list that shows the record), as `journal/components/LibraryView.tsx:287-293` does ("check the library on this page"). No link to the record is added; that is out of scope.
3. Keep definite-failure wording for definite failures.
4. Tests: reject each with `FeatureDataError('uncertain-outcome')` → uncertain wording; with a definite failure → existing wording.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-021, TASK-022 (shared files merge order).
- Likely shared-file conflicts: `LifecycleDialogs.tsx`, `AccountSwitcher.tsx`.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] Uncertain-writes journeys pass: `npm run test:journeys -w @fundedflow/desktop` → exit 0.
- [ ] Full root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check (the Rust fixture tests rewrite tracked fixtures whenever the variable is set, to any value); never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
—

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
UI-only.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- Dropped "with a link to the affected record": the message says where to check, following the existing `LibraryView.tsx:287-293` wording; a record link is out of scope (10 §8.3 TASK-024).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.3): nits only — applied in r3.
Independent review r3 (2026-10-22): CHANGES on 012, 024, 026 (citations, test construction, scope lines); applied. READY.
