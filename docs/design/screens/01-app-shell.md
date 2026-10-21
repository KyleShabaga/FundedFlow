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
- Collapsible: 248 px expanded, 72 px icon rail (`aria-label` and tooltip per item), Ctrl+B. Collapses automatically
  on narrow windows. Active item: `flow-soft` ground, `aria-current="page"`.
- Toggle (Build 18.5): a 32 px round button immediately right of the FundedFlow logo, centred on the sidebar's right
  border (`AppFrame` `sidebarEdge`), level with the logo mark, in both widths. Its 44 px hit area overlaps neither the
  logo nor the header. `aria-label` and tooltip "Collapse sidebar" / "Expand sidebar" (tooltip adds "(Ctrl+B)"),
  `aria-expanded`, `aria-controls="primary-navigation"`, `aria-keyshortcuts`. First in the sidebar's tab order.
- Below 760 px, the icon rail is enforced and the toggle is disabled with an explanatory accessible name.
  On wider windows, restore the user's locally saved collapse preference. Ctrl+B leaves editable fields alone.
- Footer: Settings and a "Saved on this computer" status (local-first promise). No Import item in the sidebar.
  Development builds only (Build 26.9): **Add Fake Data** and **Reset All Data** directly above Settings, same
  height, icon size and focus style, icon-only with tooltips when collapsed; absent from production builds
  ([`docs/development/dev-tools.md`](../../development/dev-tools.md)).

## Header
- Left: page title; reserved space for the **AccountContextBar** (account selector and filters; behaviour owned
  by feature cards and Build 14).
- Right: **Import CSV** (primary). It opens a menu (Build 18.5): Quick import (a file you've imported before) and
  Full wizard (first-time or custom files).
- Reserved, not in Build 12: GlobalFreshnessIndicator (Build 21 data), day-ending timer (Triage).

## Route lifecycle

The hash retains the selected route through frontend reloads/remounts, including packaged Tauri URLs without
server rewrite rules. A new window with no hash starts at Today. Restoring the previous route after closing
and reopening the native app is not claimed here; verify native lifecycle behavior during 12.5's Windows smoke
checks. Unknown paths retain the shell and provide a link to Today.

## Runtime gate (Build 12, consuming Build 11 commands)
States: checking, ready, unavailable, recovering, unsupported schema. The shell and navigation stay visible;
data-dependent actions are disabled while not ready. Never show "no accounts" for a failed query.
Recovery status appears once in the shell, including on Settings and unknown routes. Existing data content stays
mounted after runtime loss to preserve local drafts; an inert subtree and disabled fieldset prevent interaction,
and a stale/unavailable notice distinguishes retained content from current data. Retry uses the existing native
initialization command. Root render failure offers Return to app and Open Settings without destructive actions.

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
