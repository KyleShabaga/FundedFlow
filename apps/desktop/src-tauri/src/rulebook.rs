//! Rulebook DTOs (Build 9.5), mirroring the Zod contracts in
//! `packages/domain/src/rulebook`. Field names and enum values are the wire
//! names. Rule parameters stay JSON, but are checked here against the typed
//! shape of their rule type (unknown fields rejected, like `z.strictObject`)
//! before anything is written, and `check_rule_definitions` mirrors the
//! TypeScript `checkRuleDefinitions`.
//!
//! The tables are `migrations/0009_rulebooks.sql`; the store operations are in
//! `store/rulebooks.rs` and the legacy conversion in `db/steps.rs`.

use serde::de::{DeserializeOwned, Error as _};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};

use crate::domain::{canonical, micros_to_string, parse_decimal, to_micros};
use crate::error::FieldIssue;

pub const RULE_PARAMETER_SCHEMA_VERSION: i64 = 1;

// ---------------------------------------------------------------------------
// Typed parameter shapes (packages/domain/src/rulebook/rules.ts)
// ---------------------------------------------------------------------------

/// Canonical non-negative decimal text that fits in micro-units exactly.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Money(pub String);

impl<'de> Deserialize<'de> for Money {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        let ok = parse_decimal(&s)
            .filter(|v| canonical(*v) == s && !v.is_sign_negative())
            .and_then(to_micros)
            .is_some_and(|m| micros_to_string(m) == s);
        if ok { Ok(Money(s)) } else { Err(D::Error::custom(format!("'{s}' is not a canonical non-negative amount"))) }
    }
}

/// Canonical decimal in (0, 1].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Share(pub String);

impl<'de> Deserialize<'de> for Share {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        let ok = parse_decimal(&s).is_some_and(|v| {
            canonical(v) == s && v > rust_decimal::Decimal::ZERO && v <= rust_decimal::Decimal::ONE
        });
        if ok { Ok(Share(s)) } else { Err(D::Error::custom(format!("'{s}' is not a share in (0, 1]"))) }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum Presence<T> {
    Unknown,
    ExplicitNone,
    Disabled,
    NotApplicable,
    Value { value: T },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PositiveCount(#[serde(deserialize_with = "positive")] pub u32);

fn positive<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let n = u32::deserialize(d)?;
    if n >= 1 { Ok(n) } else { Err(D::Error::custom("must be at least 1")) }
}

macro_rules! choice {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    };
}

choice!(TargetBasis { Balance, Equity, Unknown });
choice!(UnrealizedBasis { Realized, RealizedAndUnrealized, Unknown });
choice!(ResetBasis { AccountTradingDay, ProviderSession, Unknown });
choice!(Breach { Hard, Soft, Unknown });
choice!(LimitCondition { Always, BelowInitialTrail, Unknown });
choice!(DrawdownMethod { Static, EndOfDayTrailing, IntradayTrailing, Unknown });
choice!(DayBasis { TradingDay, CalendarDay, Unknown });
choice!(ConsistencyDenominator { TotalProfit, ProfitTarget, Unknown });
choice!(ConsistencyScope { Evaluation, Payout, Both, Unknown });
choice!(ContractClass { Mini, Micro, Any });
choice!(LimitCombination { Each, Either, AggregateEquivalent, Unknown });
choice!(PhaseKey { Evaluation, SimulatedFunded, LiveFunded, Other, Unknown });
choice!(RestrictionCategory { News, Overnight, Weekend, Strategy, Inactivity, Other });

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct ProfitTarget { amount: Presence<Money>, basis: TargetBasis }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct DailyLossLimit {
    limit: Presence<Money>,
    basis: UnrealizedBasis,
    reset_basis: ResetBasis,
    breach: Breach,
    condition: LimitCondition,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct TrailLock { trigger_balance: Money, locked_floor: Money }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct MaxDrawdown { amount: Presence<Money>, method: DrawdownMethod, basis: UnrealizedBasis, lock: Presence<TrailLock> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct MinTradingDays { days: Presence<PositiveCount>, min_day_profit: Presence<Money>, day_basis: DayBasis }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct Consistency { max_best_day_share: Presence<Share>, denominator: ConsistencyDenominator, applies_to: ConsistencyScope }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct PositionLimit { contract_class: ContractClass, symbol_root: Option<String>, max_contracts: PositiveCount }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct MaxPositionSize { limits: Presence<Vec<PositionLimit>>, combination: LimitCombination, micros_per_mini: Presence<PositiveCount> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct MaxTradesPerDay { count: Presence<PositiveCount> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct PayoutEligibility {
    initial_waiting_days: Presence<u32>,
    frequency: Presence<String>,
    min_balance: Presence<Money>,
    min_profit: Presence<Money>,
    per_request_cap: Presence<Money>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct PayoutCountTransition { payouts_required: Presence<PositiveCount>, next_phase: PhaseKey }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct ScalingStep { balance_at_least: Money, max_contracts: PositiveCount }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct ScalingPlan { offered: Presence<bool>, schedule: Presence<Vec<ScalingStep>> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct TradingRestriction { category: RestrictionCategory, description: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct ManualCheck { description: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct UnknownRule { description: Option<String> }

/// Rule types confirmed by a person, never calculated.
pub const MANUAL_RULE_TYPES: [&str; 3] = ["trading_restriction", "manual_check", "unknown"];

/// Parameter paths a `supported` rule must know (rules.ts `requiredValues`).
fn required_values(rule_type: &str) -> &'static [&'static str] {
    match rule_type {
        "profit_target" => &["amount"],
        "daily_loss_limit" => &["limit"],
        "max_drawdown" => &["amount", "method"],
        "min_trading_days" => &["days"],
        "consistency" => &["maxBestDayShare"],
        "max_position_size" => &["limits", "combination"],
        "max_trades_per_day" => &["count"],
        "payout_count_transition" => &["payoutsRequired"],
        "scaling_plan" => &["offered", "schedule"],
        _ => &[],
    }
}

fn shape<T: DeserializeOwned>(parameters: &Value) -> Result<(), String> {
    serde_json::from_value::<T>(parameters.clone()).map(|_| ()).map_err(|e| e.to_string())
}

/// Checks `parameters` against the shape of `rule_type`.
pub fn check_parameters(rule_type: &str, parameters: &Value) -> Result<(), String> {
    match rule_type {
        "profit_target" => shape::<ProfitTarget>(parameters),
        "daily_loss_limit" => shape::<DailyLossLimit>(parameters),
        "max_drawdown" => shape::<MaxDrawdown>(parameters),
        "min_trading_days" => shape::<MinTradingDays>(parameters),
        "consistency" => shape::<Consistency>(parameters),
        "max_position_size" => shape::<MaxPositionSize>(parameters),
        "max_trades_per_day" => shape::<MaxTradesPerDay>(parameters),
        "payout_eligibility" => shape::<PayoutEligibility>(parameters),
        "payout_count_transition" => shape::<PayoutCountTransition>(parameters),
        "scaling_plan" => shape::<ScalingPlan>(parameters),
        "trading_restriction" => shape::<TradingRestriction>(parameters),
        "manual_check" => shape::<ManualCheck>(parameters),
        "unknown" => shape::<UnknownRule>(parameters),
        other => Err(format!("unknown rule type '{other}'")),
    }
}

fn value_known(parameters: &Value, path: &str) -> bool {
    match parameters.get(path) {
        Some(Value::String(s)) => s != "unknown",
        Some(Value::Object(o)) => o.get("state").and_then(Value::as_str) != Some("unknown"),
        Some(_) => true,
        None => false,
    }
}

// ---------------------------------------------------------------------------
// DTOs (packages/domain/src/rulebook/versions.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rulebook {
    pub id: String,
    pub provider_id: Option<String>,
    pub owner_account_id: Option<String>,
    pub slug: String,
    pub display_name: String,
    pub description: Option<String>,
    pub record_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulebookVersion {
    pub id: String,
    pub rulebook_id: String,
    pub version_number: i64,
    pub schema_version: i64,
    pub verification_status: String,
    pub origin: String,
    pub captured_at: String,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    pub verified_by: Option<String>,
    pub verified_at: Option<String>,
    pub user_confirmed_at: Option<String>,
    pub change_reason: Option<String>,
    pub supersedes_version_id: Option<String>,
    pub record_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleDefinitionInput {
    pub rule_key: String,
    pub rule_type: String,
    pub parameter_schema_version: i64,
    pub provider_label: Option<String>,
    pub display_label: Option<String>,
    pub source_text: Option<String>,
    pub support_status: String,
    pub override_kind: Option<String>,
    pub display_order: i64,
    pub parameters: Value,
}

// No deny_unknown_fields: serde does not support it with `flatten`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleDefinition {
    pub id: String,
    pub rulebook_version_id: String,
    #[serde(flatten)]
    pub rule: RuleDefinitionInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleApplicability {
    pub id: String,
    pub rulebook_version_id: String,
    pub catalogue_version_id: String,
    pub programme_phase_id: String,
    pub phase_path_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleClaim {
    pub id: String,
    pub rule_definition_id: String,
    pub source_id: String,
    pub field: Option<String>,
    pub origin: String,
    pub provider_text: Option<String>,
    pub claim_status: String,
    pub note: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountRulebookAssignment {
    pub id: String,
    pub account_id: String,
    pub rulebook_version_id: String,
    pub programme_phase_id: Option<String>,
    pub phase_path_id: Option<String>,
    pub account_phase_event_id: Option<String>,
    pub effective_from: String,
    pub effective_to: Option<String>,
    pub assigned_at: String,
    pub assignment_source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulebookVersionDetail {
    pub rulebook: Rulebook,
    pub version: RulebookVersion,
    pub rules: Vec<RuleDefinition>,
    pub applicability: Vec<RuleApplicability>,
    pub claims: Vec<RuleClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewRulebook {
    pub provider_id: Option<String>,
    pub owner_account_id: Option<String>,
    pub slug: String,
    pub display_name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicabilityInput {
    pub catalogue_version_id: String,
    pub programme_phase_id: String,
    pub phase_path_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulebookDraftInput {
    pub rulebook_id: Option<String>,
    pub new_rulebook: Option<NewRulebook>,
    pub supersedes_version_id: Option<String>,
    pub change_reason: Option<String>,
    pub captured_at: String,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    pub rules: Vec<RuleDefinitionInput>,
    pub applicability: Vec<ApplicabilityInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssignmentInput {
    pub account_id: String,
    pub rulebook_version_id: String,
    pub effective_from: String,
    pub programme_phase_id: Option<String>,
    pub phase_path_id: Option<String>,
    pub account_phase_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceConflictInput {
    pub rule_definition_id: String,
    pub source_id: String,
    pub field: Option<String>,
    pub provider_text: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicableRulebookQuery {
    pub programme_phase_id: String,
    pub phase_path_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicableRulebook {
    /// "resolved" | "unverified" | "ambiguous" | "none"
    pub status: &'static str,
    pub rulebook_version_ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Build 19: draft editing, guarded writes and the audit log
// ---------------------------------------------------------------------------

/// A draft's new content. Its rulebook, number and the version it supersedes stay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulebookDraftUpdate {
    pub change_reason: Option<String>,
    pub captured_at: String,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    pub rules: Vec<RuleDefinitionInput>,
    pub applicability: Vec<ApplicabilityInput>,
}

/// Who acts and why, for the audit log. A local label, not an authenticated identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeContext {
    pub actor: String,
    pub reason: Option<String>,
}

impl ChangeContext {
    /// The label used by callers that predate the audit log.
    pub fn local() -> Self {
        Self { actor: "local_user".into(), reason: None }
    }
}

/// What the caller saw when it decided to assign: the account's open
/// assignment (None: there was none). A different open assignment is a conflict.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssignmentGuard {
    pub expected_open_assignment_id: Option<String>,
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulebookEvent {
    pub id: String,
    pub rulebook_id: String,
    pub rulebook_version_id: String,
    pub account_id: Option<String>,
    pub assignment_id: Option<String>,
    pub action: String,
    pub actor: String,
    pub reason: Option<String>,
    pub occurred_at: String,
}

/// Events of one rulebook, or about one account (its assignments and its private rulebooks).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulebookEventQuery {
    pub rulebook_id: Option<String>,
    pub account_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Checks shared with packages/domain/src/rulebook/integrity.ts
// ---------------------------------------------------------------------------

fn rule_key_ok(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 100
        && key.split(':').all(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'))
}

/// Shape and consistency of a set of rules (`checkRuleDefinitions`, plus the
/// Zod shape checks the TypeScript side runs before it).
pub fn check_rule_definitions(rules: &[RuleDefinitionInput]) -> Vec<FieldIssue> {
    let mut issues = Vec::new();
    let mut keys = std::collections::BTreeSet::new();
    for (i, rule) in rules.iter().enumerate() {
        let at = |field: &str| format!("rules[{i}].{field}");
        if !rule_key_ok(&rule.rule_key) {
            issues.push(FieldIssue::new(at("ruleKey"), "Use lowercase words joined by ':'"));
        }
        if !keys.insert(rule.rule_key.clone()) {
            issues.push(FieldIssue::new(at("ruleKey"), format!("Duplicate rule key '{}'", rule.rule_key)));
        }
        if rule.parameter_schema_version != RULE_PARAMETER_SCHEMA_VERSION {
            issues.push(FieldIssue::new(at("parameterSchemaVersion"), "Unsupported parameter schema version"));
        }
        if !matches!(rule.support_status.as_str(), "supported" | "manual_only" | "unsupported" | "needs_setup") {
            issues.push(FieldIssue::new(at("supportStatus"), "Unknown support status"));
        }
        if let Err(e) = check_parameters(&rule.rule_type, &rule.parameters) {
            issues.push(FieldIssue::new(at("parameters"), e));
            continue;
        }
        let manual = MANUAL_RULE_TYPES.contains(&rule.rule_type.as_str());
        if manual && !matches!(rule.support_status.as_str(), "manual_only" | "unsupported") {
            issues.push(FieldIssue::new(at("supportStatus"), format!("A {} rule is confirmed by a person (manual_only)", rule.rule_type)));
        }
        let missing: Vec<&str> =
            required_values(&rule.rule_type).iter().copied().filter(|p| !value_known(&rule.parameters, p)).collect();
        if rule.support_status == "supported" && !missing.is_empty() {
            issues.push(FieldIssue::new(at("supportStatus"), format!("Unknown {}: mark the rule needs_setup", missing.join(", "))));
        }
        if rule.support_status == "needs_setup" && missing.is_empty() && !manual {
            issues.push(FieldIssue::new(at("supportStatus"), "Every needed value is known: mark the rule supported"));
        }
        match rule.override_kind.as_deref() {
            None => {}
            Some("personal_limit") if rule.provider_label.is_some() => {
                issues.push(FieldIssue::new(at("providerLabel"), "A personal limit has no provider wording"));
            }
            Some("personal_limit") => {}
            Some(_) => issues.push(FieldIssue::new(at("overrideKind"), "Unknown override kind")),
        }
        if rule.display_order < 0 {
            issues.push(FieldIssue::new(at("displayOrder"), "Must be 0 or more"));
        }
    }
    issues
}

// ---------------------------------------------------------------------------
// Legacy conversion (docs/rulebook-migration.md, "Rule parameters")
// ---------------------------------------------------------------------------

fn money_from_micros(v: &Value) -> Option<Value> {
    let m = v.as_i64().filter(|m| *m >= 0)?;
    Some(json!({ "state": "value", "value": micros_to_string(m) }))
}

fn count_value(v: &Value) -> Option<Value> {
    let n = v.as_u64().filter(|n| *n >= 1 && *n <= u32::MAX as u64)?;
    Some(json!({ "state": "value", "value": n }))
}

fn unrealized(flag: Option<bool>) -> &'static str {
    match flag {
        Some(true) => "realized_and_unrealized",
        Some(false) => "realized",
        None => "unknown",
    }
}

/// The new parameters for a known legacy rule, or None when its params do
/// not have the documented legacy shape.
fn convert_known(rule_type: &str, p: &Map<String, Value>) -> Option<Value> {
    let only = |keys: &[&str]| p.keys().all(|k| keys.contains(&k.as_str()));
    Some(match rule_type {
        "profit_target" if only(&["amount_micros"]) => {
            json!({ "amount": money_from_micros(p.get("amount_micros")?)?, "basis": "unknown" })
        }
        "daily_loss_limit" if only(&["amount_micros", "basis"]) => {
            let basis = match p.get("basis")?.as_str()? {
                b @ ("realized" | "realized_and_unrealized") => b,
                _ => return None,
            };
            json!({ "limit": money_from_micros(p.get("amount_micros")?)?, "basis": basis,
                    "resetBasis": "account_trading_day", "breach": "unknown", "condition": "always" })
        }
        "max_drawdown" if only(&["mode", "amount_micros", "includes_unrealized", "lock"]) => {
            let method = match p.get("mode")?.as_str()? {
                "static" => "static",
                "eod_trailing" => "end_of_day_trailing",
                "intraday_trailing" => "intraday_trailing",
                _ => return None,
            };
            let lock = match p.get("lock") {
                None | Some(Value::Null) => json!({ "state": "explicit_none" }),
                Some(Value::Object(l)) => {
                    let trigger = money_from_micros(l.get("trigger_balance_micros")?)?;
                    let floor = money_from_micros(l.get("locked_floor_micros")?)?;
                    json!({ "state": "value", "value": { "triggerBalance": trigger["value"], "lockedFloor": floor["value"] } })
                }
                _ => return None,
            };
            json!({ "amount": money_from_micros(p.get("amount_micros")?)?, "method": method,
                    "basis": unrealized(p.get("includes_unrealized").and_then(Value::as_bool)), "lock": lock })
        }
        "min_trading_days" if only(&["days", "min_day_profit_micros"]) => {
            let profit = match p.get("min_day_profit_micros") {
                None | Some(Value::Null) => json!({ "state": "explicit_none" }),
                Some(v) => money_from_micros(v)?,
            };
            json!({ "days": count_value(p.get("days")?)?, "minDayProfit": profit, "dayBasis": "trading_day" })
        }
        "consistency" if only(&["max_best_day_share_bps"]) => {
            let bps = p.get("max_best_day_share_bps")?.as_i64().filter(|b| (1..=10_000).contains(b))?;
            let share = canonical(rust_decimal::Decimal::new(bps, 4));
            json!({ "maxBestDayShare": { "state": "value", "value": share }, "denominator": "unknown", "appliesTo": "unknown" })
        }
        "max_position_size" if only(&["max_contracts", "symbol_root"]) => {
            let root = match p.get("symbol_root") {
                None | Some(Value::Null) => Value::Null,
                Some(Value::String(s)) => {
                    let s = s.trim().to_ascii_uppercase();
                    if s.is_empty() || s.len() > 10 || !s.bytes().all(|b| b.is_ascii_alphanumeric()) {
                        return None;
                    }
                    Value::String(s)
                }
                _ => return None,
            };
            let max = count_value(p.get("max_contracts")?)?["value"].clone();
            json!({ "limits": { "state": "value", "value": [{ "contractClass": "any", "symbolRoot": root, "maxContracts": max }] },
                    "combination": "each", "microsPerMini": { "state": "unknown" } })
        }
        "max_trades_per_day" if only(&["count"]) => json!({ "count": count_value(p.get("count")?)? }),
        "manual_check" if only(&["description"]) => {
            let d = p.get("description")?.as_str()?.trim();
            if d.is_empty() {
                return None;
            }
            json!({ "description": d })
        }
        _ => return None,
    })
}

/// All-unknown parameters of a rule type whose legacy value was `unknown`.
fn unknown_parameters(rule_type: &str) -> Option<Value> {
    let u = json!({ "state": "unknown" });
    Some(match rule_type {
        "profit_target" => json!({ "amount": u, "basis": "unknown" }),
        "daily_loss_limit" => json!({ "limit": u, "basis": "unknown", "resetBasis": "unknown", "breach": "unknown", "condition": "unknown" }),
        "max_drawdown" => json!({ "amount": u, "method": "unknown", "basis": "unknown", "lock": u }),
        "min_trading_days" => json!({ "days": u, "minDayProfit": u, "dayBasis": "unknown" }),
        "consistency" => json!({ "maxBestDayShare": u, "denominator": "unknown", "appliesTo": "unknown" }),
        "max_position_size" => json!({ "limits": u, "combination": "unknown", "microsPerMini": u }),
        "max_trades_per_day" => json!({ "count": u }),
        _ => return None,
    })
}

/// A legacy rule converted to `(rule_type, parameters, support_status)`.
/// Params that do not have the documented legacy shape are kept verbatim in an
/// `unknown` rule marked `unsupported`, so nothing is guessed or lost.
pub fn convert_legacy_rule(rule_type: &str, evaluation: &str, value_state: &str, params_json: &str) -> (String, Value, String) {
    let parsed: Option<Map<String, Value>> = serde_json::from_str(params_json).ok();
    let converted = match (value_state, &parsed) {
        ("unknown", _) => unknown_parameters(rule_type).map(|p| (p, "needs_setup")),
        (_, Some(p)) => convert_known(rule_type, p).map(|params| {
            let manual = rule_type == "manual_check" || evaluation == "manual_confirmation";
            (params, if manual { "manual_only" } else { "supported" })
        }),
        _ => None,
    };
    match converted {
        // A calculated rule marked for manual confirmation stays a checklist item.
        Some((params, "manual_only")) if rule_type != "manual_check" => {
            let description = format!("Confirm manually: legacy {rule_type} rule {params}");
            ("manual_check".into(), json!({ "description": description }), "manual_only".into())
        }
        Some((params, status)) if check_parameters(rule_type, &params).is_ok() => {
            (rule_type.into(), params, status.into())
        }
        _ => {
            let description = format!("Legacy {rule_type} rule ({value_state}) with parameters {params_json}");
            ("unknown".into(), json!({ "description": description }), "unsupported".into())
        }
    }
}

/// The stable rule key of a legacy rule (docs/rulebook-migration.md).
pub fn legacy_rule_key(rule_type: &str, origin: &str, sort_order: i64) -> String {
    match rule_type {
        "manual_check" | "max_position_size" => format!("{rule_type}:{origin}:{sort_order}"),
        _ if origin == "personal" => format!("{rule_type}:personal"),
        _ => rule_type.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameters_are_checked_against_their_rule_type() {
        let pt = json!({ "amount": { "state": "value", "value": "3000" }, "basis": "unknown" });
        assert!(check_parameters("profit_target", &pt).is_ok());
        assert!(check_parameters("max_drawdown", &pt).is_err());
        for bad in [
            json!({ "amount": null, "basis": "unknown" }),
            json!({ "amount": { "state": "value", "value": 0 }, "basis": "unknown" }),
            json!({ "amount": { "state": "value", "value": "3000.0" }, "basis": "unknown" }),
            json!({ "amount": { "state": "value", "value": "-1" }, "basis": "unknown" }),
            json!({ "amount": { "state": "none" }, "basis": "unknown" }),
            json!({ "amount": { "state": "unknown" }, "basis": "unknown", "extra": 1 }),
        ] {
            assert!(check_parameters("profit_target", &bad).is_err(), "{bad}");
        }
        let share = |v: &str| json!({ "maxBestDayShare": { "state": "value", "value": v }, "denominator": "unknown", "appliesTo": "unknown" });
        assert!(check_parameters("consistency", &share("0.5")).is_ok());
        assert!(check_parameters("consistency", &share("1.5")).is_err());
        assert!(check_parameters("consistency", &share("0")).is_err());
        for valid in ["1", "0.9999999999999999999999999999", "0.0000000000000000000000000001"] {
            assert!(check_parameters("consistency", &share(valid)).is_ok(), "{valid}");
        }
        assert!(check_parameters("consistency", &share("1.0000000000000000000000000001")).is_err());
    }

    #[test]
    fn legacy_rules_convert_without_guessing() {
        let (t, p, s) = convert_legacy_rule("consistency", "calculated", "known", r#"{"max_best_day_share_bps":3000}"#);
        assert_eq!((t.as_str(), s.as_str()), ("consistency", "supported"));
        assert_eq!(p["maxBestDayShare"]["value"], "0.3");
        let (t, p, s) = convert_legacy_rule("max_drawdown", "calculated", "unknown", "{}");
        assert_eq!((t.as_str(), s.as_str(), &p["method"]), ("max_drawdown", "needs_setup", &json!("unknown")));
        let (t, _, s) = convert_legacy_rule("profit_target", "calculated", "known", r#"{"amount_micros":"x"}"#);
        assert_eq!((t.as_str(), s.as_str()), ("unknown", "unsupported"));
        let (t, _, s) = convert_legacy_rule("profit_target", "manual_confirmation", "known", r#"{"amount_micros":1}"#);
        assert_eq!((t.as_str(), s.as_str()), ("manual_check", "manual_only"));
        assert_eq!(legacy_rule_key("max_position_size", "firm", 5), "max_position_size:firm:5");
        assert_eq!(legacy_rule_key("daily_loss_limit", "personal", 1), "daily_loss_limit:personal");
    }
}
