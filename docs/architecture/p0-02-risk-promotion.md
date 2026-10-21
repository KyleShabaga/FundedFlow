# P0-02: atomic promotion of the current risk result

Card: [P0-02 Make current risk calculation promotion atomic](https://app.notion.com/p/4001bd4b6bde8159867accec3e2e7daa).
Branch `fix/p0-02-atomic-risk-promotion`.

- Starting SHA: `7a86871b546b5146899e656fddc28c2ffb88fa24` (main, PR #56 merged).
- Tested SHA: `30bff2d93b9a1c7460be804384b3344ecdd17989` (all code and tests). Later commits change documentation only.

Evidence classes: **native** (Rust tests on in-memory and file-backed SQLite journals, `src/store/risk_promotion_tests.rs`),
**jsdom** (Vitest + Testing Library over the real `<App />`, fakes only at the repository boundary). Nothing here is
packaged-app or manual acceptance.

## 1. Defect

Before this change, the desktop read a calculation's sources through several separate commands (risk inputs,
reconciliation reviews and resolutions, stored snapshots for prior breaches). It then evaluated them in TypeScript and
saved the result with `save_account_snapshot`. Today treated the newest stored snapshot as current. Nothing tied the
saved row to the records it was computed from:

- a trade, import, correction, checkpoint, ledger change, reconciliation, assignment, phase or attempt change landing
  between the reads, or between the reads and the save, produced a row computed from records that no longer
  existed. It was then shown as the current result;
- the reads themselves were not one database state, so one calculation could mix records from before and after a
  write;
- a slow calculation that finished after a newer one replaced it as "latest", including one that had not seen a newer
  Stop. That erased breach evidence from what the next calculation carried forward.

The regression `apps/desktop/src/lib/data/risk-promotion.test.ts` (commit `1701617`) reproduces this. It fails on the
base and passes now.

## 2. Model

Three things are kept apart:

| Concept | Where | Meaning |
|---|---|---|
| Stored calculation | `account_snapshots` (unchanged) | Immutable history, whatever it was computed from |
| Sources unchanged for its cutoff | computed on read | The sources re-read now, for the calculation's own `asOf` and coverage statement, are exactly what it froze |
| Current result | newest `risk_promotions` row per account (migration 21) | The calculation the product presents as current. It is eligible only while its sources are unchanged; every read rechecks |

### Capture (one database state)

`capture_account_risk(query)` → `RiskCapture { inputs, reconciliationRevisionIds, priorBreaches, sourceFingerprint }`.
`store::risk_promotion::capture_in` is the **single definition of what a calculation depends on**. It runs inside one
read transaction, and its first read fixes the WAL snapshot, so a write committed meanwhile through another connection
is wholly absent rather than half-present. It reads:

- `inputs`: what `get_account_risk_inputs` returns: account, assignments, applicable rulebook and versions, catalogue
  link, phase history, trades, observations, ledger and ledger history. Unresolved reconciliation reviews are added to
  `missingInputs` as `reconciliation_review:{id}:{status}`, using the latest non-superseded review per checkpoint up
  to the cutoff. This rule moved natively from the desktop loader without change.
- `reconciliationRevisionIds`: every reconciliation review and resolution id of the account, in UTF-16 order.
- `priorBreaches`: continuing breaches from the account's stored engine calculations. Newest first by trading day,
  then `calculated_at`, then id; the first per assignment and rule wins. This is a straight port of the former
  desktop `priorBreachesFrom`.
- `sourceFingerprint`: sha256 of `canonical_engine_json({inputs, reconciliationRevisionIds, priorBreaches})`.
  Keys and arrays are sorted in UTF-16 order, identical to the TypeScript `canonicalEngineJson`.

The desktop evaluates exactly that capture. `calculateAndSaveRisk` replaces the policy's revision ids and prior breaches
with the captured ones, so the engine freezes them into `explanation.policy`. The frozen inputs and policy are what
promotion later compares. The cross-language contract is proven on real native payloads:
`risk-promotion-wire.test.ts` checks that canonical(frozen) equals canonical(capture), and `calculate-risk.test.ts`
checks that parsing native inputs with zod changes nothing.

### Atomic compare-and-promote

`promote_account_risk(input)` either does all of the following in one `BEGIN IMMEDIATE` transaction or writes nothing:

1. It validates the snapshot exactly as `save_account_snapshot` does (`snapshots::prepare`). It requires an engine
   calculation (`fundedflow-risk/…`) whose explanation freezes inputs and policy for the same account, and an active
   account.
2. It re-captures the sources for the calculation's own frozen query and compares the fingerprint of what it froze
   with what is there now. A difference is `Conflict` ("the records this calculation used changed before it was saved;
   nothing was saved").
3. It applies the ordering rule below. A violation is also `Conflict`.
4. It inserts the snapshot, through the same EOD-idempotent path as a history save, and its `risk_promotions` row, then
   commits.

`IMMEDIATE` takes the write lock before the comparison, so no writer on any connection can commit between the
comparison and the commit (`a_source_write_cannot_land_between_the_comparison_and_the_commit`). Any error before
commit rolls back both rows (`a_failed_promotion_rolls_back_the_calculation_and_the_promotion`).

### Promotion cannot invalidate itself

Promotion writes a snapshot, and stored snapshots are a source: prior breaches. Every eligibility check therefore
re-captures with `exclude = the calculation itself`, so a calculation never counts its own breaches as prior history.
The test `a_calculation_read_before_a_new_stop_cannot_replace_it` shows that a promoted Stop stays eligible.
Any *other* new calculation can change prior breaches. That is deliberate: a newly recorded breach is new history and
invalidates older captures.

### Ordering rule (out-of-order completion)

Each promotion carries the sources it verified, so a newer write always wins through step 2. Among promotions whose
sources all verify:

- If the current result is still eligible and its cutoff (`asOf`) is **later** than the new calculation's, the new one
  is refused (`Conflict`: "a calculation with a later cutoff is current").
- At an equal cutoff with the same verified sources, the later commit wins. The two are equivalent by construction.
- If the current result is no longer eligible, a verified calculation may replace it even with an earlier cutoff.
  It is the only one consistent with the records.

Breach evidence cannot be erased. A calculation captured before a Stop was stored has a different `priorBreaches`,
so it fails step 2. A Stop that is later superseded by a new calculation is still carried forward through that
calculation's prior breaches. Tests: `an_older_calculation_cannot_displace_a_newer_cutoff_on_the_same_sources` and
`a_calculation_read_before_a_new_stop_cannot_replace_it`.

### Reading the current result

`get_current_account_risk(accountId)` → `{ snapshot, promotedAt, sourcesUnchanged }`. It reads from one database state
and rechecks eligibility natively. `get_account_snapshot_freshness(snapshotId)` runs the same check for any stored
calculation. Pre-engine rows return `null`. A frozen statement that no longer validates returns `false`; it can't be
confirmed.

## 3. Mutation-to-invalidation matrix

Every row is exercised through its real native writer. The test is
`each_mutation_family_after_capture_rejects_promotion_and_invalidates_the_current_result`. For each row it asserts:

- a capture taken before the write is refused (`Conflict`), and the refusal stores nothing;
- the promoted result stays the account's newest promotion but reads `sourcesUnchanged = false`;
- a second account's result is untouched, except where the record is shared;
- a deliberate new calculation promotes again.

| # | Mutation family | Native writer | Captured through | Reaches other accounts |
|---|---|---|---|---|
| 1 | Manual trade create | `trades::create` | `inputs.trades` | no |
| 2 | Manual trade edit (incl. notes) | `trades::update` | `inputs.trades[*]` (fields, `updatedAt`) | no |
| 3 | Trade delete | `trades::delete` | `inputs.trades` | no |
| 4 | Trade restore | `trades::restore_deleted` | `inputs.trades` | no |
| 5 | CSV import | `csv_import::commit_reviewed` | `inputs.trades` | no |
| 6 | Checkpoint create | `evidence::create` | `inputs.observations` | no |
| 7 | Checkpoint correction (supersession) | `evidence::correct` | `inputs.observations` (+ reconciliation marker selection) | no |
| 8 | Ledger movement | `ledger::create` | `inputs.ledger` | no |
| 9 | Ledger correction | `ledger::update_with_metadata` | `inputs.ledger`, `inputs.ledgerHistory` | no |
| 10 | Ledger removal | `ledger::delete_with_metadata` | `inputs.ledger`, `inputs.ledgerHistory` | no |
| 11 | Reconciliation review | `reconciliation::create` | `reconciliationRevisionIds`, `missingInputs` | no |
| 12 | Comparison resolution | `reconciliation::resolve` | `reconciliationRevisionIds` | no |
| 13 | Rulebook assignment | `rulebooks::assign` | `inputs.assignments`, `applicableAssignment` | no |
| 14 | Applicable version claim (shared version) | `rulebooks::flag_conflict` on a shared version | `inputs.rulebookVersions`, `applicableRulebook` | **yes**: every account using the version |
| 15 | Account financial, zone or reset configuration | `accounts::update` | `inputs.account` | no |
| 16 | Account lifecycle (status, attempt, archive/restore) | `accounts::change_status` (also archive/restore) | `inputs.account` | no |
| 17 | Phase event | `catalogue::record_phase_event` | `inputs.phaseHistory` | no |
| 18 | Calculation history (a new breach) | any stored engine calculation (`snapshots::save` in the test; `promote_account_risk` too) | `priorBreaches` | no |

**Not sources**, and they do not invalidate (`non_risk_records_and_failed_writes_do_not_invalidate`): journal entries,
trade and daily reviews, screenshots, the review library, and settings. A **failed** write of any kind also changes
nothing.

**Deliberate over-invalidation:** everything in the frozen inputs counts, including descriptive fields such as account
name and notes, trade notes, and `updatedAt`. Excluding them would require a second, hand-maintained definition of
"risk-relevant", which is exactly the drift P0-02 removes. The cost is one deliberate recalculation after a cosmetic
edit.

**ABA:** the comparison is on content, and that content includes revision history: `updatedAt`, supersession chains
and ledger history. A change and its reversal is therefore new history, not the same state
(`changes_that_are_reversed_still_count_as_new_history`). Only a byte-identical source state, such as the same journal,
verifies.

**Extension rule for future writers:** a new record that a calculation should depend on must be read inside
`capture_in`, either directly or through `risk_inputs_in`. That is the whole obligation: invalidation, promotion and
eligibility follow with no per-writer bookkeeping. A writer whose records are not read there cannot affect a
calculation, and must not.

## 4. Failure semantics and P0-03

| Outcome | Native | Desktop |
|---|---|---|
| Promoted | snapshot + promotion committed | success; Today and history refresh |
| Sources changed / later cutoff current | `Conflict`, nothing written | `FeatureDataError` kind `conflict`: a **definite** refusal. Not an uncertain lock; the trader's statements (fees, coverage) are kept; reads refresh (`refreshOn: ["conflict"]`); no automatic retry. Shows "Not saved: the records changed" |
| Validation (not an engine calculation, archived account, …) | `Validation`, nothing written | definite error, as before |
| Lost answer (I/O, timeout) | unknown | the existing P0-03 uncertain-outcome flow (`submissions.ts`, `UncertainOutcomeReview`), unchanged. Its review now labels each stored calculation as "stored, not the current result", "the current result (its records are unchanged)" or "the current result, but its records have changed since", so being stored is not mistaken for being current |

Journeys: `apps/desktop/src/journeys/risk-promotion.journey.test.tsx`. The P0-03 journey
`uncertain-writes-p0.journey.test.tsx` now drives `snapshots.promote`.

## 5. Legacy, migration and archive

- **Migration 21** (`0021_risk_promotions.sql`) is additive. It creates `risk_promotions` and backfills nothing.
  Triggers refuse a promotion of another account's calculation, any update, and any delete while the account exists;
  account deletion cascades. The test is `a_populated_v20_journal_upgrades_without_promoting_its_history`.
- **Legacy save path:** `save_account_snapshot` still stores history and validates as before (EOD idempotent), but it
  never makes a row current. A legacy, tampered or forged engine payload cannot be promoted. Test:
  `history_saves_never_become_current_and_eod_rows_stay_idempotent`.
- **Calculations saved before this version** remain readable history. If no promotion exists, Today shows the newest
  stored calculation as **stale** with the reason `not-promoted`: "It was stored without being confirmed as the current
  result against the records." A Stop stays Stop, and its breach is still carried forward natively.
- **Archive:** an archived account promotes nothing. Its current result stays readable but reads not eligible, because
  archiving changes `inputs.account`. **Restore** also changes the account (`updatedAt`), so a deliberate new
  calculation is needed after restoring.
- **Whole-journal restore or replacement:** promotions live in the same file as their sources and are rechecked on read.
  A calculation captured from a different journal with the same ids never promotes
  (`a_calculation_of_another_journal_never_promotes`). The fingerprint is bound to content, not ids.

## 6. Test evidence (tested SHA `30bff2d`)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | pass: domain 496 / 16 files; desktop 794 / 60 files |
| `npm run build` | pass |
| `npm run check` | pass (domain boundaries, dist 302 exports) |
| `cargo clippy --locked --all-targets -- -D warnings` | pass |
| `cargo test --locked` | 326 passed, 2 ignored, **4 failed**: the `db::legacy_rulebook_tests` failures below, identical on base `7a86871` |
| `git diff --check` | clean with `core.whitespace=cr-at-eol` (see below) |

**Pre-existing, not P0-02**, reproduced on the base:

- `cargo test`: the same 4 `db::legacy_rulebook_tests` failures (`assignment_intervals_follow_effective_from_and_contain_their_snapshots`,
  `legacy_parameters_use_only_the_keys_the_matrix_maps`, `rule_keys_are_unique_per_version`,
  `the_legacy_rules_fixture_covers_every_matrix_case`).
- `cargo fmt --check`: the base has 1183 diff hunks across 38 files; the crate is not rustfmt-formatted. The new files
  (`risk_promotion.rs`, `risk_promotion_tests.rs`) are formatted. The 8 new hunks are new lines in `commands.rs`,
  `snapshots.rs` and `evidence.rs`, written in those files' existing style. No file was reformatted.
- `db/mod.rs`, `db/rulebook_tests.rs` and `store/snapshots.rs` use CRLF on the base. Their edits keep CRLF, so a plain
  `git diff --check` reports CR at end of line, as for earlier commits to those files.

## 7. Remaining gates

- Windows CI on the PR.
- A packaged/native smoke run on an isolated profile: calculate, record a trade during a calculation, observe the
  refusal, recalculate.
- Owner review of the product decisions in §2–§5: over-invalidation on descriptive edits, and history shown as
  `not-promoted` stale after upgrade.
