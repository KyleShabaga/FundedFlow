# Build 12.2 — Routes, navigation and placeholders

Source: [Build 12 roadmap card](https://app.notion.com/p/3fe1bd4b6bde81fcb69ecde4ae7835a5).
Implemented on the existing `feat/build-12-shell-foundation` branch. Changes from 12.1 and 12.2 remain
uncommitted. No PR was created; the requested workflow is one PR at the end of Build 12.

## Changes

- `src/App.tsx`: nested HashRouter routes for Today (`/`), Journal, Insights, Accounts, Settings,
  development-only developer tools, and a not-found route. No new providers or feature commands.
- `src/app/AppShell.tsx`: persistent sidebar and page header around the route outlet; accurate active-route
  indication, accessible link names and native title tooltips, route-heading focus, and a skip-content link
  that preserves the router hash. Settings remains reachable during runtime failure.
- Sidebar: 248 px expanded, 72 px rail. The button and Ctrl+B toggle the wide-window preference, saved in
  localStorage with a safe fallback if storage is unavailable. Editable controls retain their shortcuts.
  Below 760 px the rail is enforced, with an explanatory disabled toggle; widening restores the preference.
- Header: page title, reserved account-context space, and a disabled primary Import CSV button labelled
  “Not yet available.” No extra import navigation item or unbuilt feature action is presented as functional.
- `RoutePlaceholder` explicitly identifies unfinished features without fabricated financial values or
  records. Unknown routes retain the shell and offer a return to Today.
- `src/design-system/components/app-frame.tsx`: small host-independent frame with sidebar/header/content
  slots, existing semantic tokens, tests and a design-gallery example. No Tauri or router imports.
- `src/app/shell.css`: active cues, visible keyboard focus, sticky sidebar, wrapping header and narrow-window
  spacing. Reuses design-system tokens rather than adding another visual system.
- Developer tooling now fits inside the persistent shell. The old shared-component navigation notes were
  aligned with the roadmap card; shell design notes explain responsive and route lifecycle behavior.

## Validation

- `npm run typecheck` — passed.
- `npm run test -w @fundedflow/desktop -- --reporter=dot` — passed (113 desktop tests).
- `npm run build` — passed, including TypeScript compilation and production bundling.
- `npm run check` — passed domain boundaries and built-package imports.
- `git diff --check` — passed.
- Root tests were updated for the real Today header and truthful placeholder.
- New shell tests cover all five direct hashes and remounts, navigation and a single active item, persistence
  of the same sidebar/runtime owner, heading focus, unknown paths, trailing slash/case handling, skip-content,
  Tab/Enter/Space/Escape/Ctrl+B behavior, saved collapse preference, narrow-window transitions, unavailable
  runtime/Settings access, disabled import reservation, and host-independent frame rendering.

Tests use jsdom with mocked runtime IPC and matchMedia. Hash retention through remounts is verified; this is
not an actual WebView reload or Windows packaging test. Windows scaling, visual layout, native reload and
close/reopen still require the packaged Windows smoke checks in 12.5. No Rust files were changed.

## Remaining Build 12 scope

12.3 owns finite runtime backoff, expanded state modeling and adapter failure/concurrency coverage.
12.4 owns complete shell-visible recovery, non-destructive guidance and preservation of local form state.
12.5 owns the full acceptance reconciliation and packaged Windows verification. Build 12 remains in development;
this sub-build does not mark the app-shell screen shipped.
