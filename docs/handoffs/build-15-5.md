# Build 15.5 backend handoff

Specification: https://app.notion.com/p/3ff1bd4b6bde81b2aafcfa581430daf8
Base: main cf018ef; schema inspected at v13. No open PRs at audit time.

Build 10.5 reconciliation (October 21, 2026): the delivery-time status and pending Build 16 references below
are historical. PRs #39 (financial evidence), #42 (engine) and #44 (editor integration) are merged on the
audit baseline `4a462d0` (schema 18). Current consumption is `calculateAndSaveRisk` and the Build 19/21
features; see [Build 16 handoff](build-16.md). This does not establish packaged Windows or human acceptance.

## Source audit

| Source | Provenance, coverage and corrections | Risk meaning |
|---|---|---|
| Account startingBalance | User-entered, mutable, no historical completeness or effective-time assertion | Configuration, not evidence of a complete opening baseline |
| Closed trades | Rust-derived net realized P&L; original CSV batch/round-trip metadata retained; editable | Historical estimate, missing earlier imports and omitted fees remain possible |
| Trade fees | Explicit or importer default zero; provenance cannot establish actual fee completeness | Never infer complete coverage from stored zero |
| Ledger | User-entered signed account-currency movements; effective instant and Rust trading day | Payout/reset/correction affect bookkeeping; fees are programme costs; neither defines a firm risk floor |
| account_snapshots | Caller-supplied calculated output, engine/hash/time metadata | Not a raw financial observation, not proof of compliance |
| Catalogue phase/path and rulebooks | Existing versioned provenance, effective assignments and append-only phase events | Reuse Build 9/9.5; no duplicated rule schemas |
| Attempt lineage | New account UUID, predecessor/successor, no transferred trades/ledger/snapshots | External broker references may be reused; UUID is the evidence boundary |

## Contract coordination

All new exports are at `@fundedflow/domain` (`src/risk`). Existing account fields, lifecycle, selection and hooks remain unchanged. New repository operations are additive. Build 15 basic onboarding needs no checkpoint or rulebook. Claude can integrate evidence entry/review later, through the existing repository adapter. No new UI or QueryClient.

New financial evidence uses canonical decimal text, exact six-place i64 micro-units, nullable unknown values. Manual confirmation means user-reported, never independent broker/provider verification. Time is explicit; recording timestamps are native-owned. Observation day/timezone/reset settings are frozen on creation and are never reinterpreted by later account edits.

No firm-specific payout/reset/trailing-floor semantics are assumed. Existing ledger balance effects remain bookkeeping semantics only. A source-backed immutable applicable rulebook is required for Build 16 to interpret risk floors. Account-private rules cannot become official compliance.

## API handoff to Claude

`JournalRepository.evidence` is implemented by the existing `createTauriRepository`. It is a new required capability for adapter implementors and repository test doubles; existing account/ledger callers retain their signatures. No Build 14 hook or account-selection owner changes. All methods reject through the existing `RepositoryError`/`AppError` categories. Archived attempts permit reads and refuse writes. A missing native row yields the existing native not-found/database behavior; malformed input is validation, competing supersessions are conflict.

| Method | Input → output | Native command |
|---|---|---|
| inputs | RiskInputsQuery → AccountRiskInputs | get_account_risk_inputs |
| create | ObservationInput → FinancialObservation | create_financial_observation |
| get | observation ID → FinancialObservation | get_financial_observation |
| list | account UUID → all original/replacement observations | list_financial_observations |
| correct | original ID, ObservationCorrection → replacement observation | correct_financial_observation |
| ledgerHistory | account UUID → LedgerRevision[] | get_ledger_history |
| correctLedger | entry ID, existing LedgerEntryInput, actor/reason → existing LedgerEntry | correct_ledger_entry |
| removeLedger | entry ID, actor/reason → void | remove_ledger_entry_with_reason |
| reconcile | ReconciliationRequest → frozen Reconciliation | reconcile_financial_balance |
| reconciliations | account UUID → frozen Reconciliation[] | list_financial_reconciliations |
| resolve | reconciliation ID, actor/reason/status → appended resolution | resolve_financial_reconciliation |
| resolutions | reconciliation ID → ordered resolution history | list_reconciliation_resolutions |

Observation input fields: accountId, kind (opening_balance/balance/equity/intraday_peak/eod_settlement), nullable value, currency, explicit balance/equity basis (settlements and peaks may use either), observedAt, sourceCategory, sourceReference, confirmation, confidence, nullable validUntil, actor, nullable note. Output adds native ID, recordedAt, derived effectiveTradingDay, frozen timezone/reset, supersedesId and correctionReason. `list` includes replaced observations: consumers must follow supersedesId, never mutate or hide original evidence from history. A replacement cannot fork an already superseded record or move attempts. A null value explicitly records unavailable evidence.

Reconciliation requires accountId, observationId, baselineObservationId, asOf, evaluatedAt and explicit coverage/source assertion. `asOf` must equal the observed target instant; `evaluatedAt` determines expiry and cannot precede asOf. `validUntil` is a supplied freshness policy, with no invented global expiry; absent expiry returns incomplete. Same-instant conflicts or superseded sources return conflicting. Historical opening baselines need no rolling freshness expiry. Future UI should explain the supplied expiry and coverage assertion to the user.

Reconciliation output freezes request, selected baseline/target, all compared trade DTOs (including CSV batch and round-trip provenance), ledger entries/revisions, observation history and superseded IDs. Result contains status, nullable exact derivedBalance/difference, asOf, freshness, reasonCode, missingInputs, sourceReferences, sourceSummary and nextVerificationAction. No monetary result is fabricated for inadequate evidence. Resolutions are append-only review annotations; they never change financial data or make an old comparison current. Recompute after corrections; old results remain readable.

The native `inputs` operation uses a single transaction to collect current normalized account/trade/ledger/evidence/catalogue/rulebook records. Account UUID is attempt identity. Starting balance is configuration, distinct from an opening observation. `applicableAssignment` selects the unique half-open trading-day assignment and includes its immutable version among rulebookVersions; null means none/ambiguous. Its phase/path IDs and phaseHistory preserve identity without guessing a current programme from names. `applicableRulebook` is deliberately null: this build does not certify assignment/phase/path/source applicability for Build 16. The existing Build 9.5 applicability/integrity APIs remain authoritative. Build 16 must validate these together before evaluating rules.

Coverage is a sourced **user assertion**, not independently verified completeness. Native assembly demotes absent opening/EOD evidence and refuses to promote unavailable execution/live-position/intraday-history capability. Pure per-rule sufficiency also checks actual observations; a caller setting every coverage flag to available cannot create live data. Inputs include current knowledge for an explicit financial cutoff, not a reconstruction of what the database knew at that earlier instant. Build 16 must filter effective records and freeze its complete input payload/hash in calculated outputs.

## Bookkeeping and corrections

- Existing Rust net trade realizedPnl already subtracts trade fees. Reconciliation never subtracts them again.
- Opening baseline plus closed net P&L and balance-affecting ledger entries in **(baseline.observedAt, asOf]** gives the qualified balance estimate. Trades spanning an opening baseline require missing settlement allocation and remain incomplete. Open equity is unsupported for this balance comparison; no unrealized value is invented.
- Payout, ledger reset and balance_correction are signed bookkeeping movements; a reset amount is a delta, not an absolute new balance. Evaluation/activation/reset fees remain costs outside that sum. `other` retains the explicit existing affectsBalance policy. This is not a risk-floor/ROI formula.
- Zero tolerance: observed minus derived, exact micro-units. i128/BigInt intermediate sums permit exact accumulation; final balance and variance must fit i64, otherwise unsupported. No FX, balancing transaction, deposit inference, historical trade mutation, rule verdict or Safe status.
- Migration 14 freezes every current ledger row (including deleted rows) as a baseline. Lost pre-v14 edit history cannot be recovered; baseline reason/actor says so. New create/update/remove operations append immutable snapshots and supersession links atomically with the existing current-state row. Legacy methods use actor `local_user:legacy_api` and an explicit “no reason supplied” annotation. New correction methods require a real actor/reason supplied by the local caller. These are local audit labels, not authenticated identities.
- A current ledger row remains the backward-compatible projection. Original/corrected amount, kind, effective timestamp, note and trading day live in immutable revisions. Recording time and correction metadata distinguish event time from when it was corrected. Reads are recording order (rowid tie-break when milliseconds coincide). Reconciliation freezes trade versions; full independent historical trade revision storage is not introduced.
- Observation and revision tables reject SQL updates and direct deletion while their account exists. Account-retention/deletion policy remains Build 24; do not assume the old deletion preview counts the new evidence tables. No permanent-delete command is added. Resets create a new linked account and never copy evidence/reconciliations/revisions.

## Precision and time

Reuse `money.ts`, Rust parse_decimal/to_micros and the existing golden money fixtures. New evidence boundaries require canonical text exact to six places, within signed i64 micro-units; they reject precision that would round. Existing ledger boundaries retain Rust's midpoint-away-from-zero behavior (including legacy submicro nonzero inputs that round to zero), but TypeScript sign/range validation now uses exact primitives rather than Number. Existing documented Rust parsing versus TS >28-digit divergence remains; no parser or economics replacement.

Observations store INTEGER value_micros plus a frozen validated DTO. Financial reconciliation stores validated decimal text in immutable JSON (never a floating JSON number); this preserves exact i64 money and full source DTOs. Ledger amounts keep existing INTEGER storage. Raw observations never enter account_snapshots. New migration is 14, after verified v13; no shipped migration changed. Pre-upgrade VACUUM backup and per-step transaction/version semantics are reused. There is no downgrade or automatic restore.

Instants are normalized by Rust to UTC milliseconds. Trading day uses the existing authoritative IANA zone/reset/weekend algorithm; explicit UTC timestamps make DST gap/overlap unambiguous. Native tests cover both DST transition offsets and Friday cutoff→Monday. No duplicate TypeScript day algorithm. Later account setting edits cannot change previously observed timezone/reset/day or frozen reconciliation values.

## Minimum evidence for Build 16

`requiredRuleEvidence` uses the existing 13-family `RuleType` and parameter types; it does not copy schemas or calculate limits. `assessRuleEvidence` returns input states/reasons only. “Available” means supported user-reported input, never a rule pass. Build 16 must additionally validate presence states, immutable version/source claims, applicability, provider semantics, historical breach policy and completeness.

| Family | Required evidence / additional gates |
|---|---|
| max_drawdown | Opening baseline, complete closed trades/fees/ledger; EOD trailing adds settlement history; intraday adds complete equity/position history (unsupported V1); unknown method remains unsupported; lock interpretation belongs to Build 16 |
| daily_loss_limit | Baseline/session reference, complete closed trades/fees/ledger; equity basis adds current equity/live positions; provider session/condition semantics require verified policy |
| profit_target | Baseline, complete closed trades/fees/ledger; equity target adds current equity/live positions |
| consistency | Complete closed trades and actual fees; denominator/payout semantics remain engine prerequisites |
| min_trading_days | Complete closed trades/fees and stored trading days; provider qualifying thresholds/calendar semantics remain engine prerequisites |
| max_position_size | Concurrent execution/position history, not round-trip quantity; unsupported V1 |
| max_trades_per_day | Complete execution history and provider counting semantics; closed paired rows cannot certify it |
| payout_eligibility | Baseline/closed trades/fees/ledger plus manual verification of waiting/cadence/provider eligibility semantics |
| payout_count_transition | Ledger plus manual provider-confirmed qualifying payout counts; ledger payout count alone is inadequate |
| scaling_plan | Baseline/live positions plus manual verified schedule/capacity policy |
| trading_restriction / manual_check / unknown | Manual policy verification; no automated sufficiency claim |

Missing, incomplete, stale, conflicting, unsupported and manual_verification are distinct states. Superseded EOD records cannot satisfy history requirements when their replacement is unavailable; manual policy prerequisites return manual_verification. Explicit-none/disabled/not-applicable rule parameters retain Build 9.5 meaning; this build does not substitute zero or decide aggregate risk.

## Scenario evidence

Native tests are in `store/evidence_tests.rs`; existing Build 10/9.5/attempt/upgrade tests are retained. `test/fixtures/reconciliation.json` holds Rust-generated exact comparison outputs also run in Vitest. `evidence-wire.json` contains all 12 actual native command outputs; desktop adapter tests parse and preserve them and verify handler registration. No UI mocks are the only persistence evidence.

| Requested scenario | Evidence |
|---|---|
| 1 Fresh no trades | fresh_complete_baseline parity case, native canonical input test |
| 2 Mid-evaluation | mid_challenge parity case |
| 3 Missing baseline | missing_baseline parity case; sufficiency missing-actual-observation test |
| 4 User-confirmed opening baseline | complete_net_pnl/fresh_complete_baseline; manual identity is never independently verified |
| 5 Incomplete imported history | mid_challenge plus native csv provenance/freeze test |
| 6 Missing fees | missing_fees parity and CSV completeness test |
| 7 Fee corrections | native CSV fee correction freezes old net P&L and returns new exact variance |
| 8 Payout | payout_exact_micro parity and frozen native comparison |
| 9 Financial ledger reset | ledger_reset_is_signed_movement_not_new_attempt parity, existing ledger-kind tests |
| 10 New reset attempt | native reset_attempt_does_not_copy_evidence, existing attempt history tests |
| 11 Phase/path | phase transition preserved in canonical inputs; existing catalogue/rulebook tests retain path/version isolation; no inferred binding |
| 12 Stale balance | stale_balance parity |
| 13 Stale equity | pure sufficiency tests and explicit unsupported equity-balance comparison |
| 14 Missing positions | unsupported position evidence even when caller asserts availability |
| 15 Unknown intraday peak | requiredRuleEvidence + unsupported V1 intraday history |
| 16 Conflicting totals | exact positive/negative variance, competing-source/supersession tests |
| 17 Different times | noncomparable_time and evaluated_before_asof parity |
| 18 Weekend settlement | native Friday cutoff/EOD observation test |
| 19 DST | native pre/post spring gap/fall overlap UTC instants |
| 20 Reused broker ID | native reset isolation/cross-attempt refusal |
| 21 Archived | observation read/write isolation and existing ledger/archive tests |
| 22 Currency | native rejection, comparison mismatch fixture; no FX |
| 23 Interrupted/failed transaction | injected abort of correction, ledger revision, reconciliation and migration14; existing runtime interrupted migration tests |
| 24 Correction/replay | original and replacement observations, ordered ledger states, frozen comparisons, explicit resolution history |

## Acceptance matrix

| Notion criterion | Status | Evidence / remaining dependency |
|---|---|---|
| A: source inventory and canonical validated risk/evidence contracts | Complete | Source table, risk/contracts.ts, account-scoped native inputs, DTO tests |
| A: source sufficiency for supported families; precision audit | Complete | sufficiency.ts enumerates all 13 families, money/parity tests, no new rule schemas |
| B: dedicated checkpoint persistence, APIs and immutable corrections | Complete | migration14, evidence.rs, ledger revisions, all 12 commands/adapter tests |
| B: forward-only populated upgrades/backups/abort/reopen/isolation | Complete | v3/v8/v10 real populated fixture paths, v13 signed-ledger baseline, v14 failure rollback, existing upgrade suite |
| C: deterministic compatible comparison, frozen exact variance/reasons | Complete | Rust/TS parity, reconciliation.rs, no balancing side effects |
| C: bookkeeping/ROI/risk-floor distinction and frontend metadata | Complete | Contracts and policy above; firm risk-floor semantics intentionally unsupported |
| D: deterministic regression matrix and Build 16 handoff | Complete | Scenario table, native/wire/parity tests and this document |
| Gate: extend shipped infrastructure, keep calculated snapshots separate | Complete | No account_snapshots changes; existing repositories retained |
| Gate: canonical AccountRiskInputs consumed unchanged by Build 16 | Partial | Exported, native produced, adapter validated; Build 16 is not implemented and must integrate |
| Gate: observations and balance correction history replayable | Complete | Migration baseline + immutable post-v14 revisions, explicit pre-v14 limitation |
| Gate: reconciliation exact/source-backed, no financial/risk mutation | Complete | Frozen request/records/result, exact variance, read-only comparison tests |
| Gate: distinct missing/stale/unsupported/conflicting/manual evidence | Complete | Evidence schemas, comparison status/reasons and next actions |
| Gate: every rule has minimum observations; no trusted compliance from inadequate history | Complete | All rule types enumerated; live/intraday/position/unknown semantics not certified |
| Gate: resets/payouts/phase/account switches cannot mix attempts | Complete | UUID-scoped reads/writes, reused broker reference tests, phase/source histories preserved |
| Gate: migration backups, rollback, parity and reopen verified | Complete | Native evidence/upgrade/parity tests; no downgrade/auto-restore claim |
| Gate: Codex stays backend/domain scoped, Claude UI untouched | Complete | Git path audit; no components/hooks/design/routing edits |
| Gate: PR evidence, human acceptance, Windows/Tauri limitations | Partial | Draft PR and automated evidence; packaged Windows/Tauri and human acceptance remain pending |
| Final AC: typed canonical inputs consumed by Build 16, no duplicate Today DTO | Partial | Contract delivered; Build 16/Today consumers are later builds |
| Final AC: required inputs enumerated, missing forces unknown/manual | Complete | Per-rule source requirements; no risk-status/Safe producer in this build |
| Final AC: migrations latest baseline, populated older fixtures, backup/rollback/reopen | Complete | Verified main v13 → new v14 and native tests |
| Final AC: immutable originals/times/actor/reason across old and new APIs | Complete | Ledger revision migration + legacy compatibility + explicit correction APIs |
| Final AC: synthetic cases prevent false Safe | Complete | Inadequate evidence returns unavailable/unsupported; no Safe calculation API |
| Final AC: source summary/as-of/reason/next action | Complete | ReconciliationResult contract and native wire fixture |

## Remaining integration and approval decisions

- Claude owns all checkpoint/reconciliation UI and future feature hooks. No UI integration is required to keep Build 15 onboarding functional. Use the methods above later; do not create another repository/state owner.
- Build 16 must implement actual rule evaluation, resolve phase/path/applicability using immutable assignment/version/source history, retain unknown/unsupported inputs, map nullable calculated outputs to snapshot storage, and freeze/hash its input payload. This PR does not implement those algorithms or certify provider compliance.
- Product/provider approval remains necessary for firm-specific trailing floors, payout/reset/lock effects, settlement/holiday policy, complete execution/live-equity sourcing, and any nonzero reconciliation tolerance. This implementation leaves them unsupported/manual; it does not block independent bookkeeping evidence.
- Manual confirmation/coverage/expiry/actor labels are local user reports. No independently authenticated feed or external verification is introduced.
- Pre-v14 overwritten ledger values cannot be recovered. Trade correction history before a frozen comparison is not reconstructed. Complete history and missing fee provenance cannot be inferred from CSV imports.
- Current account edits retain existing semantics (including mutable currency/session/starting balance). Observations freeze their units/session context and comparisons refuse mismatches; no UI/lifecycle policy is silently changed.
- Existing deletion preview does not yet enumerate new evidence tables; Build 24 must include them when implementing approved retention/deletion. No delete command exists today.
- Windows packaged Tauri acceptance and human approval remain unverified. No automatic merge or Notion Done.

## Verification recorded before draft PR

- `npm run typecheck`: passed.
- `npm test`: passed after final review (370 domain + 336 desktop; 706 tests total), including the regression for a superseded EOD value corrected to unknown.
- `npm run build`, `npm run check`, `git diff --check`: passed after final domain changes.
- `cargo test --locked -- --test-threads=4`: 183 passed, 4 failed, 2 ignored at full-suite run. The failures are the pre-existing Linux temporary-Journal lifetime issue in legacy rulebook fixture tests (SQLite IO 1802); see [existing Triage](https://app.notion.com/p/3ff1bd4b6bde819499abc89a9f2f9795). The legacy test files are untouched. No native regressions were observed.
- Final `cargo test --locked evidence_tests -- --test-threads=4`: 18 passed, including the explicit EOD/peak basis and superseded-to-unavailable EOD cases, all without fixture-update mode.
- `cargo clippy --locked --all-targets -- -D warnings`: passed after final backend changes.
- 26 Rust-generated reconciliation parity cases and 12 native command payloads are checked in and tested by both hosts; unchanged money/trade parity remains in the existing suite.
- Linux native tests used the provisioned Rust/WebKit runtime runner. This is native SQLite/backend evidence, not packaged Windows/Tauri UI acceptance. Windows CI evidence is recorded in the PR when available. Human acceptance and actual Build 16 consumption remain pending.
