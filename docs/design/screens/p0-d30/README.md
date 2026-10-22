# P0-D30 before/after screenshots

Native Windows debug build (WebView2) against this branch's Vite dev server, on a synthetic test journal seeded with
`seed-demo-journal --anchor 2026-10-21`. The Insights selection is `DEMO · Evaluation 50K (CSV imports, London time)`,
59 trades, Net P&L, as in the P0-D29 captures. The viewport was set with the DevTools protocol
(`Emulation.setDeviceMetricsOverride`, device scale factor 1), so these are CSS viewports of 1280 × 800, 1920 × 1080 and
3440 × 1440. Before = main `773f522`; after = `feat/p0-d30-pnl-chart-width`. Each capture is scrolled to centre the
closed-trade P&L card.

Files: `{before|after}-{width}-{expanded|collapsed}.jpg`.

Measured left–right edges in CSS px. The card has a 1 px border and 16 px padding, so its inner right edge is the card's
right edge minus 17. The page scrollbar takes 15 px.

| Viewport | Sidebar | Card | Before: line | After: line |
|---|---|---|---|---|
| 1280 | expanded | 280–1233 | 297–1124 | 297–1216 |
| 1280 | collapsed | 104–1233 | 121–1107 | 121–1216 |
| 1920 | expanded | 280–1873 | 297–1700 | 297–1856 |
| 1920 | collapsed | 189–1789 | 206–1615 | 206–1772 |
| 3440 | expanded | 1037–2637 | 1054–2463 | 1054–2620 |
| 3440 | collapsed | 949–2549 | 966–2375 | 966–2532 |

Before, the line stopped 10% short of the plot width. `EquityCurve` reserved a 64/640 gutter for its floor and target
labels even when it drew neither. After, the line ends on the card's inner edge at every size. The page did not scroll
horizontally at any size, before or after.
