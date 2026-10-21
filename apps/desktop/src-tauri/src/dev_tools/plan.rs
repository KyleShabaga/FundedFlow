//! The synthetic dataset as a pure plan: accounts, rules, trades and import
//! files for each named scenario, derived only from (scenario, preset, seed,
//! anchor day). Nothing here touches the database, so the plan and its
//! reference metrics can be checked on their own and compared with what the
//! store wrote.
//!
//! Money is integer cents here (every synthetic price, fee and P&L is a whole
//! number of cents); trade P&L and balances in the journal still come from the
//! store's own calculation, which `seed.rs` reconciles against these figures.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::rng::Rng;
use crate::domain::trading_day;

/// Session times are written in exchange time.
const NY: Tz = chrono_tz::America::New_York;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    UiSmoke,
    Stress,
}

/// Every named scenario, one synthetic account each. `stress` is only in the Stress preset.
pub const SCENARIOS: [&str; 8] = ["happy_path", "passed", "at_risk", "failed", "archived", "empty", "import_duplicates", "stress"];

impl Preset {
    pub fn scenarios(self) -> &'static [&'static str] {
        match self {
            Preset::UiSmoke => &SCENARIOS[..7],
            Preset::Stress => &SCENARIOS,
        }
    }

    /// Calendar days of history before the anchor day.
    pub fn window_days(self) -> i64 {
        match self {
            Preset::UiSmoke => 120,
            Preset::Stress => 180,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Preset::UiSmoke => "ui_smoke",
            Preset::Stress => "stress",
        }
    }
}

// ---------------------------------------------------------------------------
// Instruments (built-in futures from migration 0002)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct Inst {
    pub root: &'static str,
    /// Minimum price increment as (mantissa, scale): 0.25 is (25, 2).
    tick: (i64, u32),
    /// Value of one tick for one contract, in cents.
    pub tick_cents: i64,
    /// Typical price, in ticks.
    base_ticks: i64,
    /// Round-turn commission and exchange fees per contract, in cents.
    pub fee_cents: i64,
    /// A typical move for one trade, in ticks.
    pub typical: i64,
    pub micro: bool,
    /// Equity index contracts list quarterly; energy and metals monthly.
    quarterly: bool,
}

pub fn inst(root: &str) -> Inst {
    let (tick, tick_cents, base_ticks, fee_cents, typical, micro, quarterly) = match root {
        "NQ" => ((25, 2), 500, 84_000, 418, 40, false, true),
        "MNQ" => ((25, 2), 50, 84_000, 132, 40, true, true),
        "ES" => ((25, 2), 1250, 23_200, 418, 12, false, true),
        "MES" => ((25, 2), 125, 23_200, 132, 12, true, true),
        "YM" => ((1, 0), 500, 42_000, 418, 25, false, true),
        "MYM" => ((1, 0), 50, 42_000, 132, 25, true, true),
        "RTY" => ((1, 1), 500, 22_000, 418, 15, false, true),
        "M2K" => ((1, 1), 50, 22_000, 132, 15, true, true),
        "CL" => ((1, 2), 1000, 7_500, 438, 20, false, false),
        "MCL" => ((1, 2), 100, 7_500, 142, 20, true, false),
        "GC" => ((1, 1), 1000, 24_000, 448, 25, false, false),
        "MGC" => ((1, 1), 100, 24_000, 152, 25, true, false),
        other => panic!("no synthetic instrument {other}"),
    };
    let root = SCENARIO_ROOTS.iter().find(|r| **r == root).copied().expect("known root");
    Inst { root, tick, tick_cents, base_ticks, fee_cents, typical, micro, quarterly }
}

const SCENARIO_ROOTS: [&str; 12] = ["NQ", "MNQ", "ES", "MES", "YM", "MYM", "RTY", "M2K", "CL", "MCL", "GC", "MGC"];

impl Inst {
    pub fn price(&self, ticks: i64) -> String {
        (Decimal::from(ticks) * Decimal::new(self.tick.0, self.tick.1)).normalize().to_string()
    }

    /// Front contract symbol for a day, e.g. MNQZ6.
    fn symbol(&self, day: NaiveDate) -> String {
        const CODES: [char; 12] = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
        let (mut year, month) = (day.year(), day.month());
        let mut m = if self.quarterly {
            let q = month.div_ceil(3) * 3;
            if month == q && day.day() > 12 { q + 3 } else { q }
        } else {
            month + 1
        };
        if m > 12 {
            m -= 12;
            year += 1;
        }
        format!("{}{}{}", self.root, CODES[(m - 1) as usize], year.rem_euclid(10))
    }
}

/// Cents as canonical decimal text ("1.32", "-36", "0").
pub fn cents(c: i64) -> String {
    Decimal::new(c, 2).normalize().to_string()
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct AccountSpec {
    pub name: String,
    pub account_type: &'static str,
    pub firm: &'static str,
    pub platform: &'static str,
    pub external_ref: String,
    pub tz_name: &'static str,
    pub tz: Tz,
    pub reset: &'static str,
    pub start_cents: i64,
}

/// Fictional rules, written as a private rulebook on the account. Never firm policy.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RuleSpec {
    pub target_cents: Option<i64>,
    pub drawdown_cents: Option<i64>,
    /// End-of-day trailing (true) or static (false).
    pub trailing: bool,
    pub daily_loss_cents: Option<i64>,
    /// Best day as a share of total profit, in percent.
    pub consistency_pct: Option<i64>,
    /// (days, minimum day profit in cents)
    pub min_days: Option<(u32, i64)>,
    /// (minis, micros)
    pub max_contracts: Option<(u32, u32)>,
    pub max_trades_per_day: Option<u32>,
    pub news_restriction: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedTrade {
    pub inst: &'static str,
    pub symbol: String,
    pub long: bool,
    pub qty: i64,
    pub entry: DateTime<Utc>,
    pub exit: DateTime<Utc>,
    pub entry_ticks: i64,
    pub exit_ticks: i64,
    pub fee_cents: i64,
    pub gross_cents: i64,
    pub net_cents: i64,
    pub trading_day: NaiveDate,
    /// The stop and target the trade was planned with (for reviews), in ticks from entry.
    pub planned_stop_ticks: i64,
    pub planned_target_ticks: i64,
    pub note: Option<String>,
}

impl PlannedTrade {
    pub fn instrument(&self) -> Inst {
        inst(self.inst)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatusPlan {
    pub status: &'static str,
    pub effective_at: DateTime<Utc>,
    pub cause: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CsvFile {
    pub name: String,
    pub content: String,
    pub rows: usize,
    pub new_rows: usize,
    /// Rows already in the journal, or repeated within the file.
    pub duplicate_rows: usize,
    pub invalid_rows: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScenarioPlan {
    pub key: &'static str,
    pub account: AccountSpec,
    pub rules: Option<RuleSpec>,
    /// Trades entered directly (not imported), in time order.
    pub trades: Vec<PlannedTrade>,
    /// Trades that arrive through CSV import instead, in time order.
    pub imported: Vec<PlannedTrade>,
    pub csv: Vec<CsvFile>,
    pub status: Option<StatusPlan>,
    pub archived: bool,
    pub first_day: NaiveDate,
    /// Closing balance (cents) of each trading day with trades.
    pub eod: Vec<(NaiveDate, i64)>,
    /// Days that get an end-of-day settlement observation.
    pub settlement_days: Vec<NaiveDate>,
    /// Edge cases this scenario covers, for the report and the docs.
    pub covers: Vec<&'static str>,
}

impl ScenarioPlan {
    pub fn all_trades(&self) -> impl Iterator<Item = &PlannedTrade> {
        self.trades.iter().chain(self.imported.iter())
    }

    pub fn net_cents(&self) -> i64 {
        self.all_trades().map(|t| t.net_cents).sum()
    }

    pub fn ending_cents(&self) -> i64 {
        self.account.start_cents + self.net_cents()
    }

    /// The trailing (or static) drawdown floor at the end, if the rules have one.
    pub fn floor_cents(&self) -> Option<i64> {
        let rules = self.rules.as_ref()?;
        let dd = rules.drawdown_cents?;
        if rules.trailing {
            let hwm = self.eod.iter().map(|(_, b)| *b).chain([self.account.start_cents]).max().unwrap();
            Some(hwm - dd)
        } else {
            Some(self.account.start_cents - dd)
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Mood {
    Bad,
    Normal,
    Good,
}

struct Sim<'a> {
    rng: Rng,
    spec: &'a AccountSpec,
    rules: Option<&'a RuleSpec>,
    balance: i64,
    hwm: i64,
    day_pnl: i64,
    mood: Mood,
    mood_weights: [(Mood, i64); 3],
    roots: &'a [(&'static str, i64)],
    max_micro: i64,
    max_mini: i64,
    /// Price level per root, in ticks (a random walk).
    levels: Vec<(&'static str, i64)>,
    trades: Vec<PlannedTrade>,
    eod: Vec<(NaiveDate, i64)>,
    /// With a guard, winners stop here (net P&L, cents), so an open evaluation stays open.
    profit_cap: Option<i64>,
}

fn at_ny(day: NaiveDate, h: u32, m: u32, s: u32) -> DateTime<Utc> {
    NY.from_local_datetime(&day.and_hms_opt(h, m, s).unwrap())
        .earliest()
        .expect("session times are never in a DST gap")
        .with_timezone(&Utc)
}

fn weekday(day: NaiveDate) -> bool {
    !matches!(day.weekday(), Weekday::Sat | Weekday::Sun)
}

/// The previous calendar evening whose overnight session belongs to `day` (Sunday for a Monday).
fn previous_evening(day: NaiveDate) -> NaiveDate {
    if day.weekday() == Weekday::Mon { day - Duration::days(1) } else { day.pred_opt().unwrap() }
}

impl<'a> Sim<'a> {
    fn new(seed: u64, key: &str, spec: &'a AccountSpec, rules: Option<&'a RuleSpec>, roots: &'a [(&'static str, i64)], mood_weights: [(Mood, i64); 3]) -> Self {
        Sim {
            rng: Rng::stream(seed, key),
            spec,
            rules,
            balance: spec.start_cents,
            hwm: spec.start_cents,
            day_pnl: 0,
            mood: Mood::Normal,
            mood_weights,
            roots,
            max_micro: 4,
            max_mini: 2,
            levels: Vec::new(),
            trades: Vec::new(),
            eod: Vec::new(),
            profit_cap: None,
        }
    }

    fn floor(&self) -> Option<i64> {
        let r = self.rules?;
        let dd = r.drawdown_cents?;
        Some(if r.trailing { self.hwm - dd } else { self.spec.start_cents - dd })
    }

    fn drawdown(&self) -> i64 {
        self.rules.and_then(|r| r.drawdown_cents).unwrap_or(0)
    }

    /// Next day's mood; moods persist, so winning and losing days come in streaks.
    fn next_mood(&mut self) -> Mood {
        if !self.rng.chance(55) {
            self.mood = *self.rng.weighted(&self.mood_weights);
        }
        self.mood
    }

    fn level(&mut self, inst: &Inst) -> i64 {
        let step = inst.typical * 3;
        let drift = self.rng.range(-step, step);
        match self.levels.iter_mut().find(|(r, _)| *r == inst.root) {
            Some((_, l)) => {
                *l = (*l + drift).clamp(inst.base_ticks * 7 / 10, inst.base_ticks * 13 / 10);
                *l
            }
            None => {
                let l = inst.base_ticks + self.rng.range(-inst.base_ticks / 50, inst.base_ticks / 50);
                self.levels.push((inst.root, l));
                l
            }
        }
    }

    /// Records one trade of `qty` contracts closing `result` ticks in its favour (negative: against).
    fn push(&mut self, inst: Inst, long: bool, qty: i64, (entry, hold_secs): (DateTime<Utc>, i64), result: i64, note: Option<String>) {
        let entry_ticks = self.level(&inst);
        let exit_ticks = if long { entry_ticks + result } else { entry_ticks - result };
        let fee_cents = inst.fee_cents * qty;
        let gross_cents = result * inst.tick_cents * qty;
        let net_cents = gross_cents - fee_cents;
        let local_day = entry.with_timezone(&NY).date_naive();
        let stop = (inst.typical * 4 / 5).max(2);
        self.trades.push(PlannedTrade {
            inst: inst.root,
            symbol: inst.symbol(local_day),
            long,
            qty,
            entry,
            exit: entry + Duration::seconds(hold_secs),
            entry_ticks,
            exit_ticks,
            fee_cents,
            gross_cents,
            net_cents,
            // A trade counts on the trading day it closes (store/trades.rs).
            trading_day: self.day_of(entry + Duration::seconds(hold_secs)),
            planned_stop_ticks: stop,
            planned_target_ticks: stop * 2,
            note,
        });
        self.balance += net_cents;
        self.day_pnl += net_cents;
    }

    fn day_of(&self, at: DateTime<Utc>) -> NaiveDate {
        trading_day(at, self.spec.tz, crate::domain::parse_reset_time(self.spec.reset).unwrap())
    }

    /// Shorten the last trade's hold (P&L unchanged), e.g. to close before the reset.
    fn retime_last(&mut self, hold_secs: i64, note: &str) {
        let mut t = self.trades.pop().unwrap();
        t.exit = t.entry + Duration::seconds(hold_secs);
        t.trading_day = self.day_of(t.exit);
        t.note = Some(note.into());
        self.trades.push(t);
    }

    /// A trade whose net P&L is close to `want` cents (within one tick of the size used).
    fn shaped(&mut self, root: &'static str, entry: DateTime<Utc>, want: i64, note: &str) {
        let inst = inst(root);
        let max_qty = if inst.micro { 10 } else { 3 };
        let cap = inst.typical * 5;
        let mut chosen = (max_qty, 1);
        for qty in 1..=max_qty {
            let fees = inst.fee_cents * qty;
            let per = inst.tick_cents * qty;
            let ticks = if want >= 0 { (want + fees + per - 1) / per } else { ((-want - fees).max(1) + per - 1) / per };
            chosen = (qty, ticks.max(1));
            if ticks <= cap {
                break;
            }
        }
        let (qty, ticks) = chosen;
        let long = self.rng.chance(50);
        let hold = self.rng.range(120, 1800);
        self.push(inst, long, qty, (entry, hold), if want >= 0 { ticks } else { -ticks }, Some(note.into()));
    }

    /// One ordinary trade. With `guard`, a loss that would take the account near its drawdown floor or
    /// daily loss limit becomes a small scratch winner instead, so only the scenarios meant to breach do.
    fn random(&mut self, entry: DateTime<Utc>, mood: Mood, guard: bool) {
        let root = *self.rng.weighted(self.roots);
        let inst = inst(root);
        let long = self.rng.chance(55);
        let qty = self.rng.range(1, if inst.micro { self.max_micro } else { self.max_mini });
        let win_pct = match mood {
            Mood::Good => 64,
            Mood::Normal => 50,
            Mood::Bad => 32,
        };
        let typ = inst.typical;
        let (mut result, mut note) = if self.rng.chance(7) {
            (0, Some("Breakeven: stop moved to entry.".to_string()))
        } else if self.rng.chance(win_pct) {
            (self.rng.range(typ / 4, typ * 2), None)
        } else {
            let slip = if self.rng.chance(30) { self.rng.range(1, 2) } else { 0 };
            let loss = self.rng.range(typ / 4, typ * 6 / 5) + slip;
            (-loss, (slip > 0).then(|| format!("Stop slipped {slip} tick{}.", if slip == 1 { "" } else { "s" })))
        };
        let net = result * inst.tick_cents * qty - inst.fee_cents * qty;
        if guard && net < 0 {
            let near_floor = self.floor().is_some_and(|f| self.balance + net < f + self.drawdown() * 3 / 10);
            let near_daily = self.rules.and_then(|r| r.daily_loss_cents).is_some_and(|dll| self.day_pnl + net < -dll * 7 / 10);
            if near_floor || near_daily {
                result = self.rng.range(2, 6);
                note = Some("Scratched early to protect the day.".into());
            }
        }
        if guard && net > 0 && self.profit_cap.is_some_and(|cap| self.balance + net - self.spec.start_cents > cap) {
            result = -self.rng.range(2, 6);
            note = Some("Gave back a little: no new highs today.".into());
        }
        let hold = self.rng.range(45, 40 * 60);
        self.push(inst, long, qty, (entry, hold), result, note);
    }

    /// `n` ordinary trades in the regular session of `day`.
    fn session(&mut self, day: NaiveDate, n: usize, mood: Mood, guard: bool) {
        let mut minutes: Vec<i64> = (0..n).map(|_| self.rng.range(9 * 60 + 31, 15 * 60 + 45)).collect();
        minutes.sort_unstable();
        for m in minutes {
            let s = self.rng.range(0, 59) as u32;
            self.random(at_ny(day, (m / 60) as u32, (m % 60) as u32, s), mood, guard);
        }
    }

    fn close_day(&mut self, day: NaiveDate) {
        if self.trades.last().is_some_and(|t| t.trading_day == day) {
            self.eod.push((day, self.balance));
        }
        if self.rules.is_some_and(|r| r.trailing) {
            self.hwm = self.hwm.max(self.balance);
        }
        self.day_pnl = 0;
    }

    fn net(&self) -> i64 {
        self.balance - self.spec.start_cents
    }

    fn into_parts(self) -> Parts {
        (self.trades, self.eod)
    }
}

type Parts = (Vec<PlannedTrade>, Vec<(NaiveDate, i64)>);

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/// Weekdays from `first` through `last`.
fn weekdays(first: NaiveDate, last: NaiveDate) -> Vec<NaiveDate> {
    first.iter_days().take_while(|d| *d <= last).filter(|d| weekday(*d)).collect()
}

/// Mondays right after a New York daylight-saving change inside the window.
fn dst_mondays(days: &[NaiveDate]) -> Vec<NaiveDate> {
    days.iter()
        .copied()
        .filter(|d| d.weekday() == Weekday::Mon)
        .filter(|d| {
            let offset = |day: NaiveDate| NY.from_local_datetime(&day.and_hms_opt(12, 0, 0).unwrap()).unwrap().naive_utc() - day.and_hms_opt(12, 0, 0).unwrap();
            offset(*d) != offset(*d - Duration::days(3))
        })
        .collect()
}

/// (account type, firm, platform) and (time zone, reset time).
fn account(name: &str, key: &str, (account_type, firm, platform): (&'static str, &'static str, &'static str), (tz_name, reset): (&'static str, &'static str), start_dollars: i64) -> AccountSpec {
    AccountSpec {
        name: name.into(),
        account_type,
        firm,
        platform,
        external_ref: format!("DEMO-{}", key.to_ascii_uppercase().replace('_', "-")),
        tz_name,
        tz: tz_name.parse().expect("valid zone"),
        reset,
        start_cents: start_dollars * 100,
    }
}

const D: i64 = 100; // cents per dollar

/// The plan for one scenario. Deterministic in (key, preset, seed, anchor).
pub fn plan(key: &str, preset: Preset, seed: u32, anchor: NaiveDate) -> Option<ScenarioPlan> {
    let seed = u64::from(seed);
    let stress = preset == Preset::Stress;
    let first_day = anchor - Duration::days(preset.window_days());
    let days = weekdays(first_day, anchor);
    let before: Vec<NaiveDate> = days.iter().copied().filter(|d| *d < anchor).collect();
    let good = |g, n, b| [(Mood::Good, g), (Mood::Normal, n), (Mood::Bad, b)];

    let plan = match key {
        "happy_path" => {
            let spec = account("DEMO · Evaluation 50K (on track)", key, ("evaluation", "DEMO Firm Alpha (fictional)", "Tradovate"), ("America/New_York", "17:00"), 50_000);
            let rules = RuleSpec {
                target_cents: Some(3_000 * D),
                drawdown_cents: Some(2_000 * D),
                trailing: true,
                daily_loss_cents: Some(1_000 * D),
                consistency_pct: Some(40),
                min_days: Some((5, 150 * D)),
                max_contracts: Some((5, 50)),
                max_trades_per_day: None,
                news_restriction: true,
            };
            let roots = [("MNQ", 70), ("NQ", 10), ("MES", 20)];
            let mut sim = Sim::new(seed, key, &spec, Some(&rules), &roots, good(40, 40, 20));
            let target = rules.target_cents.unwrap();
            sim.profit_cap = Some(target * 85 / 100);
            let (p, hi) = if stress { (52, 3) } else { (55, 3) };
            let busy = before[before.len() * 2 / 5];
            let big_win = before[before.len() / 4];
            let big_loss = before[before.len() * 3 / 5];
            let quiet_from = before[before.len() - 10];
            let mut loss_pending = true;
            // A Wednesday two weeks back: trades either side of the 17:00 reset.
            let boundary_wed = before.iter().rev().copied().find(|d| d.weekday() == Weekday::Wed && *d < anchor - Duration::days(10));
            let boundary_mon = before.iter().rev().copied().find(|d| d.weekday() == Weekday::Mon && *d < anchor - Duration::days(17));
            let dst = dst_mondays(&before);
            let last = before.last().copied();
            for day in &days {
                let day = *day;
                let mood = sim.next_mood();
                // Overnight session: the evening before belongs to this trading day.
                let overnight = if day == anchor { 3 } else if Some(day) == boundary_mon || dst.contains(&day) { 1 } else { 0 };
                let thursday_after = boundary_wed.map(|w| w + Duration::days(1));
                for i in 0..overnight {
                    let entry = at_ny(previous_evening(day), 18 + i as u32, 10 + 7 * i as u32, 12);
                    sim.random(entry, mood, true);
                }
                if Some(day) == thursday_after {
                    let entry = at_ny(day - Duration::days(1), 17, 3, 5);
                    sim.random(entry, mood, true);
                    sim.retime_last(240, "Traded 17:03 ET: after the reset, so it counts for Thursday.");
                }
                if day == anchor {
                    sim.close_day(day);
                    continue;
                }
                // The large days have no other trades, so the day's P&L is the large trade.
                if day == big_win {
                    let want = (sim.rng.range(1_200, 1_600) * D).min(target * 85 / 100 - sim.net()).max(1_050 * D);
                    sim.shaped("NQ", at_ny(day, 10, 2, 41), want, "Large winner: trend day, held the runner.");
                } else if loss_pending && day >= big_loss && day < quiet_from && sim.floor().is_some_and(|f| sim.balance - 1_000 * D > f + 600 * D) {
                    let want = -sim.rng.range(850, 950) * D;
                    sim.shaped("NQ", at_ny(day, 13, 47, 9), want, "Large loss: faded a breakout and sized up.");
                    loss_pending = false;
                } else if day == busy {
                    sim.session(day, 12, mood, true);
                } else if sim.rng.chance(p) {
                    let n = sim.rng.range(1, hi) as usize;
                    sim.session(day, n, mood, true);
                }
                if Some(day) == boundary_wed {
                    sim.random(at_ny(day, 16, 58, 30), mood, true);
                    sim.retime_last(50, "Closed 16:59 ET: before the 17:00 reset, so it counts for Wednesday.");
                }
                if Some(day) == last {
                    // Keep the evaluation open: between 30% and 80% of its target.
                    if sim.net() > target * 8 / 10 {
                        let want = target * 65 / 100 - sim.net();
                        sim.shaped("NQ", at_ny(day, 15, 21, 3), want, "Gave back part of the week's gains.");
                    } else if sim.net() < target * 3 / 10 {
                        let want = target / 2 - sim.net();
                        sim.shaped("MNQ", at_ny(day, 15, 21, 3), want, "Clean A+ setup into the close.");
                    }
                }
                sim.close_day(day);
            }
            let parts = sim.into_parts();
            ScenarioPlan {
                covers: vec![
                    "multi-trade days", "high-volume day (12 trades)", "large positive day", "large negative day",
                    "consecutive winning and losing days", "trades either side of the 17:00 reset", "Sunday-evening trade rolled to Monday",
                    "daylight-saving boundary (when in the window)", "trades today (overnight session)", "complete daily reviews",
                ],
                ..finish(key, spec, Some(rules), parts, first_day)
            }
        }
        "passed" => {
            let spec = account("DEMO · Evaluation 100K (target reached)", key, ("evaluation", "DEMO Firm Beta (fictional)", "Rithmic"), ("America/Chicago", "16:00"), 100_000);
            let rules = RuleSpec {
                target_cents: Some(6_000 * D),
                drawdown_cents: Some(3_000 * D),
                trailing: true,
                consistency_pct: Some(50),
                max_contracts: Some((10, 100)),
                ..RuleSpec::default()
            };
            let roots = [("NQ", 40), ("MNQ", 40), ("ES", 20)];
            let mut sim = Sim::new(seed, key, &spec, Some(&rules), &roots, good(50, 35, 15));
            sim.max_micro = 6;
            let stop = before[before.len().saturating_sub(9)];
            let target = rules.target_cents.unwrap();
            let mut passed_on = None;
            for day in before.iter().copied().filter(|d| *d <= stop) {
                let mood = sim.next_mood();
                if sim.rng.chance(if stress { 58 } else { 60 }) {
                    let n = sim.rng.range(1, 3) as usize;
                    sim.session(day, n, mood, true);
                }
                if day == stop && sim.net() < target {
                    let want = target - sim.net() + sim.rng.range(150, 400) * D;
                    sim.shaped("NQ", at_ny(day, 14, 12, 40), want, "Final push: target reached.");
                }
                sim.close_day(day);
                if sim.net() >= target {
                    passed_on = Some(day);
                    break;
                }
            }
            let day = passed_on.expect("the target is reached by the stop day");
            let status = StatusPlan { status: "passed", effective_at: at_ny(day, 16, 30, 0), cause: "Profit target reached (synthetic scenario)" };
            let parts = sim.into_parts();
            ScenarioPlan {
                status: Some(status),
                covers: vec!["profit target reached", "passed evaluation", "Chicago time zone with a 16:00 reset"],
                ..finish(key, spec, Some(rules), parts, first_day)
            }
        }
        "at_risk" => {
            let spec = account("DEMO · Sim Funded 150K — Drawdown watch (near the trailing max-loss floor)", key, ("sim_funded", "DEMO Firm Alpha (fictional)", "NinjaTrader"), ("America/New_York", "17:00"), 150_000);
            let rules = RuleSpec {
                drawdown_cents: Some(4_500 * D),
                trailing: true,
                daily_loss_cents: Some(1_500 * D),
                max_trades_per_day: Some(15),
                max_contracts: Some((15, 150)),
                ..RuleSpec::default()
            };
            let roots = [("MNQ", 50), ("NQ", 30), ("MCL", 20)];
            let mut sim = Sim::new(seed, key, &spec, Some(&rules), &roots, good(35, 40, 25));
            sim.max_micro = 8;
            let tail: Vec<NaiveDate> = before[before.len() - 3..].to_vec();
            let mut needed = 0;
            for day in before.iter().copied() {
                let mood = sim.next_mood();
                if day == tail[0] {
                    let headroom = rules.drawdown_cents.unwrap() * 12 / 100;
                    needed = sim.balance - (sim.floor().unwrap() + headroom);
                }
                if let Some(i) = tail.iter().position(|d| *d == day) {
                    // Three losing days in a row, each inside the daily loss limit.
                    let part = if i == 2 { needed - needed / 3 * 2 } else { needed / 3 };
                    sim.shaped("MNQ", at_ny(day, 10, 5 + 9 * i as u32, 17), -(part / 2), "Chopped up in the open.");
                    sim.shaped("NQ", at_ny(day, 13, 40, 2), -(part - part / 2), "Forced a trade after the open loss.");
                } else if sim.rng.chance(if stress { 50 } else { 55 }) {
                    let n = sim.rng.range(1, 3) as usize;
                    sim.session(day, n, mood, true);
                }
                sim.close_day(day);
            }
            let parts = sim.into_parts();
            ScenarioPlan {
                settlement_days: tail,
                covers: vec!["account approaching its drawdown limit", "three consecutive losing days", "long account name", "end-of-day settlement observations"],
                ..finish(key, spec, Some(rules), parts, first_day)
            }
        }
        "failed" => {
            let spec = account("DEMO · Evaluation 50K (failed: max loss breached)", key, ("evaluation", "DEMO Firm Gamma (fictional)", "ProjectX"), ("America/New_York", "17:00"), 50_000);
            let rules = RuleSpec {
                target_cents: Some(3_000 * D),
                drawdown_cents: Some(2_000 * D),
                trailing: true,
                daily_loss_cents: Some(1_000 * D),
                max_contracts: Some((5, 50)),
                ..RuleSpec::default()
            };
            let roots = [("NQ", 60), ("MNQ", 40)];
            let mut sim = Sim::new(seed, key, &spec, Some(&rules), &roots, good(35, 40, 25));
            let breach = before[before.len() * 65 / 100];
            let tilt: Vec<NaiveDate> = before.iter().copied().filter(|d| *d < breach).rev().take(3).collect();
            for day in before.iter().copied().filter(|d| *d <= breach) {
                let mood = sim.next_mood();
                if day == breach {
                    // Revenge trading: each loss bigger than the last, through the floor.
                    let total = sim.balance - sim.floor().unwrap() + 350 * D;
                    for (i, share) in [(0, 20), (1, 30), (2, 50)] {
                        sim.shaped("NQ", at_ny(day, 9 + 2 * i, 41, 6), -(total * share / 100), "Revenge trade after the first loss.");
                    }
                } else if tilt.contains(&day) {
                    let room = sim.balance - (sim.floor().unwrap() + rules.drawdown_cents.unwrap() / 10);
                    let loss = (rules.drawdown_cents.unwrap() / 5).min(room).max(50 * D);
                    sim.shaped("NQ", at_ny(day, 11, 3, 50), -loss, "Tilted after missing the move.");
                } else if sim.rng.chance(60) {
                    let n = sim.rng.range(1, 3) as usize;
                    sim.session(day, n, mood, true);
                }
                sim.close_day(day);
            }
            let status = StatusPlan { status: "failed", effective_at: at_ny(breach, 16, 30, 0), cause: "Maximum loss limit breached (synthetic scenario)" };
            let parts = sim.into_parts();
            ScenarioPlan {
                status: Some(status),
                covers: vec!["failed evaluation", "drawdown breached", "losing streak before the breach", "no trades after failing"],
                ..finish(key, spec, Some(rules), parts, first_day)
            }
        }
        "archived" => {
            let spec = account("DEMO · Evaluation 25K (closed and archived)", key, ("evaluation", "DEMO Firm Beta (fictional)", "Tradovate"), ("America/New_York", "17:00"), 25_000);
            let rules = RuleSpec { target_cents: Some(1_500 * D), drawdown_cents: Some(1_500 * D), trailing: true, ..RuleSpec::default() };
            let roots = [("MES", 60), ("MNQ", 40)];
            let mut sim = Sim::new(seed, key, &spec, Some(&rules), &roots, good(40, 40, 20));
            let active: Vec<NaiveDate> = before.iter().copied().take(30).collect();
            for day in &active {
                let mood = sim.next_mood();
                if sim.rng.chance(60) {
                    let n = sim.rng.range(1, 3) as usize;
                    sim.session(*day, n, mood, true);
                }
                sim.close_day(*day);
            }
            let closed = at_ny(*active.last().unwrap() + Duration::days(1), 9, 0, 0);
            let parts = sim.into_parts();
            ScenarioPlan {
                status: Some(StatusPlan { status: "closed", effective_at: closed, cause: "Closed by the trader (synthetic scenario)" }),
                archived: true,
                covers: vec!["archived account", "closed status", "history that ends early in the window"],
                ..finish(key, spec, Some(rules), parts, first_day)
            }
        }
        "empty" => {
            let spec = account("DEMO · Evaluation 50K (no trades yet)", key, ("evaluation", "DEMO Firm Gamma (fictional)", "Tradovate"), ("America/New_York", "17:00"), 50_000);
            let sim = Sim::new(seed, key, &spec, None, &[], good(1, 1, 1));
            let parts = sim.into_parts();
            ScenarioPlan {
                covers: vec!["empty account", "no rulebook set up", "no opening balance", "calendar empty state"],
                ..finish(key, spec, None, parts, first_day)
            }
        }
        "import_duplicates" => {
            let spec = account("DEMO · Evaluation 50K (CSV imports, London time)", key, ("evaluation", "DEMO Firm Alpha (fictional)", "Tradovate (CSV export)"), ("Europe/London", "22:00"), 50_000);
            let roots = [("MNQ", 70), ("MGC", 30)];
            let mut sim = Sim::new(seed, key, &spec, None, &roots, good(40, 40, 20));
            for day in &before {
                let mood = sim.next_mood();
                if sim.rng.chance(if stress { 40 } else { 45 }) {
                    let n = sim.rng.range(1, 2) as usize;
                    sim.session(*day, n, mood, false);
                }
                sim.close_day(*day);
            }
            let parts = sim.into_parts();
            let mut plan = ScenarioPlan {
                covers: vec![
                    "import history with two batches", "duplicate rows already imported", "duplicate row within one file",
                    "invalid row reported, not imported", "no rulebook set up", "London time zone with a 22:00 reset",
                ],
                ..finish(key, spec, None, parts, first_day)
            };
            plan.imported = std::mem::take(&mut plan.trades);
            plan.csv = csv_files(&plan);
            plan
        }
        "stress" => {
            let spec = account("DEMO · Stress Sim Funded 250K — high-volume scalping account with a deliberately long name", key, ("sim_funded", "DEMO Firm Delta (fictional)", "Rithmic"), ("America/Chicago", "16:00"), 250_000);
            let rules = RuleSpec {
                drawdown_cents: Some(7_500 * D),
                trailing: false,
                daily_loss_cents: Some(3_000 * D),
                max_trades_per_day: Some(60),
                max_contracts: Some((20, 200)),
                ..RuleSpec::default()
            };
            let roots = [("MNQ", 25), ("MES", 15), ("M2K", 10), ("MYM", 10), ("MCL", 10), ("MGC", 10), ("NQ", 8), ("ES", 6), ("CL", 3), ("GC", 3)];
            let mut sim = Sim::new(seed, key, &spec, Some(&rules), &roots, good(35, 40, 25));
            sim.max_micro = 10;
            for day in &before {
                let mood = sim.next_mood();
                if sim.rng.chance(4) {
                    let n = sim.rng.range(20, 30) as usize;
                    sim.session(*day, n, mood, true);
                } else if sim.rng.chance(62) {
                    let n = sim.rng.range(1, 3) as usize;
                    sim.session(*day, n, mood, true);
                }
                sim.close_day(*day);
            }
            let parts = sim.into_parts();
            ScenarioPlan {
                covers: vec!["high-volume days (20–30 trades)", "ten instruments", "static drawdown", "long account name"],
                ..finish(key, spec, Some(rules), parts, first_day)
            }
        }
        _ => return None,
    };
    Some(plan)
}

fn finish(key: &str, account: AccountSpec, rules: Option<RuleSpec>, (trades, eod): Parts, first_day: NaiveDate) -> ScenarioPlan {
    let key = SCENARIOS.iter().find(|k| **k == key).copied().expect("known scenario");
    let mut trades = trades;
    trades.sort_by_key(|t| (t.entry, t.exit));
    ScenarioPlan {
        key,
        account,
        rules,
        trades,
        imported: Vec::new(),
        csv: Vec::new(),
        status: None,
        archived: false,
        first_day,
        eod,
        settlement_days: Vec::new(),
        covers: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// CSV files for the import scenario
// ---------------------------------------------------------------------------

const CSV_HEADER: &str = "Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price,Fees,Trade ID";

fn csv_row(plan: &ScenarioPlan, i: usize, t: &PlannedTrade) -> String {
    let local = |at: DateTime<Utc>| at.with_timezone(&plan.account.tz).format("%Y-%m-%d %H:%M:%S").to_string();
    let inst = t.instrument();
    format!(
        "{},{},{},{},{},{},{},{},DEMO-CSV-{:04}",
        t.symbol,
        if t.long { "Buy" } else { "Sell" },
        t.qty,
        local(t.entry),
        inst.price(t.entry_ticks),
        local(t.exit),
        inst.price(t.exit_ticks),
        cents(t.fee_cents),
        i + 1
    )
}

/// Two exports: the first two thirds of the history, then the rest with three rows already imported,
/// one row repeated within the file and one row whose price cannot be read.
fn csv_files(plan: &ScenarioPlan) -> Vec<CsvFile> {
    let rows: Vec<String> = plan.imported.iter().enumerate().map(|(i, t)| csv_row(plan, i, t)).collect();
    let split = rows.len() * 2 / 3;
    let first = &rows[..split];
    let rest = &rows[split..];
    let mut second: Vec<String> = first[first.len().saturating_sub(3)..].to_vec();
    second.extend(rest.iter().cloned());
    if let Some(repeat) = rest.first() {
        second.push(repeat.clone());
    }
    second.push("MNQZ6,Buy,1,2026-01-05 15:00:00,not-a-price,2026-01-05 15:05:00,21000,1.32,DEMO-CSV-BAD1".into());
    let file = |rows: &[String]| format!("{CSV_HEADER}\n{}\n", rows.join("\n"));
    vec![
        CsvFile { name: "DEMO-tradovate-export-part1.csv".into(), content: file(first), rows: first.len(), new_rows: first.len(), duplicate_rows: 0, invalid_rows: 0 },
        CsvFile {
            name: "DEMO-tradovate-export-part2.csv".into(),
            content: file(&second),
            rows: second.len(),
            new_rows: rest.len(),
            duplicate_rows: first.len().min(3) + usize::from(!rest.is_empty()),
            invalid_rows: 1,
        },
    ]
}

/// Parse a YYYY-MM-DD anchor day.
pub fn parse_day(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

/// Today in New York: the default anchor, so "today" in the data matches the futures session.
pub fn today() -> NaiveDate {
    Utc::now().with_timezone(&NY).date_naive()
}

