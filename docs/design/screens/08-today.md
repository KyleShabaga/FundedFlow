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

## Responsive layout (P0-D29)
Today fills the shared content frame ([window-support.md](../window-support.md)); nothing is reordered.
- From 1280 px of main column, freshness (5 of 12 columns) sits beside the panel after it in reading order: Active
  accounts, or, with one active attempt, the account summary with the risk estimate under it. CSS placement only:
  nothing is reordered or remounted. Below that everything stacks.
- The freshness list shows two columns of label/value rows when each gets 420 px, so values stay near their labels.
- Active accounts: 1 to 4 columns by the section's own width (from 560, 880 and 1200 px); cards stay about
  270–560 px wide.
- Freshness disclosure is a separate card; this layout leaves room for it.

## Cards / List (P0-D23)
- A **Cards | List** segmented control (`SegmentedControl`, named "Active accounts layout") sits beside the Active
  accounts heading. Cards is the default; the choice is saved in settings as `today.accounts_view` (`"cards"` or
  `"list"`, anything else reads as Cards) and applies at once even if the save fails (a toast says so).
- Both views render the same entry per account, in the same order: name and lifecycle status, the estimate status
  (Safe / Caution / Stop / Unknown) with its last recorded and last estimate lines, rulebook and setup, the reset note,
  and Show (or "Shown below") with the Account link. Repeated actions are named for their account ("Show Eval B",
  "Account: Eval B"). Switching views never selects an account or changes the details below.
- List: one compact row per account. From 880 px of the section's own width the row has four aligned groups
  (identity, estimate, rulebook and setup, actions in a fixed 11rem column); below that the name and actions share the
  first line and the rest wraps under them. Long names wrap; nothing truncates.

## States (all distinct)
No account, needs setup, unknown rulebook, no trades, import processing, partially supported rule, stale input,
discrepancy with the firm dashboard, calculation error, mixed multi-account state, valid zero headroom.

## Rules
- P0-D21: the general note ("Estimate. Verify with your firm's dashboard. Today reads only what is saved on this
  computer; it is not connected to your broker or firm.") is the page footer, after every section (also on the
  no-account page). **Check again** stays at the top, right-aligned above the freshness panel. Figure-specific
  Unknown, stale and setup notices stay with their figures.
- Estimates only: "Estimate. Verify with your firm's dashboard." No language implying permission to trade or
  compliance.
- Unrealized P&L, live peak equity and intraday trailing drawdown are Unknown without that data; never inferred
  from closed-trade exports.
- Failed, passed, closed and archived attempts stay out of Today; a reset attempt starts Unknown.
- No risk formulas in React: values come from Build 16 snapshots via Build 14 hooks.
- Rule display follows `RuleState` ([components.md](../components.md#rulestate)).

## As built (Build 21)
Details, traceability and the "current" rules: [build-21-today.md](../../architecture/build-21-today.md).
- The selected account is the header's active account; the all-accounts cards appear when there are several active
  attempts (or none is chosen) and switch it only on **Show**. Failed, passed, closed, paused and archived attempts
  are listed under "Not in today's risk".
- A saved estimate counts as current only for the Rust trading day now, with unchanged inputs, nothing dated after
  its cutoff and the same rulebook version; otherwise the headline is Unknown (a recorded Stop stays Stop) and the
  figures say "Not current".
- **Verify balance** records a user-reported checkpoint and can run the exact Build 15.5 comparison. **Review
  session** (Build 22) opens the selected account's daily review for its current trading day as Rust reports it
  (`list_daily_reviews`); it reads "Continue review" when that day has a draft and "Open review" when it is completed,
  and is unavailable with its reason while the day can't be read. It never waits for, refreshes or changes the risk
  estimate. The equity curve with the floor is not drawn (no floor series stored).
