# Build 24 native data controls

Spec: https://app.notion.com/p/3fe1bd4b6bde81aaa955ded001bcf18d
Progress: [build-24-progress.md](build-24-progress.md). Backend only; Claude owns Build 25 UI.

## Archive v1

A user-selected `.ffj.zip` is a **plaintext, unencrypted** ZIP. Require acknowledgement before export. It contains personal financial data, notes and images. Store it on a trusted user-controlled filesystem; inherited Windows ACLs apply (temporary files use restricted owner permissions where supported). There are no automatic/scheduled backups, uploads or authentication. SHA-256 detects accidental corruption, not authenticity; someone able to replace an entire archive can recompute its hashes.

ZIP uses only Stored regular entries: `manifest.json`, `journal.sqlite`, `data.json`, and `attachments/<opaque-storage-key>`. Compressed/encrypted entries, links, aliases, duplicate names, Windows-reserved/absolute/traversal paths and unsupported extra payloads are rejected. Limits are 64 MiB per payload, 256 MiB aggregate, 4096 entries, 1 MiB manifest and 500,000 total table rows; exceeding a limit fails explicitly. Larger journals require a separately reviewed format extension.

The manifest records format/schema/producer version, UTC creation time, export ID, all table counts, account IDs, exact financial/time encoding, attachment inventory and per-payload SHA-256/length. It never contains an absolute export/source path. Actual user-authored data may itself contain paths or other sensitive text; export is not a redaction service. Original imported cells and round-trip provenance remain intact.

`journal.sqlite` is created with SQLite's online backup API while the runtime connection is exclusively held. This includes WAL and preserves rowids; an open database file is never blindly copied. `data.json` mirrors every user table and column, including unknown JSON fields/text, nulls, blobs and integer micro-units as decimal strings. Rows preserve SQLite rowid order with explicit rowid strings; WITHOUT ROWID tables use primary-key order and null rowid markers. Exact decimal text is not re-derived or normalized again. Stable IDs and original source records survive. Account timezone/reset and stored trading days remain authoritative.

The SQLite image is the V1 restore representation; lossless table JSON is the migration representation for future Stage 2. Inspection requires both representations to agree exactly. A Stage 2 importer must interpret the declared schema version and preserve IDs/provenance/unknowns, not treat JSON as execution-level trading data. This format adds no execution ledger.

The reader accepts format 1 and known journal schemas from v3 through the current build. It rejects unknown manifest fields/newer schemas rather than guessing their meaning. Existing unknown payload keys inside stored JSON/text are preserved losslessly. Exact SQLite schema definitions must match the shipped migrations, preventing archive-supplied triggers/views from becoming executable application schema. Older images are upgraded only in staging with the normal migrations; existing applied migration files are unchanged.

All attachment rows, including soft-deleted inventory, must have matching actual bytes under `<app-data>/attachments/<storage_key>` or export fails. No existing API established a different attachment root; Build 20 must coordinate this ownership convention and rerun integration tests before release. Paths alone never count as backed-up bytes.

## CSV export

`repository.dataControls.exportCsv` produces a human-readable trade file, separate from a complete archive. Scope is one explicit account UUID or all accounts. Includes archived/failed accounts and soft-deleted trades (with deletion timestamp), source and import IDs, exact known net P&L/fees, UTC times, stored trading day, notes and blank unknowns. Currency/account context is available in the complete archive; CSV is not an archive or an import/rebuild guarantee. Spreadsheet formula prefixes are escaped in textual cells; the archive retains original text. An existing destination is never silently overwritten.

## Block A API

The existing `JournalRepository.dataControls` is bound by the Tauri repository adapter. No React or independent gateway owns these operations.

- `exportArchive({ destination, acknowledgePlaintext: true })` → `export_journal_archive(request)`.
- `exportCsv({ destination, accountId: string | null, acknowledgePlaintext: true })` → `export_trade_csv(request)`.
- Success: `{ operationId, state: "completed", bytes, sha256, plaintext: true }`.
- Native failures are `{ code, message }`, with stable exported `dataControlCodeSchema` values and no row contents or absolute paths. The adapter throws `DataControlFailure` with this typed error, separate from legacy journal-command errors. Input/response schema mismatches remain validation errors.

Operations execute off the UI thread behind the existing runtime connection lock. Results report terminal completion/failure; no fake incremental progress percentages are emitted. Build 25 may show an indeterminate busy state while awaiting the command. Restore/deletion preview and confirmation contracts are added in subsequent checkpoints.

## Restore API and recovery

- `inspectArchive({ source })` → `inspect_journal_archive`: validated manifest, replaced entity counts, exact archive hash, preview token, required phrase, disk requirement and warnings. Active SQLite is read only. Temporary extraction/upgrades are discarded.
- `restoreArchive({ source, previewToken, confirmation: "REPLACE ENTIRE JOURNAL" })` → `restore_journal_archive`: validates again and compares both archive and current full-journal identity. Changed source/current data requires a new preview. Returns `{ operationId, state: "restart_required", safetyBackupId }` only after all staging and the pre-restore safety copy succeed.
- Close/restart FundedFlow, or use the existing runtime retry command. The runtime closes its connection immediately after staging and refuses subsequent data commands. Exclusive process ownership of `fundedflow.lock` remains held. Another current-build process cannot open the journal during recovery. Third-party SQLite tools or older app versions do not honor this advisory lock; close them before restoring.
- Startup/retry processes a durable `data-controls-pending.json` before opening SQLite. Prepared installs replace the DB and managed attachments with no open app connection. An interrupted installing phase rolls back from the consistent safety DB plus copied attachment inventory. A committed phase completes marker cleanup. Failed recovery blocks database access; it never silently opens a partial journal. Retry after correcting a filesystem/disk problem.
- SQLite and attachments are **not** one filesystem-atomic swap. Durably written phase intent, full safety copies, idempotent rollback and closed-connection recovery provide the boundary. The original is recoverable during partial installation. Directory fsync is used on Unix; Windows power-loss durability and antivirus/rename interactions require packaged acceptance.
- Safety copies stay under `<app-data>/data-controls/<safetyBackupId>/safety.db` and `safety-attachments/`. They are plaintext and are not independently portable archives. On a controlled manual recovery, close all app instances, preserve the entire operation directory, restore this DB and attachment directory together, then launch. Prefer the automatic retry recovery while a pending marker exists; do not delete a pending marker to bypass recovery. Retention/rotation UI is deferred.
- If any existing attachment byte has no matching inventory owner, restore is blocked before replacing anything. Build 20 must maintain inventory and use the declared attachment root. No unmerged screenshot/review API is assumed.

## Permanent deletion API

- `previewDeletion({ scope: { kind: "account", accountId } })` or `{ scope: { kind: "journal" } }` → `preview_permanent_deletion`. Returns target name/UUID, affected counts, deletable attachment inventory, linked account IDs, blockers, full-data-bound previewToken, requiredConfirmation, managed recovery-copy count and warnings.
- Account previews clone SQLite into an isolated in-memory database and run the actual constrained cascade there. This supplies counts for imports/source rows, trades/round trips, notes/reviews, ledger/revisions, evidence/reconciliations, snapshots, lifecycle/assignment/private rulebooks and junction rows actually removed. Shared attachment rows/bytes, tags, strategies and provider/catalogue data remain. A blocked preview provides direct-owner counts, not a promise of deletability.
- `deletePermanently({ scope, previewToken, confirmation })` → `permanently_delete_data`. Required phrases are `DELETE ACCOUNT <exact UUID>` and, separately, `ERASE ENTIRE JOURNAL`. The native service recomputes the preview, rejects stale data/wrong phrases, and independently enforces blockers. Failed/archived status never implies consent.
- An account linked through reset attempts or parent/successor references is blocked. Schema 14's unconditional phase-history restriction is preserved: accounts with phase history are blocked until an explicit reviewed deletion policy/migration exists. Unknown audit/sync ownership and other immutable/shared restrictions are also blocked. No trigger/FK is dropped or disabled on live data; there is no automatic detach/cascade into another attempt.
- Account database removal and unshared attachment-row removal use one normal transaction. Actual file cleanup occurs after commit from a durably saved queue, checking that no current DB row still owns each attachment ID or storage key. A failed transaction never removes its bytes. Cleanup retries at startup and through `retryCleanup()` / `retry_data_cleanup`. `cleanup_pending` means logical deletion committed but physical file cleanup is incomplete; display this explicitly and retry, rather than claiming complete permanent erasure.
- Whole-journal erasure replaces the SQLite contents in one SQLite backup transaction with a newly migrated empty journal (factory instrument seeds remain). It removes all accounts, personal/shared catalogue, settings and user data in that journal; this is deliberately broader than account deletion. It does not make an undisclosed just-before-delete backup. App-managed restore recovery directories and pre-upgrade backups are included in the preview/cleanup. User-exported archives and files elsewhere remain untouched, even if a user chose to save an export beside the DB. An optional user-chosen portable export is a separate action before confirmation.
- Success is `{ operationId, state: "completed" | "cleanup_pending", affectedEntities }`. The operation ID is diagnostic, not a repeat-delete authorization. Repeating an old preview after changes fails; repeating cleanup is safe. Ordinary account deletion leaves historical copies in existing managed backups; whole-journal erasure also queues those managed copies for removal. Neither operation guarantees forensic erasure from WAL/free pages, OS history, SSDs, synced folders or previously exported copies.

## Shared policy dependency

Removing a nonlinked account's immutable phase history needs an explicitly approved forward-only schema policy. Build 16 PR #42 already proposes migration 15 but is unmerged; this branch neither assumes it nor allocates a conflicting migration. Build 24's independent deletion supports schema-permitted accounts and clearly blocks restricted ones. Claude should offer reversible archive or a deliberate whole-journal action while this decision is pending. Build 20 review/attachment APIs must extend ownership tests before release.
