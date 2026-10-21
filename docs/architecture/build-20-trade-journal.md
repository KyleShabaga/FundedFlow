# Build 20: trade journal, trade detail and trade review

Card: https://app.notion.com/p/3fe1bd4b6bde81cba72dc331606ba6f6 · branch `feat/build-20-trade-journal`.
Storage rules, commands and the screenshot format: [`../data-model.md#trade-journal-and-reviews-build-20`](../data-model.md#trade-journal-and-reviews-build-20).
Screen specs: [`03-journal.md`](../design/screens/03-journal.md), [`10-trade-detail.md`](../design/screens/10-trade-detail.md),
[`11-library.md`](../design/screens/11-library.md).

## Baseline (checked 2026-10-20)

| Build | State on `main` | Used here |
|---|---|---|
| 13–14 design system, gateways | merged | `DataTable`, forms, async states, `useFeatureQuery`/`useFeatureMutation`, query keys |
| 15 accounts, active account | merged | `useActiveAccount`; the Journal never guesses an account |
| 16 rules engine (PR #42) | merged | Snapshots are immutable and checked by `inputsHash`; trade writes invalidate `snapshotsRoot` |
| 17–18 CSV import (PR #41) | merged | Dedup keys, restore-on-reimport, `import_rows` and `trade_round_trips` are reused unchanged |
| 19 rulebook editor (PR #44) | merged; migration 16 | The leave guard moved to `features/shared/hooks/use-leave-guard.ts` (re-exported for Build 19) |
| 24 data controls (PR #43) | **open draft**, no migration | Attachment root, key format and inventory columns follow its archive; see below |
| 21 Today, 22 daily review, 23 Insights | not started | Not duplicated: no day plan/reflection, no aggregate analytics |

## What existed and what was added (Block 20A)

- `trades` with create/update/soft delete and CSV restore existed; updates had no history or revision guard. Added:
  `trade_corrections` (append-only), `expectedUpdatedAt` conflicts, `restore_trade`, `list_deleted_trades` and
  `get_trade_detail` (provenance, original CSV cells, corrections, previous/next).
- `strategies`, `checklists`, `checklist_items`, `checklist_results`, `tags`, `trade_reviews`, `trade_review_tags`,
  `attachments` and `attachment_links` were reserved by migration 1 with no commands. They are used as they are, with
  migration 17 adding only what was missing: review ownership and revision, strategy/checklist/tag label snapshots,
  tag archive, checklist descriptions, attachment ownership and dimensions, and same-account triggers.
- `journal_entries` stay as they were. The Library lists them (trade notes and daily entries) read only.

## Migration numbering

Migration 17 (`0017_trade_reviews.sql`) follows `main`'s 16 (`rulebook_events`, Build 19). No open PR allocates a
migration: Build 24 (PR #43) adds none and validates archives against `db::MIGRATIONS`, so it accepts v17 journals
without change once rebased. If another PR lands a migration 17 first, renumber this one to the next free version
before merging (never edit a shipped migration), update `db/mod.rs`, the data-model table and the tests that name
version 17 (`store/journal_review_tests.rs`), and re-run `cargo test`. The Build 19 tests that stop at version 16 now
migrate with `MIGRATIONS[..16]`, so they keep testing exactly that step.

## Screens

- `/journal` (sidebar Journal): **By day**, **Trade log** and **Library** tabs (`?view=`), for the active account only.
  The account is part of the component key, so switching accounts drops every filter, draft and selection.
- **By day**: one card per stored trading day, newest first, the latest open; Expand/Collapse all; stats strip (trades,
  win rate, gross, fees, contracts, winners, losers, profit factor), cumulative net P&L (`EquityCurve`, `step={false}`)
  and the day's trades (first 8, then "Show all"). 20 days at a time.
- **Trade log**: KPI tiles for the rows shown, search (symbol, notes, strategy, tags), result filter with counts, a
  Filters popover (side, source, review status, strategy, tag, day range), sortable columns, 10/25/50/100 rows per page,
  the account's time zone, and Deleted trades (restore).
- **Trade detail** `/journal/trades/:id`: breadcrumb, symbol/side/result/source, net P&L, previous/next trade, Correct
  trade, Delete (with Undo); Summary (`StatList`), Import source with the original CSV row, Source fills, Correction
  history; the Review card and Screenshots.
- **Library** (`?view=library&section=`): Trade notes, Daily journals (read only), Playbooks, Templates, Tags.
- Manual entry: **Add trade** on the Journal (not a header button). Times are typed in the account's zone and sent as
  UTC; the trading day and P&L are computed by Rust on save. A time left untouched while correcting keeps its stored
  instant exactly (seconds included).

All money is formatted and summed with `format.ts` (bigint micro-units). Day and log figures are display sums of
Rust-stored values; trades without a known P&L are left out and named; win rate and profit factor are display ratios.

**States**: no account, account unavailable, loading, empty (no trades, no matches), error with retry, runtime
unavailable (Build 14 mapping), not found (also for another account's trade), conflict (trade correction and review),
uncertain write, read-only archived account, missing/corrupt screenshot, library unavailable (notes still editable).

**Keyboard and accessibility**: table rows take focus and open with Enter; day toggles are buttons with
`aria-expanded`/`aria-controls`; every field has a label and its errors are linked; validation summary and focus on
the first invalid field; checklist answers are radio groups per item; tags are the new design-system `ChipGroup`
(buttons with `aria-pressed` in a labelled fieldset); the screenshot area takes focus for Ctrl+V.

**Unsaved changes**: the trade form asks before discarding; the review form guards in-app links and window close
(`useLeaveGuard`) and keeps edits per account and trade in session storage, offering them back on return.

## Invalidation

Trade create/correct/delete/restore invalidates `tradesRoot`, `reviewsRoot`, `journalRoot`, `snapshotsRoot`,
`deletion` and lineage for the account. Review and screenshot writes invalidate the account's reviews, the library
(usage counts) and the deletion preview. Library writes invalidate the library and every account's reviews (current
labels). Nothing recalculates a stored snapshot; the Build 16 freshness check reports changed inputs as stale.

## Screenshots and Build 24

Bytes live under `<app data>/attachments/screenshots/<uuid>.<ext>`, the root Build 24 reads, with an opaque, portable
key and the inventory columns it checks. Ownership follows `attachment_links` → `trade_reviews` → `trades` as its
deletion preview does, and `attachments.account_id` cascades with the account. Removal keeps the bytes (Build 24
requires bytes for soft-deleted rows). When PR #43 is rebased on this build, re-run its archive/restore/deletion tests
with screenshot rows present.

Tauri's native drag-and-drop handler is turned off for the main window (`dragDropEnabled: false`) so the webview
receives dropped files; on Windows that handler otherwise blocks HTML5 file drops (this also lets the CSV import
dropzone receive drops).

## Tests

- Rust (`store/journal_review_tests.rs`): manual create, review and reopen of a file journal; corrections with old and
  new values, no-op edits, conflicts, append-only history; delete/restore keeping the review; neighbours; CSV re-import
  keeping reviews, provenance and immutable source rows (including delete then re-import); attempt isolation for
  reviews, detail and screenshots, including a schema-level cross-account insert; historical labels after rename and
  archive; derived planned risk and R-multiple; unknown risk; library validation; screenshot storage, portable keys,
  type/size/dimension checks, duplicate, missing and corrupt files, failed-write cleanup; migration 17 on a v16 journal
  with a reserved review row; snapshots never rewritten. `db/tests.rs` covers account deletion cascading through
  corrections and reviews.
- TypeScript: `features/journal/journal-model.test.ts` (sums, rounding, grouping, filters, sorting, curve, hold time);
  `features/journal/journal.test.tsx` (account gate, by-day grouping and stats, trade-log filters/search/sort/keyboard,
  manual entry in the account zone, discard prompt, detail provenance and navigation, account isolation, correction
  guard, review save with process and outcome, recorded labels, review conflict, leave guard, screenshots incl. rejected
  and missing files, library playbooks/tags/checklists); adapter command shapes and input validation; `ChipGroup`.

## Limitations and follow-ups

- Filtering, sorting and paging are client-side over `list_trades` (as Build 14 reads already do). A paged SQL query is
  a follow-up if journals grow large.
- No price chart: there is no market data in V1 (Builds 42–43), and a round trip is not an execution record.
- Trade correction times are typed to the minute; untouched times keep their seconds.
- Removed screenshots keep their bytes until Build 24 permanent deletion; there is no "empty attachment trash".
- Day plans, reflections and plan adherence were added by Build 22 ([build-22-daily-review.md](build-22-daily-review.md)); existing daily entries are listed there as earlier day notes, read only.
- Strategies, tags and checklists are shared by all accounts (the reserved schema has no account column); reviews and
  screenshots are account-scoped.
- Not verified here: a packaged Windows run (restart persistence, file drop/paste through WebView2, Build 24 backup
  and restore with screenshots, a second Windows profile). The native app has no data-directory override, so it was not
  run against a journal.

Build 23: `tradePath(id, accountId?)` and Trade detail accept `?account=<attempt>` so Insights drill-downs open a trade of
any selected attempt (archived ones read-only) instead of the active account's; without it the page behaves as before.
