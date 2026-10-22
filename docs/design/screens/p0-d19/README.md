# P0-D19 before/after screenshots

Native Windows debug build (`tauri dev` on the isolated test journal, WebView2) with the synthetic UI Smoke preset
(`dev-test-journal.mjs seed --preset ui_smoke --seed 2609 --anchor 2026-10-20`), dark theme, sidebar expanded at 1280
and collapsed by the app at 860. One estimate was calculated on Today for the "on track" account; its engine balance
is unknown (history not stated complete), so its row shows the latest checkpoint. Before = main `773f522`; after =
`feat/p0-d19-accounts-current-balance`. The window was sized so the WebView client area equals each width; 100%
scaling (`devicePixelRatio` 1). Screenshots are scrolled to the table or card toolbar.

| File | Shows |
|---|---|
| `before-accounts-table-1280.jpg`, `before-accounts-table-860.jpg` | Starting balance column; search above the status filter |
| `after-accounts-table-1280.jpg` | Current balance column (checkpoints with their time, — with the reason); status filter and search on one row |
| `after-accounts-table-860.jpg` | Narrow: search wraps to its own line, right-aligned; the table scrolls sideways inside its card |
| `after-accounts-cards-1280.jpg`, `after-accounts-cards-860.jpg` | Cards view toolbar, same arrangement |

A current engine balance ("From your records · {as-of}") is covered by `overview-cards.test.tsx`, not shown here.
