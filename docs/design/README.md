# FundedFlow screen designs

The screen designs for the desktop app, written so they can be built screen by screen. The source of truth for how
things look is the design system in `apps/desktop/src/design-system` ([`../design-system.md`](../design-system.md));
these docs say **what each screen shows, which components and data it uses, and which decisions are already made**.

The live mockups are on the "FundedFlow Screens" design canvas in claude.ai. Copies of their source are in
[`mockups/`](mockups/) (visual reference only, see below), and the screenshots that inspired them are in
[`references/`](references/).

## How to use these docs

1. Read [`components.md`](components.md) first. Screens are built from the existing design-system components plus
   the new patterns listed there. Add a new pattern to `apps/desktop/src/design-system` (with tests and a gallery
   entry) **before** using it in a screen.
2. Build screens in the order below. Each spec has the layout, components, data, states, decisions and open
   questions. Where data does not exist yet, the spec says so; do not invent backend behaviour in the UI.
3. Follow the repo's rules: money is decimal text and never `number` (`format.ts`), unknown is `—` and never zero,
   trading days run Monday to Friday, times show in the account's time zone, and Rust stays authoritative for
   anything stored.

## Build order

| # | Screen / piece | Spec | Mockup | Backend today |
|---|---|---|---|---|
| 1 | App shell: collapsible sidebar + top bar | [01-app-shell](screens/01-app-shell.md) | `Main`, `Sidebar`, `Topbar`, `TopbarSessions` | No backend needed |
| 2 | Accounts table | [02-accounts](screens/02-accounts.md) | `Accounts` | `list_accounts`, rulebook assignment commands |
| 3 | Journal (by day + trade log) | [03-journal](screens/03-journal.md) | `Journal` | `list_trades`, `list_journal_entries` |
| 4 | Calendar + month/year picker | [04-calendar](screens/04-calendar.md) | `Calendar` | `list_trades` (client-side day totals) |
| 5 | Day-ending timer | [05-day-timer](screens/05-day-timer.md) | `DayTimer`, `TimerStates` | Account `timezone`, `tradingDayResetTime` |
| 6 | Import trade preview | [06-import](screens/06-import.md) | `Import` | `preview_csv_import`, `commit_csv_import` |
| 7 | Reports | [07-reports](screens/07-reports.md) | `Reports` | Needs a stats command (see spec) |
| 8 | Dashboard | [08-dashboard](screens/08-dashboard.md) | `Main` | Needs a stats command; rule evaluation is Build 16 |
| 9 | Home | [09-home](screens/09-home.md) | `Home` | Reuses 2, 3, 5 |
| 10 | Trade detail and review | [10-trade-detail](screens/10-trade-detail.md) | `TradeDetail` | Trade + round trip exist; review fields need tables |
| 11 | Journal library | [11-library](screens/11-library.md) | `Library` | `list_journal_entries`; playbooks/templates reserved |
| 12 | Economic calendar | [12-economic-calendar](screens/12-economic-calendar.md) | `EconCalendar` | No data source yet |

Status column for a screen: change "Backend today" to **Built** (with the PR number) when the screen ships.

## Mockups

`mockups/*.dc.html` are the canvas's artboards. They render only inside the design canvas (they load its
`support.js` runtime and the FundedFlow design-system bundle), so open the canvas to see them working. Read the
files for structure, copy and states; never copy their markup or `ff-app.css` into the app. `ff-app.css` holds a
copy of the tokens for the canvas only. The app's tokens live in `apps/desktop/src/design-system/tokens.css`.
`References.dc.html` points at images uploaded to the canvas; the same images are in `references/`.

All numbers in the mockups are examples and are not consistent between screens.

## References

| File | From | Fed into |
|---|---|---|
| `tw-dashboard-metrics.png` | TraderWaves dashboard | Dashboard KPIs, balance chart |
| `tz-dashboard.png` | TradeZella dashboard | Dashboard tiles, win-rate gauge |
| `tw-home.png` | TraderWaves home | Home |
| `tw-accounts.png` | TraderWaves accounts | Accounts table |
| `journal-entries.png` | Journal entries by day | Journal, By day |
| `tw-daily-journal.png` | TraderWaves daily journal | Journal days, calendar day panel |
| `trade-log-logs.png`, `ts-trade-log.png`, `tz-trade-log.jpg` | Trade logs | Journal trade log, Reports setups and mistakes |
| `tw-trade-history.png` | TraderWaves trade history | Trade review: rating, mindset, strategy |
| `ts-trade-detail.png` | TraderSync trade detail | Trade detail |
| `tw-library.png` | TraderWaves library | Library |
| `tw-calendar.png`, `ts-calendar.png` | Calendars | Calendar, yearly performance |
| `day-timer.png` | "Day ending in" chip | Day timer |
| `reports-alltime.png`, `tw-reports-overview.png` | Reports | Reports |
| `econ-calendar.png` | TradingView widget | Economic calendar |
| `tw-top-bar.png`, `tw-trading-sessions.png` | TraderWaves top bar | Top bar, trading sessions window |

FundedFlow takes the patterns from these, not the look, branding or copy.
