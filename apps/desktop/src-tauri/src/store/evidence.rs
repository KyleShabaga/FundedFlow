//! Raw user-reported financial evidence. No rule calculations or broker verification.
use super::{account_ctx, require_account};
use crate::domain::{
    format_instant, micros_to_string, new_id, now, parse_decimal, parse_payload_time, to_micros,
    trading_day,
};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

fn json_error(e: serde_json::Error) -> AppError {
    AppError::Database {
        message: e.to_string(),
    }
}
pub(super) fn encode<T: Serialize>(v: &T) -> AppResult<String> {
    serde_json::to_string(v).map_err(json_error)
}
pub(super) fn decode<T: serde::de::DeserializeOwned>(v: &str) -> AppResult<T> {
    serde_json::from_str(v).map_err(json_error)
}
fn text(field: &str, s: &str, max: usize) -> AppResult<()> {
    if s.trim().is_empty() || s.chars().count() > max {
        return Err(AppError::invalid(
            field,
            "must be nonempty and within length limit",
        ));
    }
    Ok(())
}
pub(super) fn exact_money(s: &str) -> AppResult<i64> {
    let m = parse_decimal(s)
        .and_then(to_micros)
        .ok_or_else(|| AppError::invalid("value", "must fit i64 micro-units"))?;
    if micros_to_string(m) != s {
        return Err(AppError::invalid(
            "value",
            "must be canonical exact micro-unit decimal text",
        ));
    }
    Ok(m)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationInput {
    pub account_id: String,
    pub kind: String,
    pub value: Option<String>,
    pub currency: String,
    pub basis: String,
    pub observed_at: String,
    pub source_category: String,
    pub source_reference: String,
    pub confirmation: String,
    pub confidence: String,
    pub valid_until: Option<String>,
    pub actor: String,
    pub note: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    #[serde(flatten)]
    pub input: ObservationInput,
    pub id: String,
    pub recorded_at: String,
    pub effective_trading_day: String,
    pub timezone: String,
    pub trading_day_reset_time: String,
    pub supersedes_id: Option<String>,
    pub correction_reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationCorrection {
    pub replacement: ObservationInput,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorrectionMetadata {
    pub actor: String,
    pub reason: String,
}
impl CorrectionMetadata {
    pub fn validate(&self) -> AppResult<()> {
        text("actor", &self.actor, 200)?;
        text("reason", &self.reason, 2000)
    }
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Observation> {
    let s: String = conn
        .query_row(
            "SELECT payload_json FROM financial_observations WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("observation", id))?;
    decode(&s)
}
pub fn list(conn: &Connection, account_id: &str) -> AppResult<Vec<Observation>> {
    require_account(conn, account_id)?;
    let mut stmt = conn.prepare("SELECT payload_json FROM financial_observations WHERE account_id=?1 ORDER BY recorded_at, rowid")?;
    let rows = stmt.query_map([account_id], |r| r.get::<_, String>(0))?;
    rows.map(|s| decode(&s?)).collect()
}
fn insert(
    conn: &Connection,
    mut input: ObservationInput,
    supersedes: Option<&str>,
    reason: Option<&str>,
) -> AppResult<Observation> {
    let ctx = account_ctx(conn, &input.account_id)?;
    if ![
        "opening_balance",
        "balance",
        "equity",
        "intraday_peak",
        "eod_settlement",
    ]
    .contains(&input.kind.as_str())
    {
        return Err(AppError::invalid("kind", "unsupported observation"));
    }
    if !["balance", "equity"].contains(&input.basis.as_str())
        || (input.kind == "equity" && input.basis != "equity")
        || (["opening_balance", "balance"].contains(&input.kind.as_str())
            && input.basis != "balance")
    {
        return Err(AppError::invalid("basis", "kind and basis disagree"));
    }
    if input.currency != ctx.currency {
        return Err(AppError::invalid(
            "currency",
            "must match account currency; no implicit FX",
        ));
    }
    if !["firm_dashboard", "user_entered", "statement"].contains(&input.source_category.as_str()) {
        return Err(AppError::invalid("sourceCategory", "unsupported source"));
    }
    if !["unconfirmed", "user_confirmed"].contains(&input.confirmation.as_str())
        || !["unknown", "user_reported"].contains(&input.confidence.as_str())
    {
        return Err(AppError::invalid(
            "confirmation",
            "manual evidence is not independently verified",
        ));
    }
    text("sourceReference", &input.source_reference, 2000)?;
    text("actor", &input.actor, 200)?;
    if input
        .note
        .as_ref()
        .is_some_and(|n| n.chars().count() > 20000)
    {
        return Err(AppError::invalid("note", "too long"));
    }
    let observed =
        parse_payload_time(&input.observed_at).map_err(|e| AppError::invalid("observedAt", e))?;
    input.observed_at = format_instant(observed);
    if let Some(until) = &input.valid_until {
        let t = parse_payload_time(until).map_err(|e| AppError::invalid("validUntil", e))?;
        if t < observed {
            return Err(AppError::invalid(
                "validUntil",
                "must not precede observation",
            ));
        }
        input.valid_until = Some(format_instant(t));
    }
    let value = input.value.as_deref().map(exact_money).transpose()?;
    let observation = Observation {
        input,
        id: new_id(),
        recorded_at: now(),
        effective_trading_day: trading_day(observed, ctx.tz, ctx.reset).to_string(),
        timezone: ctx.tz.to_string(),
        trading_day_reset_time: ctx.reset.format("%H:%M").to_string(),
        supersedes_id: supersedes.map(str::to_string),
        correction_reason: reason.map(str::to_string),
    };
    conn.execute("INSERT INTO financial_observations(id,account_id,supersedes_id,value_micros,payload_json,recorded_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params![observation.id,observation.input.account_id,supersedes,value,encode(&observation)?,observation.recorded_at])?;
    Ok(observation)
}
pub fn create(conn: &mut Connection, input: ObservationInput) -> AppResult<Observation> {
    let tx = conn.transaction()?;
    let out = insert(&tx, input, None, None)?;
    tx.commit()?;
    Ok(out)
}
pub fn correct(
    conn: &mut Connection,
    id: &str,
    correction: ObservationCorrection,
) -> AppResult<Observation> {
    text("reason", &correction.reason, 2000)?;
    let tx = conn.transaction()?;
    let old = get(&tx, id)?;
    if old.input.account_id != correction.replacement.account_id {
        return Err(AppError::invalid(
            "accountId",
            "cannot move observation to another attempt",
        ));
    }
    let out = insert(
        &tx,
        correction.replacement,
        Some(id),
        Some(&correction.reason),
    )?;
    tx.commit()?;
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RiskInputsQuery {
    pub account_id: String,
    pub as_of: String,
    pub coverage: super::reconciliation::Coverage,
}
/// Current normalized records for an explicit cutoff. This is not time travel;
/// callers freeze this payload when computing historical results.
pub fn risk_inputs(
    conn: &mut Connection,
    mut query: RiskInputsQuery,
) -> AppResult<serde_json::Value> {
    let tx = conn.transaction()?;
    let account = super::accounts::get_any(&tx, &query.account_id)?;
    let at = parse_payload_time(&query.as_of).map_err(|e| AppError::invalid("asOf", e))?;
    let tz = crate::domain::parse_tz(&account.timezone)
        .ok_or_else(|| AppError::invalid("timezone", "invalid stored zone"))?;
    let reset = crate::domain::parse_reset_time(&account.trading_day_reset_time)
        .ok_or_else(|| AppError::invalid("tradingDayResetTime", "invalid stored reset"))?;
    query.coverage.validate()?;
    let day = trading_day(at, tz, reset).to_string();
    let assignments = super::rulebooks::list_assignments(&tx, &query.account_id)?;
    let active: Vec<_> = assignments
        .iter()
        .filter(|a| a.effective_from <= day && a.effective_to.as_ref().is_none_or(|end| end > &day))
        .collect();
    let applicable_assignment = if active.len() == 1 {
        Some(active[0])
    } else {
        None
    };
    let mut versions = Vec::new();
    for a in &assignments {
        if !versions
            .iter()
            .any(|v: &crate::rulebook::RulebookVersionDetail| v.version.id == a.rulebook_version_id)
        {
            versions.push(super::rulebooks::get_version(&tx, &a.rulebook_version_id)?);
        }
    }
    let observations = list(&tx, &query.account_id)?;
    if !observations.iter().any(|o| {
        o.input.kind == "opening_balance"
            && o.input.value.is_some()
            && o.input.currency == account.currency
            && o.input.confirmation == "user_confirmed"
            && o.input.confidence == "user_reported"
            && o.input.observed_at <= format_instant(at)
            && !observations
                .iter()
                .any(|r| r.supersedes_id.as_deref() == Some(&o.id))
    }) {
        query.coverage.baseline = "missing".into();
    }
    if !observations.iter().any(|o| {
        o.input.kind == "eod_settlement"
            && o.input.value.is_some()
            && o.input.confirmation == "user_confirmed"
            && o.input.confidence == "user_reported"
            && !observations
                .iter()
                .any(|r| r.supersedes_id.as_deref() == Some(&o.id))
            && o.input.currency == account.currency
            && o.input.observed_at <= format_instant(at)
    }) {
        query.coverage.eod_history = "missing".into();
    }
    // V1 has no execution/live-position feed or complete intraday equity history.
    query.coverage.open_positions = "unsupported".into();
    query.coverage.intraday_history = "unsupported".into();
    let mut missing = vec![];
    for (key, state) in [
        ("baseline", &query.coverage.baseline),
        ("closedTrades", &query.coverage.closed_trades),
        ("fees", &query.coverage.fees),
        ("ledger", &query.coverage.ledger),
        ("openPositions", &query.coverage.open_positions),
        ("eodHistory", &query.coverage.eod_history),
        ("intradayHistory", &query.coverage.intraday_history),
    ] {
        if state != "available" {
            missing.push(key);
        }
    }
    if applicable_assignment.is_none() {
        missing.push("rulebook_assignment");
    }
    let out = serde_json::json!({"schemaVersion":1,"account":account,"asOf":format_instant(at),"effectiveTradingDay":trading_day(at,tz,reset).to_string(),
        "observations":observations,"trades":super::trades::list(&tx,&query.account_id)?,"ledger":super::ledger::list(&tx,&query.account_id)?,
        "ledgerHistory":super::ledger::history(&tx,&query.account_id)?,"phaseHistory":super::catalogue::list_phase_events(&tx,&query.account_id)?,
        "catalogueLink":super::catalogue::get_link(&tx,&query.account_id)?,"assignments":assignments,"rulebookVersions":versions,
        "applicableAssignment":applicable_assignment,"applicableRulebook":null,"coverage":query.coverage,"missingInputs":missing});
    tx.commit()?;
    Ok(out)
}
