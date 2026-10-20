# 1 · App shell: collapsible sidebar and top bar

Mockups: `Main.dc.html` (in use), `Sidebar.dc.html`, `Topbar.dc.html`, `TopbarSessions.dc.html` (sessions open).
References: `tw-home.png`, `tw-top-bar.png`, `tw-trading-sessions.png`.

## Purpose
The frame every screen sits in. Replaces the start-screen developer panel as the app's home; the Data model panel
and the Design system gallery move under Settings › Developer.

## Layout
- Row of sidebar + main column; the main column holds the top bar and the page (`padding 24px 32px`, max width
  1600 px).
- Routing with `react-router-dom` (already a dependency). One route per sidebar item; unknown routes go to Home.

## Sidebar
See [components.md › AppShell, Sidebar](../components.md#appshell-sidebar). Items and routes:

| Group | Item | Route |
|---|---|---|
| Journal | Home | `/` |
| | Dashboard | `/dashboard` |
| | Journal | `/journal` |
| | Library | `/library` |
| | Trade log | `/journal?view=log` |
| | Calendar | `/calendar` |
| | Reports | `/reports` |
| Accounts | Accounts | `/accounts` |
| | Import trades | `/import` |
| Tools | Economic calendar | `/economic-calendar` |
| Footer | Settings | `/settings` |

Counts: trades in the selected accounts (Trade log), active accounts (Accounts).

## Top bar
Left to right:
1. **Search** button "Search Ctrl K": opens a command palette (screens, accounts, symbols, journal text). Phase 1 can
   ship screens and accounts only.
2. **Account selector**: multi-select of non-archived accounts; drives every screen. Persist the choice.
3. **Date range**: presets (Today, This week, This month, Last 30 days, This year, All) and custom.
4. **DayTimer** ([05](05-day-timer.md)).
5. **SessionClock** → TradingSessions popover ([components.md](../components.md#sessionclock--tradingsessions-popover)).
   The popover's time zone select defaults to the selected account's `timezone`.
6. **Feedback** icon: opens a short form; no network in V1, so it saves to a local file or copies text. Decide.
7. **Notifications** icon with unread count. V1 sources: limit warnings (rule at 70%+), breaches, import finished,
   new trading day. Local only.
8. **Theme**: System / Dark / Light; sets `data-theme` on the root and persists.
9. Divider, primary **Add trade**.

## States
- Runtime not ready: keep `RuntimeGate` around the main column; the sidebar stays usable.
- No accounts: the account selector reads "No accounts" and links to Add account; Add trade is disabled with a
  tooltip.

## Decisions
- Dark is the default theme; System follows the OS.
- Session hours come from a table with time zones so they follow daylight saving; the mockup's fixed UTC hours are
  late-October values only.

## Open questions
- Where feedback goes without network access.
- Which markets appear in Trading sessions (CME Globex hours for futures traders instead of forex sessions?).
