# 4 · Calendar with month/year selector

**Card:** Build 23 (Insights: calendar view). The MonthYearPicker is a Build 13 primitive. If Build 23 does not
cover a calendar view, raise a Triage card.

Mockup: `Calendar.dc.html` (picker open by default). References: `tw-calendar.png`, `ts-calendar.png`.

## Purpose
See P&L by trading day, week, month and year, and jump to any of them.

## Layout
1. Page head with a segmented control: Net P&L / Trades / Win rate (what the cells show).
2. Month card: previous, **month title button** (opens `MonthYearPicker`), next, Today; month P&L and
   "n trades · n trading days" on the right.
3. Grid: Monday–Friday plus a Week column. Each day: date, compact P&L, trade count; tinted `profit-soft` /
   `loss-soft` with a matching border; today ringed in `flow`; selected day ringed and shown in the side panel.
4. Selected-day panel (`StatList`): date, P&L, trades, account, notes; "Open in journal". Beside the month; under it
   below 880 px of main column (P0-D29).
5. Yearly performance: a row per year, a cell per month (P&L, trades) plus a year total; click a month to jump.

## MonthYearPicker
Year stepper with YTD P&L; 3×4 months tinted by P&L; current month ringed; months after the current one disabled;
months without trades dimmed but selectable. Picking a month closes the popover.

## Data
- Insights' included-trade set for the selected filters, summed per `tradingDay` with `sumMoney`; every cell
  drills down to its trades (Build 23 rule). A day whose trades include an
  unknown P&L shows `—` and is not tinted.
- Months and years are sums of days. A Rust aggregation command can replace this when history grows.

## Decisions
- Weeks run Monday to Friday; weekend activity belongs to Monday's trading day (data-model.md). The existing
  `PnlCalendar` already hides weekends; extend it (selection, ring, picker) instead of building a second calendar.
- Compact money (`formatMoneyCompact`) in cells only; full amounts in the panel.

## Open questions
- Should the Week column also show the week's win rate?

## As built (Build 23)
- `PnlCalendar` gained `selectedDay`, `onSelectWeek`/`selectedWeek`, `display` and `title`/`summary` slots instead of a
  second calendar; the `MonthYearPicker` is the title. Week cells open the week's trades.
- A day, week, month or year containing a trade with an unknown P&L shows `—` and no tint; the panel shows the known part
  and the unknown count.
- The selected-day panel links each attempt's daily review (`/journal/days/:day?account=`) with its status.
- Open question resolved: the week cell shows P&L and trade count; win rate shows in the cell only in Win rate mode.
