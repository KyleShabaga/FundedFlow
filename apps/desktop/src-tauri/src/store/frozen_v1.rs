//! `frozen-v1`: how an engine calculation's frozen sources are stored (TASK-045, D-ARCH / ISSUE-002c).
//!
//! A saved calculation keeps exactly what it was computed from (`risk_promotion.rs`), but storing a full copy
//! of the account's lists in every `explanation_json` made the journal grow with trades x calculations. This
//! module stores the same `explanation` without the repetition and rebuilds it, value for value, on read:
//!
//! * **Lists** (`inputs.<kind>` for [`KINDS`]): each distinct record version is stored once per account in
//!   `risk_frozen_records`; `risk_frozen_spans` says which versions (and how many copies) were in each list at
//!   each generation. A calculation names a generation; its list is every span open at that generation, each
//!   record repeated `multiplicity` times, sorted by canonical engine JSON (UTF-16 order), which is exactly the
//!   array the TypeScript mapper froze (`canonicalEngineJson`). Only calculations whose whole `inputs` are
//!   canonical are compacted.
//! * **Result references** (`engine.sourceReferences`): the engine's sorted set of source ids
//!   (`evaluate.ts` `references`), recomputed from the decoded inputs and policy.
//! * **Rule references** (`engine.rules[i].sourceReferences`): that set plus a few extra ids (the rule's claim
//!   ids), sorted, then an ordered tail (drawdown history ids as indexes into `inputs.observations`).
//! * **Carried breaches** (`policy.priorBreaches[i].sourceReferences`): a pointer to the calculation and rule
//!   the breach was carried from; the references are that rule's, canonically sorted.
//!
//! Every write is verified first: the encoded form must decode to the exact `serde_json::Value` it replaces.
//! Anything that does not is stored inline, so the codec never changes what is recorded.
//!
//! THIS FORMAT IS FROZEN. Migration 23 calls this module, and shipped migrations never change, so neither do
//! the encoder and decoder below (a golden test pins the bytes). A future format gets a new marker and module;
//! the decoder for `frozen-v1` stays.
//!
//! Stored form (keys of the top-level object; see docs/data-model.md#frozen-risk-sources):
//! `{"$ff":"frozen-v1","explanation":{..the explanation with the replaced values removed..},
//!   "generation":g,"lists":[kinds],"refs":true,"rules":[[i,[extra ids],[tail]]],"breaches":[[i,snapshotId,ruleId]]}`.
//! `generation`/`lists`, `refs`, `rules` and `breaches` are each present only when used. An explanation that
//! itself has a top-level `"$ff"` key is stored wrapped as `{"$ff":"frozen-v1","inline":..}` (and read back
//! unchanged), so it can never be mistaken for the compact form.

use std::cell::Cell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use super::snapshots::canonical_engine_json;
use crate::error::{AppError, AppResult};

/// The key that marks a stored explanation as encoded, and this format's value for it.
pub(crate) const MARKER_KEY: &str = "$ff";
pub(crate) const MARKER: &str = "frozen-v1";

/// The `inputs` lists stored as spans, in a fixed order.
pub(crate) const KINDS: [&str; 7] = [
    "assignments",
    "ledger",
    "ledgerHistory",
    "observations",
    "phaseHistory",
    "rulebookVersions",
    "trades",
];

thread_local! {
    /// Parts stored inline because their compact form did not round-trip, summed over this thread's writes
    /// (the growth harness and tests read it; it holds counts only).
    static FALLBACKS: Cell<u64> = const { Cell::new(0) };
}

/// Fallbacks counted on this thread so far.
#[cfg(test)]
pub(crate) fn fallback_total() -> u64 {
    FALLBACKS.with(Cell::get)
}

#[cfg(test)]
thread_local! {
    static COMPACT_WRITES: Cell<u64> = const { Cell::new(0) };
}

/// Calculations this thread stored in the compact form (tests).
#[cfg(test)]
pub(crate) fn compact_writes() -> u64 {
    COMPACT_WRITES.with(Cell::get)
}

fn corrupt(what: &str) -> AppError {
    AppError::Database {
        message: format!("a stored calculation cannot be decoded ({what})"),
    }
}

fn sha256(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Sorted set in UTF-16 order: JavaScript's `[...new Set(v)].sort()`.
fn sorted_set(mut v: Vec<String>) -> Vec<String> {
    v.sort_by(|a, b| utf16_cmp(a, b));
    v.dedup();
    v
}

fn is_engine(engine_version: &str, explanation: &Value) -> bool {
    engine_version.starts_with("fundedflow-risk/")
        && explanation["engine"].is_object()
        && explanation["policy"].is_object()
        && explanation["inputs"].is_object()
}

/// Whether a stored explanation is in this format (it has the marker at the top level).
pub(crate) fn is_compact(raw: &Value) -> bool {
    raw.get(MARKER_KEY).is_some()
}

/// The engine's result-level reference set, from frozen inputs and policy (`evaluate.ts` `references`).
/// None when a value the engine would read is missing or not text.
fn derived_set(inputs: &Value, policy: &Value) -> Option<Vec<String>> {
    let mut out = Vec::new();
    let text = |v: &Value| v.as_str().map(str::to_string);
    for id in policy["reconciliationRevisionIds"].as_array()? {
        out.push(text(id)?);
    }
    for o in inputs["observations"].as_array()? {
        out.push(text(&o["id"])?);
        out.push(text(&o["sourceReference"])?);
    }
    for t in inputs["trades"].as_array()? {
        out.push(text(&t["id"])?);
        match &t["importBatchId"] {
            Value::Null => {}
            Value::String(s) if s.is_empty() => {}
            Value::String(s) => out.push(s.clone()),
            _ => return None,
        }
    }
    for kind in ["ledger", "ledgerHistory", "phaseHistory"] {
        for e in inputs[kind].as_array()? {
            out.push(text(&e["id"])?);
        }
    }
    Some(sorted_set(out))
}

fn strings(v: &Value) -> Option<Vec<&str>> {
    v.as_array()?.iter().map(Value::as_str).collect()
}

/// A rule's references as `[extra ids, tail]`: the longest strictly increasing prefix must hold the whole
/// derived set; its other ids are the extras. The tail is kept in order, an observation id as its index in
/// `observations`, anything else as text.
fn encode_rule_refs(derived: &[String], refs: &Value, observations: &[Value]) -> Option<Value> {
    let refs = strings(refs)?;
    let mut k = 0;
    while k < refs.len() && (k == 0 || utf16_cmp(refs[k - 1], refs[k]).is_lt()) {
        k += 1;
    }
    let base: HashSet<&str> = refs[..k].iter().copied().collect();
    if !derived.iter().all(|d| base.contains(d.as_str())) {
        return None;
    }
    let derived: HashSet<&str> = derived.iter().map(String::as_str).collect();
    let extras: Vec<&str> = refs[..k]
        .iter()
        .copied()
        .filter(|r| !derived.contains(r))
        .collect();
    let index: HashMap<&str, usize> = observations
        .iter()
        .enumerate()
        .filter_map(|(i, o)| o["id"].as_str().map(|id| (id, i)))
        .collect();
    let tail: Vec<Value> = refs[k..]
        .iter()
        .map(|r| index.get(r).map_or_else(|| json!(r), |i| json!(i)))
        .collect();
    Some(json!([extras, tail]))
}

fn decode_rule_refs(
    derived: &[String],
    extras: &Value,
    tail: &Value,
    observations: &[Value],
) -> Option<Value> {
    let mut base: Vec<String> = derived.to_vec();
    base.extend(strings(extras)?.into_iter().map(str::to_string));
    let mut out: Vec<Value> = sorted_set(base).into_iter().map(Value::String).collect();
    for t in tail.as_array()? {
        out.push(match t {
            Value::Number(n) => observations
                .get(usize::try_from(n.as_u64()?).ok()?)?
                .get("id")?
                .clone(),
            Value::String(_) => t.clone(),
            _ => return None,
        });
    }
    Some(Value::Array(out))
}

/// An array of text in canonical engine order (as `canonicalEngineJson` freezes the policy).
fn canonical_array(v: &Value) -> Option<Value> {
    serde_json::from_str(&canonical_engine_json(v)).ok()
}

/// How many rebuilt lists a decoder keeps (the most recently used).
pub(crate) const LIST_CACHE: usize = 16;

/// Parsed record versions of one (account, kind), by hash: the stored text as UTF-16 code units (the sort key)
/// and the value.
type Records = HashMap<String, (Rc<[u16]>, Rc<Value>)>;
type ListKey = (String, String, i64);
type List = Rc<Vec<Rc<Value>>>;

/// Rebuilds stored explanations. Each record version is parsed once per decoder, and the most recently used
/// lists are kept, keyed by the generation at which that kind's list last changed (so a list that stayed the
/// same across generations is shared).
pub(crate) struct Decoder<'c> {
    conn: &'c Connection,
    records: HashMap<(String, String), Records>,
    lists: Vec<(ListKey, List)>,
}

impl<'c> Decoder<'c> {
    pub(crate) fn new(conn: &'c Connection) -> Self {
        Self {
            conn,
            records: HashMap::new(),
            lists: Vec::new(),
        }
    }

    /// Lists this decoder currently keeps (tests).
    #[cfg(test)]
    pub(crate) fn cached_lists(&self) -> usize {
        self.lists.len()
    }

    /// The explanation a stored value encodes (an inline explanation is returned as it is).
    pub(crate) fn decode(&mut self, account_id: &str, raw: Value) -> AppResult<Value> {
        self.decode_with(account_id, raw, true)
    }

    fn list(&mut self, account_id: &str, kind: &str, generation: i64) -> AppResult<List> {
        // The list at `generation` is the list at the last generation (at or below it) where a span of this kind
        // opened or closed.
        let changed: i64 = self.conn.prepare_cached(
            "SELECT max(coalesce(max(CASE WHEN from_generation <= ?3 THEN from_generation END), 0),
                        coalesce(max(CASE WHEN to_generation <= ?3 THEN to_generation END), 0))
             FROM risk_frozen_spans WHERE account_id = ?1 AND kind = ?2",
        )?
        .query_row(params![account_id, kind, generation], |r| r.get(0))?;
        let key = (account_id.to_string(), kind.to_string(), changed);
        if let Some(i) = self.lists.iter().position(|(k, _)| *k == key) {
            let hit = self.lists.remove(i);
            let list = Rc::clone(&hit.1);
            self.lists.push(hit);
            return Ok(list);
        }
        #[cfg(test)]
        LIST_BUILDS.with(|b| *b.borrow_mut().entry(kind.to_string()).or_default() += 1);
        let members: Vec<(String, i64)> = self
            .conn
            .prepare_cached(
                "SELECT record_hash, multiplicity FROM risk_frozen_spans
                 WHERE account_id = ?1 AND kind = ?2 AND from_generation <= ?3
                   AND (to_generation IS NULL OR to_generation > ?3)",
            )?
            .query_map(params![account_id, kind, generation], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut entries: Vec<(Rc<[u16]>, Rc<Value>)> = Vec::with_capacity(members.len());
        let records = self
            .records
            .entry((account_id.to_string(), kind.to_string()))
            .or_default();
        for (hash, copies) in members {
            if !records.contains_key(&hash) {
                let text: String = self
                    .conn
                    .prepare_cached(
                        "SELECT record_json FROM risk_frozen_records
                         WHERE account_id = ?1 AND kind = ?2 AND record_hash = ?3",
                    )?
                    .query_row(params![account_id, kind, hash], |r| r.get(0))
                    .optional()?
                    .ok_or_else(|| corrupt("record"))?;
                let value: Value = serde_json::from_str(&text).map_err(|_| corrupt("record"))?;
                let units: Vec<u16> = text.encode_utf16().collect();
                records.insert(hash.clone(), (Rc::from(units), Rc::new(value)));
            }
            let entry = &records[&hash];
            for _ in 0..copies {
                entries.push(entry.clone());
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let list: List = Rc::new(entries.into_iter().map(|(_, v)| v).collect());
        if self.lists.len() >= LIST_CACHE {
            self.lists.remove(0);
        }
        self.lists.push((key, Rc::clone(&list)));
        Ok(list)
    }

    fn decode_with(&mut self, account_id: &str, raw: Value, resolve: bool) -> AppResult<Value> {
        let Value::Object(mut raw) = raw else {
            return Ok(raw);
        };
        match raw.get(MARKER_KEY) {
            None => return Ok(Value::Object(raw)),
            Some(Value::String(m)) if m == MARKER => {}
            Some(_) => return Err(corrupt("unknown format")),
        }
        if let Some(inline) = raw.remove("inline") {
            return Ok(inline);
        }
        let mut ex = raw
            .remove("explanation")
            .ok_or_else(|| corrupt("explanation"))?;
        if let Some(lists) = raw.get("lists") {
            let generation = raw
                .get("generation")
                .and_then(Value::as_i64)
                .ok_or_else(|| corrupt("generation"))?;
            let inputs = ex
                .get_mut("inputs")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| corrupt("inputs"))?;
            for kind in lists.as_array().ok_or_else(|| corrupt("lists"))? {
                let kind = kind
                    .as_str()
                    .filter(|k| KINDS.contains(k))
                    .ok_or_else(|| corrupt("list kind"))?;
                let list = self.list(account_id, kind, generation)?;
                inputs.insert(
                    kind.to_string(),
                    Value::Array(list.iter().map(|v| Value::clone(v)).collect()),
                );
            }
        }
        let needs_set = raw.contains_key("refs") || raw.contains_key("rules");
        if needs_set {
            let derived =
                derived_set(&ex["inputs"], &ex["policy"]).ok_or_else(|| corrupt("references"))?;
            let observations = ex["inputs"]["observations"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            if raw.get("refs") == Some(&Value::Bool(true)) {
                ex["engine"]["sourceReferences"] = json!(derived);
            }
            for rule in raw
                .get("rules")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (Some(i), Some(extras), Some(tail)) = (
                    rule[0].as_u64().and_then(|i| usize::try_from(i).ok()),
                    rule.get(1),
                    rule.get(2),
                ) else {
                    return Err(corrupt("rule references"));
                };
                let refs = decode_rule_refs(&derived, extras, tail, &observations)
                    .ok_or_else(|| corrupt("rule references"))?;
                let target = ex["engine"]["rules"]
                    .get_mut(i)
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| corrupt("rule"))?;
                target.insert("sourceReferences".into(), refs);
            }
        }
        if resolve {
            for b in raw
                .get("breaches")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (Some(i), Some(snapshot), Some(rule)) = (
                    b[0].as_u64().and_then(|i| usize::try_from(i).ok()),
                    b[1].as_str(),
                    b[2].as_str(),
                ) else {
                    return Err(corrupt("breach pointer"));
                };
                let refs = self
                    .breach_refs(account_id, snapshot, rule)?
                    .ok_or_else(|| corrupt("breach pointer"))?;
                let target = ex["policy"]["priorBreaches"]
                    .get_mut(i)
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| corrupt("breach"))?;
                target.insert("sourceReferences".into(), refs);
            }
        }
        // Without `resolve` (a pointer target, or one rule for `prior_breaches`), carried breaches keep no
        // references; only the rules are read.
        Ok(ex)
    }

    /// The canonically sorted references of rule `rule_id` in calculation `snapshot_id` of the same account.
    fn breach_refs(
        &mut self,
        account_id: &str,
        snapshot_id: &str,
        rule_id: &str,
    ) -> AppResult<Option<Value>> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT account_id, explanation_json FROM account_snapshots WHERE id = ?1",
                [snapshot_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((owner, text)) = row else {
            return Ok(None);
        };
        if owner != account_id {
            return Ok(None);
        }
        let raw: Value = serde_json::from_str(&text).map_err(|_| corrupt("breach source"))?;
        let ex = self.decode_with(account_id, raw, false)?;
        let rule = ex["engine"]["rules"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|r| r["ruleId"].as_str() == Some(rule_id));
        Ok(rule
            .and_then(|r| r.get("sourceReferences"))
            .filter(|r| r.is_array())
            .and_then(canonical_array))
    }

    /// One rule's references of a stored calculation, decoding only what they need (for `prior_breaches`).
    pub(crate) fn rule_refs(
        &mut self,
        account_id: &str,
        raw: &Value,
        rule_index: usize,
    ) -> AppResult<Value> {
        let ex = self.decode_with(account_id, raw.clone(), false)?;
        Ok(ex["engine"]["rules"][rule_index]["sourceReferences"].clone())
    }
}

/// The stored text of an explanation and how many of its parts had to stay inline.
pub(crate) struct Encoded {
    pub text: String,
    pub fallbacks: u64,
}

fn inline(explanation: &Value, fallbacks: u64) -> AppResult<Encoded> {
    let text = if is_compact(explanation) {
        // Never let an inline explanation look like this format.
        serde_json::to_string(&json!({ MARKER_KEY: MARKER, "inline": explanation }))
    } else {
        serde_json::to_string(explanation)
    }
    .map_err(|e| AppError::invalid("explanation", e.to_string()))?;
    Ok(Encoded { text, fallbacks })
}

/// The account's latest generation (0 before any span).
fn head(conn: &Connection, account_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT max(coalesce(max(from_generation), 0), coalesce(max(to_generation), 0))
         FROM risk_frozen_spans WHERE account_id = ?1",
        [account_id],
        |r| r.get(0),
    )?)
}

/// The generation whose lists equal these: the account's latest one if every list matches its open spans,
/// otherwise a new one that closes and opens only the spans that differ.
fn generation(
    conn: &Connection,
    account_id: &str,
    lists: &[(&str, &Vec<Value>)],
) -> AppResult<i64> {
    type Wanted = BTreeMap<String, (i64, String)>;
    let mut changes: Vec<(&str, Wanted, BTreeMap<String, i64>)> = Vec::new();
    for (kind, list) in lists {
        let mut wanted: Wanted = BTreeMap::new();
        for record in list.iter() {
            let text = canonical_engine_json(record);
            let entry = wanted.entry(sha256(&text)).or_insert((0, text));
            entry.0 += 1;
        }
        let mut stmt = conn.prepare_cached(
            "SELECT record_hash, multiplicity FROM risk_frozen_spans
             WHERE account_id = ?1 AND kind = ?2 AND to_generation IS NULL",
        )?;
        let open: BTreeMap<String, i64> = stmt
            .query_map(params![account_id, kind], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let same =
            open.len() == wanted.len() && wanted.iter().all(|(h, (m, _))| open.get(h) == Some(m));
        if !same {
            changes.push((kind, wanted, open));
        }
    }
    let current = head(conn, account_id)?;
    if changes.is_empty() {
        return Ok(current);
    }
    let next = current + 1;
    for (kind, wanted, open) in changes {
        for (hash, copies) in &open {
            if wanted.get(hash).map(|w| w.0) != Some(*copies) {
                conn.execute(
                    "UPDATE risk_frozen_spans SET to_generation = ?4
                     WHERE account_id = ?1 AND kind = ?2 AND record_hash = ?3 AND to_generation IS NULL",
                    params![account_id, kind, hash, next],
                )?;
            }
        }
        for (hash, (copies, text)) in &wanted {
            if open.get(hash) != Some(copies) {
                conn.execute(
                    "INSERT OR IGNORE INTO risk_frozen_records (account_id, kind, record_hash, record_json)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![account_id, kind, hash, text],
                )?;
                conn.execute(
                    "INSERT INTO risk_frozen_spans (account_id, kind, record_hash, from_generation, to_generation, multiplicity)
                     VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
                    params![account_id, kind, hash, next, copies],
                )?;
            }
        }
    }
    Ok(next)
}

/// A stored row's position (`calculated_at`, `id`): only calculations before it are breach sources.
pub(crate) type Before<'a> = Option<(&'a str, &'a str)>;

#[cfg(test)]
thread_local! {
    static BREACH_CANDIDATES: Cell<u64> = const { Cell::new(0) };
    static LIST_BUILDS: std::cell::RefCell<HashMap<String, u64>> = std::cell::RefCell::new(HashMap::new());
}

/// Rows `breach_source` read back from SQL and parsed, summed over this thread (tests).
#[cfg(test)]
pub(crate) fn breach_candidates() -> u64 {
    BREACH_CANDIDATES.with(Cell::get)
}

/// Lists of `kind` that decoders on this thread rebuilt from spans (tests).
#[cfg(test)]
pub(crate) fn list_builds(kind: &str) -> u64 {
    LIST_BUILDS.with(|b| b.borrow().get(kind).copied().unwrap_or(0))
}

/// The engine result of a stored explanation, as SQL sees it: inline, wrapped inline or compact.
const STORED_ENGINE: &str =
    "CASE WHEN json_extract(explanation_json, '$.\"$ff\"') IS NULL THEN '$.engine'
    WHEN json_type(explanation_json, '$.inline') IS NOT NULL THEN '$.inline.engine'
    ELSE '$.explanation.engine' END";

/// The calculation and rule of the same account a carried breach came from, if one matches exactly. Candidates
/// are filtered in SQL on the breach's cutoff, assignment and rulebook version and, with `before`, on position,
/// and read newest first only until one matches, so a lookup parses a few rows rather than every calculation.
fn breach_source(
    conn: &Connection,
    decoder: &mut Decoder,
    account_id: &str,
    breach: &Value,
    before: Before,
) -> AppResult<Option<(String, String)>> {
    let (Some(observed_at), Some(assignment), Some(version)) = (
        breach["observedAt"].as_str(),
        breach["assignmentId"].as_str(),
        breach["rulebookVersionId"].as_str(),
    ) else {
        return Ok(None);
    };
    let sql = format!(
        "SELECT id, explanation_json FROM (
           SELECT id, trading_day, calculated_at, explanation_json, {STORED_ENGINE} AS engine
           FROM account_snapshots
           WHERE account_id = ?1
             AND (?2 IS NULL OR calculated_at < ?2 OR (calculated_at = ?2 AND id < ?3))
             AND engine_version GLOB 'fundedflow-risk/*')
         WHERE json_extract(explanation_json, engine || '.asOf') = ?4
           AND json_extract(explanation_json, engine || '.assignmentId') = ?5
           AND json_extract(explanation_json, engine || '.rulebookVersionId') = ?6
         ORDER BY trading_day DESC, calculated_at DESC, id"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let (at, row_id) = before.unzip();
    let mut rows = stmt.query(params![
        account_id,
        at,
        row_id,
        observed_at,
        assignment,
        version
    ])?;
    while let Some(row) = rows.next()? {
        let (id, text): (String, String) = (row.get(0)?, row.get(1)?);
        #[cfg(test)]
        BREACH_CANDIDATES.with(|c| c.set(c.get() + 1));
        let Ok(raw) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let engine = match (is_compact(&raw), raw.get("inline")) {
            (true, Some(inline)) => &inline["engine"],
            (true, None) => &raw["explanation"]["engine"],
            (false, _) => &raw["engine"],
        };
        if engine["assignmentId"] != breach["assignmentId"]
            || engine["asOf"] != breach["observedAt"]
            || engine["rulebookVersionId"] != breach["rulebookVersionId"]
        {
            continue;
        }
        let candidates: Vec<String> = engine["rules"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|r| r["ruleKey"] == breach["ruleKey"] && r["state"] == "breached")
            .filter_map(|r| r["ruleId"].as_str().map(str::to_string))
            .collect();
        for rule in candidates {
            if decoder.breach_refs(account_id, &id, &rule)?.as_ref()
                == Some(&breach["sourceReferences"])
            {
                return Ok(Some((id, rule)));
            }
        }
    }
    Ok(None)
}

/// The text to store for a calculation's explanation. Engine calculations whose inputs are canonical are
/// encoded (writing any new records and spans in the caller's transaction); everything else, and any part
/// that would not decode exactly, is stored as given. Call only with a payload that passed
/// `snapshots::prepare` (or, in migration 23, `validate_engine_payload`).
pub(crate) fn encode(
    conn: &Connection,
    account_id: &str,
    engine_version: &str,
    explanation: &Value,
    before: Before,
) -> AppResult<Encoded> {
    if is_compact(explanation) || !is_engine(engine_version, explanation) {
        return inline(explanation, 0);
    }
    let inputs = &explanation["inputs"];
    // The mapper freezes canonical inputs; a caller payload that isn't stays inline (by design).
    if serde_json::from_str::<Value>(&canonical_engine_json(inputs))
        .ok()
        .as_ref()
        != Some(inputs)
    {
        return report(inline(explanation, 1)?);
    }
    conn.execute_batch("SAVEPOINT frozen_v1")?;
    let attempt = encode_in(conn, account_id, explanation, before).map(|(compact, fallbacks)| {
        let decoded = Decoder::new(conn).decode(account_id, compact.clone());
        let exact = decoded.ok().as_ref() == Some(explanation);
        (compact, fallbacks, exact)
    });
    match attempt {
        Ok((compact, fallbacks, true)) => {
            conn.execute_batch("RELEASE frozen_v1")?;
            let text = serde_json::to_string(&compact)
                .map_err(|e| AppError::invalid("explanation", e.to_string()))?;
            #[cfg(test)]
            COMPACT_WRITES.with(|c| c.set(c.get() + 1));
            report(Encoded { text, fallbacks })
        }
        Ok((_, _, false)) => {
            conn.execute_batch("ROLLBACK TO frozen_v1; RELEASE frozen_v1")?;
            report(inline(explanation, 1)?)
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK TO frozen_v1; RELEASE frozen_v1")?;
            Err(e)
        }
    }
}

fn report(encoded: Encoded) -> AppResult<Encoded> {
    if encoded.fallbacks > 0 {
        FALLBACKS.with(|f| f.set(f.get() + encoded.fallbacks));
        // A count only; never record content.
        eprintln!(
            "frozen-v1: {} part(s) of a calculation stored inline",
            encoded.fallbacks
        );
    }
    Ok(encoded)
}

fn encode_in(
    conn: &Connection,
    account_id: &str,
    explanation: &Value,
    before: Before,
) -> AppResult<(Value, u64)> {
    let mut fallbacks = 0;
    let mut ex = explanation.clone();
    let mut meta = Map::new();
    meta.insert(MARKER_KEY.into(), json!(MARKER));
    let inputs = &explanation["inputs"];
    let policy = &explanation["policy"];
    let lists: Vec<(&str, &Vec<Value>)> = KINDS
        .iter()
        .filter_map(|k| inputs[*k].as_array().map(|a| (*k, a)))
        .collect();
    if !lists.is_empty() {
        let g = generation(conn, account_id, &lists)?;
        let stored = ex["inputs"].as_object_mut().expect("inputs is an object");
        for (kind, _) in &lists {
            stored.remove(*kind);
        }
        meta.insert("generation".into(), json!(g));
        meta.insert(
            "lists".into(),
            json!(lists.iter().map(|(k, _)| *k).collect::<Vec<_>>()),
        );
    }
    let derived = derived_set(inputs, policy);
    let observations = inputs["observations"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if let Some(refs) = explanation["engine"].get("sourceReferences") {
        if derived.as_ref().map(|d| json!(d)).as_ref() == Some(refs) {
            ex["engine"]
                .as_object_mut()
                .expect("engine is an object")
                .remove("sourceReferences");
            meta.insert("refs".into(), json!(true));
        } else {
            fallbacks += 1;
        }
    }
    let mut rules = Vec::new();
    for (i, rule) in explanation["engine"]["rules"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let Some(refs) = rule.get("sourceReferences") else {
            continue;
        };
        let encoded = derived.as_ref().and_then(|d| {
            let enc = encode_rule_refs(d, refs, &observations)?;
            (decode_rule_refs(d, &enc[0], &enc[1], &observations).as_ref() == Some(refs))
                .then_some(enc)
        });
        match encoded {
            Some(enc) => {
                if let Some(o) = ex["engine"]["rules"][i].as_object_mut() {
                    o.remove("sourceReferences");
                }
                rules.push(json!([i, enc[0], enc[1]]));
            }
            None => fallbacks += 1,
        }
    }
    if !rules.is_empty() {
        meta.insert("rules".into(), Value::Array(rules));
    }
    let mut breaches = Vec::new();
    let mut decoder = Decoder::new(conn);
    for (i, breach) in policy["priorBreaches"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if breach.get("sourceReferences").is_none() {
            continue;
        }
        match breach_source(conn, &mut decoder, account_id, breach, before)? {
            Some((snapshot, rule)) => {
                if let Some(o) = ex["policy"]["priorBreaches"][i].as_object_mut() {
                    o.remove("sourceReferences");
                }
                breaches.push(json!([i, snapshot, rule]));
            }
            None => fallbacks += 1,
        }
    }
    if !breaches.is_empty() {
        meta.insert("breaches".into(), Value::Array(breaches));
    }
    meta.insert("explanation".into(), ex);
    Ok((Value::Object(meta), fallbacks))
}

/// Migration 23 data step: rewrites every eligible stored engine calculation into this format, one row at a
/// time. Eligible: an engine version `fundedflow-risk/...`, an explanation that parses as an engine
/// calculation, `validate_engine_payload` passing on the row rebuilt as a `SnapshotInput`, and an encoding that
/// decodes to the same value (checked inside `encode`). Any other row is left byte-identical, except that on the
/// migration's own run (`first_run`) every explanation with a top-level `"$ff"` key is wrapped: no row can be in
/// this format before migration 23, so such a key is always caller content. Rows already in this format are
/// skipped, so the compaction is idempotent. A carried breach's source is looked up only among earlier rows
/// (already compacted, so small) of the same cutoff, assignment and rulebook version, newest first, so each
/// lookup parses a few rows rather than every calculation of the account.
///
/// This is the owner-approved exception OD-7(2) to the data-step rule (`db/mod.rs`, "change only derived
/// columns"): `explanation_json` is not derived. The `account_snapshot_no_update` trigger is dropped for the
/// rewrite and recreated from its own stored SQL, so the schema is byte-identical afterwards.
pub(crate) fn backfill(tx: &Connection, first_run: bool) -> rusqlite::Result<()> {
    let trigger: String = tx.query_row(
        "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'account_snapshot_no_update'",
        [],
        |r| r.get(0),
    )?;
    tx.execute_batch("DROP TRIGGER account_snapshot_no_update")?;
    // Before migration 23 nothing is encoded, so a top-level "$ff" key is caller content: wrap it, as new writes
    // are, so it can never be read as the compact form.
    if first_run {
        let marked: Vec<(String, String)> = tx
            .prepare(
                "SELECT id, explanation_json FROM account_snapshots
                 WHERE json_extract(explanation_json, '$.\"$ff\"') IS NOT NULL ORDER BY id",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, text) in marked {
            let raw: Value = serde_json::from_str(&text)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            tx.execute(
                "UPDATE account_snapshots SET explanation_json = ?2 WHERE id = ?1",
                params![id, json!({ MARKER_KEY: MARKER, "inline": raw }).to_string()],
            )?;
        }
    }
    let ids: Vec<String> = tx
        .prepare(
            "SELECT id FROM account_snapshots WHERE engine_version GLOB 'fundedflow-risk/*'
             ORDER BY calculated_at, id",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let failed = |e: AppError| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e.to_string())))
    };
    for id in ids {
        let Some(snapshot) = super::snapshots::get_stored(tx, &id).map_err(failed)? else {
            continue;
        };
        if is_compact(&snapshot.explanation)
            || !is_engine(&snapshot.engine_version, &snapshot.explanation)
            || !super::snapshots::engine_payload_valid(&snapshot)
        {
            continue;
        }
        let encoded = encode(
            tx,
            &snapshot.account_id,
            &snapshot.engine_version,
            &snapshot.explanation,
            Some((&snapshot.calculated_at, &snapshot.id)),
        )
        .map_err(failed)?;
        let compact: Value = serde_json::from_str(&encoded.text)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        if is_compact(&compact) {
            tx.execute(
                "UPDATE account_snapshots SET explanation_json = ?2 WHERE id = ?1",
                params![id, encoded.text],
            )?;
        }
    }
    tx.execute_batch(&trigger)?;
    Ok(())
}

/// Archive check for schema 23 and later: every record matches its hash, and every encoded calculation decodes
/// (its generation, records and breach pointers resolve within its own account) to an explanation whose
/// inputs hash still re-proves. A tampered record, span or pointer therefore fails.
pub(crate) fn verify(conn: &Connection) -> AppResult<bool> {
    let mut stmt = conn.prepare("SELECT record_hash, record_json FROM risk_frozen_records")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let (hash, text): (String, String) = (row.get(0)?, row.get(1)?);
        if sha256(&text) != hash {
            return Ok(false);
        }
    }
    let mut stmt = conn.prepare(
        "SELECT account_id, engine_version, inputs_hash, explanation_json FROM account_snapshots
         WHERE json_extract(explanation_json, '$.\"$ff\"') IS NOT NULL ORDER BY account_id, calculated_at, id",
    )?;
    let mut rows = stmt.query([])?;
    // One decoder per account, so its caches never hold more than one account's records.
    let mut decoder = Decoder::new(conn);
    let mut current = String::new();
    while let Some(row) = rows.next()? {
        let (account, engine_version, inputs_hash, text): (String, String, String, String) =
            (row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?);
        if account != current {
            decoder = Decoder::new(conn);
            current = account.clone();
        }
        let Ok(raw) = serde_json::from_str::<Value>(&text) else {
            return Ok(false);
        };
        let wrapped_only = raw.get("inline").is_some();
        if let Some(g) = raw.get("generation").and_then(Value::as_i64)
            && g > head(conn, &account)?
        {
            return Ok(false);
        }
        let Ok(ex) = decoder.decode(&account, raw) else {
            return Ok(false);
        };
        if wrapped_only || !is_engine(&engine_version, &ex) {
            continue;
        }
        let expected =
            json!({"engineVersion": engine_version, "input": ex["inputs"], "policy": ex["policy"]});
        if sha256(&canonical_engine_json(&expected)) != inputs_hash {
            return Ok(false);
        }
    }
    Ok(true)
}
