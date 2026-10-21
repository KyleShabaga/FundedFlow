# Build 10.5 audit and closeout

## Baseline and progress

Audit baseline: `4a462d0963f1b7b3ad45349ba23ee22964b7679f`, fetched from `origin/main` on October 21, 2026. Schema: **18**, registry `apps/desktop/src-tauri/src/db/mod.rs`. Branch: `feat/build-10-5-deep-audit-closeout`.

Requirements: [Build 10.5](https://app.notion.com/p/3ff1bd4b6bde813fb689dca50eaed208), [8.75](https://app.notion.com/p/3ff1bd4b6bde810ba2d3d61788df9b47), [9](https://app.notion.com/p/3fe1bd4b6bde815d8997da8faf64e295), [9.5](https://app.notion.com/p/3ff1bd4b6bde8164a8fbd2cd94245d55), [10](https://app.notion.com/p/3fe1bd4b6bde81468fbedda9a3b3e4d3).

PRs #19, #20, #26, #27, #28, #38, #39, #40, #41, #42 and #44 are merged. Builds 16 and 19 are present; the earlier Notion statement that #42/#44 are drafts is superseded. PR #43 (Build 24 archive/restore/deletion) remains open, outside this implementation baseline. Newer merges include Builds 20, 21, 22, 29 and the collector GUI (#49). No duplicate Build 10.5 branch or PR was found before branch creation.

Baseline CI run [39552757973](https://github.com/KyleShabaga/FundedFlow/actions/runs/39552757973) was in progress when inspected. Earlier run [39548180317](https://github.com/KyleShabaga/FundedFlow/actions/runs/39548180317) passed at `e5e9f05`; historical CI is not a local or packaged-app acceptance result.

Implemented paths include migrations/legacy conversion, catalogue authoring and immutable offer selections, reusable rulebooks/applicability, ledger/settings/snapshots, and reset/archive/restore with independent account IDs. Relevant production commands and adapters must be checked alongside tests; presence alone is not full acceptance.

## Findings under investigation

- P1: `store/accounts.rs::update` appears to mutate an archived account before returning NotFound. Reproduce with a regression test, then guard before any writes.
- P3: `docs/data-model.md` and `docs/architecture/packages.md` retain schema-only/no-command catalogue statements despite production implementation.
- Requirements needing further evidence: complete source-card matrix; same-day/DST reset boundaries; read-only archived writes; supported populated upgrades and rollback; command/serde/Zod parity; packaged Windows smoke.

## Durable next steps

1. Install locked npm dependencies and establish baseline test/build results.
2. Reproduce and fix proven backend defects with focused tests.
3. Complete the acceptance matrix with exact test/function paths and separate manual gates.
4. Reconcile documentation, run full npm/Rust checks, package the Windows app if supported.
5. Push logical commits, preserve the draft PR, update Notion with verified evidence.

No real user journal has been opened or migrated. Real-journal-copy migration requires explicit authorization. Human review/sign-off remains required. Do not mark source cards Done from automated checks alone.

