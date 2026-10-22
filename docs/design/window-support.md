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
| ≥ 1280 px | Today: freshness (5 of 12 columns) beside the panel that follows it in reading order: Active accounts, or, with one active account, the account summary with the risk estimate under it. CSS placement only; nothing is reordered or remounted | `today.css` |

880 px is content-driven: the narrowest two-column page grid needs a main column of about 480 px plus a 320 px side
panel and a gap, which is 816 px of content plus 2 × 32 px gutters. 1280 px is where Today's 5 : 7 split gives the
freshness list about 500 px and Active accounts room for three cards.

**Trade-off at 1024 px.** With the sidebar open, a 1024 px window leaves a 761 px main column, so the two-column page
grids stack there; collapse the sidebar (Ctrl+B) and the 937 px column shows them side by side. Before P0-D29
Accounts and Import stayed two-column down to a 900 px window while Journal and Insights stacked below 1080/1100 px;
one rule now applies to all four. "Expanded layout from 1024 px" (Build 26.85) means full navigation, filters and
page structure, not that every grid is two-column.

Before P0-D29 these were window-width media queries at 900 px (Accounts, Import), 1080 px (Journal) and 1100 px
(Insights), which ignored the sidebar: the same window stacked or not depending on whether the sidebar was open.

### Component-level widths

- **Today freshness list:** two columns of label/value rows when each column gets 420 px
  (`repeat(auto-fit, minmax(min(420px, 100%), 1fr))`); a label wraps at half its column, so 200% text never squeezes
  the value away.
- **Today Active accounts** (`td-overview` container): 1 column below 560 px, 2 from 560, 3 from 880, 4 from
  1200 px of the section's own width. Cards stay roughly 270–560 px wide; a few accounts never stretch across an
  ultrawide frame.
- Grids of figures and cards elsewhere keep `repeat(auto-fit|auto-fill, minmax(…))` with their existing minimums.
- The account overview card has its own container breakpoints (460 and 300 px; Build 18.5).

## Compact layout (Build 26.85)

Below 1024 px of window the same pages run in a compact arrangement; nothing switches into a separate mode.

| Pattern | Rule | Where |
|---|---|---|
| Navigation | Below **900 px of window** the 72 px icon rail is enforced and the toggle is disabled with the name "Sidebar collapsed for narrow window"; at 900 px and wider the saved preference applies again. Every item keeps its icon, `aria-label`, tooltip and Tab stop; Journal and Insights views stay reachable from their page tabs. 900 = the 640 px compact main column + the 248 px sidebar + a scrollbar, so a saved "expanded" preference can never squeeze the page below the compact layout. | `AppShell` `narrowQuery` (the one window-width query) |
| Filters and view switches | `SegmentedControl` folds into a **labelled dropdown** (`Select`, label beside it) when its buttons' natural width no longer fits the row it sits in. Same options, counts as "Errors (1)", the caller's selection; focus moves to the dropdown if it was on the buttons. `overflow="scroll"` keeps #70's sideways scroll instead. Measured, not a breakpoint, so a longer label or a count change decides correctly. | `primitives.tsx`, `controls.css` |
| Cards, KPI rows, form sections | Stack by their own width: `repeat(auto-fit/auto-fill, minmax(min(N px, 100%), 1fr))` with the existing minimums; page grids stack below 880 px of main column. | feature CSS |
| Tables | Scroll sideways inside their own region: `role="group"`, named "{table}, scrolls sideways", `tabIndex=0`, visible focus. `DataTable` already did; `TradeTable`, the Insights yearly table and the rulebook version comparison now do too. The page never scrolls sideways. | `data.tsx`, `journal.tsx`, `CalendarSection.tsx`, `VersionComparison.tsx` |
| Short windows (< 600 px tall) | The header compacts (`space-3` padding, no 96 px minimum) and scrolls away with the page. Dialogs fit the window (`max-height: 100vh − 48px`), their body scrolls and the footer stays. Sticky action bars (first-run gate, Quick import, import wizard, daily review, rulebook editor) stay at the bottom of the scrolling page. Vertical scrolling is expected. | `shell.css`, `controls.css` |

### Filter decisions (dropdown or scroll)

All current `SegmentedControl`s use the default, **fold to a dropdown**; none needs `overflow="scroll"`.

| Control | Options | Observed in the native debug build |
|---|---|---|
| Accounts: Show (status filter) | 8 (Live, All, Active, Paused, Passed, Failed, Closed, Archived) with counts | Folds at 800 and 1024 px windows; buttons again at 1280 and wider; folds again when narrowed |
| Accounts: Layout | Table, Cards | Buttons at every size |
| Journal trade log: Result | 6 (All, Wins, Losses, Breakeven, Open, Unknown P&L) with counts | Buttons at 800 px (fits its row) |
| Insights: P&L basis; Group trades by; Calendar cells show; Show the curve as | 2–3 each | Buttons at every size |
| Import wizard: Show rows | 6 (All, Will import, Restores, Duplicates, Errors, Warnings) with counts | Not exercised (needs a checked file); same rule |
| Journal library: Show | 3 (All, Draft, Completed) | Not shown with this test journal (no reviews) |

The space measured is the row the control sits in: the nearest ancestor whose width doesn't depend on its content (a
wrapping toolbar gives an item a line of its own). While folded, an inert hidden copy of the buttons keeps being
measured, so a count change never unfolds it, and widening the window unfolds it again. If a control shares a
non-wrapping row with other items, it can still be squeezed before the row runs out; it then scrolls sideways inside
itself (#70) rather than overflowing the page.

## Minimum window (Build 26.85)

`tauri.conf.json`: `minWidth` **800**, `minHeight` **480** logical px (was 1024 × 640); the default stays 1280 × 800.
Tauri sizes are logical, so at 200% scaling the minimum is 1600 × 960 physical px and fits a maximised
1920 × 1080 display (about 960 × 540 logical px less the taskbar). The figure becomes final only after the packaged
checks in the matrix.

**760 px (resilience only).** The window can't be made narrower than 800 px, so 760 px was checked by viewport
emulation inside the real WebView: no page scrolls sideways; the icon rail and compact patterns hold. Known limit:
long account names in the header selector truncate with an ellipsis, as they do at every width (the full name is in
the menu and on each page). Not promised as supported.

## Themes (Build 26.85)

- **Light, dark and follow the system: one behaviour in V1.** The app follows the Windows app mode live
  (`prefers-color-scheme`); nothing sets `data-theme` on the app root or the render-failure screen any more, so
  dialogs and menus (portalled to `body`) always match the page. Dark is the token default when the OS reports no
  preference.
- **No in-app theme setting in V1** (design decision 5 keeps Settings › Appearance "Planned"). "Theme preference
  persists after restart" is therefore **N/A for V1**: there is no preference to persist; the OS setting is read at
  every start. Proposed P1 card: *In-app Appearance setting (System / Light / Dark), persisted in settings*.
- Contrast pairs for both themes are checked in `tokens.test.ts` (4.5:1 text, 3:1 control borders on cards, the page
  and inset surfaces), and the OS-light token block must match `[data-theme="light"]`. Light-theme fixes in this
  change: `line-200` `#8792a8` → `#7a859b` (borders were 2.77–2.89:1 on the page and inset surfaces, now 3.28–3.71:1);
  the selected segment's count uses `ink-muted` (ink-faint on bg-300 was 4.38:1 light, 4.44:1 dark).
- **Windows contrast themes** (`forced-colors.css`): the browser swaps colours for the theme's system colours and
  drops backgrounds and shadows, so every state drawn with a tint or a shadow gets a system-colour equivalent: one
  `Highlight` focus ring; selected tabs, segments, chips, days and the current route filled with
  `Highlight`/`HighlightText`, as is the current pager page; selected table rows edged in `Highlight`; selected calendar
  days, bars, cards and month cells outlined in `Highlight`; cards,
  pills, badges and dialogs keep a `CanvasText` edge (dialogs 2 px); meter and bar fills drawn in `CanvasText` on an
  edged track; switches in `ButtonText`/`Highlight`; disabled controls in `GrayText`. Status already pairs an icon
  and a word (Safe, Caution, Stop, Unknown) with its colour; Unknown keeps its dashed edge.

## Text enlargement

Fonts are set in px from the tokens, so Windows "Text size" (Accessibility) and app zoom are separate checks from
display scaling; both are in the matrix and were not run here. The compact patterns above (folding filters, wrapping
labels, stacked grids) are what keep 200% text usable.

## Known limits

- Not verified at 480 px tall: with a checked file, the import wizard's sticky confirm bar may wrap to two or three
  rows and cover more of the page (matrix W8).

- When the expanded sidebar needs to scroll (a short window with a submenu open), its scrollbar narrows the brand row
  and the wordmark truncates to "FundedFl…". The mark and the accessible name are unchanged.

- The Insights closed-trade P&L chart draws at a fixed aspect inside its card, so at the 1600 px cap part of the card
  is empty to the right of the line (unchanged from before P0-D29). Proposed as a Triage card.
