# Build 21: Today risk dashboard, data freshness and drawdown headroom

Card: https://app.notion.com/p/3fe1bd4b6bde81b3a09ee5fbf80e8743 · branch `feat/build-21-today-risk-dashboard`.
Screen spec: [`08-today.md`](../design/screens/08-today.md) (with [`09-home-merged-into-today.md`](../design/screens/09-home-merged-into-today.md)).

## Baseline (checked 2026-10-20)

| Build | State on `main` (`970306b`) | Used here |
|---|---|---|
| 13–14 design system, gateways | merged | `MetricCard`, `StatList`, `StatusIndicator`, `Drawer`, `Dialog`, forms, `useFeatureQuery`/`useFeatureMutation` |
| 15 accounts, active account | merged | `useActiveAccount` (the one selection), `isRiskEligible`, lineage, `useAccountFacts` |
| 15.5 financial evidence | merged, **no UI until now** | `evidence.list/create/reconcile/reconciliations` through new hooks; `get_account_risk_inputs` for "now" |
| 16 rules engine | merged | `EngineResult` in each snapshot's explanation; `isEngineResultCurrent` via `useCalculationFreshness` |
| 17–18 imports | merged | `useImportHistory`; a commit invalidates `snapshotsRoot` |
| 19 rulebook editor | merged | `useCalculateRisk` + `CalculateNow` (calculation statements), `CalculationExplanationDrawer`, `RuleResult` |
| 20 journal | merged (PR #45) | `useTrades`, journal statistics, `/journal?view=log`, `/journal/trades/:tradeId` |

No Rust command, migration or stored calculation was added: every fact Today needs already had a read. The
`today-summary` placeholder capability is removed; `insights-aggregates` stays unsupported. (`structured-reviews` was
removed by Build 22, which enabled Review session; see [build-22-daily-review.md](build-22-daily-review.md).)

## The truth model (when is a saved estimate current?)

`useCalculationFreshness` answers "are the sources for the snapshot's own cutoff unchanged?" That is not "current
today". Today (`features/today/view-models/today.ts`, `deriveRiskTruth`) calls an estimate **current** only when all
of these hold, otherwise it is **not current** and shows as Unknown (the old status appears only as "Last saved
estimate: …"):

1. the attempt is risk eligible (`status === "active"`, not archived); otherwise it is **history** and never estimated;
2. the snapshot carries a Build 16 engine record for this account (pre-engine records give no status);
3. the unchanged-inputs check succeeded and said `current` (a failed check is Unknown, not the saved status);
4. its trading day equals the **Rust** effective trading day now (`get_account_risk_inputs` at the check instant, so
   reset time, weekends and DST are Rust's);
5. no trade (exit or open entry), checkpoint or ledger movement is dated after its cutoff;
6. the rulebook version in force now (`applicableAssignment`) is the one it used.

A recorded **Stop** is never cleared by time, a failed check or a refresh: it stays "Stop (last saved, not current)"
until a new calculation. The check instant (`useCheckTime`) is the minute Today opened; it moves on **Check again**
or when the window becomes visible in a later minute, never on a timer.

## Traceability: every displayed value

| Shown | Source (owner → API) | Freshness / fallback | Test | Screen |
|---|---|---|---|---|
| Status Safe/Caution/Stop/Unknown | Build 16 `EngineResult.status` in the account's current promoted result (`useCurrentRisk`, P0-02), else the latest snapshot as `not-promoted` stale | Truth model above; Unknown when not current, none, legacy, not promoted, unreadable or unchecked | `today-model.test.ts` "current versus not current"; `today.test.tsx` "the selected account" | Risk estimate headline |
| Last known balance | `EngineResult.balance` | Unknown when null (baseline/history); "Not current" marker | metrics "known zero" | Figure card |
| Realized P&L today | `EngineResult.realizedDayPnl` (trading day of the calculation) | as above | metrics | Figure card |
| Profit target progress | `profit_target` outcome: `profit`, `profitTarget`, `remaining` | outcome state → known/unknown/unsupported/…; no rule → "No rule" | metrics "takes target…" | Figure card |
| Daily loss room left | `daily_loss_limit` outcome: `dailyLossRemaining`, `dailyLossLimit` | same | metrics; "known zero" journey | Figure card |
| Drawdown headroom / floor | `max_drawdown` outcome: `drawdownHeadroom`, `drawdownFloor`, `drawdownLocked` | null headroom (equity basis) stays unknown; `0` is a real zero | metrics; "known zero" journey | Figure card |
| Qualifying trading days | `min_trading_days` outcome metrics | same | metrics | Figure card |
| Consistency | `consistency` outcome `attained`, `bestDayProfit`, `denominator` | same | metrics | Figure card |
| Open P&L and live equity | not recorded in V1 | always "Not supported" | journey "current estimate" | Figure card |
| Explanation: formula, operands, missing inputs, evidence, sources | the rule's `RuleOutcome` (Build 19 `RuleResult`) | as recorded; "Not current" notice | journey "current estimate" | Drawer |
| Contributing trades | trades frozen in the snapshot's `explanation.inputs`, filtered to the outcome's `sourceReferences` (day figures: the calculation's trading day) | as recorded; links resolve in the active account | `contributingTrades` test; journey clicks a trade | Drawer |
| Rulebook / engine version, cutoff, data as of, calculated at, inputs hash | `EngineResult` + snapshot `calculatedAt`, `useRulebookVersion` | as recorded | journey | Drawer, freshness |
| Last trade recorded | `get_account_risk_inputs` (now) trades | "Checking…", Unknown on failure | journey "nothing calculated" | Freshness |
| Last import | `useImportHistory` newest `completedAt`; failed / duplicate-only named | "Import being saved…" while a commit runs in this window | journey "duplicate-only import" | Freshness |
| Last firm checkpoint | `useObservations`, newest in force (corrections replace originals) | "Confirmed by you" / "Not confirmed"; never "verified" | `checkpointSummary` tests; checkpoint journey | Freshness |
| Conflicting checkpoints | same kind, basis, currency and instant with different values | warning notice | `checkpointSummary` test | Freshness |
| Discrepancy with the firm | latest unmatched `Reconciliation` per checkpoint in force | error notice with exact difference; "Nothing was adjusted" | `openDiscrepancies` test | Freshness |
| Trading day now | `AccountRiskInputs.effectiveTradingDay` (Rust) + reset time and zone | badge when the last estimate is for another day | journey "next trading day" | Freshness |
| History completeness | coverage frozen with the last calculation | "Not stated" without one | journey "duplicate-only import" | Freshness |
| Closed-trade KPIs, recent days | Build 20 `stats` / `groupByDay` over `useTrades` | labelled realized-only, never risk | existing journal tests | Closed trades |

## Actions

| Action | Goes to | Notes |
|---|---|---|
| Calculate estimate | `CalculateNow` in a dialog (`useCalculateRisk`) | Explicit only; coverage, rule currency, boundary and caution buffer are stated each time, never defaulted to complete |
| Verify balance | `VerifyBalanceDialog` → `evidence.create`, then `evidence.reconcile` | Exact wall-clock time in the account zone; a DST-skipped or repeated minute is refused |
| Import CSV | `/import` with the account | |
| Review rulebook | `/accounts/:id/rulebook` | |
| View trades | `/journal?view=log` | |
| Add account | `/accounts` | |
| Review session | `/journal/days/:currentTradingDay?account=` (Build 22) | Rust's current trading day from `list_daily_reviews`; "Continue review" for a draft; unavailable with its reason while unread. Independent of the risk truth model |
| Show (account card) | sets the active account | The only way Today changes the shared selection |

## Query keys and invalidation

All reads are under `featureKeys.account(id)`; Today adds `observations(id)` and `reconciliations(id)`. Canonical
inputs "now" use the existing `[...snapshotsRoot(id), "calculation-inputs", asOf, coverage, policy]`, so every write
that invalidates `snapshotsRoot` (trade create/correct/delete/restore, import commit, ledger, rulebook, account status
or reset, and now checkpoint/comparison writes) re-checks the saved estimate. The selected account remounts on a
switch (`key={account.id}`), and `deriveRiskTruth` refuses a snapshot or engine record of another account.

## States

No account; no account chosen; selected attempt is history (with the successor link); reset successor (with the
predecessor link, nothing carried over); needs setup; rulebook unknown; no trades; import being saved; nothing
calculated; checking; not current (each reason listed); unreadable calculation; failed source check; legacy record;
conflicting checkpoints; discrepancy with the firm; rule-level unknown / unsupported / manual / stale / conflicting /
not applicable / no rule / several rules; valid zero headroom; runtime unavailable (through `RuntimeGate`).

## Limitations and follow-ups

- The equity curve with the drawdown floor is not drawn: snapshots store one floor per calculation, not a series.
- Checkpoint corrections (`evidence.correct`) and comparison resolutions have no UI yet; a new checkpoint is
  recorded instead and conflicts are flagged.
- The account cards each read their own inputs; with many accounts this is several local reads per card.
- Packaged Windows Tauri acceptance (account → import → Today → explanation) is not verified by this PR.
