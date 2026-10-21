# Build 24 backend progress / session recovery

## New-merge integration in progress

Accepted main advanced to `e5e9f05`: Builds 16/19/20/21/22/29 are merged; journal schema is 18. The pre-integration Build 24 head `739678f` passed Windows CI run 39533908558. Merge reconciliation preserves both native command sets and domain exports; fixtures are being regenerated against accepted contracts. Build 20 screenshot storage follows the existing archive root convention. Required follow-up: owned/unlinked screenshot cleanup, shared rulebook-event retention blockers, trade-correction/review and all four daily-review tables in round-trip/deletion/integrity tests. Build 29 is an independent collector DB, outside journal backup/deletion. Full merged checks are pending; historical evidence below applies to schema 14 until updated. No UI changes are authored.


Spec: https://app.notion.com/p/3fe1bd4b6bde81aaa955ded001bcf18d
Draft PR: https://github.com/KyleShabaga/FundedFlow/pull/43
Branch: `feat/build-24-data-controls-backend`
Worktree: `/workspace/FundedFlow-build24`
Base: accepted main `9d49d71`, schema 14 (rechecked after implementation).
Last verified implementation: **`234d278`**, Blocks A–D plus managed staging cleanup and Windows-compatible file flushes. This document is a subsequent documentation checkpoint; inspect git log for the latest pushed head.

## Completed implementation

- A: plaintext, versioned Stored ZIP with manifest/checksums, consistent SQLite online-backup image, typed lossless table JSON/rowids, reconciled human trade CSV and actual attachment inventory/bytes. Unknown values/provenance/stable IDs survive. New-destination publication and explicit plaintext acknowledgement; no upload/encryption/cloud service.
- B: staged read-only inspection, known-schema/hash/count/ID/JSON/CSV/reference checks, safe paths/link rejection and resource/disk limits; replace-only preview binding to current data and source hash; safety copies, exclusive process ownership, immediate connection shutdown and restart/retry recovery before reopening SQLite. Durable phase markers roll back an interrupted install.
- C: authoritative cloned constrained-cascade previews, exact native phrases, normal transactional independent-account deletion, shared catalogue/tag/attachment preservation, separate whole-journal erasure and persistent post-commit cleanup with retry. Whole erasure includes managed recovery/inspection remnants; previously user-exported archives remain outside scope. FULL synchronous deletion commits precede file removal.
- D: native security/corruption/legacy/evidence/rollback/isolation tests, Rust-generated normalized wire fixtures parsed in TypeScript, repository adapter/error checks, typed backend/API and cross-PC developer handoff.

API, archive/protection/compatibility decisions, restore/recovery/deletion usage, ownership blockers and requirement-by-requirement acceptance matrix: [build-24-data-controls.md](build-24-data-controls.md).

## Changed files / ownership

Native `src/data_controls/*`, runtime connection/ownership/recovery boundary, thin commands/registration, Cargo dependency lock; portable domain DTOs and existing repository port; nonvisual Tauri data-control adapter; regression/wire fixtures; these new handoffs. Existing legacy deletion preview now points to the confirmed API, with its native fixture updated only for that wording.

No React component, screen, dialog, navigation, CSS, design file, feature hook or active-account state was changed. No applied migration, import normalization or stored financial calculation changed. Build 16 PR #42 remains an unmerged, independent change; its proposed migration 15 is not assumed.

## Actual verification

- `npm run typecheck`: pass.
- `npm test`: **379 domain + 381 desktop pass**.
- `npm run build`, `npm run check`, `git diff --check`: pass.
- Full native suite on final code: **210 passed, 4 pre-existing Linux failures, 2 ignored**. All **25** new data-control tests pass without fixture-update mode.
- `cargo clippy --all-targets -- -D warnings`: pass.
- Focused desktop adapter/native legacy fixture verification: 12 passed after the intentional legacy-preview wording update.
- Four legacy-rulebook SQLite IO 1802 failures: `assignment_intervals_follow_effective_from_and_contain_their_snapshots`, `legacy_parameters_use_only_the_keys_the_matrix_maps`, `rule_keys_are_unique_per_version`, `the_legacy_rules_fixture_covers_every_matrix_case`. Reproduced on unchanged dependency `e947dfb` (3 passed / same 4 failed); the relevant test source is unchanged between that dependency and accepted main. Existing issue: https://app.notion.com/p/3ff1bd4b6bde819499abc89a9f2f9795.
- Earlier Windows CI run 39533327713 failed archive tests at a common I/O boundary. The final hardening opens staged database handles writable for FlushFileBuffers; that code is locally verified but **latest Windows CI is pending**, not claimed green. Packaged Windows rename/power-loss/installer/cross-profile acceptance is unverified.

Native logs are `/tmp/build24-cargo-final.log` and `/tmp/build24-clippy-final.log`; npm logs `/tmp/build24-{typecheck,npm-tests,build,check}.log`. Managed Linux runtime uses `/workspace/.tools/fundedflow-env.sh` and `CARGO_TARGET_DIR=/workspace/FundedFlow-build16/apps/desktop/src-tauri/target` to reuse compiler artifacts without copying a multi-GB cache. Only compiler artifacts in that shared cache changed; no other worktree source was edited.

## Known limitations / review dependencies

1. Single-account deletion blocks reset/parent-linked attempts, immutable phase history, other immutable/shared restrictions, or unknown audit/sync ownership. No detach or live constraint bypass is invented. Review policy: https://app.notion.com/p/4001bd4b6bde81d09774d36d727b77be. No conflicting migration is allocated.
2. Build 20 must coordinate `<app-data>/attachments/<opaque-key>` and its new review/attachment ownership; missing, unsafe or unowned bytes fail clearly. No unmerged review API is claimed.
3. Claude owns Build 25 UI: show plaintext/scope/retention warnings, exact counts and blockers, collect real consent, handle restart_required/cleanup_pending, and invalidate the appropriate existing account/all-journal queries. No numeric progress percentages are invented.
4. Archives are unencrypted, hashes are not authentication, filesystem limits are explicit, and advisory process ownership does not govern third-party SQLite tools/older app versions. Close those tools before restore. This is application-data deletion, not forensic secure erase; external backups remain.
5. Real packaged Windows/another-profile, antivirus/rename/power-loss recovery and installer acceptance belong to Builds 26.75/27. Current Linux second-profile and interruption tests are evidence for the backend, not those release gates.

## Exact next steps for a new session

1. Read this file and the full Notion card; inspect PR #43, current accepted main, git log/status and latest CI. Continue this branch/PR; do not recreate completed blocks or force-push.
2. If Windows CI for the latest head fails, fetch job logs, reproduce/identify the platform-specific issue, fix only backend scope, run applicable checks, then commit/push and update this handoff/PR. Do not confuse the earlier pre-fix run with the latest head.
3. Obtain review of archive limits/plaintext choice, restart recovery and account phase/lineage policy. Keep blocked operations blocked pending a reviewed forward-only decision.
4. Coordinate Build 20/25 and packaged Windows acceptance separately. No merge or Notion Done until review and actual acceptance evidence. All completed implementation commits are pushed; preserve that incremental workflow.
