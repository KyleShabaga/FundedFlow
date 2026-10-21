# Components for the screens

## Already in the design system

`apps/desktop/src/design-system` exports these; use them, do not redraw them. Props and rules:
[`../design-system.md`](../design-system.md).

| Component | Used on |
|---|---|
| `Button` | Everywhere (one `primary` per view) |
| `Badge` | Results, sides, phases, rule states, tags |
| `Pnl` | Every money value |
| `StatTile` | Dashboard, Journal, Reports, Accounts KPI rows |
| `Tabs` + `TabPanel` | Journal views, Library sections, Reports basis |
| `RuleMeter` | Dashboard rules, Accounts mini meters (via `ruleState`) |
| `AccountOverviewCard`, `ProgressMeter` | Accounts, Cards view (Build 18.5; `AccountCard` stays in the gallery) |
| `WinGauge` | Dashboard win-rate tile |
| `EquityCurve` | Dashboard balance, Journal day, Trade detail |
| `PnlCalendar` | Home (small); the Calendar screen extends it (see MonthYearPicker) |
| `DayCard` | Journal recent days, Home |
| `TradeTable` | Simple trade lists; the Journal uses `DataTable` with trade columns |

Build 13 added the patterns below; props and usage are in [`../design-system.md`](../design-system.md#build-13-forms-feedback-async-states-and-data-display).

| Component | Used on |
|---|---|
| `TextField`, `Textarea`, `SearchField`, `Checkbox`, `Switch`, `RadioGroup`, `Select`, `FieldGroup`, `FormSection`, `ValidationSummary` | Accounts, rulebook editor, trade editor, Import options, Settings |
| `ChipGroup` (Build 20) | Trade review setup, mistake and mindset tags |
| `IconButton`, `SegmentedControl` | Pagers, row menus, Table/Cards and filter switches |
| `Dialog`, `ConfirmDialog`, `Drawer`, `Popover`, `DropdownMenu`, `Tooltip` | Editors, destructive confirmations, calculation breakdowns, column chooser, row menus |
| `InlineNotice`, `ToastProvider`/`useToast`, `StatusIndicator` | Every screen |
| `StateBoundary` and the async-state set | Every data view |
| `DataTable`, `MiniMeter` | Accounts, Journal trade log, Import review, Insights |
| `MetricCard`, `LabeledValue`, `StatList` | Today, Insights, selected-day panel, Trade detail |
| `Stepper`, `FileDropzone` | Import |
| `MonthYearPicker` | Insights calendar |
| `RuleStateBadge`, `RulebookLine` | Accounts, Today rules |
| `ChartPanel` | Today, Insights, Trade detail |

## Build 6 component plan (owned by feature cards)

`AccountContextBar`, `GlobalFreshnessIndicator` (12/21), `AccountHealthCard`, `RiskStatusBadge` (Safe / Caution /
Stop / Unknown, text + icon + colour), `RiskMetricCard`, `DataFreshnessBadge`, `CalculationBreakdownDrawer` (21: built
from `StatusIndicator`, `MetricCard`, `StatList` and `Drawer` in `features/today`, no new primitives),
`RuleVersionTimeline`, `CalculationPreview` (19: built as the Activity tab, `VersionComparison`, `EvidencePreview` and `CalculationExplanation` in `features/rulebooks`), `ColumnMappingTable`, `ValidationIssueList`, `DuplicateReview`,
`ImportSummary` (18), `TradeEditor`, `ChecklistReview`, `AttachmentManager`, `SessionReviewForm` (20, 22),
`FilterBar`, `ChartPanel`, `ContributingTradesDrawer` (23: built in `features/insights` from `Drawer`, `StatList` and `DataTable`; Build 23 added `PnlBars` to the design system), `BackupRestorePanel`, `DestructiveActionDialog` (25).
Build 13 also owns the async-state set: `LoadingState`, `EmptyState`, `ErrorState`, `UnavailableState`,
`StaleDataNotice`, `MutationFeedback`, `StateBoundary`.

## New patterns from the canvas (Build 13 unless noted)

The Build 13 patterns below are in the design system: DataTable, MiniMeter, RuleState (as `RuleStateBadge` and
`RulebookLine`), MonthYearPicker, StatList, Stepper and Popover. These specs stay the reference for their look and
behaviour. Build 12, Triage and P2 patterns remain with their cards.

### AppShell, Sidebar (Build 12)
- Layout: sidebar + main column. Sidebar 248 px expanded, 72 px collapsed (icons only, `title` and `aria-label` on
  each link). Toggle button in the sidebar header; shortcut Ctrl+B. Remember the state in `settings` (or local
  storage until settings commands exist).
- Navigation: **Today** (default), **Journal**, **Insights**, **Accounts**, with **Settings** at the bottom and a "Saved on this computer" footer. No Import item or fabricated counts.
- Active item: `flow-soft` ground, `flow` text, `aria-current="page"`.
- Below ~760 px wide the sidebar collapses automatically.

### Header (Build 12)
Page title, reserved AccountContextBar (account selector, filters), text-only **Import** menu. Wraps when narrow.
Search, feedback, notifications, theme switching, DayTimer and SessionClock are **not** Build 12: see the table
in [screens/01-app-shell.md](screens/01-app-shell.md#not-in-build-12-do-not-build-here).

### SessionClock + TradingSessions popover (P2, Build 41)
Button "{CC} {Session} · HH:MM" in `flow`; opens a popover (`role="dialog"`, Escape and outside click close it):
current session, display-time-zone select (defaults to the account's zone), one row per market session with bars
on a 00–24 axis and a now line, footer "New York closes in 2h 23m. Sydney opens in 2h 23m."
Session hours come from a table with time zones (they move with daylight saving), not fixed UTC hours.

### DayTimer (Triage)
Pill counting down to the account's trading-day reset: `flow` normally, `warn` from 60 minutes, `loss` from 15
minutes, neutral grey when the market is closed. `role="timer"`, no live announcements every second; tooltip names
the reset time. Spec: [screens/05-day-timer.md](screens/05-day-timer.md).

### DataTable
Card with an optional toolbar (search, filter chips or a segmented filter with counts, bulk actions when rows are
selected, Columns menu), sticky header, sortable headers (`aria-sort`, one sort at a time), row selection with a
select-all checkbox, optional row click, numbers right-aligned in mono, footer with "Showing a–b of n", rows per
page and a pager. Horizontal scroll inside the card when narrow. Used by Accounts, Journal trade log, Import,
Reports and the Economic calendar.

### MiniMeter
Compact rule bar for table cells: "$2,200 / $3,000" + "$800 left", 6 px track. Colour via `ruleState` (amber at
70%, red at 100%, `profit` for targets).

### RuleState
How a rule shows when it is not a plain meter, from the rulebook's tagged presence and support status:

| Rulebook | Shows |
|---|---|
| `value` + `supported` | `RuleMeter` |
| `support_status = needs_setup` | `Badge tone="warn"` "Needs setup" + action to add the missing value; never a meter |
| `explicit_none` | `Badge` "None" |
| `disabled` | `Badge` "Off" |
| `not_applicable` | Hidden, or "Not applicable" in detail views |
| `manual_only` | `Badge tone="flow"` "Manual check" |
| `unsupported` | `Badge` "Not tracked" |

Also a rulebook line: "Rulebook {name} · v{n}" with Verified / Needs review / Account rules (private).

### MonthYearPicker
Popover from the month title: year stepper with year-to-date P&L, 3×4 months tinted by P&L, current month ringed,
future months disabled, months without trades dimmed. Previous/next month buttons and Today beside the title.

### StatList
`<dl>` of label and value rows (values in mono, coloured by sign when money). Reports and selected-day panels.

### Stepper
Numbered steps with done, current (`aria-current="step"`) and upcoming states. Import.

### Popover
Surface on `bg-100`, `line-200` border, `shadow-pop`, `radius-lg`. Used by the picker, sessions, columns menu,
notifications. Built on Radix (already a dependency).
