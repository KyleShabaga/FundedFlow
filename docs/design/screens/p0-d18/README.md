# P0-D18 before/after screenshots

Card: [P0-D18: Filters button beside the calendar's Win rate selector](https://app.notion.com/p/4011bd4b6bde81dfbcade85b6184b772).

Captured with headless Microsoft Edge (Chromium) on Windows at `devicePixelRatio` 1, from the real `App` served by
Vite over the in-memory test store (synthetic data: one USD attempt with a long name, October 2026, one unknown-P&L
trade). Not the WebView2 desktop build, and other Windows scaling factors were not tested. Before = `main` `773f522`;
after = `feat/p0-d18-calendar-filters-button`. Screenshots show the top of each page only.

| File | What it shows |
|---|---|
| `before-1440-filters.jpg`, `before-1024-filters.jpg` | The old always-visible filter bar above the account line, and the cell choice further down |
| `after-1440-closed-nofilters.jpg` | Filters closed, nothing applied: no count, no summary |
| `after-1440-closed-filters.jpg`, `after-1024-closed-filters.jpg` | Closed with 3 groups applied (range, side, source): `Filters · 3`, the summary and Clear filters |
| `after-1440-open.jpg`, `after-1024-open.jpg`, `after-800-open.jpg` | Open: the same controls in flow between the toolbar and the calendar; open style and turned chevron |
| `after-overview-1440-unchanged.jpg` | Overview keeps the filter bar as before |

No horizontal overflow at 1440, 1024, 800 or 640 px with the panel open (document, `main` and panel `scrollWidth`
equal their `clientWidth`).
