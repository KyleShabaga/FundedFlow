# Build 14 verification

Verified on 2026-10-20 in isolated worktree `/workspace/FundedFlow-build14`, branch
`feat/build-14-typed-gateways`, from main `475807db1cf17aad0d1416067993d01a7b3b47a9`.
Final remote refresh showed main unchanged and no published Build 13 branch/open PR. No unpublished
Build 13 changes were imported. The original `/workspace/FundedFlow` checkout was left untouched.

## Results

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed domain and desktop |
| `npm test` | Passed: domain 307 tests / 8 files; desktop 208 tests / 19 files (515 total) |
| `npm exec -w @fundedflow/desktop -- vitest run src/features --reporter=dot` | Passed: 47 new feature tests / 6 files |
| `npm run build` | Passed domain compilation and desktop tsc/Vite production build |
| `npm run check` | Passed domain boundaries and generated package load check (143 exports) |
| `git diff --check` | Passed |
| `cargo test` | Unavailable: cargo is not installed (exit 127) |
| `cargo clippy --all-targets -- -D warnings` | Unavailable: cargo is not installed (exit 127) |
| Native Windows/Tauri/SQLite smoke test | Not run: this environment is Linux without the native toolchain |

Existing Windows CI already runs frontend checks/tests and Rust test/clippy on PRs, so the new colocated
tests are discovered without a workflow change. CI and Windows desktop acceptance remain pending.

The independent tests cover decimal micro-unit boundaries and high-precision prices; null/zero/unknown
values; invalid enums/dates/timezones; cross-account mapping and cache isolation; safe error categories;
valid empty versus failure; loading/background refresh; failed refresh retaining stale data; runtime
unavailable/unsupported/recovery; abort/unmount and account switches; offline local access; bounded read
retry/deadline; mutation success/conflict/failed batch; invalidation; duplicate concurrent submissions;
readiness loss during write preparation; uncertain outcomes, late results and explicit acknowledgement.

The small integration test runs feature operations through the actual existing `createTauriRepository`
with a fake invoke function, checking command arguments and error/acknowledgement parsing. It is a frontend
contract integration test, **not** a real Tauri, Rust or database integration test.

## Ownership and architecture

All branch changes are new files under `apps/desktop/src/features/` or `docs/architecture/build-14*.md`.
No pre-existing production file was changed. Build 13 UI/shared forms/state components, design system,
gallery, CSS/tokens, design docs and component tests are untouched. The application shell/providers/router,
existing repository/adapter/runtime files, domain, Rust, migrations, manifests and lockfile are untouched.

Production feature modules import the existing repository, useRuntime and useQueryClient. They introduce
no invoke calls, QueryClient construction/provider, runtime polling, SQL, server/network API or financial
arithmetic. Test fixtures and test-only QueryClient construction are referenced solely by test files.

Commits separate the contract audit/view models, repository-backed operations, and query/mutation policies
with integration handoff. See [audit](build-14-audit.md) and [handoff](build-14-handoff.md).

## Acceptance limits and next verification

The supported frontend contract/gateway/hook foundation and independent tests are complete. Actual route
integration with Build 13 is deferred to preserve file ownership. Neither protected UI changes nor new
provider composition were needed. No merge conflict was found against the verified main base; compatibility
with unpublished Build 13 exports cannot be established until its branch is available.

Backend-dependent features remain explicit unsupported capabilities: Today/live risk summary, aggregate
Insights and structured reviews. Stored snapshots lack frozen currency; history events lack IDs. Native
invoke cancellation, correlation IDs and durable write idempotency/outcome lookup are absent. These gaps
were not filled with fake entities or frontend calculations.

Before desktop acceptance, run Windows CI and a real local journal smoke test covering list/detail/filter,
CRUD and scoped refresh, CSV preview versus committed/failed batches, runtime loss/recovery, offline access,
and write outcome review. After Build 13 merges, map these hooks to its actual presentation contract and
add route-level tests in a separate integration change. Do not mark live risk or missing backend capabilities
accepted based on the mocked tests above.

## Integration review follow-up (2026-10-21)

Branch `feat/build-13-14-integration`: Build 14 (`feat/build-14-typed-gateways`) merged with Build 13
(`feat/build-13-design-system-async-states`, including its review fixes), then the review's fixes. Verified on
Windows 11 with Node and the Rust toolchain.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | Passed: domain 307 / 8 files; desktop 321 / 26 files |
| `npm run build` | Passed |
| `npm run check` | Passed (domain boundaries; dist OK, 143 exports) |
| `git diff --check` | Passed |
| `cargo test` | Passed: 154, 1 ignored (includes the new `wire_contract` test) |
| `cargo clippy --all-targets -- -D warnings` | Passed |

What changed and how it is verified:

- **Presentation adapter** (`shared/presentation.ts`): `presentation.test.tsx` drives the real design-system
  `StateBoundary`, `DataTable`, `TextField`, `ValidationSummary` and `MutationFeedback` from the real hooks:
  loading to data, valid empty, failure never empty, startup checking as loading, runtime loss and newer schema as
  unavailable, failed refresh as stale "last loaded", unknown P&L as unknown, currency per account, field and
  summary errors with focus, duplicate submits (click and Enter), invalidation after a confirmed write, and an
  uncertain write that offers only a check and unlocks after "I've checked the records".
- **Validation messages**: our schemas' and Rust's own field messages are kept when free of paths, SQL, Rust
  sources and line breaks (`operations.test.ts`).
- **Runtime pending**: `checking`/`recovering` report initial loading with no error (`hooks.test.tsx`).
- **CSV preview deadline**: 60 s instead of 10 s (`operations.test.ts`).
- **Real Rust payloads**: `wire_contract.rs` records every read command's payload for a fresh journal and for the
  v3/v4 journals after upgrade; `wire-contract.test.ts` passes all of them through the Tauri adapter and every
  Build 14 read operation. This replaces the fake-invoke-only evidence for payload shapes and legacy data.

Still not verified: the packaged Windows app over real Tauri IPC (WebView2), interactive keyboard use and display
scaling. The wire check covers payload shapes, not IPC transport, timing or native cancellation.
