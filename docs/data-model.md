# FundedFlow local data model

Status: V1, schema version 4 (`src-tauri/migrations/0001_core_schema.sql`, `0002_seed_instruments.sql`, `0003_round_trip_imports.sql`, `0004_archive_accounts.sql`).
Code: `src-tauri/src/db` (migrations, opening), `src-tauri/src/store` (accounts, trades, journal),
`src-tauri/src/csv_import`, `src-tauri/src/domain.rs` (validation, trading day, P&L),
`src-tauri/src/commands.rs` (Tauri commands). Frontend types and Zod schemas: `src/lib/data/`.

Everything is local. There is no network access, account system, sync or secret in the data layer.

## Entities

```mermaid
erDiagram
    FIRMS ||--o{ ACCOUNTS : "prop firm (optional)"
    ACCOUNTS ||--o{ ACCOUNT_STATUS_EVENTS : "status history"
    ACCOUNTS ||--o{ TRADES : owns
    ACCOUNTS ||--o{ JOURNAL_ENTRIES : owns
    ACCOUNTS ||--o{ IMPORT_BATCHES : "import target"
    IMPORT_BATCHES ||--o{ IMPORT_ROWS : "every original row"
    IMPORT_BATCHES ||--o{ TRADES : produced
    IMPORT_ROWS |o--o| TRADES : "became"
    TRADES ||--o| TRADE_ROUND_TRIPS : "source fill pair"
    TRADES }o--o| INSTRUMENTS : "point value"
    TRADES |o--o{ JOURNAL_ENTRIES : "optional link"
    JOURNAL_ENTRIES ||--o{ JOURNAL_ENTRY_TAGS : ""
    TAGS ||--o{ JOURNAL_ENTRY_TAGS : ""
```

| Entity | Table | Key fields |
|---|---|---|
| Account | `accounts` | `id`, `name`, `broker`, prop firm (`firm_id` → `firms.name`), `external_ref`, `account_type` (`evaluation`, `sim_funded`, `live_funded`, `personal`, `demo`, `other`), `status` (`active`, `paused`, `passed`, `failed`, `closed`), `currency`, `starting_balance_micros`, `timezone`, `trading_day_reset_time`, `created_at`, `updated_at` |
| Trade | `trades` | `account_id`, `source` (`manual`/`csv_import`), `symbol`, `side` (`long`/`short`), `quantity`, `entry_at`, `entry_price`, `exit_at`, `exit_price`, `fees_micros`, `trading_day`, `reported_pnl_micros`, `gross_pnl_micros`, `net_pnl_micros`, `pnl_status`, `notes_md`, timestamps, `deleted_at` |
| Journal entry | `journal_entries` + `journal_entry_tags` → `tags` | `account_id`, optional `trade_id`, `entry_at`, `title`, `body_md`, tags, timestamps |
| CSV import | `import_batches` + `import_rows` | file name, SHA-256 and size, target `account_id`, `source_format` (`performance`/`generic`), mapping snapshot, `status` (`committed`/`failed`), `row_count`, `imported_count`, `skipped_count`, `duplicate_count`, `failed_count`, `warning_count`, `error_summary`, `created_at`, `completed_at`; per row: original cells, status, errors and warnings |
| Round-trip source | `trade_round_trips` | For trades from a performance export: buy/sell fill IDs, prices, parsed and original timestamps, duration, contract metadata and which fill opened the trade. Immutable. |

A trade is one **round trip** (entry and optional exit). An open trade has no exit time or price. Fill-level
(execution) import and trade grouping are out of scope for V1; they can be added later with a new migration
that feeds the same `trades` table.

The schema also contains tables for later features (rulebooks/rules, account ledger, trade reviews,
strategies, checklists, attachments, risk snapshots, audit events, an inert sync outbox). They are created
and constraint-tested but have no commands yet.

## Conventions

| Concern | Decision |
|---|---|
| IDs | App-generated UUIDv7 text. Built-in seed rows use `builtin:<kind>:<code>`. |
| Instants | UTC ISO 8601 text with milliseconds and `Z` (`2026-10-19T14:30:05.123Z`), enforced by CHECK. Commands accept any ISO 8601 instant with an offset. |
| Money | INTEGER micro-units of the account currency (`*_micros`; 1 USD = 1,000,000). Commands send and return decimal strings (`"212.5"`). |
| Prices, quantities | Canonical decimal text (`"5004.25"`), parsed with `rust_decimal`. Never floating point. |
| Tables | `STRICT`, with CHECK constraints for enums, formats and cross-field rules. |
| Connections | `foreign_keys = ON`, `busy_timeout = 5 s`, WAL journal, `synchronous = NORMAL`. |

## Relationships and delete behaviour

| Action | Effect |
|---|---|
| Archive account | Soft delete (`archived_at`, migration 0004). Hidden from lists and read-only: reading or writing its trades, journal entries and imports returns not-found. Nothing is removed, and an archived account's broker account number can be reused. The app never hard-deletes accounts; the schema's `ON DELETE CASCADE` remains for a future permanent-delete flow (Build 24). "Close" an account with `status = 'closed'` to keep it visible. |
| Delete trade | Soft delete (`deleted_at`). Hidden from lists; any journal entry linking to it has `trade_id` cleared in the same transaction. The row keeps its `dedup_key`, so re-importing the CSV does not bring it back. |
| Delete journal entry | Hard delete; tag links cascade. |
| Journal ↔ trade | A journal entry may link only to a non-deleted trade **of the same account** (validated in Rust, enforced by triggers). |
| Trade ↔ account | A trade never moves between accounts; account and import provenance are immutable (trigger). |
| Account settings change | Changing currency, timezone or reset time re-derives every trade's trading day and P&L in the same transaction. |

## Database location and migrations

- File: `<app data dir>/fundedflow.db`, from Tauri's `app_data_dir()`. On Windows this is
  `%APPDATA%\com.fundedflow.desktop\fundedflow.db`. Nothing is written to the install directory or the repository.
- Migrations are SQL files embedded in the binary (`include_str!`) and listed in `db::MIGRATIONS`. The current
  version is `PRAGMA user_version`. Each pending migration runs in its own transaction with its version bump, so
  a failure leaves the database at the last good version.
- Before upgrading an existing journal, `open_file` writes a consistent copy with `VACUUM INTO` to
  `fundedflow.db.before-v<N>.bak` next to the database.
- A database from a newer app version is refused (`NewerSchema`) rather than modified.
- Rule: never edit a migration that has shipped; add the next `000N_….sql` and a `Migration` entry. (0001 was revised
  before V1 shipped.)

## Realized P&L

Computed in Rust (`domain::realized_pnl`) when a trade is saved, and stored:

- **Closed trade with a known instrument in the account currency**: gross = (exit − entry) × quantity × point
  value, negated for shorts. `pnl_status = 'calculated'`.
- The symbol is matched to `instruments.symbol_root` by the longest root followed by nothing, a separator, or a
  futures month code and year (`ESZ6`, `MESH26`, `MNQZ2026`, `/ESZ6`). Built-in instruments are the common CME
  group futures (migration 0002), all quoted in USD.
- **Otherwise**, if the user or CSV supplied a reported P&L, that is used (`reported`). Reported P&L is
  assumed to be in the account currency and **before fees**.
- **Otherwise** no P&L: `missing_instrument`, or `currency_mismatch` when the instrument's currency differs from
  the account's. There is no FX conversion.
- Open trades: `open`, no P&L.
- Net = gross − fees. Fees are one positive total per trade. Values are rounded half away from zero to whole
  micro-units. The schema enforces `net = gross − fees`.
- The trade's **trading day** is the exit time (or entry, while open) in the account's timezone; times at or
  after the daily reset (default 17:00 America/New_York) count toward the next day. Reset `00:00` means calendar days.

## CSV import

Code: `src-tauri/src/csv_import/` — `parse` (CSV reading, limits), `detect` (format and header mapping),
`values` (strict value parsers), `normalize` (row → trade, errors and warnings), `dedup` (identity keys),
`mod.rs` (preview, atomic commit, history). UI: `src/components/CsvImportSection.tsx`.

Flow: the UI reads the chosen file as text on this computer and calls `preview_csv_import` (writes nothing).
The preview shows the detected format and mapping, every row's original line number, parsed values, warnings,
errors and duplicate status. Only after the user confirms does `commit_csv_import` save, re-running the same
analysis. Nothing is sent over the network: the file goes from the webview to the Rust process over Tauri IPC.

### Parsing

RFC 4180 CSV via the `csv` crate: quoted fields with embedded commas, newlines and doubled quotes; CRLF or LF;
a leading UTF-8 BOM is ignored. Line numbers are computed from byte offsets (header = line 1). Empty files,
a missing header row, header-only files, records with the wrong number of fields and unreadable records are
reported with clear messages. Limits: **10 MB and 50,000 data rows per file**; the preview lists every row up to
2,000 and, beyond that, every row with a finding.

### Formats and mapping

Headers are matched ignoring case, spaces and punctuation (`Buy Price` = `buy_price` = `buyPrice`; `P&L` = `pl`).

**Performance export (paired fills)** — detected when `symbol`, `qty`, `buyPrice`, `sellPrice`, `boughtTimestamp`
and `soldTimestamp` are present (e.g. Tradovate's Performance report). Each row is one completed round trip:

| Field | Column | Notes |
|---|---|---|
| Symbol | `symbol` | Required. |
| Quantity | `qty` | Required, > 0. |
| Buy / sell price | `buyPrice`, `sellPrice` | Required, plain decimals. |
| Buy / sell time | `boughtTimestamp`, `soldTimestamp` | Required; stored as parsed UTC **and** as the original text. |
| Fill IDs | `buyFillId`, `sellFillId` | Optional; the pair is the duplicate key. |
| Realized P&L | `pnl` | Optional; `$26.00`, `$0.00`, `$(36.00)`, `-$36.00`. |
| Duration | `duration` | Optional; `32sec`, `1min 17sec`, `1hr 2min`, `1:02:03`. |
| Contract metadata | `_priceFormat`, `_priceFormatType`, `_tickSize` | Optional; stored as supplied. |

*Entry side (assumption, shown in the preview):* the fill that happened first opened the trade. Buy first ⇒
**long** (entry = buy, exit = sell). Sell first ⇒ **short** (entry = sell, exit = buy) — this is the
"`soldTimestamp` earlier than `boughtTimestamp`" case. Such rows are imported but carry a warning, and both
source timestamps, prices and fill IDs are kept unchanged in `trade_round_trips` for review. Equal timestamps
are taken as long. The export has no fee column, so fees are 0.

**Generic trade CSV** — one trade per row. Required: symbol, side (`long`/`short`/`buy`/`sell`/`B`/`S`), quantity,
entry time, entry price. Optional: exit time + exit price (together), fees, P&L, broker trade ID, notes. Common
broker header names are matched automatically (e.g. `Ticker`, `Action`, `Open Time`, `Close Price`, `Commission`,
`P&L`, `Trade ID`); the user can map any field to any column. The source row is kept in `import_rows.raw_json`.

### Validation

Errors exclude the row; warnings do not.

- Symbol: letters, digits and ` ._/:-+=^#&`, up to 32 characters.
- Quantity > 0; prices are finite plain decimals (`29774.25`, `1,234.5`); no `NaN`, `inf` or exponents.
- Money (`pnl`, fees): optional `$`, sign or accounting parentheses, well-formed thousands separators.
  Negative fees are taken as a positive cost, with a warning.
- Durations: units in descending order (`d`, `hr`/`h`, `min`/`m`, `sec`/`s`), or `H:MM:SS` / `M:SS`.
- **Dates are parsed in exactly one format per file**: `YYYY-MM-DD HH:MM[:SS[.fff]]` (or RFC 3339 with offset),
  `M/D/YYYY HH:MM[:SS]` or `D/M/YYYY HH:MM[:SS]`, optional AM/PM, four-digit years only. "Auto" picks the format
  every timestamp fits; if both M/D and D/M fit (all days ≤ 12) the import stops until the user chooses.
  Performance exports default to M/D/YYYY in that case. Values without an offset are read in the chosen
  time zone; times that are ambiguous or skipped at a daylight-saving change are row errors.
- Warnings: sell fill before buy fill; `duration` differing from the time between fills by more than 1 s;
  exported P&L differing from the calculated P&L; only one fill ID present; non-numeric tick size.

### Results

| Row status | Meaning | Batch counter |
|---|---|---|
| `imported` (`new` in preview) | Saved as a trade | `imported_count` |
| `duplicate` | Same identity as an earlier line or a saved trade; reason shown, `duplicate_of_trade_id` linked | `duplicate_count` (also in `skipped_count`) |
| `skipped` (`blank` in preview) | Blank row | `skipped_count` |
| `invalid` | Errors listed per field with the CSV column name | `failed_count` |

`warning_count` counts rows with warnings, of any status. Every row is stored in `import_rows` with original
cells, errors and warnings; `list_csv_import_problem_rows` returns the rows not imported or with warnings.

**Atomicity.** The batch record, every row record, every trade and every round-trip source record are written
in one transaction. If anything fails, nothing from the file is kept and a separate `failed` batch records the
attempt. File-level problems (bad mapping, ambiguous dates, empty or oversized file) are also recorded as `failed`.

### Duplicate detection

Each valid row gets an identity key; `trades.dedup_key` is unique per account. A row is a duplicate if an
earlier line of the same file, or any trade of the account (including soft-deleted ones), has the same key. The
preview explains which line or saved trade it matches.

| Row | Key |
|---|---|
| Performance row with both fill IDs | `fills:<buyFillId>:<sellFillId>` — the **pair**. Rows sharing only a buy fill (one buy closed by several sells) or only a sell fill are distinct. |
| Generic row with a broker trade ID | `id:<trade id>` |
| Otherwise | `rt:` + SHA-256 of the normalized fields: format, symbol, quantity, both prices, both timestamps (UTC), reported P&L (and side for generic rows). |

Limitations:
- Without IDs, two genuinely identical round trips in one file are indistinguishable; the second is flagged as
  a duplicate (the preview says so) and not imported.
- Fees and notes are not part of the key, so a re-export that only corrects fees is a duplicate (edit the trade).
- The same trade exported in two different formats or with different timestamp precision produces different
  keys. Manual trades have no key. Duplicates are scoped per account.
- Deleted imported trades keep their key, so re-importing the file does not bring them back.

## Commands

| Area | Commands |
|---|---|
| Accounts | `list_accounts`, `create_account(input)`, `update_account(id, input)`, `archive_account(id)` |
| Trades | `list_trades(accountId)`, `create_trade(input)`, `update_trade(id, input)`, `delete_trade(id)` |
| Journal | `list_journal_entries(accountId)`, `create_journal_entry(input)`, `update_journal_entry(id, input)`, `delete_journal_entry(id)` |
| CSV | `preview_csv_import(request)`, `commit_csv_import(request)`, `list_csv_imports(accountId)`, `list_csv_import_problem_rows(batchId)` |

Updates replace all editable fields. Inputs are validated in TypeScript (Zod) and again in Rust before any write.
Errors are `{ kind: "validation" | "notFound" | "conflict" | "database", message, issues? }`, with `issues` naming
each invalid field.
