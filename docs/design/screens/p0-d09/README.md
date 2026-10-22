# P0-D09 before/after screenshots

All shots run the real app (routes, providers, design system, wizard) on the frontend test store
(`src/test/app-store.ts`, one synthetic account) instead of the Tauri bridge, the same seam the journey tests use.
Previews are the Rust-generated golden cases in `test_csvimport/build17/normalization-v1.json`, so every status and
reason shown is engine output. This is not the native WebView2 build, and Windows DPI settings other than 100% were
not tested.

- **Before** (`*.jpg`, `main` at `773f522`): in-app browser pane, 1280 × 800 CSS viewport, saved downscaled to
  800 × 500.
- **After** (`*.png`): headless Chrome at 1280 × 1400 (or 800 × 1500), `devicePixelRatio` 1, full size. The extra
  height shows the whole table without scrolling. Dark follows Windows dark mode; light is forced with
  `preferredColorScheme`.

| File | Shows |
|---|---|
| `before-generic-1280-dark.jpg` | Generic file: a grid of selects with no status |
| `before-generic-after-one-edit-1280-dark.jpg` | After changing one column, the whole Match columns panel disappears until "Check the file again" |
| `before-performance-1280-dark.jpg` | Performance export (the card's screenshot): raw field ids, columns pushed to the far right |
| `after-generic-1280-{dark,light}.png` | Field, the CSV column beside it, and the status: aliases Matched, `P&L` Needs review ('Profit' also fits), unmapped optionals Not mapped |
| `after-generic-edited-shared-column-1280-dark.png` | After choosing `P&L` for Fees with the keyboard: re-checked by Rust, so both fields say the column is used twice (review, not blocking) |
| `after-missing-required-1280-{dark,light}.png` | No Side column: Action required with Rust's reason; Review rows disabled |
| `after-performance-1280-dark.png` | Recognized export: fixed columns beside readable field names, read-only |
| `after-generic-800-dark.png` | 800 px window (the minimum; icon rail): the three columns still fit |
