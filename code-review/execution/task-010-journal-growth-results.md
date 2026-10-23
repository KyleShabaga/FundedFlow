# TASK-010 r2: journal growth per risk calculation (ISSUE-002 escalation check)

**Result: 64 MiB is reachable within 12 months of ordinary use. Under the decision rule, ISSUE-002 escalates to P0, and the D-ARCH / ISSUE-002c frozen-input redesign task should be proposed. Runbook §6 stop: the task was NOT created. This is for Kyle's decision.**

## Record
| Field | Value |
|---|---|
| Spec | TASK-010 r2, sha256 9e43bec6858e6f93a41e03cde6726b7347eedd31278a1b4f99a68219928c3704 (verified) |
| Approval card | https://app.notion.com/p/4011bd4b6bde8168bb9cda65fc21b23f |
| Roadmap card | https://app.notion.com/p/4021bd4b6bde81759072da63e8ea0c07 |
| Tester / date | Claude Code (track C session), 2026-10-22 (America/Edmonton evening) |
| Source SHA | cfaefb909af884ccae66b9a24ac74bef81cca032 (origin/main; includes TASK-012, TASK-013 #118 and TASK-034). No installer; not applicable. |
| Environment | Windows 11 Pro 10.0.26200, cargo 1.99.1, debug test profile, SQLite page_size 4096 |
| Data | Disposable only. The seed is in the session scratchpad; each scenario ran on a copy in a fresh `tempfile` dir under %TEMP%. `%APPDATA%\com.fundedflow.desktop` was never touched. Every temp journal was deleted afterwards (one left by the stopped run, 160.6 MB, was deleted by hand). |
| Fixture env | FUNDEDFLOW_UPDATE_FIXTURES, FFC_UPDATE_FIXTURES and FUNDEDFLOW_UPGRADE_DB were unset |
| Repository changes | None. The scratch harness (`src/data_controls/zz_task010_growth.rs` plus one temporary `mod` line) was uncommitted and has been deleted; `git status` is clean. |

## Commands
1. Seed, in `apps/desktop/src-tauri`: `cargo run --offline --locked --example seed-demo-journal -- --data-dir <scratchpad>\task010\seed\com.fundedflow.desktop --preset stress`. This made 8 accounts and 880 trades; the database was 2,670,592 bytes.
2. Harness, run from the same directory:
   - Command: `TASK010_SEED_DB=<seed db> TASK010_OUT=<csv> cargo test --offline --locked --lib task010 -- --ignored --nocapture`.
   - For each N it copies the seed to a temp dir and takes the seeded account with the most trades.
   - It tops that account up to N trades with synthetic closed trades (via `store::trades::create`).
   - It then runs K calculations through the real `risk_promotion::capture` and `risk_promotion::promote`. The payload has the same shape as `risk_promotion_tests::calc`: an Unknown result whose `explanation.inputs` is the full capture, as the TS engine hands it over.
   - At each K step it checkpoints the WAL and records the file size, `page_count`, `freelist_count`, the used bytes (the live and export page check), the sum of `explanation_json` lengths, and the size of `data.json`. The last uses the export's own `archive::dump` plus `serde_json::to_vec`, and has its own 64 MiB cap at `archive.rs:262`.

## Measurements (one account, N trades, K calculations)
| N | K | file bytes | page_count | freelist | used bytes | snapshots | explanation_json total | data.json bytes |
|---|---|---|---|---|---|---|---|---|
| 500 | 0 | 2,863,104 | 699 | 0 | 2,863,104 | 0 | 0 | 2,339,171 |
| 500 | 1 | 3,149,824 | 769 | 0 | 3,149,824 | 1 | 287,151 | 2,667,480 |
| 500 | 50 | 17,264,640 | 4,215 | 0 | 17,264,640 | 50 | 14,357,550 | 18,754,940 |
| 500 | 250 | **74,895,360** | 18,285 | 0 | **74,895,360 (> 64 MiB)** | 250 | 71,787,750 | not dumped (page check refuses first) |
| 2,000 | 0 | 3,747,840 | 915 | 0 | 3,747,840 | 0 | 0 | 3,680,796 |
| 2,000 | 1 | 4,882,432 | 1,192 | 0 | 4,882,432 | 1 | 1,133,651 | 4,973,605 |
| 2,000 | 50 | 60,518,400 | 14,775 | 0 | 60,518,400 | 50 | 56,682,550 | **68,321,565 (> 64 MiB)** |

Not run: N=2,000 × K=250 (stopped partway, at 160.6 MB) and N=10,000 × K=1/50. They were stopped once the decision was clear, to stop loading the shared machine. Growth is linear in N × K, so they would only be larger.

**Rates:**
- Each calculation stores about 567–574 bytes per trade in the account (`explanation_json`), and adds about 646 bytes per trade to `data.json`.
- At 500 trades: +288 KB of pages and +328 KB of `data.json` per calculation.
- At 2,000 trades: +1.14 MB of pages and +1.29 MB of `data.json` per calculation.
- `freelist_count` stays 0, since nothing is deleted, so the used-pages change (TASK-013) does not help here.
- `data.json` reaches 64 MiB (67,108,864 bytes) first: after about 49 calculations at 2,000 trades, or about 197 at 500.

## 12-month extrapolation (decision rule: P0 if 64 MiB is reachable within 12 months)
Calculations are manual only (Today/Accounts "Calculate estimate", `isEndOfDay=false`); nothing calculates automatically.

**Model:**
- Trades grow linearly at t per trading day, with c calculations per trading day and 252 trading days a year.
- After d trading days, `data.json` ≈ 646 × c × t × d² / 2 bytes, plus a few MB of base.

**Reaching 64 MiB at one calculation per trading day:**
| Trades per day | Trading days | Months, about |
|---|---|---|
| 4 | 222 | 10.6 |
| 10 | 141 | 6.7 |
| 20 (the seeder's stress preset, which seeds 20–30/day) | 100 | 4.7 |

**Calculation rate that reaches the cap within 12 months:** c × T ≈ 790, where T is trades per year.
| Trades per year | Calculations per trading day | Roughly |
|---|---|---|
| 1,000 | 0.8 | — |
| 2,500 | 0.32 | one every 3 days |
| 5,000 | 0.16 | about weekly |

All accounts share one journal, so multiple accounts add up.

**Conclusion: reachable within 12 months.** ISSUE-002 → P0, and the D-ARCH / ISSUE-002c redesign should be proposed for approval.

## Limits of this measurement
- The harness payload is an Unknown result. Real engine calculations also carry rule metrics, evidence and assumptions, so real snapshots are the same size or larger. The frozen trade list dominates either way.
- It measures one account. A debug build affects only the timing, not the sizes.

## Acceptance criteria status
- Measurement table recorded with SHA and environment: done (above).
- Escalation decision recorded and reflected in TASK-013 priority: **the decision is P0 per the rule; it is for Kyle to record.** TASK-013 already merged (#118, used pages only), and it does not reduce this growth.
- New D-ARCH task created and proposed, and TASK-013/014 priorities updated: **NOT done.** Runbook §6 says to stop and report.
