# 11 · Journal library

Mockup: `Library.dc.html`. Reference: `tw-library.png`.

## Layout
- Head with "New entry".
- Sections (tabs with counts): Trade notes, Daily journals, Playbooks, Templates.
- Left list: search, filter chips (result, setup, account), entries with title, P&L, meta line and excerpt;
  selected entry ringed.
- Right: the entry with kind, title, meta, tags and body sections; "Open trade" for trade notes, Edit.

## Data
- Trade notes: journal entries with `tradeId`. Daily journals: entries without `tradeId`. `list_journal_entries`.
- Playbooks and templates: `strategies`, `checklists`, `checklist_items` are reserved tables; show empty states
  explaining what each is until they have commands.
- Search is client-side to start; move to SQLite FTS if it gets slow.
