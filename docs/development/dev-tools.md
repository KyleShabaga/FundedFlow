# Developer tools: Add Fake Data and Reset All Data

Task: [Build 26.9: seed realistic demo data for app and UI testing](https://app.notion.com/p/4001bd4b6bde8155b3dde33b22712e89).
Reset tool reused as is: [reset-test-data.md](reset-test-data.md) (Build 26.8).

Two developer-only actions sit in the sidebar footer, directly above **Settings**:

| Action | What it does | CLI equivalent |
| --- | --- | --- |
| **Add Fake Data** (database-plus icon) | Adds clearly labeled *DEMO / TEST DATA* accounts, rules, trades, CSV imports, reviews and notes to the **isolated test journal**. Never deletes anything. | `npm run seed:test-journal -- [--preset stress] [--seed N] [--anchor YYYY-MM-DD] [--scenario a,b]` |
| **Reset All Data** (rotate icon) | Resets the **entire** test journal (not only fake records) with the existing `scripts/reset-test-data.mjs`, which moves it to a backup beside it. | `npm run reset:test-journal` (preview), then `npm run reset:test-journal -- --yes` with FundedFlow closed |

## 1. Start FundedFlow on the isolated test journal

```sh
npm run dev:test-journal
```

This runs `npm run tauri dev` with `FUNDEDFLOW_DEV_DATA_DIR=<repo>/.dev-journal/com.fundedflow.desktop`
(git-ignored). Set `FUNDEDFLOW_DEV_DATA_DIR` yourself to use another directory; it must be an absolute path ending in
an app-specific `com.fundedflow.desktop` directory (the reset tool accepts nothing else), must be a real directory
(no symlink), and must not be, contain or sit inside the per-user journal (`%APPDATA%\com.fundedflow.desktop` on
Windows). A refused value stops the journal from opening with a data-folder error; FundedFlow never falls back to the
real journal.

Plain `npm run tauri dev` still opens the per-user journal. The two buttons are visible there, but their dialogs show
*Isolated test journal required* and the native commands refuse: neither tool ever acts on the per-user journal.

### More than one window at a time

Each FundedFlow process locks the journal it opens (`fundedflow.lock`), so a second process on the same journal shows
*Another FundedFlow process owns this journal*, and a second `tauri dev` cannot start either (port 1420 is taken and
Windows will not rebuild a running exe). To test side by side, leave the first window running and, in another
terminal:

```sh
npm run dev:another-window        # window 2
npm run dev:another-window -- 3   # window 3, and so on
```

Each extra window runs a copy of the debug build `tauri dev` already made (so `tauri dev` can still rebuild), loads
the same dev server (so it hot-reloads too) and opens its own isolated journal in
`<repo>/.dev-journal/window-<n>/com.fundedflow.desktop`, with the developer tools enabled. Rust changes reach extra
windows only when you start them again after `tauri dev` has rebuilt. To seed one
from the command line, set `FUNDEDFLOW_DEV_DATA_DIR` to its directory and run `npm run seed:test-journal`.

## 2. Add Fake Data

Click **Add Fake Data**. The dialog shows the resolved test-journal directory, the presets and an optional seed.
**Generate** runs the native seeder; the dialog cannot be dismissed and the button cannot run twice while it works.
On success it lists the accounts created and refreshes every journal screen (Today, Accounts, the Journal calendar
and trade list, Insights) by invalidating the app's query cache; no page reload. A failure shows the reason and
*Nothing was added*.

### Presets

| Preset | Accounts | Trades (seed 2609) | History |
| --- | --- | --- | --- |
| **UI Smoke** (default) | 7: `happy_path`, `passed`, `at_risk`, `failed`, `archived`, `empty`, `import_duplicates` | about 530 | 120 days |
| **Stress / Edge Cases** | the same 7 plus `stress` | about 890 | 180 days |

Trade counts move slightly with the seed and the anchor day; the tests hold UI Smoke between 300 and 1,000 trades and
Stress above UI Smoke and at most 1,000, across several seeds.

### Named scenarios

Every scenario is one account. Names start with `DEMO ·`, notes start with `DEMO / TEST DATA`, firms are
`DEMO Firm … (fictional)`, and each rulebook is a private *DEMO rules* rulebook marked as not firm policy.

| Scenario | Account | Covers |
| --- | --- | --- |
| `happy_path` | 50K evaluation, Tradovate, New York, 17:00 reset; target $3,000, trailing EOD max loss $2,000, daily loss $1,000, 40% consistency, minimum days, contract limits, a manual news rule | Active and on track (30–80% of target); multi-trade days; a 12-trade day; a large winning and a large losing day; win/loss streaks; trades at 16:59 (Wednesday) and 17:03 ET (counts for Thursday); a Sunday-evening trade on Monday; trades on the Monday after a DST change when one is in the window; overnight trades that count for *today*; eight completed daily reviews plus a no-trade-day review |
| `passed` | 100K evaluation, Rithmic, Chicago, 16:00 reset; target $6,000 | Target reached; status *passed* on that day; no trades after it |
| `at_risk` | 150K sim funded, NinjaTrader; trailing max loss $4,500, daily loss $1,500; a long name | Ends about 12% of the drawdown above the floor after three losing days; draft daily reviews on those days |
| `failed` | 50K evaluation, ProjectX | A losing streak, then revenge trades through the floor; status *failed* on the breach day; a completed review of that day; no later trades |
| `archived` | 25K evaluation | Six weeks of trades early in the window, then *closed* and archived |
| `empty` | 50K evaluation | No trades, no rulebook, no opening balance: empty states and incomplete setup |
| `import_duplicates` | 50K evaluation, London, 22:00 reset, no rulebook | Two CSV files through the normal preview → acknowledge → commit path: the second repeats three already-imported rows, one row twice and one unreadable price, which the import reports and does not store |
| `stress` (Stress only) | 250K sim funded with a 90-character name; static max loss | Ten instruments, days of 20–30 trades |

Instruments are the built-in NQ, MNQ, ES, MES, YM, MYM, RTY, M2K, CL, MCL, GC and MGC with front-month symbols
(`MNQZ6`). Trades are long and short, winners, losers and breakevens, with round-turn fees per contract and the
occasional slipped stop (noted on the trade). Most trades and days have no notes on purpose (*missing notes*).
About a third of trades in the reviewed scenarios have a trade review (strategy, setup/mistake/emotion tags, a
checklist, planned stop/target/risk, rating); about one traded day in five has a journal entry tagged `demo-data`.
Every account with rules has a confirmed opening-balance observation; accounts with an end-of-day trailing max loss
also get one firm-dashboard end-of-day settlement per traded day, stamped one second before the reset (the risk
engine trails recorded settlements, not trades, and checks each against the trades closed by then). Weekends never have trading days: a weekend trade rolls to Monday, and with no trades today most accounts show the
*no trades today* state.

### How it is generated

`apps/desktop/src-tauri/src/dev_tools/plan.rs` builds a pure plan per scenario from `(scenario, preset, seed,
anchor day)` with its own random stream (SplitMix64), so a scenario seeded alone is identical to the same scenario in
a preset. `seed.rs` writes the plan through the existing store functions (`accounts`, `rulebooks`, `trades`,
`csv_import`, `reviews`, `daily_reviews`, `journal`, `library`, `evidence`), so everything passes the same validation
as the app's own commands and the store derives every trading day and P&L. After writing each account, the seeder
reads its trades back and fails unless each stored trade's trading day and net P&L equal the plan. Balances, equity
curves, the calendar, Today and Insights are calculated by the app from those trades, rules and observations.

The run is all or nothing: SQLite's backup API copies the journal to `dev-seed-rollback.db` first, and any failure
restores that copy. A `dev_tools.seed` setting marks a run in progress; if FundedFlow is killed mid-run, the next run
refuses and asks for Reset All Data. Seeding refuses a journal with any account it did not create, skips scenarios
already present (so UI Smoke followed by Stress adds only `stress`), and refuses when nothing is left to add.

To see risk figures, choose an account on Today, press **Calculate estimate**, state the history complete and the rule
amounts in USD, and save. The engine's balance, daily loss room and drawdown floor then equal the report's ending
balance and reference floor (verified for `at_risk`: $151,822.34, floor $151,301.92, headroom $520.42; `happy_path`:
$51,598.77, floor $49,598.77, with seed 2609 and anchor 2026-10-21).

Not generated (gaps, by design): risk **calculations/snapshots** (an explicit *Calculate and save* in the app with
user-chosen coverage; use it on Today or the rulebook page), screenshots/attachments, ledger entries, catalogue
offers and reconciliations.

### Reproducing a dataset

The same seed, preset and anchor day always produce the same accounts, trades and totals; only record ids and
created-at times differ. The anchor defaults to today in New York, so pin it to reproduce screenshots:

```sh
npm run reset:test-journal -- --yes            # FundedFlow closed
npm run seed:test-journal -- --preset ui_smoke --seed 2609 --anchor 2026-10-21
npm run seed:test-journal -- --scenario failed --anchor 2026-10-21   # one scenario into a clean journal
```

The CLI (`cargo run --example seed-demo-journal`) prints the same report as the dialog: per account the trade,
win/loss/breakeven and day counts, net P&L, fees, ending balance and the reference drawdown floor. It takes the app's
own journal lock, so it refuses while FundedFlow has the journal open.

## 3. Reset All Data

Click **Reset All Data**. The dialog first runs the existing tool in preview mode (`--all`, never `--yes`) on the
test journal, which applies its own identifier, path and symlink checks. It shows the directory, the tool's scope
(*all local journal data*: accounts, trades, imports, journal entries, rulebooks, settings, snapshots, attachments),
record counts, the backup location and the command-line equivalent. **Reset** stays disabled until you type `RESET`
exactly; Cancel and Escape close without acting.

On **Reset**:

1. The app checks `RESET` again and re-runs the tool's preview, so a missing Node.js or a refused target stops here.
2. It writes a *pending* report to `com.fundedflow.desktop.dev-reset.json` beside the test journal.
3. It checkpoints and closes the journal and releases the directory lock (`fundedflow.lock`); data commands report
   the journal unavailable from here.
4. It starts `scripts/dev-reset-handoff.mjs` detached (its own process group; on Windows detached, breaking away from
   the `cargo run` job when allowed) and quits. If the helper cannot start, the journal is reopened and nothing is reset.
5. The helper waits for the app's process to exit and for no `fundedflow` process to remain (60 s each), then calls
   the tool's `resetTestData`, which checks for running FundedFlow processes again and refuses if one is found or the
   process list cannot be read.
6. It records *completed* (with the backup path), *unchanged* (empty directory) or *failed* (nothing reset) in the
   report and in `com.fundedflow.desktop.dev-reset.log`.

Start FundedFlow again with `npm run dev:test-journal` (a `tauri dev` session ends with the app, so it is not
restarted automatically). A toast shows the result and the backup path once, then the report is cleared. A report
still *pending* at the next start means the helper never finished: nothing was reset unless a backup directory
exists; use `npm run reset:test-journal -- --yes` with FundedFlow closed.

### Backup and recovery

The tool moves the whole directory (database, WAL/SHM, attachments, the lock file) to
`<test journal>.backup-<timestamp>-<id>` on the same disk and recreates an empty directory; the next start creates
a fresh journal. To undo: close FundedFlow, move the new `com.fundedflow.desktop` directory aside and rename the
backup back. Earlier backups are kept.

## Developer builds vs production

| | `npm run tauri dev` (debug) | `npm run tauri build` (release) |
| --- | --- | --- |
| Sidebar buttons | Shown (behind `import.meta.env.DEV`, lazily loaded) | Not in the bundle: `npm run build` runs `apps/desktop/scripts/check-no-dev-tools.mjs`, which fails if any developer-tool code or command name is in `dist` |
| Native commands `dev_tools_status`, `dev_seed_fake_data`, `dev_reset_preview`, `dev_reset_handoff`, `dev_dismiss_reset_report` | Registered | Not compiled: `src-tauri/src/dev_tools` and its command registration are `cfg(debug_assertions)` |
| `FUNDEDFLOW_DEV_DATA_DIR` | Opens the isolated test journal | Ignored |
| Actions | Only on an isolated test journal; refused on the per-user journal | n/a |

## Tests

```sh
npm run test:dev-scripts                                   # reset tool + handoff helper + launcher (Node)
npx vitest run src/app/dev-tools                           # in apps/desktop: sidebar, gating, dialogs
cargo test --lib dev_tools                                 # in apps/desktop/src-tauri: plans, seeding, isolation, handoff close
```

They cover deterministic plans and repeat seeding, every scenario's edge case, trade/account relationships and P&L
reconciliation with the store, rollback after a failure part way, refusal of journals with real accounts or an
interrupted run, directory isolation, the busy guard, the typed confirmation, closing and reopening the journal for
the handoff, the helper's waits and refusals (app still open, another instance, process-list failure, symlink, empty
journal) with the backup preserved, sidebar order and collapsed tooltips, and production exclusion.
