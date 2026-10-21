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
- Trade notes: journal entries with `tradeId`. Daily journals: entries without `tradeId`. `list_journal_entries`.
- Trade notes also include review notes (`list_trade_review_summaries`). Daily journals are listed read only until the
  daily review (Build 22).
- Playbooks, templates and tags: `get_review_library`, `save_strategy`, `save_checklist`, `save_tag`,
  `set_library_archived` (Build 20). Nothing is deleted; archiving keeps past reviews' labels.
- Search is client-side to start; move to SQLite FTS if it gets slow.
