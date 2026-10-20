# 10 · Trade detail and review

Mockup: `TradeDetail.dc.html`. References: `ts-trade-detail.png`, `tw-trade-history.png`, `tz-trade-log.jpg`.

## Layout
- Breadcrumb (Journal / day / trade n), symbol, side and result badges, net P&L; previous/next within the day.
- Left: price chart with entry and exit markers; Review card: Mark as reviewed, execution rating (1–5 radio group),
  mindset chips, setup chips, mistake chips, notes.
- Right: Summary `StatList` (account, trading day, quantity, entry → exit, hold, gross, fees, net, P&L source),
  Source fills (round-trip IDs, timestamps exactly as exported, which fill opened the trade, tick size; read only),
  Screenshot drop zone.

## Data
- Trade: `list_trades` / a `get_trade` command; `roundTrip` for the source fills.
- Review fields need storage: `trade_reviews`, `trade_review_tags` and `attachments` are reserved tables in
  migration 1. Add commands for them (a migration only if the reserved shape does not fit).
- Notes can start as a journal entry with `tradeId` until reviews exist.

## Decisions
- No candles in V1 (no market data). Draw entry and exit from the fills on a price axis; label the limitation.
- Source values are immutable and shown as exported.
