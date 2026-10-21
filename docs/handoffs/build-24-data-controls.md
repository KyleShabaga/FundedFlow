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
