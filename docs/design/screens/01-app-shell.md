# 1 · App shell: collapsible sidebar and header

**Card:** Build 12 (app shell and runtime gate). Primitives: Build 13. Visual spec: Build 7.
Mockups: `Main.dc.html`, `Sidebar.dc.html`, `Topbar.dc.html` (predate board alignment; see notes).
References: `tw-home.png`, `tw-top-bar.png`.

## Purpose
The frame every route sits in, plus the runtime gate. Replaces the starter/developer start screen; the Data model
panel and Design system gallery stay reachable from Settings › Developer in development builds only.

## Sidebar (Build 6 navigation)
| Item | Route | Notes |
|---|---|---|
| Today | `/` (default) | Account health and freshness |
| Journal | `/journal` | Trades, sessions, import history, daily reviews, library sub-view |
| Insights | `/insights` | Metrics, calendar, equity views, drill-down |
| Accounts | `/accounts` | Accounts, rulebooks |
| Settings | `/settings` | Local data controls |

- `HashRouter` (Build 12). Unknown routes show a not-found state with a way back.
- Collapsible: 248 px expanded, 72 px icon rail (`aria-label` and tooltip per item), toggle in the sidebar header,
  Ctrl+B. Collapses automatically on narrow windows. Active item: `flow-soft` ground, `aria-current="page"`.
- Footer: Settings and a "Saved on this computer" status (local-first promise). No Import item in the sidebar.

## Header
- Left: page title; reserved space for the **AccountContextBar** (account selector and filters; behaviour owned
  by feature cards and Build 14).
- Right: **Import CSV** (primary). Until Build 18 ships, it is visible but clearly marked not yet available.
- Reserved, not in Build 12: GlobalFreshnessIndicator (Build 21 data), day-ending timer (Triage).

## Runtime gate (Build 12, consuming Build 11 commands)
States: checking, ready, unavailable, recovering, unsupported schema. The shell and navigation stay visible;
data-dependent actions are disabled while not ready. Never show "no accounts" for a failed query.

## Not in Build 12 (do not build here)
| Item from the canvas | Where it belongs |
|---|---|
| Search / command palette | Triage card |
| Feedback button | Triage card |
| Notifications | "Desktop Privacy, Security & User Notifications" card |
| Theme switcher | "Build UI skins & theme customization" (P2) |
| Session clock and Trading sessions popover | Build 41 (P2) |
| "Add trade" header button | Manual entry is contextual to Today and Journal (Build 20) |

## States and tests
Route rendering, gate states, retry, no-account vs unavailable, root error boundary (see Build 12 acceptance
criteria). Keyboard: Tab order, visible focus, Enter/Space, Escape.
