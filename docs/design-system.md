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
| `tokens.css` | Colour tokens per theme (with the role of each), spacing, radii, font stacks |
| `tokens.test.ts` | Fails if any text/background pair drops below 4.5:1, or control borders below 3:1, in either theme |
| `format.ts` | Money, compact money, percentage, byte size (`formatBytes`), trading-day and instant (`formatInstant`) formatting; exact money sums |
| `components/primitives.tsx` | `Button`, `Badge`, `Pnl`, `StatTile`, `Tabs` + `TabPanel` (Radix Tabs; `keepMounted` keeps a panel's form state while another tab shows, Build 19) |
| `components/app-frame.tsx` | Host-independent `AppFrame` with sidebar/header/content slots and a `sidebarEdge` slot centred on the sidebar border (Build 18.5); Build 12 supplies navigation and routing |
| `components/rules.tsx` | `RuleMeter`, `ruleState`, `AccountCard` |
| `components/account-overview.tsx` | `AccountOverviewCard`, `ProgressMeter`, `meterFraction` (Build 18.5) |
| `components/charts.tsx` | `WinGauge`, `Sparkline`, `EquityCurve` |
| `components/journal.tsx` | `PnlCalendar`, `monthWeeks`, `DayCard`, `TradeTable`, `tradeResult` |
| `components/forms.tsx` | `TextField`, `Textarea`, `SearchField`, `Checkbox`, `Switch`, `RadioGroup`, `Select` (Radix), `FieldGroup`, `FormSection`, `FieldError`, `ValidationSummary`, `focusFirstInvalid`, `FileDropzone`, `dragHasFiles`, `useWindowFileDropGuard`, `formatFileSize` |
| `components/overlays.tsx` | `Dialog`, `ConfirmDialog`, `Drawer`, `Popover`, `OverlayClose`, `DropdownMenu`, `Tooltip` (Radix Dialog, Dropdown Menu, Tooltip) |
| `components/feedback.tsx` | `InlineNotice`, `ToastProvider` + `useToast`, `StatusIndicator` |
| `components/async-states.tsx` | `AsyncState`, `StateBoundary`, `Skeleton`, `LoadingState`, `EmptyState`, `ErrorState`, `UnavailableState`, `StaleDataNotice`, `RefreshingIndicator`, `MutationState`, `MutationFeedback`, `isMutationBusy`, `hasData` |
| `components/data.tsx` | `DataTable`, `MetricCard`, `MetricValue` + `MetricValueView`, `MoneyCell`, `UnknownValue`, `LabeledValue`, `StatList`, `Stepper`, `MonthYearPicker` |
| `components/primitives.tsx` (Build 13 additions) | `Button` `loading` and `disabledReason`, `IconButton`, `SegmentedControl` |
| `components/rules.tsx` (Build 13 additions) | `MiniMeter`, `RuleStateBadge`, `RulebookLine` |
| `components/charts.tsx` (Build 13 addition) | `ChartPanel` |
| Build 23 additions | `PnlBars` (charts.tsx); `PnlCalendar` `selectedDay`, `onSelectWeek`/`selectedWeek`, `display`, `title`/`summary` (journal.tsx) |
| `design-system.css`, `controls.css`, `states.css`, `data.css` | Component styles (Build 7 components; controls, overlays and feedback; async states; data display) |
| `*.test.tsx` | Component tests (Vitest + Testing Library, jsdom) |
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
| Brand | `flow` text/lines, `flow-fill` primary button (with `on-flow` text), `flow-soft` selection |
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
  call `focusFirstInvalid(form)`. Error text has its own slot under the control.
- `Button loading` keeps focus and ignores clicks, so one click is one write. `disabledReason` keeps a disabled
  button focusable and reads the reason.
- `FileDropzone` only hands `File` objects (or an `onBrowse` request for a native dialog) to the caller. Reading,
  size limits, parsing and staging belong to the CSV import and attachment cards.
- `ChipGroup` (Build 20) is a several-of-many choice as toggle chips (setup, mistake and mindset tags): a labelled
  `fieldset` of buttons with `aria-pressed`. `tone="warn"` turns chosen chips amber (mistakes). A chip can carry a
  `note` (tooltip and screen-reader text, e.g. "Archived") and be `disabled`; `empty` replaces an empty list.

### Overlays
- `Dialog` and `Drawer` are modal: focus moves in and is trapped, Escape and the overlay close them, and focus
  returns to what opened them (also when opened from a menu or a controlled `open`). Use `dismissible={false}`
  while a write runs.
- `ConfirmDialog` focuses Cancel first, runs `onConfirm` once per click, cannot be dismissed while it runs and stays
  open with a safe message if it fails. It never claims "nothing changed"; pass `describeError` when the data layer
  knows. The destructive actions themselves belong to later cards. The developer panel keeps its own
  `components/ConfirmDialog.tsx` until those cards move to this one.
- `DropdownMenu` runs an item's action just after the menu closes, so an item can open a `Dialog` without the menu's
  focus return dismissing it.
- `Popover` (non-modal, anchored by CSS) for the month picker, column chooser and similar; `DropdownMenu` for
  actions on one object; `Tooltip` names or explains a focusable control and is never the only place for
  essential information.

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
- `AppFrame` `sidebarEdge`: a control centred on the sidebar's right border, level with the brand row, rendered
  before the scrolling sidebar content (keyboard order matches what is seen) and outside it (never clipped). The
  sidebar no longer scrolls itself; `.ds-app-sidebar-scroll` does.
- `AccountOverviewCard` lays out one account attempt: identity (mark, eyebrow, title, masked reference, meta) and
  badges; a primary figure and secondary figures, each a `MetricValue` with an optional provenance badge and note;
  up to two meters; rule lines as a `dl` (`muted` for non-values); an activity line and actions in the footer. It
  is an `article` named by its title. A container query folds it: under 460 px badges move under the name; under
  300 px only identity, status, the primary figure and the actions remain. It computes nothing.
- `ProgressMeter` draws a bar for two amounts the caller already has (engine figures), with a required `valueText`
  for screen readers. Only `value ÷ max` (bigint micro-units, `meterFraction`) sets the width; it states no verdict.
