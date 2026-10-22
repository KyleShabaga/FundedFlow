# P0-D14 before/after screenshots

Same setup as [P0-D30](../p0-d30/README.md): native Windows debug build (WebView2) on a synthetic test journal
(`seed-demo-journal --anchor 2026-10-21`), Insights on `DEMO · Evaluation 50K (CSV imports, London time)`, 59 trades,
Net P&L, CSS viewports of 1280 × 800, 1920 × 1080 and 3440 × 1440 with the sidebar expanded and collapsed. Before = main
`3921ffb`; after = `feat/p0-d14-metric-info-popups`. Each capture centres the headline metric cards.

Files:

- `{before|after}-{width}-{expanded|collapsed}.jpg`: the five headline cards.
- `after-info-average-r-{width}-{expanded|collapsed}.jpg`: the Average R "i" open. It's the rightmost card, so this
  shows the popup opening toward the side with room, with its N/A reason still on the card.
- `after-info-net-pnl-1920-{expanded|collapsed}.jpg`: the Net P&L "i" open.
- `after-info-profit-factor-900-expanded.jpg`: a 900 px window (sidebar expanded, cards in two columns). The popup
  lines up with its trigger's right edge and stays inside the window.

Height of the headline card row (`.in-kpis`), CSS px:

| Viewport | Sidebar | Before | After |
|---|---|---|---|
| 1280 | expanded | 394 (two rows) | 261 (two rows) |
| 1280 | collapsed | 189 | 132 |
| 1920 | expanded / collapsed | 169 | 113 |
| 3440 | expanded / collapsed | 169 | 113 |

No page scrolled horizontally, before or after.
