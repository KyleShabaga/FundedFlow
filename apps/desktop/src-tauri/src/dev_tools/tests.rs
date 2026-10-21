//! Build 26.9 developer tools: deterministic plans, scenario coverage, the seeded journal
//! reconciling with the store, all-or-nothing runs, repeat runs, isolation of the test
//! journal and the reset handoff's close.

use std::path::{Path, PathBuf};

use chrono::{Datelike, NaiveDate, Weekday};
use rusqlite::Connection;

use super::plan::{self, Preset, ScenarioPlan};
use super::seed::{self, SeedOptions};
use super::{validate_isolated, DevEnvironment, DevState};
use crate::error::AppError;
use crate::store::{accounts, settings, tests::db, trades};

const ID: &str = "com.fundedflow.desktop";
/// A fixed anchor (a Friday) whose 120-day window includes the March 2026 DST change.
const ANCHOR: &str = "2026-03-20";

fn anchor() -> NaiveDate {
    plan::parse_day(ANCHOR).unwrap()
}

fn plans(preset: Preset, seed: u32) -> Vec<ScenarioPlan> {
    preset.scenarios().iter().map(|k| plan::plan(k, preset, seed, anchor()).unwrap()).collect()
}

fn options(preset: Preset) -> SeedOptions {
    SeedOptions { preset, seed: None, anchor_day: Some(ANCHOR.into()), scenarios: None }
}

fn total(plans: &[ScenarioPlan]) -> usize {
    plans.iter().map(|p| p.all_trades().count()).sum()
}

fn find<'a>(plans: &'a [ScenarioPlan], key: &str) -> &'a ScenarioPlan {
    plans.iter().find(|p| p.key == key).unwrap()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

#[test]
fn plans_are_deterministic_per_seed_and_a_scenario_alone_matches_the_preset() {
    assert_eq!(plans(Preset::UiSmoke, 2609), plans(Preset::UiSmoke, 2609));
    assert_ne!(plans(Preset::UiSmoke, 2609), plans(Preset::UiSmoke, 2610));
    // Each scenario has its own random stream: reloading one gives exactly the same records.
    let alone = plan::plan("at_risk", Preset::UiSmoke, 2609, anchor()).unwrap();
    assert_eq!(&alone, find(&plans(Preset::UiSmoke, 2609), "at_risk"));
    assert!(plan::plan("nope", Preset::UiSmoke, 1, anchor()).is_none());
}

#[test]
fn presets_have_the_documented_size_and_window() {
    for seed in [2609, 1, 42, 99_999, 7, 123_456, 31_337] {
        let smoke = plans(Preset::UiSmoke, seed);
        let stress = plans(Preset::Stress, seed);
        assert_eq!(smoke.len(), 7);
        assert_eq!(stress.len(), 8);
        assert!((300..=1_000).contains(&total(&smoke)), "seed {seed}: {} smoke trades", total(&smoke));
        assert!(total(&stress) > total(&smoke) && total(&stress) <= 1_000, "seed {seed}: {} stress trades", total(&stress));
        for (p, days) in [(&smoke, 120), (&stress, 180)] {
            let first = p.iter().flat_map(|s| s.all_trades()).map(|t| t.trading_day).min().unwrap();
            let span = (anchor() - first).num_days();
            assert!((90..=days).contains(&span), "seed {seed}: history spans {span} days");
        }
    }
}

#[test]
fn trades_are_varied_and_their_money_adds_up() {
    let all = plans(Preset::UiSmoke, 2609);
    let trades: Vec<_> = all.iter().flat_map(|p| p.all_trades()).collect();
    let roots: std::collections::BTreeSet<&str> = trades.iter().map(|t| t.inst).collect();
    for root in ["NQ", "MNQ", "MES", "MCL", "MGC"] {
        assert!(roots.contains(root), "{root} in {roots:?}");
    }
    assert!(trades.iter().any(|t| t.long) && trades.iter().any(|t| !t.long));
    assert!(trades.iter().any(|t| t.net_cents > 0) && trades.iter().any(|t| t.net_cents < 0));
    assert!(trades.iter().any(|t| t.gross_cents == 0), "breakeven trades");
    assert!(trades.iter().all(|t| t.fee_cents > 0 && t.exit > t.entry && t.qty >= 1));
    assert!(trades.iter().any(|t| t.note.as_deref().is_some_and(|n| n.contains("slipped"))), "slippage");
    for t in &trades {
        let inst = t.instrument();
        let moved = if t.long { t.exit_ticks - t.entry_ticks } else { t.entry_ticks - t.exit_ticks };
        assert_eq!(t.gross_cents, moved * inst.tick_cents * t.qty);
        assert_eq!(t.net_cents, t.gross_cents - t.fee_cents);
        assert!(!matches!(t.trading_day.weekday(), Weekday::Sat | Weekday::Sun), "trading days run Monday to Friday");
        assert!(t.symbol.starts_with(t.inst) && t.symbol.len() == t.inst.len() + 2, "{}", t.symbol);
    }
    for p in &all {
        let mut ordered: Vec<_> = p.all_trades().map(|t| t.entry).collect();
        ordered.sort();
        assert_eq!(ordered, p.all_trades().map(|t| t.entry).collect::<Vec<_>>(), "{} trades in time order", p.key);
        assert_eq!(p.ending_cents(), p.account.start_cents + p.all_trades().map(|t| t.net_cents).sum::<i64>());
    }
}

/// The trailing EOD floor never crossed before `until` (inclusive).
fn never_breached(p: &ScenarioPlan, until: Option<NaiveDate>) -> bool {
    let rules = p.rules.as_ref().unwrap();
    let dd = rules.drawdown_cents.unwrap();
    let mut hwm = p.account.start_cents;
    for (day, balance) in &p.eod {
        if until.is_some_and(|u| *day > u) {
            break;
        }
        let floor = if rules.trailing { hwm - dd } else { p.account.start_cents - dd };
        if *balance < floor {
            return false;
        }
        if rules.trailing {
            hwm = hwm.max(*balance);
        }
    }
    true
}

#[test]
fn every_named_scenario_covers_its_edge_case() {
    for seed in [2609, 7, 123_456] {
        for preset in [Preset::UiSmoke, Preset::Stress] {
            let all = plans(preset, seed);
            let ctx = format!("seed {seed} {preset:?}");

            let happy = find(&all, "happy_path");
            let target = happy.rules.as_ref().unwrap().target_cents.unwrap();
            assert!(happy.net_cents() > target / 5 && happy.net_cents() < target * 95 / 100, "{ctx}: happy net {}", happy.net_cents());
            assert!(never_breached(happy, None), "{ctx}: happy path stays above its floor");
            assert!(happy.all_trades().any(|t| t.trading_day == anchor()), "{ctx}: trades today");
            let per_day = |p: &ScenarioPlan| {
                let mut m = std::collections::BTreeMap::new();
                for t in p.all_trades() {
                    *m.entry(t.trading_day).or_insert(0) += 1;
                }
                m
            };
            assert!(per_day(happy).values().any(|n| *n >= 12), "{ctx}: a busy day");
            let daily: std::collections::BTreeMap<NaiveDate, i64> = happy.all_trades().fold(Default::default(), |mut m, t| {
                *m.entry(t.trading_day).or_insert(0) += t.net_cents;
                m
            });
            assert!(daily.values().any(|v| *v >= 100_000) && daily.values().any(|v| *v <= -70_000), "{ctx}: large up and down days");
            let streak = |p: &ScenarioPlan, sign: i64| {
                let days: std::collections::BTreeMap<NaiveDate, i64> = p.all_trades().fold(Default::default(), |mut m, t| {
                    *m.entry(t.trading_day).or_insert(0) += t.net_cents;
                    m
                });
                days.values().collect::<Vec<_>>().windows(3).any(|w| w.iter().all(|v| **v * sign > 0))
            };
            assert!(all.iter().any(|p| streak(p, 1)), "{ctx}: consecutive winning days");
            assert!(streak(find(&all, "at_risk"), -1) && streak(find(&all, "failed"), -1), "{ctx}: consecutive losing days");
            // Either side of the 17:00 reset, and a Sunday-evening trade on Monday.
            assert!(happy.all_trades().any(|t| t.note.as_deref().is_some_and(|n| n.contains("16:59"))));
            assert!(happy.all_trades().any(|t| t.note.as_deref().is_some_and(|n| n.contains("17:03")) && t.trading_day.weekday() == Weekday::Thu));
            assert!(happy.all_trades().any(|t| t.entry.with_timezone(&chrono_tz::America::New_York).weekday() == Weekday::Sun && t.trading_day.weekday() == Weekday::Mon));

            let passed = find(&all, "passed");
            assert!(passed.net_cents() >= passed.rules.as_ref().unwrap().target_cents.unwrap(), "{ctx}: target met");
            assert_eq!(passed.status.as_ref().unwrap().status, "passed");
            assert!(passed.all_trades().all(|t| t.entry <= passed.status.as_ref().unwrap().effective_at), "{ctx}: no trades after passing");

            let at_risk = find(&all, "at_risk");
            let dd = at_risk.rules.as_ref().unwrap().drawdown_cents.unwrap();
            let headroom = at_risk.ending_cents() - at_risk.floor_cents().unwrap();
            // Messages name the case, never the money values (CodeQL: cleartext logging of journal figures).
            assert!(headroom > 0 && headroom <= dd / 4, "{ctx}: at-risk headroom within a quarter of the drawdown");
            assert!(never_breached(at_risk, None));
            assert_eq!(at_risk.watch_days.len(), 3);
            assert!(at_risk.account.name.chars().count() > 60);

            let failed = find(&all, "failed");
            assert!(!never_breached(failed, None), "{ctx}: failed breaches");
            let breach = failed.status.as_ref().unwrap();
            assert_eq!(breach.status, "failed");
            assert!(failed.all_trades().all(|t| t.entry <= breach.effective_at));

            let archived = find(&all, "archived");
            assert!(archived.archived && archived.status.as_ref().unwrap().status == "closed");

            let empty = find(&all, "empty");
            assert!(empty.all_trades().next().is_none() && empty.rules.is_none());

            let import = find(&all, "import_duplicates");
            assert!(import.trades.is_empty() && !import.imported.is_empty());
            assert_eq!(import.csv.len(), 2);
            assert_eq!(import.csv.iter().map(|f| f.new_rows).sum::<usize>(), import.imported.len());
            assert!(import.csv[1].duplicate_rows >= 2 && import.csv[1].invalid_rows == 1);

            if preset == Preset::Stress {
                let stress = find(&all, "stress");
                assert!(per_day(stress).values().any(|n| *n >= 20), "{ctx}: high-volume days");
                assert!(stress.account.name.chars().count() >= 80 && stress.account.name.chars().count() <= 100);
            }
        }
    }
}

#[test]
fn every_settlement_matches_the_trades_closed_by_its_time() {
    // The risk engine flags a settlement that differs from opening balance + trades closed by then.
    for preset in [Preset::UiSmoke, Preset::Stress] {
        for p in plans(preset, 2609).iter().filter(|p| p.rules.as_ref().is_some_and(|r| r.trailing)) {
            for (day, balance) in &p.eod {
                let at = seed::settlement_at(p, *day);
                let closed: i64 = p.all_trades().filter(|t| t.exit <= at).map(|t| t.net_cents).sum();
                assert_eq!(p.account.start_cents + closed, *balance, "{} {day}", p.key);
            }
        }
    }
}

#[test]
fn a_dst_change_in_the_window_gets_trades_on_its_monday() {
    let happy = plan::plan("happy_path", Preset::UiSmoke, 2609, anchor()).unwrap();
    // 2026-03-08 (US DST start) is a Sunday; its Monday is 2026-03-09.
    let monday = NaiveDate::from_ymd_opt(2026, 3, 9).unwrap();
    assert!(happy.all_trades().any(|t| t.trading_day == monday && t.entry.with_timezone(&chrono_tz::America::New_York).weekday() == Weekday::Sun));
}

#[test]
fn options_are_validated() {
    let bad = |o: SeedOptions| seed::plans(&o).unwrap_err();
    assert!(matches!(bad(SeedOptions { anchor_day: Some("2026-13-01".into()), ..options(Preset::UiSmoke) }), AppError::Validation { .. }));
    assert!(matches!(bad(SeedOptions { anchor_day: Some("2999-01-01".into()), ..options(Preset::UiSmoke) }), AppError::Validation { .. }));
    assert!(matches!(bad(SeedOptions { scenarios: Some(vec!["nope".into()]), ..options(Preset::UiSmoke) }), AppError::Validation { .. }));
    assert!(matches!(bad(SeedOptions { scenarios: Some(vec![]), ..options(Preset::UiSmoke) }), AppError::Validation { .. }));
    assert!(matches!(bad(SeedOptions { scenarios: Some(vec!["empty".into(), "empty".into()]), ..options(Preset::UiSmoke) }), AppError::Validation { .. }));
    let (seed, _, plans) = seed::plans(&options(Preset::UiSmoke)).unwrap();
    assert_eq!((seed, plans.len()), (seed::DEFAULT_SEED, 7));
}

// ---------------------------------------------------------------------------
// Seeding a journal
// ---------------------------------------------------------------------------

fn seeded(preset: Preset) -> (Connection, tempfile::TempDir, seed::SeedReport) {
    let mut conn = db();
    let dir = tempfile::tempdir().unwrap();
    let report = seed::run(&mut conn, dir.path(), &options(preset)).unwrap();
    (conn, dir, report)
}

#[test]
fn the_seeded_journal_reconciles_with_the_plan_and_uses_existing_models() {
    let (conn, dir, report) = seeded(Preset::UiSmoke);
    let expected = plans(Preset::UiSmoke, seed::DEFAULT_SEED);
    assert_eq!(report.total_accounts, 7);
    assert_eq!(report.total_trades, total(&expected));
    assert_eq!(count(&conn, "SELECT count(*) FROM accounts"), 7);
    assert_eq!(count(&conn, "SELECT count(*) FROM trades WHERE deleted_at IS NULL") as usize, total(&expected));
    assert!(!seed::rollback_path(dir.path()).exists(), "the rollback copy is removed after success");

    for r in &report.accounts {
        let p = find(&expected, &r.scenario);
        let account = accounts::get_any(&conn, &r.account_id).unwrap();
        assert!(account.name.starts_with("DEMO") && account.notes.as_deref().unwrap().starts_with(seed::DEMO_LABEL));
        assert_eq!(account.status, r.status);
        assert_eq!(account.archived_at.is_some(), r.archived);
        // Balance and realized P&L from the store's own figures.
        let stored = trades::list(&conn, &r.account_id).unwrap();
        assert_eq!(stored.len(), r.trades);
        let micros: i64 = stored.iter().map(|t| crate::domain::to_micros(crate::domain::parse_decimal(t.realized_pnl.as_deref().unwrap()).unwrap()).unwrap()).sum();
        assert!(micros == p.net_cents() * 10_000, "stored realized P&L equals the plan");
        assert_eq!(r.ending_balance, plan::cents(p.account.start_cents + p.net_cents()));
        assert!(stored.iter().all(|t| t.pnl_status == "calculated"));
        assert_eq!(r.winners + r.losers + r.breakeven, r.trades);
    }
    let by = |k: &str| report.accounts.iter().find(|a| a.scenario == k).unwrap();
    assert_eq!(by("passed").status, "passed");
    assert_eq!(by("failed").status, "failed");
    assert!(by("archived").archived);
    assert_eq!(by("empty").trades, 0);
    assert_eq!(by("import_duplicates").import_batches, 2);
    assert!(by("import_duplicates").rejected_import_rows >= 3, "duplicates and the invalid row are reported, not imported");
    assert_eq!(count(&conn, "SELECT count(*) FROM import_batches WHERE status = 'committed'"), 2);
    assert!(count(&conn, "SELECT count(*) FROM import_rows WHERE status <> 'imported'") >= 3);
    assert!(by("happy_path").daily_reviews >= 8 && by("happy_path").trade_reviews > 0 && by("happy_path").journal_entries > 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM daily_reviews WHERE no_trade_day = 1"), 1);
    // Trailing EOD drawdowns trail recorded settlements: one per traded day, plus the opening balance.
    for key in ["happy_path", "passed", "at_risk", "failed", "archived"] {
        let p = find(&expected, key);
        assert_eq!(by(key).observations, 1 + p.eod.len(), "{key}");
        // The high-water mark the engine derives from those settlements gives the plan's floor.
        let id = &by(key).account_id;
        let settled: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT payload_json FROM financial_observations WHERE account_id = ?1").unwrap();
            stmt.query_map([id], |r| r.get::<_, String>(0)).unwrap().map(|j| {
                let v: serde_json::Value = serde_json::from_str(&j.unwrap()).unwrap();
                let input = if v["input"].is_object() { v["input"].clone() } else { v.clone() };
                (input["kind"].as_str().unwrap_or_default().to_string(), input["value"].as_str().map(|s| s.to_string()))
            }).filter(|(k, _)| k == "eod_settlement").map(|(_, v)| crate::domain::to_micros(crate::domain::parse_decimal(&v.unwrap()).unwrap()).unwrap() / 10_000).collect()
        };
        let rules = p.rules.as_ref().unwrap();
        let hwm = settled.iter().copied().chain([p.account.start_cents]).max().unwrap();
        assert_eq!(Some(hwm - rules.drawdown_cents.unwrap()), p.floor_cents(), "{key}");
    }
    // Rulebooks: private, fictional, assigned from the first day; none for the incomplete accounts.
    assert_eq!(count(&conn, "SELECT count(*) FROM account_rulebook_assignments"), 5);
    assert_eq!(count(&conn, "SELECT count(*) FROM rulebooks WHERE owner_account_id IS NOT NULL AND display_name LIKE 'DEMO rules%'"), 5);
    let marker = settings::get(&conn, "dev_tools.seed").unwrap().unwrap();
    assert_eq!(marker.value["status"], "complete");
    assert_eq!(marker.value["trades"], report.total_trades);
}

#[test]
fn the_same_inputs_seed_the_same_journal() {
    let fingerprint = |conn: &Connection| -> Vec<(String, String, String, String, Option<String>)> {
        let mut stmt = conn
            .prepare("SELECT a.name, t.symbol, t.entry_at, t.trading_day, t.net_pnl_micros FROM trades t JOIN accounts a ON a.id = t.account_id ORDER BY a.name, t.entry_at, t.symbol")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, Option<i64>>(4)?.map(|v| v.to_string()))))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    let (a, _da, ra) = seeded(Preset::UiSmoke);
    let (b, _db, rb) = seeded(Preset::UiSmoke);
    assert_eq!(fingerprint(&a), fingerprint(&b));
    let strip = |r: &seed::SeedReport| r.accounts.iter().map(|x| (x.scenario.clone(), x.trades, x.net_pnl.clone(), x.ending_balance.clone())).collect::<Vec<_>>();
    assert_eq!(strip(&ra), strip(&rb));
}

#[test]
fn repeat_runs_never_duplicate_and_a_larger_preset_adds_only_what_is_missing() {
    let (mut conn, dir, first) = seeded(Preset::UiSmoke);
    let before = count(&conn, "SELECT count(*) FROM trades");
    let again = seed::run(&mut conn, dir.path(), &options(Preset::UiSmoke)).unwrap_err();
    assert!(matches!(&again, AppError::Conflict { message } if message.contains("already has every requested scenario")), "{again:?}");
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), before);
    assert_eq!(count(&conn, "SELECT count(*) FROM accounts"), 7);

    let stress = seed::run(&mut conn, dir.path(), &options(Preset::Stress)).unwrap();
    assert_eq!(stress.accounts.iter().map(|a| a.scenario.as_str()).collect::<Vec<_>>(), ["stress"]);
    assert_eq!(stress.skipped.len(), 7);
    assert_eq!(count(&conn, "SELECT count(*) FROM accounts"), 8);
    // The library is shared, not duplicated.
    assert_eq!(count(&conn, "SELECT count(*) FROM strategies WHERE name LIKE 'DEMO %'"), 3);
    assert_eq!(count(&conn, "SELECT count(*) FROM checklists WHERE name LIKE 'DEMO %'"), 2);
    assert_eq!(first.total_accounts, 7);
}

#[test]
fn a_scenario_reloads_on_its_own_into_a_clean_journal() {
    let mut conn = db();
    let dir = tempfile::tempdir().unwrap();
    let report = seed::run(&mut conn, dir.path(), &SeedOptions { scenarios: Some(vec!["failed".into()]), ..options(Preset::UiSmoke) }).unwrap();
    assert_eq!(report.accounts.len(), 1);
    let (_, _, full) = seeded(Preset::UiSmoke);
    let in_full = full.accounts.iter().find(|a| a.scenario == "failed").unwrap();
    assert_eq!((report.accounts[0].trades, &report.accounts[0].net_pnl), (in_full.trades, &in_full.net_pnl));
}

#[test]
fn a_journal_with_real_accounts_is_refused_untouched() {
    let mut conn = db();
    let dir = tempfile::tempdir().unwrap();
    accounts::create(&mut conn, crate::store::tests::account_input("My real account")).unwrap();
    let e = seed::run(&mut conn, dir.path(), &options(Preset::UiSmoke)).unwrap_err();
    assert!(matches!(&e, AppError::Conflict { message } if message.contains("did not create")), "{e:?}");
    assert_eq!(count(&conn, "SELECT count(*) FROM accounts"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM settings WHERE key = 'dev_tools.seed'"), 0);
}

#[test]
fn a_failure_part_way_restores_the_journal_exactly() {
    let path_dir = tempfile::tempdir().unwrap();
    let mut conn = crate::db::open_file(&path_dir.path().join("fundedflow.db")).unwrap();
    let tables = |c: &Connection| {
        ["accounts", "trades", "rulebooks", "strategies", "tags", "checklists", "settings", "journal_entries", "import_batches"]
            .map(|t| count(c, &format!("SELECT count(*) FROM {t}")))
    };
    let before = tables(&conn);
    seed::FAIL_AFTER.with(|f| f.set(Some(3)));
    let e = seed::run(&mut conn, path_dir.path(), &options(Preset::UiSmoke));
    seed::FAIL_AFTER.with(|f| f.set(None));
    let e = e.unwrap_err();
    assert!(e.to_string().contains("restored"), "{e}");
    assert_eq!(tables(&conn), before, "nothing from the failed run remains");
    assert!(!seed::rollback_path(path_dir.path()).exists());
    // And the journal still works normally afterwards.
    let report = seed::run(&mut conn, path_dir.path(), &options(Preset::UiSmoke)).unwrap();
    assert_eq!(report.total_accounts, 7);
}

#[test]
fn an_interrupted_run_is_reported_instead_of_seeded_over() {
    let mut conn = db();
    let dir = tempfile::tempdir().unwrap();
    settings::set(&conn, "dev_tools.seed", &serde_json::json!({ "status": "in_progress", "startedAt": "2026-03-20T10:00:00Z" })).unwrap();
    let e = seed::run(&mut conn, dir.path(), &options(Preset::UiSmoke)).unwrap_err();
    assert!(matches!(&e, AppError::Conflict { message } if message.contains("did not finish") && message.contains("Reset All Data")), "{e:?}");
    assert_eq!(count(&conn, "SELECT count(*) FROM accounts"), 0);
}

// ---------------------------------------------------------------------------
// Isolation, busy guard, handoff close, CLI
// ---------------------------------------------------------------------------

#[test]
fn only_an_isolated_app_specific_directory_is_accepted() {
    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("real").join(ID);
    std::fs::create_dir_all(&real).unwrap();
    let test_dir = root.path().join("test").join(ID);
    let ok = |p: &Path| validate_isolated(p, Some(&real), ID);
    assert_eq!(ok(&test_dir).unwrap(), test_dir);
    assert!(ok(Path::new("relative/com.fundedflow.desktop")).unwrap_err().contains("absolute"));
    assert!(ok(&root.path().join("test").join("journal")).unwrap_err().contains("app-specific"));
    assert!(ok(&root.path().join("test").join("..").join(ID)).unwrap_err().contains(".."));
    assert!(ok(&real).unwrap_err().contains("real per-user journal"));
    assert!(ok(&real.join("nested").join(ID)).unwrap_err().contains("inside"));
    let file_parent = root.path().join("file");
    std::fs::create_dir_all(&file_parent).unwrap();
    std::fs::write(file_parent.join(ID), "x").unwrap();
    assert!(ok(&file_parent.join(ID)).unwrap_err().contains("real directory"));
    #[cfg(unix)]
    {
        let link_parent = root.path().join("link");
        std::fs::create_dir_all(&link_parent).unwrap();
        std::os::unix::fs::symlink(&real, link_parent.join(ID)).unwrap();
        assert!(ok(&link_parent.join(ID)).unwrap_err().contains("real directory"));
    }
}

/// The real journal exists and resolves to one spelling while a new test directory is written with another
/// (a symlinked parent here; 8.3 short names or a `\\?\` prefix on Windows): it is still refused when inside.
#[cfg(unix)]
#[test]
fn a_path_inside_the_real_journal_is_refused_whatever_its_spelling() {
    let root = tempfile::tempdir().unwrap();
    let real_parent = root.path().join("real");
    let real = real_parent.join(ID);
    std::fs::create_dir_all(&real).unwrap();
    let alias = root.path().join("alias");
    std::os::unix::fs::symlink(&real_parent, &alias).unwrap();
    let nested = alias.join(ID).join("nested").join(ID);
    assert!(validate_isolated(&nested, Some(&real), ID).unwrap_err().contains("inside"));
    assert!(validate_isolated(&alias.join(ID), Some(&real), ID).unwrap_err().contains("real per-user journal"));
}

#[test]
fn a_refused_test_directory_never_falls_back_to_the_real_journal() {
    let real = PathBuf::from(if cfg!(windows) { r"C:\Users\dev\AppData\Roaming\com.fundedflow.desktop" } else { "/home/dev/.local/share/com.fundedflow.desktop" });
    let unset = DevEnvironment::resolve(None, Some(real.clone()), ID);
    assert_eq!(unset.data_dir(Ok(real.clone())), Ok(real.clone()));
    assert!(unset.isolated.is_none() && unset.problem.is_none());
    let refused = DevEnvironment::resolve(Some("relative".into()), Some(real.clone()), ID);
    assert!(refused.data_dir(Ok(real.clone())).unwrap_err().contains("refused"));
    let same = DevEnvironment::resolve(Some(real.clone().into_os_string()), Some(real.clone()), ID);
    assert!(same.data_dir(Ok(real.clone())).is_err());
    let root = tempfile::tempdir().unwrap();
    let test_dir = root.path().join(ID);
    let isolated = DevEnvironment::resolve(Some(test_dir.clone().into_os_string()), Some(real.clone()), ID);
    assert_eq!(isolated.data_dir(Ok(real)), Ok(test_dir));
}

#[test]
fn the_tools_refuse_without_an_isolated_journal_or_when_another_journal_is_open() {
    let root = tempfile::tempdir().unwrap();
    let test_dir = root.path().join(ID);
    let other = root.path().join("other").join(ID);
    let runtime = crate::runtime::Runtime::start(Ok(other.join("fundedflow.db")));
    let none = DevEnvironment::resolve(None, None, ID);
    assert!(matches!(none.require_isolated(&runtime), Err(AppError::Conflict { message }) if message.contains("dev:test-journal")));
    let env = DevEnvironment::resolve(Some(test_dir.clone().into_os_string()), None, ID);
    assert!(matches!(env.require_isolated(&runtime), Err(AppError::Conflict { message }) if message.contains("not the isolated")));
    let runtime = crate::runtime::Runtime::start(Ok(test_dir.join("fundedflow.db")));
    assert!(env.require_isolated(&runtime).is_ok());
}

#[test]
fn a_second_action_while_one_runs_is_refused() {
    let state = DevState::new(DevEnvironment::resolve(None, None, ID));
    let first = state.claim().unwrap();
    assert!(state.claim().is_err());
    drop(first);
    assert!(state.claim().is_ok());
}

#[test]
fn the_handoff_close_releases_the_journal_and_its_lock_and_can_reopen() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join(ID);
    let runtime = crate::runtime::Runtime::start(Ok(dir.join("fundedflow.db")));
    runtime.with(|c| accounts::create(c, crate::store::tests::account_input("Kept"))).unwrap();
    // The app holds the directory lock while open.
    assert!(crate::data_controls::filesystem_ownership(&dir).is_err());
    runtime.release_for_handoff();
    assert!(matches!(runtime.with(|c| accounts::list(c)), Err(AppError::Unavailable { .. })));
    assert_eq!(runtime.status().state, crate::runtime::RuntimeState::Failed);
    // Another process (the reset tool) may now take the directory.
    let lock = crate::data_controls::filesystem_ownership(&dir).unwrap();
    drop(lock);
    // A failed handoff reopens the same journal with nothing lost.
    assert!(runtime.begin_initialize());
    runtime.initialize();
    assert_eq!(runtime.with(|c| accounts::list(c)).unwrap().len(), 1);
}

#[test]
fn the_handoff_requires_the_typed_confirmation_before_touching_anything() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join(ID);
    let runtime = crate::runtime::Runtime::start(Ok(dir.join("fundedflow.db")));
    for wrong in ["", "reset", "RESET ", "yes"] {
        assert!(matches!(super::reset::handoff(&runtime, &dir, ID, wrong), Err(AppError::Validation { .. })));
    }
    assert_eq!(runtime.status().state, crate::runtime::RuntimeState::Ready, "the journal stays open");
    assert!(!super::reset::report_path(&dir, ID).exists());
}

#[test]
fn reset_reports_are_read_and_dismissed_beside_the_test_journal() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join(ID);
    assert!(super::reset::read_report(&dir, ID).is_none());
    let report = super::reset::report_path(&dir, ID);
    assert_eq!(report.parent(), dir.parent(), "outside the directory the reset moves");
    std::fs::write(&report, r#"{"status":"completed","requestedAt":"x","finishedAt":"y","dataDir":"d","backup":"d.backup-1","message":"ok","log":null}"#).unwrap();
    assert_eq!(super::reset::read_report(&dir, ID).unwrap().backup.as_deref(), Some("d.backup-1"));
    super::reset::dismiss_report(&dir, ID).unwrap();
    assert!(!report.exists());
    super::reset::dismiss_report(&dir, ID).unwrap();
}

#[test]
fn the_cli_seeds_an_isolated_journal_and_refuses_while_the_app_holds_it() {
    assert!(super::cli(&["--help".into()]).unwrap().contains("Usage"));
    assert!(super::cli(&[]).unwrap_err().contains("--data-dir is required"));
    assert!(super::cli(&["--preset".into(), "huge".into(), "--data-dir".into(), "/x".into()]).unwrap_err().contains("unknown preset"));
    assert!(super::cli(&["--bogus".into()]).unwrap_err().contains("unknown argument"));
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join(ID);
    let args = |extra: &[&str]| {
        let mut a = vec!["--data-dir".to_string(), dir.display().to_string(), "--anchor".into(), ANCHOR.into()];
        a.extend(extra.iter().map(|s| s.to_string()));
        a
    };
    let out = super::cli(&args(&["--scenario", "empty,archived"])).unwrap();
    assert!(out.contains("\"totalAccounts\": 2"), "{out}");
    let held = crate::data_controls::filesystem_ownership(&dir).unwrap();
    assert!(super::cli(&args(&["--scenario", "failed"])).unwrap_err().contains("open"));
    drop(held);
}
