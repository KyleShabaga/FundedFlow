# 8 · Dashboard

Mockup: `Main.dc.html`. References: `tw-dashboard-metrics.png`, `tz-dashboard.png`.

## Layout
1. Head: title, accounts and range subtitle, Net/Gross toggle.
2. KPI row: net P&L (`Pnl` xl, fees under it), win rate (`WinGauge`), profit factor, average win / average loss
   with a two-colour ratio bar.
3. Balance card (`EquityCurve`) for one selected account: drawdown floor (dashed loss) and profit target (dashed
   profit) with a legend. With several accounts selected: cumulative P&L, no floor.
4. Rules today: rulebook line, `RuleMeter`s for supported rules, `RuleState` badges for the rest
   (Needs setup with an action, None, Off, Manual check).
5. High-impact events today (from [12](12-economic-calendar.md)).

## Data
- Stats as in Reports. Balance points from trades in order; the floor and rule usage come from rule evaluation
  (Build 16). Until it lands, show the target line and the rulebook values but no trailing floor.
