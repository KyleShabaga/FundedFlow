# 7 · Insights

**Card:** Build 23 (Insights explorer and contributing-trade drill-down). Needs 14, 17/18, 20.
Mockup: `Reports.dc.html` (labelled Reports). References: `reports-alltime.png`, `tw-reports-overview.png`,
`ts-trade-log.png`.

## Purpose
Learn from traceable evidence: every metric resolves to the exact trades that produced it.

## Layout
- Section tabs first (P0-D16), directly under the page title on every view: Overview, Calendar, Breakdowns, Tags
  (only with tags), Attempts. One tab list for the page; the section stays in `?section=` with the sidebar.
- Head: Net / Gross toggle, filters (accounts, trading-day range, symbol root, direction, setup/strategy, tag,
  source, account status: active, failed, passed, closed, archived).
- Section menu: Overview; Calendar ([04](04-calendar.md)); Breakdowns (day, week, month, symbol, weekday, side,
  source, strategy); Tags (setups, mistakes, mindset, other; only when a selected trade has a tag); **Attempts**
  (historical and reset-attempt comparison, added by the Build 23 card's history section).
- Overview: best, worst and average month; two `StatList`s (trades; days and months); weekday breakdown;
  setups and mistakes table.
- Width (P0-D29): the shared content frame, up to 1600 px; the calendar's day panel moves under the month below
  880 px of main column (was 1100 px of window). [window-support.md](../window-support.md).
- Closed-trade P&L curve (P0-D13): `RunningTotalChart`. Y axis "Cumulative net P&L" or "Cumulative gross P&L" with
  the selection's currency code; X axis "Closed trades (exit order)" with trade-number ticks, equally spaced, from 0 at
  the start of the selection. A zero line, ticks thinned to the width, and a tooltip on hover or arrow keys that reads
  each observed trade (number, symbol, trading day, result, running total), matching the Table view. A Stepped |
  Smooth control (Stepped by default) is saved in settings as `insights.curve_style`. Smooth is a monotone cubic
  through the same points, so it never rises above or dips below the two trades it joins; a note under the chart
  says positions between points are not results. Unknown-P&L trades are left out, as before, never bridged as zero.
- Every number, bar and row is clickable and opens the contributing trades (drill-down to Build 20).

## Metric rules (from Build 23)
- Closed trades only; equity/P&L curve from known closed trades.
- Zero denominator shows N/A, never 0% (profit factor with no losses, win rate with no decided trades).
- No implicit FX: mixed currencies are grouped per currency or marked unsupported.
- R multiple only where a review recorded planned risk.
- Insufficient sample: show raw data and withhold unstable metrics with an explanation.
- Aggregations are pure TypeScript selectors with exact-decimal arithmetic and deterministic fixtures (or Rust
  with parity), never computed inside chart components.

## Not in Build 23's inventory
Hour-of-entry and hold-time breakdowns from the mockup: propose as a Triage card or add to Build 23 only if the
card is updated. Cash ROI, payouts and reset costs belong to Build 28.4 (P1).

## As built (Build 23)
- Accounts: a picker with status checkboxes and an explicit "Include archived attempts" switch; the default selection is
  the active account; several attempts can be chosen and stay separate. Choices (accounts, basis, filters, section,
  calendar month/day, period, chain grouping) live in the URL.
- Every figure opens the **contributing-trades drawer** (`features/insights/components/ContributingTrades.tsx`) with
  the exact trades and totals recomputed from them; rows open `/journal/trades/:id?account=`.
- Attempts tab: per-attempt rows (own currency), optional reset-chain grouping that lists every included attempt, pass
  rate over resolved selected attempts with the left-out count, reported failure reasons as the user's words.
- Definitions, states and tests: [build-23-insights.md](../../architecture/build-23-insights.md).
