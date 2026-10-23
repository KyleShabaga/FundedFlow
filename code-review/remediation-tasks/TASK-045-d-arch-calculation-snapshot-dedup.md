# TASK-045 — D-ARCH / ISSUE-002c: risk calculation snapshots stop duplicating the full trade list (frozen-input redesign)

| Field | Value |
|---|---|
| Status | Ready for Approval (r2) |
| Type | Fix (storage redesign + schema migration) |
| Audit priority | **P0** (Kyle escalated ISSUE-002 on 2026-10-22 after the TASK-010 r2 measurement; `code-review/RESUME-execution-state.md:28`) |
| Roadmap lane | Unassigned (owner). V1 or V1.1 is owner decision OD-3 below |
| Mandatory gate | No as drafted. It becomes a TASK-029 prerequisite only if Kyle chooses V1 (OD-3) |
| Severity | High. Export, the only backup path, fails in ordinary use within 12 months. Restore-over, erase and account deletion share the same caps |
| Confidence | High for the code facts and the measured growth. The design choices marked OD-n are Kyle's |
| Canonical issue | ISSUE-002 part c ("revisit frozen trade copies"), D-ARCH (see `code-review/remediation-findings-ledger.md:38`; `code-review/07-stage2-priorities-and-dependencies.md:76, 159-162`). Planning constraints B2-1, B2-2 and B2-3 (07 §F.1–F.3, `:233-246`) |
| Original Stage 1 finding IDs | DATA-004 (F-02) |
| Source card / date | TASK-010 r2 result, 2026-10-22 (`code-review/execution/task-010-journal-growth-results.md`). Runbook trigger: "A TASK-010 result showing 64 MiB reachable within 12 months: escalate ISSUE-002 to P0 and create the D-ARCH task" (`10-stage2-approval-and-execution-runbook.md:122`). TASK-010 acceptance criterion (`remediation-tasks/TASK-010-verify-journal-growth.md:54`) |
| Wave | W3, after TASK-042 merges (migration order 0022 → 0023). If V1 (OD-3), it merges before TASK-029 freezes the candidate SHA, so that TASK-034's owner run exercises migration 0023 |
| Effort / risk | L / High: new tables, a migration that rewrites data, a storage codec on the risk-promotion read path, and archive and wire fixtures |
| Verification platform | Any OS |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`. `features/`, `lib/`, `journeys/` and `design-system/` are under `apps/desktop/src/` unless written in full. `engine/` is `packages/domain/src/engine/` |
| Inspected source revision | origin/main 7f2321e (includes TASK-013 #118 and TASK-014 #119). TASK-010 measured at cfaefb9; TASK-014 does not touch the snapshot path |
| Specification revision | r2 (2026-10-22; r1 plus independent-review fixes) |
| Execution log | `code-review/11-remediation-execution-log.md`, created by the first task executed after approval (template in 08 index §I). Every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 7f2321e. Tested source SHA: to be recorded at execution |
| Approval evidence | — (none). Requires Kyle's explicit approval of this task ID and specification revision, and his answers to OD-1 to OD-7 |

## Purpose / risk
Every engine calculation stores a complete canonical copy of every source record of its account in `account_snapshots.explanation_json`. That covers all trades, observations, ledger entries and revisions, phase history, assignments and rulebook versions.

TASK-010 measured the cost per calculation at about 570 bytes per trade in `explanation_json`, and about 646 bytes per trade in the export's `data.json`. At 2,000 trades, `data.json` passes the 64 MiB entry cap after about 49 calculations. Export then fails, and export is the only backup. Growth is linear in N × K (trades × calculations). Snapshots are immutable, so nothing is ever deleted and the journal only grows.

This task changes how a calculation is **stored**, not what a calculation **is**:
- Each saved calculation still records exactly what it used, as of when it was calculated.
- Rust still owns the stored bytes.
- The command DTO (`Snapshot.explanation`) does not change. Neither does any fingerprint or inputs hash.

The target is per-calculation growth that does not depend on N.

## Trigger / reproduction
The TASK-010 r2 harness seeds a stress journal, tops one account up to N trades, and runs K calculations through `risk_promotion::capture` and `risk_promotion::promote` (results file, "Commands" and "Measurements"):

| N | K | `explanation_json` total | `data.json` |
|---|---|---|---|
| 500 | 50 | 14,357,550 | 18,754,940 |
| 2,000 | 1 | 1,133,651 | 4,973,605 |
| 2,000 | 50 | 56,682,550 | **68,321,565 (> 64 MiB)** |

The same file extrapolates the time to the cap at one calculation per trading day:
- about 10.6 months at 4 trades a day;
- about 4.7 months at 20 trades a day.

**The harness under-measures.** This finding comes from reading the code; it was not measured. The harness payload (`src-tauri/src/store/risk_promotion_tests.rs:191-228`) has no result-level `sourceReferences`, and the rules it uses carry one reference each. The real engine differs in four ways:
- It builds `references` as `unique([...])` over every reconciliation revision id, every observation id and `sourceReference`, every trade id and `importBatchId`, and every ledger, ledger-revision and phase-event id (`engine/evaluate.ts:793-803`).
- `unique` is `[...new Set(v)].sort()` (`:31`), so `references` is a sorted set.
- That set is stored on the result (`:1081`) and again on every rule outcome, with that rule's claim ids added (`:873-876`).
- Each id is a 36-character UUID (`src-tauri/src/domain.rs:74-76`), so each copy of the list costs about 39 bytes per trade.

Carried breaches add more. Each continuing breach copies its rule's references into the next calculation's `policy.priorBreaches` (`src-tauri/src/store/risk_promotion.rs:130-146`; `lib/data/calculate-risk.ts:44-48`), and that copy is part of the inputs hash.

So a real calculation stores about 570 + 39 × (1 + R) bytes per trade, where R is the number of rules in the assigned rulebook version (every rule gets an outcome, `:863-868`). It adds another 39 bytes per trade for each carried breach. For R = 6 that is about 1.5 times the measured rate. The acceptance criteria therefore measure several payload shapes, not only the TASK-010 one.

## Root cause / evidence (verified at 7f2321e)

**What a calculation captures**
- `risk_inputs_in` returns these keys: `schemaVersion`, `account`, `asOf`, `effectiveTradingDay`, `observations`, `trades` (from `super::trades::list`), `ledger`, `ledgerHistory`, `phaseHistory`, `catalogueLink`, `assignments`, `rulebookVersions`, `applicableAssignment`, `applicableRulebook`, `coverage` and `missingInputs` (`src-tauri/src/store/evidence.rs:238-319`; object built at `:313-317`).
- The lists are not filtered by cutoff; the engine filters them.
- `capture_in` adds unresolved reconciliation reviews as missing inputs, the sorted reconciliation revision ids and the prior breaches, then fingerprints the whole capture (`risk_promotion.rs:73-79, 174-235`).

**How the TS mapper freezes it**
- The mapper builds `explanation: { engine: result, inputs: JSON.parse(canonicalEngineJson(input)), policy: JSON.parse(canonicalEngineJson(policy)), recalculation }` (`engine/snapshot.ts:78-84`).
- `canonicalEngineJson` sorts object keys **and the elements of every array** (`engine/canonical.ts:2-16`).
- So in real payloads, `inputs` and `policy` arrive canonical. The engine result is not canonicalised; its reference arrays are sorted by `unique`.

**How it is stored**
- `insert_prepared` stores the explanation exactly as received: `serde_json::to_string(&input.explanation)` (`src-tauri/src/store/snapshots.rs:337`).
- The column is `explanation_json TEXT NOT NULL CHECK (json_valid(explanation_json))` (`src-tauri/migrations/0015_nullable_engine_snapshots.sql:30`).
- Snapshot rows can be neither updated nor deleted while their account exists (`0015:50-55`). The same holds for `risk_promotions` (`0021_risk_promotions.sql:24-29`).
- `snapshots::save` opens a DEFERRED transaction (`snapshots.rs:185-191`, `conn.transaction()` at `:187`). `promote` opens an IMMEDIATE one (`risk_promotion.rs:341`).
- `validate_engine_payload` runs only at write time, inside `prepare` (`snapshots.rs:267`). No read path re-checks `inputs_hash`.

**Why the frozen copy exists today.** Several readers depend on it:
- **Freshness and promotion** rebuild the query and the fingerprint from the frozen explanation (`frozen`, `risk_promotion.rs:246-263`). They then re-capture and compare (`sources_unchanged_in` at `:266-279`; `promote` at `:343-363`).
- **The ordering rule** reads `explanation["inputs"]["asOf"]` (`:366-368`).
- **The desktop** reads `explanation.engine`, `.policy` and `.inputs.coverage` (`features/rulebooks/api/risk.ts:21-27`). It also uses the frozen `inputs.trades` to list the trades a saved calculation used (`features/today/view-models/today.ts:254-262`).
- **Pre-engine explanations** are shown raw (`features/rulebooks/components/CalculationExplanation.tsx:77, 108`).
- **`prior_breaches`** parses every stored explanation of the account with raw SQL on every capture, freshness check and promotion (`risk_promotion.rs:90-149`; SELECT at `:95-98`). `snapshots::from_row` has no connection (`snapshots.rs:118`).

**Nothing reclaims space.** `freelist_count` stayed at 0 in TASK-010, so TASK-013's used-pages check (`src-tauri/src/data_controls/archive.rs:159-167`) does not help.

**Caps.** This task changes none of them:
- `MAX_ENTRY` = 64 MiB, `MAX_TOTAL` = 256 MiB and `MAX_ENTRIES` = 4096 (`src-tauri/src/data_controls/filesystem.rs:9-11`).
- In `dump`: used pages (`archive.rs:163-167`) and 500,000 rows across all tables (`:176-177`).
- In `export`: `data.json` (`:331-334`).
- Inspection requires the manifest's caps to equal the build's (`:493-502`), so raising a cap is an archive format change. TASK-009 decision 5 keeps archive v1 strict (`remediation-tasks/TASK-009-owner-decision-policy-confirmations.md:43`).

## What must stay frozen per calculation, and why
A saved calculation is immutable history, "whatever it was computed from" (`risk_promotion.rs:3-4`). Its record must keep answering three questions, even after trades are edited, deleted, re-imported or corrected:

1. **What did it use?** The exact canonical inputs: every key listed above, as it was at calculation time. Also the exact policy, including caller statements, reconciliation revision ids and prior breaches. The UI shows "Closed trades the saved calculation used … from the inputs frozen into the snapshot (not today's trades)" (`today.ts:250-253`). An edited trade must still show its old values in an old calculation.
2. **Can its identity be re-proved?**
   - `inputs_hash` must still equal sha256 of the canonical `{engineVersion, input, policy}` (`snapshots.rs:414-419`). Only `prepare` checks this, so the tests need a helper that re-runs the check on decoded rows.
   - The source fingerprint must still equal sha256 of the canonical `{inputs, reconciliationRevisionIds, priorBreaches}` (`risk_promotion.rs:73-79, 257-261`).
3. **What did the engine conclude?** The recorded engine result, including each rule's `sourceReferences`. `prior_breaches` derives later calculations' policy from it (`risk_promotion.rs:119-146`).

The frozen state includes `updatedAt` and descriptive fields, because of ABA and the deliberate over-invalidation rule (`docs/architecture/p0-02-risk-promotion.md:236-244`). A **reference to the live rows is therefore not enough**, because the trade table keeps no full version history. Each record version needs an immutable copy, but not **one copy per calculation**.

## Design options
All options share these constraints:
- The TS engine stays authoritative for verdicts (TASK-003 Option A; `docs/architecture/packages.md:126-133`; `CLAUDE.md:23-25`).
- Rust owns the stored form. TS and the command wire do not change.
- Archive v1 stays strict: `FORMAT` and `VERSION` (`archive.rs:13-14`) and `ArchiveManifest` (`:24-41`) are unchanged.
- `account_snapshots` is not rebuilt.

### Option A: content-addressed record store, with a per-calculation list of hashes
- A per-account `risk_frozen_records(account_id, record_hash, kind, record_json)` stores each distinct record version once.
- `record_hash` = sha256 of `canonical_engine_json(record)` (`snapshots.rs:381-406`).
- Each calculation replaces each input list with the list of its record hashes. Identical large arrays are deduplicated into a per-account blob table.
- **Pro:** simple and lossless.
- **Con:** still linear in N. A calculation stores about 67 bytes per trade, plus about 39 bytes per trade for the reference arrays whenever the record set changed. That is roughly 5 to 8 times smaller than today. The cap moves to roughly c × T ≈ 5,000 (calculations per trading day × trades per year), so heavy users still reach it within a year. **Misses the target.**

### Option B (recommended): versioned frozen-source ledger with generation numbers, and a frozen, verified compact codec

**Record store.** As in Option A: `risk_frozen_records`, per account, one row per distinct record version.

**Membership by generation.**
- A per-account table `risk_frozen_spans(account_id, kind, record_hash, from_generation, to_generation NULL, multiplicity)` records which record versions belong to each list.
- The key is `(account_id, kind, record_hash, from_generation)`. A record version that leaves a list and later returns gets a new span.
- `multiplicity` keeps duplicate elements. Alternatively, any list with duplicate elements falls back to inline storage.
- Generations are per account and only increase.

When a calculation is stored, Rust compares its frozen lists with the account's open spans:
- If they are identical, the calculation reuses the current generation g, and no rows are added.
- Otherwise Rust opens generation g + 1. It closes the spans of removed or changed versions and opens spans for new ones.

Each calculation then stores one integer per list. Rows are added only for records that changed since the account's latest generation.

Rehydrating list `kind` at generation g:
1. Select the spans where `from_generation ≤ g` and `to_generation` is NULL or greater than g.
2. Join the records and expand each by `multiplicity`.
3. Sort by canonical string, in UTF-16 order, the same as `canonicalEngineJson` and `canonical_engine_json`.

This reproduces the canonical array the TS mapper froze (`snapshot.ts:80`). Small lists and scalars (`missingInputs`, `coverage`, `account` and the like) stay inline.

**Engine reference arrays**, derived from the decoded inputs and policy:
- **Result level** (`engine.sourceReferences`): stored as a marker meaning `sorted(set(policy.reconciliationRevisionIds ∪ observations.{id, sourceReference} ∪ trades.{id, importBatchId} ∪ ledger.id ∪ ledgerHistory.id ∪ phaseHistory.id))` at generation g. The sort is UTF-16 order, matching `unique`; see `evaluate.ts:31, 793-803`. The marker adds no data.
- **Rule level** (`engine.rules[i].sourceReferences`):
  - The base is `sorted(set(result set ∪ the rule's claims' {id, sourceId}))` (`:873-876`). The claims come from `inputs.rulebookVersions` for that rule's `ruleId`.
  - After the base comes an **ordered tail that may contain duplicates**, from pushes made after the sort: the drawdown history observation ids (`:426-438, 516`) and the profit-target rule id (`:695`).
  - The tail is encoded as a filter over generation g's decoded observations, mirroring `:429-437`. If that does not round-trip, it is encoded as a list of indexes into the derived set (about 4 bytes per entry, instead of a 39-byte id).
  - The tail grows with observation history, not with N. Shape (iv) below bounds it.
- **Policy breach pointers** (`policy.priorBreaches[i].sourceReferences`): stored as a pointer to (source snapshot id, `ruleId`). The rule key alone is not enough, because two rules can share a key (`:863-867`). Decoding reads that rule's decoded references and re-sorts them canonically, because `policy` is frozen canonically.

**Verify, then write, losslessly.** Before writing, Rust checks that `decode(encode(explanation)) == explanation`, comparing `serde_json::Value`s. Any subtree that does not round-trip is stored inline, or in the blob table deduplicated by hash. So the codec can never change what is recorded; at worst it saves less.

One case must fall back by design: a caller payload whose `inputs` are not canonical. TASK-010's harness payload is one, since `cap.inputs` is stored as captured (`risk_promotion_tests.rs:192, 225`). Pre-P0-02 or third-party `save_account_snapshot` payloads may be others. A test covers that case explicitly.

**Fallback count** is the number of lists or subtrees whose derivable encoding did not round-trip and were therefore stored inline or as a blob.

**Residual: not yet proven on real TS output.** The savings from the tail and breach-pointer encodings are not proven on real TS output. `engine-contract.json` has no drawdown tail and no breach, so only the Rust-synthesised shapes (ii) and (iv) exercise those encodings. To cover this:
- Record the codec fallback count in TASK-034's owner run, and log fallbacks at runtime: a count per write, no record content.
- Optionally, add a new TS-generated case with a breach and a drawdown history, in its own fixture file. That file would need its own named, approved generation command. `engine-contract.json` is not touched.

**Frozen format.**
- The codec is a versioned module, `frozen-v1`, with its storage marker key, for example `"$ff":"frozen-v1"`.
- Once shipped, its encoder and decoder never change: migration 0023 calls this same module, and shipped migrations are never edited (`src-tauri/src/db/mod.rs:37`). A golden test pins the exact encoded bytes.
- A future format gets a new marker and module. Decoders for old markers stay.

**Where the codec runs**
- Encoding happens in `insert_prepared`, after `prepare` has validated the full payload.
- Decoding is `decode(conn, raw_row)`, called after the row read in `get`, `list` and `latest`. `from_row` stays connection-free.
- `prior_breaches` decodes lazily: it parses each row's compact `engine` and rehydrates references only for the first-seen breached rule per (assignment, rule key), exactly the rows it emits. A capture therefore never rehydrates K × N. The lazy path must still settle `refs.is_empty()` exactly, and before `seen.insert` (`risk_promotion.rs:138-141`), because a derived set can be empty. Otherwise an empty-reference breach would wrongly claim its (assignment, rule) slot.
- Only rows whose `engine_version` starts with `fundedflow-risk/` and that passed `validate_engine_payload` are encoded. Pre-engine and caller-supplied rows are stored and read as now.

**Concurrency.**
- `snapshots::save` changes to `TransactionBehavior::Immediate`, because span reads and generation allocation must not race.
- A stale or caller-supplied payload saved through `save_account_snapshot` (`src-tauri/src/commands.rs:447-448`) can move the generation back and forth: stale, fresh, stale. Each move adds spans in proportion to the difference. **The bounded-growth target does not hold for such saves.** A test covers alternating stale and fresh saves for correctness and records their growth.

**Pros**
- Per-calculation growth is a bounded constant when sources are unchanged. Otherwise it is that constant plus the changed records.
- Decoding reproduces the exact `Value`, so `inputs_hash`, fingerprints, freshness and `prior_breaches` are unchanged by construction (B2-2).
- The DTO is unchanged, so TS, the desktop and the engine are untouched.

**Cons**
- It is the largest change: three tables, a frozen codec, and a migration that rewrites data (OD-2, OD-7).
- Reads join and sort the account's spans: O(record versions) per decode.
- `data.json` becomes less self-describing (OD-4).

### Option C: retention or pruning of stored calculations
- Keep only some calculations, for example promoted, end-of-day, and the last M per account. Or strip `inputs` from older calculations that are not current.
- **Pro:** a small code change that bounds the total size.
- **Cons:**
  - It breaks immutable history (`risk_promotion.rs:3-4`; triggers `0015:50-55` and `0021:24-29`).
  - Stripped calculations can no longer show the trades they used, re-prove their hash, or report freshness.
  - Pruning engine results changes `prior_breaches`, and with them later fingerprints (B2-2).
  - It deletes user history.
- At most, a later safety net.

### Rejected alternative: compress `explanation_json`
Compression saves 5 to 10 times, but growth stays N × K. It also needs a BLOB column on a STRICT table: either a rebuild (B2-3) or a parallel column. And `data.json` would carry opaque bytes.

### Recommendation
**Option B, with OD-2 = compact existing rows, OD-7(1) and OD-7(2) approved, and no Option C.**
- B is the only option that meets the bounded-growth target. It keeps every calculation fully explainable, and it lets a journal that is already over the cap export again after the upgrade.
- Option A is the fallback if review finds B's codec too risky. It must then come with a residual Kyle accepts: ISSUE-002 stays open at P1.

## Owner decisions (Kyle) vs engineering choices
**Owner decisions.** Each answer is recorded in the execution log before coding.

- **OD-1, option:** B (recommended), A, or C. C means Kyle accepts deleting or stripping stored calculations.
- **OD-2, existing rows:**
  - (a) Compact every eligible stored engine calculation in migration 0023 (recommended). The migration drops the `account_snapshot_no_update` trigger, rewrites the rows, then recreates the trigger with identical SQL. Only (a) lets an already-oversized journal export again.
  - (b) Leave existing rows inline and compact only new ones. No existing bytes change, but journals near the cap stay near it.
- **OD-3, release:**
  - V1: P0, a TASK-029 prerequisite, exercised by TASK-034's owner run.
  - V1.1: Kyle accepts that export can fail for heavy users in V1. TASK-013's message names the component over the cap (`archive.rs:165-166`).
  - Either way, 08 `:108` ("Deferred to V1.1: 002c") is updated. That update is not done here.
- **OD-4, interpretation of strict archive v1 (TASK-009 decision 5).** Confirm three effects:
  - New tables appear in the schema-23 dump and as new `manifest.entities` keys. `FORMAT`, `VERSION` and the manifest structure are unchanged; `risk_promotions` set the precedent.
  - Builds before schema 23 refuse these archives (`archive.rs:495`).
  - **The `explanation_json` cells in `data.json` become compact `frozen-v1` encodings, no longer self-describing.** Understanding a calculation from `data.json` alone then needs the decoding rule. That rule is documented in `docs/data-model.md`, together with the new tables, which are in the same `data.json`. This narrows 07 `:76`'s "keep the data.json byte format" from "self-describing rows" to "a generic dump of the schema".

  The alternative reading is a format bump, which would make this task depend on a v1.1 archive design.
- **OD-5, disk after compaction:**
  - No VACUUM of the live journal (recommended). Used pages and `data.json` shrink; the file keeps its size until a later "Compact journal" action (Triage card).
  - Or VACUUM after 0023.
  - Either way, the upgrade writes a full `fundedflow.db.before-v23.bak` (`db/mod.rs:245-247, 279-297`), which TASK-044's disclosure covers.
- **OD-6, retention:** none here (recommended), or a V1.1 Triage card for an opt-in "remove old calculations" control.
- **OD-7, exceptions to two migration rules for 0023.** B2-3 says new migrations are "`ADD COLUMN` plus index only" (07 `:246`). `db/mod.rs:32-33` says a Rust data step "must be idempotent and change only derived columns". Migration 0023 needs exceptions in two separable parts:
  - **OD-7(1), new tables and triggers.** Needed by Option A and Option B, including under OD-2(b).
  - **OD-7(2), trigger drop and recreate plus rewriting `explanation_json`.** `explanation_json` is not a derived column. This part is needed only for OD-2(a).

  Neither part rebuilds a table, so the B2-3 cascade risk (`DROP TABLE` under `foreign_keys=ON`) does not arise. Kyle approves (1) alone, which forces OD-2(b), or (1) and (2). Each approved exception and its reason are recorded in `docs/data-model.md`'s migrations table.

**Engineering choices.** The implementer decides within the acceptance criteria; the reviewer checks them.
- Table and column names, and the marker key.
- Generation semantics.
- `multiplicity` versus inline fallback for duplicates.
- Details of the tail encoding.
- Whether migration 0023 is one `Step::Rust` that runs the DDL file and then the backfill (precedent: step 16, `db/mod.rs:115-118`), or a SQL step followed by a Rust step.
- Integrity checks in `validate_database` for version ≥ 23 (`archive.rs:584-648`):
  - every span and record belongs to the account of the snapshot that references it;
  - every compact row's generation and breach pointer resolves;
  - each pointer target belongs to the same account and decodes.
- The committed growth harness is mandatory, not optional (step 7).

## Expected change scope
**Rust**
- `src-tauri/migrations/0023_frozen_risk_sources.sql` (new).
- `src-tauri/src/db/mod.rs`: `MIGRATIONS` entry 23, and the backfill if OD-2(a).
- A new module `src-tauri/src/store/frozen_v1.rs` for the codec.
- `src-tauri/src/store/snapshots.rs`:
  - encode in `insert_prepared`;
  - `decode(conn, raw)` after the row read in `get`, `list` and `latest`;
  - `save` uses IMMEDIATE.
- `src-tauri/src/store/risk_promotion.rs`: `prior_breaches` decodes lazily. `frozen`, `sources_unchanged_in` and `promote` keep working on the decoded `Value`.
- `src-tauri/src/data_controls/archive.rs`: `validate_database` checks for version ≥ 23.
- Tests: `store/risk_promotion_tests.rs`, `store/tests.rs`, `db/tests.rs` or a new region of `db/upgrade_tests.rs`, `data_controls/tests.rs`, and a new `store/frozen_v1_tests.rs` with the golden encoding and the harness.

**New tables**
- Each has `account_id REFERENCES accounts(id) ON DELETE CASCADE`.
- Each has a no-delete-while-the-account-exists trigger, as in `0021:27-29`.
- Records are immutable.
- A span's `to_generation` may change only from NULL to a value, once.
- Account deletion and whole-journal erase remove these rows through the existing paths (`data_controls/deletion.rs:70-81`; the preview simulates on a clone at `:173-174`).

**TS: none.**
- Shape (ii) below is synthesised in Rust, so no new TS fixture is needed.
- If a TS change turns out to be needed, the design is wrong: stop and re-review.

**Docs**
- `docs/data-model.md`:
  - the status line (`:3`) and the Snapshots paragraph (`:386-394`);
  - a migrations table row after `:530`, including the approved OD-7 exceptions;
  - the `frozen-v1` decoding rule, for `data.json` readers (OD-4).
- `docs/architecture/p0-02-risk-promotion.md`: a section on how frozen inputs are stored, near `:59-63`.

**Fixtures**
- **Named regeneration** (needs explicit approval at execution; one targeted command): `packages/domain/test/fixtures/data-controls-wire.json`. Its diff is limited to:
  - the new table names appearing as keys in the per-table count maps of the migrated-journal outputs (deletion preview and result, restore preview and result);
  - the `inspect_journal_archive` `requiredFreeBytes` value (TASK-014).

  The export runs on the unmigrated v3 fixture (`data_controls/wire_tests.rs:31-40`), so its manifest is unchanged.
- **Expected unchanged** (any diff stops the PR):
  - `apps/desktop/src/test/fixtures/command-wire.json`, `risk-promotion-wire.json` and `evidence-wire.json`;
  - `packages/domain/test/fixtures/engine-contract.json` (TS-generated by `npm run fixtures:engine -w @fundedflow/domain`; not regenerated) and `engine-math.json`;
  - `test_csvimport/build17/normalization-v1.json`;
  - `src-tauri/src/db/fixtures/*.db`.

## Out of scope
- Raising any archive cap, or changing `FORMAT`, `VERSION` or the manifest (TASK-009 decision 5).
- Changing the TS engine, `ENGINE_VERSION`, `canonicalEngineJson`, `RiskCapture` or any command DTO. For example, an engine emitting a set marker instead of explicit references would simplify the codec; that goes on a Triage card.
- Retention or pruning (OD-6), and VACUUM of the live journal (OD-5).
- `list_account_snapshots` (`commands.rs:452-460`) still returns every decoded explanation, O(K × N) bytes over IPC, the same as today. A summary-list command goes on a Triage card.
- Missing-attachment archive support (the ISSUE-004 export side).
- P2 and Web V2 items.

## Implementation approach
1. **Before branching:**
   - create or link the Notion roadmap card (CLAUDE.md plan of record);
   - branch `feat/build-<n>-<slug>` and link the card in the PR;
   - record Kyle's answers to OD-1 to OD-7 in the execution log.
2. **Check prerequisites.** TASK-043 must be Verified and merged (B2-1), and TASK-042 (0022) merged. Rebase on both.
3. **Baseline.** Run the step 7 harness on the unchanged base SHA, for **all four payload shapes**, at N ∈ {500, 2,000} × K = 50 and N = 2,000 × K = 250.
   - Record `explanation_json`, used bytes, total rows, and capture + promote and `snapshots::list` times.
   - Record `data.json` bytes wherever the export still succeeds. Where the page or `data.json` cap refuses it, record "refused" and keep the used bytes and timings.
   - This gives the before numbers for the performance criterion, and confirms the real-engine shape's per-trade rate.
4. **Migration 0023.**
   - Deterministic DDL: `validate_database` text-compares an upgraded schema with a fresh one (`archive.rs:590-595`; 07 §F.6).
   - If OD-2(a), in the same migration transaction:
     1. Drop `account_snapshot_no_update`.
     2. Stream the rows, one at a time, never loading all explanations.
     3. Re-encode each **eligible** row through `frozen-v1`.
     4. Recreate the trigger, byte-identical to `0015:50-51`.
   - **A row is eligible** when all of these hold:
     - its `engine_version` starts with `fundedflow-risk/`;
     - its explanation parses, and `is_engine` holds;
     - `validate_engine_payload` passes on a `SnapshotInput` rebuilt from the row (micro-units back to decimal text, as `from_row` does);
     - `decode(encode(x)) == x`.

     Other rows stay inline.

     The predicate calls the live `validate_engine_payload`, not a frozen copy. If that check changes after this migration ships, at worst a row stays inline; the round-trip check means no row can be altered.
   - The step is idempotent: it skips compact rows. Its doc comment states that it is the OD-7(2) exception.
5. **Codec.** Write `frozen-v1` with verify-or-fallback, the golden encoded-bytes test, `decode(conn, raw)`, lazy `prior_breaches`, and the IMMEDIATE `save`.
6. **Tests.** Each must fail before the change and pass after, where that applies.
   - **Codec round trip, with DTO equality and fallback count 0:**
     - every case in `engine-contract.json`, which is real TS output with canonical inputs (stored by `src-tauri/src/store/engine_snapshot_tests.rs:12`);
     - shapes (i) to (iv).
   - **Fallback is correct:** a non-canonical caller payload, such as the existing `calc` with `cap.inputs` as captured (`risk_promotion_tests.rs:191-228`), is stored inline and reads back unchanged.
   - **Old values survive edits:** edit a trade after calculation 1, then calculate again. Calculation 1 still decodes the old trade (the `contributingTrades` input), and calculation 2 decodes the new one. A soft-deleted trade stays in the older calculation.
   - **Generation churn:** alternating stale and fresh `save_account_snapshot` calls decode correctly. Growth is recorded; it is not bounded.
   - **Duplicates and re-entry:** a list with duplicate elements, and a record version that leaves a list and returns, both decode exactly.
   - **The P0-02 matrix runs twice:** freshness, the current result and the mutation matrix (`risk_promotion_tests.rs`) run with both the existing non-canonical `calc` (fallback path) and a canonical variant (compact path), with identical outcomes.
   - **Account deletion** removes the account's spans and records, and the preview counts them. Other accounts are untouched.
   - **Integrity:** each of these makes `validate_database` fail:
     - a tampered span;
     - a record from another account;
     - a breach pointer to a missing or foreign snapshot.
7. **Growth harness.** Commit it as an `#[ignore]` test (mandatory), using the TASK-010 method:
   - **Setup:**
     - `seed-demo-journal --preset stress`;
     - top one account up to N trades;
     - run K captures and promotions;
     - checkpoint the WAL.
   - **What it records:**
     - file bytes, `page_count`, `freelist_count` and used bytes;
     - the sum of `explanation_json` lengths;
     - row counts of the new tables, and of all tables;
     - `data.json` bytes (`archive::dump` + `serde_json::to_vec`);
     - capture + promote time and `snapshots::list` time;
     - the codec fallback count.
   - **Runs:** N ∈ {500, 2,000, 10,000} × K ∈ {1, 50}, and N = 2,000 × K = 250.
   - **Payload shapes:**
     - **(i) TASK-010 shape.** The `calc` payload of `risk_promotion_tests.rs:191-228`, **pinned to `breach = false`**, with `inputs` canonicalised as the TS mapper freezes them (`snapshot.ts:80`), i.e. `canonical_engine_json` parsed back. With `calc(.., true)` the rule's references are the constant `[SOURCE]` (`:28, 209`), which cannot be derived and would fall back.
     - **(ii) Real-engine shape, synthesised in Rust.** As (i), with these additions:
       - R = 3 rules in the assigned version, one of them `max_drawdown` with an end-of-day history;
       - result- and rule-level `sourceReferences` built exactly as `evaluate.ts:31, 793-803, 873-876, 1081` and `:516` specify;
       - one breached rule carried into later calculations' `priorBreaches`.

       Metrics, operands and formulas are synthesised as constants, so their lengths do not vary with N.
     - **(iii)** Shape (ii), with one new trade inserted between consecutive calculations.
     - **(iv)** Shape (ii), with one new end-of-day settlement observation inserted between consecutive calculations.
   - **Fast regression in the normal suite:** shape (ii) at N = 50 versus N = 400, K = 10, asserting exact N-independence of explanation bytes and new-table rows.
8. **Upgrade and archive tests:** see the acceptance criteria.
9. **Docs, then the fixture.** Regenerate with one targeted command:
   `FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --offline --locked --lib data_controls::wire_tests::native_data_control_outputs_match_portable_wire_fixture -- --exact`.
   Then unset the variable and run everything. Other fixture tests rewrite their files when the variable has any value (`wire_tests.rs:91`).

## Prerequisites, dependencies and conflicts
**Prerequisites**
- **TASK-043 Verified** (B2-1: "Must precede any new migration"; 07 §F.1, `:233-238`; 08 `:96`). Today, rollback validates the safety copy at `latest_version` (`restore.rs:401`); TASK-043 changes this.
- **TASK-042 merged**, so 0022 exists and this migration is 0023. Versions stay contiguous (`MIGRATIONS[..version]`, `archive.rs:591`). Changing the order needs an explicit renumbering decision. Never ship 0023 without 0022.
- TASK-003 Option A, already decided (`packages.md:126-133`).
- Kyle's answers to OD-1 to OD-7.

**Planning constraints**
- **B2-2:** fingerprints and inputs hashes stay byte-identical (acceptance criteria). TASK-042 strips `feesRecorded` from `risk_inputs_in`, and this task stores whatever that returns.
- **B2-3:** handled by OD-7.

**Blocks** (if OD-3 = V1): TASK-029 and TASK-034's owner run.

**Likely shared-file conflicts**
- `db/mod.rs`, `db/upgrade_tests.rs` and `docs/data-model.md` with TASK-042 and TASK-034. Do not edit `upgrade_copy` (`db/upgrade_tests.rs:441`) or `upgrade_copy_of_a_real_journal` (`:519`).
- `data-controls-wire.json` with TASK-015, TASK-016, TASK-017 and TASK-027 (`producerVersion`). Merge those first, then regenerate.
- `archive.rs` and `restore.rs` with TASK-016 and TASK-017.

**Follow-ups (not done here)**
- Add this task to 08 §A and the 09 waves.
- Update 08 `:108`.
- Update the TASK-013 and TASK-014 priorities.
- Add an entry to the TASK-035 register.
- Open Triage cards: summary-list command, engine set marker, "Compact journal", retention.

## Acceptance criteria (pass/fail)
- [ ] **Owner decisions:** Kyle's answers to OD-1 to OD-7 are recorded in the execution log before coding.
- [ ] **Bounded growth** (TASK-010 method, step 7). Measured as the average per calculation over K = 50, with no source change between calculations unless the shape says otherwise:
  - **Shape (i)** (`breach = false`):
    - At most **8 KiB (8,192 bytes)** of used bytes and at most 8 KiB of `data.json` bytes, at each N ∈ {500, 2,000, 10,000}.
    - Exact N-independence: explanation bytes and new-table rows added per calculation are **identical** at N = 500 and N = 10,000.
    - Used bytes agree across N within 1 KiB (page granularity).
  - **Shape (ii):** at most **16 KiB**, with the same exact N-independence of explanation bytes and new-table rows.
  - **Shape (iii):** at most the shape (ii) value + 4 KiB, independent of N. The new-table rows added per calculation are at most 1 record + 1 span.
  - **Shape (iv):** at most the shape (ii) value + 4 KiB, independent of N. The drawdown tail adds at most 8 bytes per tail entry per calculation, and the fallback count is 0.
  - **All shapes:** codec fallback count 0, as defined under Option B.
  - The baseline (step 3) and the after run are both recorded, with SHA and environment, in TASK-010's table format.
- [ ] **No cap reached.** At N = 2,000 and K = 250 (shape ii):
  - `data.json` and used bytes are each at most 16 MiB. TASK-010 stopped at 160.6 MB for this case.
  - Total rows across all tables are at most 100,000, far below the 500,000-row `dump` cap (`archive.rs:176-177`). The row count is recorded for each run.
- [ ] **Lossless.** For every stored engine calculation in the tests, these are byte-equal before and after the change:
  - the `snapshots::get`, `list` and `latest` DTOs;
  - `inputs_hash`, re-validated by a test helper that runs `validate_engine_payload` on the decoded row, since no read path does;
  - the `frozen()` fingerprint, `sources_unchanged`, the current result, and `prior_breaches` output.

  `command-wire.json` and `risk-promotion-wire.json` are unchanged. The golden `frozen-v1` encoded-bytes test passes.
- [ ] **Old-journal upgrade.** A journal built at schema 22 with calculations of shapes (i) and (ii), plus non-canonical `calc` rows, upgrades to 23. Every DTO, fingerprint, `sources_unchanged` value and current result is unchanged.
  - If OD-2(a): the eligible rows' `explanation_json` shrinks by at least 90% in total, and the non-canonical rows are byte-identical. A schema-22 journal whose `data.json` exceeded 64 MiB (N = 2,000, K = 50, shape i) exports after the upgrade.
  - If OD-2(b): old rows are byte-identical, and new rows are compact.
  - These existing tests still pass at version 23:
    - the v3 and v4 upgrades (`db/upgrade_tests.rs:215, 258`);
    - `reopening_an_upgraded_journal_is_a_no_op` (`:282`);
    - the pre-upgrade backup test (`:298`);
    - the v8 legacy-rules tests (`db/legacy_rulebook_tests.rs:15`; `data_controls/current_schema_tests.rs:301`).
- [ ] **Archive round trip.**
  - A schema-23 export inspects and restores, with DTO equality.
  - Schema-21 and schema-22 archives with inline rows still inspect at their own version (`archive.rs:522`). They also restore, and the candidate is migrated and compacted, with DTO equality.
  - A schema-22 build refuses a schema-23 archive (`archive.rs:495`).
- [ ] **Restore cost.**
  - Restoring a schema-22 archive of the N = 2,000, K = 50 journal runs the backfill twice: at inspect (`restore.rs:117-119`) and at prepare (`:169`).
  - Each run also writes a `before-v23.bak` VACUUM INTO next to its candidate.
  - Both runs succeed within `required_free_bytes` (`restore.rs:77-91`). Peak disk use is at most `required_free_bytes`. It is measured from file sizes, not by sampling OS free space: the total size of the files in the staging and operation folders, including each `-wal` file, taken after each migrate. The time of each run is recorded.
- [ ] **Account deletion and erase:** the preview counts the new tables, and execution removes them. `PRAGMA foreign_key_check` is clean.
- [ ] **Performance.** At N = 2,000 and K = 250, capture + promote time and `snapshots::list` time are each at most 2 times the step 3 baseline on the same machine. Otherwise stop and review.
- [ ] **Fixtures.** Among fixtures, only `data-controls-wire.json` changes, by the one targeted command. Its diff is limited to the new table-count keys and `requiredFreeBytes`, and it is reviewed.
- [ ] **Regression tests:** the new tests fail before the change (record which) and pass after.
- [ ] **Full checks:** full root and Rust checks exit 0. `FUNDEDFLOW_UPDATE_FIXTURES` stays **unset (not `0`)** except for the one targeted regeneration.

## Verification plan
**Targeted**
- `cargo test --offline --locked risk_promotion`, `... snapshots`, `... frozen_v1`, `... upgrade`, `... legacy_rulebook`, `... db::tests`, `... data_controls`, `... wire_contract`, `... parity`, `... engine_snapshot`.
- The harness: `cargo test --offline --locked --lib <harness name> -- --ignored --nocapture`, run on a seed made by `cargo run --offline --locked --example seed-demo-journal -- --data-dir <scratch> --preset stress`, in temporary directories, as in TASK-010.
- Vitest: `src/features/today`, `src/features/rulebooks`, `src/lib/data`. These are unchanged, but must pass on the unchanged DTO.

**Standard checks** (run serially, frontend build before Rust)
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0
- Repository root: `npm run build` → exit 0
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
- Use only disposable journals in temporary directories. Never open, migrate, copy, seed or reset the real `%APPDATA%\com.fundedflow.desktop` journal. The real-copy upgrade run belongs to TASK-034.
- Do not edit shipped migrations 0001–0022, `src-tauri/src/db/fixtures/*.db` or `test_csvimport/*.csv`. Never print values from `test_csvimport/*.csv`.
- Once a build with 0023 opens a journal, the only way back to an older build is `fundedflow.db.before-v23.bak` (07 §F.6).
- With OD-2(a), stored calculations are rewritten. The lossless criterion and the eligibility predicate guard against damage.
- The migration runs in one transaction (`db/mod.rs:222-238`). It needs WAL space about the size of the rewritten rows. A failure leaves the journal at version 22 with its backup intact.

## Definition of done
- Code is merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md, and the diff is reviewed.
- The new regression tests fail before the change and pass after it.
- Every acceptance criterion has recorded evidence (command, directory, exit code), including the before and after growth tables.
- Compiling, or passing unrelated tests, does not count as completion.

## Changes in r1
First revision. Created from the TASK-010 r2 result and Kyle's P0 escalation of 2026-10-22.

## Changes in r2
Independent review of r1 returned CHANGES: 3 blocking, 13 should-fix, 9 nits. All are addressed; every new citation was checked at 7f2321e.

**Blocking**
- **B1:**
  - `references` is a sorted set (`unique` = `[...new Set(v)].sort()`, `evaluate.ts:31`), not construction order.
  - The result-level encoding is now `sorted(set(...))` over generation g.
  - The rule-level encoding is that set ∪ the rule's claim ids, plus an ordered, duplicate-allowing tail (`:516`, `:695`).
  - The `trades.rs:245` and observation-order rationale is removed, and the Out-of-scope bullet is fixed.
- **B2:**
  - Shape (i) now canonicalises `inputs` as the TS mapper does (`snapshot.ts:80`).
  - An explicit non-canonical caller-payload test expects fallback and correctness.
  - The P0-02 matrix runs with both the non-canonical and the canonical payload (step 6).
- **B3:**
  - Shape (ii) is declared Rust-synthesised from `evaluate.ts:31, 793-803, 873-876, 1081, 516`. "TS: none" and the fixture lists stand.
  - The real TS-output round trip uses the existing `engine-contract.json` cases (no breach), which are not regenerated.

**Should-fix**
- **S1:** the drawdown tail is encoded as a filter or as indexes into the derived set. New shape (iv), one new end-of-day observation per calculation, has its own bound.
- **S2:** new **OD-7**: Kyle approves relaxing B2-3 (07 `:246`) and the data-step rule (`db/mod.rs:32-33`) for 0023.
- **S3:** OD-4 now states that `data.json`'s `explanation_json` becomes compact and not self-describing, and that the decoding rule is documented.
- **S4:** the `frozen-v1` codec is frozen, pinned by a golden encoded-bytes test, and future formats get new markers (`db/mod.rs:37`).
- **S5:** `decode(conn, raw)` runs after the row read, because `from_row` has no connection (`snapshots.rs:118`). `prior_breaches` decodes lazily, only for the rules it emits.
- **S6:** `snapshots::save` changes to IMMEDIATE (`:187`). A stale/fresh save churn test was added, and the spec states that the bound does not hold for such saves (`commands.rs:447-448`).
- **S7:** the span key is (account_id, kind, record_hash, from_generation), with `multiplicity` or an inline fallback. A re-entry test was added.
- **S8:** the step 3 baseline now covers N = 2,000 × K = 250 and all shapes. Timings and used bytes are recorded where the export refuses.
- **S9:** total and new-table row counts are recorded. A row criterion was added against the 500,000-row cap (`archive.rs:176-177`).
- **S10:** the breach pointer is now (snapshot id, `ruleId`) (`evaluate.ts:863-867`). Decoding re-sorts canonically, and `validate_database` checks that pointer targets exist, belong to the same account and decode.
- **S11:** a restore-cost criterion was added: the backfill runs twice (`restore.rs:117-119, 169`), plus `before-v23.bak`. Disk peak is measured and must stay within `required_free_bytes` (`:77-91`), and time is recorded.
- **S12:** the backfill streams rows, and the eligibility predicate is stated (`SnapshotInput` rebuilt from the row for `validate_engine_payload`, plus a round-trip check).
- **S13:** N-independence is asserted exactly on explanation bytes and new-table rows. Used bytes allow 1 KiB.

**Nits**
- **N1:** `risk_promotions` triggers cited at `0021:24-29`.
- **N2:** `validate_engine_payload` runs only in `prepare` (`snapshots.rs:267`). The test helper requirement is stated.
- **N3:** all `risk_inputs_in` keys are listed (`evidence.rs:313-317`).
- **N4:** v8 is cited where it is used (`db/legacy_rulebook_tests.rs:15`; `data_controls/current_schema_tests.rs:301`).
- **N5:** the committed `#[ignore]` harness is mandatory.
- **N6:** `db/mod.rs:32-33` cited.
- **N7:** "rollback validates at `latest_version` (`restore.rs:401`); TASK-043 changes this".
- **N8:** R is every rule in the assigned version (`evaluate.ts:863-868`).
- **N9:** step 3 runs all four shapes.

**(re-check)** Wording fixes from the r2 re-check, folded into r2 without a revision bump:
- **S1:** added a residual. The tail and breach-pointer savings are unproven on real TS output (`engine-contract.json` has neither). The fallback count is recorded in TASK-034's owner run and logged at runtime. An optional separate TS-generated breach fixture is allowed; `engine-contract.json` stays untouched.
- **S2:** shape (i) is pinned to `breach = false`, because `calc(.., true)` produces `[SOURCE]` (`risk_promotion_tests.rs:28, 209`). "Fallback count" is defined. Shape (ii)'s metrics are constants.
- **S3:** OD-7 is split into (1) new tables and triggers, needed for A and for B including OD-2(b), and (2) the trigger drop/recreate plus the data rewrite, needed only for OD-2(a).
- **Nits:**
  - "per tail entry".
  - Peak disk is measured from file sizes in the staging and operation folders, plus `-wal`, after each migrate.
  - Lazy `prior_breaches` keeps the exact `refs.is_empty()` check before `seen.insert` (`risk_promotion.rs:138-141`).
  - The eligibility predicate uses the live `validate_engine_payload`, which is harmless because of the round-trip check.

## Independent review notes
Independent review r1: CHANGES (25 items, applied in r2). Independent re-check r2: READY after the re-check wording fixes.
