# TASK-022 — Fix: unsaved-changes guard covers history navigation and programmatic navigate()

| Field | Value |
|---|---|
| Status | Ready for Approval (r5) |
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
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r5 (2026-10-22; r4 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 4d4e66d (HEAD at r3; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Back/forward (Alt+←, mouse back) and `navigate()` calls (Account switcher 'Manage accounts', shell Quick Import) leave a dirty trade review/daily review/rulebook draft without a prompt.

## Trigger / reproduction
Dirty editor + history/programmatic navigation.

## Root cause / evidence
`apps/desktop/src/features/shared/hooks/use-leave-guard.ts:20-48` handles only anchor clicks and beforeunload; `AccountSwitcher.tsx:68`, `app/AppShell.tsx:231` call `navigate()` directly, and so does the trades table on the dirty daily review (`features/daily-reviews/components/DailyReviewPage.tsx:513`, `onRowClick → navigate(tradePath(...))`; DataTable rows call a callback, not an anchor, so the click guard misses them).

Router mechanics (react-router-dom 7.18.4, the version in `package-lock.json`): the app uses a declarative `HashRouter` (`app/AppProviders.tsx:20`). At mount it subscribes through `history.listen`, which adds a bubble-phase `popstate` listener on `window` (no `hashchange` listener) reads the location from the URL and computes the delta from `history.state.idx`. So `hashchange` arrives too late, a normal `popstate` listener added when the form becomes dirty runs after the router's listener, and re-pushing an entry (`pushState`) truncates forward history and writes an entry without the router's `idx`, desyncing its index while the editor stays mounted (approved-task audit E, jsdom 30.1.3 experiment and react-router 7.18.4 source).

## Expected change scope
`use-leave-guard.ts` (capture-phase `popstate` handling: cancel with `history.go(-delta)` and ask), `AccountSwitcher.tsx`, `AppShell.tsx`, `DailyReviewPage.tsx` (row click at `:513`; use the page's existing guarded `go`, `:123`), the Leave handlers of the editors that use the guard (`DailyReviewPage.tsx:180`, `journal/components/ReviewCard.tsx:409`, `rulebooks/components/RulebookVersionPage.tsx:361`) so that Leave completes a history navigation, tests.

## Out of scope
Native window close (TASK-023, Deferred but Release Blocking = Yes, so the gap stays tracked); migrating to a data router.
- `TradeDetailPage.tsx:267` (`navigate("/journal?view=log")` after Delete): not guarded, because it runs only after the user confirms the delete dialog; unsaved review edits stay in this window's session storage (`ReviewCard.tsx:225`, per account and trade, `:108-110`) and are offered back if the trade is restored.
- Choosing another account in the AccountSwitcher (`select`, not a navigation) re-keys `DayReview` (`DailyReviewPage.tsx:87`) and `AccountTrade` (`TradeDetailPage.tsx:45`) and unmounts a dirty editor with no prompt. This is a gap outside this card: record it as a new Triage card (CLAUDE.md) rather than widening scope.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Route programmatic navigations through the existing `useGuardedNavigate`.
3. The app uses a declarative `HashRouter` and `popstate` cannot be cancelled. While dirty, add a `window` `popstate` listener with `{ capture: true }`. It runs before the router's earlier bubble-phase listener. In it: compute `delta` from the new `history.state.idx` and the index of the entry the editor is on; call `event.stopImmediatePropagation()` so the router never sees the navigation; call `history.go(-delta)` to return to the editor's entry (the restoring `popstate` that reaches the router is harmless, since the location is unchanged; ignore it in the guard); then invoke the leave request. If `history.state?.idx` is missing (no delta can be computed), do not cancel the event: let it through without a prompt (known gap: the router has already moved and the editor unmounts, so a later leave prompt would be meaningless; log the gap in the execution log and add the criterion/test below that documents it). Use one module-level capture listener that asks the most recently registered guard (`[...active].pop()`, as `useGuardedNavigate` does, `use-leave-guard.ts:14`), not one listener per guard, so links and history navigation are handled by the same guard. Do not use `hashchange`, and do not `pushState`/`replaceState` a replacement entry. The named fallback, migrating to `unstable_HistoryRouter` with a blocking history, is **not authorized by approving this card**: it needs its own separate approval, and if the capture-phase approach fails the implementer stops and reports.
3a. Leave after a history navigation completes it: the confirm handler calls `history.go(delta)` once, with a one-shot bypass so the guard does not ask again for that traversal, instead of `navigate(href)` (which would push a new entry). Leave after a link or `useGuardedNavigate` keeps calling `navigate(href)`.
4. Tests using the real `HashRouter`: dirty DailyReviewPage → `history.back()`, `history.forward()` (after a Back from a later entry), 'Manage accounts', Quick Import and a trades-table row click each show the confirm dialog; the editor never unmounts (assert the same element instance and text) while the dialog is open; choosing to stay keeps text and history intact; choosing Leave after Back completes the Back.

## Prerequisites, dependencies and conflicts
- Prerequisites: None.
- Likely shared-file conflicts: `AccountSwitcher.tsx` and `DailyReviewPage.tsx` with TASK-024; `AppShell.tsx` with TASK-015 (only if TASK-015 adds a banner).

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] Back then Stay: `history.state.idx` and `history.length` are the same as before the Back, the editor is the same element with its text, and a second `history.back()` shows the dialog again.
- [ ] Forward is guarded too: from a dirty editor that has a forward entry, `history.forward()` shows the dialog, and Stay leaves `history.state.idx` and `history.length` unchanged.
- [ ] Back then Leave: the app ends on the previous entry (`history.state.idx` one lower than before, `history.length` unchanged, no new entry pushed) and does not ask twice.
- [ ] Known gap documented: a test pops an entry whose `history.state` has no `idx`; the guard does not cancel it and shows no dialog (the navigation goes through), and the test name or comment says this is the known gap from step 3; the gap is recorded in the execution log.
- [ ] A dirty daily review's trades-table row click (`DailyReviewPage.tsx:513`) shows the dialog.
- [ ] Manual Windows check (owner/VM, recorded with tester, date, Windows build, tested source SHA): on a dirty daily review, mouse back (X1) and Alt+← each show the dialog, and Stay keeps the text. The automated tests cover the History API path only.
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

## Changes in r4
- Replaced the "intercept `hashchange`/`popstate`, re-push" mechanism with a capture-phase `window` `popstate` listener, `stopImmediatePropagation()` and `history.go(-delta)`, and added the router mechanics to the root cause. Reason: audit MUST (with react-router 7.18.4, `hashchange` and a later bubble listener are too late, and re-pushing loses forward history and desyncs the router index while still passing the r3 criteria).
- Added criteria that `history.state.idx` and `history.length` are unchanged after a cancelled Back, that Back prompts again, and that Forward is guarded. Reason: audit MUST.
- Specified that Leave after a history navigation completes it with `history.go(delta)` and a one-shot bypass, with a criterion. Reason: audit SHOULD (the existing Leave handlers call `navigate(href)`, which would push a new entry).
- Added the daily-review trades-table row click (`DailyReviewPage.tsx:513`) to scope and tests. Reason: audit SHOULD.
- Recorded why `TradeDetailPage.tsx:267` stays unguarded, and that the account-switch remount is a separate gap for a new Triage card. Reason: audit SHOULD (scope stated, not widened).
- Out of scope now notes that TASK-023 is Deferred but stays Release Blocking. Reason: audit NIT (stated only because the line changed).
- Out of scope: corrected the `TradeDetailPage.tsx:267` rationale; unsaved review edits are kept in session storage (`ReviewCard.tsx:108-110, 225`) (independent review (review4), reviewer B text correction).
- Criteria: added the recorded Windows mouse-back/Alt+← check, so Purpose is verified beyond the History API path (independent review (review4), reviewer B nit; audit SHOULD previously skipped).
- Step 3: a missing `history.state.idx` lets the event through and falls back to the leave request; one module-level capture listener uses the last registered guard (independent review (review4), reviewer B nits).
- Root cause wording: the router reads the location from the URL and computes the delta from `history.state.idx` (independent review (review4), reviewer B nit).
- Scope: the row click uses the page's existing guarded `go` (`DailyReviewPage.tsx:123`); conflicts add `DailyReviewPage.tsx` with TASK-024 and `AppShell.tsx` with TASK-015 (independent review (review4), reviewer B nits).

## Changes in r5
- Step 3: when `history.state.idx` is missing the event is let through without a prompt (a later leave prompt would come after the editor unmounted); recorded as a known gap in the execution log, with a new criterion and test that document it (board review 2026-10-22).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.3): nits only — applied in r3.
Independent review r3 (2026-10-22): CHANGES on 012, 024, 026 (citations, test construction, scope lines); applied. READY.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r4.
Board review (2026-10-22, against main 92e7980): APPROVE WITH NOTE; fixes folded in at r5. Independent re-check of r5: pending.
