# Build 26.85 screenshots

Native Windows debug build (`npm run dev:test-journal`, WebView2) on the synthetic test journal, branch
`feat/build-26-85-window-size-themes`. Display: 3440 × 1440 at 100% scaling (`devicePixelRatio` 1). Screenshots show
the top of each page.

What is real and what is emulated:

| Files | Viewport | How |
|---|---|---|
| `*-1024-*` | 1024 × 640 | Native window size |
| `*-800-*`, `dialog-verify-balance-800x480-dark` | 800 × 480 | Native window size (the new minimum) |
| `*-760-*` | 760 × 480 | **Viewport emulation** (CDP device metrics) inside the native WebView: the window can't go below 800 px |
| `*-light-*`, `*-dark-*` | as above | **Emulated** `prefers-color-scheme` on the native WebView (the OS was not switched) |
| `contrast-forced-*`, `contrast-forcedlight-*` | 1024 × 640 | **Emulated** `forced-colors: active` (dark and light system palettes), not a real Windows contrast theme |

Files: `{route}-{width}-{dark|light}-{expanded|collapsed}.jpg`. Below 900 px the sidebar rail is enforced, so the
800 and 760 shots are all collapsed. No page scrolled sideways at any size (document width = viewport − scrollbar).
Not tested here: 125–200% scaling, real contrast themes, 200% text enlargement, NVDA, moving between monitors
([window-support-matrix.md](../../window-support-matrix.md)).

Before: the previous minimum was 1024 × 640, so there is no 800 or 760 "before"; the 1024 before is in
[`../p0-d29/`](../p0-d29/) (`after-*-1024-*`, the base of this branch). Before this change the app was always dark.
