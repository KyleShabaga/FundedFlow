# 8 · Today

**Card:** Build 21 (Today risk dashboard with data freshness and drawdown headroom). Needs 14, 15.5, 16, 17/18, 19.
Mockups: `Main.dc.html` (labelled Dashboard) and `Home.dc.html` (all-accounts ideas). References:
`tw-dashboard-metrics.png`, `tz-dashboard.png`, `tw-home.png`.

## Purpose
Answer "What is my remaining risk buffer, and can I trust this estimate?" for each active account. Today is the
default route; there is no separate Home.

## Layout
1. **Freshness first**: last imported trade, last verified firm balance checkpoint, last calculated snapshot,
   effective trading day, incomplete-history flag. Each labelled; they are not interchangeable.
2. **All accounts** (default when several are selected): one card per active attempt with status
   **Safe / Caution / Stop / Unknown** (text + icon + colour), rulebook version and setup completeness. Never a
   single combined "all clear".
3. **One account**: last known balance, realized net P&L, target progress, daily-loss room, drawdown floor and
   headroom, consistency and minimum days where supported. Each value opens a calculation explanation
   (formula, inputs, contributing trades, rulebook version, engine version, limitations).
4. Actions: Import CSV, Add account, Verify balance against firm dashboard, Review rulebook, View trades,
   Review session.
5. From the canvas, kept: KPI tiles (net P&L, win rate, profit factor, average win/loss) as a secondary,
   clearly realized-only section; `EquityCurve` of closed trades with the drawdown floor only when the engine
   supplies it; recent days (`DayCard`).

## States (all distinct)
No account, needs setup, unknown rulebook, no trades, import processing, partially supported rule, stale input,
discrepancy with the firm dashboard, calculation error, mixed multi-account state, valid zero headroom.

## Rules
- Estimates only: "Estimate. Verify with your firm's dashboard." No language implying permission to trade or
  compliance.
- Unrealized P&L, live peak equity and intraday trailing drawdown are Unknown without that data; never inferred
  from closed-trade exports.
- Failed, passed, closed and archived attempts stay out of Today; a reset attempt starts Unknown.
- No risk formulas in React: values come from Build 16 snapshots via Build 14 hooks.
- Rule display follows `RuleState` ([components.md](../components.md#rulestate)).
