# Build 12 — Verification and handoff (12.5)

Source: [Build 12 card](https://app.notion.com/p/3fe1bd4b6bde81fcb69ecde4ae7835a5).
Branch: `feat/build-12-shell-foundation`. Prepared as one Build 12 PR after the sub-build checkpoints.
Implementation through 12.4 is ready for native verification; Build 12
is **Testing**, not Done or shipped, because the native checks below remain blocked.

## Acceptance reconciliation

“Passed” means supported by the listed frontend tests, browser checks or source inspection. Browser IPC is
simulated; no row implies that native Windows/Tauri execution occurred.

| Card acceptance criterion | Status | Evidence / remaining gap |
|---|---|---|
| Real shell, default Today, five persistent navigation items with accurate active state | Passed | App/route tests and Chromium navigation checks; truthful unfinished feature placeholders, no financial examples. |
| Navigation, unknown routes, reload and close/reopen in a packaged Tauri app; honest Import CSV reservation | Blocked | Real Chromium hash navigation/reload/unknown paths and disabled import reservation pass. Packaged Windows WebView2 lifecycle is not available here. A new hashless window starts at Today; hash reload retains the route. |
| Build 7 styling, keyboard access at supported sizes, host-independent presentation | Blocked | Tokens/contrast tests, keyboard component tests, Chromium layout checks at 1280×800 and 1024×640, 1.5 device-scale emulation, 640/320 px responsive widths, and frame source inspection pass. Real Windows scaling is unverified. |
| One root router/query/runtime composition and error boundary; no feature polling loops | Passed | Root/provider/StrictMode tests and source inspection. Runtime focus rechecks share the same provider cycle. |
| Existing real command contracts; read-only status and explicit actual initialization Retry | Passed | Rust source matches the validated adapter; command tests and browser-injected transport verify runtime_status versus retry_runtime. Rust files are unchanged; native execution is pending below. |
| Successful empty accounts distinguishable from runtime/migration/rejection/newer-schema failures; no fabricated data | Passed | Test-only query consumer proves valid [] versus query failure and runtime failure; unsupported-schema and first-run-ready response tests. Product root adds no feature queries or mock data. Native first-run smoke remains pending. |
| Launch/post-ready failure shows recovery; bounded retries, draft preservation and return to ready | Passed | Adapter/provider/gate/recovery tests; Chromium post-ready focus failure and keyboard recovery. Initial absent bridge renders shell recovery. Native journal-preservation checks remain owned by Build 11 and require native execution. |
| Data actions disabled while unavailable; navigation and safe recovery visible; no destructive auto-recovery | Passed | Disabled fieldset/inert subtree, stale notice, saved draft/node retention and disabled import tests; browser controls and navigation checks; recovery source inspection. |
| Build-12 component tests plus development and packaged Windows smoke checks | Blocked | Component suite and real development/production-preview Chromium smoke pass. Packaged Windows and Rust checks cannot run in this Linux environment without Cargo/WebView2. |

## Commands and results

| Check | Result |
|---|---|
| `npm run typecheck` | Passed (domain and desktop). |
| `npm test` | Passed: 307 domain tests + 160 desktop tests (467 total). |
| `npm run test -w @fundedflow/desktop -- --reporter=dot` after final route/layout fixes | Passed: 160 desktop tests. |
| `npm run build` | Passed (domain build, desktop TypeScript and Vite production output). |
| `npm run check` | Passed (domain boundaries and plain-Node built-package imports). |
| `git diff --check` | Passed. |
| `node --check apps/desktop/scripts/smoke-shell.mjs` | Passed. |
| `node apps/desktop/scripts/smoke-shell.mjs` | Passed in real Chromium 154 against Vite development and production preview, with mock runtime IPC; absent-bridge scenarios use no mock. |
| Production asset inspection | Developer tooling, account command code and smoke fixture globals excluded from production JS. Production /settings/developer resolves to not found, with no false active navigation item. |
| `cargo test` | Blocked: exit 127, cargo: command not found. |
| `cargo clippy --all-targets -- -D warnings` | Blocked: exit 127, cargo: command not found. |
| Windows packaged smoke / actual OS scaling | Blocked: Linux host, no Windows/WebView2 runtime or packaged app. |

The Chromium script starts only the existing development and preview servers on loopback and tears them down.
It adds no service to the shipped app and uses no new dependencies. Run it after `npm run build` from the repo
root; override `CHROMIUM_PATH` if necessary. It needs Node 22+ and a local Chromium executable. On this host,
local sockets required sandbox escalation; that execution was approved. Output is in `/tmp/fundedflow-build12`:
`results.json`, `development-recovery.png`, `development-narrow.png`, `production-recovery.png` and
`production-narrow.png`. These transient screenshots are review artifacts, not app assets or a shipped-screen
status update. Device-scale emulation does not substitute for Windows OS scaling or WebView2.

Browser checks cover launch, all five links/active states, real reload, Ctrl+B, expanded/rail dimensions,
responsive overflow, focus-based runtime loss, disabled/inert data content, keyboard Retry, return to ready,
unknown-route recovery and production-only developer-route exclusion. With no Tauri bridge, the browser shows
recovery and navigation instead of mounting data content. Browser checks found and fixed an inconsistent title
for the excluded developer route, false active navigation on unknown descendants, and header wrapping at 320 px.

## Changed files

All paths below are under the repository root; no Rust, migration, lockfile or dependency changes were made.

- Root: `apps/desktop/src/App.tsx`, `App.css`, `App.test.tsx`.
- Composition, runtime and shell: `apps/desktop/src/app/AppProviders.tsx`, `AppShell.tsx`, `DeveloperTools.tsx`,
  `RootErrorBoundary.tsx`, `RuntimeProvider.tsx`, `shell.css`, `AppShell.test.tsx`, `RuntimeProvider.test.tsx`,
  `RuntimeRecovery.test.tsx`.
- Runtime UI/bridge: `apps/desktop/src/components/RuntimeGate.tsx`, `RuntimeGate.css`, `RuntimeGate.test.tsx`;
  `apps/desktop/src/lib/data/runtime.ts`, `runtime.test.ts`; test fixtures in `apps/desktop/src/test/runtime-fixtures.ts`.
- Shared presentation: `apps/desktop/src/design-system/components/app-frame.tsx`, `components/primitives.tsx`,
  `index.ts`, `design-system.css`, `DesignSystemGallery.tsx`, `gallery.css`.
- Basic browser verification: `apps/desktop/scripts/smoke-shell.mjs`.
- Documentation: `README.md`, `docs/data-model.md`, `docs/design-system.md`, `docs/design/components.md`,
  `docs/design/screens/01-app-shell.md`, `docs/build-12.1-evidence.md`, `docs/build-12.2-evidence.md`,
  `docs/build-12.3-evidence.md`, `docs/build-12.4-evidence.md`, and this note.

## Native verification still required

On a Windows machine with Rust, Visual Studio C++ tools and WebView2:

1. Run the existing Windows CI commands: npm checks above, `cargo test` and
   `cargo clippy --all-targets -- -D warnings` in `apps/desktop/src-tauri`.
2. Run `npm run tauri dev`, then `npm run tauri build`; verify both launch with an isolated first-run journal,
   show truthful placeholders and never conflate unavailable local data with no accounts.
3. Verify all five routes, unknown paths, native reload, close/reopen, active state, expanded/collapsed sidebar,
   Tab/Enter/Space/Escape/Ctrl+B and Windows 100%, 125%, 150% and 200% display scaling. New windows default to
   Today; hash reloads retain their route. No claim of last-route persistence across native restarts is made.
4. Use isolated test journals and existing Build 11 failure scenarios to verify database-open, backup/migration
   and newer-schema failures. Keep real user journals untouched. Confirm shell/Settings/Retry accessibility and
   recovery after resolving a retryable cause. A newer schema offers guidance without downgrade/reset/restore.
5. Confirm actual retry behavior, frontend finite checking during a long initialization, post-ready failure
   recheck on app focus, and preservation of existing database records. Draft retention during runtime loss is
   covered by the component harness; product routes intentionally have no business forms yet.

These are pending verification steps, not passed checks. Native failure-matrix expansion, diagnostic bundles
and comprehensive desktop regression remain Build 26.5. Feature queries/hooks, account onboarding and business
screens remain Build 14 and their respective feature cards. The app-shell screen is not marked shipped; earlier
sub-build evidence records the uncommitted checkpoints before PR preparation.
