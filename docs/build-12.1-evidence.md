# Build 12.1 — Shell foundation

Source: [Build 12 roadmap card](https://app.notion.com/p/3fe1bd4b6bde81fcb69ecde4ae7835a5).
Scope: sub-build 12.1 only. Build 12 remains in development.

## Prerequisites verified

- Build 11: `src-tauri/src/commands.rs` registers read-only `runtime_status` and mutating
  `retry_runtime`; both return `runtime::RuntimeStatus`. Retry starts background initialization
  and is a no-op while ready or already initializing. `src-tauri/src/lib.rs` registers both commands.
- The existing `src/lib/data/runtime.ts` is the sole runtime IPC adapter. Its Zod schema matches the
  Rust camelCase status fields, initializing/ready/failed states, snake_case stages and five failure
  categories, including nullable migration details. Both bridge calls have a 10-second timeout.
  This was verified by source inspection and browser-environment tests using mocked IPC, not a live Tauri run.
- Build 7: reused bundled fonts, semantic tokens, `ds-surface`, and the existing `Button`. The application
  surface uses the dark theme; no new token or reusable primitive system was introduced.
- Build 13 owns reusable forms/async patterns; Build 14 owns feature contracts, query keys, hooks,
  invalidation, and account-context behavior. Neither is implemented here. No feature query was added.

## Implementation

- `src/App.tsx`: product foundation replaces the developer-only start screen. A reserved account-context
  integration comment marks the future header location. Product navigation is deferred to 12.2.
- `src/app/AppProviders.tsx`: one root error boundary, HashRouter, stable QueryClient/provider, and
  RuntimeProvider. Automatic query/mutation retries are off; routes must consume these providers.
- `src/app/RuntimeProvider.tsx`: extracted the existing runtime state/check/retry lifecycle from
  RuntimeGate. Multiple consumers share one check and polling loop; no new Tauri imports or commands.
- `src/components/RuntimeGate.tsx`: presentation consumes that shared state. Existing recovery tests
  now mount the provider and continue to pass, including the actual retry-gateway path.
- `src/app/RootErrorBoundary.tsx`: useful render-error fallback without raw exception details; Return to app
  remounts the root at `#/` and checks runtime availability again.
- `src/app/DeveloperTools.tsx`: existing gallery and data panel remain reachable at
  `#/settings/developer` in development only. The gallery opens first; the data panel still gates on readiness.
  Production output was inspected to confirm the developer tools and account command code are excluded.
- `src/App.css`: removed starter global control styles and uses design-system tokens for the foundation.
- `src/App.test.tsx`: jsdom root tests cover StrictMode startup without Tauri, runtime failure containment,
  shared providers/checks across consumers and rerenders, and root error fallback/return.
- README, design-system guidance and startup documentation reflect the new composition and developer route.

## Validation

Passed on October 20, 2026:

- `npm run typecheck`
- `npm test` — 307 domain tests and 99 desktop tests, including four new root tests
- `npm run build`
- `npm run check` — domain boundary and built-package checks
- `git diff --check`
- Source inspection: one production router/query/runtime composition; no UI imports of Tauri invoke added.
- Production asset inspection: no developer-tools labels, gallery module, or `list_accounts` command.

Rust files were unchanged. Cargo is not installed in this environment, so Rust checks were not run.
Packaged Windows launch/reload/close-and-reopen and live IPC smoke checks remain unverified here.

## Handoff

12.1's browser-render, single-composition and no-duplicated-runtime-access evidence passes in jsdom.
12.2 owns the five product routes, not-found handling, sidebar, keyboard navigation, and Import CSV reservation.
12.3 owns bounded backoff, expanded frontend states, response failure coverage and concurrency verification.
The inherited 500 ms initialization polling still has no finite attempt limit; it must be reconciled there
with Build 11's long-running upgrade behavior, without stopping or mutating a running migration.
12.4 owns the complete shell-visible recovery and state-preservation behavior. 12.5 owns the full Build-12
acceptance reconciliation and development/packaged Windows verification. The screen is not marked shipped.
