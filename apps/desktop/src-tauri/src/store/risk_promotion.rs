//! P0-02: atomic promotion of a current risk result.
//!
//! The portable TypeScript engine evaluates; SQLite stays authoritative. Three things are kept apart:
//! * a stored calculation (`account_snapshots`): immutable history, whatever it was computed from;
//! * "sources unchanged for its cutoff": the sources re-read now, for the calculation's own `asOf` and coverage,
//!   are exactly what it froze (inputs, reconciliation revisions, prior-breach history);
//! * the account's current result: the newest `risk_promotions` row. A calculation is promoted only if its sources
//!   are unchanged at commit, inside the same `BEGIN IMMEDIATE` transaction that writes it, so no write (through
//!   this or any other connection) can land between the comparison and the commit. It stays eligible only while its
//!   sources stay unchanged; every read re-checks.
//!
//! The comparison is content-based: [`capture_in`] is the single definition of what a calculation depends on, and
//! both the capture handed to the engine and every later check run it inside one read transaction. Any writer that
//! changes those records (now or added later) therefore invalidates without its own bookkeeping, shared rulebook
//! versions invalidate every account that uses them, and unrelated accounts or non-risk records are untouched.
//! See docs/architecture/p0-02-risk-promotion.md.

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::evidence::{RiskInputsQuery, risk_inputs_in};
use super::frozen_v1;
use super::reconciliation;
use super::snapshots::{self, Snapshot, SnapshotInput, canonical_engine_json};
use super::{account_ctx, require_account};
use crate::domain::{now, parse_payload_time};
use crate::error::{AppError, AppResult};

/// Everything a risk calculation for one account, cutoff and coverage statement depends on, read from one
/// database state.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskCapture {
    /// Canonical inputs (`get_account_risk_inputs`), with unresolved reconciliation reviews as missing inputs.
    pub inputs: Value,
    /// Every reconciliation review and resolution of the account, sorted.
    pub reconciliation_revision_ids: Vec<String>,
    /// Continuing breaches from the account's stored engine calculations.
    pub prior_breaches: Vec<Value>,
    /// sha256 of the canonical inputs, revisions and prior breaches.
    pub source_fingerprint: String,
}

/// The account's newest promoted calculation and whether its sources are unchanged now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentRisk {
    pub snapshot: Option<Snapshot>,
    pub promoted_at: Option<String>,
    /// None when nothing is promoted.
    pub sources_unchanged: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFreshness {
    pub snapshot_id: String,
    /// None for a calculation that froze no engine sources (written before the Build 16 engine).
    pub sources_unchanged: Option<bool>,
}

fn sha256(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn utf16_sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    ids.dedup();
    ids
}

fn fingerprint(inputs: &Value, revisions: &Value, breaches: &Value) -> String {
    sha256(&canonical_engine_json(&json!({
        "inputs": inputs,
        "priorBreaches": breaches,
        "reconciliationRevisionIds": revisions,
    })))
}

fn is_engine(engine_version: &str, explanation: &Value) -> bool {
    engine_version.starts_with("fundedflow-risk/")
        && explanation["engine"].is_object()
        && explanation["policy"].is_object()
}

/// Continuing breaches recorded by the account's engine calculations, newest first, one per assignment and rule
/// (the same rule as the desktop's former `priorBreachesFrom`). `exclude` leaves one calculation out, so checking
/// a calculation never counts the breaches it recorded itself.
fn prior_breaches(
    conn: &Connection,
    account_id: &str,
    exclude: Option<&str>,
) -> AppResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, engine_version, explanation_json FROM account_snapshots WHERE account_id = ?1
         ORDER BY trading_day DESC, calculated_at DESC, id",
    )?;
    let rows = stmt.query_map([account_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut decoder = frozen_v1::Decoder::new(conn);
    for row in rows {
        let (id, engine_version, explanation) = row?;
        if exclude == Some(id.as_str()) {
            continue;
        }
        let Ok(stored) = serde_json::from_str::<Value>(&explanation) else {
            continue;
        };
        // TASK-045: a compact row is read as stored (its engine result is small); a rule's references are
        // rebuilt only for a breach this loop may emit, so a capture never rebuilds every calculation's lists.
        let compact = frozen_v1::is_compact(&stored);
        let e = match (compact, stored.get("inline")) {
            (true, Some(inline)) => inline,
            (true, None) => &stored["explanation"],
            (false, _) => &stored,
        };
        if !is_engine(&engine_version, e) {
            continue;
        }
        let r = &e["engine"];
        let (Some(version), Some(assignment), Some(as_of)) = (
            r["rulebookVersionId"].as_str(),
            r["assignmentId"].as_str(),
            r["asOf"].as_str(),
        ) else {
            continue;
        };
        if r["accountId"].as_str() != Some(account_id) {
            continue;
        }
        for (index, rule) in r["rules"].as_array().into_iter().flatten().enumerate() {
            let Some(key) = rule["ruleKey"].as_str() else {
                continue;
            };
            let slot = format!("{assignment}|{key}");
            if rule["state"].as_str() != Some("breached") || seen.contains(&slot) {
                continue;
            }
            // Settled exactly before the slot is claimed: a breach with no references never claims it.
            let refs = if compact && rule.get("sourceReferences").is_none() {
                decoder.rule_refs(account_id, &stored, index)?
            } else {
                rule["sourceReferences"].clone()
            };
            let refs = refs.as_array().cloned().unwrap_or_default();
            if refs.is_empty() || !seen.insert(slot) {
                continue;
            }
            out.push(json!({ "accountId": account_id, "rulebookVersionId": version, "assignmentId": assignment,
                "ruleKey": key, "observedAt": as_of, "sourceReferences": refs }));
        }
    }
    Ok(out)
}

/// Test only: a callback run at a fixed point inside capture or promotion.
#[cfg(test)]
pub(crate) type Hook = std::cell::RefCell<Option<Box<dyn FnMut()>>>;

#[cfg(test)]
thread_local! {
    /// Test only: runs between the capture's reads, to prove they share one database state.
    pub(crate) static MID_CAPTURE: Hook = std::cell::RefCell::new(None);
    /// Test only: runs inside promotion after the sources compared equal, before the write commits.
    pub(crate) static BEFORE_PROMOTION_COMMIT: Hook = std::cell::RefCell::new(None);
}

#[cfg(test)]
fn hook(cell: &'static std::thread::LocalKey<Hook>) {
    cell.with(|h| {
        if let Some(f) = h.borrow_mut().as_mut() {
            f();
        }
    });
}

/// Reads every source of one calculation. Call inside a transaction: its first read fixes the database state the
/// rest see (WAL snapshot isolation), so a write committed meanwhile by another connection is wholly absent.
pub(crate) fn capture_in(
    conn: &Connection,
    query: RiskInputsQuery,
    exclude: Option<&str>,
) -> AppResult<RiskCapture> {
    let account_id = query.account_id.clone();
    let as_of = parse_payload_time(&query.as_of).map_err(|e| AppError::invalid("asOf", e))?;
    let mut inputs = risk_inputs_in(conn, query)?;
    #[cfg(test)]
    hook(&MID_CAPTURE);
    let reviews = reconciliation::list(conn, &account_id)?;
    let mut revisions = Vec::new();
    for r in &reviews {
        revisions.push(r.id.clone());
        revisions.extend(
            reconciliation::resolutions(conn, &r.id)?
                .into_iter()
                .map(|x| x.id),
        );
    }
    // The latest review of each current (not superseded) checkpoint up to the cutoff; one that didn't match makes
    // the calculation miss an input, as the desktop loader did before P0-02.
    let superseded: std::collections::HashSet<String> = inputs["observations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|o| o["supersedesId"].as_str().map(str::to_string))
        .collect();
    let mut order: Vec<String> = Vec::new();
    let mut latest: std::collections::HashMap<String, &reconciliation::Reconciliation> =
        std::collections::HashMap::new();
    for r in &reviews {
        let at = parse_payload_time(&r.request.as_of).map_err(|e| AppError::invalid("asOf", e))?;
        if r.account_id != account_id || superseded.contains(&r.observation.id) || at > as_of {
            continue;
        }
        if latest.insert(r.observation.id.clone(), r).is_none() {
            order.push(r.observation.id.clone());
        }
    }
    let missing = inputs["missingInputs"]
        .as_array_mut()
        .ok_or_else(|| AppError::invalid("inputs", "missing inputs list"))?;
    for observation in &order {
        let r = latest[observation];
        if r.result.reconciliation_status != "matched" {
            missing.push(json!(format!(
                "reconciliation_review:{}:{}",
                r.id, r.result.reconciliation_status
            )));
        }
    }
    let revisions = utf16_sorted(revisions);
    let breaches = prior_breaches(conn, &account_id, exclude)?;
    let source_fingerprint = fingerprint(&inputs, &json!(revisions), &json!(breaches));
    Ok(RiskCapture {
        inputs,
        reconciliation_revision_ids: revisions,
        prior_breaches: breaches,
        source_fingerprint,
    })
}

/// Coherent capture for one calculation (read only).
pub fn capture(conn: &mut Connection, query: RiskInputsQuery) -> AppResult<RiskCapture> {
    let tx = conn.transaction()?;
    let out = capture_in(&tx, query, None)?;
    tx.commit()?;
    Ok(out)
}

/// What a stored engine calculation froze: the query to re-read it, and the fingerprint of what it used.
fn frozen(engine_version: &str, explanation: &Value) -> Option<(RiskInputsQuery, String, String)> {
    if !is_engine(engine_version, explanation) {
        return None;
    }
    let inputs = &explanation["inputs"];
    let policy = &explanation["policy"];
    let query = RiskInputsQuery {
        account_id: inputs["account"]["id"].as_str()?.to_string(),
        as_of: inputs["asOf"].as_str()?.to_string(),
        coverage: serde_json::from_value(inputs["coverage"].clone()).ok()?,
    };
    let print = fingerprint(
        inputs,
        &policy["reconciliationRevisionIds"],
        &policy["priorBreaches"],
    );
    Some((query, print, inputs["asOf"].as_str()?.to_string()))
}

/// Whether a stored calculation's sources are unchanged now, read in the caller's transaction.
fn sources_unchanged_in(conn: &Connection, snapshot: &Snapshot) -> AppResult<Option<bool>> {
    let Some((query, print, _)) = frozen(&snapshot.engine_version, &snapshot.explanation) else {
        return Ok(None);
    };
    if query.account_id != snapshot.account_id {
        return Ok(Some(false));
    }
    // A frozen statement that no longer validates (or an account that can't be read) can't be confirmed.
    match capture_in(conn, query, Some(&snapshot.id)) {
        Ok(now) => Ok(Some(now.source_fingerprint == print)),
        Err(AppError::Validation { .. }) => Ok(Some(false)),
        Err(e) => Err(e),
    }
}

/// The account's newest promotion, read in the caller's transaction.
fn current_in(conn: &Connection, account_id: &str) -> AppResult<CurrentRisk> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT snapshot_id, promoted_at FROM risk_promotions WHERE account_id = ?1 ORDER BY seq DESC LIMIT 1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((id, promoted_at)) = row else {
        return Ok(CurrentRisk {
            snapshot: None,
            promoted_at: None,
            sources_unchanged: None,
        });
    };
    let snapshot = snapshots::get(conn, &id)?;
    let unchanged = sources_unchanged_in(conn, &snapshot)?;
    Ok(CurrentRisk {
        snapshot: Some(snapshot),
        promoted_at: Some(promoted_at),
        sources_unchanged: unchanged,
    })
}

/// The account's current result and its eligibility, from one database state. Readable for archived accounts.
pub fn current(conn: &mut Connection, account_id: &str) -> AppResult<CurrentRisk> {
    let tx = conn.transaction()?;
    require_account(&tx, account_id)?;
    let out = current_in(&tx, account_id)?;
    tx.commit()?;
    Ok(out)
}

/// Whether one stored calculation's sources are unchanged for its own cutoff.
pub fn freshness(conn: &mut Connection, snapshot_id: &str) -> AppResult<SnapshotFreshness> {
    let tx = conn.transaction()?;
    let snapshot = snapshots::get(&tx, snapshot_id)?;
    let unchanged = sources_unchanged_in(&tx, &snapshot)?;
    tx.commit()?;
    Ok(SnapshotFreshness {
        snapshot_id: snapshot.id,
        sources_unchanged: unchanged,
    })
}

/// Stores an engine calculation and makes it the account's current result, atomically, or writes nothing.
///
/// Inside one `BEGIN IMMEDIATE` transaction: the sources are re-read for the calculation's own cutoff and coverage
/// and must equal what it froze (inputs, reconciliation revisions and prior breaches; caller declarations such as
/// rule currency or boundary are the caller's statement and are only hashed). A current result whose sources are
/// still unchanged and whose cutoff is later is never displaced. Rejections are `Conflict` and commit nothing.
pub fn promote(conn: &mut Connection, input: SnapshotInput) -> AppResult<Snapshot> {
    if !input.engine_version.starts_with("fundedflow-risk/") {
        return Err(AppError::invalid(
            "engineVersion",
            "only an engine calculation can become the current result",
        ));
    }
    let prepared = snapshots::prepare(&input)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    account_ctx(&tx, &input.account_id)?;
    let (query, print, as_of) =
        frozen(&input.engine_version, &input.explanation).ok_or_else(|| {
            AppError::invalid(
                "explanation",
                "the calculation must freeze its inputs and policy",
            )
        })?;
    if query.account_id != input.account_id {
        return Err(AppError::invalid(
            "accountId",
            "the calculation's inputs belong to another account",
        ));
    }
    let now_sources = capture_in(&tx, query, None)?;
    if now_sources.source_fingerprint != print {
        return Err(AppError::Conflict {
            message:
                "the records this calculation used changed before it was saved; nothing was saved"
                    .into(),
        });
    }
    let current = current_in(&tx, &input.account_id)?;
    if let (Some(snapshot), Some(true)) = (&current.snapshot, current.sources_unchanged) {
        let current_as_of = snapshot.explanation["inputs"]["asOf"]
            .as_str()
            .map(parse_payload_time);
        let new_as_of = parse_payload_time(&as_of).map_err(|e| AppError::invalid("asOf", e))?;
        if matches!(current_as_of, Some(Ok(t)) if t > new_as_of) {
            return Err(AppError::Conflict {
                message: "a calculation with a later cutoff is current; nothing was saved".into(),
            });
        }
    }
    let saved = snapshots::insert_prepared(&tx, &input, prepared)?;
    tx.execute(
        "INSERT INTO risk_promotions (account_id, snapshot_id, source_fingerprint, promoted_at) VALUES (?1, ?2, ?3, ?4)",
        params![saved.account_id, saved.id, print, now()],
    )?;
    #[cfg(test)]
    hook(&BEFORE_PROMOTION_COMMIT);
    tx.commit()?;
    Ok(saved)
}
