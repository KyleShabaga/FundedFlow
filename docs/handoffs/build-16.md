# Build 16 — rules engine and snapshot handoff

Specification: https://app.notion.com/p/3fe1bd4b6bde8126b233c9d1f950abb9

## Dependency and source audit

Implementation initially stacked on Build 15.5 PR #39 (`e947dfb`). After #39 merged, this branch was rebased onto accepted main `9d49d71`, including the merged Accounts and CSV wizard work. The final diff contains only Build 16. No React component, hook, active-account owner, shell/routing, design file, or Build 15.5 integration document was edited.

- Build 9.5 already supplies the 13 canonical rule families, presence states, immutable versions, claims, assignments, `canAssign`, required values, and phase/path contracts. Build 16 imports these rather than creating another schema.
- Build 15.5 supplies `AccountRiskInputs`, observations, provenance, correction history, exact reconciliation, and `assessRuleEvidence`. These files remain unchanged. Native source assembly returns current knowledge for an explicit financial cutoff, not historical database time travel.
- Rust remains authoritative for stored trade economics and trading days. The engine consumes normalized net realizedPnl; it does not reprice quantities, subtract trade fees twice, parse CSVs, or derive a second trading-day calendar.
- Snapshot persistence already exists. The required balance/day-P&L fields, zero-only completion count and nonnullable lock flag could not honestly represent unavailable engine output. Migration 15 extends the existing table and commands; no new repository or gateway.
- Schema on the accepted dependency was 14; migration 15 is new and forward-only. Migrations 1–14 are unchanged.

## Public API

Exports from `@fundedflow/domain` (`packages/domain/src/engine`):

| Export | Contract |
|---|---|
| `evaluateAccountRisk(input, policy)` | Validated canonical AccountRiskInputs + EnginePolicy → EngineResult; pure, no I/O, clock read or randomness |
| `resolveEngineApplicability(input)` | Explicit unique date-window assignment and immutable version, exact provider/catalogue/phase/path matching; reasons when unresolved |
| `calculateRiskSnapshot(input, policy, isEndOfDay)` | Pure calculation + mapper → existing SnapshotInput, including frozen source inputs/policy/result |
| `isEngineResultCurrent(result, freshlyFetchedInput, policy)` | Account, engine version and recomputed input-hash comparison; does not itself fetch or certify freshness |
| `engineResultSchema`, `enginePolicySchema`, `ruleOutcomeSchema` | New engine output/policy contracts; existing rule and risk-input DTOs are reused |
| `ENGINE_VERSION` | `fundedflow-risk/1`; bump on released calculation-semantic changes |
| `canonicalEngineJson`, `engineSha256` | Canonical collection/object ordering and portable SHA-256 identity |

The non-visual desktop `calculateAndSaveRisk(repository, query, policy, isEndOfDay)` uses the existing JournalRepository to load canonical inputs, reconciliation/review history, calculate and save through existing snapshot commands. No feature hook or React integration is added. It rejects foreign-account sources through the existing RepositoryError shape. Domain shape validation throws Zod errors; unavailable/unsupported facts produce structured Unknown instead of a validation exception or fabricated value.

`EnginePolicy` makes missing rulebook semantics explicit: ruleCurrency and supporting existing claim IDs, threshold boundary (`touch_is_breach` / `below_is_breach`) and supporting claim IDs, nullable personal caution headroom, reconciliation revision IDs, and sourced prior-breach state. Default policy has no assumed units/boundary, so financial rules remain Unknown until supplied. A provider policy reference must identify a reviewed provider-stated claim for the whole rule or the specific currency/breach-boundary field. This is a calculation binding to Build 9.5 claims, not another source-verification system.

`EngineResult` contains account/attempt, assignment/version and phase/path IDs, engine version, trading day, explicit asOf, newest included financial dataAsOf, stable inputsHash, Safe/Caution/Stop/Unknown, assurance, per-rule metrics/operands/formulas/reasons/evidence/missing inputs/source references, qualified balance/day P&L and day count, and assumptions. Raw source/correction records remain available in the frozen snapshot explanation. Source references include input/correction provenance; formula operands explain the quantities used.

## Financial and risk semantics

- Exact existing micro-unit primitives and BigInt arithmetic; final monetary results must fit signed i64. Ratios use exact integer cross multiplication, not floating-point percentages. No decimal.js is required because the engine consumes Rust-normalized economics rather than computing price × quantity.
- Manual checkpoints and completeness assertions remain user-reported. Assurance is `user_reported_estimate`, `user_defined_estimate`, or `unverified`; Safe is not official broker/provider certification or a declaration that an evaluation has passed.
- Independently supported applicable breach → Stop, even with unrelated unresolved rules. Otherwise any material unresolved state → Unknown; personal buffers/known constraints may produce Caution; fully supported checks may produce Safe. Explicit-none/disabled/not-applicable never become numeric zero; a book containing only absent checks does not manufacture a Safe result.
- Rule claims, source conflicts, verification, assigned phase/path and immutable version are checked. New publication does not switch an existing assignment. Account-private rules need user confirmation and remain user-defined estimates.
- A unique confirmed opening baseline and configured starting reference must agree for supported risk calculations. A mid-attempt checkpoint does not silently replace the initial risk anchor. Missing baseline/history/fees, malformed stored dates, source currency/session changes and conflicting historical balances/settlements cannot create Safe or a fabricated breach.
- Baseline plus normalized closed net P&L and signed bookkeeping movements gives a qualified balance. Closed trade fees are already included. Bookkeeping movements do not establish provider risk-floor effects; payouts/resets/adjustments make affected risk calculations manual until sourced policy exists.
- Distinct closes at the same instant are coalesced. Mixed signs that could cross a floor or trigger a lock in an unknown order yield Unknown, not an invented execution sequence. Prefix balances/highs and binary lookups avoid quadratic replay of large histories.
- Hard daily loss breaches persist across provided closed history; soft daily thresholds stop current-day trading without changing lifecycle status or declaring terminal failure. Daily grouping consumes Rust tradingDay. Soft action/rollover policy remains a reviewable interpretation, not an automatic account-status transition.
- `priorBreaches` is explicit continuing breach state supplied by the caller from audited previous evaluations. Same account/version/assignment and known source references preserve Stop; missing/deleted references or a different assignment/version require review and cannot silently become Safe. A new attempt UUID does not inherit the predecessor's breach. Callers must retain independently established continuing breaches when normal records are corrected/deleted; this helper does not introduce another persistent state owner.

## Supported rule matrix

| Family/variant | Implementation and limits |
|---|---|
| Static realized drawdown | Initial floor, exact headroom, historical crossings, boundary equality; optional sourced monotonic static lock |
| EOD realized trailing | Confirmed compatible settlement history plus completeness assertion; peak/floor/lock replay, monotonic lock checks, historical crossings and settlement/journal contradiction detection |
| Intraday trailing / equity-dependent drawdown | Exact checkpoint reference/floor/headroom estimates when values exist; compliance remains Unsupported/Unknown because canonical V1 does not supply complete live-position/intraday history. Closed round trips never fill this gap |
| Locked floors | Trigger, fixed floor and chronological transition for supported realized references; a lock cannot relax the existing floor |
| Daily loss | Realized/account-trading-day/always condition, exact allowance, historical hard crossings and current-day soft crossings. Provider-session/unrealized/unknown conditions remain unsupported/manual |
| Conditional DLL, including “None below initial trail” | Manual until the trigger semantics are sourced/modelled. A conditional None does not become unconditional no-limit compliance |
| Profit target | Sourced balance basis, profit/remaining/attained; progress does not automatically pass the account |
| Minimum/qualifying days | Distinct stored trading days and exact per-day net threshold (including five days × $150); unknown threshold or day basis stays unknown |
| Consistency | Exact best positive day vs total profit or unique explicit profit-target denominator; negative days retained; unmet ratio warns without inventing an irreversible failure; payout-cycle denominator semantics remain manual |
| Position size, mixed mini/micro and trade counts | Parameters preserved; Unsupported without execution/concurrent-position evidence. No 10:1 equivalency or round-trip execution count is invented |
| Payout eligibility | Supported minimum balance/profit subconditions; waiting-day basis, anchor, cadence, request/cycle/reset semantics remain Manual. No automatic eligibility or payout |
| Payout-count transition | Recorded movements can be reported but cannot prove five qualifying payouts or initiate a phase transition |
| Scaling | Unknown schedules and missing concurrent positions remain manual; Yes alone does not produce capacity |
| Trading restrictions / manual / unknown | Explicit manual/unknown states; no compliant default |

## Snapshot compatibility and native boundary

The existing `save_account_snapshot`, list/latest commands, adapter and `JournalRepository.snapshots` remain the persistence path. Migration 15 rebuilds account_snapshots preserving IDs, foreign keys, values and EOD uniqueness, and permits null balance, realizedDayPnl, tradingDaysCompleted and drawdownLocked. Existing nonnull payloads remain byte-compatible; TypeScript consumers must now handle null on those four returned fields. Claude's current merged UI compiles unchanged; later displays must render unknown rather than zero/false.

The mapper stores the complete normalized input/policy/result in explanation, and only projects unambiguous supported metrics into legacy columns. Unsupported numerical checkpoint estimates remain in the detailed result with their unsupported status. Native validation checks identity, frozen-input/policy hash and projected figures for this engine namespace and rejects Safe/Caution with unknown required financial values. This verifies storage consistency; Rust does not independently rerun the TS rule algorithms or authenticate user assertions. Existing caller-supplied legacy snapshot producers remain supported.

Stored outputs reject updates/deletion while the account exists. EOD save with the same account/day/engine/hash returns the original record; corrections, explicit reassignment, account attempt, policy/time or engine changes create different identity. Native calculatedAt is recording time, distinct from supplied evaluation asOf and underlying dataAsOf. Existing legacy zero values remain verbatim; their original unavailable-vs-zero intent cannot be reconstructed.

## Recalculation handoff to Claude

The host helper loads source data and reconciliation review IDs through existing ports, preserving them in the hash. A current unresolved discrepancy adds a missing-input reason; merely dismissing/reviewing a discrepancy never creates a balancing movement or erases uncertainty. Superseded observations are excluded from current review flags. Call again after imports, trade edits, ledger corrections, observations/corrections, reconciliation changes, assignment/phase changes or attempt changes.

UI wiring belongs to Claude/Builds 19 and 21. Fetch fresh canonical data before using `isEngineResultCurrent`; old snapshots remain historical, never newly verified. Invalidate only the selected account's existing query keys. Retain continuing known breach policy from audited history when records are corrected. Repository reads and the eventual save are separate operations; this is reproducible frozen-input calculation, not a transaction locking the entire account throughout UI orchestration. A future coordinated native revision-token/current-result promotion flow may be needed; do not describe saved outputs as guaranteed latest after concurrent source edits.

## Validation and reproducibility

- Engine scenarios: `packages/domain/test/engine`; synthetic provider-neutral parameters, not hard-coded firm terms. Cover static/EOD/intraday estimates/locks/equality/recovery, prior breaches, missing/stale/conflicting inputs, currency, phase/path/version, private rules, account scope, absence states, malformed dates, overflow and input permutations.
- Rust-generated `engine-math.json` pins exact static/EOD/intraday checkpoint/lock/daily/share arithmetic; existing Rust-generated trade/money fixtures prove net-P&L/fee and wire parity. `engine-contract.json` is TS-generated calculation output used by actual native SQLite persistence tests, not independently Rust-generated engine results.
- Native tests cover known/null/micro payload round-trips, cross-language canonical hash verification, EOD idempotency, immutable history, tampered payload rejection, populated v14 migration/backup/reopen, failed migration rollback, failed write and archived reads/writes. Existing v3/v8/v10 and CSV regression suites remain in use.
- `npm run fixtures:engine -w @fundedflow/domain` deliberately regenerates portable wire payloads; review the diff. Rust reference math uses `FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test engine_snapshot_tests` only after an intentional reviewed reference change.
- After build: `npm run check:engine-runtimes -w @fundedflow/domain` compares byte-identical results in plain Node and an actual isolated Chromium page across nine scenarios and checks SHA-256 against Node crypto including UTF-8. Set `FUNDEDFLOW_CHROMIUM` to a local Chromium/Edge executable where needed. Vite is a development-only fixture/browser bundler; runtime dependencies remain Zod only.

## Acceptance matrix

| Requirement | Status | Evidence / remaining dependency |
|---|---|---|
| A1 Canonical input validation | Complete | Existing AccountRiskInputs parsed unchanged; normalized money/time/source validation; no duplicate DTO |
| A2 Immutable applicability | Complete | Explicit dated assignment, exact provider/catalogue/phase/path, canonical canAssign/checks, claim/version gates; no newest-version fallback |
| A3 Typed outcomes | Complete | Supported/satisfied/breached/caution/unknown/unsupported/manual/stale/conflicting/absent/disabled/not-applicable and reasons |
| A4 Aggregate precedence/assurance | Complete | Stop precedence, unresolved material → Unknown, explicit user-defined/reported assurance and personal caution |
| B1 Drawdown | Complete for supported V1 variants | Static/EOD/monotonic locks and checkpoint estimates; full intraday/live-equity compliance intentionally unsupported |
| B2 Daily loss | Complete for supported variants | Realized/account-day/hard/current soft thresholds; provider-session/conditional/unrealized remain explicit manual/unsupported |
| B3 Target | Complete | Qualified profit, progress/remaining/attainment, applicable version; no automatic pass |
| B4 Days | Complete | Unique stored days, qualifying threshold and 5 × $150 fixtures; unknown calendar semantics not guessed |
| B5 Consistency | Complete for supported variants | Exact rational comparison; total-profit/unique target; payout cycles manual |
| B6 Position/trade limits | Partial | Canonical params/unknown outcomes ready; actual concurrent/execution evidence absent in V1 |
| B7 Payout/transitions | Partial | Minimum subconditions and review metadata; waiting/cycle/qualifying payout semantics cannot be established from current contracts |
| B8 Precision | Complete | Existing BigInt/i64 primitives, Rust net-P&L fixture consumption, native reference math, checked overflow; no new decimal runtime dependency |
| C1 Typed explanation/result | Complete | Public schemas, operands/formulas, IDs, assurance, reasons, source timestamps/hash |
| C2 Reproducible snapshot identity | Complete | Canonical ordering + SHA-256; browser/Node and Rust hash checks; version/correction/policy/account identity tests |
| C3 Existing storage/unknowns | Complete | Migration 15, nullable contract, existing command/adapter, immutable rows, native rollback/reopen tests |
| C4 Recalculation/invalidation | Partial | Stateless helper/cache guard and reconciliation revision capture; Claude UI wiring and atomic current-result promotion are later integration |
| D1 Drawdown scenarios | Complete | Exact expected values, equality, recovery, prior breach, missing intraday data, locks and payout-policy indeterminate cases |
| D2 Integrity | Complete | Missing baseline/fees, contradictions, private/unknown rules, inactive/archived accounts, scope/version/phase, existing reset/broker-reference suites |
| D3 Time | Complete for canonical V1 semantics | Consumes stored Rust days; DST/weekend/native fixtures preserved; provider holiday/session rules unsupported rather than fabricated |
| D4 FLEX examples | Complete as parameterized scenarios | $150 days, conditional DLL/absence, payout-count/waiting ambiguity, mini/micro evidence gap and unknown scaling schedule |
| D5 Runtime/parity | Complete | Actual Node/Chromium equality, exact native math/economics, immutable correction/version identity and boundary checks |
| Gate: reuse schemas/authority | Complete | Build 9.5/15.5 files unchanged; no extra repository, ledger, source registry or gateway |
| Gate: no false Safe from insufficient data | Complete | Evidence gates, source/claim context, default unknown policy, unsupported/manual outcomes and regression matrix |
| Gate: native integration/history | Complete | Existing Tauri/Rust/SQLite storage; legacy payloads retained; nullable outputs and immutable history |
| Gate: no Codex UI/UX work | Complete | Changed-path audit; no components/hooks/styles/routing/design or active-account state changes |
| Gate: PR/human/Windows acceptance | Partial | Draft PR and test evidence; packaged Windows/Tauri and human acceptance are unverified, no auto-merge/Done |
| AC: documented exact scenario suite | Complete | Engine scenarios + native exact math and snapshot tests |
| AC: identical browser/plain Node | Complete | Actual Chromium page runtime test; no Stage 1 server |
| AC: no prohibited imports | Complete | Existing domain boundary checker; no runtime dependency added |
| AC: new version preserves old snapshot | Complete | Identity/version tests and native immutable/idempotent persistence |
| AC: exhaustive canonical handlers | Complete | Exhaustive RuleDefinition switch; no competing rule schemas |
| AC: unknown/private/absent/manual not compliant by default | Complete | Explicit assurance/states; absence-only books remain Unknown |
| AC: Stage 1 native, portable Stage 2 | Complete | Pure exports and existing native mapper/service; no cloud implementation |

## Decisions and remaining limitations

- Build 9.5 lacks explicit currency/boundary and several provider session/payout/execution semantics. The policy binds known units/boundaries to existing reviewed claims; it never defaults them. Firm-specific interpretation remains reviewable and must be sourced before integration.
- Full intraday equity, concurrent positions, execution counts, qualifying payout evidence, waiting-day anchors/calendars and provider holiday/session rules remain unavailable. No extension to live broker feeds or competing normalization was introduced.
- Build 9.5's shareOfOne validator still uses Number for bounds. A value just above one can round down in that validator; Build 16 independently checks the exact rational operands and fails closed. The publisher-schema fix belongs in a coordinated Build 9.5 follow-up.
- Corrections change input identity. Existing immutable history is preserved; pre-Build-15.5 overwritten ledger history and historical fake-zero intent cannot be recovered.
- Financial source completeness, manual observations, actor labels and prior-breach assertions are not independently authenticated. No official compliance certificate is produced.
- Snapshot fields became nullable as documented; consumers must handle unknown values. No Claude UI or hooks were modified to demonstrate the engine.

## Verification evidence (2026-10-21)

- TypeScript typecheck, full build and package-boundary/distribution checks pass. Full tests: 442 domain and 381 desktop tests pass.
- Native suite: 191 passed, 4 failed, 2 ignored. All six new engine/native snapshot tests pass. The four failures are the pre-existing Linux legacy-rulebook temporary-journal tests: `assignment_intervals_follow_effective_from_and_contain_their_snapshots`, `legacy_parameters_use_only_the_keys_the_matrix_maps`, `rule_keys_are_unique_per_version`, and `the_legacy_rules_fixture_covers_every_matrix_case`. The same four SQLite I/O failures were reproduced on unchanged Build 15.5 dependency `e947dfb`; tracked at https://app.notion.com/p/3ff1bd4b6bde819499abc89a9f2f9795. Strict all-targets Clippy passes.
- Plain Node and actual Chromium produce identical JSON for nine scenarios; UTF-8 SHA-256 matches Node crypto. Rust reference arithmetic and native frozen-input hashes pass. These fixtures are synthetic evidence, not verification of any firm's actual published terms.
- Packaged Windows/Tauri execution and human acceptance are not verified here. This remains a draft for review, not release acceptance.
- Canonical publisher exact-share bounds follow-up: https://app.notion.com/p/4001bd4b6bde819cba99c6c154f9a620 (Unprioritized — Triage).
