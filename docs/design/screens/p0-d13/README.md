# P0-D13 before/after screenshots

Native Windows debug build (WebView2) on a synthetic test journal (`seed-demo-journal --anchor 2026-10-21`), Insights
on `DEMO · Evaluation 50K (CSV imports, London time)`, 59 trades, Net P&L. The CSS viewports (1280 × 800, 1920 × 1080
and 3440 × 1440) were set over the DevTools protocol (`Emulation.setDeviceMetricsOverride`, device scale factor 1), with
the sidebar expanded and collapsed.

Before: `before-{width}-{expanded|collapsed}.jpg`, the stepped `EquityCurve` with the chart-width fix already applied
(the same result #95 landed on main). It has no axes, ticks or tooltip.

After:

- `after-stepped-{width}-{expanded|collapsed}.jpg`: the default. Y axis "Cumulative net P&L (USD)" with round ticks
  and a dashed zero line; X axis "Closed trades (exit order)" with trade-number ticks from 0 (the start of the
  selection). Tick density follows the width.
- `after-smooth-{width}-{expanded|collapsed}.jpg`: the same points joined by a monotone curve, with the note under the
  chart that positions between points are not results.
- `after-tooltip-1920-{expanded|collapsed}.jpg`: keyboard focus on the chart; the tooltip reads the observed trade
  (number, symbol, trading day, result, running total), kept inside the plot.

The page did not scroll horizontally at any size. The plot still reaches the card's inner right edge
(as #95 fixed): at 1920 expanded the card is 280–1873 and the line 361–1842 (14 px right gutter for the end dot and the last
tick label; the Y labels and title take the left 64 px).
