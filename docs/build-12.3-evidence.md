# Build 12.3 — Runtime state and adapter integration

Source: [Build 12 roadmap card](https://app.notion.com/p/3fe1bd4b6bde81fcb69ecde4ae7835a5).
Continues the existing `feat/build-12-shell-foundation` branch. All Build 12 changes remain uncommitted;
no PR has been created. One PR is planned at the end of Build 12.

## Implementation

- `src/lib/data/runtime.ts` remains the sole runtime IPC boundary, limited to `runtime_status` and
  `retry_runtime`. Both responses pass the same Zod validation. In addition to shape/enum checks, validation
  rejects contradictory ready/failure/stage/version fields, invalid Rust u32 versions, retryable newer schemas,
  and inconsistent migration metadata. Rust contract fields were checked against `runtime.rs`; no Rust code changed.
- `createRuntimeGateway` accepts a transport for isolated tests. Production still uses Tauri invoke only here.
  Errors are classified as timeout, rejected, invalid-response or pending, with safe fixed messages.
- Same-command calls share their promise. Different concurrent commands fail as pending. Each call has a
  10-second response deadline. Since Tauri IPC cannot be cancelled, timeout retains the bridge lock until the
  original invoke settles. This prevents a second initialization/status command overlapping an unanswered call.
  Late success does not turn an expired frontend request into ready; a fresh explicit check/retry is required.
- `src/app/RuntimeProvider.tsx` is the single frontend runtime owner. It exposes shared `check()` (read-only)
  and `retry()` actions and models checking, ready, unavailable, recovering and unsupported-schema states.
  Ready retains the validated runtime snapshot; unavailable never represents empty accounts.
- A cycle performs at most eight commands. After each initializing response, delays are 500 ms, 1 s, 2 s,
  4 s, 8 s, 8 s, and 8 s. There are no intervals or overlapping requests. Known failures and bridge errors
  stop immediately. Exhaustion yields unavailable/initialization-pending and pauses automatic checks.
- Manual Retry invokes `retry_runtime` exactly once, followed only by read-only status polling if initializing.
  Concurrent consumer actions share the current cycle. Unsupported newer schema blocks mutating Retry.
  Read-only rechecking remains possible after ready/failure; no perpetual background polling was added.
- Unmount cancels scheduled checks and invalidates late results. StrictMode startup shares bridge work rather
  than issuing duplicate native commands. Each cycle has a separate generation so old results cannot overwrite it.
- `src/components/RuntimeGate.tsx` consumes the expanded states. Budget exhaustion says initialization may still
  be running and automatic checks paused; it never claims the native migration failed or cancels it. Generic
  bridge failure no longer claims that no database changes occurred: a timed-out retry may have started work.
- `docs/data-model.md` documents finite frontend checking separately from the unbounded native upgrade lifetime.

## Validation

- `npm run typecheck` — passed.
- `npm test` — passed: 307 domain tests and 153 desktop tests.
- `npm run build` — passed.
- `npm run check` — passed domain boundaries and built-package imports.
- `git diff --check` — passed.
- Source inspection confirms no new runtime invoke imports in UI/provider components and no feature queries.

Adapter tests cover both command names, all five failure categories, malformed/unknown/contradictory results,
rejected/synchronously throwing bridges, same-command coalescing, cross-command exclusion, deadlines for both
commands, late replies and lock release. Provider tests cover launch/StrictMode, every failure category, malformed/
rejected/timed-out status, exact finite backoff, exhaustion, actual retry and recovering state, deduplication,
post-ready failure/recovery, unsupported-schema restrictions, unmount cleanup and late-result exclusion.
Gate tests cover the paused-initialization message and recovery as well as existing migration/schema behavior.
Synthetic runtime fixtures live under `src/test` and are imported only by tests.

## Limits and handoff

Validation uses mocked IPC and jsdom, not a running Windows/Tauri app. Packaged Windows checks remain for 12.5;
Cargo is unavailable here. An indefinitely unanswered native invoke requires a new bridge/app restart rather
than overlapping another command; the frontend does not pretend its timeout cancels native work.

Build 12 remains in development. 12.4 still owns complete shell-visible recovery, accessible guidance and
preserving unsaved form state after a post-ready failure. 12.5 owns full acceptance reconciliation and the
packaged Windows smoke checks. No feature logic, cloud access, destructive recovery or database mutation
implementation was introduced.
