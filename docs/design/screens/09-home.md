# 9 · Home

Mockup: `Home.dc.html`. Reference: `tw-home.png`.

## Layout
1. Greeting by time of day and one line on the last session.
2. Quick actions (pill links): Import trades, Add trade, Review today, Today's events, Check account rules.
3. Continue card: the last unreviewed trading day with its stats strip and "Open journal". Unreviewed = no review
   entry for that day.
4. Accounts today: each active account with its closest limit as a `MiniMeter`, and the `DayTimer`.
5. Recent days: four `DayCard`s.
6. Everything in FundedFlow: a tile per area.

## Data
Reuses Journal (days, entries), Accounts (rules) and the timer. No new commands.
