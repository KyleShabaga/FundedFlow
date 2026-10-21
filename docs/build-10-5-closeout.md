# Build 10.5 audit and closeout

## Baseline and progress

Audit baseline: `4a462d0963f1b7b3ad45349ba23ee22964b7679f`, fetched from `origin/main` on October 21, 2026. Schema: **18**, registry `apps/desktop/src-tauri/src/db/mod.rs`. Branch: `feat/build-10-5-deep-audit-closeout`.

Requirements: [Build 10.5](https://app.notion.com/p/3ff1bd4b6bde813fb689dca50eaed208), [8.75](https://app.notion.com/p/3ff1bd4b6bde810ba2d3d61788df9b47), [9](https://app.notion.com/p/3fe1bd4b6bde815d8997da8faf64e295), [9.5](https://app.notion.com/p/3ff1bd4b6bde8164a8fbd2cd94245d55), [10](https://app.notion.com/p/3fe1bd4b6bde81468fbedda9a3b3e4d3).

PRs #19, #20, #26, #27, #28, #38, #39, #40, #41, #42 and #44 are merged. Builds 16 and 19 are present; the earlier Notion statement that #42/#44 are drafts is superseded. PR #43 (Build 24 archive/restore/deletion) remains open, outside this implementation baseline. Newer merges include Builds 20, 21, 22, 29 and the collector GUI (#49). No duplicate Build 10.5 branch or PR was found before branch creation.

Baseline CI run [39552757973](https://github.com/KyleShabaga/FundedFlow/actions/runs/39552757973) was in progress when inspected. Earlier run [39548180317](https://github.com/KyleShabaga/FundedFlow/actions/runs/39548180317) passed at `e5e9f05`; historical CI is not a local or packaged-app acceptance result.

Implemented paths include migrations/legacy conversion, catalogue authoring and immutable offer selections, reusable rulebooks/applicability, ledger/settings/snapshots, and reset/archive/restore with independent account IDs. Relevant production commands and adapters must be checked alongside tests; presence alone is not full acceptance.

## Findings and remediation

- P1 confirmed and fixed: `store/accounts.rs::update` committed archived identity/status edits and then returned NotFound. Its account lookup now excludes archived rows before any related writes.
- P1 confirmed and fixed: `store/trades.rs::delete_with` soft-deleted archived trades, unlinked journal entries and recorded a correction. It now checks the owner account before mutation.
- P1 confirmed and fixed: `store/journal.rs::delete` hard-deleted archived notes and tags. It now checks the owner account before deletion. Existing public signatures are preserved; no migration is needed.
- Regression evidence: all three new tests failed before the fixes; the entire lifecycle suite then passed **17/17** on Windows. Baseline lifecycle suite passed 14/14. Regression names are in `store/attempt_tests.rs`: `archived_account_edits_leave_identity_status_and_history_unchanged`, `archived_trade_deletion_preserves_the_trade_journal_link_and_correction_history`, `archived_journal_deletion_preserves_the_entry_and_tags_until_restore`.
- P3: `docs/data-model.md` and `docs/architecture/packages.md` retain schema-only/no-command catalogue statements despite production implementation.
- Requirements needing further evidence: complete source-card matrix; same-day/DST reset boundaries; read-only archived writes; supported populated upgrades and rollback; command/serde/Zod parity; packaged Windows smoke.

## Durable next steps

1. Install locked npm dependencies and establish baseline test/build results.
2. Reproduce and fix proven backend defects with focused tests.
3. Complete the acceptance matrix with exact test/function paths and separate manual gates.
4. Reconcile documentation, run full npm/Rust checks, package the Windows app if supported.
5. Push logical commits, preserve the draft PR, update Notion with verified evidence.

No real user journal has been opened or migrated. Real-journal-copy migration requires explicit authorization. Human review/sign-off remains required. Do not mark source cards Done from automated checks alone.

## Environment evidence

Windows Rust stable/MSVC is available. Local `npm ci` failed with OS `EPERM` creating workspace symlinks; bundled Node also reproduces this. An elevated retry was rejected because sandbox escalation is disabled. npm checks/package build are not yet locally executed. Git credential-helper startup is also blocked by the sandbox, so remote commits are preserved through the GitHub connector and may have different SHAs from equivalent local commits. Draft PR: https://github.com/KyleShabaga/FundedFlow/pull/50.

`cargo fmt --check` fails across existing baseline files (first difference `src/catalogue.rs`). Broad reformatting is outside this audit; compare changed lines and record the failure rather than claiming a pass.
