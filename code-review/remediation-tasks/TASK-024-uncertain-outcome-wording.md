# TASK-024 — Fix: uncertain write outcomes are not reported as definite failures

| Field | Value |
|---|---|
| Status | Proposed |
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
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Toasts/dialogs say 'wasn't archived', 'wasn't restored', 'The trade wasn't restored', 'The active account wasn't changed' even when the error category is `uncertain-outcome`, contradicting the merged P0-03 rule.

## Trigger / reproduction
Timeout/`database`-kind error on those writes.

## Root cause / evidence
`apps/desktop/src/features/accounts/components/LifecycleDialogs.tsx:166,191`; `journal/components/TradeLogView.tsx:146`; `TradeDetailPage.tsx:270`; `accounts/components/AccountSwitcher.tsx:45`; `AccountActions.tsx:37`.

## Expected change scope
Those files; reuse the pattern in `journal/components/LibraryView.tsx:288-291` / `Screenshots.tsx:163`.

## Out of scope
Settings auto-acknowledge and daily-review acknowledge flow (ISSUE-011 rest, V1.1).

## Implementation approach
1. Branch on `error.category === 'uncertain-outcome'`: show 'may have been archived/restored/changed — check before trying again' with a link to the affected record.
2. Keep definite-failure wording for definite failures.
3. Tests: reject each with `FeatureDataError('uncertain-outcome')` → uncertain wording; with a definite failure → existing wording.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-021, TASK-022 (shared files merge order).
- Likely shared-file conflicts: `LifecycleDialogs.tsx`, `AccountSwitcher.tsx`.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] Uncertain-writes journeys pass: `npm run test:journeys -w @fundedflow/desktop` → exit 0.
- [ ] Full root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

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
