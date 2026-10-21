# FundedFlow screen designs

Screen-level design input for the desktop app. Three sources, each authoritative for one thing:

| Source | Authoritative for |
|---|---|
| **Notion board** ([FundedFlow roadmap](https://app.notion.com/p/6bf1bd4b6bde831ea34e01b574543195)) | Scope, build order, card ownership and acceptance criteria. One pull request maps to one card. |
| **This repo** | Code, contracts, the design system (`apps/desktop/src/design-system`, [`../design-system.md`](../design-system.md)) and these specs. |
| **"FundedFlow Screens" design canvas** (claude.ai) | How the screens look. Source copies are in [`mockups/`](mockups/); inspiration screenshots in [`references/`](references/). |

These specs are design input to **Build 6** (V1 flows and component plan) and **Build 7** (design-system
specification). When a spec and a card disagree, the card wins; fix the spec in the same pull request.

## Information architecture (Build 6)

- Sidebar: **Today** (default), **Journal**, **Insights**, **Accounts**, **Settings**.
- Header: **Import CSV** is the primary action. Manual trade entry is contextual to Today and Journal.
- Calendar is an Insights view; the library (strategies, tags, checklists, saved notes) lives under Journal; there
  is no separate Home: Today is the landing page.

## Screens mapped to cards

| Spec | Card (Build) | Lane | Notes |
|---|---|---|---|
| [01 App shell](screens/01-app-shell.md) | 12 App shell and runtime gate; primitives in 13 | P0 | Search, feedback, notifications, theme and session clock are not in Build 12 (see below) |
| [02 Accounts](screens/02-accounts.md) | 15 Account management UI; 15.5 risk inputs; 19 rulebook editor | P0 | Needs 14 (gateway hooks) |
| [03 Journal](screens/03-journal.md) | 20 Trade journal, detail and review; 22 daily review entry points | P0 | Needs 14 |
| [04 Calendar](screens/04-calendar.md) | 23 Insights (calendar view) | P0 | Month/year picker is a Build 13 primitive |
| [05 Day timer](screens/05-day-timer.md) | No card: proposed in Triage | — | Fits the shell's account context bar or Today |
| [06 Import](screens/06-import.md) | 18 CSV import wizard (backend 17) | P0 | In development |
| [07 Insights](screens/07-insights.md) | 23 Insights explorer and drill-down | P0 | Was "Reports" |
| [08 Today](screens/08-today.md) | 21 Today risk dashboard | P0 | Was "Dashboard"; needs 16 (rules engine) |
| [09 Home](screens/09-home-merged-into-today.md) | Merged into 21 | — | Kept for the all-accounts Today ideas |
| [10 Trade detail](screens/10-trade-detail.md) | 20; candles in 42–43 | P0 / P2 | Chart is P2 |
| [11 Library](screens/11-library.md) | 20 (strategy, tag, checklist management) and 22 | P0 | A Journal sub-view, not top-level navigation |
| [12 Economic calendar](screens/12-economic-calendar.md) | 41 Economic calendar and market sessions | P2 | Not V1 |
| [13 Account rulebook](screens/13-rulebook.md) | 19 Rulebook version editor and calculation explanation | P0 | Needs 16 for preview/explanation (blocked) |
| [14 Daily review](screens/14-daily-review.md) | 22 Daily review and plan adherence | P0 | A nested Journal page; opened from Today, By day and Library |
| [15 Settings: your data](screens/15-settings-data-controls.md) | 25 Data-control screens (backend 24) | P0 | Export, restore, permanent deletion; no mockup |

Shared patterns ([components.md](components.md)) belong to **Build 13**; their visual specification to **Build 7**.

### Not on the board yet (proposed as Triage cards)
Day-ending timer · Search / command palette · In-app feedback · Notifications centre (relate to "Desktop Privacy,
Security & User Notifications") · Insights calendar view with month/year picker (if not covered by 23).
Theme switching belongs to "Build UI skins & theme customization" (P2); V1 ships the dark theme and follows the OS
for light only if Build 7 says so.

## Rules for building from these specs

1. Start from the card: its scope, explicit ownership and acceptance criteria are the limit of the pull request.
2. Use the spec for layout, components, states and copy. Use the mockups for look only; numbers in them are
   examples and are not consistent between screens.
3. No fabricated values: placeholders and empty states never show example balances, P&L or risk (Build 12/13).
   Unknown is shown as Unknown, never zero or Safe.
4. Money is decimal text (`format.ts`), trading days run Monday to Friday in the account's zone, and Rust stays
   authoritative for stored calculations.
5. Track progress on the Notion card (status and an "Implementation reconciliation" note), not in this file.

## Mockups

`mockups/*.dc.html` render only inside the design canvas (they load its runtime and the design-system bundle).
Read them for structure, states and copy; never copy their markup or `ff-app.css` into the app. Some mockups
predate the board alignment: they show a Home page, a Dashboard label, an "Add trade" header button and
P2 items in the top bar. The specs above are current.

## References

| File | From | Fed into |
|---|---|---|
| `tw-dashboard-metrics.png`, `tz-dashboard.png` | TraderWaves, TradeZella dashboards | Today |
| `tw-home.png` | TraderWaves home | Today (all accounts) |
| `tw-accounts.png` | TraderWaves accounts | Accounts |
| `journal-entries.png`, `tw-daily-journal.png` | Journal by day | Journal, daily review |
| `trade-log-logs.png`, `ts-trade-log.png`, `tz-trade-log.jpg` | Trade logs | Journal trade log, Insights tags |
| `tw-trade-history.png`, `ts-trade-detail.png` | Trade history and detail | Trade detail and review |
| `tw-library.png` | TraderWaves library | Journal library |
| `tw-calendar.png`, `ts-calendar.png` | Calendars | Insights calendar |
| `day-timer.png` | "Day ending in" chip | Day timer |
| `reports-alltime.png`, `tw-reports-overview.png` | Reports | Insights |
| `econ-calendar.png`, `tw-top-bar.png`, `tw-trading-sessions.png` | Economic calendar, sessions | P2 (Build 41) |

FundedFlow takes the patterns from these, not the look, branding or copy.
