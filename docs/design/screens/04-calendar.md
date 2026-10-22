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
4. Selected-day panel (`StatList`): date, P&L, trades, win rate, average per trade (P0-D17), fees, account; "Open in
   journal". Beside the month and as tall as it (P0-D17); under it below 880 px of main column (P0-D29).
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

## As built (P0-D17)
- Proportions: the panel column is 300–380 px (was 280–340), and day cells follow their width at 5:4 between 76 and
  128 px tall (were a fixed 64 px minimum), so a cell is about 107 × 86 px at a 1440 px window. The Week column and
  the Monday–Friday rows are unchanged. A Monday–Friday month has 4 or 5 rows: six never occur, because the sixth week
  of a 31-day month holds only a weekend.
- The month and the panel share one row height while side by side (grid stretch, no fixed heights); the month keeps
  its rows at their own height. The panel keeps the date and statistics at the top and puts "View n trades" and the
  daily-review links in one action area at the bottom. Stacked, the panel takes only its content's height.
- **Average net per trade** / **Average gross per trade** (follows the basis): the existing Insights expectancy from
  `summarize`, the same figure as Breakdowns' "Avg trade" and parity-tested against Rust. It is the sum of known net
  (after fees) or gross results divided by the trades with a known P&L; unknown results are left out, never zero.
  Below the 5-trade minimum it reads "Insufficient data" with "n of 5 needed"; with only unknown results, "Unknown";
  with a value, a note says what it averaged ("Over 5 of 6 trades; 1 with an unknown P&L left out"). The note moves to
  an info pop-up once MetricCard's help pattern exists. Screenshots: [p0-d17](p0-d17/README.md).
