# P0-D29 before/after screenshots

Native Windows debug build (`npm run dev:test-journal`, WebView2) on the synthetic test journal (DEMO accounts from
Add Fake Data). Before = main `eb2a63c`; after = `feat/p0-d29-content-frame`. The window was sized so the WebView
client area equals each viewport below; the monitor is 3440 × 1440 at 100% scaling (96 DPI, `devicePixelRatio` 1), so
these are real CSS viewports, not browser emulation. Other scaling factors were not tested here
([window-support-matrix.md](../../window-support-matrix.md)). Screenshots show the top of each page only.

Files: `{before|after}-{route}-{width}-{expanded|collapsed}.jpg`. Today at every size with the sidebar expanded and
collapsed; Journal, Insights, Accounts, Settings and Import at 1280 and 3440 with the sidebar expanded.

Measured left–right edges in CSS px (the page scrollbar takes 15 px):

| Viewport | Sidebar | Before: title … Import | Before: body | After: title … Import |
|---|---|---|---|---|
| 1024 × 640 | expanded | 280 … 977 | 280–977 | 272 … 985 (gutter 24 px, main column < 880 px) |
| 1280 × 800 | expanded | 280 … 1233 | 280–1233 | 280 … 1233 (unchanged) |
| 1440 × 900 | expanded | 280 … 1393 | 280–1393 | 280 … 1393 (unchanged) |
| 1920 × 1080 | expanded | 280 … 1873 | 280–1873 | 280 … 1873 (frame 1600 px exactly fills) |
| 1920 × 1080 | collapsed | 104 … 1873 | 104–1704 | 189 … 1789 (centred) |
| 2560 × 1080 | expanded | 280 … 2513 | 280–1880 | 597 … 2197 (centred) |
| 3440 × 1440 | expanded | 280 … 3393 | 280–1880 | 1037 … 2637 (centred) |
| 3440 × 1440 | collapsed | 104 … 3393 | 104–1704 | 949 … 2549 (centred) |

After, the body uses the same edges as the title and Import at every size. No viewport scrolled horizontally before
or after.
