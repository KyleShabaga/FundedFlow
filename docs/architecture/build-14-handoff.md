# Build 14 integration handoff

Import hooks, view-model types, `FeatureDataError`, filters and `featureKeys` from
`apps/desktop/src/features/index.ts`. Feature `api/` modules are non-React operations over the existing
`repository`; React consumers should use the hooks. All hooks consume the existing AppProviders and
RuntimeProvider. No provider, route or shared UI change is required to install this layer.

## Exports and parameters

| Feature | Read hooks | Mutation hooks / inputs |
| --- | --- | --- |
| Accounts | `useAccounts(filter = "live")`, `useAccount(id)`, `useAccountHistory(id)`, `useAccountLineage(id)`, `useAccountDeletionPreview(id)` | `useCreateAccount()` / AccountInput; `useUpdateAccount(id)` / AccountInput; `useArchiveAccount(id)`, `useRestoreAccount(id)` / void; `useChangeAccountStatus(id)` / StatusChangeInput; `useResetAccountAttempt(id)` / ResetInput |
| Trades | `useTrades(accountId, filters?)`, `useTrade(accountId, tradeId)` | `useCreateTrade(accountId)`, `useUpdateTrade(accountId, tradeId)` / TradeInput; `useDeleteTrade(accountId, tradeId)` / void |
| Journal | `useJournalEntries(accountId, filters?)`, `useJournalEntry(accountId, entryId)` | `useCreateJournalEntry(accountId)`, `useUpdateJournalEntry(accountId, entryId)` / JournalEntryInput; `useDeleteJournalEntry(accountId, entryId)` / void |
| CSV | `useImportHistory(accountId)`, `useImportResult(accountId, batchId)`, `useImportProblemRows(accountId, batchId)` | `useCsvPreview().preview(request)` and `useCommitCsvImport(accountId).submit(request)` / CsvImportRequest; preview never commits |
| Insights | `useSnapshotHistory(accountId, filters?)`, `useLatestSnapshot(accountId)`, `useInsightsCapability()` | No snapshot generation or aggregate writes |
| Ledger | `useLedger(accountId)`, `useLedgerBalanceAdjustment(accountId)` | `useCreateLedgerEntry(accountId)`, `useUpdateLedgerEntry(accountId, entryId)` / LedgerEntryInput; `useDeleteLedgerEntry(accountId, entryId)` / void |
| Settings | `useSettings()`, `useSetting(key)` | `useSetSetting(key)` / JSON-compatible value, maximum 64 KiB; `useRemoveSetting(key)` / void |
| Reference data | `useCatalogue()`, `useAccountCatalogueLink(accountId)`, `useAccountPhaseEvents(accountId)`, `useAccountOfferSelections(accountId)`, `useRulebooks(accountId = null)`, `useRulebookVersions(rulebookId)`, `useRulebookVersion(versionId)`, `useApplicableRulebook(query)`, `useAccountRulebookAssignments(accountId)` | Existing catalogue/rulebook editor operations remain outside this build |
| Capabilities | `useTodayCapability()`, `useReviewCapability()` | No requests or fabricated records |

Mutation input types above come from `@fundedflow/domain`. A null identity disables a read, except
`useRulebooks(null)` explicitly requests all rulebooks. Account list filters reuse the domain AccountFilter.
TradeFilters contains inclusive stored trading-day `from`/`to`, exact `symbol`, and `side` (long/short).
JournalFilters contains inclusive offset-aware instant `from`/`to`, `tradeId`, and exact `tag`.
SnapshotFilters contains inclusive trading-day `from`/`to` and `endOfDayOnly`. Invalid ranges reject with
validation errors. Keys include every filter/identity; detail reads for trades/journal use existing list
commands because there is no native detail command.

## Data and presentation mapping

Read operations return `ReadReceipt<T>`: `{ value, receivedAt, source: "local-repository" }`.
Hooks unwrap `value` to `data`; `observedAt` is the client receipt timestamp, never a risk calculation time.
Account/trade/journal/import/snapshot view models validate existing domain schemas more strictly at the
feature boundary. Money remains canonical decimal text exactly representable in signed 64-bit micro-units;
prices/quantities retain canonical decimal precision. No JavaScript floating-point financial calculation
is introduced. Instants require UTC/offsets; stored trading days are retained, not recalculated in the browser.

Trade models join current account currency/timezone and declare Rust-stored gross/net basis with an unknown
calculation version (`null`). Snapshot models retain stored `engineVersion`, `inputsHash`, `calculatedAt`,
nullable `dataAsOf`, nullable metrics and the `unknown` risk status. Snapshot `currency` is **null** because
its persisted record does not freeze currency; `accountCurrency` describes only the current account.
`currencyBasis: "not-stored-in-snapshot"` and `provenance: "persisted-snapshot-not-live"` prevent claiming
historical units or live health. History events have no backend IDs; do not use invented record IDs or array
positions as persistent identity. Import problem-row identity is the batch ID plus row number.

Build 13 owns presentation types and components. **Do not map these facts by hand in screens: use
`shared/presentation.ts`** (`toAsyncState`, `toMutationState`, `fieldErrors`, `issueSentence`, `retryRead`), which
encodes the table below and is tested against the real design-system components in `presentation.test.tsx`.
The facts it reads:

| Hook fact | Presentation meaning |
| --- | --- |
| `isInitialLoading` | No validated data yet, while the runtime is ready and the first read runs, or while the runtime is still checking/recovering |
| `isRuntimePending` | The runtime is checking or recovering: a transient wait, not unavailable data; `error` is null |
| `isRefreshing` | Background request with retained data |
| `isEmpty === true` | Successful, runtime-ready empty result; `null` means emptiness is unclassified |
| `error` | Safe FeatureDataError category/message/field issues; render error or unavailable controls |
| `isStale`, `staleReason` | `refresh-error` / `runtime`: retained data could not be confirmed, show it as stale with its receipt time. `cache-age` is only TanStack refetch bookkeeping (older than 30 s); local data changes only through invalidated writes, so it is **not** a stale notice |
| `isUnavailable`, `isUnsupported`, `runtimeKind` | Settled unavailability or a newer journal: use shell recovery/update instructions; never show an empty-success state |
| `isUsable` | Successful current query with ready runtime; still inspect freshness/provenance before risk display |
| snapshot `status: "unknown"` / nullable metrics | Preserve unknown/absent, distinct from safe/zero |
| capability `available: false` | Explicit unsupported feature with reason and owning-build dependency; no metric data |

A null setting/latest snapshot is a successful absence. Missing detail records are errors. Cached data can
remain visible after read failure/runtime loss, but is marked stale and unusable; do not present it as current
risk. Errors are never substituted with empty arrays. Raw SQL, Rust paths and import errorSummary are omitted.
`backendKind` preserves known repository categories; `diagnosticReference` is null because the native contract
has no correlation identifier.

Reads use a 30-second stale window, a 10-second deadline per repository step (60 seconds for CSV previews, which
parse up to 10 MB / 50,000 rows), and at most one retry (500 ms)
for timeout/unexpected failures while ready. Validation/conflict/unavailable/invalid-response do not retry.
No feature focus poll or recovery manager is installed. Unavailable responses ask the existing runtime to
check itself. Runtime loss cancels consumption and invalidates cached reads without refetching until ready.
Unmount/account changes consume TanStack AbortSignal; native Tauri invokes cannot actually be aborted.
Local reads and writes use `networkMode: "always"` so browser offline status does not block SQLite access.
CSV previews are explicit read actions with cancellation, no persistent query keys and mutation gcTime zero;
results are hidden while runtime is unavailable.

## Writes and cache consistency

Call `submit(input)` and handle its rejection as well as returned feedback. `outcome` is idle, submitting,
failed, confirmed-success, confirmed-failure or uncertain-outcome. `canSubmit` includes runtime readiness and
a shared submission lock, reserved synchronously across hook instances using the existing QueryClient.
Scopes group account lifecycle actions per account, trade/journal/ledger actions per account and feature,
CSV commits per account, settings per key, and account creation globally. No optimistic financial writes or
automatic write retries occur. Ownership/preflight reads finish before a final runtime-readiness check on
trade/journal/ledger writes. This gate cannot roll back a command already sent to Rust.

A 30-second deadline, unknown write error or invalid write acknowledgement means **uncertain-outcome**,
not confirmed failure. The lock survives feedback `reset()`, unmount and late success within this QueryClient.
There is no durable lock across process restarts and no native idempotency/outcome lookup. After checking
persisted records, and only after the original command settles (`canAcknowledgeUncertainOutcome`), call
`acknowledgeUncertainOutcome({ recordsReviewed: true })`. This releases the lock and invalidates relevant
reads; it does not prove rollback or automatically replay. An indefinitely pending native command stays
locked. The consuming UI must expose a review/recovery flow, never a blind retry button.

A CSV commit can resolve with a **persisted failed batch**. This maps to confirmed-failure with a safe
failureMessage and refreshes import history, not trade data. A committed batch maps to confirmed-success.
Query refresh failure after a confirmed write never reclassifies that write as failed.

| Confirmed write | Invalidated reads |
| --- | --- |
| Account create | Account lists |
| Account update/archive/restore/status/reset | Lists, account family (including derived trades), lineage, account rulebooks; reset also successor family |
| Trade create/update/delete | Trades, journal links, snapshots, deletion preview, lineage |
| Journal create/update/delete | Journal, deletion preview |
| CSV committed | Imports/results/problem rows, trades, snapshots, deletion preview, lineage |
| CSV persisted failed | Imports/results/problem rows, deletion preview |
| Ledger create/update/delete | Ledger/balance, snapshots, deletion preview |
| Settings set/remove | All settings |

## Integration and backend dependencies

Build 13 is integrated through `shared/presentation.ts` (type-only imports of the design system). Route
consumers render `StateBoundary`/`ChartPanel`/`DataTable` fallbacks from `toAsyncState`, and `MutationFeedback`
from `toMutationState`, passing the account's `currency` to every money component. For uncertain writes, put an
"I've checked the records" button in `MutationFeedback`'s `actions` that calls `acknowledgeUncertainOutcome`
once `canAcknowledgeUncertainOutcome` is true. Keep AppProviders and RuntimeProvider as the existing owners.
Field-level contract details are in [build-14-contracts.md](build-14-contracts.md).

Missing contracts remain explicit: live Today summary/risk, aggregate Insights and structured reviews;
historical snapshot currency; stable history-event IDs; native cancellation/correlation IDs; durable
idempotency/outcome reconciliation. Existing saved snapshots can be inspected, but cannot fulfill live risk
acceptance. Catalogue/rulebook editing and snapshot generation continue through their owning builds.
Run real Windows/Tauri/SQLite scenarios, including failed CSV commit and recovery during a write, before
claiming desktop acceptance. Mocked feature and adapter-contract tests do not establish native acceptance.

## Adding a supported operation

First verify its real repository method, domain schema and Rust command in the owning backend build.
Extend that existing port/adapter in a coordinated change only if the operation is absent; keep it explicitly
unsupported here until then. Add a feature-edge schema/mapper with explicit units/nulls/provenance, an api
operation using readOperation/writeOperation, an identity-complete query key and a hook using the shared
policies. For preflight writes, pass the readiness guard immediately before invocation. Define affected
cache families and uncertainty handling, then add schema/failure-path/hook tests and an adapter-contract
case. Export the consumer contract and update this handoff. Finally wire the route to Build 13 presentation
components and verify the real Windows/Tauri path; frontend mocks do not substitute for that step.
