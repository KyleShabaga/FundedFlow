# FundedFlow local data model

Status: V1, schema version 7 (`apps/desktop/src-tauri/migrations/0001_core_schema.sql`, `0002_seed_instruments.sql`, `0003_round_trip_imports.sql`, `0004_archive_accounts.sql`, the Rust data step 5 `rederive_trading_days`, `0006_provider_catalogue.sql` and the Rust data step 7 `map_legacy_catalogue`; see [Migrations](#database-location-and-migrations)).
Code: `apps/desktop/src-tauri/src/db` (migrations, opening), `apps/desktop/src-tauri/src/store` (accounts, trades, journal),
`apps/desktop/src-tauri/src/csv_import`, `apps/desktop/src-tauri/src/domain.rs` (validation, trading day, P&L),
`apps/desktop/src-tauri/src/commands.rs` (Tauri commands). Frontend types and Zod schemas: `apps/desktop/src/lib/data/`.

Everything is local. There is no network access, account system, sync or secret in the data layer.

## V1 source-of-truth policy

- **Round-trip first.** The unit of record is a canonical `trades` row (one round trip: entry and optional exit).
  Imported trades keep their immutable original CSV row (`import_rows`) and, for paired-fill exports, the
  immutable source fill pair (`trade_round_trips`). There is no executions ledger; trades cannot be recomputed
  from raw executions.
- **Rust is authoritative for calculations.** Validation, trading day, instrument lookup and realized P&L are
  computed in `src-tauri/src/domain.rs` and stored. The Zod schemas in `packages/domain/src/contracts` mirror the
  input rules for early feedback but never compute stored values. A calculation moves to TypeScript (e.g. a
  shared `packages/domain`) only together with parity tests that run the same cases against both
  implementations and prove identical results; see [`architecture/packages.md`](architecture/packages.md).
- **SQLite is authoritative for persistence.** Every write goes through the [repository port](#repository-port),
  a Tauri command and one SQLite transaction.

Not supported by the round-trip pipeline (V1 limitations): partial fills and partial exits, scale-in/scale-out
as one position, regrouping fills into trades, execution-based risk analysis (MAE/MFE, intraday drawdown from
fills), and FX conversion.

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

`accounts` also has schema-only columns that no command reads or writes yet: `programme_id`,
`parent_account_id` (evaluation → funded successor link), `account_size_micros` and `opened_on`.

### Implementation status

| Status | Tables |
|---|---|
| **Implemented** (commands, store code and tests) | `accounts`, `firms` (find-or-create by name), `account_status_events` (written on create and status change), `instruments` (seeded by 0002, read-only), `trades`, `trade_round_trips`, `import_batches`, `import_rows`, `journal_entries`, `tags`, `journal_entry_tags` |
| **Reserved** (created and constraint-tested in 0001, no commands) | `app_meta` (journal_id etc. not yet written), `settings`, `programmes`, `account_ledger_entries`, `rulebook_versions`, `rules`, `csv_mapping_profiles`, `strategies`, `checklists`, `checklist_items`, `checklist_results`, `trade_reviews`, `trade_review_tags`, `attachments`, `attachment_links`, `account_snapshots`, `audit_events`, `sync_outbox` (inert) |
| **Schema only** (Zod DTOs in `packages/domain/src/catalogue`, tables in migration 6, Rust DTOs in `src/catalogue.rs`; no commands yet) | provider catalogue: `providers`, `programme_families`, `programme_variants`, `catalogue_versions`, `catalogue_version_sources`, `catalogue_field_claims`, `catalogue_sources`, `programme_phases`, `phase_paths`, `commercial_offers`, `commercial_offer_sources`, `promotions`, `promotion_sources`, `promotion_offers`, `account_phase_events`, and the `accounts` link columns; see [Provider catalogue](#provider-catalogue). The account store keeps `providers` in step with `firms` (`provider_for_firm`). |
| **Not in the schema** (future extensions) | `executions`, `execution_fees`, `trade_executions` (execution-first), reusable rulebooks and `account_rulebook_assignments` (Build 9.5) |

Reserved tables are a starting point, not a finished design. In particular `rulebook_versions` is
account-owned (`account_id NOT NULL`, cascades on account delete), whereas Build 9.5 plans reusable, versioned
rulebooks assigned to accounts. `firms`/`programmes` predate the Build 9 provider catalogue; migration 7 maps
them into `providers`/`programme_families` and keeps them. Shipped migrations are never edited.

## Provider catalogue

Status: **schema only**. The Zod DTOs, integrity checks and phase-history derivation are in
`packages/domain/src/catalogue` (Build 9), and the synthetic fixture is `packages/domain/test/fixtures/catalogue.json`.
The tables are migration 6 and the legacy mapping is migration 7 (Build 10; see [Storage](#catalogue-storage)).
No command reads or writes the catalogue yet.

The model keeps six layers apart:

1. **Provider**: identity only.
2. **Programme catalogue**: families, variants and dated versions.
3. **Phases and paths**: what each version offers.
4. **Commercial offers and promotions**: prices.
5. **The user's account**: its catalogue links.
6. **The account's phase history**.

Rule values and formulas belong to the rulebook (Build 9.5). A phase or path holds only a rulebook-version ID.

```mermaid
erDiagram
    PROVIDERS ||--o{ PROGRAMME_FAMILIES : publishes
    PROGRAMME_FAMILIES ||--o{ PROGRAMME_VARIANTS : "sizes / account types"
    PROGRAMME_VARIANTS ||--o{ CATALOGUE_VERSIONS : "dated revisions"
    CATALOGUE_VERSIONS ||--o{ PROGRAMME_PHASES : "Evaluation, Funded"
    PROGRAMME_PHASES ||--o{ PHASE_PATHS : "Daily, Flex"
    PROGRAMME_PHASES }o--o| RULEBOOK_VERSIONS : "default rules (9.5)"
    PHASE_PATHS }o--o| RULEBOOK_VERSIONS : "override (9.5)"
    CATALOGUE_VERSIONS ||--o{ COMMERCIAL_OFFERS : prices
    COMMERCIAL_OFFERS }o--o| PROGRAMME_PHASES : "phase offer"
    COMMERCIAL_OFFERS }o--o| PHASE_PATHS : "path offer"
    PROVIDERS ||--o{ PROMOTIONS : owns
    PROMOTIONS ||--o{ PROMOTION_OFFERS : ""
    COMMERCIAL_OFFERS ||--o{ PROMOTION_OFFERS : ""
    CATALOGUE_SOURCES }o--o{ CATALOGUE_VERSIONS : provenance
    ACCOUNTS }o--o| CATALOGUE_VERSIONS : "selected version"
    ACCOUNTS }o--o| PHASE_PATHS : "selected path"
    ACCOUNTS ||--o{ ACCOUNT_PHASE_EVENTS : "phase history"
```

| Entity (DTO) | Owns | Does not own |
|---|---|---|
| `Provider` | slug, display name, aliases, website, record status (`active`/`inactive`/`archived`/`unknown`) | legitimacy judgements, credentials, payment data |
| `ProgrammeFamily` | provider wording plus normalized `category` (`evaluation_to_funded`, `instant_funding`, `other`, `unknown`) | anything purchasable |
| `ProgrammeVariant` | the stable "50K" identity: `sizeLabel` (verbatim), `sizeAmount`+`sizeCurrency` only when a source states them, descriptive platforms, namespaced metadata | rule terms, prices, inherited parent fields |
| `CatalogueVersion` | `versionNumber`, `capturedAt` (retrieval) vs `effectiveFrom`/`effectiveTo` (half-open, null = unknown), verification state, reviewer, `supersedesVersionId` + `correctionReason`, `sourceIds`, per-field `claims` | the rulebook's completeness |
| `ProgrammePhase` | `phaseKey` (`evaluation`, `simulated_funded`, `live_funded`, `other`, `unknown`), exact `providerLabel`, order, `defaultRulebookVersionId` | account record status |
| `PhasePath` | provider-defined `pathKey` slug (data, never an app enum), label, `isDefault`, `rulebookVersionId` override | |
| `CommercialOffer` | `billingModel` (`one_time`/`recurring`/`unknown`), `listPrice`, `salePrice`, `resetFee`, `activationFee`, currency, effective window | drawdown, loss limits, consistency, payouts (the strict schema rejects them) |
| `Promotion` + `PromotionOffer` | provider-scoped reusable code/label, discount (`amount`, `percent` or `unknown`), validity; many-to-many link to offers with its own window | a discount inferred from a strike-through price |
| `SourceReference` / `FieldClaim` | URL or manual descriptor, source type (`official`/`secondary`/`user_manual`/`unknown`), captured vs published vs effective dates, content hash (change detection only), importer version, reviewer; claim origin (`observed`, `provider_stated`, `user_entered`, `extracted_candidate`, `verified_catalogue`, `unknown`) | |
| `AccountCatalogueLink` | `providerId`, `programmeVariantId`, exact `catalogueVersionId`, `selectedPhasePathId`, `parentAccountId`, `sizeSource`, all nullable | |
| `AccountPhaseEvent` | `fromPhase` (nullable), `toPhase`, provider label, `occurredAt` (nullable) vs `recordedAt`, source, actor, note, `correctionOfEventId`, catalogue/phase/path snapshot | |

### Catalogue rules

- **Money.** Prices, fees, size and amount discounts are canonical decimal text, for example `"105.2"`. They
  are stored as `*_micros` like all other money, never as floats or minor units. `null` means unknown. `"0"`
  means an explicit known zero, so a "FREE" activation fee is `"0"`. It is still only a candidate until its
  catalogue version is verified. Build 9.5 represents OFF, NONE, not-applicable and an ambiguous dash on rule
  claims.
- **Verification.**
  - Records start as `draft` or `needs_review`. Only `needs_review` (or `stale`) becomes `verified`, and only
    with a reviewer and a timestamp.
  - `superseded` and `rejected` are final.
  - A reviewed version (`verified`, `stale`, `superseded`, `rejected`) is immutable apart from its status.
  - A correction is a new version with `supersedesVersionId` and a reason
    (`checkCatalogueVersionUpdate`, `canTransitionVerification`).
- **Phase vs status.** Phase (`unknown`/`evaluation`/`simulated_funded`/`live_funded`/`other`) and account
  record status (`active`, `paused`, `passed`, `failed`, `closed`, plus the archive soft delete) are independent.
  `paused`, `failed` and `closed` are never phases. The legacy `accounts.account_type` stays as compatibility
  metadata, and no catalogue version or phase history is inferred from it.
- **Phase history.**
  - Events are append-only and apply in `recordedAt` order, with ties broken by ID.
  - A correction names the event it corrects. That event drops out of the effective sequence but stays stored.
  - The current phase is the last effective event's `toPhase`, or `unknown` when there are no events.
  - Contradictory `fromPhase` values, backwards `occurredAt` times, bad correction targets and foreign events
    are reported for review, not normalized away (`derivePhaseHistory`).
- **Accounts.**
  - An account may have no catalogue link at all (legacy, manual or unknown programme). No placeholder
    provider is ever created.
  - A link's variant must belong to its provider, its version to its variant, and its selected path to its
    version (`checkAccountCatalogueLink`).
  - Adding a newer catalogue version never changes an account's selected version.
  - Funded successors with a new broker number link to their origin through `parent_account_id`.
- **Integrity** (`checkCatalogueGraph`):
  - Unique keys: provider slug; family slug per provider; variant slug per family; version number per variant;
    `(version, phaseKey, providerLabel)` per phase; path key per phase; at most one default path per phase.
  - Ownership: a variant's provider must match its family's; an offer's phase must belong to its version, and
    its path to its phase. A promotion may link only to offers of its own provider, with overlapping windows.
  - A version may supersede only a version of the same variant.

### Catalogue storage

`migrations/0006_provider_catalogue.sql` mirrors the DTOs. Field names map to `snake_case` columns.

- `STRICT` tables with UUIDv7 `TEXT` IDs and UTC ms instants enforced by CHECK. DTO money becomes
  `*_micros INTEGER >= 0` (`NULL` unknown, `0` known zero). A percent discount is `discount_percent_micros`
  (12.5% = 12 500 000, 0 < p ≤ 100). JSON columns (`aliases`, `platforms`, `metadata`) are checked for type.
- The DTO arrays become child tables: `sourceIds` → `catalogue_version_sources`, `commercial_offer_sources`,
  `promotion_sources`; `claims` → `catalogue_field_claims` (ordered by `position`). A promotion's `discount`
  union is `discount_kind` plus per-kind columns with a CHECK. `AccountCatalogueLink` is the
  `accounts` columns `provider_id`, `programme_variant_id`, `catalogue_version_id`, `selected_phase_path_id`,
  `size_source` (default `unknown`) and the existing `parent_account_id`.
- Every UNIQUE key under [Catalogue rules](#catalogue-rules) is a constraint, and the default path is a partial
  unique index.
- Ownership is enforced by composite foreign keys: variant → `(family, provider)`; offer and phase-event
  snapshot → `(phase, version)` and `(path, phase)`; `supersedes_version_id` → `(version, variant)`; a phase
  event's correction → `(event, account)`. Promotion links are checked by trigger: same provider, and
  overlapping link, promotion and offer windows. ALTER TABLE cannot add composite keys to `accounts`, so
  triggers check its link (variant in provider, version in variant, path in version).
- **Frozen versions.** One trigger enforces `canTransitionVerification` on every status change. Another rejects
  any other change to a reviewed version (`verified`, `stale`, `superseded`, `rejected`) and its deletion.
  The version's phases, paths, offers, offer sources, version sources and claims are frozen with it.
  This is stricter than `checkCatalogueVersionUpdate`, which sees only the version DTO. Write the contents
  first, then move the version to `verified`. Deleting a draft version cascades through its contents.
- `account_phase_events` rejects every UPDATE and DELETE. It references `accounts` with `ON DELETE RESTRICT`,
  so an account with phase history cannot be hard-deleted until Build 24 defines permanent delete. Other
  history-to-catalogue references are RESTRICT too. Rulebook IDs on phases and paths have no foreign key until
  the Build 9.5 tables exist.

**Migration 7, `map_legacy_catalogue`** (`db/steps.rs`), maps the legacy tables:

- Each firm becomes a provider and each programme a family. They are linked by `legacy_firm_id` and
  `legacy_programme_id`, and the legacy rows are left unchanged.
- The slug comes from the name: ASCII letters and digits in lower case, other runs replaced by a single `-`,
  and a fallback of `provider` or `programme` when nothing is left. A collision is suffixed `-2`, `-3`, … in
  creation order.
- Record status is `unknown`, or `archived` for a soft-deleted firm or programme. A family's category is
  the programme's `programme_type`. Only an `http(s)://` website is copied.
- `accounts.provider_id` is filled from `firm_id`. No variant, version, path or phase event is inferred.
- The step skips rows it has already mapped. The account store calls the same `provider_for_firm` whenever
  it finds or creates a firm, so later firms are mapped as well.

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
### Migrations

Migrations are forward-only. They are listed in `db::MIGRATIONS` (`apps/desktop/src-tauri/src/db/mod.rs`), and the
database's current version is `PRAGMA user_version`. There are two kinds of step:

- **`Step::Sql`**: a schema change or seed in `migrations/000N_name.sql`, embedded in the binary with `include_str!`.
- **`Step::Rust`**: a data step in `db/steps.rs` for work that needs the Rust domain logic, such as
  re-deriving a stored value or filling new tables from existing rows. It must be idempotent and must not change
  user-entered data.

| Version | Name | Kind | What it does |
|---|---|---|---|
| 1 | `core_schema` | SQL | Every V1 table, CHECK and trigger |
| 2 | `seed_instruments` | SQL | Built-in CME futures instruments |
| 3 | `round_trip_imports` | SQL | `trade_round_trips`, import warnings and source format |
| 4 | `archive_accounts` | SQL | `accounts.archived_at`; broker account numbers unique among active accounts |
| 5 | `rederive_trading_days` | Rust | Re-derives every stored `trades.trading_day` under the current [rules](#trading-day) |
| 6 | `provider_catalogue` | SQL | [Provider catalogue](#catalogue-storage) tables and triggers, plus nullable catalogue link columns and `size_source` on `accounts` |
| 7 | `map_legacy_catalogue` | Rust | Maps `firms` → `providers` and `programmes` → `programme_families`, and fills `accounts.provider_id` |

How an upgrade runs:

- Each pending migration runs in its own transaction together with its version bump. A failure, including
  one part-way through a Rust step, rolls that migration back and leaves the database at the last good version.
  Startup then reports `migration_failed`.
- Before upgrading an existing journal, `open_file` writes a consistent copy with `VACUUM INTO` to
  `fundedflow.db.before-v<N>.bak` next to the database. An up-to-date journal opens without a backup or any write.
- A database from a newer app version is refused (`NewerSchema`) rather than modified.
- Rule: never edit a migration that has shipped. Add the next version with a `Migration` entry. (0001 was revised
  before V1 shipped.)

**Migration 5: trading-day re-derive.** Trades saved before the weekend roll and the reset rule
(Build 8.75) could store a Saturday or Sunday day. Migration 5 recomputes each trade's day with
`domain::trading_day`, the same function used when a trade is saved, and updates only the rows whose
stored day differs. It changes nothing else: P&L, fees, dedup keys, `updated_at` and import provenance stay
as they were. Soft-deleted trades and archived accounts' trades are included. Rows whose account timezone,
reset or instants do not parse are left unchanged rather than blocking the upgrade. Accounts still holding
a legacy morning reset keep the "next day" rule, as described under [Trading day](#trading-day). Running the
step again changes nothing.

**Upgrade tests** (`db/upgrade_tests.rs`) use real journals in `db/fixtures/`:

- `fundedflow-v3.db` was written by the schema-v3 release (4e3c01f), before the weekend roll.
- `fundedflow-v4.db` was written by the current release (aeafe1e).

The tests check:

- every row of every table survives;
- only the expected trading days change;
- each firm gets one provider (`Apex` → `apex`), accounts point at it, and nothing else is inferred;
- the backup holds the old version;
- the store still lists, creates and dedups re-imports;
- reopening is a no-op;
- a failure in step 5 leaves the journal at version 4.

To try a copy of your own journal (read-only on the source), run this under `apps/desktop/src-tauri`:

```
FUNDEDFLOW_UPGRADE_DB=%APPDATA%\com.fundedflow.desktop\fundedflow.db cargo test --lib upgrade_copy -- --ignored --nocapture
```

## Repository port

The frontend reaches the journal only through `JournalRepository`, defined in `@fundedflow/domain`
(`packages/domain/src/ports/journal-repository.ts`). Its signatures name only domain contracts, with no Tauri
or SQLite types, so a Stage 2 adapter can implement the same interface.

| Member | Methods |
|---|---|
| `accounts` | `list`, `create`, `update`, `archive` |
| `trades` | `list`, `create`, `update`, `remove` |
| `journal` | `list`, `create`, `update`, `remove` |
| `imports` | `preview`, `commit`, `list`, `problemRows` |

- The desktop adapter is `createTauriRepository(invoke)` in `apps/desktop/src/lib/data/tauri-repository.ts`.
  `api.ts` binds it to Tauri's `invoke` as `repository`. Components import `repository` and never call `invoke`.
- The adapter validates inputs with the Zod contracts, keeps the existing command names and argument shapes
  (the IPC payloads are unchanged), and parses every response.
- Failures reject with `RepositoryError`, which carries the `AppError`. The desktop also exports it under the
  old name `DataError`.
- **Commit bundles.** Each write is one Rust command and one SQLite transaction. That command validates,
  derives trading day and P&L, and writes the change. For example, an import's batch, rows, trades and
  round-trip sources are one bundle, and so is an account settings change together with its trade re-derive.
  If any part fails, nothing is kept. Tests in `store/tests.rs`, `csv_import/tests.rs` and `db/upgrade_tests.rs`
  inject failures part-way through.
- Rulebooks (Build 9.5) and account snapshots (Build 15.5) join the port when their persistence exists. Provider
  catalogue tables (Build 9 contracts) arrive as a later migration.

## Startup and recovery

A database problem never stops the window from opening (`apps/desktop/src-tauri/src/runtime.rs`). Startup records the outcome,
and the frontend's `RuntimeGate` shows a recovery screen until the runtime is ready. While it isn't, every data
command returns `{ kind: "unavailable" }`; the UI never reads that as "no accounts".

- `runtime_status()` (read-only) returns `{ state: "initializing" | "ready" | "failed", schemaVersion,
  supportedSchemaVersion, created, failure }`. `created` is true only when this start created a new, empty journal.
- `retry_runtime()` re-runs the real open → backup → migrate path. It is a no-op when ready; concurrent retries
  run one at a time and all see the same result. Each attempt is bounded by SQLite's 5 s busy timeout.
- Recovery never deletes, resets, downgrades or replaces the journal. A file that fails to open stays byte-for-byte unchanged.

| `failure.category` | Meaning | Retryable |
|---|---|---|
| `data_directory` | The per-user data folder could not be resolved or created | yes |
| `open_failed` | The file exists but can't be opened or read (locked, corrupt, not a database) | yes |
| `backup_failed` | The pre-upgrade backup could not be written; no upgrade was attempted | yes |
| `migration_failed` | A migration failed and rolled back; the journal stays at its previous version | yes |
| `newer_schema` | Written by a newer FundedFlow; left untouched | no |

`failure.message` is safe to show the user, and `failure.detail` is the technical error.

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
- The trade's **trading day** is derived from the exit time (or entry, while open); see below.

## Trading day

`domain::trading_day`, computed when a trade is saved and stored in `trades.trading_day` (`YYYY-MM-DD`):

1. Convert the instant to the account's `timezone` (IANA; DST handled by the tz database).
2. If the account's `trading_day_reset_time` is not `00:00` and the local time is **at or after** the reset,
   the trade belongs to the **next** calendar date. Otherwise it belongs to the local date.
3. If that date is a **Saturday or Sunday, it rolls forward to Monday**.

**Allowed reset times: `00:00` (calendar days) or `12:00`–`23:59`.** An afternoon or evening reset opens the
next day's session (the CME convention: the 17:00 New York reset opens the next day's Globex session), which is
what step 2 assumes. Morning resets (`00:01`–`11:59`) are rejected by `domain::is_allowed_reset_time` (account
create/update) and by the Zod schema, because with a 06:00 reset a Monday 07:00 trade would land on Tuesday.

| Account reset | Fill (local time) | Trading day |
|---|---|---|
| 17:00 New York | Mon 16:59 | Mon |
| 17:00 New York | Mon 17:00 | Tue |
| 17:00 New York | Fri 17:30 | Mon (Sat → Mon) |
| 17:00 New York | Sun 18:00 | Mon |
| 00:00 | Sat 10:00 | Mon |

Builds 9, 15.5 and 16 (phases, daily-loss and ledger checkpoints, rules engine) must group by this stored value
rather than re-deriving days.

Existing data: the database CHECK only enforces `HH:MM`, so an account saved with a morning reset before this
rule keeps it (and the old "next day" result) until it is edited, when validation asks for an allowed time.
Stored trading days are re-derived when the account's currency, timezone or reset changes. Trades saved
before the Monday rollover were corrected once, by migration 5 (see [Migrations](#migrations)).

## CSV import

Code: `apps/desktop/src-tauri/src/csv_import/` — `parse` (CSV reading, limits), `detect` (format and header mapping),
`values` (strict value parsers), `normalize` (row → trade, errors and warnings), `dedup` (identity keys),
`mod.rs` (preview, atomic commit, history). UI: `apps/desktop/src/components/CsvImportSection.tsx`.

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
| Runtime | `runtime_status()`, `retry_runtime()` (see [Startup and recovery](#startup-and-recovery)) |
| Accounts | `list_accounts`, `create_account(input)`, `update_account(id, input)`, `archive_account(id)` |
| Trades | `list_trades(accountId)`, `create_trade(input)`, `update_trade(id, input)`, `delete_trade(id)` |
| Journal | `list_journal_entries(accountId)`, `create_journal_entry(input)`, `update_journal_entry(id, input)`, `delete_journal_entry(id)` |
| CSV | `preview_csv_import(request)`, `commit_csv_import(request)`, `list_csv_imports(accountId)`, `list_csv_import_problem_rows(batchId)` |

Updates replace all editable fields. Inputs are validated in TypeScript (Zod) and again in Rust before any write.
Errors are `{ kind: "validation" | "notFound" | "conflict" | "database" | "unavailable", message, issues? }`, with `issues` naming
each invalid field.
