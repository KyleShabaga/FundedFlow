# Build 14 contracts: field reference

One table per frontend contract: what it is for, who owns it, its identity, the fields a screen relies on,
units, timestamp meaning, validation and the Tauri commands behind it. Code lives in
`apps/desktop/src/features/<feature>/`; hooks and signatures are in [build-14-handoff.md](build-14-handoff.md).

Shared rules for every contract:

- **Owner.** Rust/SQLite owns stored values and writes. The view models below validate and label them; they never
  compute money. Mappers live in `view-models/`, operations in `api/`, hooks in `hooks/`.
- **Money** is canonical decimal text exact in signed 64-bit micro-units (`moneyText`): `"50000"`, `"-1500.5"`,
  never `"1.00"`, `1e3`, a locale string or a number. Prices and quantities are canonical decimal text
  (`decimalText`) with no micro-unit limit. Currency is a separate ISO 4217 field; display maps it with the design
  system's `currencySymbol`.
- **Instants** are ISO 8601 with an offset (`…Z` from Rust). **Trading days** are `YYYY-MM-DD` calculated by Rust
  in the account's zone and reset time; the browser never recalculates them.
- **Null** means unknown or not applicable, per field below, and is never shown as zero.
- **Unknown enum values** from another app version fail the whole read as `invalid-response`; they are never
  mapped to a known status.
- **Read receipts.** Every read returns `{ value, receivedAt, source: "local-repository" }`. `receivedAt` is when
  this screen received the data (client clock), not a calculation or storage time.
- **Wire check.** `apps/desktop/src/test/fixtures/command-wire.json` holds real Rust payloads (fresh journal and
  upgraded v3/v4 journals). `features/shared/wire-contract.test.ts` runs them through every read below.

## Account (`AccountViewModel`)

| | |
|---|---|
| Purpose | Account lists, selection and detail headers |
| Identity | `id` (opaque string). Selection is always by `id`, never by name |
| Fields | `name`, `broker`/`propFirm`/`externalRef`/`notes` (nullable text), `accountType`, `status` (`active`, `paused`, `passed`, `failed`, `closed`), `currency` (ISO), `startingBalance` (money), `timezone` (IANA), `tradingDayResetTime` (`HH:MM`), `predecessorAccountId`/`successorAccountId` (nullable ids: reset attempts), `riskEligible` (derived by the domain's `isRiskEligible`), `provenance: "stored-account"` |
| Units | `startingBalance` in `currency` |
| Timestamps | `createdAt`, `updatedAt`: storage times. `archivedAt`: when archived, null when live |
| Validation | Input: domain `accountInputSchema` (`name` required ≤100, 3-letter currency, non-negative balance, reset 00:00 or 12:00–23:59) |
| Commands | `list_accounts { includeArchived: true }` then filtered by the domain's `filterAccounts`; `get_account`; writes `create_account`, `update_account`, `archive_account`, `restore_account`, `change_account_status`, `reset_account_attempt` |

Related account reads: **history** (`get_account_history`: status events with `effectiveAt` and `recordedAt`,
archive events with `occurredAt`; events have no ids, marked `eventIdentity: "not-exposed-by-backend"`),
**lineage** (`get_account_lineage`: attempt summaries with `netPnl` money or null when any trade's P&L is unknown,
first/last trading day nullable) and **deletion preview** (`preview_account_deletion`: counts of what a delete
removes).

## Trade (`TradeViewModel`)

| | |
|---|---|
| Purpose | Trade lists, filters and trade detail |
| Identity | `id`; `accountId` must equal the requested account (checked) |
| Fields | `symbol`, `side` (`long`/`short`), `quantity` (positive decimal), `entryPrice`, `exitPrice` (null while open), `fees` (money ≥ 0), `grossPnl`, `realizedPnl` (net, after fees), `reportedPnl` (broker's figure), each money or null, `pnlStatus` (`calculated`, `reported`, `open`, `missing_instrument`, `currency_mismatch`), `source` (`manual`/`csv_import`), `importBatchId`, `brokerTradeId`, `notes`, `roundTrip` (paired fills, nullable) |
| Units | Money in `currency`, joined from the account at read time (`timeZone` likewise) |
| Calculation basis | `calculationBasis: { authority: "rust-stored", version: null, net: "after-fees", gross: "before-fees" }`. Rust stores P&L; the version is unknown, so null |
| Null rules | `realizedPnl` null = unknown (open trade, missing instrument or currency mismatch), never zero |
| Timestamps | `entryAt`, `exitAt`: event times. `tradingDay`: Rust-derived. `createdAt`, `updatedAt`: storage |
| Validation | Input: domain `tradeInputSchema`; `accountId` must match the hook's account. Rust re-validates (symbol 1–32 chars, quantity > 0, exit not before entry…) |
| Commands | `list_trades { accountId }` (filters and detail are applied to this list; there is no detail command); writes `create_trade`, `update_trade`, `delete_trade` after an ownership check |
| Filters | `from`/`to` inclusive trading days, exact `symbol`, `side` |

## Journal entry (`JournalViewModel`)

| | |
|---|---|
| Purpose | Notes and reviews attached to an account, optionally to one trade |
| Identity | `id`; `accountId` checked; `tradeId` nullable link |
| Fields | `title` (required ≤200), `body` (≤100,000), `tags` (≤20, each ≤40), `timeZone` (account's), `provenance: "stored-journal-entry"` |
| Timestamps | `entryAt`: the moment the note is about (user-chosen). `createdAt`, `updatedAt`: storage |
| Validation | Input: domain `journalEntryInputSchema`. Form drafts use that input type; persisted entries use this model |
| Commands | `list_journal_entries { accountId }`; writes `create_journal_entry`, `update_journal_entry`, `delete_journal_entry` |
| Not modelled | Structured daily reviews and scoring: no backend contract (capability `structured-reviews`) |

## CSV import

| | Preview (`previewViewModelSchema`) | Batch (`ImportViewModel`) | Problem row |
|---|---|---|---|
| Purpose | What a file would import, before anything is saved | A committed or failed import in history | Why a row was skipped or failed |
| Identity | None persisted: `phase: "preview"`, `accountId`, `fileName` | `id`; `accountId` checked | `rowKey` = `batchId:rowNumber` |
| Fields | Detected `format` and `dateFormat` with reasons, column `mapping`, `fileIssues` (non-empty: nothing can import), `fileWarnings`, `filePreviouslyImported`, counts; per row `status` (`new`, `duplicate`, `blank`, `invalid`), issues and the parsed `trade` (money/decimal/instant validated as for trades) or null | `status` (`committed`/`failed`), `sourceFormat`, row/imported/skipped/duplicate/failed/warning counts, `fileSha256` (lowercase hex), `fileSize` (bytes), `failureMessage` (safe text; raw `errorSummary` removed) | `rowNumber`, `lineNumber`, `status` (`imported`, `duplicate`, `skipped`, `invalid`), `errors`, `warnings`, `raw` cells, `duplicateOfTradeId` |
| Units | `currency` of the account | Counts are integers | — |
| Timestamps | — | `createdAt` (started), `completedAt` (finished) | — |
| Commands | `preview_csv_import` (no write; 60 s deadline) | `commit_csv_import`, `list_csv_imports` | `list_csv_import_problem_rows { batchId }` after the batch's account is checked |

## Ledger entry

| | |
|---|---|
| Purpose | Payouts, fees and balance corrections outside trades |
| Identity | `id`; `accountId` checked |
| Fields | `kind`, `amount` (money; payouts and fees negative), `affectsBalance`, `note` |
| Timestamps | `effectiveAt`: event time; `tradingDay`: Rust-derived; `createdAt`, `updatedAt`: storage |
| Commands | `list_ledger_entries`, `get_ledger_balance_adjustment` (money: the sum of balance-affecting entries); writes `create_ledger_entry`, `update_ledger_entry`, `delete_ledger_entry` |

## Snapshot (`SnapshotViewModel`): Insights and Today inputs

| | |
|---|---|
| Purpose | Stored risk/rule snapshots written by the rules engine. Not live data |
| Identity | `id`; `accountId` checked; `rulebookVersionId` nullable |
| Fields | `status` (`safe`, `caution`, `stop`, `unknown`, `needs_setup`; unknown is never safe), `statusReasons`, `balance`, `realizedDayPnl` (money), nullable money `unrealizedPnl`, `dailyLossLimit`, `dailyLossRemaining`, `highWaterMark`, `drawdownFloor`, `drawdownHeadroom`, `profitTarget`; `feesIncluded`, `unrealizedIncluded`, `drawdownMode`, `drawdownLocked`, trading-day counts, `explanation` (inputs and contributing trade ids) |
| Units | `currency: null` and `currencyBasis: "not-stored-in-snapshot"`: snapshots do not freeze currency. `accountCurrency` is the account's current currency only |
| Calculation basis | `engineVersion`, `inputsHash`, `dataSource`, `provenance: "persisted-snapshot-not-live"` |
| Timestamps | `calculatedAt`: when the engine computed it. `dataAsOf`: the newest input data, null when unknown. `tradingDay`: the day it describes |
| Commands | `list_account_snapshots { accountId, from?, to?, endOfDayOnly? }`, `get_latest_account_snapshot` (null = none saved) |
| Not modelled | Live Today summary (`today-summary`, Builds 16/21) and Insights aggregates (`insights-aggregates`, Build 23) |

## Settings and reference data

- **Setting** (`settingViewModelSchema`): `key` (domain `settingKey`), `value` (JSON ≤64 KiB), `updatedAt`
  (storage). Commands `list_settings`, `get_setting` (null = unset), `set_setting`, `remove_setting`.
- **Catalogue, rulebooks, assignments, offers, phase events**: read-only here, validated with the domain schemas
  and checked for account ownership. Editing stays with the catalogue/rulebook cards.

## Errors

Every failure is a `FeatureDataError` with a `category` (`validation`, `not-found`, `conflict`, `unavailable`,
`unsupported-schema`, `unsupported`, `invalid-response`, `unexpected`, `cancelled`, `timeout`,
`duplicate-submission`, `uncertain-outcome`), a fixed safe `message`, the backend's `backendKind` when known, and
`issues: { field, message }[]` for validation. Issue messages are our schemas' or Rust's own text when short and
free of paths, SQL or stack text ("Required", "must be greater than zero"), otherwise "Check this value.". Rust
messages can be relative to the field; `issueSentence` and `fieldErrors` in `shared/presentation.ts` complete them.
`diagnosticReference` is null: the native contract has no correlation id.
