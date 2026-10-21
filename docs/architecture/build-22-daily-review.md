# Build 22: daily review and plan-adherence workflow

Card: https://app.notion.com/p/3fe1bd4b6bde81ddb13efa63aef7f408 · branch `feat/build-22-daily-review`.
Storage rules and commands: [`../data-model.md#daily-reviews-build-22`](../data-model.md#daily-reviews-build-22).
Screen spec: [`14-daily-review.md`](../design/screens/14-daily-review.md); entry points in
[`03-journal.md`](../design/screens/03-journal.md), [`11-library.md`](../design/screens/11-library.md) and
[`08-today.md`](../design/screens/08-today.md).

## Baseline (checked 2026-10-20)

| Build | State on `main` (`79109be`) | Used here |
|---|---|---|
| 8/10 storage, trading day | merged | `domain::trading_day` (zone, reset, weekend roll), forward-only migrations with pre-upgrade backup |
| 13–14 design system, gateways | merged | `FormSection`, `RadioGroup`, `Select`, `Textarea`, `DataTable`, `InlineNotice`, `MutationFeedback`, `useFeatureQuery`/`useFeatureMutation`, query keys |
| 15 accounts, attempts | merged | `useActiveAccount`; a reset creates a new account id, so it starts a fresh review namespace |
| 20 journal (PR #45) | merged; migration 17 | trade ids and stored `trading_day`, library checklists (scope `daily` already existed), label-snapshot pattern, `useLeaveGuard`, kept-edits pattern |
| 21 Today (PR #46) | merged; no migration | the disabled **Review session** action and the `structured-reviews` capability |
| 23 Insights | not started | untouched; `insights-aggregates` stays unavailable |
| 24 data controls (PR #43) | open draft | not touched; see "Build 24" below |
| 29 prop-firm collector | unmerged branch | unrelated tool; not touched |

No Build 22 branch, PR or Codex contribution existed. Schema on `main` was v17; this build adds migration 18.

## Decisions

- **Dedicated tables, not `journal_entries`.** Generic entries have no status, revision, trading-day key or snapshot
  columns, and `checklist_results` requires exactly one of a trade review or a journal entry, which SQLite cannot
  relax without a table rebuild. Migration 18 adds `daily_reviews`, `daily_review_answers` (same result vocabulary as
  Build 20: followed / missed / not applicable), `daily_review_trades` and `daily_review_events`. The reserved
  `*.journal_entry_id` columns stay unused.
- **Identity `(account_id, trading_day)`**, unique; the day key is Rust's and Monday-to-Friday. Only one record per
  account and day can exist, so "more than one draft" cannot happen; a second window is a revision conflict.
- **Timezone/reset changes** re-derive trades (Build 8) but never move a review: the review keeps its day key and
  records the session settings it was saved with; reads flag `sessionSettingsChanged` and show moved trades.
- **Trade links** are a snapshot of the day's trade ids (with P&L, status and `updated_at`) at each save. Reads report
  added, changed, deleted and moved trades; **Use the current trades** relinks without touching text or status. The
  outcome always uses the trades as they are now.
- **Lifecycle**: draft → completed (explicit) → reopened (draft; first completion kept); a completed review can be
  edited in place (stays completed, marked edited). Every write appends a history event.
- **Plan timing**: authored time is set when the plan first has content; `pre_session` only if before the session end
  and before the day's first trade opened, otherwise `retrospective`. Future days (≤ 14 days ahead) take a plan only.
- **No-trade day** is a declaration, refused when trades exist. A day without trades has no P&L (null), and "No trades
  recorded" is never presented as a no-trade day.
- **Explicit save, no autosave.** Leave guard on links, day navigation and window close; kept edits per account and day
  in session storage; failed, unconfirmed or conflicting saves keep the text.
- **Legacy entries** (journal entries without a trade) are listed in the Library as "Earlier day notes" with a
  Rust-derived trading day, read only, never converted or counted.
- **Route** `/journal/days/:tradingDay?account=` (no new sidebar item). The account is explicit so Today, By day and
  Library open the identical record and a selection change cannot leak another account's review.
- **Archived accounts** are read-only (writes are conflicts). Failed/closed attempts stay editable, as Build 20 reviews do.

## Interfaces added

| Layer | Added |
|---|---|
| SQLite | migration 18 `0018_daily_reviews.sql` (version 18) |
| Rust | `store/daily_reviews.rs` (`get_day`, `list`, `save`, `reopen`, `relink_trades`; `*_at` variants take "now" for tests); library checklist usage counts include daily reviews |
| Commands | `get_daily_review(accountId, tradingDay)`, `list_daily_reviews(accountId)`, `save_daily_review(input)`, `reopen_daily_review(input)`, `relink_daily_review_trades(input)` |
| Domain | `contracts/daily-reviews.ts` (DTOs, inputs, `tradingDayKey`); `DailyReviewRepository` on the `JournalRepository` port (`dailyReviews`) |
| Desktop | `features/daily-reviews` (api, hooks, view model, `DailyReviewPage`, `DayChooser`, CSS); query keys `dailyReviewsAll/Root/Index/Day`; `/journal/days/:tradingDay` route and shell title "Daily review" |
| Removed | `structured-reviews` capability and `useReviewCapability` |

**Invalidation.** Daily-review writes invalidate the account's daily reviews, the library (usage counts) and the
deletion preview. Trade create/correct/delete/restore, CSV import commits and account writes (zone/reset changes,
archive, status, reset) invalidate the account's daily reviews; library writes invalidate every account's.

## Today (Build 21) integration

Review session reads `list_daily_reviews` for the selected account and navigates to its `currentTradingDay` (Rust, at
the moment of the read). It does not read or change snapshots, the freshness check, the check time or the shared
selection; the risk truth model, evidence handling and Safe/Caution/Stop/Unknown are unchanged. The label reflects
today's review ("Continue review", "Open review"). While the day can't be read the action is unavailable with its reason.

## Acceptance traceability

| Criterion | Where | Test |
|---|---|---|
| Start, save draft, resume, complete (selected account and day) | `DailyReviewPage`, `save_at` | Rust `a_review_is_drafted_resumed_completed_reopened_and_edited`; UI "starts, saves as draft, resumes after a restart…" |
| Two accounts on the same date never share | unique index, keyed route | Rust `accounts_and_reset_attempts_never_share_a_review`; UI "never shares a review between two accounts…" |
| Trades and checklist link deterministically; missing/changed shown | `daily_review_trades`, `membership` | Rust `deleted_corrected_restored_and_moved_trades…`, `csv_reimport_keeps_review_links_by_trade_id`, `checklist_answers_keep_their_wording…`; UI "shows trades changed since the review…" |
| Empty day and no-trade day; no-trade ≠ zero-P&L session | `day_state`, outcome `net: null` | Rust `outcome_counts_unknown_pnl_and_no_trade_days_stay_distinct`; UI "reviews a day with no trades…" |
| Adherence ≠ profit or compliance | summary layout, disclaimer, Unknown denominator | Rust `adherence_is_unknown_without_applicable_answers`; UI "shows process adherence apart from the outcome…" |
| Keyboard, accessibility, restart persistence | form semantics, focus, leave guard | UI keyboard journey; Rust restart = fresh reads of a persisted journal; migration test on a populated v17 journal |
| Today opens selected attempt + Rust day | `TodayActions` | Today tests "Review session opens…", "offers to continue today's draft…" (no snapshot or rulebook writes) |
| By day status/adherence; zero-trade day selectable | `ByDayView`, `DayChooser` | UI "shows each day's review status…", "picks any weekday…" |
| Library lists canonical reviews; legacy notes not double-counted | `LibraryView` | UI "lists daily reviews in the Library…"; Rust `the_index_lists_reviews_newest_first_and_legacy_notes_apart` |
| Draft/complete/reopen, reset isolation, corrected/deleted trades, timezone change | Rust store | Rust tests above |

## Tests

- Rust (`store/daily_review_tests.rs`, 16 tests): lifecycle and events; stale and duplicate saves (and the unique
  index); rollback of a failed write; input validation; future days and plan timing; account and reset-attempt
  isolation (including schema-level cross-account links and immutable identity); archived read-only; trading days
  (Friday after reset → Monday), session windows across the 2026-11-01 DST change and a midnight reset; checklist
  snapshots after rename/archive and library counts; Unknown adherence; unknown P&L and no-trade days; deleted,
  corrected, restored and moved trades and a timezone change; re-import by trade id; index and legacy notes; migration
  18 on a populated v17 journal with cascade on account deletion; append-only events. The command-wire fixture now
  carries real daily-review payloads (fresh journal) and the v3/v4 journals upgraded through migration 18.
- TypeScript: `daily-review.test.tsx` (15 journeys), `daily-review-model.test.ts`, `lib/data/daily-review-wire.test.ts`,
  the wire-contract test, Today action tests, AppShell title, capability contract.

## Limitations and follow-ups

- **Not verified here: a packaged Windows/Tauri run** (offline restart smoke: account → trade → Today/Journal day →
  plan → draft → restart → resume → complete → Library → reopen). The native app has no data-directory override, so it
  was not run, to protect the real local journal. Restart persistence is covered by Rust tests on SQLite files and
  fresh reads; independent packaged QA (Builds 26–27) remains required.
- Day screenshots/attachments are not part of this build (`attachment_links.journal_entry_id` stays reserved).
- Session windows on the page come from Rust; the in-memory UI fake approximates them (UI tests do not assert them).
- **Build 24** (PR #43, open): its archive/restore/deletion must include the four new tables (they cascade from
  `accounts`). Re-run its integration tests against migration 18 when it is rebased.
- Filtering of the review list is client-side over `list_daily_reviews`, like other Journal lists.
