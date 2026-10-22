# FundedFlow design system

Status: tokens, fonts, display formatting and the shared components in `apps/desktop/src/design-system`:
the 12 Build 7 components plus the Build 13 form, overlay, feedback, async-state and data-display components.
No product feature screen uses them yet; the app root uses the tokens and surface styles. In development,
`#/settings/developer` opens a reference page (`DesignSystemGallery.tsx`, `GallerySections.tsx`) with every
component on labelled example data. The gallery never calls feature commands; the shared app runtime provider
still checks local runtime availability. Every component renders in a plain React browser environment: none
imports Tauri, SQLite or a data gateway.

The system is dark-first (traders keep the app open beside their charts) with a light theme. It follows the OS
setting; `data-theme="dark"` or `data-theme="light"` on any element forces a theme for that subtree.

## Using it

```tsx
import { AccountCard, Pnl, PnlCalendar, TradeTable, formatMoney } from "../design-system";
```

Importing the folder loads the bundled fonts, `tokens.css` and the component stylesheets once. Put screens inside an
element with the `ds-surface` class (page ground, ink, body font). Classes use the `ds-` prefix to stay separate
from the developer panel's `ff-` classes. The product root does not define another token or primitive system.

## Files

| File | Contents |
|---|---|
| `tokens.css` | Colour tokens per theme (with the role of each), spacing, the content-frame cap (`--frame-max`), radii, font stacks |
| `forced-colors.css` | Windows contrast themes: system-colour focus, selection, edges and meters (Build 26.85) |
| `tokens.test.ts` | Fails if any text/background pair drops below 4.5:1, or control borders below 3:1, in either theme |
| `format.ts` | Money, compact money, percentage, byte size (`formatBytes`), trading-day and instant (`formatInstant`) formatting; exact money sums; display time zones (`desktopTimeZone`, `isSupportedTimeZone`, `supportedTimeZones`, `timeZoneDisplayName`, `zoneOffsetLabel`, P0-D05) |
| `components/primitives.tsx` | `Button`, `Badge`, `Pnl`, `StatTile`, `Tabs` + `TabPanel` (Radix Tabs; `keepMounted` keeps a panel's form state while another tab shows, Build 19) |
| `components/app-frame.tsx` | Host-independent `AppFrame` with sidebar/header/content slots and `sidebarHeader` (the brand row, outside the scroll area) and `sidebarEdge` slots in the sidebar header (Build 18.5, placed P0-D08); `ContentFrame`, the shared content frame (P0-D29); Build 12 supplies navigation and routing |
| `components/brand.tsx` | `BrandMark` (the swept-F mark, decorative) and `BrandLogo` (mark + "FundedFlow" wordmark; `showName={false}` for the icon rail) (P0-D01) |
| `components/rules.tsx` | `RuleMeter`, `ruleState`, `AccountCard` |
| `components/account-overview.tsx` | `AccountOverviewCard`, `ProgressMeter`, `meterFraction` (Build 18.5) |
| `components/documents.tsx`, `documents.css` | `GatePage`, `DocumentView`, `Disclosure` (NA-3) |
| `components/charts.tsx` | `WinGauge`, `Sparkline`, `EquityCurve`, `RunningTotalChart` (axes, zero line, stepped or monotone smooth), `PnlBars`, `ChartPanel` |
| `components/journal.tsx` | `PnlCalendar`, `monthWeeks`, `DayCard`, `TradeTable`, `tradeResult` |
| `components/forms.tsx` | `TextField`, `Textarea`, `SearchField`, `Checkbox`, `Switch`, `RadioGroup`, `Select` (Radix), `FieldGroup`, `FormSection`, `FieldError`, `ValidationSummary`, `focusFirstInvalid`, `focusFirstInvalidWhenShown` (Build 26), `FileDropzone`, `dragHasFiles`, `useWindowFileDropGuard`, `formatFileSize` |
| `components/overlays.tsx` | `Dialog`, `ConfirmDialog`, `Drawer`, `Popover`, `OverlayClose`, `DropdownMenu`, `ActionPill` (P0-D12), `Tooltip`, `InfoTip` (Radix Dialog, Dropdown Menu, Tooltip) |
| `components/feedback.tsx` | `InlineNotice`, `ToastProvider` + `useToast`, `StatusIndicator` |
| `components/async-states.tsx` | `AsyncState`, `StateBoundary`, `Skeleton`, `LoadingState`, `EmptyState`, `ErrorState`, `UnavailableState`, `StaleDataNotice`, `RefreshingIndicator`, `MutationState`, `MutationFeedback`, `isMutationBusy`, `hasData` |
| `components/data.tsx` | `DataTable`, `MetricCard`, `MetricValue` + `MetricValueView`, `MoneyCell`, `UnknownValue`, `LabeledValue`, `StatList`, `Stepper`, `MonthYearPicker` |
| `components/primitives.tsx` (Build 13 additions) | `Button` `loading` and `disabledReason`, `IconButton`, `SegmentedControl`, `DisclosureButton` (P0-D18) |
| `components/rules.tsx` (Build 13 additions) | `MiniMeter`, `RuleStateBadge`, `RulebookLine` |
| `components/charts.tsx` (Build 13 addition) | `ChartPanel` |
| Build 23 additions | `PnlBars` (charts.tsx); `PnlCalendar` `selectedDay`, `onSelectWeek`/`selectedWeek`, `display`, `title`/`summary` (journal.tsx) |
| `design-system.css`, `controls.css`, `states.css`, `data.css` | Component styles (Build 7 components; controls, overlays and feedback; async states; data display) |
| `*.test.tsx` | Component tests (Vitest + Testing Library, jsdom) |
| `layout-policy.test.ts` | Reads every stylesheet: the frame, its gutters, the one breakpoint set and Today's columns (P0-D29) |
| `DesignSystemGallery.tsx`, `GallerySections.tsx`, `gallery.css` | The reference page |

## Rules the components follow

- **Money is decimal text, never `number`.** Components take the canonical decimal strings the Rust commands
  send (`realizedPnl`, `fees`, balances). `format.ts` formats and sums through bigint micro-units from
  `@fundedflow/domain` (`toMicros`, `microsToDecimal`), so `sumMoney(["0.1", "0.2"])` is `"0.3"`. Floats appear
  only for drawing (`moneyToNumberForDisplay`: chart coordinates, bar widths) and for ratios (win rate,
  percent change). Display sums do not replace values Rust computes and stores.
- **Money shows the account's currency.** Every money component (`Pnl`, `MetricValue` money, `MoneyCell`,
  `RuleMeter`, `MiniMeter`, `AccountCard`, `PnlCalendar`, `DayCard`, `TradeTable`, `MonthYearPicker`) takes
  `currency` (ISO 4217). `currencySymbol` turns it into "$", "€", "CA$" or "CHF "; an unrecognised code shows
  itself, never "$". Omitting `currency` means USD, so feature screens always pass the account's currency.
- **Unknown is not zero.** `null` money renders as "—" in ink-faint; a sum with an unknown part is unknown.
- **Every P&L is signed**: `+$1,792.68`, `−$275.73` (U+2212), `$0.00`. In light theme profit and loss sit at
  similar lightness, so the sign is what tells them apart for colour-blind readers.
- **Trading days are Monday to Friday.** Weekend activity rolls to Monday
  ([data-model.md#trading-day](data-model.md#trading-day)), so `PnlCalendar` hides weekends unless
  `showWeekends` is set. Day labels come from the `tradingDay` string, not from a `Date` in local time.
- **Times show in the account's zone.** `TradeTable` takes `timeZone` (the account's IANA zone) for entry times.
  P0-D05: a time shown in the display zone instead uses `formatInstant(…, { zoneName: "offset" })`, which labels it
  with that instant's own offset ("GMT+1", "GMT+5:30"; a zero offset is always "GMT"), never an abbreviation alone.
- **TradeTable takes `Trade` from `@fundedflow/domain` unchanged**, including `pnlStatus` (`open`,
  `reported`, `missing_instrument`, `currency_mismatch` show as a note badge).
- **Rule meters are not connected to persisted rules yet.** `RuleMeter` and the rules on `AccountCard`
  take plain props; they turn amber at 70% (`WARN_AT`) and red at 100% of a limit, compared in micro-units.
  Build 9.5 has landed with versioned rulebook storage and commands, but product screens still need to resolve
  the applicable rulebook and pass supported/unknown states explicitly. The gallery uses example values.
- **Offline.** Inter (variable), Space Grotesk 500/600 and JetBrains Mono 500/600 are bundled from
  `@fontsource` packages. Nothing loads from the network.

## Tokens

| Role | Tokens |
|---|---|
| Grounds | `bg-000` page, `bg-100` cards, `bg-200` insets (table header, meter track), `bg-300` hover/selected |
| Lines | `line-100` hairlines (decorative), `line-200` control borders (3:1) |
| Text | `ink`, `ink-muted` (labels), `ink-faint` (axes, timestamps); all 4.5:1 on cards |
| Brand | `flow` text/lines, `flow-fill` primary button (with `on-flow` text), `flow-soft` selection; `brand-mark-start`/`brand-mark-end` the logo mark's gradient only (each end 3:1 on `bg-000` and `bg-100`) |
| Meaning | `profit`, `loss`, `warn` (rule at 70%+), each with a `-soft` ground that holds its own colour as text |
| Charts | `chart-1` balance/equity, `chart-2`…`chart-5` categorical series |
| Space | `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-6` 24 · `space-8` 32 |
| Radius | `radius-sm` 4 badges/bars · `radius-md` 8 buttons/inputs/calendar days · `radius-lg` 12 cards · `radius-pill` tabs |
| Type | `--font-display` Space Grotesk (titles), `--font-sans` Inter (UI), `--font-mono` JetBrains Mono (every number) |

Cards are set off by hairlines, not shadows; `shadow-pop` is for menus, popovers and dialogs.

The same system is kept as a browsable reference (brand book, tokens and live previews) in the FundedFlow
Design System artifact on claude.ai. When a token changes, change `tokens.css` here and keep the two in step.

## Build 13: forms, feedback, async states and data display

### Forms
- Every control has a visible label (or `hideLabel` for toolbar search and table checkboxes; it is still the
  accessible name). `description` and `error` are linked through `aria-describedby`; `error` sets `aria-invalid`.
  Required fields show `*` and set `required`; mark the odd optional field with `optional` instead.
- Controls render native elements (`input`, `textarea`, radios, a `role="switch"` checkbox), so keyboard behaviour
  is the browser's. `Select` is Radix Select: no option is chosen for the user unless the screen passes one.
- On submit: collect issues, render `ValidationSummary` at the top of the form, pass each control its `error`, then
  call `focusFirstInvalid(form)`. Error text has its own slot under the control. For field errors that come back
  from the repository, call `focusFirstInvalidWhenShown(form)` instead: React Query renders a mutation's error after
  the submit handler, so a microtask is too early (Build 26).
- `RadioGroup` is a `fieldset` with `role="radiogroup"`, the role that allows `aria-required` (Build 26, axe
  `aria-allowed-attr`). Query it as `radiogroup` in tests.
- `RadioGroup cards` (P0-D20) shows each option as a bordered card with its description, side by side when each gets
  280 px and stacked otherwise; the chosen card is outlined (border, ground and the radio dot). For a few
  consequential choices, such as the export format.
- `Button loading` keeps focus and ignores clicks, so one click is one write. `disabledReason` keeps a disabled
  button focusable and reads the reason.
- `FileDropzone` only hands `File` objects (or an `onBrowse` request for a native dialog) to the caller. Reading,
  size limits, parsing and staging belong to the CSV import and attachment cards.
- `ChipGroup` (Build 20) is a several-of-many choice as toggle chips (setup, mistake and mindset tags): a labelled
  `fieldset` of buttons with `aria-pressed`. `tone="warn"` turns chosen chips amber (mistakes). A chosen chip has no
  checkmark (P0-D25): a filled ground and a doubled border mark it, so the label stays centred and the size doesn't change. A chip can carry a
  `note` (tooltip and screen-reader text, e.g. "Archived") and be `disabled`; `empty` replaces an empty list.

### Overlays
- `Dialog` and `Drawer` are modal: focus moves in and is trapped, Escape and the overlay close them, and focus
  returns to what opened them (also when opened from a menu or a controlled `open`). Use `dismissible={false}`
  while a write runs.
- `ConfirmDialog` focuses Cancel first, runs `onConfirm` once per click, cannot be dismissed while it runs and stays
  open with a safe message if it fails. It never claims "nothing changed"; pass `describeError` when the data layer
  knows. The destructive actions themselves belong to later cards. The developer panel keeps its own
  `components/ConfirmDialog.tsx` until those cards move to this one.
- `DropdownMenu` runs an item's action from the menu's close-focus event, after Radix has returned focus to the
  trigger, so a `Dialog` it opens records the trigger as its return target and isn't dismissed by the menu's focus
  return. (Build 26: a fixed 0 ms timer used to race Radix's own timer; that was the overlay focus flake.)
- If the element that opened an overlay is gone when it closes (a row archived or deleted by the dialog's own
  action), focus goes to the first tabbable control in the nearest surviving container, never to `<body>`.
- `Popover` (non-modal, anchored by CSS) for the month picker, column chooser and similar; `DropdownMenu` for
  actions on one object; `Tooltip` names or explains a focusable control and is never the only place for
  essential information.
- `ActionPill` (P0-D12) is one item of a managed list (a library tag): its name (wrapping when long), an optional
  badge and meta ("Used in 47 reviews"), and one menu button at its end that opens a `DropdownMenu` of that item's
  actions. The pill itself is not a control, so no button sits inside another; `actionsLabel` names the button and
  the menu ("Actions for tag ORB"). `muted` draws an archived item with a dashed edge. Put archive or restore in
  the menu as words, never as an X, which reads as "remove". A dialog opened from the menu returns focus to the
  menu button; a dialog the page unmounts on close must return focus itself (see the Library tags).

### Which message to use

| Situation | Use |
|---|---|
| A view or card could not load | `ErrorState` (through `StateBoundary`), with Retry for reads |
| A problem that is still true (file unreadable, rules missing) | `InlineNotice` next to it; never only a toast |
| A finished action whose result is visible | Toast (`useToast().show`), success or info; closes after 5 s, paused on hover or focus |
| (Toasts) | `ToastProvider` is mounted once in `AppProviders`. Its stacks are `aria-live` regions without a status/alert role, so they never compete with a page's own alerts |
| A failed background action with nothing to show inline | Error toast (stays until dismissed) |
| A save, import or delete in progress or finished | `MutationFeedback` beside the action |
| Old data still on screen | `StaleDataNotice` (through `StateBoundary` `stale`) |
| A consequential action | `ConfirmDialog` |
| Risk, freshness or provenance of a value | `StatusIndicator` (text, icon and tone) |
| The local runtime is down for the whole app | Not here: the shell's runtime gate (Build 12) |

### Async states
- Screens get one `AsyncState<T>` (`loading`, `success`, `refreshing`, `stale`, `empty` with a kind, `error`,
  `unavailable`) from their Build 14 hook and pass it to `StateBoundary`, `ChartPanel` or a `DataTable` `fallback`.
  There are no `isLoading`/`isError` flags to contradict each other, and the switch is exhaustive.
- A failed or timed-out request is `error`, never `empty`. `empty` has three kinds: `no-records`, `no-matches`
  (offer Clear filters) and `not-configured` (offer setup). `unavailable` is a known missing dependency with a
  resolution, such as an account without a rulebook.
- Loading shows skeletons only: no example values and no `$0.00`. A background refresh keeps data on screen with a
  silent "Updating" mark; stale data says when it is from (in the account zone) and never says live. Set
  `asOfBasis: "loaded"` when the time is only when the screen last received the data (a client receipt time),
  so the notice says "last loaded" instead of implying the figures were calculated then.
- `StateBoundary` announces a finished first load once, lets errors announce themselves and moves focus to the
  error heading when a load the user was waiting for fails.
- `MutationState` covers `idle`, `validating`, `submitting`, `success`, `validation-error`, `uncertain` and
  `failed`. An uncertain outcome offers "Check result", never "Retry"; `failed` offers Retry only when
  `nothingChanged` is true. `actions` adds the screen's own buttons, such as "I've checked the records" to
  release a write lock. Nothing in the design system retries or replays a write on its own.

### Data display
- `DataTable` is controlled: the screen sorts, filters and pages; the table renders `aria-sort` (one sort at a
  time), selection with a mixed select-all, a bulk-action toolbar, a `rowHeader` column, right-aligned mono numbers,
  sideways scrolling inside the card and a pager. Pass a `LoadingState`, `EmptyState` or `ErrorState` as `fallback`
  to keep the toolbar and headers in place. Put it in a grid or flex child with `min-width: 0`.
- Sort money columns with `compareMoney(a, b, direction)`: exact micro-unit comparison, unknown last in both
  directions.
- `MetricCard`, `LabeledValue` and `StatList` take a `MetricValue` (`money`, `percent`, `count`, `text`,
  `unavailable`). `null` renders as "—", read as "Unknown"; zero renders as zero.
- `MonthYearPicker` follows [screens/04-calendar.md](design/screens/04-calendar.md#monthyearpicker). Year totals
  come from `yearPnl` when Rust supplies them, otherwise from a display sum of the supplied months (unknown if any
  month is unknown or none was supplied).
- `RuleStateBadge` follows the RuleState table in [design/components.md](design/components.md#rulestate): unknown
  presence or `needs_setup` shows "Needs setup", never a meter at zero.

### Diagnostics (Build 26.5)
- `DiagnosticDetails` shows a collapsed, selectable, copyable support summary with a polite copy result and a
  fallback when the clipboard refuses. Pass text built only from allowlisted fields (`lib/diagnostics.ts`), never
  from an error message, path or record. It sends nothing anywhere.

### Page outline (Build 26)
- The shell's page title is the only `h1`. `DataTable`, `ChartPanel` and `FormSection` render an `h3` title by
  default; pass `headingLevel={2}` when one is a page's top-level section. `TabPanel heading="…"` adds a visually
  hidden `h2` so a panel's `h3` sections don't skip a level. Dialog titles are `h2`; headings inside a dialog
  start at `h3`. The Build 26 axe suite (`apps/desktop/src/journeys/accessibility.test.tsx`) fails on a skipped
  level.

## NA-3: full-page gate, documents and disclosure

- `GatePage` is a whole-window step shown instead of the app frame (the first-run agreement). It renders the page's
  only `main` and `h1`, focuses the title on mount, and keeps its `actions` in a sticky bar at the bottom of the card
  (max 720 px, so it fits an 800 px window). `preview` renders it inside another page (a section with an `h2`, no
  focus move), as in the gallery.
- `DocumentView` shows bundled long-form text as an `article` named by its title: `headingLevel` (2 or 3) for the
  title, one level lower for sections, an optional `badge` (Draft) and `meta` line. Text is rendered as text; no
  markup is interpreted. `preformatted` (Build 26.78) keeps each paragraph's line breaks and indentation in the
  monospaced face and wraps long lines, for licence texts.
- `Disclosure` is a native `details`/`summary` expander (keyboard behaviour is the browser's). `srSummary` adds
  screen-reader context, such as "(draft, version 0.1.0-draft)", to a link-like summary. `onToggle(open)` (Build
  26.78) reports each open and close, so a long body can be loaded on first open.

## P0-D18: DisclosureButton

- `DisclosureButton` shows and hides a region elsewhere in the layout, where a native `Disclosure` can't work because
  its summary must sit apart from its body (a Filters action in a toolbar, its panel below). It is a `Button` with
  `aria-expanded` and `aria-controls`; the caller keeps the state and renders the region with that id.
- Open reads as pressed (flow edge and tint) plus a turned chevron, and a Highlight edge in contrast themes. `count`
  shows "· n" for active items (none for 0), with `countLabel` giving the screen-reader words ("3 filters applied").

## Build 23: selectable calendar and PnlBars

- `PnlCalendar` keeps its defaults. `selectedDay` rings and presses a day; `onSelectWeek` makes week totals buttons
  (`selectedWeek` rings one); `display` leads cells with P&L, trade count or win rate (`CalendarDay.winRate`, percent
  text); `title` and `summary` replace the head (for a `MonthYearPicker`). A day with `pnl: null` reads "P&L unknown",
  shows "—" and takes no tint. Selection is a ring plus `aria-pressed`, never colour alone.
- `PnlBars` draws diverging bars around zero, one row per item with its exact signed amount and an optional detail line.
  The rows are the chart's text alternative (a list of labelled groups, or buttons with `onSelect`). `null` draws no bar
  and reads "P&L unknown". Bar lengths use `moneyToNumberForDisplay` for drawing only.

## Build 18.5: drop zone, sidebar edge and account overview card

- `FileDropzone` reacts only to drags that carry files (`dataTransfer.types` includes `Files`); text and link drags are
  ignored. It cancels `dragenter`/`dragover` with `dropEffect = "copy"` (`"none"` while disabled), counts nested
  enter/leave so the highlight doesn't flicker over children, and clears on `dragend` or a drop elsewhere. A
  single-file zone given `onTooMany` reports several dropped files instead of silently keeping the first. With a file
  chosen it always offers a replace button (`replaceLabel`, default "Choose another…") that opens the picker; the
  input is cleared after each pick so the same file can be chosen again, and a cancelled picker changes nothing.
  `selectedActions` holds extra actions such as Remove.
- `useWindowFileDropGuard()` (mounted once by the app shell) stops a file dropped outside every drop zone from
  navigating the window to that file, which is the WebView2 default once Tauri's native drop handler is off
  (`dragDropEnabled: false`). Zones handle their own events first, so it only catches stray drops.
- `AppFrame` `sidebarEdge`: a control inside the sidebar header (P0-D08: top-right when expanded, centred under the
  brand in the rail; the host sets `--ds-app-edge-top`, `--ds-app-edge-inset` and `--ds-app-edge-top-collapsed`), rendered
  before the scrolling sidebar content (keyboard order matches what is seen) and outside it (never clipped). The
  sidebar no longer scrolls itself; `.ds-app-sidebar-scroll` does.
- `AppFrame` `sidebarHeader`: the sidebar's header row (the app shell's brand), rendered first and outside
  `.ds-app-sidebar-scroll`, which fills the height left below it. A scrollbar in a short window narrows only the
  links, never the wordmark.
- `AccountOverviewCard` lays out one account attempt: identity (mark, eyebrow, title, masked reference, meta) and
  badges; a primary figure and secondary figures, each a `MetricValue` with an optional provenance badge and note;
  up to two meters; rule lines as a `dl` (`muted` for non-values); an activity line and actions in the footer. It
  is an `article` named by its title. A container query folds it: under 460 px badges move under the name; under
  300 px only identity, status, the primary figure and the actions remain. It computes nothing.
- `ProgressMeter` draws a bar for two amounts the caller already has (engine figures), with a required `valueText`
  for screen readers. Only `value ÷ max` (bigint micro-units, `meterFraction`) sets the width; it states no verdict.
- `OverviewFigure` (NA-4) is the card's figure block on its own: label, `MetricValue`, optional provenance badge and
  note, `primary` for the larger value. The account detail page's Risk section uses it so a figure reads the same on
  the card and the page; the page lays the figures out itself. Gallery: under the overview card section.

## P0-D29: content frame and the responsive breakpoint set

Policy, numbers and rationale: [design/window-support.md](design/window-support.md).

- `AppFrame`'s main column (`.ds-app-column`) is the size container **`ds-main`**. Page layouts respond with
  `@container ds-main (…)` to the width left beside the sidebar; page CSS has no window-width media queries.
- `ContentFrame` (`.ds-content-frame`, passes through `className` and other `div` attributes) is the shared content
  frame. The host wraps the page header's contents in one and the page body in another, so title, account selector,
  header actions and body share both edges. It centres in `ds-main`, grows to `--frame-max` (1600 px) and stops. Its
  gutter (`--ds-frame-gutter`) is `space-8`, `space-6` below 880 px of main column and `space-4` below 640 px.
- The allowed `ds-main` breakpoints are **640, 880 and 1280 px**; `layout-policy.test.ts` fails on any other, on a
  window-width media query in page CSS, and on a page re-adding its own 1600 px cap. Narrower caps for forms and
  reading pages stay with those pages and start on the frame's left edge.
- Gallery: "Content frame", after "Application frame".

## Build 26.85: compact patterns and contrast themes

Policy and decisions: [design/window-support.md](design/window-support.md).

- `SegmentedControl` `overflow` (`"menu"` default, `"scroll"`): when the buttons' natural width no longer fits the width
  the row it sits in can give them (the nearest ancestor whose width doesn't depend on its content), "menu" renders a `Select` (size `sm`) with the group's label shown beside it, the same
  options with counts as "Errors (1)" and the caller's value; focus on the buttons moves to the dropdown. It is wrapped
  in `.ds-seg-fit`; while folded an inert, hidden copy of the buttons (`.ds-seg-measure`) keeps the measurement
  current, so count changes don't unfold or remount it. Without layout (jsdom, a hidden tab) it keeps the buttons.
  Tests: `segmented.test.tsx`.
- Light theme: control borders (`line-200`) are 3:1 on every surface (light value now `#7a859b`); the selected
  segment's count uses `ink-muted`. `tokens.test.ts` also checks that the OS-light block matches `[data-theme="light"]`.
- `TradeTable` scrolls inside a named, focusable region ("{label}, scrolls sideways"), like `DataTable`.
- `forced-colors.css`: Windows contrast themes. System colours only (`Canvas`, `CanvasText`, `Highlight`,
  `HighlightText`, `ButtonText`, `ButtonBorder`, `GrayText`): one focus ring, selected states filled with `Highlight`,
  edges on cards, pills, badges and dialogs, meter fills in `CanvasText`. Shell and Today add their own selected-state
  rules. Tests: `window-support.test.ts`.
- Themes: nothing sets `data-theme` in the app; `tokens.css` follows `prefers-color-scheme` live. The gallery's theme
  tabs still force a theme for review.
- Gallery: "Narrow widths" (the same filter wide and folded).

## P0-D01: brand mark and logo

- `BrandMark` draws the FundedFlow mark (the outline in `docs/brand/fundedflow-mark.svg`) centred in a square `size`
  box (default 32 px). It is always `aria-hidden`; the text beside it carries the name. Its gradient stops read the
  `brand-mark-start`/`brand-mark-end` tokens, so one component serves both themes, and each instance gets its own
  gradient ids.
- `BrandLogo` is the mark plus the wordmark: "Funded" in `ink` and "Flow" in `flow`, Space Grotesk 600 at the
  display title size (20/28). Its text reads "FundedFlow". `showName={false}` leaves the mark alone, as in the
  collapsed sidebar rail. The app shell's brand row uses it.
- Files for uses outside the app (icons, lockups, PNGs) and the usage rules are in `docs/brand/`.
