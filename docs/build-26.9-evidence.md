# Build 26.9 evidence: Add Fake Data and Reset All Data

Card: [Seed realistic demo data for app and UI testing](https://app.notion.com/p/4001bd4b6bde8155b3dde33b22712e89).
Developer guide: [docs/development/dev-tools.md](development/dev-tools.md).

## What was verified in the running desktop app

The debug app (`target/debug/fundedflow`, `FUNDEDFLOW_DEV_DATA_DIR=<repo>/.dev-journal/com.fundedflow.desktop`) was
driven through WebDriver (`tauri-driver` + WebKitWebDriver) on Linux under Xvfb, with the Vite dev server. Seed 2609,
anchor 2026-10-21 (the default: today in New York).

| Step | Result |
| --- | --- |
| Sidebar on an empty test journal | Add Fake Data, Reset All Data, Settings in that order in the footer; collapsed: icon-only, tooltip and focus ring ([04](evidence/build-26.9/04-collapsed-sidebar-tooltip.png)) |
| Add Fake Data → Generate (UI Smoke) | 7 accounts, 532 trades in 1.4–1.8 s; Today and Accounts refreshed behind the dialog without a reload ([01](evidence/build-26.9/01-add-fake-data-dialog.png), [02](evidence/build-26.9/02-add-fake-data-success.png)) |
| Generate again | Refused: *Nothing was added*, every scenario already present; counts unchanged ([03](evidence/build-26.9/03-repeat-refused.png)) |
| Today, Accounts, Journal (by day, trade log, reviews) | Seeded accounts, statuses (Live 4 / Passed 1 / Failed 1 / Archived 1), rulebooks, needs-setup states, today's overnight trades, completed/draft/no-trade-day reviews, tags ([05](evidence/build-26.9/05-today-happy-path.png), [06](evidence/build-26.9/06-journal-by-day.png), [07](evidence/build-26.9/07-accounts.png)) |
| Calculate estimate (history stated complete, rule amounts USD) | `at_risk`: balance $151,822.34, daily loss room $1,500.00, floor $151,301.92, headroom $520.42; `happy_path`: balance $51,598.77, today +$95.15, target progress $1,598.77 of $3,000, floor $49,598.77. All equal the seed report ([08](evidence/build-26.9/08-risk-at-risk-calculated.png)) |
| Reset All Data | Preview from the existing tool with counts, backup location and CLI equivalent; Reset disabled until `RESET` ([09](evidence/build-26.9/09-reset-preview.png)) |
| Reset → handoff | The app closed its journal and quit; the helper waited for the process, called `resetTestData`, and reported *completed*. The backup held all 7 accounts, 532 trades, 2 imports, 49 journal entries, 153 trade reviews and 13 daily reviews; the active directory was empty |
| Restart | Fresh journal; one-time toast with the backup path; report cleared ([10](evidence/build-26.9/10-after-reset-toast.png)) |
| A stale FundedFlow left running on the same test journal | New instances showed no journal data (the account selector never appeared) until it was stopped, consistent with the existing journal-lock safeguard (not separately screenshotted) |
| CLI | `npm run seed:test-journal`, `npm run reset:test-journal [-- --yes]` seed and reset the same directory |

Found and fixed during this QA: the engine trails end-of-day settlement observations, not trades, so the seeder now
records one per traded day (one second before the reset, after that day's last close); the success list overflowed
with long names.

## UI/UX checklist (card)

- [x] Sidebar navigation, account table/cards, truncated long names, empty-account and needs-setup states.
- [x] Today: estimate panel with balance, today's P&L, target, daily loss and drawdown values after Calculate; status
  badges; last-trade information.
- [x] Journal by day: positive/negative/no-trade days, day summaries, trade table with tags and review state.
- [ ] Calendar month/year navigation and Insights charts with seeded data were not screenshotted in this run (the
  data is there; Insights needs accounts chosen in its picker).
- [x] Currency/sign formatting and account time zone in trade times (New York; London and Chicago accounts exist).
- [ ] Windows (WebView2) development and packaged builds: not available in this Linux environment.

## Automated checks

| Check | Result |
| --- | --- |
| `cargo test` (src-tauri) | All pass except 4 `db::legacy_rulebook_tests` that fail identically on untouched `main` in this sandbox ("disk I/O error" opening a read-only fixture); `dev_tools`: 23 tests |
| `cargo clippy --all-targets -- -D warnings` | Clean |
| `cargo check --release` | Clean, no warnings (no `dev_tools` code compiled) |
| `npm run typecheck` | Pass |
| `npm test` | Pass (see the PR for the run; `uncertain-writes-p0` journey timing under full-suite load is noted there) |
| `npm run build` | Pass, including `check-no-dev-tools.mjs` (a development bundle contains 8 markers; the production bundle none) |
| `npm run test:dev-scripts` | 19 pass (existing reset tool + handoff helper + launcher) |

## Limits

- Windows: the detached helper uses `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, trying `CREATE_BREAKAWAY_FROM_JOB`
  first so a `cargo run` job does not end it. Not run on Windows here; if the helper were ended early, the report
  stays *pending* and nothing is reset (the reset is one directory rename). The Node tests run on Windows in CI.
- `tauri dev` ends with the app, so FundedFlow is reopened by hand after a reset (`npm run dev:test-journal`).
- Risk snapshots, screenshots/attachments, ledger entries, catalogue offers and reconciliations are not generated.
