# Build 24 backend progress

Spec: https://app.notion.com/p/3fe1bd4b6bde81aaa955ded001bcf18d
Branch: `feat/build-24-data-controls-backend`
PR: https://github.com/KyleShabaga/FundedFlow/pull/43
Base: accepted main `9d49d71`; schema 14. Build 16 PR #42 is unmerged and is not a dependency.

## Audit and dependencies

- Existing SQLite `VACUUM INTO` pre-migration backups include WAL; reuse SQLite-supported snapshotting rather than copying an open database.
- Runtime owns one mutex-protected connection; normal commands use Runtime.with. Restore needs an exclusive runtime boundary plus crash recovery before opening the database. Cross-process ownership must be enforced.
- Existing account lifecycle preserves failed/archived/reset attempts. Preview exists but permanent deletion does not. Append-only phase/attempt/evidence constraints must remain intact. Linked attempts will be blocked by default; no detach policy is invented.
- Schema includes attachments with opaque storage_key, size/hash and relationship tables; no accepted attachment write service or Build 20 review API exists. Export must include actual referenced bytes or fail clearly. Build 20 future formats are an integration gate.
- All populated tables, including rulebooks/catalogue, raw imports, paired-fill metadata, financial evidence and lifecycle history, must survive portable round-trip. SQLite image plus lossless typed table JSON will be reconciled during validation. Unknown columns are preserved, newer unsupported schemas rejected.
- Builds 10, 15, 15.5 and 18 are accepted; future Build 20 and Claude's Build 25 UI remain separate. No UI, hooks, navigation or design work is included.
- Privacy choice: plaintext user-selected ZIP with explicit acknowledgement; no encryption or upload. Saved external backups are outside deletion scope.

## Planned independently verified blocks

1. A: bounded versioned ZIP manifest, exact table JSON, consistent SQLite image, attachment inventory/checksums, CSV export and safe destination publication.
2. B: read-only archive inspection, strict paths/entry/resource/version/hash/reference checks, disk-space checks, preview binding, staged replace-only restore, safety backup, exclusive connection/process ownership and interrupted-operation recovery.
3. C: authoritative scoped deletion preview/confirmation, default lineage blocking, shared catalogue preservation, transactional account deletion and separate entire-journal erasure, attachment ownership/cleanup recovery.
4. D: portable domain DTOs, existing repository/Tauri adapter commands, structured codes and completion states, native wire/rollback/malicious/legacy regression tests and final acceptance matrix.

## Verification status

Audit only. No Build 24 implementation or test success claimed. Existing Build 15.5 Linux legacy SQLite fixture failures are documented upstream and must be distinguished from regressions. Packaged Windows/cross-profile restore remains unverified.

## Decisions and remaining gates

Use replace-only restoration. No cloud/merge/encryption/automatic backups. Never disable integrity constraints on live data to force a deletion. Preserve shared catalogue/strategy/tag data on account delete. Block ambiguous external attachment paths, ownership and linked attempts. Any required schema change is forward-only, with migration number rechecked before landing.

## Recovery / exact next steps

Last completed block: repository/spec/dependency audit; this document is the initial checkpoint (its own SHA is available in git log).
1. Create/persist the draft PR before major code, then record its URL here.
2. Implement and test Block A. Continue B–D with independent test/commit/push checkpoints; update this file and PR each time.
3. Run full npm checks, native tests/Clippy and migration regressions. Audit changed paths for backend-only scope.
4. Publish final evidence and explicit outstanding Build 20/25/Windows acceptance; do not merge or mark Notion Done.

## Block A checkpoint

Implemented native archive/CSV commands, portable DTOs and existing repository adapter methods. ZIP uses Stored entries only (no compression/encryption). SQLite online backup API preserves implicit rowids and WAL content; every table is also represented as typed lossless JSON, including rowids for ordered history. Table schemas, values/counts/IDs and attachment bytes are reconciled on validation. Destinations publish without overwriting an existing file; plaintext acknowledgement is mandatory. CSV includes all selected-account trades including deleted_at, known decimal values and blank unknowns; spreadsheet formulas are escaped only in the human export.

Tests before this checkpoint: native WAL/table round-trip, attachment missing/corruption, Windows-safe paths/acknowledgement and CSV exact/account isolation. Remaining: restore/recovery, authoritative deletion, adversarial/legacy/wire tests and final full checks. Compile warnings for future block codes are temporary; final Clippy still pending.
