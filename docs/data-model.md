# FundedFlow local data model

Status: V1, schema version 21 (P0-02; Build 23 adds no migration) (`apps/desktop/src-tauri/migrations/0001_core_schema.sql`, `0002_seed_instruments.sql`, `0003_round_trip_imports.sql`, `0004_archive_accounts.sql`, the Rust data step 5 `rederive_trading_days`, `0006_provider_catalogue.sql` the Rust data step 7 `map_legacy_catalogue`, `0008_freeze_ever_verified.sql`, `0009_rulebooks.sql` the Rust data step 10 `convert_legacy_rulebooks` `0011_account_attempts.sql` `0012_snapshot_rulebook_fk.sql` `0013_account_offer_selections.sql`, `0014_financial_evidence.sql`, `0015_nullable_engine_snapshots.sql` the Rust step 16 `rulebook_events` (`0016_rulebook_events.sql`) `0017_trade_reviews.sql` `0018_daily_reviews.sql` `0019_rulebook_binding_provider.sql`, `0020_source_fact_immutability.sql` and `0021_risk_promotions.sql`; see [Migrations](#database-location-and-migrations)).
Code: `apps/desktop/src-tauri/src/db` (migrations, opening), `apps/desktop/src-tauri/src/store` (accounts, trades, journal, rulebooks, reviews, library, attachments),
`apps/desktop/src-tauri/src/csv_import`, `apps/desktop/src-tauri/src/domain.rs` (validation, trading day, P&L),
`apps/desktop/src-tauri/src/commands.rs` (Tauri commands). Frontend types and Zod schemas: `apps/desktop/src/lib/data/`.

Everything is local. There is no network access, account system, sync or secret in the data layer.

## V1 source-of-truth policy

- **Round-trip first.** The unit of record is a canonical `trades` row (one round trip: entry and optional exit).
  Imported trades keep their immutable original CSV row (`import_rows`) and, for paired-fill exports, the
  immutable source fill pair (`trade_round_trips`). There is no executions ledger; trades cannot be recomputed
  from raw executions.
- **Authority for calculations is split (TASK-003, Option A).** Rust is authoritative for inputs, trade
  economics, trading days and persistence: validation, trading day, instrument lookup and realized P&L are
  computed in `src-tauri/src/domain.rs` and stored. The Zod schemas in `packages/domain/src/contracts` mirror the
  input rules for early feedback but never compute those values. The TypeScript risk engine
  (`packages/domain/src/engine`, Build 16) is authoritative for risk verdicts: it computes the status and figures
  stored in risk snapshots, and Rust checks that a stored result is consistent and that its sources are unchanged
  before promoting it, without recomputing it (`src-tauri/src/store/risk_promotion.rs`). Any other calculation
  moves to TypeScript only together with parity tests that run the same cases against both implementations and
  prove identical results; see [`architecture/packages.md`](architecture/packages.md).
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
| **Implemented** (commands, store code and tests) | `accounts`, `firms` (find-or-create by name), `account_status_events` (written on create and status change), `instruments` (seeded by 0002, read-only), `trades`, `trade_round_trips`, `import_batches`, `import_rows`, `journal_entries`, `tags`, `journal_entry_tags`, and the [rulebooks](#rulebooks): `rulebooks`, `rulebook_versions`, `rule_definitions`, `rule_claims`, `rule_applicability`, `account_rulebook_assignments` |
| **Implemented** (Builds 10 and 15.5) | `settings`, `account_ledger_entries`, `account_snapshots`, `financial_observations`, `ledger_revisions`, `financial_reconciliations`, `reconciliation_resolutions`; see [financial evidence](#financial-evidence-and-reconciliation-build-155) |
| **Implemented** (Build 20; see [Trade journal and reviews](#trade-journal-and-reviews-build-20)) | `trade_corrections` (migration 17), `trade_reviews`, `trade_review_tags`, `checklist_results`, `strategies`, `checklists`, `checklist_items`, `tags` (review kinds and archive), `attachments` and `attachment_links` (trade screenshots) |
| **Implemented** (Build 22; see [Daily reviews](#daily-reviews-build-22)) | `daily_reviews`, `daily_review_answers`, `daily_review_trades`, `daily_review_events` (migration 18) |
| **Reserved** (created and constraint-tested in 0001, no commands) | `app_meta` (journal_id etc. not yet written), `programmes`, `csv_mapping_profiles`, `audit_events`, `sync_outbox` (inert); `checklist_results.journal_entry_id` and `attachment_links.journal_entry_id` (still unused: daily reviews keep their answers in `daily_review_answers`, see Build 22) |
| **Implemented** (Builds 9/10 authoring and read commands; not merely schema) | provider catalogue: `providers`, `programme_families`, `programme_variants`, `catalogue_versions`, `catalogue_version_sources`, `catalogue_field_claims`, `catalogue_sources`, `programme_phases`, `phase_paths`, `commercial_offers`, `commercial_offer_sources`, `promotions`, `promotion_sources`, `promotion_offers`, `account_phase_events`, and the `accounts` link columns; see [Provider catalogue](#provider-catalogue). The account store keeps `providers` in step with `firms` (`provider_for_firm`). |
| **Legacy, kept unchanged** | `legacy_account_rulebook_versions`, `legacy_account_rules`: the 0001 account-owned rulebook tables, renamed by migration 9 and converted by step 10. No code writes them. |
| **Not in the schema** (future extensions) | `executions`, `execution_fees`, `trade_executions` (execution-first) |

Reserved tables are a starting point, not a finished design. The 0001 rulebook tables were account-owned
(`account_id NOT NULL`); migration 9 replaced them with reusable, versioned rulebooks, and step 10 converted
their rows field by field as [rulebook-migration.md](rulebook-migration.md) specifies. `firms`/`programmes` predate the Build 9 provider catalogue; migration 7 maps
them into `providers`/`programme_families` and keeps them. Shipped migrations are never edited.

## Provider catalogue

Status: **implemented** (Builds 9/10, PRs #27–28). The Zod DTOs, integrity checks and phase-history derivation are in
`packages/domain/src/catalogue` (Build 9), and the synthetic fixture is `packages/domain/test/fixtures/catalogue.json`.
The tables are migration 6 and the legacy mapping is migration 7 (Build 10; see [Storage](#catalogue-storage)).
Production stores are `store/catalogue.rs` (reads, review transitions, account links and phase events),
`store/authoring.rs` (create-only sources and create/replace drafts), and `store/offers.rs` (immutable account
offer selections). `commands.rs` exposes these through the existing `JournalRepository.catalogue` and Tauri
adapter. Provider/family/variant/promotion creation is importer tooling, not a shipped authoring command.
Migrations 8 and 13 add ever-verified freeze protection and account offer snapshots. The previous schema-only
description described migration 6 before these commands shipped; it is superseded.

Captured source facts (identity, URL/descriptor, publisher, capture/publication/effective dates and hash)
are immutable under migration 20, including direct SQL updates. Corrections capture a new source;
reviewer/verification metadata remains independent. Referenced source deletion remains FK-restricted.

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
    with a reviewer and a timestamp. A `stale` version is never reopened to `needs_review`; a re-review is a new
    superseding version.
  - `superseded` and `rejected` are final.
  - A reviewed version (`verified`, `stale`, `superseded`, `rejected`), or any version that was ever verified
    (`verifiedAt` set), is immutable apart from its status.
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
  any other change to a reviewed version (`verified`, `stale`, `superseded`, `rejected`) or to one that was ever
  verified (`verified_at` set), and its deletion. Migration 8 added the `verified_at` test and removed
  `stale` → `needs_review`: under 0006 that path unfroze a verified version, which could then be edited and moved
  back to `verified` with its original `verified_by` and `verified_at`. A version reopened that way before
  migration 8 stays frozen and can only be `rejected`.
  The version's phases, paths, offers, offer sources, version sources and claims are frozen with it.
  This is stricter than `checkCatalogueVersionUpdate`, which sees only the version DTO. Write the contents
  first, then move the version to `verified`. Deleting a draft version cascades through its contents.
- `account_phase_events` rejects every UPDATE and DELETE. It references `accounts` with `ON DELETE RESTRICT`,
  so an account with phase history cannot be hard-deleted until Build 24 defines permanent delete. Other
  history-to-catalogue references are RESTRICT too. Migration 9 adds triggers requiring phase/path rulebook
  bindings to name an existing catalogue rulebook version; applicability ownership is checked separately.
  Migration 19 additionally requires phase/path bindings to stay within the version's provider. Existing
  inconsistent bindings are preserved for review; `get_applicable_rulebook` returns them as `unverified`,
  never resolved. Archived versions or rulebooks also remain unverified when explicitly bound.

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

## Rulebooks

Status: **implemented** (Build 9.5). Contracts: `packages/domain/src/rulebook` (Zod, shared with the rules engine
of Build 16, which must import rather than redefine them). Tables: `migrations/0009_rulebooks.sql`. Store:
`src-tauri/src/store/rulebooks.rs`; parameter checks: `src-tauri/src/rulebook.rs`. Fixtures:
`packages/domain/test/fixtures/rulebook.json` (synthetic 50K FLEX shapes) and
`rulebook-legacy-conversion.json` (written by the Rust conversion test, parsed by the Zod tests).

No rule is evaluated here. A rulebook records what the terms say; whether an account meets them is Build 16.

**Two kinds of rulebook.**
- A **catalogue rulebook** (`owner_account_id` NULL) belongs to a provider. Its versions apply to exact
  catalogue phases and paths. A version can be assigned to an account only after a named reviewer verifies it.
- An **account-private rulebook** holds one account's own rules: the legacy conversions and anything the user
  writes. It is never provider-verified (trigger). Publishing puts it in use (`needs_review`), and
  `user_confirmed_at` records the user's own check. It never applies to catalogue phases and cannot be
  assigned to another account. Deleting the account deletes it.

**Versions.**
- Only a never-verified draft is editable. Afterwards the rules, applicability and claims are frozen with
  the version; only its status, `record_status` and `updated_at` change.
- A correction is a new version with `supersedes_version_id` and a reason. Verifying it marks the old one
  `superseded`.
- Status changes follow `canTransitionVerification`, without stale → needs_review.

**Rules.** One `rule_definitions` row per rule, unique `rule_key` per version. `parameters_json` is the
discriminated Zod shape for its `rule_type`, checked again in Rust (unknown fields rejected). Every value is a
tagged presence:
- `unknown`
- `explicit_none` ("NONE")
- `disabled` ("OFF")
- `not_applicable`
- `value`; an explicit zero is the value `"0"`, never a bare null

`support_status` states what can be done with the rule:
- `supported`: every needed value is known;
- `needs_setup`: a needed value is unknown, so the risk status stays indeterminate;
- `manual_only`: restrictions and manual checks, always confirmed by a person;
- `unsupported`.

A personal limit (`override_kind = 'personal_limit'`) is the user's own rule beside the provider's, with no
provider wording.

| Rule type | Covers |
|---|---|
| `profit_target`, `daily_loss_limit` (incl. conditional "below initial trail"), `max_drawdown` (static / EOD / intraday, lock) | Account risk limits |
| `min_trading_days` | Trading days, or qualifying profit days when `minDayProfit` is a value |
| `consistency` | Best-day share as a decimal in (0, 1] |
| `max_position_size` | Mini/micro/any limits; how several combine stays `unknown` until confirmed |
| `max_trades_per_day` | |
| `payout_eligibility`, `payout_count_transition`, `scaling_plan` | Payout waiting days and caps, payouts to Live, scaling ("Yes" alone leaves the schedule unknown) |
| `trading_restriction`, `manual_check`, `unknown` | Always `manual_only` or `unsupported` |

**Applicability and resolution.** `rule_applicability` ties a catalogue version to one phase, or one path of
it, of an exact catalogue version. The checks:
- composite foreign keys keep the path in the phase and the phase in the catalogue version;
- a trigger rejects another provider's catalogue version.

`get_applicable_rulebook(phase, path)` resolves in this order:
1. The explicit binding: the path's override, then the phase default.
2. Otherwise, the verified applicability rows for exactly that phase and path.

It answers `resolved`, `unverified` (bound but not verified), `ambiguous` (several verified) or `none`. Nothing
is inferred from names or inherited from another size, phase or path.

**Claims.** `rule_claims` link a rule to a `catalogue_sources` row with its exact wording. A claim's own status
(candidate, verified, rejected, stale, conflicting) is reviewed independently. A conflicting claim can be
added to a published version. `flag_rulebook_source_conflict` does that, and makes a verified version `stale`
until a correction supersedes it.

**Assignments.** `account_rulebook_assignments` say which version governs an account over half-open trading days
`[effective_from, effective_to)`.
- A trigger rejects an unassignable version and overlapping intervals.
- Assigning a version ends the account's open assignment on that day.
- Assignments are history: the only change allowed is closing an open one.
- Nothing switches an account to a newer version by itself.
- A phase or path given with an assignment must be one the version applies to.

**Publication.** `publish_rulebook_version(id, reviewer)` moves one step at a time:
- a draft goes to `needs_review`, without a reviewer; for an account-private rulebook this also records the user's
  confirmation in `user_confirmed_at` (Build 19), which the Build 16 engine requires before it evaluates private rules;
- a catalogue version in review goes to `verified`. That needs a reviewer, at least one applicability row and
  no conflicting claim.

`validate_rulebook_draft` returns what would stop the next step.

### Editing, guarded writes and the audit log (Build 19)

Store: `store/rulebooks.rs`; tests: `db/rulebook_editor_tests.rs`; table: `migrations/0016_rulebook_events.sql` (migration 16).

- **Revision.** A version's `updated_at` is its revision. Every write that changes a version sets it to now, but
  always at least one millisecond later than before, so two saves in one millisecond still differ.
- **`update_rulebook_draft(id, expectedUpdatedAt, input, context)`** replaces a never-published draft's rules,
  applicability, provider-stated dates, captured time and reason in one transaction (its rules' claims go with
  them). The rulebook, number and superseded version stay. A different `expectedUpdatedAt`, or a version that is
  no longer a draft, is a **conflict**: nothing is written. Validation is the same as for a new draft.
- **`discard_rulebook_draft(id, expectedUpdatedAt, context)`** moves a draft to `rejected` with a required
  reason. It is kept, listed with the versions and can never be published. Nothing is deleted.
- **`publish_rulebook_version(id, reviewer?, expectedUpdatedAt?, context?)`**: the optional arguments refuse a
  version changed since it was read. Publishing a draft that supersedes `S` is a **conflict** when another
  version of the rulebook newer than `S` has been published meanwhile (the draft is stale; start again from the
  newest version). Old callers without the new arguments behave as before.
- **`assign_rulebook_to_account(input, guard?)`**: the guard names the open assignment the caller saw
  (`expectedOpenAssignmentId`, null for none) and the actor and reason. A different open assignment is a
  **conflict**, so a stale window never ends an assignment it did not show.
- **Audit log.** `rulebook_events` is append-only (no update; no delete while the rulebook exists): one row per
  draft created, saved or discarded, version published or verified, assignment (with its id and account), and
  source conflict, with the actor label and reason. Resets that assign a rulebook log it too. Actor labels are
  local and unauthenticated (`local_user`). `list_rulebook_events({ rulebookId } | { accountId })` reads them
  oldest first; the account query also returns the events of the account's private rulebooks. Nothing was
  backfilled: versions and assignments from before v16 keep only their own timestamps.

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
| Archive account | Soft delete (`archived_at`, migration 0004). Hidden from live lists. Archived accounts are **read-only browsable**: their trades, journal entries and imports can be read (`get_account`, `list_trades`, `list_journal_entries`, `list_csv_imports`) but not written (writes return not-found). Nothing is removed and the status is unchanged. Each archive and restore is a row in `account_archive_events`. |
| Restore account | `restore_account` clears `archived_at` and nothing else: a restored failed account stays failed. If the account is active or paused and another active or paused account holds its broker account number, restoring is refused (conflict) and nothing changes. |
| Mark failed / change status | `change_account_status` records the new status with the user's effective time, optional `cause` (the user's words; none means unknown) and notes in `account_status_events`. It never archives, deletes or resets, and infers no rule breach. An archived account must be restored first. |
| Evaluation reset | `reset_account_attempt` creates a **new account** (new id) linked to the previous attempt. See [Account lifecycle](#account-lifecycle-attempts-archive-and-history). |
| Permanent delete | **Not implemented** (Builds 24–25). `preview_account_deletion` is read-only and lists what one account holds and what blocks deleting it. The schema's `ON DELETE CASCADE` remains for that future flow, but attempt links and phase events use `ON DELETE RESTRICT`, so an account in a reset chain cannot be hard-deleted. |
| Delete trade | Soft delete (`deleted_at`). Hidden from lists; any journal entry linking to it has `trade_id` cleared in the same transaction. The row keeps its `dedup_key`; re-importing its CSV row restores this same trade (see [Duplicate detection](#duplicate-detection)). Its review, checklist answers and screenshots are kept and return with it; `restore_trade` undoes a delete. Both are recorded in `trade_corrections`. |
| Correct trade | `update_trade` replaces the editable fields and re-derives trading day and P&L. The original CSV row and source fills never change. Each change is a `trade_corrections` row with the old and new stored values (Build 20). |
| Delete journal entry | Hard delete; tag links cascade. |
| Journal ↔ trade | A journal entry may link only to a non-deleted trade **of the same account** (validated in Rust, enforced by triggers). |
| Trade ↔ account | A trade never moves between accounts; account and import provenance are immutable (trigger). |
| Account settings change | Changing currency, timezone or reset time re-derives every trade's trading day and P&L in the same transaction. |

## Ledger, settings, snapshots and catalogue operations (Build 10)

Repositories in `apps/desktop/src-tauri/src/store/` behind the `JournalRepository` port; contracts in
`packages/domain/src/contracts/{ledger,settings,snapshots}.ts` and `catalogue/operations.ts`.

- **Ledger** (`account_ledger_entries`): payouts, resets and corrections change bookkeeping balance; firm risk-floor effects require separately verified rule semantics; evaluation,
  activation and reset fees never do (they are kept for the V1.5 account-ROI report, which is not built). Amounts are
  signed decimal text: payouts and fees are negative, zero is refused, and `other` must state whether it affects the
  balance. The trading day is derived in Rust from the account's time zone and trading-day reset time. An entry never
  moves to another account, deleting is soft, archived accounts are readable but not writable, and
  `balanceAdjustment` sums only balance-affecting, non-deleted entries.
- **Settings** (`settings`): lower-case dotted keys to JSON values up to 64 KiB, upserted. No secrets belong here.
- **Snapshots** (`account_snapshots`): the rule engine (Build 16) computes figures; this repository stores and reads
  them and calculates nothing. Unknown figures are null, never zero: migration 15 made balance, realizedDayPnl,
  tradingDaysCompleted and drawdownLocked nullable. `safe`/`caution` still require known balance and daily P&L;
  an `unknown` status needs reasons; an
  `explanation` object is required. An end-of-day save with the same account, day, engine version and inputs hash
  returns the stored row. A saved snapshot is history only. The account's **current** result is the newest
  `risk_promotions` row (migration 21, P0-02). `promote_account_risk` writes it together with its snapshot in one
  `BEGIN IMMEDIATE` transaction, and only if the calculation's sources, re-read natively, are unchanged. Every read
  rechecks that; see [P0-02](architecture/p0-02-risk-promotion.md).
- **Catalogue** (`store::catalogue`): `load` reads the whole catalogue (the same loader the fixture round-trip test
  uses); `transitionVersion` moves a version through review (`verified` needs a named reviewer, a stale version
  re-verified keeps its original sign-off, and the migration 6/8 triggers refuse illegal moves); `setAccountLink`
  links an account to a variant, version and path (the provider follows the variant; the triggers check each belongs to
  the one above); phase history is append-only, recorded by the user, and corrections are new events. Catalogue
  *content* (providers, families, versions, offers) is not written from the desktop: it arrives from importer tooling as
  new draft versions.

### Catalogue authoring and offer snapshots (Build 9.2 and 9.4)

- **Drafts.** `createDraft` writes the next version of a variant (number = highest + 1) with its source links,
  claims, phases, paths and offers in one transaction; any failure leaves the catalogue unchanged. An offer names its
  phase by (`phaseKey`, `providerLabel`) and path by `pathKey`, which are unique inside one version. Prices are
  decimal text: absent is unknown, `"0"` is known free, and prices need a currency. An offer's `effectiveFrom` and
  `effectiveTo` must be valid instants (absent is an open bound) with the end after the start.
- **Only a draft is editable.** `replaceDraft` refuses a version in review or reviewed with a message pointing to a
  superseding version (the freeze triggers still protect reviewed content underneath). It recreates phases and paths,
  so a draft whose phase or path is already referenced (an applicability row, an account, a phase event) cannot be
  replaced and nothing changes. It recreates offers too, so a draft whose offers a promotion already names is refused
  rather than silently losing those promotion links.
- **Corrections.** A correction is a new draft naming `supersedesVersionId` (another version of the same variant) and a
  reason; `createDraft` and `replaceDraft` check this alike. It goes
  through the normal review path, and the original moves to `superseded` only once a *verified* version that names it
  exists (`transitionVersion`). The original's content, sign-off and terms never change.
- **Sources** are created (`createSource`) and never edited, so a claim's provenance is fixed.
- **Offer selections** (`account_offer_selections`, append-only): `selectOffer` needs the account's catalogue version;
  the offer must belong to it (and to the account's selected path when it names one) and be in effect on the
  selection date (`effectiveFrom` ≤ `selectedAt` < `effectiveTo`); a promotion must be the
  account's provider's, linked to that offer, and valid on the selection date. The row stores a frozen copy of the
  offer, promotion, sources with their verification state and the version's review state, so later edits to a draft
  offer or promotion, or a new catalogue version, cannot change what the account recorded. Commercial terms are never
  read by any rule calculation. Promotions and providers are created by importer tooling, not from the desktop.
- **Evidence.** `parity::every_command_is_registered_and_every_adapter_call_exists` checks the production command
  registration against the adapter, and `a_populated_v7_journal_reads_through_the_production_loader…` upgrades a
  populated v7 journal to the latest schema and reads it back identically.

## Account lifecycle: attempts, archive and history

Implemented by migration 11 (`0011_account_attempts.sql`), `store/accounts.rs`, `store/attempts.rs` and the contracts in
`packages/domain/src/contracts/account-lifecycle.ts`. Product rules: Build 15, "Approved account lifecycle and reset experience".

**Three separate ideas.** *Status* (`active`, `paused`, `passed`, `failed`, `closed`) is the account's result.
*Archived* is a visibility and retention flag, never a result. A *prop-firm evaluation reset* is a new linked account;
it is not `trading_day_reset_time`, which only sets the session-day boundary.

**Failed accounts are kept.** Failing changes the status and nothing else: trades, imports, journal entries,
snapshots, rulebook assignments and history stay, and the account is never archived or deleted automatically.
`list_accounts` still lists it, `list_active_accounts` (active and not archived) does not, and risk views must read
only `list_active_accounts` / `isRiskEligible`. A reset's previous attempt is `failed`, `passed` or `closed`, so it is
excluded from risk too.

**Reset = new linked account.** `reset_account_attempt` runs in one transaction and either writes everything or nothing:

1. the previous attempt's outcome, as the user confirmed it (`passed`, `failed` or `closed`; never assumed), is recorded
   as a status event effective at the reset time, with the reason as its cause;
2. a new account is inserted with a new id. It inherits identity only (firm, provider, broker, type, currency, time zone,
   session boundary). It takes its own name, provider account number (may equal the old one), **required** starting
   balance, optional programme/version/path selection (not copied) and notes. It starts `active` with no trades, imports,
   journal, snapshots, ledger entries or assignments, so no risk figure carries over;
3. the rulebook decision is explicit: `assign` runs `rulebooks::assign_in` inside the same transaction, `decideLater` is
   recorded as `deferred`;
4. an `account_attempt_links` row records predecessor, successor, kind (`evaluation_reset`), confirmed outcome, effective
   time, reason, source (`user_entered`, `provider_email`, `provider_dashboard`, `other`) and the rulebook decision.

An attempt has at most one predecessor and one successor (unique keys), so chains are paths. Links are append-only and
reference accounts with `ON DELETE RESTRICT`. `parent_account_id` keeps its original meaning (evaluation → funded
successor) and is not used for resets. `get_account_lineage` returns the chain from any member, first attempt first,
with trade count, trading-day range, committed imports and the sum of known net results; trades without a result are
counted separately (`tradesWithUnknownPnl`) and an attempt with none shows no sum, never `0`.

**Broker account numbers.** The unique index on `(broker, external_ref)` now covers only active or paused, unarchived
accounts. Failed, passed, closed and archived attempts keep their number, so a provider can reuse it for the next
attempt, while two accounts that can trade still cannot share one (conflict). Changing a failed account back to active
and restoring an archived one are both checked against it. CSV duplicate keys are per account, so the same file imports
into each attempt independently and is a duplicate only within the attempt that holds it.

**Backup and restore.** Lineage, status history and archive history are ordinary tables, so the pre-upgrade backup
(`VACUUM INTO`) and a restored copy carry them (tested).

**Import protection (native).** `CsvPreview.targetAssessment` checks exact entry/exit instants against immutable
reset intervals, including restores and rows omitted from display. Out-of-window or reset-spanning rows block the
file; in-window non-active attempts require explicit confirmation. Commit requires the reviewed preview token and
rechecks it with current account settings, lineage and dedup state inside its write transaction. The older
`assessImportTarget` date-only helper is deprecated and does not authorize production imports.

### Permanent deletion: decisions still needed (Builds 24–25)

No delete command exists, deliberately. Before one is built, product must decide:

1. Whether an account in a reset chain can be deleted alone. Today the links and phase events block it. Options: refuse
   until the whole chain is selected, or delete one attempt and keep its neighbours with the link marked
   "predecessor deleted" (needs a forward migration to relax the append-only links).
2. Whether deleting an attempt may remove its imports' source files and attachments, and what happens to trades whose
   `dedup_key` would no longer exist (re-importing would then recreate them).
3. The confirmation (typed account name, exact counts from `preview_account_deletion`) and a pre-delete export or backup.
4. "Erase the entire local journal" is a separate Settings action over the database file, not an account operation.

Shared catalogue, provider and rulebook-catalogue records are not account-owned and would stay in every option.

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
| 8 | `freeze_ever_verified` | SQL | Replaces the catalogue freeze triggers: a version with `verified_at` set stays frozen, and `stale` → `needs_review` is removed. Changes no rows |
| 9 | `rulebooks` | SQL | Renames the 0001 rulebook tables to `legacy_account_*` and creates the [rulebook](#rulebooks) tables and triggers; phase and path rulebook IDs must now name a catalogue rulebook version |
| 10 | `convert_legacy_rulebooks` | Rust | Converts legacy account-owned rulebooks into account-private rulebooks, keeping their IDs ([matrix](rulebook-migration.md)); the legacy rows stay |
| 11 | `account_attempts` | SQL | `account_status_events.cause`; `account_attempt_links` (append-only) and `account_archive_events`; broker account numbers are unique only among active or paused, unarchived accounts. Existing archived accounts get an `archived` event from their `archived_at`. Changes no other rows |
| 12 | `snapshot_rulebook_fk` | SQL | Rebuilds `account_snapshots` so `rulebook_version_id` references the reusable `rulebook_versions` (migration 9's rename had left it pointing at `legacy_account_rulebook_versions`, so no snapshot of an account on a reusable rulebook could be stored). Rows are kept; a reference to an id that was never converted becomes null; the key is `RESTRICT` instead of `CASCADE` |
| 13 | `account_offer_selections` | SQL | Append-only `account_offer_selections`: the offer and promotion an account was bought under, with a frozen JSON copy of the terms and provenance. Offer, promotion and version keys are `RESTRICT`. Changes no other rows |
| 14 | `financial_evidence` | SQL | Dedicated immutable financial observations, ledger revisions (including migration-time current-state baseline), frozen reconciliations and append-only review resolutions. No inferred financial history or calculated snapshot changes |
| 15 | `nullable_engine_snapshots` | SQL | Build 16: rebuilds `account_snapshots` keeping every row, id, key and index, so `balance`, `realized_day_pnl`, `trading_days_completed` and `drawdown_locked` can be NULL (unknown); calculated rows become immutable |
| 16 | `rulebook_events` | Rust | Build 19: the append-only [rulebook audit log](#editing-guarded-writes-and-the-audit-log-build-19) (`0016_rulebook_events.sql`, idempotent). Builds 16 and 19 were built in parallel and both numbered their migration 15; neither shipped. A journal that reached 15 on the Build 19 branch has the audit log but not the nullable snapshots, so this step first applies the migration 15 rebuild when `account_snapshots.balance_micros` is still NOT NULL, then creates the log if missing. Nothing backfilled |
| 17 | `trade_reviews` | SQL | Build 20: append-only `trade_corrections`; `trade_reviews` gains `account_id` (filled from the trade), `revision` and strategy/checklist label snapshots; `trade_review_tags` gains label and kind snapshots; `tags.archived_at`, `checklists.description_md`; `attachments` gains `account_id`, `width`, `height`. Same-account and append-only triggers. Changes no other rows. See [Trade journal and reviews](#trade-journal-and-reviews-build-20) |
| 18 | `daily_reviews` | SQL | Build 22: `daily_reviews` (unique per account and trading day, revision, plan with authored time and timing, reflection, no-trade day, daily checklist snapshot, completion fields), `daily_review_answers` (item label and order snapshots), `daily_review_trades` (links by trade id with the values saved), append-only `daily_review_events`. New tables only; no existing row changes and no journal entry becomes a review. See [Daily reviews](#daily-reviews-build-22) |
| 19 | `rulebook_binding_provider` | SQL | Build 10.5: additive INSERT/UPDATE guards prevent phase/path bindings to another provider's rulebook. Existing rows and historical references remain unchanged; production applicability reads fail closed for inconsistent or archived bindings. |
| 20 | `source_fact_immutability` | SQL | Build 10.5: freezes captured source identity/content/date/hash facts without rewriting existing rows; independent reviewer/verification metadata remains updateable. |
| 21 | `risk_promotions` | SQL | P0-02: append-only `risk_promotions` (account, snapshot, source fingerprint, promoted at); same-account, no-update and no-delete-while-the-account-exists triggers. Nothing backfilled: earlier snapshots stay history and are never current. See [P0-02](architecture/p0-02-risk-promotion.md) |

How an upgrade runs:

- Each pending migration runs in its own transaction together with its version bump. A failure, including
  one part-way through a Rust step, rolls that migration back and leaves the database at the last good version.
  Startup then reports `migration_failed`.
- Before upgrading an existing journal, `open_file` writes a consistent copy with `VACUUM INTO` to
  `fundedflow.db.before-v<N>.bak` next to the database. An up-to-date journal opens without a backup or any write.
  Before replacing an existing backup, it copies and flushes that recovery point to
  `fundedflow.db.before-v<N>.previous-<uuid>.bak`. A retry after a partially committed upgrade therefore keeps
  the original older-schema backup as well as the most recent retry backup. If preservation fails, migration
  is not attempted. These retained backups are not automatically deleted.
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
- restoring the backup over the journal gives back the old version exactly, and opening it upgrades it again
  to the same data;
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
| `accounts` | `list({ includeArchived? })`, `get`, `listActive`, `create`, `update`, `archive`, `restore`, `changeStatus`, `history`, `resetAttempt`, `lineage`, `previewDeletion` |
| `trades` | `list`, `create`, `update(id, input, options?)`, `remove(id, reason?)`, `restore`, `listDeleted`, `detail` |
| `reviews` | `get`, `save`, `summaries`, `addScreenshot`, `readScreenshot`, `removeScreenshot` (Build 20) |
| `library` | `load`, `saveStrategy`, `saveTag`, `saveChecklist`, `setArchived` (Build 20) |
| `ledger` | `list`, `create`, `update`, `remove`, `balanceAdjustment` (writes now append immutable revisions) |
| `evidence` | `inputs`, `create`, `get`, `list`, `correct`, `ledgerHistory`, `correctLedger`, `removeLedger`, `reconcile`, `reconciliations`, `resolve`, `resolutions`; [contracts and commands](handoffs/build-15-5.md) |
| `settings` | `get`, `list`, `set`, `remove` |
| `snapshots` | `save`, `list`, `latest` |
| `catalogue` | `load`, `transitionVersion`, `getAccountLink`, `setAccountLink`, `listPhaseEvents`, `recordPhaseEvent`, `createSource`, `createDraft`, `replaceDraft`, `selectOffer`, `listOfferSelections` |
| `journal` | `list`, `create`, `update`, `remove` |
| `imports` | `preview`, `commit`, `list`, `problemRows` |
| `rulebooks` | `list`, `listVersions`, `getVersion`, `getApplicable`, `createDraft`, `validateDraft`, `publish`, `assign`, `listAssignments`, `flagSourceConflict` |

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
- Calculated account snapshots and provider catalogue operations are already implemented (Build 10).
  Build 15.5 adds raw financial evidence separately; see the [backend handoff](handoffs/build-15-5.md).

## Startup and recovery

A database problem never stops the window from opening, and neither does a slow upgrade
(`apps/desktop/src-tauri/src/runtime.rs`).
- **Startup:** Tauri's setup creates the runtime in the `initializing` state and runs the open → backup → migrate
  path on a background thread, so the window and command bridge come up at once.
- **Gate:** the frontend's root `RuntimeProvider` owns checking, ready, unavailable, recovering and
  unsupported-schema states. `RuntimeGate` consumes that shared state rather than starting another loop.
  Each check/recovery cycle makes at most eight commands: the first immediately, then read-only status
  checks after 500 ms, 1 s, 2 s, 4 s, 8 s, 8 s and 8 s. Delays start after a response, so requests never overlap.
  Known failures, malformed/rejected responses and bridge timeouts end the cycle immediately. Once the check
  budget is exhausted, data stays unavailable and the UI says automatic checks paused and initialization
  may still be running. This neither cancels the native upgrade nor declares it failed. Retry starts a new
  finite cycle with `retry_runtime` exactly once; subsequent requests only read status.
- **Data commands:** until the runtime is ready they return `{ kind: "unavailable" }` at once, without waiting
  for initialization. The UI never reads that as "no accounts".

`runtime_status()` (read-only) returns `{ state, stage, schemaVersion, supportedSchemaVersion, created, failure }`:

| Field | Meaning |
|---|---|
| `state` | `initializing`, `ready` or `failed` |
| `stage` | What initialization is doing, reached or failed at: `data_directory`, `open`, `backup`, `migrate`, `ready` |
| `schemaVersion` | The journal's version whenever known, also on failure: a newer journal's version, the version a failed upgrade left, or the version before a failed backup. `null` only when the file could not be read |
| `created` | True only when this start created a new, empty journal |
| `failure` | `{ category, retryable, message, detail, failedMigration }`; `failedMigration` is `{ version, name, fromVersion, reachedVersion }` for `migration_failed` |

- `retry_runtime()` starts the real open → backup → migrate path again in the background and returns at once
  (`initializing`). It is a no-op when ready, and while an attempt is already running it only reports the status.
  Attempts never overlap: one holds the connection for its whole run.
- Each SQLite lock wait is bounded by the 5 s busy timeout. The total time of a native upgrade is not bounded;
  frontend automatic checks have a finite budget independent of that work. Its two commands each have a 10 s
  answer timeout, which reports an unavailable bridge rather than asserting that initialization failed.
  Tauri invokes cannot be cancelled: the adapter retains its single-flight lock after a timeout until the
  underlying invoke settles, and rejects intervening calls as pending. A late response cannot change the
  frontend's expired state; another explicit check/retry is needed. If the bridge never settles, restarting
  the app is needed to get a new bridge rather than sending overlapping commands.
- `src/lib/data/runtime.ts` validates both commands, including supported ready versions, failure/stage
  consistency, newer-schema retry restrictions and migration version metadata. Invalid status cannot open
  the data gate. Read-only `check()` is available on the runtime context for explicit later rechecks; there
  is no perpetual polling after ready or unavailable. No feature component owns a separate runtime loop.
- A ready app rechecks status when its window regains focus. Runtime loss keeps the shell, Settings and recovery
  notice available. A previously opened data gate retains its mounted content/draft, labels it unavailable/stale,
  and disables form controls and the inert subtree until ready returns. New data content does not mount until
  ready. Feature hooks must separately gate queries/actions on readiness; Build 14 owns that integration.
- Recovery never deletes, resets, downgrades or replaces the journal. A file that fails to open stays
  byte-for-byte unchanged. A newer journal is refused before anything is written to it, including the WAL
  journal mode.

| `failure.category` | Meaning | Retryable |
|---|---|---|
| `data_directory` | The per-user data folder could not be resolved or created | yes |
| `open_failed` | The file exists but can't be opened or read (locked, corrupt, not a database) | yes |
| `backup_failed` | The pre-upgrade backup could not be written; no upgrade was attempted | yes |
| `migration_failed` | A migration failed and was rolled back. Each migration commits on its own, so earlier steps of the same upgrade may already be saved (`reachedVersion` > `fromVersion`) | yes |
| `newer_schema` | Written by a newer FundedFlow; left untouched | no |

`failure.message` is safe to show the user, and `failure.detail` is the technical error. For `migration_failed`
the message says "your data has not been changed" only when the failed step was the first of the upgrade.
Otherwise it says which version the journal is now at. Either way it names the pre-upgrade backup
`fundedflow.db.before-v<N>.bak`. Retrying continues the upgrade from where it stopped.

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
`target` (exact attempt assessment and preview acknowledgement), `mod.rs` (preview, atomic commit, history).
Production UI: `apps/desktop/src/features/imports/`; developer UI: `apps/desktop/src/components/CsvImportSection.tsx`.

Flow: the UI reads the chosen file as text on this computer and calls `preview_csv_import` (writes nothing).
The preview shows the detected format and mapping, every row's original line number, parsed values, warnings,
errors and duplicate status. Only after the user confirms does `commit_csv_import` save, re-running the same
analysis. Nothing is sent over the network: the file goes from the webview to the Rust process over Tauri IPC.

### Attempt assessment and acknowledgement

`targetAssessment` contains `previewToken`, `blocked`, `confirmations`, nullable `startInclusive`/`endExclusive`
UTC instants, and `candidateCount` (new rows plus restores, excluding duplicates/invalid rows). Every candidate's
entry and any exit must fit `[predecessor reset, successor reset)`. The root has no invented start date; the last
attempt has no invented end date. A trade spanning a reset blocks the whole file. Missing/non-monotonic reset
timestamps, cycles and legacy parent-only boundaries block rather than guess. Invalid source DST gap/overlap times
retain the existing row errors; offset-bearing times resolve exactly. Source timezone interprets file times;
account timezone/session reset derive trading days in Rust and do not round the attempt interval to a date.

Commit requires `targetAcknowledgement: { previewToken, historicalConfirmed }`. The SHA-256 digest binds the
exact request (including file bytes/name, mapping, date order and source timezone), normalized/classified rows,
saved restore timestamps, account state/session settings and the connected immutable reset links. It is an
agreement digest, not a security credential. Native commit re-analyzes and verifies under `BEGIN IMMEDIATE` before
any batch/row/trade write. Missing, blocked or stale acknowledgement rejects the import; non-active targets also
require `historicalConfirmed: true`. The mapping snapshot retains the acknowledgement and contract version 1.
The existing separate failed-batch log may record a rejected attempt after rollback; no committed batch, import
rows or partial trade writes survive. A fresh preview is required after input, account, lineage or dedup changes.

The existing wizard shows native reasons and clears confirmation when inputs, account context or lineage change.
It never derives interval permission from the displayed row subset. The developer importer sends a preview token
for ordinary imports and directs non-active cases to the production wizard for explicit review.

### Parsing

RFC 4180 CSV via the `csv` crate: quoted fields with embedded commas, newlines and doubled quotes; CRLF or LF;
a leading UTF-8 BOM is ignored. Line numbers are computed from byte offsets (header = line 1). Empty files,
a missing header row, header-only files, records with the wrong number of fields and unreadable records are
reported with clear messages. Limits: **10 MB and 50,000 data rows per file**; the preview lists every row up to
2,000 and, beyond that, every row with a finding. The 10 MB cap is inclusive and counts the **UTF-8 bytes of the
submitted text** (10,485,760), not characters or UTF-16 units; a leading U+FEFF in the submitted text counts as its
3 bytes. The desktop reads files as strict UTF-8, which drops a BOM, so a file with a BOM may be 3 bytes larger.
Other encodings are refused, not guessed. The shared schema counts bytes the same way (`utf8ByteLength`); see
[P0-04](architecture/p0-04-csv-contracts.md).

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
| Duration | `duration` | Optional; `32sec`, `1min 17sec`, `1hr 2min`, `1:02:03`. Whole seconds, 0 to 2^63 − 1; larger values are a row error. On the wire `durationSeconds` is a JSON number up to 2^53 − 1 and a decimal string above it, so every value arrives exactly ([P0-04](architecture/p0-04-csv-contracts.md)). |
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
earlier line of the same file, or an active trade of the account, has the same key. The preview explains which
line or saved trade it matches.

If the key belongs to a soft-deleted trade, the row is `new` and restores that trade: commit clears its
`deleted_at` instead of inserting a second row (the key is unique and immutable). The preview's `restores`
names the trade and `restoreCount` counts these rows (included in `newCount`). The restored trade keeps its
original values and import provenance. Its row record is `imported` with the restore noted in `issues_json`.
Journal links cleared by the delete are not restored. Preview and commit use the same classification.

| Row | Key |
|---|---|
| Performance row with both fill IDs | `fills2:<n>:<buyFillId>:<sellFillId>`, where `<n>` is the buy ID's length in UTF-8 bytes — the **pair**. The length makes the key unique even when IDs contain `:`. Rows sharing only a buy fill (one buy closed by several sells) or only a sell fill are distinct. |
| Generic row with a broker trade ID | `id:<trade id>` |
| Otherwise | `rt:` + SHA-256 of the normalized fields: format, symbol, quantity, both prices, both timestamps (UTC), reported P&L (and side for generic rows). |

Journals imported before P0-01 hold fill-pair trades under the unversioned key `fills:<buy>:<sell>`, which
distinct pairs such as `(a:b, c)` and `(a, b:c)` share. Keys are immutable and are not migrated. A pair with no
`fills2` match is looked up under its legacy key, and matches that trade (duplicate or restore) only if the
trade's stored `trade_round_trips` fill IDs are exactly this pair; a different stored pair means a different
trade, so the row imports as new under its `fills2` key. If the stored pair can't be read, the row is reported
`invalid` with an `identity` error instead of being matched or imported. Rows an earlier release skipped as
duplicates of a colliding pair keep their recorded history; re-importing the file now imports them. See
[docs/architecture/p0-01-p0-03.md](architecture/p0-01-p0-03.md).

Limitations:
- Without IDs, two genuinely identical round trips in one file are indistinguishable; the second is flagged as
  a duplicate (the preview says so) and not imported.
- Fees and notes are not part of the key, so a re-export that only corrects fees is a duplicate (edit the trade).
- The same trade exported in two different formats or with different timestamp precision produces different
  keys. Manual trades have no key. Duplicates are scoped per account.
- Deleted imported trades keep their key, so re-importing the file restores them rather than importing copies.

## Commands

| Area | Commands |
|---|---|
| Runtime | `runtime_status()`, `retry_runtime()` (see [Startup and recovery](#startup-and-recovery)) |
| Accounts | `list_accounts(includeArchived?)`, `list_active_accounts`, `get_account(id)`, `create_account(input)`, `update_account(id, input)`, `archive_account(id)`, `restore_account(id)`, `change_account_status(id, input)`, `get_account_history(id)`, `reset_account_attempt(input)`, `get_account_lineage(id)`, `preview_account_deletion(id)` |
| Ledger | `list_ledger_entries(accountId)`, `create_ledger_entry(input)`, `update_ledger_entry(id, input)`, `delete_ledger_entry(id)`, `get_ledger_balance_adjustment(accountId)` |
| Settings | `get_setting(key)`, `list_settings`, `set_setting(key, value)`, `remove_setting(key)` |
| Snapshots | `save_account_snapshot(input)` (history only), `list_account_snapshots(accountId, from?, to?, endOfDayOnly?)`, `get_latest_account_snapshot(accountId)`; P0-02: `capture_account_risk(query)`, `promote_account_risk(input)`, `get_current_account_risk(accountId)`, `get_account_snapshot_freshness(snapshotId)` |
| Catalogue | `get_catalogue`, `transition_catalogue_version(id, to, reviewer?)`, `get_account_catalogue_link(accountId)`, `set_account_catalogue_link(input)`, `list_account_phase_events(accountId)`, `record_account_phase_event(input)`, `create_catalogue_source(input)`, `create_catalogue_draft(input)`, `replace_catalogue_draft(id, input)`, `select_account_offer(input)`, `list_account_offer_selections(accountId)` |
| Trades | `list_trades(accountId)`, `create_trade(input)`, `update_trade(id, input, options?)`, `delete_trade(id, reason?)`, `restore_trade(accountId, id, reason?)`, `list_deleted_trades(accountId)`, `get_trade_detail(accountId, id)` |
| Reviews | `get_trade_review(accountId, tradeId)`, `save_trade_review(input)`, `list_trade_review_summaries(accountId)`, `add_trade_screenshot(input)`, `read_trade_screenshot(accountId, id)`, `remove_trade_screenshot(accountId, id)` |
| Library | `get_review_library()`, `save_strategy(id?, input)`, `save_tag(id?, input)`, `save_checklist(id?, input)`, `set_library_archived(input)` |
| Daily reviews | `get_daily_review(accountId, tradingDay)`, `list_daily_reviews(accountId)`, `save_daily_review(input)`, `reopen_daily_review(input)`, `relink_daily_review_trades(input)` |
| Insights | `get_insights_dataset(query)` (read only; Build 23) |
| Account freshness | `list_account_freshness(asOf)` (read only; P0-D06): per account, the newest committed import, failed import, manually entered trade (`created_at`, not deleted) and user-confirmed balance checkpoint in force, plus the current trading day, its start and the nine before it, and the next one's start (all from `domain::trading_day`). No verdict is stored or computed |
| Journal | `list_journal_entries(accountId)`, `create_journal_entry(input)`, `update_journal_entry(id, input)`, `delete_journal_entry(id)` |
| CSV | `preview_csv_import(request)`, `commit_csv_import(request)`, `list_csv_imports(accountId)`, `list_csv_import_problem_rows(batchId)` |
| Rulebooks | `list_rulebooks(accountId?)`, `list_rulebook_versions(rulebookId)`, `get_rulebook_version(id)`, `get_applicable_rulebook(query)`, `create_rulebook_draft(input, context?)`, `update_rulebook_draft(id, expectedUpdatedAt, input, context)`, `discard_rulebook_draft(id, expectedUpdatedAt, context)`, `validate_rulebook_draft(id)`, `publish_rulebook_version(id, reviewer?, expectedUpdatedAt?, context?)`, `assign_rulebook_to_account(input, guard?)`, `list_account_rulebook_assignments(accountId)`, `flag_rulebook_source_conflict(input)`, `list_rulebook_events(query)` |

Updates replace all editable fields. Inputs are validated in TypeScript (Zod) and again in Rust before any write.
Errors are `{ kind: "validation" | "notFound" | "conflict" | "database" | "unavailable", message, issues? }`, with `issues` naming
each invalid field.

## Financial evidence and reconciliation (Build 15.5)

Schema 14 adds source observations separately from calculated account snapshots, immutable ledger revisions and frozen exact reconciliation comparisons. New contracts, command payloads, precision/time policy, migration baseline limitations, per-rule evidence requirements and acceptance evidence are documented in the [Build 15.5 backend handoff](handoffs/build-15-5.md). Existing ledger APIs remain callable and record explicit legacy correction metadata. No risk-floor policy, live-equity feed, automatic balancing or compliance verdict is introduced.

## Trade journal and reviews (Build 20)

Store: `store/trades.rs` (corrections, detail, restore), `store/reviews.rs`, `store/library.rs`, `store/attachments.rs`;
tests: `store/journal_review_tests.rs`; schema: `migrations/0017_trade_reviews.sql` (migration 17); contracts:
`packages/domain/src/contracts/reviews.ts`. Screens and design notes: [architecture/build-20-trade-journal.md](architecture/build-20-trade-journal.md).

**Still round-trip first.** A trade stays one round trip. Nothing here regroups, splits, merges or rebuilds trades from
executions, and there is no execution ledger, so a correction edits the journal's values, never a source execution.

**Corrections.**
- `update_trade(id, input, options?)` validates, re-derives trading day, instrument and P&L in Rust, and writes in one
  transaction together with a `trade_corrections` row: kind `edit`, time, actor (`local_user`), optional reason, the
  changed field names and the stored values before and after (Trade DTO names, money as decimal text). An edit that
  changes nothing writes nothing and keeps `updated_at`.
- `options.expectedUpdatedAt` is the trade as last read; a later change is a **conflict** and nothing is written. Every
  write moves `updated_at` at least one millisecond forward, so two saves never share a revision. Callers without
  `options` behave as before.
- Delete (`delete_trade(id, reason?)`) and `restore_trade` are recorded too (`delete`, `restore`), and a CSV re-import
  that restores a deleted trade records `import_restore` (actor `csv_import`). The table is append-only: no update, and
  no delete while the trade exists (account deletion still cascades through the trade).
- Imported trades can be corrected. `import_rows.raw_json` and `trade_round_trips` stay as exported (their triggers),
  and re-importing the file never reverts a correction: the row is a duplicate of the same trade.
- Stored risk snapshots are never rewritten. Their `inputsHash` no longer matches the changed inputs, so the Build 16
  freshness check reports them stale; the desktop invalidates `snapshotsRoot` after every trade write.

**Trade detail.** `get_trade_detail(accountId, id)` returns the active trade of that account (another account's trade
is "not found"), its import batch and original CSV cells with the file's headers, the correction history, and the
previous and next active trade in entry order (ties broken by id) with its position.

**Reviews** (`trade_reviews`, one active review per trade).
- Owned by the trade's account (`account_id`, same-account trigger; trade and account immutable). Keyed by trade id, so
  CSV re-imports (which skip or restore the same trade) never touch a review, and nothing is matched by time or symbol.
- `save_trade_review(input)` creates or replaces in one transaction. `expectedRevision` is the revision the form started
  from (`null` when there was none); a different stored revision is a **conflict**. A screenshot added to a trade with
  no review creates an empty review (revision 1, no content), which a first save may replace.
- Snapshots: the strategy and checklist names, each tag's label and kind, and each checklist item's label are stored
  as they read when chosen. Re-saving keeps them; renaming or archiving a template never re-labels a review. Reads
  return the recorded label, `currentLabel` when the template was renamed since, and `archived`. Archived entries
  already on a review may stay; they cannot be newly chosen.
- Checklist answers (`followed`, `missed`, `not_applicable`, optional note) belong to the chosen trade checklist. An
  answer no longer given is set aside (`deleted_at`), never hard-deleted. Daily checklists are refused here (Build 22).
- Plan: planned entry, stop and target prices (decimal text) and planned risk (1R, money > 0). Unknown stays null, never
  zero. When no risk is entered, Rust derives 1R as |entry − stop| × quantity × point value for an instrument quoted in
  the account currency (`plannedRiskSource = "derived"`). `rMultiple` is net P&L ÷ 1R to 2 dp (half away from zero),
  only when both are known. Process (checklist adherence counts) and outcome (P&L) are returned separately.
- `list_trade_review_summaries(accountId)` returns reviewed status, strategy, tags, rating, adherence, screenshot count
  and note text per active reviewed trade, for the trade log's filters and search.
- `trade_reviews.mae_micros`, `mfe_micros` and `followed_plan` stay unused: excursions need execution data, and plan
  adherence for the day is the daily review's ([Build 22](#daily-reviews-build-22)).

**Library**, shared by every account: strategies (playbooks), tags (`setup`, `mistake`, `emotion`, `general`; unique
name per kind) and checklists (`trade` or `daily` scope, optional strategy for trade checklists) with ordered items.
`save_checklist` keeps item ids when items are renamed or reordered; items left out are archived. Nothing is deleted:
`set_library_archived` archives or restores a strategy, tag or checklist. Journal entry tags (Build 10) share `tags`
as `general` tags.

**Screenshots** (`attachments` of kind `screenshot`, linked to the review by `attachment_links`).
- The webview reads the picked, dropped or pasted file and sends its bytes (base64); no file path crosses IPC. Rust
  identifies PNG, JPEG or WebP from the signature (not the name), reads the dimensions from the header and refuses
  more than 10 MB, more than 16,384 px a side or 120 megapixels, more than 20 screenshots per trade, and the same image
  twice on one trade (SHA-256).
- Bytes are written to `<app data>/attachments/screenshots/<uuid>.<ext>` (a temporary name, flushed, then renamed;
  never overwriting an existing file), then the rows are committed. If the transaction fails the file is removed.
  `storage_key` is that relative, portable key; the row records `account_id`, size, hash, type and dimensions, and the
  original file name only as display text. Account and review ownership are checked on every read and write.
- `read_trade_screenshot` re-checks size, hash and type and returns `missing` or `corrupt` instead of bytes when the
  file is gone or changed; the review's text never depends on it. Uploads change neither the review's text nor its
  revision.
- Removing a screenshot soft-deletes its link and row. The bytes stay, because the Build 24 archive inventory includes
  soft-deleted rows; permanent removal belongs to Build 24's deletion and cleanup.
- Build 24 compatibility: the root (`<app data>/attachments/<storage_key>`), the key format and the inventory columns
  (`id`, `storage_key`, `byte_size`, `sha256`) are the ones the Build 24 archive and restore read, and ownership follows
  `attachment_links` → `trade_reviews` → `trades.account_id` as its deletion preview expects. Build 24 (PR #43) is not
  merged; its integration tests must be re-run against migration 17 when it is.

## Daily reviews (Build 22)

Store: `store/daily_reviews.rs`; tests: `store/daily_review_tests.rs`; schema: `migrations/0018_daily_reviews.sql`
(migration 18); contracts: `packages/domain/src/contracts/daily-reviews.ts`. Screens and design notes:
[architecture/build-22-daily-review.md](architecture/build-22-daily-review.md).

**Identity.** One review per `(account_id, trading_day)` (unique index). The trading day is Rust's
(`domain::trading_day`: the account's zone and reset time, weekends rolled to Monday), never a browser date; only
Monday-to-Friday keys are accepted (a CHECK and the store). An evaluation reset creates a new account, so a reset
attempt starts with no reviews and never shares one with its predecessor; a daily rollover is not a reset. Account and
day are immutable (trigger). Duplicate writes cannot fork: a save without `expectedRevision` when a review exists, or
with a stale one, is a **conflict** and writes nothing.

**Content.**
- Plan (optional): focus, planned setups, no-trade conditions, process commitments, maximum self-imposed risk (money
  > 0, account currency; null is not stated, never zero) and notes. Self-reported intentions, not firm rules.
  `plan_authored_at` is set when the plan first has content (cleared with it) and `plan_timing` is `pre_session` when
  that moment was before the session ended **and** before the day's first trade opened, otherwise `retrospective`.
- Reflection: market context, what went well, mistakes, emotions/mindset, key lesson, one next-session action, notes.
  Blank fields are allowed; each text is at most 20,000 characters.
- `no_trade_day`: the trader states they did not trade by choice. Refused when trades are recorded for the day.
- Daily checklist: a library checklist of scope `daily` (a trade checklist is refused), its name snapshotted when
  chosen. Answers (`followed`, `missed`, `not_applicable`, optional note) live in `daily_review_answers` with the item
  label and order as answered; an item answered before keeps its label. Unanswered items have no row. Renaming,
  reordering or archiving the checklist or an item never changes a past answer; an archived checklist already on the
  review may stay, but cannot be newly chosen. Library usage counts include daily reviews, so a used checklist cannot
  change scope.

**Adherence** (process only): numerator = answers `followed`; denominator = `followed + missed`. Not-applicable and
unanswered items never count as failures; `unanswered` is the chosen checklist's active items without an answer. With
no denominator `percent` is null (Unknown), never 0% or 100%. Whole percent, half away from zero, computed in Rust.
It says nothing about profit or prop-firm compliance.

**Lifecycle.** `status` is `draft` or `completed`. `save_daily_review(input)` with `action: "save"` keeps the status (a
completed review stays completed and records `edited_after_completion_at`); `"complete"` completes it and requires some
content (plan, reflection, checklist or a no-trade day). `reopen_daily_review` moves a completed review back to draft;
`first_completed_at` and the history stay. Every write bumps `revision` and appends a `daily_review_events` row
(`created`, `saved`, `completed`, `edited`, `reopened`, `relinked`; append-only). A future day (after the current trading
day, up to 14 calendar days ahead) takes a plan only. Archived accounts are read-only (writes are conflicts); failed or
closed attempts stay editable as history. Each save is one transaction; a failed check leaves the previous version.

**Trades and source changes.** On each save (and on `relink_daily_review_trades`) the day's active trades are stored
in `daily_review_trades` by trade id with their trading day, net P&L, P&L status and `updated_at` at that moment
(same-account trigger). Reads compare them with the day's trades now:
- `linked` (unchanged), `added` (imported or entered since), `changed` (corrected since);
- missing: `deleted` (soft-deleted; restoring brings it back as linked) or `moved` (now on another trading day, for
  example after a corrected exit time or an account timezone/reset change, which re-derives every trade's day);
- `sessionSettingsChanged` when the account's zone or reset differs from the review's `timezone_snapshot` /
  `reset_time_snapshot`.
The review never moves to another day or account; `relink_daily_review_trades` accepts the current trades without
touching text or status. CSV re-imports skip or restore the same trade ids, so links survive. The day's **outcome** is
summed in Rust from current trades with a known net P&L; unknown-P&L and open trades are counted and left out, and a
day without trades has no P&L (null), never zero. `dayState`: `traded`, `no_trade_day` (declared), or
`no_trades_recorded` (which cannot tell a missing import from a day off).

**Reads.** `get_daily_review(accountId, tradingDay)` returns the day: session settings now, the session window
(`[start, end)` instants: a day starts when the previous trading day ends, so Monday includes the weekend; DST is
resolved in the account's zone), the current trading day, `isFuture`, `archived`, the review or null, the day's trades
with link status, missing trades, outcome, day state and change flags. `list_daily_reviews(accountId)` returns the
current trading day, summaries newest first and **legacy day notes**: `journal_entries` without a trade, with the
trading day derived from their time. They are listed apart, read only, never converted into or counted as reviews.

## Insights (Build 23)

Store: `store/insights.rs`; tests: `store/insights_tests.rs`; contracts and the metric engine:
`packages/domain/src/insights`; parity mirror: `src-tauri/src/insights.rs` with `insights-metrics.json`. No migration.
Screens and definitions: [architecture/build-23-insights.md](architecture/build-23-insights.md).

`get_insights_dataset({ accountIds })` is **read only**. It names attempts by local account id (1–500, each must exist;
archived attempts are readable) and returns `contractVersion` (1), `generatedAt`, per account its identity, status,
archive time, currency, zone and reset, lineage root and attempt number, the status event that set the current status
(with the user's `cause`, never inferred), soft-deleted trade count and import counts, and every **active** trade of
those accounts with Rust-stored values (`tradingDay`, `fees`, `grossPnl`, `realizedPnl`, `reportedPnl`, `pnlStatus`),
the instrument root, and its review's strategy, tags (recorded labels and kinds), planned risk (entered, or derived from
the planned entry and stop as Trade detail derives it) and R multiple. Nothing is written, re-derived or matched across
accounts: a broker account number reused by reset attempts never merges their trades.

All aggregation is in `@fundedflow/domain` (`selectTrades`, `summarize`, groups). Unknown P&L is counted and left out of
sums, never zero; a zero denominator is N/A; amounts of different currencies are never added.
