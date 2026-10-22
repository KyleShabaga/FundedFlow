# TASK-022 — Fix: unsaved-changes guard covers history navigation and programmatic navigate()

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | Unassigned (owner) |
| Mandatory gate | No |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-009 (history part) (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | UI-005, DATA-008 (navigation part) |
| Source card / date | Stage 1 audit 2026-10-22; specs docs/design/screens/13-rulebook.md:63, 14-daily-review.md:62-63 |
| Wave | W2 |
| Effort / risk | M / Medium |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | 4d4e66d (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 nits from 10 §8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 4d4e66d (HEAD at r3; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Back/forward (Alt+←, mouse back) and `navigate()` calls (Account switcher 'Manage accounts', shell Quick Import) leave a dirty trade review/daily review/rulebook draft without a prompt.

## Trigger / reproduction
Dirty editor + history/programmatic navigation.

## Root cause / evidence
`apps/desktop/src/features/shared/hooks/use-leave-guard.ts:20-48` handles only anchor clicks and beforeunload; `AccountSwitcher.tsx:68`, `app/AppShell.tsx:231` call `navigate()` directly.

## Expected change scope
`use-leave-guard.ts` (popstate/hashchange handling: re-push and ask), `AccountSwitcher.tsx`, `AppShell.tsx` (use `useGuardedNavigate`), tests.

## Out of scope
Native window close (TASK-023); migrating to a data router.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Route programmatic navigations through the existing `useGuardedNavigate`.
3. The app uses a declarative `HashRouter` and `popstate` cannot be cancelled: while dirty, intercept `hashchange`/`popstate`, restore the previous hash before the router re-renders (the named fallback, migrating to `unstable_HistoryRouter` with a blocking history, is **not authorized by approving this card**: it needs its own separate approval, and if the hash-restore approach fails the implementer stops and reports), then invoke the leave request.
4. Tests using the real `HashRouter`: dirty DailyReviewPage → `history.back()` and 'Manage accounts' each show the confirm dialog; the editor never unmounts (assert the same element instance and text) while the dialog is open; choosing to stay keeps text.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: `AccountSwitcher.tsx` with TASK-024.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] `npm run test -w @fundedflow/desktop -- src/features/journal src/features/daily-reviews src/features/rulebooks src/features/shared src/features/accounts src/app` → exit 0.
- [ ] Full root checks → exit 0.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check (the Rust fixture tests rewrite tracked fixtures whenever the variable is set, to any value); never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing guard tests: `journal/review-save-guard.test.tsx`, `trade-nav-guard.test.tsx`.

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
- The `unstable_HistoryRouter` fallback needs separate approval; approving this card does not authorize it (10 §8.3 TASK-022).
- Fixture rule: `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`) (10 §8.3).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.3): nits only — applied in r3.
Independent review r3 (2026-10-22): CHANGES on 012, 024, 026 (citations, test construction, scope lines); applied. READY.
