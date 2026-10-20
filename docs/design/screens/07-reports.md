# 7 · Reports

Mockup: `Reports.dc.html`. References: `reports-alltime.png`, `tw-reports-overview.png`, `ts-trade-log.png`.

## Purpose
Where P&L comes from: by date, time, instrument, setup and mistake.

## Layout
- Page head: Net P&L / Gross P&L toggle, Export CSV.
- Section menu (left): Overview; Date: Day, Week, Month; Time: Hour of entry, Hold time; Market: Instrument;
  Tags: Setups, Mistakes; Prop rules: Rule usage.
- Overview:
  1. `StatTile` ×3: best month, worst month, average month.
  2. Two `StatList`s. **Trades**: total P&L, trades, winners, losers, break-even, average win, average loss,
     average trade, largest win, largest loss, commissions, fees, profit factor. **Days and months**: trading
     days, winning days, losing days, average day, best day, worst day, best month, worst month, average month,
     average hold (all, winners, losers), days at a daily-loss limit.
  3. By weekday (Mon–Fri bars diverging from zero) and by hour of entry (bars above/below a zero line).
  4. Setups and mistakes `DataTable`: tag, kind, trades, win rate, average trade, net P&L, share bar.

## Data
- Needs a Rust stats command (e.g. `get_report(accountIds, range, basis)`) so totals are exact and consistent
  with stored values; a TypeScript calculation must follow the parity-test rule in packages.md.
- Hour of entry and weekday use the account's time zone and trading day.
- Setups and mistakes need review tags ([10](10-trade-detail.md)); until then use journal-entry tags.

## Decisions
- Gross = net + commissions + fees; the toggle changes every money value on the page.
- Unknown P&L is excluded and counted ("3 trades without P&L are not included").
