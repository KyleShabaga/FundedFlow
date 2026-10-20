# FundedFlow design system

Status: tokens, fonts, 12 components and display formatting, in `apps/desktop/src/design-system`. No product
feature screen uses them yet; the app root uses the tokens and surface styles. In development,
`#/settings/developer` opens a reference page
(`DesignSystemGallery.tsx`) with every component on example data. The gallery never calls feature commands;
the shared app runtime provider still checks local runtime availability.

The system is dark-first (traders keep the app open beside their charts) with a light theme. It follows the OS
setting; `data-theme="dark"` or `data-theme="light"` on any element forces a theme for that subtree.

## Using it

```tsx
import { AccountCard, Pnl, PnlCalendar, TradeTable, formatMoney } from "../design-system";
```

Importing the folder loads the bundled fonts, `tokens.css` and `design-system.css` once. Put screens inside an
element with the `ds-surface` class (page ground, ink, body font). Classes use the `ds-` prefix to stay separate
from the developer panel's `ff-` classes. The product root does not define another token or primitive system.

## Files

| File | Contents |
|---|---|
| `tokens.css` | Colour tokens per theme (with the role of each), spacing, radii, font stacks |
| `tokens.test.ts` | Fails if any text/background pair drops below 4.5:1, or control borders below 3:1, in either theme |
| `format.ts` | Money, compact money, percentage and trading-day formatting; exact money sums |
| `components/primitives.tsx` | `Button`, `Badge`, `Pnl`, `StatTile`, `Tabs` + `TabPanel` (Radix Tabs) |
| `components/app-frame.tsx` | Host-independent `AppFrame` with sidebar/header/content slots; Build 12 supplies navigation and routing |
| `components/rules.tsx` | `RuleMeter`, `ruleState`, `AccountCard` |
| `components/charts.tsx` | `WinGauge`, `Sparkline`, `EquityCurve` |
| `components/journal.tsx` | `PnlCalendar`, `monthWeeks`, `DayCard`, `TradeTable`, `tradeResult` |
| `design-system.css` | Component styles |
| `DesignSystemGallery.tsx`, `gallery.css` | The reference page |

## Rules the components follow

- **Money is decimal text, never `number`.** Components take the canonical decimal strings the Rust commands
  send (`realizedPnl`, `fees`, balances). `format.ts` formats and sums through bigint micro-units from
  `@fundedflow/domain` (`toMicros`, `microsToDecimal`), so `sumMoney(["0.1", "0.2"])` is `"0.3"`. Floats appear
  only for drawing (`moneyToNumberForDisplay`: chart coordinates, bar widths) and for ratios (win rate,
  percent change). Display sums do not replace values Rust computes and stores.
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
