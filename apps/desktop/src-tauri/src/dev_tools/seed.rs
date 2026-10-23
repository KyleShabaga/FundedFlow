//! Add Fake Data: writes the synthetic plan (`plan.rs`) into a journal through
//! the same store, rulebook and CSV import functions the app's commands use, so
//! every record passes normal validation and every derived value (trading day,
//! P&L) is calculated by the store, never by the generator.
//!
//! The whole run is all-or-nothing: the journal is copied with SQLite's backup
//! API first and restored from that copy if any step fails. A marker setting
//! records a run in progress, so a run cut short by a crash is reported instead
//! of being silently seeded over.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use rusqlite::{Connection, MAIN_DB};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::plan::{self, PlannedTrade, Preset, RuleSpec, ScenarioPlan, cents};
use super::rng::Rng;
use crate::csv_import::{
    self, CsvImportRequest, DateFormatChoice, FormatChoice, target::Acknowledgement,
};
use crate::domain::{parse_decimal, to_micros};
use crate::error::{AppError, AppResult};
use crate::rulebook::{
    AssignmentGuard, AssignmentInput, ChangeContext, NewRulebook, RULE_PARAMETER_SCHEMA_VERSION,
    RuleDefinitionInput, RulebookDraftInput,
};
use crate::store::daily_reviews::{self, DailyReviewInput, PlanInput, ReflectionInput};
use crate::store::evidence::{self, ObservationInput};
use crate::store::library::{self, ChecklistInput, ChecklistItemInput, StrategyInput, TagInput};
use crate::store::reviews::{self, ChecklistAnswerInput, ReviewInput};
use crate::store::{accounts, journal, rulebooks, settings, trades};

/// Seed used when none is given (the build number).
pub const DEFAULT_SEED: u32 = 2609;
/// Marks every synthetic account; also how a later run recognises them.
pub const DEMO_LABEL: &str = "DEMO / TEST DATA";
const MARKER_KEY: &str = "dev_tools.seed";
const ROLLBACK_FILE: &str = "dev-seed-rollback.db";
const ACTOR: &str = "Add Fake Data (synthetic)";
const SOURCE: &str = "DEMO / TEST DATA: synthetic value from Add Fake Data";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedOptions {
    pub preset: Preset,
    pub seed: Option<u32>,
    /// YYYY-MM-DD; default today in New York. History ends on this day.
    pub anchor_day: Option<String>,
    /// Named scenarios to seed; default every scenario of the preset.
    pub scenarios: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReport {
    pub scenario: String,
    pub account_id: String,
    pub name: String,
    pub status: String,
    pub archived: bool,
    pub trades: usize,
    pub winners: usize,
    pub losers: usize,
    pub breakeven: usize,
    pub trading_days: usize,
    pub starting_balance: String,
    /// Starting balance plus the store's net realized P&L of the seeded trades.
    pub ending_balance: String,
    pub net_pnl: String,
    pub fees: String,
    /// Drawdown floor from the synthetic rules at the end (reference only; the app's engine is authoritative).
    pub drawdown_floor: Option<String>,
    pub import_batches: usize,
    pub rejected_import_rows: usize,
    pub journal_entries: usize,
    pub trade_reviews: usize,
    pub daily_reviews: usize,
    pub observations: usize,
    pub covers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedReport {
    pub preset: Preset,
    pub seed: u32,
    pub anchor_day: String,
    pub accounts: Vec<AccountReport>,
    /// Requested scenarios already in this journal, left as they are.
    pub skipped: Vec<String>,
    pub total_accounts: usize,
    pub total_trades: usize,
}

/// Plans for the requested scenarios, validating the options. Pure.
pub fn plans(options: &SeedOptions) -> AppResult<(u32, NaiveDate, Vec<ScenarioPlan>)> {
    let seed = options.seed.unwrap_or(DEFAULT_SEED);
    let today = plan::today();
    let anchor = match options.anchor_day.as_deref() {
        None => today,
        Some(s) => plan::parse_day(s)
            .ok_or_else(|| AppError::invalid("anchorDay", "Use a date as YYYY-MM-DD"))?,
    };
    if anchor > today {
        return Err(AppError::invalid(
            "anchorDay",
            "Use today or an earlier day: synthetic trades are never in the future",
        ));
    }
    let keys: Vec<String> = match &options.scenarios {
        None => options
            .preset
            .scenarios()
            .iter()
            .map(|s| s.to_string())
            .collect(),
        Some(list) if list.is_empty() => {
            return Err(AppError::invalid(
                "scenarios",
                "Choose at least one scenario",
            ));
        }
        Some(list) => list.clone(),
    };
    let mut out = Vec::new();
    for key in keys {
        let p = plan::plan(&key, options.preset, seed, anchor).ok_or_else(|| {
            AppError::invalid(
                "scenarios",
                format!(
                    "Unknown scenario '{key}'; use one of {}",
                    plan::SCENARIOS.join(", ")
                ),
            )
        })?;
        if out.iter().any(|o: &ScenarioPlan| o.key == p.key) {
            return Err(AppError::invalid(
                "scenarios",
                format!("'{key}' is listed twice"),
            ));
        }
        out.push(p);
    }
    Ok((seed, anchor, out))
}

fn account_notes(p: &ScenarioPlan, preset: Preset, seed: u32, anchor: NaiveDate) -> String {
    format!(
        "{DEMO_LABEL}: synthetic account (scenario: {}, preset: {}, seed: {seed}, anchor: {anchor}). \
         Not a real account. Its firm and rules are fictional and are not any firm's policy.",
        p.key,
        preset.label()
    )
}

/// The scenario of an existing synthetic account, from its notes.
fn scenario_of(notes: Option<&str>) -> Option<String> {
    let notes = notes?;
    let rest = notes
        .strip_prefix(DEMO_LABEL)?
        .split("(scenario: ")
        .nth(1)?;
    Some(rest.split(',').next()?.to_string())
}

/// What is already in the journal: synthetic scenarios present, and how many accounts are not synthetic.
fn existing(conn: &Connection) -> AppResult<(Vec<String>, usize)> {
    let mut scenarios = Vec::new();
    let mut other = 0;
    for a in accounts::list_with(conn, true)? {
        match scenario_of(a.notes.as_deref()) {
            Some(s) => scenarios.push(s),
            None => other += 1,
        }
    }
    Ok((scenarios, other))
}

/// Seed `options` into the journal open on `conn`, all or nothing. `data_dir` holds the
/// rollback copy while the run is in progress.
pub fn run(conn: &mut Connection, data_dir: &Path, options: &SeedOptions) -> AppResult<SeedReport> {
    let (seed, anchor, mut plans) = plans(options)?;
    if let Some(marker) = settings::get(conn, MARKER_KEY)?
        && marker.value["status"] == "in_progress"
    {
        return Err(AppError::Conflict {
            message: format!(
                "an earlier Add Fake Data run did not finish (started {}), so this journal may hold partial synthetic data. \
                 Use Reset All Data to start from a clean test journal.",
                marker.value["startedAt"]
                    .as_str()
                    .unwrap_or("at an unknown time")
            ),
        });
    }
    let (present, other) = existing(conn)?;
    if other > 0 {
        return Err(AppError::Conflict {
            message: format!(
                "this journal has {other} account{} that Add Fake Data did not create. Synthetic data is only added to a \
                 journal of synthetic accounts; use Reset All Data on the test journal first.",
                if other == 1 { "" } else { "s" }
            ),
        });
    }
    let skipped: Vec<String> = plans
        .iter()
        .filter(|p| present.iter().any(|s| s == p.key))
        .map(|p| p.key.to_string())
        .collect();
    plans.retain(|p| !skipped.iter().any(|s| s == p.key));
    if plans.is_empty() {
        return Err(AppError::Conflict {
            message: format!(
                "this test journal already has every requested scenario ({}). Nothing was added.",
                skipped.join(", ")
            ),
        });
    }

    let rollback = rollback_path(data_dir);
    conn.backup(MAIN_DB, &rollback, None)
        .map_err(|e| AppError::Database {
            message: format!("could not save a rollback copy before seeding: {e}"),
        })?;
    let started = crate::domain::now();
    let result = settings::set(conn, MARKER_KEY, &json!({ "status": "in_progress", "startedAt": started, "preset": options.preset, "seed": seed, "anchorDay": anchor.to_string() }))
        .and_then(|_| write_all(conn, &plans, options.preset, seed, anchor))
        .and_then(|reports| {
            let trades: usize = reports.iter().map(|r| r.trades).sum();
            settings::set(conn, MARKER_KEY, &json!({
                "status": "complete", "startedAt": started, "completedAt": crate::domain::now(), "preset": options.preset,
                "seed": seed, "anchorDay": anchor.to_string(), "scenarios": reports.iter().map(|r| r.scenario.clone()).collect::<Vec<_>>(),
                "accounts": reports.len(), "trades": trades,
            }))?;
            Ok(reports)
        });
    match result {
        Ok(reports) => {
            let _ = std::fs::remove_file(&rollback);
            Ok(SeedReport {
                preset: options.preset,
                seed,
                anchor_day: anchor.to_string(),
                total_accounts: reports.len(),
                total_trades: reports.iter().map(|r| r.trades).sum(),
                accounts: reports,
                skipped,
            })
        }
        Err(error) => {
            match conn.restore(MAIN_DB, &rollback, None::<fn(rusqlite::backup::Progress)>) {
                Ok(()) => {
                    let _ = std::fs::remove_file(&rollback);
                    Err(prefixed(
                        error,
                        "Add Fake Data failed and the journal was restored to how it was before the run",
                    ))
                }
                Err(restore) => Err(AppError::Database {
                    message: format!(
                        "Add Fake Data failed ({error}) and restoring the journal also failed ({restore}). The copy taken before \
                     the run is kept at {}. Use Reset All Data on this test journal.",
                        rollback.display()
                    ),
                }),
            }
        }
    }
}

fn prefixed(error: AppError, context: &str) -> AppError {
    match error {
        AppError::Validation { message, issues } => AppError::Validation {
            message: format!("{context}: {message}"),
            issues,
        },
        AppError::Conflict { message } => AppError::Conflict {
            message: format!("{context}: {message}"),
        },
        other => AppError::Database {
            message: format!("{context}: {other}"),
        },
    }
}

// Test hook: fail after this many accounts, to exercise the rollback.
#[cfg(test)]
thread_local! {
    pub static FAIL_AFTER: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

fn write_all(
    conn: &mut Connection,
    plans: &[ScenarioPlan],
    preset: Preset,
    seed: u32,
    anchor: NaiveDate,
) -> AppResult<Vec<AccountReport>> {
    let lib = Library::ensure(conn)?;
    let mut reports = Vec::new();
    for p in plans {
        #[cfg(test)]
        if FAIL_AFTER.with(|f| f.get()) == Some(reports.len()) {
            return Err(AppError::Database {
                message: "injected failure".into(),
            });
        }
        reports.push(write_scenario(conn, &lib, p, preset, seed, anchor)?);
    }
    Ok(reports)
}

// ---------------------------------------------------------------------------
// Review library (shared by every synthetic account)
// ---------------------------------------------------------------------------

struct Library {
    strategies: Vec<String>,
    /// (kind, id)
    tags: Vec<(&'static str, String)>,
    demo_tag: String,
    trade_checklist: (String, Vec<String>),
    daily_checklist: (String, Vec<String>),
}

impl Library {
    /// Reuse items of the same name (an earlier run, or the user's own library); create the rest.
    fn ensure(conn: &mut Connection) -> AppResult<Self> {
        let current = library::load(conn)?;
        let mut strategies = Vec::new();
        for (name, description) in [
            (
                "DEMO Opening range breakout",
                "Synthetic strategy: break of the first 15-minute range.",
            ),
            (
                "DEMO VWAP reclaim",
                "Synthetic strategy: reclaim of VWAP after a flush.",
            ),
            (
                "DEMO Trend pullback",
                "Synthetic strategy: pullback to the 20 EMA in a trend.",
            ),
        ] {
            strategies.push(
                match current
                    .strategies
                    .iter()
                    .find(|s| s.name.eq_ignore_ascii_case(name))
                {
                    Some(s) => s.id.clone(),
                    None => {
                        library::save_strategy(
                            conn,
                            None,
                            StrategyInput {
                                name: name.into(),
                                description: Some(description.into()),
                            },
                        )?
                        .id
                    }
                },
            );
        }
        let mut tags = Vec::new();
        for (kind, name) in [
            ("setup", "demo-orb"),
            ("setup", "demo-vwap"),
            ("setup", "demo-pullback"),
            ("mistake", "demo-chased-entry"),
            ("mistake", "demo-moved-stop"),
            ("mistake", "demo-oversized"),
            ("emotion", "demo-calm"),
            ("emotion", "demo-fomo"),
            ("emotion", "demo-revenge"),
            ("general", "demo-data"),
        ] {
            let id = match current
                .tags
                .iter()
                .find(|t| t.name.eq_ignore_ascii_case(name))
            {
                Some(t) => t.id.clone(),
                None => {
                    library::save_tag(
                        conn,
                        None,
                        TagInput {
                            name: name.into(),
                            kind: kind.into(),
                        },
                    )?
                    .id
                }
            };
            tags.push((kind, id));
        }
        let demo_tag = tags
            .iter()
            .find(|(k, _)| *k == "general")
            .unwrap()
            .1
            .clone();
        let mut checklist =
            |name: &str, scope: &str, items: &[&str]| -> AppResult<(String, Vec<String>)> {
                let c = match current
                    .checklists
                    .iter()
                    .find(|c| c.name.eq_ignore_ascii_case(name) && c.scope == scope)
                {
                    Some(c) => c.clone(),
                    None => library::save_checklist(
                        conn,
                        None,
                        ChecklistInput {
                            name: name.into(),
                            description: Some("Synthetic checklist from Add Fake Data.".into()),
                            scope: scope.into(),
                            strategy_id: None,
                            items: items
                                .iter()
                                .map(|l| ChecklistItemInput {
                                    id: None,
                                    label: (*l).into(),
                                })
                                .collect(),
                        },
                    )?,
                };
                Ok((
                    c.id.clone(),
                    c.items
                        .iter()
                        .filter(|i| !i.archived)
                        .map(|i| i.id.clone())
                        .collect(),
                ))
            };
        let trade_checklist = checklist(
            "DEMO pre-trade checklist",
            "trade",
            &[
                "Setup matches the plan",
                "Stop placed before entry",
                "Size within the daily risk",
            ],
        )?;
        let daily_checklist = checklist(
            "DEMO session rules",
            "daily",
            &[
                "Wrote the plan before the open",
                "Stopped after two losses",
                "No trades in the news window",
            ],
        )?;
        Ok(Library {
            strategies,
            tags,
            demo_tag,
            trade_checklist,
            daily_checklist,
        })
    }

    fn tag(&self, rng: &mut Rng, kind: &str) -> String {
        let of_kind: Vec<&String> = self
            .tags
            .iter()
            .filter(|(k, _)| *k == kind)
            .map(|(_, id)| id)
            .collect();
        (*rng.pick(&of_kind)).clone()
    }
}

// ---------------------------------------------------------------------------
// One scenario
// ---------------------------------------------------------------------------

fn instant(at: DateTime<Utc>) -> String {
    at.to_rfc3339()
}

fn day_at(p: &ScenarioPlan, day: NaiveDate, h: u32, m: u32) -> DateTime<Utc> {
    p.account
        .tz
        .from_local_datetime(&day.and_hms_opt(h, m, 0).unwrap())
        .earliest()
        .unwrap()
        .with_timezone(&Utc)
}

fn rule(key: &str, label: &str, order: i64, parameters: Value) -> RuleDefinitionInput {
    let manual = key == "news";
    RuleDefinitionInput {
        rule_key: key.into(),
        rule_type: if manual {
            "trading_restriction".into()
        } else {
            key.into()
        },
        parameter_schema_version: RULE_PARAMETER_SCHEMA_VERSION,
        provider_label: Some(format!("{label} (fictional)")),
        display_label: None,
        source_text: Some(format!("{DEMO_LABEL}: synthetic rule, not firm policy")),
        support_status: if manual {
            "manual_only".into()
        } else {
            "supported".into()
        },
        override_kind: None,
        display_order: order,
        parameters,
    }
}

fn value(v: impl Into<Value>) -> Value {
    json!({ "state": "value", "value": v.into() })
}

fn rule_definitions(r: &RuleSpec) -> Vec<RuleDefinitionInput> {
    let mut out = Vec::new();
    let mut add = |key: &str, label: &str, parameters: Value| {
        let order = out.len() as i64;
        out.push(rule(key, label, order, parameters));
    };
    if let Some(t) = r.target_cents {
        add(
            "profit_target",
            "Profit target",
            json!({ "amount": value(cents(t)), "basis": "balance" }),
        );
    }
    if let Some(dd) = r.drawdown_cents {
        let method = if r.trailing {
            "end_of_day_trailing"
        } else {
            "static"
        };
        add(
            "max_drawdown",
            "Max loss",
            json!({ "amount": value(cents(dd)), "method": method, "basis": "realized", "lock": { "state": "disabled" } }),
        );
    }
    if let Some(dll) = r.daily_loss_cents {
        add(
            "daily_loss_limit",
            "Daily loss limit",
            json!({
                "limit": value(cents(dll)), "basis": "realized", "resetBasis": "account_trading_day", "breach": "soft", "condition": "always",
            }),
        );
    }
    if let Some(pct) = r.consistency_pct {
        add(
            "consistency",
            "Consistency",
            json!({ "maxBestDayShare": value(format!("{}", pct as f64 / 100.0)), "denominator": "total_profit", "appliesTo": "evaluation" }),
        );
    }
    if let Some((days, min)) = r.min_days {
        add(
            "min_trading_days",
            "Minimum trading days",
            json!({ "days": value(days), "minDayProfit": value(cents(min)), "dayBasis": "trading_day" }),
        );
    }
    if let Some((minis, micros)) = r.max_contracts {
        add(
            "max_position_size",
            "Max contracts",
            json!({
                "limits": value(json!([
                    { "contractClass": "mini", "symbolRoot": null, "maxContracts": minis },
                    { "contractClass": "micro", "symbolRoot": null, "maxContracts": micros },
                ])),
                "combination": "either",
                "microsPerMini": value(10),
            }),
        );
    }
    if let Some(n) = r.max_trades_per_day {
        add(
            "max_trades_per_day",
            "Max trades per day",
            json!({ "count": value(n) }),
        );
    }
    if r.news_restriction {
        add(
            "news",
            "News",
            json!({ "category": "news", "description": "Flat 2 minutes around tier-1 news (synthetic rule)." }),
        );
    }
    out
}

fn trade_input(account_id: &str, t: &PlannedTrade) -> trades::TradeInput {
    let inst = t.instrument();
    trades::TradeInput {
        account_id: account_id.into(),
        symbol: t.symbol.clone(),
        side: if t.long { "long" } else { "short" }.into(),
        quantity: t.qty.to_string(),
        entry_at: instant(t.entry),
        entry_price: inst.price(t.entry_ticks),
        exit_at: Some(instant(t.exit)),
        exit_price: Some(inst.price(t.exit_ticks)),
        fees: Some(cents(t.fee_cents)),
        realized_pnl: None,
        notes: t.note.clone(),
    }
}

fn import(conn: &mut Connection, account_id: &str, p: &ScenarioPlan) -> AppResult<usize> {
    let mut rejected = 0;
    for file in &p.csv {
        let request = CsvImportRequest {
            account_id: account_id.into(),
            file_name: file.name.clone(),
            content: file.content.clone(),
            timezone: p.account.tz_name.into(),
            format: FormatChoice::Auto,
            date_format: DateFormatChoice::Auto,
            columns: None,
            target_acknowledgement: None,
        };
        // The normal review path: preview, acknowledge what it shows, commit.
        let preview = csv_import::preview(conn, &request)?;
        if preview.new_count as usize != file.new_rows
            || preview.duplicate_count as usize != file.duplicate_rows
            || preview.invalid_count as usize != file.invalid_rows
        {
            return Err(AppError::Database {
                message: format!(
                    "import preview of {} differs from the plan: {} new, {} duplicate, {} invalid (expected {}, {}, {})",
                    file.name,
                    preview.new_count,
                    preview.duplicate_count,
                    preview.invalid_count,
                    file.new_rows,
                    file.duplicate_rows,
                    file.invalid_rows
                ),
            });
        }
        let reviewed = CsvImportRequest {
            target_acknowledgement: Some(Acknowledgement {
                preview_token: preview.target_assessment.preview_token,
                historical_confirmed: true,
            }),
            ..request
        };
        let batch = csv_import::commit(conn, &reviewed)?;
        if batch.status != "committed" || batch.imported_count as usize != file.new_rows {
            return Err(AppError::Database {
                message: format!(
                    "import of {} did not commit as planned ({:?})",
                    file.name, batch.error_summary
                ),
            });
        }
        rejected += (batch.duplicate_count + batch.failed_count) as usize;
    }
    Ok(rejected)
}

fn observation(
    account_id: &str,
    kind: &str,
    value: i64,
    at: DateTime<Utc>,
    note: &str,
) -> ObservationInput {
    ObservationInput {
        account_id: account_id.into(),
        kind: kind.into(),
        value: Some(cents(value)),
        currency: "USD".into(),
        basis: "balance".into(),
        observed_at: instant(at),
        source_category: "user_entered".into(),
        source_reference: SOURCE.into(),
        confirmation: "user_confirmed".into(),
        confidence: "user_reported".into(),
        valid_until: None,
        actor: ACTOR.into(),
        note: Some(note.into()),
    }
}

const THESES: [&str; 5] = [
    "Opening range held as support; looked for continuation with the trend.",
    "Flush below VWAP reclaimed with volume; long back to the open.",
    "Lower high under the 20 EMA; short into the morning low.",
    "Overnight high retest; expected rotation back into value.",
    "Trend day: added on the first pullback after the drive.",
];
const REFLECTIONS: [&str; 5] = [
    "Followed the plan. Exit was early but within the rules.",
    "Entered late after the move had gone. Next time wait for the retest.",
    "Moved the stop once; should have taken the planned loss.",
    "Good patience. Sized correctly and let the target work.",
    "Took it out of boredom. Not an A setup.",
];
const DAY_TITLES: [&str; 5] = [
    "Pre-market plan",
    "Mid-session check-in",
    "End-of-day notes",
    "What I noticed today",
    "Mindset",
];
const DAY_BODIES: [&str; 5] = [
    "Levels: overnight high, VWAP, prior day close. Only A setups; stop after two losses.",
    "Chop in the first hour. Sat on my hands until the range broke.",
    "Respected the daily loss limit. Review the late entries tomorrow.",
    "Volume dried up after lunch; the best trades were in the first 90 minutes.",
    "Felt rushed after the first loss. Took a break before the next trade.",
];

fn write_scenario(
    conn: &mut Connection,
    lib: &Library,
    p: &ScenarioPlan,
    preset: Preset,
    seed: u32,
    anchor: NaiveDate,
) -> AppResult<AccountReport> {
    let mut rng = Rng::stream(u64::from(seed), &format!("{}:annotations", p.key));
    let a = accounts::create(
        conn,
        accounts::AccountInput {
            name: p.account.name.clone(),
            broker: Some(p.account.platform.into()),
            prop_firm: Some(p.account.firm.into()),
            external_ref: Some(p.account.external_ref.clone()),
            account_type: p.account.account_type.into(),
            status: "active".into(),
            currency: "USD".into(),
            starting_balance: cents(p.account.start_cents),
            timezone: p.account.tz_name.into(),
            trading_day_reset_time: p.account.reset.into(),
            notes: Some(account_notes(p, preset, seed, anchor)),
        },
    )?;
    let id = a.id.clone();
    let opened = day_at(p, p.first_day, 8, 0);
    let mut observations = 0;

    if let Some(rules) = &p.rules {
        let context = || ChangeContext {
            actor: ACTOR.into(),
            reason: Some("Synthetic rules from Add Fake Data".into()),
        };
        let draft = rulebooks::create_draft_with(
            conn,
            RulebookDraftInput {
                rulebook_id: None,
                new_rulebook: Some(NewRulebook {
                    provider_id: None,
                    owner_account_id: Some(id.clone()),
                    slug: format!("demo-{}", p.key.replace('_', "-")),
                    display_name: format!("DEMO rules · {}", p.key.replace('_', " ")),
                    description: Some(format!(
                        "{DEMO_LABEL}: fictional rules for a synthetic account. Not verified firm policy."
                    )),
                }),
                supersedes_version_id: None,
                change_reason: Some("Synthetic rules from Add Fake Data".into()),
                captured_at: instant(opened),
                effective_from: None,
                effective_to: None,
                rules: rule_definitions(rules),
                applicability: vec![],
            },
            context(),
        )?;
        let version = rulebooks::publish_with(conn, &draft.version.id, None, None, context())?;
        rulebooks::assign_with(
            conn,
            AssignmentInput {
                account_id: id.clone(),
                rulebook_version_id: version.version.id,
                // Assignments start on a trading day; the window may open on a weekend.
                effective_from: plan_weekdays(p.first_day, anchor)
                    .first()
                    .copied()
                    .unwrap_or(p.first_day)
                    .to_string(),
                programme_phase_id: None,
                phase_path_id: None,
                account_phase_event_id: None,
            },
            Some(AssignmentGuard {
                expected_open_assignment_id: None,
                actor: ACTOR.into(),
                reason: None,
            }),
        )?;
        evidence::create(
            conn,
            observation(
                &id,
                "opening_balance",
                p.account.start_cents,
                opened,
                "Opening balance of the synthetic account.",
            ),
        )?;
        observations += 1;
    }

    // Trades: entered directly, or through the normal CSV import path.
    let mut stored: Vec<(String, &PlannedTrade)> = Vec::new();
    for t in &p.trades {
        stored.push((trades::create(conn, trade_input(&id, t))?.id, t));
    }
    let rejected = import(conn, &id, p)?;
    let import_batches = p.csv.len();

    // Reconcile: the store's trades, trading days and P&L must match the plan exactly.
    let mut listed = trades::list(conn, &id)?;
    listed.sort_by(|x, y| x.entry_at.cmp(&y.entry_at).then(x.exit_at.cmp(&y.exit_at)));
    let mut planned: Vec<&PlannedTrade> = p.all_trades().collect();
    planned.sort_by_key(|t| (t.entry, t.exit));
    if listed.len() != planned.len() {
        return Err(AppError::Database {
            message: format!(
                "{}: {} trades stored, {} planned",
                p.key,
                listed.len(),
                planned.len()
            ),
        });
    }
    let micros = |s: &Option<String>| s.as_deref().and_then(parse_decimal).and_then(to_micros);
    for (s, t) in listed.iter().zip(&planned) {
        if micros(&s.realized_pnl) != Some(t.net_cents * 10_000)
            || s.trading_day != t.trading_day.to_string()
            || s.pnl_status != "calculated"
        {
            return Err(AppError::Database {
                message: format!(
                    "{}: stored trade {} ({} {}, {:?}) does not reconcile with its plan (net {}, day {})",
                    p.key,
                    s.id,
                    s.trading_day,
                    s.pnl_status,
                    s.realized_pnl,
                    cents(t.net_cents),
                    t.trading_day
                ),
            });
        }
    }
    if p.trades.is_empty() {
        // Imported trades: pair them with their plan for reviews.
        stored = listed
            .iter()
            .zip(&planned)
            .map(|(s, t)| (s.id.clone(), *t))
            .collect();
    }

    // Trade reviews on about a third of the trades; journal notes and daily reviews on some days.
    let reviewed_scenarios = ["happy_path", "at_risk", "failed", "stress", "passed"];
    let mut trade_reviews = 0;
    if reviewed_scenarios.contains(&p.key) {
        for (trade_id, t) in &stored {
            if !rng.chance(if p.key == "stress" { 12 } else { 35 }) {
                continue;
            }
            let inst = t.instrument();
            let sign = if t.long { 1 } else { -1 };
            let won = t.net_cents > 0;
            let (checklist_id, items) = &lib.trade_checklist;
            let mut tag_ids = vec![lib.tag(&mut rng, "setup"), lib.demo_tag.clone()];
            tag_ids.push(lib.tag(&mut rng, if won { "emotion" } else { "mistake" }));
            tag_ids.dedup();
            reviews::save(
                conn,
                None,
                ReviewInput {
                    account_id: id.clone(),
                    trade_id: trade_id.clone(),
                    expected_revision: None,
                    strategy_id: Some((*rng.pick(&lib.strategies)).clone()),
                    checklist_id: Some(checklist_id.clone()),
                    planned_entry_price: Some(inst.price(t.entry_ticks)),
                    planned_stop_price: Some(
                        inst.price(t.entry_ticks - sign * t.planned_stop_ticks),
                    ),
                    planned_target_price: Some(
                        inst.price(t.entry_ticks + sign * t.planned_target_ticks),
                    ),
                    planned_risk: Some(cents(t.planned_stop_ticks * inst.tick_cents * t.qty)),
                    execution_rating: Some(if won {
                        rng.range(3, 5)
                    } else {
                        rng.range(1, 3)
                    }),
                    thesis: Some(rng.pick(&THESES).to_string()),
                    reflection: rng.chance(80).then(|| rng.pick(&REFLECTIONS).to_string()),
                    reviewed: rng.chance(70),
                    tag_ids,
                    checklist_results: items
                        .iter()
                        .map(|item| ChecklistAnswerInput {
                            item_id: item.clone(),
                            result: (*rng.weighted(&[
                                ("followed", 7),
                                ("missed", 2),
                                ("not_applicable", 1),
                            ]))
                            .into(),
                            note: None,
                        })
                        .collect(),
                },
            )?;
            trade_reviews += 1;
        }
    }

    let mut days: BTreeMap<NaiveDate, Vec<&(String, &PlannedTrade)>> = BTreeMap::new();
    for s in &stored {
        days.entry(s.1.trading_day).or_default().push(s);
    }
    let mut journal_entries = 0;
    if p.key != "empty" {
        for (day, on_day) in &days {
            if !rng.chance(22) {
                continue;
            }
            let link = rng.chance(40).then(|| on_day[0].0.clone());
            journal::create(
                conn,
                journal::JournalEntryInput {
                    account_id: id.clone(),
                    trade_id: link,
                    entry_at: instant(
                        day_at(p, *day, 15, 30)
                            .min(on_day.last().unwrap().1.exit + Duration::minutes(5)),
                    ),
                    title: format!("[DEMO] {}", rng.pick(&DAY_TITLES)),
                    body: format!(
                        "{}\n\n_{DEMO_LABEL}: synthetic journal entry._",
                        rng.pick(&DAY_BODIES)
                    ),
                    tags: vec![
                        "demo-data".into(),
                        (*rng.pick(&["plan", "discipline", "review", "mindset"])).into(),
                    ],
                },
            )?;
            journal_entries += 1;
        }
    }

    let mut daily_reviews = 0;
    let traded: Vec<NaiveDate> = days.keys().copied().collect();
    let review_days: Vec<(NaiveDate, &str)> = match p.key {
        "happy_path" => traded
            .iter()
            .rev()
            .filter(|d| **d < anchor)
            .take(8)
            .map(|d| (*d, "complete"))
            .collect(),
        "at_risk" => p.watch_days.iter().map(|d| (*d, "save")).collect(),
        "failed" => traded
            .last()
            .map(|d| vec![(*d, "complete")])
            .unwrap_or_default(),
        _ => vec![],
    };
    for (day, action) in &review_days {
        let (checklist_id, items) = &lib.daily_checklist;
        let failed_day = p.key == "failed";
        daily_reviews::save(
            conn,
            DailyReviewInput {
                account_id: id.clone(),
                trading_day: day.to_string(),
                expected_revision: None,
                plan: PlanInput {
                    focus: Some(
                        rng.pick(&[
                            "Only A setups",
                            "Wait for the opening range",
                            "Trade the trend, not the chop",
                        ])
                        .to_string(),
                    ),
                    setups: Some("ORB, VWAP reclaim".into()),
                    no_trade_conditions: Some(
                        "First 5 minutes; 2 minutes either side of tier-1 news".into(),
                    ),
                    commitments: Some("Stop after two losses".into()),
                    max_risk: Some("400".into()),
                    notes: Some(format!("{DEMO_LABEL}: synthetic plan.")),
                },
                reflection: ReflectionInput {
                    market_context: Some("Range day until the afternoon break.".into()),
                    went_well: (!failed_day)
                        .then(|| "Waited for confirmation before entering.".into()),
                    mistakes: if failed_day {
                        Some("Kept trading after the daily limit; revenge sized up through the max loss.".into())
                    } else {
                        rng.chance(50).then(|| "One late entry.".into())
                    },
                    emotions: Some(
                        if failed_day {
                            "Frustrated, then reckless."
                        } else {
                            "Calm."
                        }
                        .into(),
                    ),
                    key_lesson: Some(
                        if failed_day {
                            "Walk away after the second loss."
                        } else {
                            "Patience pays."
                        }
                        .into(),
                    ),
                    next_action: Some("Review the losing trades before the open.".into()),
                    notes: None,
                },
                no_trade_day: false,
                checklist_id: Some(checklist_id.clone()),
                answers: items
                    .iter()
                    .map(|item| ChecklistAnswerInput {
                        item_id: item.clone(),
                        result: if failed_day {
                            "missed".into()
                        } else {
                            (*rng.weighted(&[("followed", 8), ("missed", 2)])).into()
                        },
                        note: None,
                    })
                    .collect(),
                action: (*action).into(),
            },
        )?;
        daily_reviews += 1;
    }
    // A reviewed day with no trades, so the calendar shows a "no-trade day" review.
    if p.key == "happy_path"
        && let Some(quiet) = plan_weekdays(p.first_day, anchor)
            .into_iter()
            .rev()
            .find(|d| *d < anchor && !days.contains_key(d))
    {
        daily_reviews::save(
            conn,
            DailyReviewInput {
                account_id: id.clone(),
                trading_day: quiet.to_string(),
                expected_revision: None,
                plan: PlanInput {
                    focus: Some("Sit out: FOMC day.".into()),
                    ..Default::default()
                },
                reflection: ReflectionInput {
                    key_lesson: Some("Not trading is a position.".into()),
                    ..Default::default()
                },
                no_trade_day: true,
                checklist_id: None,
                answers: vec![],
                action: "complete".into(),
            },
        )?;
        daily_reviews += 1;
    }

    // An end-of-day trailing drawdown trails the firm's end-of-day settlements (the engine reads them, not the
    // trades), so record each traded day's closing balance as copied from the firm dashboard, just before the reset.
    if p.rules
        .as_ref()
        .is_some_and(|r| r.trailing && r.drawdown_cents.is_some())
    {
        for (day, balance) in &p.eod {
            evidence::create(
                conn,
                ObservationInput {
                    source_category: "firm_dashboard".into(),
                    ..observation(
                        &id,
                        "eod_settlement",
                        *balance,
                        settlement_at(p, *day).min(Utc::now()),
                        "End-of-day settlement (synthetic).",
                    )
                },
            )?;
            observations += 1;
        }
    }

    if let Some(status) = &p.status {
        accounts::change_status(
            conn,
            &id,
            accounts::StatusChangeInput {
                status: status.status.into(),
                effective_at: Some(instant(status.effective_at)),
                cause: Some(status.cause.into()),
                note: Some(format!("{DEMO_LABEL}: synthetic status change.")),
            },
        )?;
    }
    if p.archived {
        accounts::archive(conn, &id)?;
    }

    let net: i64 = p.net_cents();
    let count = |f: fn(i64) -> bool| p.all_trades().filter(|t| f(t.net_cents)).count();
    let gross_zero = p.all_trades().filter(|t| t.gross_cents == 0).count();
    Ok(AccountReport {
        scenario: p.key.into(),
        account_id: id,
        name: p.account.name.clone(),
        status: p
            .status
            .as_ref()
            .map(|s| s.status)
            .unwrap_or("active")
            .into(),
        archived: p.archived,
        trades: planned.len(),
        winners: count(|n| n > 0),
        losers: count(|n| n < 0) - gross_zero,
        breakeven: gross_zero,
        trading_days: days.len(),
        starting_balance: cents(p.account.start_cents),
        ending_balance: cents(p.ending_cents()),
        net_pnl: cents(net),
        fees: cents(p.all_trades().map(|t| t.fee_cents).sum()),
        drawdown_floor: p.floor_cents().map(cents),
        import_batches,
        rejected_import_rows: rejected,
        journal_entries,
        trade_reviews,
        daily_reviews,
        observations,
        covers: p.covers.iter().map(|c| c.to_string()).collect(),
    })
}

fn plan_weekdays(first: NaiveDate, last: NaiveDate) -> Vec<NaiveDate> {
    use chrono::Datelike;
    first
        .iter_days()
        .take_while(|d| *d <= last)
        .filter(|d| d.weekday().number_from_monday() <= 5)
        .collect()
}

/// When a trading day's settlement is observed: one second before the account's reset, after every trade
/// of that day has closed (the engine checks each settlement against the trades closed by then).
pub fn settlement_at(p: &ScenarioPlan, day: NaiveDate) -> DateTime<Utc> {
    let reset = crate::domain::parse_reset_time(p.account.reset).unwrap();
    let day = if reset == chrono::NaiveTime::MIN {
        day + Duration::days(1)
    } else {
        day
    };
    p.account
        .tz
        .from_local_datetime(&day.and_time(reset))
        .earliest()
        .unwrap()
        .with_timezone(&Utc)
        - Duration::seconds(1)
}

/// Where the rollback copy lives while a run is in progress.
pub fn rollback_path(data_dir: &Path) -> PathBuf {
    data_dir.join(ROLLBACK_FILE)
}
