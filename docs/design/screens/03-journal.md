# 3 · Journal: by day and trade log

**Card:** Build 20 (trade journal, trade detail and review); plan, review and adherence: Build 22. Needs 14.
Manual trade entry and correction live here and on Today (Build 6), not in the header.

Mockup: `Journal.dc.html` (switch views with the segmented control). References: `journal-entries.png`,
`tw-daily-journal.png`, `trade-log-logs.png`, `ts-trade-log.png`, `tz-trade-log.jpg`.

## Purpose
Review trading day by day, with notes, and browse every trade in one table.

## By day (default)
- One collapsible card per trading day, newest first; the latest day expanded, others collapsed. "Collapse all".
- Header: long date, net P&L, "n trades · win rate", Collapse/Expand (`aria-expanded`).
- Daily review row (Build 22, [14-daily-review.md](14-daily-review.md)): review status (No review / Draft / Completed),
  plan adherence ("Plan adherence 75% · 3/4", or "—" when Unknown), "Trades changed since" when the review's trades
  changed, and **Plan / review day**, **Continue review** or **Open review**. Adherence is process only, beside but
  separate from the day's P&L.
- Stats strip: net P&L (large `Pnl`), trades, win rate, gross P&L, contracts, fees, winners, losers, profit factor.
- Expanded: cumulative P&L through the day (`EquityCurve`, `step={false}`) and the day's trades in a `DataTable`:
  result, symbol, side, source (Imported/Manual), open, close, qty, entry, exit, hold, net P&L, tags, review. First 8
  rows, then "Show all n". The day's plan and reflection open in its daily review.
- Days with a review but no trades (a no-trade day, or trades not imported yet) are listed in date order as compact
  cards. The bar has **Review a day** (a date field; Monday to Friday) to plan or review any day, including one with
  no trades; an account without trades offers **Review today**.
- Collapsed: date, net P&L, "n trades · win rate · account", Expand.

## Trade log
- KPI row (`StatTile`): net P&L, win rate, profit factor, average win / average loss.
- `DataTable`: result, symbol, side, source, trading day, entry time, exit time, qty, entry, exit, net P&L, tags,
  review. The Journal shows one account (the active one), so there is no account column, and no bulk action needs a
  select column yet. Toolbar: search (symbol, tag, strategy, note), result filter with counts, a Filters popover (side,
  source, review status, strategy, tag, day range), time-zone note. Default sort entry time descending; pager with rows
  per page 10/25/50/100. Deleted trades are listed from the footer and can be restored.
- Row click opens Trade detail ([10](10-trade-detail.md)).

## Data
- `list_trades(accountId)` per selected account, grouped by `tradingDay` (never by local date).
- Review status, strategy and tags per trade: `list_trade_review_summaries(accountId)` (Build 20).
- Daily reviews: `list_daily_reviews(accountId)` (status, adherence and the current Rust trading day per account);
  the review is keyed by account and stored trading day. Earlier day notes (entries without `tradeId`) are listed in
  the Library with their trading day derived by Rust, never treated as reviews.
- Day stats are display aggregations (exact sums with `sumMoney`); win rate and profit factor are ratios.
- Hold time from `entryAt`/`exitAt`; for imported performance rows use `roundTrip.durationSeconds` when present.

## States
- No trades in range: "No trades between {range}" with Import trades and Add trade.
- Open trades: result "Open", P&L `—`.
- `pnlStatus` other than `calculated`: show the note badge from `TradeTable` (Broker P&L, No instrument, Currency
  mismatch) and exclude unknown P&L from sums, saying so.

## Decisions
- Times in the account's time zone; the day is the account's trading day.
- Imported trades keep source values; corrections go through `update_trade` with the revision they started from and
  are recorded in the trade's correction history.
- Manual trade entry: Add trade on the Journal opens the trade form (account time zone; P&L computed on save).

## Open questions
- Plan adherence is the daily review's (Build 22) and stays separate from P&L (Build 6) and from firm rules.
