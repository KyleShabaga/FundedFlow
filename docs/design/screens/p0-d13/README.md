# P0-D13 before/after screenshots

Same setup as [P0-D30](../p0-d30/README.md): native Windows debug build (WebView2) on a synthetic test journal
(`seed-demo-journal --anchor 2026-10-21`), Insights on `DEMO · Evaluation 50K (CSV imports, London time)`, 59 trades,
Net P&L. CSS viewports are 1280 × 800, 1920 × 1080 and 3440 × 1440, set over the DevTools protocol, with the sidebar
expanded and collapsed.

This branch is stacked on P0-D30, so its **before** is P0-D30's after:
[`../p0-d30/after-*.jpg`](../p0-d30/). That chart has no axes, ticks or tooltip.

After:

- `after-stepped-{width}-{expanded|collapsed}.jpg`: the default. Y axis "Cumulative net P&L (USD)" with round ticks
  and a dashed zero line; X axis "Closed trades (exit order)" with trade-number ticks from 0 (the start of the
  selection). Tick density follows the width.
- `after-smooth-{width}-{expanded|collapsed}.jpg`: the same points joined by a monotone curve, with the note under the
  chart that positions between points are not results.
- `after-tooltip-1920-{expanded|collapsed}.jpg`: keyboard focus on the chart; the tooltip reads the observed trade
  (number, symbol, trading day, result, running total), kept inside the plot.

The page did not scroll horizontally at any size. The plot still reaches the card's inner right edge
(P0-D30): at 1920 expanded the card is 280–1873 and the line 361–1842 (14 px right gutter for the end dot and the last
tick label; the Y labels and title take the left 64 px).
