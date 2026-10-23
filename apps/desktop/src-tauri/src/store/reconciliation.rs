//! Exact bookkeeping reconciliation, not a risk engine. Frozen inputs make old
//! comparisons replayable after current trades, ledger or account settings change.
use super::{
    account_ctx,
    evidence::{self, Observation, decode, encode, exact_money},
    ledger::{self, LedgerEntry, LedgerRevision},
    require_account,
    trades::{self, Trade},
};
use crate::{
    domain::{format_instant, micros_to_string, new_id, now, parse_payload_time},
    error::{AppError, AppResult},
};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Coverage {
    pub baseline: String,
    pub closed_trades: String,
    pub fees: String,
    pub ledger: String,
    pub open_positions: String,
    pub eod_history: String,
    pub intraday_history: String,
    pub source_reference: String,
}
impl Coverage {
    pub(super) fn validate(&self) -> AppResult<()> {
        for v in [
            &self.baseline,
            &self.closed_trades,
            &self.fees,
            &self.ledger,
            &self.open_positions,
            &self.eod_history,
            &self.intraday_history,
        ] {
            if ![
                "available",
                "missing",
                "incomplete",
                "stale",
                "conflicting",
                "unsupported",
                "manual_verification",
            ]
            .contains(&v.as_str())
            {
                return Err(AppError::invalid("coverage", "unsupported evidence state"));
            }
        }
        if self.source_reference.trim().is_empty() || self.source_reference.chars().count() > 2000 {
            return Err(AppError::invalid(
                "coverage.sourceReference",
                "required, at most 2000 characters",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconciliationRequest {
    pub account_id: String,
    pub observation_id: String,
    pub baseline_observation_id: String,
    pub as_of: String,
    pub evaluated_at: String,
    pub coverage: Coverage,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Comparison {
    pub reconciliation_status: String,
    pub difference: Option<String>,
    pub derived_balance: Option<String>,
    pub as_of: String,
    pub freshness: String,
    pub reason_code: String,
    pub next_verification_action: String,
    pub source_summary: String,
    pub missing_inputs: Vec<String>,
    pub source_references: Vec<String>,
}
impl Comparison {
    fn fail(mut self, status: &str, reason: &str) -> Self {
        self.difference = None;
        self.derived_balance = None;
        self.reconciliation_status = status.into();
        self.reason_code = reason.into();
        self
    }
}
fn timestamp(s: &str) -> AppResult<chrono::DateTime<chrono::Utc>> {
    parse_payload_time(s).map_err(|e| AppError::invalid("time", e))
}
/// Pure: all time, records and correction identity are explicit arguments.
pub fn compare(
    request: &ReconciliationRequest,
    observation: &Observation,
    baseline: &Observation,
    trades: &[Trade],
    ledger: &[LedgerEntry],
    superseded: &[String],
    observations: &[Observation],
) -> AppResult<Comparison> {
    request.coverage.validate()?;
    let mut out=Comparison { reconciliation_status:"incomplete".into(), difference:None, derived_balance:None, as_of:request.as_of.clone(),
        freshness:"unknown".into(),reason_code:"missing_inputs".into(),next_verification_action:"Verify source and complete interval history".into(),
        source_summary:"User-reported evidence compared with journal bookkeeping; no official compliance determination".into(),missing_inputs:vec![],
        source_references:vec![baseline.id.clone(),observation.id.clone(),baseline.input.source_reference.clone(),observation.input.source_reference.clone(),request.coverage.source_reference.clone()] };
    if observation.id != request.observation_id
        || baseline.id != request.baseline_observation_id
        || [&observation.input.account_id, &baseline.input.account_id]
            .into_iter()
            .any(|a| a != &request.account_id)
        || trades.iter().any(|t| t.account_id != request.account_id)
        || ledger.iter().any(|e| e.account_id != request.account_id)
    {
        return Ok(out.fail("unsupported", "account_or_identity_mismatch"));
    }
    if observation.input.currency != baseline.input.currency {
        return Ok(out.fail("unsupported", "currency_mismatch"));
    }
    if observation.input.basis != "balance"
        || baseline.input.basis != "balance"
        || baseline.input.kind != "opening_balance"
        || !["balance", "eod_settlement"].contains(&observation.input.kind.as_str())
    {
        return Ok(out.fail("unsupported", "unsupported_basis"));
    }
    if superseded.contains(&baseline.id) || superseded.contains(&observation.id) {
        return Ok(out.fail("conflicting", "superseded_source"));
    }
    for target in [baseline, observation] {
        for o in observations {
            if o.input.account_id == request.account_id
                && o.input.currency == target.input.currency
                && o.input.basis == target.input.basis
                && o.input.kind == target.input.kind
                && !superseded.contains(&o.id)
                && timestamp(&o.input.observed_at)? == timestamp(&target.input.observed_at)?
                && o.input.value != target.input.value
            {
                return Ok(out.fail("conflicting", "conflicting_source_records"));
            }
        }
    }
    let at = timestamp(&request.as_of)?;
    let start = timestamp(&baseline.input.observed_at)?;
    let evaluated = timestamp(&request.evaluated_at)?;
    if timestamp(&observation.input.observed_at)? != at || start > at || evaluated < at {
        return Ok(out.fail("unsupported", "noncomparable_time"));
    }
    if let Some(until) = &observation.input.valid_until {
        if timestamp(until)? < evaluated {
            out.freshness = "stale".into();
            return Ok(out.fail("stale", "expired_observation"));
        }
        out.freshness = "current".into();
    } else {
        out.missing_inputs.push("freshness_policy".into());
    }
    for (key, state) in [
        ("baseline", &request.coverage.baseline),
        ("closedTrades", &request.coverage.closed_trades),
        ("fees", &request.coverage.fees),
        ("ledger", &request.coverage.ledger),
    ] {
        if state == "conflicting" {
            return Ok(out.fail("conflicting", &format!("{key}_conflicting")));
        }
        if state == "stale" {
            return Ok(out.fail("stale", &format!("{key}_stale")));
        }
        if state != "available" {
            out.missing_inputs.push(key.into());
        }
    }
    if baseline.input.confirmation != "user_confirmed"
        || observation.input.confirmation != "user_confirmed"
    {
        out.missing_inputs.push("user_confirmation".into());
    }
    if baseline.input.confidence != "user_reported"
        || observation.input.confidence != "user_reported"
    {
        out.missing_inputs.push("confidence".into());
    }
    if baseline.input.value.is_none() || observation.input.value.is_none() {
        out.missing_inputs.push("observation_value".into());
    }
    let mut total = i128::from(
        baseline
            .input
            .value
            .as_deref()
            .map(exact_money)
            .transpose()?
            .unwrap_or(0),
    );
    for t in trades {
        let end = t.exit_at.as_deref().map(timestamp).transpose()?;
        if end.is_some_and(|end| end > start && end <= at) {
            out.source_references.push(t.id.clone());
            if let Some(batch) = &t.import_batch_id {
                out.source_references.push(batch.clone());
            }
            if let Some(pnl) = &t.realized_pnl {
                total += i128::from(exact_money(pnl)?);
            } else {
                out.missing_inputs.push(format!("pnl:{}", t.id));
            }
        }
        if timestamp(&t.entry_at)? <= start && end.is_none_or(|end| end > start) {
            out.missing_inputs
                .push(format!("baseline_position:{}", t.id));
        }
    }
    for e in ledger {
        let time = timestamp(&e.effective_at)?;
        if time > start && time <= at {
            out.source_references.push(e.id.clone());
            if e.affects_balance {
                total += i128::from(exact_money(&e.amount)?);
            }
        }
    }
    if !out.missing_inputs.is_empty() {
        return Ok(out);
    }
    let difference = i128::from(exact_money(
        observation
            .input
            .value
            .as_deref()
            .expect("checked available"),
    )?) - total;
    let (Ok(balance), Ok(delta)) = (i64::try_from(total), i64::try_from(difference)) else {
        return Ok(out.fail("unsupported", "arithmetic_overflow"));
    };
    out.derived_balance = Some(micros_to_string(balance));
    out.difference = Some(micros_to_string(delta));
    if delta == 0 {
        out.reconciliation_status = "matched".into();
        out.reason_code = "exact_match".into();
        out.next_verification_action =
            "Retain evidence; review rule-specific requirements separately".into();
    } else {
        out.reconciliation_status = "mismatched".into();
        out.reason_code = "variance_requires_review".into();
        out.next_verification_action =
            "Review missing trades, fees and movements; do not auto-balance".into();
    }
    Ok(out)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reconciliation {
    pub id: String,
    pub account_id: String,
    pub recorded_at: String,
    pub request: ReconciliationRequest,
    pub observation: Observation,
    pub baseline: Observation,
    pub trades: Vec<Trade>,
    pub ledger: Vec<LedgerEntry>,
    pub ledger_history: Vec<LedgerRevision>,
    pub result: Comparison,
    pub superseded_ids: Vec<String>,
    pub observations: Vec<Observation>,
}
pub fn create(
    conn: &mut Connection,
    mut request: ReconciliationRequest,
) -> AppResult<Reconciliation> {
    let tx = conn.transaction()?;
    let ctx = account_ctx(&tx, &request.account_id)?;
    request.as_of = format_instant(timestamp(&request.as_of)?);
    request.evaluated_at = format_instant(timestamp(&request.evaluated_at)?);
    let observation = evidence::get(&tx, &request.observation_id)?;
    let baseline = evidence::get(&tx, &request.baseline_observation_id)?;
    // Refuse cross-attempt reads through a write operation; pure compare also defends its own boundary.
    if observation.input.account_id != request.account_id
        || baseline.input.account_id != request.account_id
    {
        return Err(AppError::invalid(
            "accountId",
            "observations must belong to this attempt",
        ));
    }
    let trades = trades::list(&tx, &request.account_id)?;
    let ledger = ledger::list(&tx, &request.account_id)?;
    let ledger_history = ledger::history(&tx, &request.account_id)?;
    let observations = evidence::list(&tx, &request.account_id)?;
    let superseded = observations
        .clone()
        .into_iter()
        .filter_map(|o| o.supersedes_id)
        .collect::<Vec<_>>();
    let result =
        if observation.input.currency != ctx.currency || baseline.input.currency != ctx.currency {
            compare(
                &request,
                &observation,
                &baseline,
                &trades,
                &ledger,
                &superseded,
                &observations,
            )?
            .fail("unsupported", "currency_mismatch")
        } else {
            compare(
                &request,
                &observation,
                &baseline,
                &trades,
                &ledger,
                &superseded,
                &observations,
            )?
        };
    let out = Reconciliation {
        id: new_id(),
        account_id: request.account_id.clone(),
        recorded_at: now(),
        request,
        observation,
        baseline,
        trades,
        ledger,
        ledger_history,
        result,
        superseded_ids: superseded,
        observations,
    };
    tx.execute("INSERT INTO financial_reconciliations(id,account_id,payload_json,recorded_at) VALUES(?1,?2,?3,?4)",params![out.id,out.account_id,encode(&out)?,out.recorded_at])?;
    tx.commit()?;
    Ok(out)
}
pub fn list(conn: &Connection, account_id: &str) -> AppResult<Vec<Reconciliation>> {
    require_account(conn, account_id)?;
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM financial_reconciliations WHERE account_id=?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map([account_id], |r| r.get::<_, String>(0))?;
    rows.map(|s| decode(&s?)).collect()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolutionInput {
    pub actor: String,
    pub reason: String,
    pub status: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resolution {
    #[serde(flatten)]
    pub input: ResolutionInput,
    pub id: String,
    pub reconciliation_id: String,
    pub recorded_at: String,
}
pub fn resolve(conn: &mut Connection, id: &str, input: ResolutionInput) -> AppResult<Resolution> {
    evidence::CorrectionMetadata {
        actor: input.actor.clone(),
        reason: input.reason.clone(),
    }
    .validate()?;
    if !["reviewed", "dismissed", "unresolved"].contains(&input.status.as_str()) {
        return Err(AppError::invalid("status", "unsupported resolution"));
    }
    let tx = conn.transaction()?;
    let account: String = tx.query_row(
        "SELECT account_id FROM financial_reconciliations WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    account_ctx(&tx, &account)?;
    let out = Resolution {
        input,
        id: new_id(),
        reconciliation_id: id.into(),
        recorded_at: now(),
    };
    tx.execute("INSERT INTO reconciliation_resolutions(id,reconciliation_id,payload_json,recorded_at) VALUES(?1,?2,?3,?4)",params![out.id,id,encode(&out)?,out.recorded_at])?;
    tx.commit()?;
    Ok(out)
}
pub fn resolutions(conn: &Connection, id: &str) -> AppResult<Vec<Resolution>> {
    let mut stmt=conn.prepare("SELECT payload_json FROM reconciliation_resolutions WHERE reconciliation_id=?1 ORDER BY rowid")?;
    let rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
    rows.map(|s| decode(&s?)).collect()
}
