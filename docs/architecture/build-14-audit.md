# Build 14 audit and file ownership

Sources: [Build 14](https://app.notion.com/p/3fe1bd4b6bde81cf88cad3ef2ff6a338),
[Build 13](https://app.notion.com/p/3fe1bd4b6bde813681ddf4e89b4ba70d), repository package/data/design docs,
rulebook migration/contract docs, and Build 12 verification. Both complete Notion specs were reviewed.

Base: main `475807db1cf17aad0d1416067993d01a7b3b47a9`, merged PR #30 including the ready-on-focus fix.
Isolation: `/workspace/FundedFlow-build14`, branch `feat/build-14-typed-gateways`. The previous checkout is untouched.
At audit time remote branches contained only main and the GitHub open-PR search returned none. Claude's
unpublished Build 13 checkout cannot be inspected here; its stated ownership boundaries remain protected.

Existing authoritative functionality is reused: `JournalRepository`, `repository`, Zod DTO schemas and input
validators, `createTauriRepository`, decimal/micro-unit helpers, account eligibility/filter functions, the
existing QueryClient/provider and RuntimeProvider. Rust commands were checked against the adapter signatures.
There are no existing feature query hooks. Domain response schemas often permit unchecked string money/times;
Build 14 adds strict feature-edge validation without changing the wire contracts or adapter.

New code is restricted to `apps/desktop/src/features/` and dedicated documentation here. No shell, provider,
UI component, design-system/gallery, shared CSS, Build 13 test, domain, Rust, migration, manifest or lockfile
changes are needed. Feature operations use the existing repository; execution helpers are policy/validation
wrappers, not another transport or repository. No presentation components or competing presentation-state union.

Supported reads: accounts/details/history/lineage/deletion preview, trades, journal entries, CSV previews and
history/problem rows, ledger/settings, persisted snapshots, catalogue/rulebook reads. Supported writes reuse
existing account lifecycle, trade/journal, CSV commit and ledger/settings operations. Catalogue/rulebook
editing and engine-produced snapshot writes stay with their owning feature/engine work.

Backend gaps: no live Today summary, Insights aggregate operation or structured review contract. Snapshot
reads expose stored calculation timestamps/version/basis, never live health. Account history events lack
individual IDs; the view model preserves account identity and explicitly says event IDs are not exposed,
rather than inventing IDs from array positions. Preview rows have no persisted trade IDs. Native invoke
cancellation, correlation IDs and write idempotency/outcome lookup are not available in the current port.
