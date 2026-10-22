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
