# TASK-024 — Fix: uncertain write outcomes are not reported as definite failures

| Field | Value |
|---|---|
| Status | Ready for Approval (r5) |
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
| Inspected source revision | 9430f2a (application source identical to 92e7980) |
| Specification revision | r5 (2026-10-22; r4 + board review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / 4d4e66d (HEAD at r3; application source unchanged). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Toasts/dialogs say 'wasn't archived', 'wasn't restored', 'The trade wasn't restored', 'The active account wasn't changed', 'The account wasn't switched' even when the error category is `uncertain-outcome`, contradicting the merged P0-03 rule.

## Trigger / reproduction
Timeout/`database`-kind error on those writes.

## Root cause / evidence
`apps/desktop/src/features/accounts/components/LifecycleDialogs.tsx:166,191`; `journal/components/TradeLogView.tsx:146`; `TradeDetailPage.tsx:270`; `accounts/components/AccountSwitcher.tsx:45`; `AccountActions.tsx:37`; and three more active-account switches with the same `active.select()` call: `accounts/components/AccountDetailPage.tsx:257`, `today/components/TodayPage.tsx:65`, `daily-reviews/components/DailyReviewPage.tsx:155` ("The account wasn't switched").

Why "check before trying again" is not enough:
- Settings (all five active-account sites): `select` is a settings write (`useSetSetting`, `features/accounts/active-account.ts:42,55`). An uncertain result leaves the setting's scope locked (`features/shared/submissions.ts:40`), every later submit is rejected at once with `uncertain-outcome` and sends nothing (`shared/hooks/use-feature-mutation.ts:41-42`, `submissions.ts:23-24`), settings have no acknowledge path (out of scope), and the lock is in memory, so it lasts until FundedFlow restarts.
- Accounts and trades: `["account", id]` is shared by archive, restore, edit, status and reset (`accounts/hooks/accounts.ts:14-20`) and is released only by the `AccountWriteReview` in the Edit, Change status and Reset dialogs (`AccountFormDialog.tsx:280`, `LifecycleDialogs.tsx:128,400`); `["trades", accountId]` (`trades/hooks/trades.ts:8,21`) is released only by the `TradeWriteReview` in the trade form (`journal/components/TradeFormDialog.tsx:239`).

## Expected change scope
Those files, including `AccountDetailPage.tsx`, `TodayPage.tsx` and `DailyReviewPage.tsx` (owner decision, 2026-10-22); reuse the pattern in `journal/components/LibraryView.tsx:287-293` / `Screenshots.tsx:163`. A small shared helper for the five active-account sites is allowed.

## Out of scope
Settings auto-acknowledge and daily-review acknowledge flow (ISSUE-011 rest, V1.1); invalidate-on-uncertain changes to the lock or caches.
- The other settings toasts, `today/components/AccountsOverview.tsx:31` ("The layout wasn't saved") and `today/components/SessionPrompt.tsx:31` ("That choice wasn't saved"): their description ("It applies until you close FundedFlow") is still true, and Kyle's decision widened scope only to the three account-switch toasts. Record them as a new Triage card.

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Branch on `error.category === 'uncertain-outcome'`:
   - Account and trade writes (archive, restore, trade restore): show 'may have been archived/restored — check before trying again', say where to check (the page or list that shows the record), as `journal/components/LibraryView.tsx:287-293` does ("check the library on this page"), and say where the review that releases the lock appears: for an account that still shows as not archived, its Edit, Change status or Reset dialog; for an account that shows as archived, no review is reachable (the archived account's menu offers only Open, Rulebook, Restore and Delete, `AccountActions.tsx:99-108`; the detail page hides Edit, `AccountDetailPage.tsx:288-289, 300`; `RestoreDialog` renders no `AccountWriteReview`, `LifecycleDialogs.tsx:173-195`), so say that archiving and restoring this account are locked until FundedFlow restarts and to check the account after reopening; trades: adding or editing a trade of that account (`useCreateTrade` shares the `["trades", id]` scope, `trades/hooks/trades.ts:10`). No link to the record is added, and no review is added to `RestoreDialog`; both are out of scope.
   - Uncertain results shown as toasts use the `warning` tone (`NoticeTone`, `design-system/components/feedback.tsx:28`); definite failures keep `error`; dialog error text keeps its existing styling.
   - Active-account switches (all five sites; owner decision, 2026-10-22): the wording must say that no answer came back so the active account may have changed, that switching is locked until FundedFlow restarts, and that the active account should be checked after reopening. It must not invite the user to try again now. Example: "No answer came back, so the active account may have changed. Switching is locked until you restart FundedFlow; check the active account after reopening it."
3. Keep definite-failure wording for definite failures.
4. Tests: reject each with `FeatureDataError('uncertain-outcome')` → uncertain wording; with a definite failure → existing wording. For one active-account site and one account or trade site, also test the locked retry: after an uncertain result, a second attempt sends nothing (spy on the repository) and still shows the uncertain wording, never the definite one.

## Prerequisites, dependencies and conflicts
- Prerequisites: none functional. TASK-021 and TASK-022 are merge order only: rebase onto whichever of TASK-021/TASK-022 has merged; no functional dependency, so this card does not wait behind TASK-020 → TASK-021. The overlapping edits are in different regions (`LifecycleDialogs.tsx:166,191` here vs `:282` in TASK-021; `AccountSwitcher.tsx:45` here vs `:68` in TASK-022).
- Likely shared-file conflicts: `LifecycleDialogs.tsx`, `AccountSwitcher.tsx`; `DailyReviewPage.tsx` with TASK-022.

## Acceptance criteria (pass/fail)
- [ ] New tests pass; fail before.
- [ ] All five active-account sites (`AccountSwitcher.tsx:45`, `AccountActions.tsx:37`, `AccountDetailPage.tsx:257`, `TodayPage.tsx:65`, `DailyReviewPage.tsx:155`) show the locked-until-restart wording on an uncertain result, and the definite wording otherwise.
- [ ] Locked retry: a second attempt after an uncertain result sends nothing and shows the uncertain wording again.
- [ ] After an uncertain archive whose write committed (account now archived), the message names the restart, not the Edit/Change status/Reset dialogs; a second Restore attempt sends nothing and shows the same uncertain wording.
- [ ] Uncertain results shown as toasts use the `warning` tone; definite failures keep `error`.
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

## Changes in r4
- Widened scope to the three "account wasn't switched" toasts (`AccountDetailPage.tsx:257`, `TodayPage.tsx:65`, `DailyReviewPage.tsx:155`). Reason: audit MUST; Kyle's decision (2026-10-22): "widen the scope to the three 'account wasn't switched' toasts".
- Active-account (settings) wording now says the setting is locked until the app restarts and should be checked after reopening, instead of "check before trying again". Reason: audit MUST (an uncertain settings write locks the scope for the session with no acknowledge path); Kyle's decision (2026-10-22): "the wording must say that the setting is locked until the app restarts and should be checked after reopening".
- Account and trade wording names where the review that releases the lock appears. Reason: audit SHOULD.
- Added a locked-retry test and criterion. Reason: audit SHOULD.
- Listed the two other settings toasts (`AccountsOverview.tsx:31`, `SessionPrompt.tsx:31`) as out of scope. Reason: audit MUST asked to include or list them; Kyle's decision covered only the three switch toasts.
- Step 2 and criteria: for an account that shows as archived (an uncertain archive that committed, or an uncertain restore that did not), no review dialog is reachable (`AccountActions.tsx:99-108`, `AccountDetailPage.tsx:288-289, 300`, `LifecycleDialogs.tsx:173-195`), so the wording says archive and restore are locked until FundedFlow restarts and to check after reopening; dialog guidance kept for non-archived accounts; criterion added. No review panel is added to `RestoreDialog` (independent review (review4), reviewer B blocking 1).
- Step 2: trade guidance says "adding or editing" (`trades/hooks/trades.ts:10`); uncertain toasts use the `warning` tone, with a criterion (independent review (review4), reviewer B nits; audit NIT 5).
- Conflicts: `DailyReviewPage.tsx` with TASK-022; out-of-scope wording simplified (independent review (review4), reviewer B nits).

## Changes in r5
- Prerequisites: TASK-021/TASK-022 are merge order only; rebase onto whichever has merged, no functional dependency, so this card does not wait behind 020 → 021 (overlaps are in different regions: `LifecycleDialogs.tsx:166,191` vs `:282`, `AccountSwitcher.tsx:45` vs `:68`) (board review 2026-10-22).

## Independent review notes
Independent review (Block 3, 2026-10-22): READY as drafted. r2 adds only global items (execution-log pointer; Triage-card step on Fix/Test cards).
Block 4 review (10 §8.3): nits only — applied in r3.
Independent review r3 (2026-10-22): CHANGES on 012, 024, 026 (citations, test construction, scope lines); applied. READY.
Independent review (approved-task audit fixes, 2026-10-22): three reviewers plus a re-check of the blocking fixes; READY at r4.
Board review (2026-10-22, against main 92e7980): APPROVE WITH NOTE; fixes folded in at r5. Independent re-check of r5 (two reviewers, 2026-10-22): blocking items applied; READY at r5.
