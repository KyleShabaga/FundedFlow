# 12 · Economic calendar

Mockup: `EconCalendar.dc.html`. Reference: `econ-calendar.png`.

## Layout
- Head with "Only countries for my instruments" (e.g. MNQ, MES → US).
- Filters: importance (All / Medium and high / High only), range (Today + tomorrow / This week).
- `DataTable` grouped by day: time (account zone), country code, impact (three bars: low grey, medium amber, high
  red, each with an `aria-label`), event, actual, forecast, prior, tag (Next, In your session). A line marks now.
- Side: events during the user's usual session window; each account's news rule as `RuleState`
  (e.g. "Manual check" for a no-trading-around-news restriction).

## Data
- **No source yet.** The app is offline-first and has no network access in the data layer. Options: a manually
  imported calendar file, or an opt-in fetch behind a Rust command with the source named in Settings. Decide
  before building; do not embed a third-party widget.
- "Usual session window" can come from trade entry times (e.g. the middle 80% over the last 30 days).
