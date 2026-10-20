# 3 · Journal: by day and trade log

Mockup: `Journal.dc.html` (switch views with the segmented control). References: `journal-entries.png`,
`tw-daily-journal.png`, `trade-log-logs.png`, `ts-trade-log.png`, `tz-trade-log.jpg`.

## Purpose
Review trading day by day, with notes, and browse every trade in one table.

## By day (default)
- One collapsible card per trading day, newest first; the latest day expanded, others collapsed. "Collapse all".
- Header: long date, account badge(s), plan adherence badge, Add note, Collapse/Expand (`aria-expanded`).
- Stats strip: net P&L (large `Pnl`), trades, win rate, gross P&L, contracts, fees, winners, losers, profit factor.
- Expanded: cumulative P&L through the day (`EquityCurve`, `step={false}`), session notes (plan, review, tags),
  and the day's trades in a `DataTable`: result, side, symbol, open, close, qty, entry, exit, hold, net P&L,
  tags. First 8 rows, then "Show all n".
- Collapsed: date, net P&L, "n trades · win rate · account", Expand.

## Trade log
- KPI row (`StatTile`): net P&L, win rate, profit factor, average win / average loss.
- `DataTable`: select, result, symbol, side, entry time, exit time, entry, exit, qty, net P&L, tags, account.
  Toolbar: search (symbol, tag, note), filter chips (result, side, tags), time-zone note. Default sort entry time
  descending; pager with rows per page 10/25/50/100.
- Row click opens Trade detail ([10](10-trade-detail.md)).

## Data
- `list_trades(accountId)` per selected account, grouped by `tradingDay` (never by local date).
- Notes: `list_journal_entries(accountId)`; a day's plan and review are entries without `tradeId` whose `entryAt`
  falls in that trading day. Tags come from entry tags.
- Day stats are display aggregations (exact sums with `sumMoney`); win rate and profit factor are ratios.
- Hold time from `entryAt`/`exitAt`; for imported performance rows use `roundTrip.durationSeconds` when present.

## States
- No trades in range: "No trades between {range}" with Import trades and Add trade.
- Open trades: result "Open", P&L `—`.
- `pnlStatus` other than `calculated`: show the note badge from `TradeTable` (Broker P&L, No instrument, Currency
  mismatch) and exclude unknown P&L from sums, saying so.

## Decisions
- Times in the account's time zone; the day is the account's trading day.
- Imported trades keep source values; edits go through `update_trade`.

## Open questions
- Plan adherence ("Followed plan") needs a field or tag convention: a journal-entry tag is the simplest start.
