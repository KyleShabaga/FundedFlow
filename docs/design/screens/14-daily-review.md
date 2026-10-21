# 14 · Daily review

**Card:** Build 22 (daily review and plan-adherence workflow). A nested Journal page, not a sidebar item. Needs 14, 15
and 20. Entry points: Today **Review session** ([08](08-today.md)), Journal **By day** ([03](03-journal.md)) and
Library **Daily journals** ([11](11-library.md)).

No canvas mockup exists for this page; it follows the Journal's trade review ([10](10-trade-detail.md)) and uses only
design-system components. Reference for the day header and stats: `tw-daily-journal.png`.

Plan, review and reflect on one account attempt's trading day. Process adherence, the closed-trade outcome and
prop-firm rules are shown apart; none implies another.

## Route and identity
- `/journal/days/:tradingDay?account=<accountId>`. Both parts are explicit, so a link never changes meaning when the
  header selection changes. Without `account` the selected account is used.
- The day is a stored trading-day key (Monday to Friday). Today links Rust's current trading day; By day links stored
  days; the day chooser accepts any weekday. A weekend or malformed key shows "That isn't a trading day".
- Keyed by account and day: changing either remounts the page, so no draft, summary or pending save of another
  account or day can render. When the header selection is another account the page says so ("This review isn't for
  the selected account") and offers **Select <account>**.

## Layout
- Breadcrumb Journal › Daily reviews › day. Title "Daily review · Mon, Oct 19, 2026" with the status badge (Not started,
  Draft, Completed, Completed · edited) and Upcoming for a future day. Sub-line: account, trading day, zone, reset, and
  the session window in the account's zone.
- Day navigation: Previous day, Next day (weekdays), Current trading day (when another day is open), Go to day.
- **Summary** card, three facts side by side: *Process (plan adherence)* ("3 of 4 applicable items followed (75%)" or
  "Unknown: not enough answers"; counts of followed, missed, not applicable and unanswered), *Outcome (closed trades)*
  (Rust's sum of known net P&L, "n of m trades with a known P&L", unknown and open trades named; no trades shows "—",
  never $0.00), *Day* (Traded, No-trade day (by choice), No trades recorded). Disclaimer: adherence is not profit and
  not a check of the firm's rules or a signal to trade.
- **Form** (one form, sections as `FormSection`):
  - Status line (live region): Saving…, Unsaved changes, or "Draft / Completed <time> · last saved <time>".
  - Before the session: focus, planned setups, no-trade conditions, process commitments (textareas), maximum risk for
    the day (money, account currency, optional), plan notes. Badge "Written before the session" or "Written afterwards
    (retrospective)" with the authored time.
  - Daily checklist: a daily checklist from the library (`Select`), then one radio group per item: Followed, Missed,
    Not applicable, with an optional note and Clear answer. Unanswered items say so. Renamed or archived items show
    their recorded label and what they are called now.
  - After the session: "I didn't trade this day (no-trade day)" (disabled when trades exist), market context, what
    went well, mistakes, emotions and mindset, key lesson, one action for the next session, other notes.
  - Actions (sticky at the bottom): Discard changes, Reopen as draft (completed), Save draft / Save changes, Complete
    review (primary; not for a future day).
- **Trades this day**: symbol, side, open, close, net P&L (status badge when not calculated) and, once reviewed, link
  status (In review, Added since, Changed since). Rows open the trade; trades are never edited here.
- **History** (collapsed): Started, Saved, Completed, Edited after completion, Reopened as draft, Updated to the
  current trades, each with time and revision.

## States
New (no review), draft, completed, completed and edited, saving, saved, save failed (validation summary or error;
text kept), save not confirmed ("It isn't certain the review was saved": Check the stored review, text kept),
conflict ("This review changed after you opened it": Reload the review; edits offered back), loading, error with retry,
local data unavailable, archived account (read only), future day (plan only), no trades recorded, no-trade day,
unknown P&L, changed trades (added, corrected, deleted, moved; session settings changed) with **Use the current
trades**, account not available, not a trading day, selection differs.

## Saving and unsaved changes
- Explicit saves, no autosave. A save names the revision it started from; a stale revision is a conflict and writes
  nothing.
- While the form is dirty, in-app links and day navigation ask "Leave without saving the review?" and closing the
  window asks too (`useLeaveGuard`). Edits are kept per account and day in session storage and offered back
  ("Restore them" / "Discard") when the day is opened again in the window.
- A failed save never clears the form; the text stays until a save is confirmed.

## Keyboard and accessibility
Every control is labelled; radio groups per checklist item; field errors linked and summarised, focus on the first
invalid field; after a save, focus returns to the status line; toasts announce saved/completed/reopened; disabled
actions stay focusable with their reason; the whole path (write, answer, save, complete, reopen) works with the
keyboard. Long notes use multi-line textareas; the layout reflows to one column in narrow windows.

## Data
`get_daily_review`, `save_daily_review`, `reopen_daily_review`, `relink_daily_review_trades`, `list_daily_reviews`;
checklists from `get_review_library`. All derived values (trading days, session window, plan timing, adherence,
outcome, link status) come from Rust ([data model](../../data-model.md#daily-reviews-build-22)).
