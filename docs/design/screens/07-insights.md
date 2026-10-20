# 7 · Insights

**Card:** Build 23 (Insights explorer and contributing-trade drill-down). Needs 14, 17/18, 20.
Mockup: `Reports.dc.html` (labelled Reports). References: `reports-alltime.png`, `tw-reports-overview.png`,
`ts-trade-log.png`.

## Purpose
Learn from traceable evidence: every metric resolves to the exact trades that produced it.

## Layout
- Head: Net / Gross toggle, filters (accounts, trading-day range, symbol root, direction, setup/strategy, tag,
  source, account status: active, failed, passed, closed, archived).
- Section menu: Overview; Calendar ([04](04-calendar.md)); Breakdowns (day, week, month); Tags (setups,
  mistakes) once Build 20 stores them.
- Overview: best, worst and average month; two `StatList`s (trades; days and months); weekday breakdown;
  setups and mistakes table.
- Every number, bar and row is clickable and opens the contributing trades (drill-down to Build 20).

## Metric rules (from Build 23)
- Closed trades only; equity/P&L curve from known closed trades.
- Zero denominator shows N/A, never 0% (profit factor with no losses, win rate with no decided trades).
- No implicit FX: mixed currencies are grouped per currency or marked unsupported.
- R multiple only where a review recorded planned risk.
- Insufficient sample: show raw data and withhold unstable metrics with an explanation.
- Aggregations are pure TypeScript selectors with exact-decimal arithmetic and deterministic fixtures (or Rust
  with parity), never computed inside chart components.

## Not in Build 23's inventory
Hour-of-entry and hold-time breakdowns from the mockup: propose as a Triage card or add to Build 23 only if the
card is updated. Cash ROI, payouts and reset costs belong to Build 28.4 (P1).
