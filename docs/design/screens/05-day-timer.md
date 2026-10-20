# 5 · Day-ending timer

Mockups: `DayTimer.dc.html`, `TimerStates.dc.html`. Reference: `day-timer.png`.

## Purpose
Show how long until the account's trading day resets, when daily loss limits start over.

## Behaviour
- One account selected: counts down to its next reset: `tradingDayResetTime` in its `timezone`. A reset of 00:00
  is midnight; 12:00–23:59 opens the next day's session (data-model.md, trading day).
- Several accounts: show the soonest reset; clicking opens a popover listing each account's reset time, zone and
  countdown.
- States: `flow` (more than 1 hour), `warn` (last hour), `loss` (last 15 minutes), neutral grey when closed for the
  weekend ("Market closed · opens Sun 5:00 PM").
- At zero: "New trading day" for one minute, then counts to the next reset; daily-loss values on screen refresh.
- Accessibility: `role="timer"`, `aria-live="off"`; full sentence in `aria-label`; tooltip "Your account's trading
  day resets at 5:00 PM CT. Daily loss limits reset then."

## Implementation notes
- The trading-day calculation is in Rust. Either add a small command (`next_trading_day_reset(accountId, now)`)
  or a parity-tested TypeScript function in `@fundedflow/domain`; do not hand-roll time-zone maths in a component.
- Tick once a second only while visible; no per-second re-render of the whole top bar.

## Open questions
- Weekend detection: use the instrument calendar or a fixed Friday-close / Sunday-open rule per account?
