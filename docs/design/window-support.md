# Window support and responsive layout

One policy for every screen, from the smallest supported window to ultrawide: **minimum → compact → expanded → cap**.
Cards: [P0-D29 ultrawide content width](https://app.notion.com/p/4011bd4b6bde813a9333ceead94c567c) (the content frame,
this page's first half) and [Build 26.85 window size, scaling and themes](https://app.notion.com/p/4001bd4b6bde81f5a7afd69ce4516213)
(the V1 support policy, compact layout and themes). The release gate that owns acceptance is
[P0-08](https://app.notion.com/p/4001bd4b6bde81449ad2f2d620c350b5); the manual checks are in
[window-support-matrix.md](window-support-matrix.md).

## V1 support policy (owner decision, NA-1 decision 6, 2026-10-21)

| | |
|---|---|
| Expanded layout | Optimised for windows **1024 logical px and wider** |
| Compact layout | Below 1024 px, as content requires |
| Minimum window | **800 × 480 logical px** target, final only with a working compact layout and packaged validation |
| Resilience only | **760 px**: checked, limits recorded, not promised |
| Windows scaling | 100%, 125%, 150%, 200% (a maximised 1920 × 1080 at 200% is about 960 × 540 logical px) |
| Text enlargement | 200%, checked separately from display scaling |
| Themes | Light, dark, follow the system, and the four Windows contrast themes |
| Shared components | Stay Tauri-free; 320 px web reflow is a later release |

## Measure the main column, not the monitor

Breakpoints are chosen from the CSS width actually available to content. Physical resolution, monitor size and
scaling factor are not inputs: at 100% scaling a 3440 × 1440 monitor gives a 3440 px CSS viewport, at 200% a
1920 × 1080 monitor gives 960 px, and both are handled by the same rules.

- The column beside the sidebar (`.ds-app-column`) is a CSS size container named **`ds-main`**. Page layouts use
  `@container ds-main (…)`, so collapsing the sidebar gives the page the extra 176 px at once, with no window-width
  media queries in page CSS.
- Only the sidebar's own auto-collapse reads the window width (`AppShell`'s `narrowQuery`), because the sidebar is
  part of the window rather than the page.
- A component that lays itself out by its own width (Today's Active accounts, the account overview card) uses its own
  named container.

## The content frame (P0-D29)

`ContentFrame` (`design-system/components/app-frame.tsx`, `.ds-content-frame`) wraps the page header's contents and
the page body. Title, account selector, Import and the body therefore share one left and one right edge.

| | Value | Why |
|---|---|---|
| Content cap | `--frame-max` = **1600 px** | The width Today, Journal, Insights, Accounts and Import already capped at, so standard windows don't change. At 1600 px Today's freshness and active accounts sit side by side; wider only adds distance between related items. |
| Centring | `margin-inline: auto` inside `ds-main` | Centred in the area beside the sidebar, never in the whole window |
| Gutter | `space-8` (32 px); `space-6` below 880 px of main column; `space-4` below 640 px | Existing spacing tokens |
| Header rule | Spans the main column | Only the header's contents sit on the frame |

The header and body frames are siblings, not one wrapper, so the header's divider can still span the column.

Pages narrower than the cap keep their own cap and start on the frame's left edge, aligned with the title:
Settings (data controls, 960 px), daily review (1200 px) and rulebook pages (1280 px) are forms and reading pages,
and a 1600 px form is harder to scan. Text keeps its own measure (`max-width` in `ch`: 52–100ch by component).
Nothing uses CSS `zoom`, transforms or a global font-size change to fill space.

## Breakpoints (main column width)

| `ds-main` width | What changes | Where |
|---|---|---|
| < 640 px | Gutter `space-4`; header and body vertical padding `space-4` | `design-system.css`, `shell.css` |
| < 880 px | Gutter `space-6`. Two-column page grids stack: account detail, journal trade detail, Insights calendar with its day panel, the import wizard's two panels | feature CSS |
| ≥ 880 px and < 1280 px | Today's freshness list shows its label/value rows in two columns | `today.css` |
| ≥ 1280 px | Today's lead row: freshness beside the panel that follows it in reading order (Active accounts, or the account summary when there is only one active account), 5 : 7 | `today.css` |

880 px is content-driven: the narrowest two-column page grid needs a main column of about 480 px plus a 320 px side
panel and a gap, which is 816 px of content plus 2 × 32 px gutters. 1280 px is where Today's 5 : 7 split gives the
freshness list about 500 px and Active accounts room for two cards of at least 270 px.

Before P0-D29 these were window-width media queries at 900 px (Accounts, Import), 1080 px (Journal) and 1100 px
(Insights), which ignored the sidebar: the same window stacked or not depending on whether the sidebar was open.

### Component-level widths

- **Today Active accounts** (`td-overview` container): 1 column below 560 px, 2 from 560, 3 from 880, 4 from
  1200 px of the section's own width. Cards stay roughly 270–560 px wide; a few accounts never stretch across an
  ultrawide frame.
- Grids of figures and cards elsewhere keep `repeat(auto-fit|auto-fill, minmax(…))` with their existing minimums.
- The account overview card has its own container breakpoints (460 and 300 px; Build 18.5).

## Compact layout, minimum window and themes (Build 26.85)

Not in this change; added by the Build 26.85 pull request stacked on it.

## Known limits

- The Insights closed-trade P&L chart draws at a fixed aspect inside its card, so at the 1600 px cap part of the card
  is empty to the right of the line (unchanged from before P0-D29). Proposed as a Triage card.
