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
| `AccountCard` | Accounts, Cards view |
| `WinGauge` | Dashboard win-rate tile |
| `EquityCurve` | Dashboard balance, Journal day, Trade detail |
| `PnlCalendar` | Home (small); the Calendar screen extends it (see MonthYearPicker) |
| `DayCard` | Journal recent days, Home |
| `TradeTable` | Simple trade lists; the Journal uses `DataTable` with trade columns |

## New patterns to add first

Add each to the design system with a `README`-style comment, tests and a gallery section before a screen uses it.
Names are suggestions.

### AppShell, Sidebar
- Layout: sidebar + main column. Sidebar 248 px expanded, 72 px collapsed (icons only, `title` and `aria-label` on
  each link). Toggle button in the sidebar header; shortcut Ctrl+B. Remember the state in `settings` (or local
  storage until settings commands exist).
- Groups: **Journal** (Home, Dashboard, Journal, Library, Trade log, Calendar, Reports), **Accounts** (Accounts,
  Import trades), **Tools** (Economic calendar); Settings at the bottom with a "Saved on this computer" status.
- Active item: `flow-soft` ground, `flow` text, `aria-current="page"`. Counts in mono, `ink-faint`.
- Below ~760 px wide the sidebar collapses automatically.

### TopBar
Left: Search (opens a command palette, Ctrl+K), account multi-select, date range. Right: DayTimer, SessionClock,
Feedback, Notifications (unread count badge), Theme (System / Dark / Light), divider, primary "Add trade".
Wraps to two rows when narrow. Spec: [screens/01-app-shell.md](screens/01-app-shell.md).

### SessionClock + TradingSessions popover
Button "{CC} {Session} · HH:MM" in `flow`; opens a popover (`role="dialog"`, Escape and outside click close it):
current session, display-time-zone select (defaults to the account's zone), one row per market session with bars
on a 00–24 axis and a now line, footer "New York closes in 2h 23m. Sydney opens in 2h 23m."
Session hours come from a table with time zones (they move with daylight saving), not fixed UTC hours.

### DayTimer
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
