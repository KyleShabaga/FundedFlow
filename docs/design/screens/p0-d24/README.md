# P0-D24 before/after screenshots

Card: [P0-D24: Improve execution-rating and Reviewed controls in trade review](https://app.notion.com/p/4011bd4b6bde814aa9bdcb9f4d0b7155).

Captured with headless Microsoft Edge (Chromium) on Windows at `devicePixelRatio` 1. The pages are the real `App`
served by Vite over the in-memory test store, with synthetic data: one USD account and two manual trades, the first a
winner. These are not from the WebView2 desktop build, and other Windows scaling factors were not tested. Before is
`main` at `5600882`; after is `feat/p0-d24-review-controls`. Each screenshot shows the top of the trade page only.

| File | What it shows |
|---|---|
| `before-1280.jpg`, `before-760.jpg` | The old native Reviewed checkbox and 1–5 radio circles |
| `after-1280-unrated.jpg` | A winning trade opened fresh: not Reviewed and unrated ("Not rated"). Nothing is inferred from the P&L |
| `after-1280-draft.jpg`, `after-760-draft.jpg` | An unsaved draft with rating 4 and Reviewed ticked. The tile reads "Not saved yet…" and the summary Status still says Not reviewed |
| `after-560-draft.jpg` | Narrow window: Review status and Execution rating stack |
