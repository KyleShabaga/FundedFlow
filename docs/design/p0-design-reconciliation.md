# P0 design reconciliation (Build 25.1)

Card: [P0 Design Reconciliation — Complete Five Missing V1 Screen Families](https://app.notion.com/p/4001bd4b6bde814c8d02c13b11222728),
with its detailed cards for [Rulebook](https://app.notion.com/p/4001bd4b6bde819493a7d8bd936f5b97),
[Daily review](https://app.notion.com/p/4001bd4b6bde817d9765d953ae1fd5d6) and
[Settings](https://app.notion.com/p/4001bd4b6bde81a38e42ea7cdb7047b1). Design only: no code, command or data change.

Boards: [`mockups/p0/`](mockups/p0/) (source, canvas index and PNG previews). Audit base: `main` at `fc2880f`
(Oct 21, 2026), the specs in `screens/`, and the React features in `apps/desktop/src/features`.

## 1. Inventory before this work

| Family | Route(s) on main | Spec | Mockup before | Built? | What was missing |
|---|---|---|---|---|---|
| Rulebook | `/accounts/:id/rulebook`, `…/versions/:vid` | 13 | None | Yes (Build 19) | Any visual design; readiness summary; draft/active distinction; simulation framing |
| Daily review | `/journal/days/:day?account=` | 14 | None | Yes (Build 22) | Visual hierarchy; checklist answer design; trades placement |
| Settings | `/settings` | 15 | None | Yes (Build 25) | Structure for future settings; export/delete hierarchy; dialog states |
| Account detail | `/accounts/:id` | 02 (list only) | None (list mockup only) | Yes (Build 15) | Layout spec; figures; rules and risk; recent trades/imports; lifecycle |
| Quick import / history | `/import/quick`, `/import/history` (details: drawer) | 06 | Wizard only (`Import.dc.html`) | Yes (Builds 18, 18.5) | Quick import, history and details design; failure catalogue |

Outdated in older mockups (not authoritative, unchanged): Home page, "Dashboard" label, "Add trade" and "Import CSV"
primary header button, top-bar P2 items, the old sidebar groups. The P0 boards use the shell on main: Today, Journal
(By day, Trade log, Library), Insights, Accounts, Settings; text-only **Import** header menu.

## 2. Spec section → board

| Spec section | Board(s) | Status |
|---|---|---|
| 13 Overview (block A), version states | 1A | Designed, all 7 states |
| 13 Editor (B), validation, unsaved edits, conflict | 1B, 1E (leave, discard) | Designed |
| 13 Compare (C) | 1C | Designed |
| 13 Preview (D) | 1D simulation | Designed |
| 13 Review and publish (E), Verify, Assign | 1E | Designed |
| 13 Calculation explanation (F), freshness, empty | 1D | Designed |
| 13 Keyboard and focus | 1A–1F notes, spec "P0 design" | Documented |
| 14 Route and identity, selection differs | 2A, 2D | Designed |
| 14 Layout: head, summary, form, trades, history | 2A | Designed |
| 14 States (new … not a trading day) | 2A (6), 2D (12) | Designed |
| 14 Saving and unsaved changes | 2A bar, 2D | Designed |
| 15 Layout (four sections) | 3A | Designed, plus section nav and reserved group |
| 15 Restore dialog states | 3C | Designed, 6 states, 4 rejection reasons |
| 15 Deletion dialog, blocked, cleanup | 3D | Designed |
| 15 Behaviour: one operation at a time | 3A exporting state | Designed |
| 02 Account detail (Build 15 decisions, 18.5 fields) | 4A, 4B | Designed |
| 02 Lifecycle: edit, status, archive/restore, new attempt, delete | 4B, 3D | Designed |
| 06 Quick import (18.5) | 5A | Designed, 9 states |
| 06 Import history, details | 5B, 5C | Designed |
| 06 Failure states | 5D | Designed, 13 cases |
| Narrow windows (all) | 1F, 2E, 3E, 4C, 5E | Designed at 720 px |

## 3. Consistency pass (against Today, Journal, Insights, Accounts as built)

- [x] Shell: same sidebar, toggle, submenus, header (title, account selector `space-3` below, Import menu).
- [x] Nested pages show a breadcrumb; the h1 names the nested page (proposed change: replaces back links).
- [x] Page section titles 18 px, card titles 15 px, body 14 px, labels 12 px; numbers in JetBrains Mono.
- [x] Cards on `bg-100` with `line-100` hairlines; shadows only on dialogs, drawers, menus, sticky bars.
- [x] One primary button per view; destructive actions are loss outlines; confirmations focus Cancel.
- [x] Tables: `DataTable` styling (uppercase 11 px headers on `bg-200`, right-aligned mono numbers, scroll in card).
- [x] Notices use the `InlineNotice` tones; toasts only for finished actions.
- [x] Badges and status pills always carry words; Unknown is a dashed outline; no colour-only meaning.

## 4. Data honesty

- [x] No figure is calculated in a mockup that Rust doesn't return; boards reuse the overview-card, engine and import
  fields listed in specs 02, 06 and 13.
- [x] Unknown is "—" or "Unknown" with a reason; never `$0.00`, never Safe. No-trade outcome reads "Not $0.00".
- [x] Estimates say "Verify with your firm's dashboard"; simulation is framed and prefixed "Simulated:".
- [x] Process adherence, recorded outcome and firm-rule status are separate facts on every board.
- [x] All values are illustrative examples (canvas note and README).

## 5. Accessibility

- [x] Real buttons, links, inputs and labels in every board; icon buttons named; radio groups labelled per item.
- [x] Focus: visible 2 px `flow` ring; dialog initial focus shown; return-focus rules written in specs.
- [x] Live regions: save status lines, comparison counts, checking/installing states; errors as alerts.
- [x] Disabled actions keep a reason (tooltip and description).
- [x] Contrast: only existing token pairs (tested by `tokens.test.ts`).
- [ ] Screen-reader and keyboard walk-through on the built screens after each UI PR (not possible on mockups).

## 6. Components

Reused: AppFrame, BrandLogo, Button, IconButton, Tabs, Badge, StatusIndicator, RuleStateBadge, RulebookLine,
MetricCard, StatList, LabeledValue, ProgressMeter, DataTable, InlineNotice, ValidationSummary, FormSection, TextField,
Textarea, Select, RadioGroup, Checkbox, Dialog, ConfirmDialog, Drawer, DropdownMenu, Tooltip, FileDropzone, Skeleton,
EmptyState, ErrorState, Toast, DestructiveActionDialog, AccountOverviewCard view model.

New (small): header breadcrumb slot; RadioGroup cards layout; ChangeMark; simulation frame class; Settings section
navigation. See [components.md](components.md#p0-design-patterns-build-251).

## 7. Engineering needed before some designs can be built exactly

| Item | Needed for | Owner |
|---|---|---|
| Export history (more than the last export) | Settings export history | Backend (Build 24 follow-up) |
| Local data folder path | Settings "Stored" fact | Backend |
| Per-account status in archive manifest | Restore preview account list | Backend |
| Undo for a whole import | Import details | Backend |
| `/import/history/:batchId` route | Deep links to one import | Frontend routing (new route) |
| Account size label (`account_size_micros`) | Account identity line | Backend |
| Per-account totals command | Account detail and Accounts list at scale | Backend |

## 8. Open questions

1. Breadcrumbs replace the back links on nested pages: approve as a shell change?
2. Rulebook readiness strip: count None/Off rules apart from "can be calculated" (as drawn)?
3. Daily review "Missed" in warn, never loss (as drawn)?
4. Import history "All accounts" view: worth the per-account reads, or wait for a summary command?
5. Settings "App" group: show planned items now (dimmed) or hide until built?

## 9. Not completed

Nothing in scope was skipped. Light theme variants were not drawn: V1 ships the dark theme, and every board uses
tokens only, so the light theme follows from `data-theme`.
