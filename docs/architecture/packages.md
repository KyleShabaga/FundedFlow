# Packages, boundaries and the money/time wire contract

FundedFlow is one npm workspace (`apps/*`, `packages/*`, one root `package-lock.json`).

| Package | Path | Owns | May import |
|---|---|---|---|
| `@fundedflow/desktop` | `apps/desktop` | React UI, Tauri host (`src-tauri`), the Tauri/SQLite repository adapter (`src/lib/data/tauri-repository.ts`, bound in `api.ts`), `runtime.ts`, command names, desktop error mapping | `@fundedflow/domain` (entry point only), React, Tauri, Zod |
| `@fundedflow/domain` | `packages/domain` | Portable contracts (Zod DTO schemas in `src/contracts`), primitives (`src/primitives`), the provider catalogue (`src/catalogue`) and ports (`src/ports`: the `JournalRepository` interface) | `zod` only |

Dependencies point one way: desktop → domain. The domain package never imports `apps/desktop`, React, Tauri,
Node built-ins (`fs`, `net`, `process`, …), browser globals, network calls, clock reads or randomness. Results
depend only on the inputs. `npm run check:boundaries -w @fundedflow/domain`
(`packages/domain/scripts/check-boundaries.mjs`) enforces this in CI:

- `src/` may import only files inside `src/` and the allow-listed packages (`zod`). The Build 16 engine uses
  exact bigint/rational arithmetic and adds no decimal dependency.
- Runtime dependencies in its `package.json` must also be on the allow-list.
- `apps/desktop/src` must import `@fundedflow/domain` and not paths inside `packages/domain`.

The domain compiler settings back this up: `lib: ["ES2022"]` and `types: []`, so DOM and Node globals do not
type-check in the package.

## How the desktop consumes the domain package

- The domain package is ESM. `tsc -p tsconfig.build.json` builds it to `packages/domain/dist` as JS, `.d.ts` and
  source maps, and `exports`/`types` in its `package.json` point there. `dist/` is git-ignored. Hosts import the
  built output by package name with no source aliases. `npm run check:dist` loads it in plain Node.
- Desktop declares `"@fundedflow/domain": "0.1.0"`, a plain semver range that npm resolves to the workspace link.
  `workspace:*` is pnpm/Yarn syntax.
- `apps/desktop/src/lib/data/schemas.ts` re-exports the domain contracts so existing desktop imports keep working.
- Freshness: root `npm run build` builds domain, then desktop. The desktop's own `build` and `dev` scripts, which
  `tauri build`/`tauri dev` run, build domain first. During `npm run dev`/`npm run tauri dev`, a Vite plugin in
  `apps/desktop/vite.config.ts` keeps `tsc --watch` running on the package. An edit under `packages/domain/src`
  is recompiled into `dist`, and Vite hot-reloads it.

The Build 16 engine is in `src/engine`, exported from `src/index.ts`. CSV parsing remains authoritative in
Rust (Build 17 regression coverage). There are no deep imports.

## Rulebook module (Build 9.5)

`src/rulebook` holds the rulebook contracts:
- tagged presence states (`presence.ts`);
- one discriminated Zod schema per rule type (`rules.ts`);
- rulebooks, versions, applicability, claims, assignments and the repository inputs (`versions.ts`);
- `checkRuleDefinitions`, `canAssign` and `checkPublish` (`integrity.ts`).

The rules engine (Build 16) imports these schemas and must not redefine them. The Rust adapter checks the same
shapes in `src-tauri/src/rulebook.rs`. `test/fixtures/rulebook-legacy-conversion.json`, written by the Rust
conversion test, pins the two sides together. See `docs/data-model.md#rulebooks`.

## Catalogue module (Build 9)

`src/catalogue` holds the provider catalogue contracts. It is exported through `src/catalogue/index.ts` and
`src/index.ts`. The model and its storage plan are in [`../data-model.md#provider-catalogue`](../data-model.md#provider-catalogue).

| File | Contents |
|---|---|
| `fields.ts` (internal) | UUID IDs, slugs, verbatim provider labels, currency codes, canonical money text (`catalogueMoney`), half-open windows |
| `provenance.ts` | `sourceReferenceSchema`, `fieldClaimSchema`, verification statuses and `canTransitionVerification` |
| `providers.ts` | `providerSchema`, `programmeFamilySchema`, `programmeVariantSchema` |
| `versions.ts` | `catalogueVersionSchema`, `programmePhaseSchema`, `phasePathSchema`, `effectiveRulebookVersionId` |
| `offers.ts` | `commercialOfferSchema`, `promotionSchema`, `promotionOfferSchema` |
| `lifecycle.ts` | `accountCatalogueLinkSchema`, `accountPhaseEventSchema`, `derivePhaseHistory` |
| `integrity.ts` | `checkCatalogueGraph`, `checkAccountCatalogueLink`, `checkCatalogueVersionUpdate` (stable issue codes) |

Rules for this module:

- Catalogue DTOs are production wire shapes returned by `get_catalogue`, account-link and phase-event
  commands through `JournalRepository.catalogue` and the Tauri adapter (Builds 9/10, PRs #27–28).
  They use `z.strictObject`, so an unknown field is rejected. For example, a drawdown term on an offer fails to parse.
- Catalogue money is canonical decimal text that must already be exact in micro-units (`"105.2"`, not
  `"105.20"`), checked with `canonicalDecimal`/`toMicros`. Storage is `*_micros` like all other money. Minor
  units (cents) are not used, so units are never mixed. `null` means unknown and `"0"` means an explicit known zero.
- No rule values or formulas live here. Phases and paths hold nullable rulebook-version IDs, and Build 9.5 owns
  the rulebook types and the tagged OFF/NONE/not-applicable claim states.
- The integrity checks mirror the SQLite constraints and triggers of migration 6. Rust stays authoritative at write time.

`src/ports/journal-repository.ts` holds the `JournalRepository` port and `RepositoryError`, which are types and one
error class, with no I/O. Each host supplies an adapter: the desktop's adapter calls Tauri, and a Stage 2 adapter
would call its own backend. See [`../data-model.md#repository-port`](../data-model.md#repository-port).

## Money and time wire contract

The current Tauri IPC payloads are unchanged by this package. They are documented in
[`../data-model.md#conventions`](../data-model.md#conventions).

| Concern | Storage (SQLite) | IPC today | Domain primitive |
|---|---|---|---|
| Money | `INTEGER` micro-units (`*_micros`, i64) | Canonical decimal text (`"208.38"`) | `toMicros(text) → bigint \| null`, `microsToDecimal(bigint) → text` |
| Prices, quantities | Canonical decimal text | Canonical decimal text | `canonicalDecimal(text) → text \| null` |
| Micro-units in new JSON fields | n/a | not used yet | `microsToWire(bigint)` / `microsFromWire(text)`: base-10 integer text, because `bigint` cannot be JSON-stringified |
| Instants | UTC ISO 8601 with ms and `Z` | Same. Inputs accept any offset | strings validated by the contracts |
| Trading day | `YYYY-MM-DD` | Same | computed by Rust only (below) |

Money rules, all matching `apps/desktop/src-tauri/src/domain.rs`:

- **Grammar.** Optional sign, digits, at most one point (`5.` and `.5` are allowed). Surrounding Unicode
  whitespace is trimmed; a byte-order mark is not whitespace. No exponents, thousands separators or currency
  symbols. Currency text such as `$(36.00)` is only accepted by the CSV importer, which normalises it first.
- **Canonical text.** No leading zeros, no trailing fractional zeros, no `+`, and `-0` becomes `0`.
- **Rounding.** To 6 decimal places, with a midpoint rounding **away from zero** (`0.0000005 → 1`,
  `-0.0000025 → -3`). This is not banker's rounding.
- **Range.** Micro-units must fit in i64 (`MICROS_MIN`..`MICROS_MAX`, ±9 223 372 036 854.775807). Anything
  outside is rejected (null), never clamped. Formatting a bigint outside the range throws `RangeError`.
- **Precision.** Values must be exactly representable by `rust_decimal`: at most 28 fractional digits once
  trailing zeros are removed, and a mantissa below 2^96.
  - **Documented difference:** Rust rounds longer input while parsing. The domain package rejects it instead.
    These cases carry `tsDivergence` in the fixture.
- Money arithmetic uses `bigint` micro-units, never `number`. Build 16 uses exact rational arithmetic for
  ratios and thresholds; canonical rule shares are checked without floating-point conversion.
- Some legacy account/trade input schemas still use `Number(v)` for sign/positive feedback. Build 15.5 removes that check from ledger amounts in favor of the existing exact money primitives. New financial evidence requires canonical exact micro-units; Rust re-validates every write.

Time rules: instants cross boundaries as UTC ISO 8601 strings with an offset. A trading day comes from three
separate inputs: an instant, the account's IANA `timezone`, and a wall-clock `tradingDayResetTime`. The reset is
`00:00`, or a time from `12:00` to `23:59` that opens the next day's session. Saturday and Sunday roll to Monday,
and DST comes from the tz database. See [`../data-model.md#trading-day`](../data-model.md#trading-day). The
calculation stays in Rust for now. Domain code must take "now" and the zone as arguments and never read the
clock.

Absent data is never coerced into a value. `null` in a DTO means *unknown* (for example `realizedPnl` with
`pnlStatus` `open`, `missing_instrument` or `currency_mismatch`), which is different from `"0"`. `reportedPnl`
(from the broker) and `grossPnl`/`realizedPnl` (gross − fees) are separate fields.

## Parity fixtures

Authority is split (TASK-003, Option A; [the Build 16 handoff](../handoffs/build-16.md),
`src-tauri/src/store/risk_promotion.rs:1-15`). Rust is authoritative for inputs, trade economics, trading days and
persistence. The TypeScript risk engine (`packages/domain/src/engine`) is authoritative for risk verdicts: the
status and figures stored in risk snapshots. Rust checks that a stored result is consistent and that its sources
are unchanged, but has no second verdict implementation. The engine's arithmetic is pinned by the Rust-generated
`engine-math.json`; `engine-contract.json` is TypeScript-generated engine output that the native persistence tests
store and read back, not an independent Rust result. Any other calculation moves to TypeScript only with golden
fixtures that both implementations run.

- `packages/domain/test/fixtures/*.json` is language-neutral. **Humans write the inputs. Expected outputs are
  generated by code, never typed by hand: by Rust tests, except `engine-contract.json`.**
  - `apps/desktop/src-tauri/src/parity.rs`: `money.json`, `trade-contract.json` and `insights-metrics.json`.
  - Other Rust tests under `apps/desktop/src-tauri/src`: `engine-math.json` (`store/engine_snapshot_tests.rs:218-220`),
    `data-controls-wire.json` (`data_controls/wire_tests.rs:89-90`), `reconciliation.json`
    (`store/evidence_tests.rs:453-454`) and `rulebook-legacy-conversion.json` (`db/legacy_rulebook_tests.rs:224-226`,
    refreshed with `UPDATE_GOLDEN=1`, not `FUNDEDFLOW_UPDATE_FIXTURES`).
  - TypeScript: `engine-contract.json`, by `packages/domain/scripts/generate-engine-contract-fixture.mjs`
    (`npm run fixtures:engine -w @fundedflow/domain`). Rust reads it but does not compute it.
  - `catalogue.json` and `rulebook.json` are human-written contract fixtures with no generated outputs.
  - `cargo test` fails if a stored output no longer matches Rust.
  - To accept an intentional Rust change, run `FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --lib parity` under
    `apps/desktop/src-tauri` and review the diff. That refreshes the `parity.rs` files and also `reconciliation.json`,
    because its test (`store/evidence_tests.rs`, `reconciliation_parity_fixture`) matches the `parity` filter. The
    other Rust generators rewrite their file when their own test runs with the variable set (to any value), so
    keep it unset otherwise.
- Vitest (`packages/domain/test`) runs the same files against the TypeScript code.
- Kinds of equivalence:
  - **Byte-for-byte wire equality** for DTOs: `trade-contract.json` holds the exact serde JSON. The Zod schemas
    must re-serialise it unchanged.
  - **Exact value equality** for primitives: `money.json`, compared as strings and bigints with no tolerance.
  - **Documented differences** carry a `tsDivergence` reason.

`apps/desktop/src/test/fixtures/command-wire.json` is a **wire-contract fixture** (kept with the desktop, which is
its only reader): every read command's JSON payload, recorded by
`src-tauri/src/wire_contract.rs` for a fresh journal and for the v3/v4 journals after upgrade (generated ids and
run-time timestamps replaced with placeholders). `cargo test` fails when Rust output changes without regenerating it
(`FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --lib wire_contract`), and the desktop test
`features/shared/wire-contract.test.ts` runs every payload through the Tauri adapter and the Build 14 read operations.

`catalogue.json` is a **contract fixture**, not a parity fixture. It holds synthetic, human-written catalogue
records: providers through promotions, account links and phase events. Vitest checks that they parse unchanged
and form a consistent graph. It has no Rust-generated outputs. `parity.rs` round-trips the file through the Rust
serde structs (`src-tauri/src/catalogue.rs`), and `db/catalogue_tests.rs` round-trips it through the SQLite tables;
Rust owns any outputs added to it later.

The pilot covers decimal ↔ micro-unit conversion (`money.json`) and the Account/Trade DTO contract
(`trade-contract.json`). The trade cases cover ES/MES/MNQ root resolution, long/short, fees, open trades, the
reported-P&L fallback, missing instrument, currency mismatch, the weekend roll and a midnight reset.

**Still Rust-only**, each moving later under its owning card with its own fixtures: trade validation, instrument
resolution, realized P&L, trading-day derivation (Build 16), CSV parsing/date detection/row warnings and dedup
keys (Build 17), and persistence (SQLite behind the `JournalRepository` port; see Build 10 in `data-model.md`).

**When parity fails:**

1. Keep the desktop caller on Rust.
2. Commit the failing fixture case, with a `note` explaining the mismatch.
3. Route the fix to the card that owns the behaviour.

Never change economics, rounding or dedup identity as a side effect of moving code.

## Troubleshooting

- **`Cannot find module '@fundedflow/domain'` or missing types in desktop:** `dist` has not been built. Run
  `npm run build -w @fundedflow/domain`, or any root script, since they build it first.
- **Lockfile drift:** there is one lockfile, at the root. Run `npm install` at the root, never inside a
  workspace, and commit `package-lock.json`. CI uses `npm ci`.
- **Domain edits not visible in the app:** start through `npm run dev`/`npm run tauri dev`, which runs the watch
  plugin, or run `npm run dev:domain` next to another Vite process.

## Financial evidence (Build 15.5)

`src/risk` exports canonical AccountRiskInputs, source observations, ledger revisions, deterministic reconciliation and rule-evidence prerequisites. It reuses existing account/trade/catalogue/rulebook schemas and money primitives. Rust remains authoritative for persisted trade economics and writes; risk verdicts come from the Build 16 TypeScript engine (see [Parity fixtures](#parity-fixtures)). Shared reconciliation outputs are pinned to the Rust-generated `reconciliation.json` (`store/evidence_tests.rs`); no React or provider rules engine is added. See [the API/Build 16 handoff](../handoffs/build-15-5.md).

## Insights module (Build 23)

`src/insights` holds the versioned Insights contracts (`insightsDatasetSchema`, `InsightsFilter`,
`INSIGHTS_CONTRACT_VERSION`, `INSIGHTS_SELECTOR_VERSION`), the canonical included-trade selector (`selectTrades`), the
metric engine (`summarize`, `Metric` states `value` / `na` / `insufficient` / `unavailable` with stable codes) and the
group helpers (periods, weekday, strategy, tag, symbol, side, source, closed-trade curve, attempt comparison, cohort,
reported reasons). Money is bigint micro-units of Rust-stored values; dates are integer calendar arithmetic on trading-day
keys (no `Date`, clock or locale).

These are new calculations in TypeScript, so they carry a parity fixture: `test/fixtures/insights-metrics.json`
(human-written trades, **Rust-generated** summaries from `src-tauri/src/insights.rs` via `parity.rs`). The `JournalRepository`
port gains `insights.dataset(query)`; the desktop adapter calls `get_insights_dataset`.
