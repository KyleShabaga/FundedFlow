# Window support: manual acceptance matrix

For the owner and the [P0-08](https://app.notion.com/p/4001bd4b6bde81449ad2f2d620c350b5) release gate (final run:
[NA-5](https://app.notion.com/p/4001bd4b6bde812194bdd8bc48f232d0)). Policy: [window-support.md](window-support.md).
Pass/fail columns are blank on purpose: nothing below is claimed until someone runs it on a packaged build.

Record for every run: installer or build SHA, Windows version, WebView2 version, physical display resolution, OS
scaling, actual content viewport (CSS px), app zoom, theme, screenshots.

| Build / SHA | Windows | WebView2 | Display | Tester | Date |
|---|---|---|---|---|---|
| | | | | | |

## P0-D29: content frame and ultrawide

Sidebar expanded and collapsed for each row. Pass when the page title, account selector, Import and body share one
left and one right edge; content is centred beside the sidebar; nothing scrolls sideways; text lines and label/value
pairs stay readable.

| # | Check | CSS viewport | Scaling | Expanded | Collapsed | Notes |
|---|---|---|---|---|---|---|
| D1 | Today, Journal, Insights, Accounts, Settings, Import | 1280 × 800 | 100% | | | |
| D2 | Same routes | 1440 × 900 | 100% | | | |
| D3 | Same routes | 1920 × 1080 | 100% | | | |
| D4 | Same routes | 2560 × 1080 | 100% | | | |
| D5 | Same routes on a real ultrawide display, maximised | 3440 × 1440 | 100% | | | |
| D6 | Same routes | 1024 × 640 | 100% | | | |
| D7 | Today with one, two, four and eight active accounts: card columns, long names, Unknown and setup states | 1920 and 3440 wide | 100% | | | |
| D8 | Today freshness: values stay beside their labels, no clipped badge or link | 1280, 1920, 3440 wide | 100% | | | |
| D9 | Resize continuously from 1024 to the widest window: no jump, no lost account selection, form text or filter | — | 100% | | | |
| D10 | Toggle the sidebar (Ctrl+B) on a page with a half-filled form (daily review, rulebook editor): nothing resets | 1280 × 800 | 100% | | | |
| D11 | Keyboard: Tab order on Today follows freshness → accounts → selected account → risk at 1920 wide | 1920 × 1080 | 100% | | | |

## Build 26.85: minimum window, scaling, text and themes

From the [Build 26.85 card](https://app.notion.com/p/4001bd4b6bde81f5a7afd69ce4516213)'s manual acceptance matrix.
"Core workflows" = add an account, Quick import a CSV and confirm, the import wizard to the confirm bar, open a trade
and save its review, daily review save, rulebook edit and save, Verify balance, Settings export, first-run agreement.

| # | Check | Window / viewport | Scaling | Theme | Pass/fail | Notes |
|---|---|---|---|---|---|---|
| W1 | Core workflows at the 800 px minimum | 800 × 480 | 100% | Light | | |
| W2 | Same | 800 × 480 | 100% | Dark | | |
| W3 | Same | 800 × 480 | 125% | Light and dark | | |
| W4 | Same | 800 × 480 | 150% | Light and dark | | |
| W5 | Same, on a display with enough physical room | 800 × 480 | 200% | Light and dark | | |
| W6 | Expanded layout, sidebar expanded and collapsed | 1024 × 640 and 1280 × 800 | 100% | Light and dark | | |
| W7 | Resize continuously across 900 px (sidebar rail) and across each filter's fold point: selection, counts and focus kept | 800 → 1280 | 100% | Dark | | |
| W8 | 480 px height: every primary and dialog action reachable (Verify balance, Add account, delete confirmations, export), validation summaries visible, vertical scroll only | 800 × 480 | 100% | Dark | | |
| W9 | Maximised 1920 × 1080 display at 200%, with taskbar and window decorations: nothing cut off | ≈ 960 × 540 logical | 200% | Light and dark | | |
| W10 | 200% text enlargement (Settings › Accessibility › Text size) in forms, filters, tables, validation, dialogs, recovery screens; record the mechanism used | 1280 × 800 and 800 × 480 | 100% | Dark | | |
| W11 | 760 px resilience: record limits, don't call it supported | 760 wide (the window can't go below 800 logical px: use device emulation in a debug build's WebView2 DevTools) | 100% | Dark | | |
| W12 | Follow the system while running: switch Windows app mode light ↔ dark with FundedFlow open, including an open dialog and the render-failure screen | 1280 × 800 | 100% | Both | | |
| W13 | Theme preference persistence after restart | — | — | — | N/A in V1 | No in-app theme setting; the OS mode is read at every start (proposed P1: in-app Appearance setting) |
| W14 | Aquatic contrast theme: focus ring, selected route/tab/segment/day, borders, Safe/Caution/Stop/Unknown, meters, dialogs | 1280 × 800 and 800 × 480 | 100% | Contrast | | |
| W15 | Desert contrast theme: same | same | 100% | Contrast | | |
| W16 | Dusk contrast theme: same | same | 100% | Contrast | | |
| W17 | Night sky contrast theme: same | same | 100% | Contrast | | |
| W18 | Long account names, large and negative money values, loading/empty/error states, keyboard navigation and visible focus | 800 × 480 and 200% text | 100% | Light and dark | | |
| W19 | Move the window between monitors with different scaling (for example 100% ↔ 150%) | — | Mixed | Dark | | |
| W20 | NVDA: navigation rail names, folded filter dropdowns ("Show rows, combo box"), table scroll regions | 800 × 480 | 100% | Dark | | |

Not done in development (for the owner): every row above. The development run used one 3440 × 1440 display at
100% and viewport/media emulation for 760 px, light, dark and forced colours; see the Build 26.85 pull request.
