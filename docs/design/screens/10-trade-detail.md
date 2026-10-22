# 10 · Trade detail and review

**Card:** Build 20. Candles and chart UI: Builds 42–43 (P2); V1 draws entry and exit from fills only.
Screenshots/attachments: Build 20; storage errors keep the text journal intact (Build 6).

Mockup: `TradeDetail.dc.html`. References: `ts-trade-detail.png`, `tw-trade-history.png`, `tz-trade-log.jpg`.

## Layout
- Breadcrumb (Journal / day / trade n), symbol, side and result badges, net P&L; previous/next within the day.
- Left: Review card: process (checklist adherence), outcome (net P&L) and R-multiple shown apart; Review status (a
  `Checkbox tile` "Reviewed", with "Not saved yet" while the draft differs from the saved review) beside execution
  rating (`RadioGroup segmented` 1–5, unrated until chosen, with Clear rating; P0-D24); strategy and checklist with per-item Followed/Missed/Not applicable; setup, mistake,
  mindset and other tag chips (`ChipGroup`); planned entry, stop, target and risk; plan/thesis and notes/reflection;
  then Screenshots. No price chart in V1 (see Decisions).
- Right: Summary `StatList` (account, trading day, quantity, entry → exit, hold, gross, fees, net, P&L source),
  Import source (file, line, original CSV row), Source fills (round-trip IDs, timestamps exactly as exported, which
  fill opened the trade, tick size; read only), Correction history.
- Actions: previous/next trade (the account's trades in entry order), Correct trade, Delete (Undo; kept with its review).
- Width (P0-D29): Left and Right sit side by side from 880 px of main column and stack below (was 1080 px of window);
  [window-support.md](../window-support.md).

## Data
- Trade: `get_trade_detail(accountId, id)` (provenance, original CSV cells, corrections, neighbours).
- Review: `get_trade_review` / `save_trade_review`; screenshots: `add_trade_screenshot`, `read_trade_screenshot`,
  `remove_trade_screenshot` (Build 20, migration 17).

## Decisions
- No candles in V1 (no market data). Build 20 draws no chart at all: entry and exit prices and times are listed, and a
  round trip is not an execution record, so nothing is reconstructed or drawn from invented prices.
- Source values are immutable and shown as exported.
