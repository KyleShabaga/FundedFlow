# 11 · Journal library

**Card:** Build 20 (strategy, tag and checklist management, notes) and Build 22 (daily reviews). A sub-view of
Journal, not a sidebar item. Playbooks and templates map to strategies and checklists.

Mockup: `Library.dc.html`. Reference: `tw-library.png`.

## Layout
- Head with "New entry".
- Sections (tabs with counts): Trade notes, Daily journals, Playbooks, Templates, Tags.
- Left list: search, filter chips (result, setup, account), entries with title, P&L, meta line and excerpt;
  selected entry ringed.
- Right: the entry with kind, title, meta, tags and body sections; "Open trade" for trade notes, Edit.

## Data
- Trade notes: journal entries with `tradeId`, plus review notes (`list_trade_review_summaries`).
- Daily journals (Build 22): the account's **daily reviews** from `list_daily_reviews` (canonical: one per account and
  trading day), newest first, filtered All / Drafts / Completed. Each row: long date, status, "Plan written afterwards"
  for a retrospective plan, "Trades changed since", plan adherence, the day's closed-trade outcome (or "No-trade day" /
  "No trades recorded"), the key lesson; actions **Resume draft** (drafts) or **Open** and **Edit** (completed; Edit is
  unavailable for an archived account). **Review today** and **Review a day** open any day. All open the same review as
  Today and By day ([14-daily-review.md](14-daily-review.md)).
- Earlier day notes: journal entries without `tradeId` written before daily reviews, in a collapsed "Earlier day
  notes" section with their Rust-derived trading day and a link to that day's review. Read only, never counted or
  converted as reviews, so nothing is shown twice.
- Playbooks, templates and tags: `get_review_library`, `save_strategy`, `save_checklist`, `save_tag`,
  `set_library_archived` (Build 20). Nothing is deleted; archiving keeps past reviews' labels.
- Search is client-side to start; move to SQLite FTS if it gets slow.
