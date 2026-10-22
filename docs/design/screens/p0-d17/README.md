# P0-D17 before/after screenshots

Card: [P0-D17: calendar proportions and day-details panel height](https://app.notion.com/p/4011bd4b6bde81ab8621cde26c6bdcbf).

Captured with headless Microsoft Edge (Chromium) on Windows at `devicePixelRatio` 1, from the real `App` served by
Vite over the in-memory test store (synthetic data: one USD attempt with a long name; February, March and October
2026; one unknown-P&L trade on Oct 20). Not the WebView2 desktop build, and other Windows scaling factors were not
tested. Before = `main` `773f522`; after = `feat/p0-d17-calendar-proportions`.

A Monday–Friday month has 4 or 5 rows, never 6: February 2026 is the 4-row case, March and October 2026 are 5-row.

| File | What it shows |
|---|---|
| `before-1440-oct-5rows-day.jpg`, `before-1440-feb-4rows.jpg`, `before-1920-oct.jpg` | Shallow 64 px cells; the panel ends above the month's bottom edge |
| `after-1440-oct-5rows-day.jpg` | 5 rows, cells about 107 × 86 px; panel as tall as the month; average over 5 known trades |
| `after-1440-feb-4rows-insufficient.jpg` | 4 rows; a 3-trade day reads "Insufficient data", 3 of 5 needed |
| `after-1440-mar-5rows-average.jpg` | A 6-trade day with an average |
| `after-1440-oct-gross-unknown.jpg` | Gross basis label; a day with an unknown P&L (1 of 3 known: insufficient) |
| `after-1440-oct-noselection.jpg` | No day chosen: the hint fills the full-height panel |
| `after-1920-oct.jpg` | Wide window: cells capped at 128 px tall |
| `after-1024-oct-stacked.jpg` | Main column under 880 px: the panel stacks under the month at its own height |
