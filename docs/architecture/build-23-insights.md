# Build 23: Insights explorer and contributing-trade drill-down

Card: https://app.notion.com/p/3fe1bd4b6bde81c2b733f498b74486be · branch `feat/build-23-insights`.
Screen specs: [`07-insights.md`](../design/screens/07-insights.md), [`04-calendar.md`](../design/screens/04-calendar.md).
Storage and the command: [`../data-model.md#insights-build-23`](../data-model.md#insights-build-23).

## Baseline (checked 2026-10-20)

| Build | State on `main` (`e5e9f05`) | Used here |
|---|---|---|
| 8/10 storage, trading day | merged | stored `trades.trading_day` (zone, reset, weekend roll, DST); never re-derived in TypeScript |
| 13–14 design system, gateways | merged | `MetricCard`, `StatList`, `DataTable`, `ChartPanel`, `EquityCurve`, `PnlCalendar`, `MonthYearPicker`, `Drawer`, `Popover`, `useFeatureQuery`, query keys |
| 15 accounts, attempts | merged | stable account ids, attempt links, status events with the user's cause, archive |
| 17–18 imports | merged | per-account dedup keys, restore on re-import, import batch counts |
| 20 journal | merged; migration 17 | review strategy/tag label snapshots, planned risk and R (`reviews::risk_from_plan`, `r_multiple`), Journal win-rate definition, Trade detail |
| 21 Today | merged | untouched; Insights never feeds the risk truth model |
| 22 daily reviews | merged; migration 18 | `/journal/days/:day?account=` links and review status in the calendar's selected-day panel (process context only) |

No Codex or other prior Insights work existed: `features/insights` held only snapshot reads and an
`insights-aggregates` "not implemented" capability, and `/insights` was a placeholder. **No migration**: every fact
Insights needs is already stored.

## Architecture

```
SQLite ──(read-only SQL, scoped by account id)──► store/insights.rs ──► get_insights_dataset
   └─► Tauri adapter (insightsDatasetSchema, scope check) ──► useInsightsDataset (query key: sorted ids)
        └─► @fundedflow/domain insights: selectTrades ─► summarize / groups / curve / attempts
             └─► React sections (no arithmetic beyond calling these) ─► ContributingTradesDrawer
```

- **Rust** (`src-tauri/src/store/insights.rs`): `dataset(query)` returns exactly the requested attempts (archived
  included, each must exist), their **active** trades (soft-deleted ones are counted per account, never returned), and
  per trade the review's strategy, tags (recorded labels and kinds), planned risk (entered, or derived from the planned
  entry and stop exactly as Trade detail does) and R multiple. Per account: lineage root and attempt number, the status
  event that set the current status (with the user's cause), deleted-trade and import counts. Scope is the local
  account id only, so a reused broker number never merges attempts, and nothing depends on the active account.
- **Domain** (`packages/domain/src/insights`): versioned contracts (`INSIGHTS_CONTRACT_VERSION = 1`,
  `INSIGHTS_SELECTOR_VERSION = "insights/1"`), the canonical selector and the metric engine. Pure: no clock, locale or
  floating point for money.
- **Parity**: `src-tauri/src/insights.rs` is the Rust mirror of `summarize`. `parity.rs` generates every expected
  output of `packages/domain/test/fixtures/insights-metrics.json`; Vitest runs the same cases. A definition change must
  change both and regenerate the fixture (`FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --lib parity`).

## The included-trade set (one per screen state)

`selectTrades(dataset, filter)`:
1. the requested attempts found in the dataset (missing ids are named, never substituted);
2. their trades, unique by trade id, of those attempts only;
3. **closed** (an exit and `pnlStatus ≠ open`); open trades are counted as excluded;
4. the filter: trading-day range (the stored day of each trade's own account), symbol root (instrument root, or the
   symbol when it matches no instrument), side, strategy (or "No strategy"), tag, source;
5. one currency: the filter's, or the only one present. Several currencies without a choice is a **conflict**: no money
   is aggregated and the UI asks for a currency (no FX conversion ever);
6. order: trading day, exit instant, trade id.

Every figure is `summarize` over a subset of this set (a period, weekday, symbol, strategy, tag, attempt), so each
figure's drill-down is exactly `summary.tradeIds` (or a named subset such as `winIds`), and the drawer recomputes its
totals with the same function.

## Metric definitions

| Metric | Definition | No value |
|---|---|---|
| Eligible | closed with a known net P&L | unknown P&L is counted (`unknownPnl`), never zero |
| Outcome | net > 0 win, < 0 loss, = 0 break-even | — |
| Net / gross P&L, fees | exact sums over eligible trades (so net = gross − fees) | N/A without closed trades; Unknown when every P&L is unknown; Unknown (`too_large`) outside the micro-unit range |
| Win rate | wins ÷ eligible (break-evens in the denominator), one decimal; **the Build 20 Journal's definition** | N/A without eligible trades |
| Average winner / loser | sum ÷ count, micro-unit rounding | N/A without winners / losers |
| Expectancy (net or gross) | sum ÷ eligible | insufficient below 5 eligible trades |
| Profit factor | winning net ÷ \|losing net\|, two decimals | N/A without a loss (never infinity); insufficient below 5 |
| Average R | mean of the reviews' R multiples (each two decimals), two decimals, only trades with a planned risk; coverage shown | N/A without planned risk; insufficient below 5 |
| Closed-trade P&L curve | running sum of known results in exit order, from 0 at the start of the selection | labelled "not an account balance, equity or drawdown" |
| Periods | day = stored trading day; week = its Monday; month/year from the day key | a period with an unknown trade is *incomplete*; the calendar shows "—" without a tint, sums show the known part only where labelled |
| Best / worst / average month (or day) | over periods with a known result; ties go to the earliest | N/A without one |
| Pass rate | passed ÷ (passed + failed) of the **selected** attempts, statuses as entered; active, paused and closed are listed as left out | N/A without a resolved attempt |

Rounding is always half away from zero. `INSIGHTS_MIN_SAMPLE = 5` is a documented product constant, not a
statistical claim. Fees missing from an import are stored as 0 by Build 17 and shown as recorded.

## Screens

`/insights` (sidebar Insights). Head: account picker (status checkboxes, "Include archived attempts", explicit
selection; default is the active account), Net / Gross. Body: filters, provenance line (attempts, included count,
currency, basis, journal read time, definitions version, open/deleted/filtered/other-currency exclusions), notices
(missing accounts, failed imports, currency conflict, unknown P&L), then tabs:

- **Overview**: five KPI cards, best/worst/average month, closed-trade P&L curve (chart or table), Trades and Days and
  months `StatList`s, weekday bars, setups and mistakes tables when recorded.
- **Calendar**: Net/Gross P&L, Trades or Win rate cells; `MonthYearPicker`; selected day or week panel with "View
  trades" and, for a day, each attempt's daily review link and status; yearly table (month cells jump, year totals drill).
- **Breakdowns**: day/week/month bars and table; symbol root, weekday, side, source, strategy tables.
- **Tags** (only when a selected trade has a tag): setups, mistakes, mindset, other; rows overlap and say so.
- **Attempts**: one row per attempt (status, archived, broker number, trades, days traded, range, P&L, win rate,
  expectancy, profit factor, "Reported: …" / "Not stated"), optional reset-chain grouping with every included attempt
  listed and a combined row only for one currency, pass rate with its cohort, reported failure reasons.

Every number, bar, cell and row opens the **contributing-trades drawer**; its rows open Trade detail at
`/journal/trades/:id?account=<attempt>` (new: Trade detail accepts an explicit attempt, archived ones read-only), with
"Back to Insights" returning to the same URL. All choices live in the URL, so navigation back restores them.

Design system additions (with tests and a gallery section): `PnlCalendar` `selectedDay`, `onSelectWeek` /
`selectedWeek`, `display` (`pnl` / `trades` / `winRate`), `title` / `summary` slots, "P&L unknown" labels; `PnlBars`
(diverging bars whose labelled rows are the chart's text alternative).

## Query keys and invalidation

`featureKeys.insights(ids)` is keyed by the sorted attempt ids, so another selection never reuses a result. The root
`insightsRoot` is invalidated by trade create/correct/delete/restore, CSV import commits (including failed ones: the
failed-import count), review and screenshot writes, library writes and account writes (create, edit, status, archive,
restore, reset). Daily-review writes do **not** invalidate it: Insights shows no daily-review content from the dataset,
and the calendar's review status comes from the Build 22 index, which those writes already refresh.

## Acceptance traceability

| Criterion | Where | Test |
|---|---|---|
| Exact metrics: fees, short trades, missing values, break-evens, zero denominators, rounding, overflow | `metrics.ts`, `insights.rs` | parity fixture (10 cases, Rust-generated); `metrics.test.ts` |
| Every segment resolves to exactly its trades; totals agree with parts | `report.ts` groups, drawer | `report.test.ts` "groups agree with the total…" (day/week/month/year partitions, weekday, side, symbol, strategy, tags); UI "opens exactly the contributing trades…" |
| Filter, chart and table agree under account switching and re-import | one selection per state; keys by ids | UI "follows the active account…", "refreshes after a trade is deleted…"; Rust "deleted_trades_are_left_out… restores come back" |
| N/A / insufficient / unknown / empty / conflict states | `moneyView`, page states | UI "defaults to the active attempt…", "never adds currencies…", "separates no closed trades from filters…", "shows a load failure…" |
| Reset attempts, reused broker number, failed and archived history, no inferred failure | Rust read, Attempts tab | Rust `attempts_never_share_trades…`, `history_is_readable…`; `report.test.ts` attempt comparison; UI "compares failed, passed (archived) and active attempts…", "groups reset chains…" |
| Trading-day boundaries, DST, reset change | stored days only | Rust `trading_days_are_the_stored_ones_across_dst_and_reset_changes`; domain calendar arithmetic across years |
| Corrections, strategy/tag changes, R only with planned risk | Rust read | Rust `corrections_review_tags_and_planned_risk_reach_the_dataset` |
| Navigation Insights → Trade detail (archived) → back; daily review links | `tradePath(id, account)`, calendar panel | UI "opens a drilled trade of an archived attempt…", "calendar: … links to its daily review…" |
| Keyboard, focus return, chart text alternatives | `DrillButton`, `PnlBars`, curve table | UI keyboard drill + Escape focus return; design-system `PnlBars`/`PnlCalendar` tests |
| Restart persistence | file journal reopened | Rust `a_restarted_file_journal_reads_the_same_dataset` |
| Wire contract | `command-wire.json` `insights` | `wire-contract.test.ts` Insights case; `insights-wire.test.ts` |

## Limitations and follow-ups

- **Not verified here: a packaged Windows/Tauri run** (offline: import → annotate → Insights → drill → archive/fail →
  compare → restart). The native app has no data-directory override, so it was not run against the real journal.
  Restart persistence is covered by the Rust file-journal test; the UI by jsdom journeys over an in-memory fake.
  Independent packaged QA is required, including large-journal performance: **no benchmark was run**; the read is one
  SQL query plus one tag query per request and aggregation is client-side.
- Hour-of-entry and hold-time breakdowns, cash ROI, payouts and fees paid to firms are out of scope (Triage / Build 28.4).
- Fee completeness is not tracked by the schema (missing fees are stored as 0).
- The Journal trade log still has no exact-id filter; the drill-down is the Insights drawer plus per-trade links.
- Failure-reason trajectories (P&L paths per reason) are not drawn; reasons are counted and drill to their attempts' trades.
