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
- Freshness disclosure and a Cards/List view are separate cards; this layout leaves room for both.
- P0-D22: "How fresh this is" is a `DisclosureCard`. It starts closed, showing the title, "Checked against your records
  at …" and a chevron; the header button opens the rows downward in the flow. The choice lasts for the window session
  (through Check again, data refreshes and account changes) and opening it reads nothing. While closed, anything a row
  would flag (trades or import history unreadable, last import failed, checkpoints unreadable, the last estimate for
  another trading day) is listed under the header as "Needs attention", and the checkpoint-conflict and discrepancy
  notices always stay visible. Check again stays outside the card, above it.

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

## Display time zone (P0-D05)
"Checked against your records at", "Last trade recorded" and "Last import" show in the display time zone (Settings →
Date and time; default: the computer's zone), converting the whole instant with that date's offset and labelled with
it ("Oct 22, 2026, 00:13 GMT+1"). A line under the list names the zone and that the other times and trading days use
the account's zone. Until the preference is read those three show "…", never a time in another zone. "Trading day
now", the checkpoint and estimate times stay in the account's zone. Other timestamps in the app (Accounts, Journal,
imports, rulebooks) are unchanged: follow-up.

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
