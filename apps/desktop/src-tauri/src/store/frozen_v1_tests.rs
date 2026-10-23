//! TASK-045 (D-ARCH / ISSUE-002c): the `frozen-v1` stored form of engine calculations. Round trips on real TS
//! output and on the four Rust-synthesised payload shapes, fallback, edits, churn, duplicates, the golden
//! encoding, account deletion, the migration 23 upgrade, and the committed growth harness. All data is synthetic.
use std::path::Path;
use std::time::Instant;

use rusqlite::{Connection, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::evidence::{self, ObservationInput, RiskInputsQuery};
use super::reconciliation::Coverage;
use super::risk_promotion::{self, RiskCapture};
use super::snapshots::{self, SnapshotInput, canonical_engine_json};
use super::trades::{self, TradeInput};

// ---------------------------------------------------------------------------
// Payload shapes (spec step 7) and the growth harness. This section uses only APIs that existed before TASK-045,
// so the same harness measured the baseline.
// ---------------------------------------------------------------------------

/// The four payload shapes of the spec's step 7.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Shape {
    /// (i) TASK-010's `calc` payload with `breach = false`, inputs and policy frozen canonically.
    TaskTen,
    /// (ii) A real-engine-shaped result: result and rule references as `evaluate.ts` builds them, three rules
    /// (one with an end-of-day history tail, one with a pushed rule id), one breach carried forward.
    RealEngine,
    /// (iii) (ii) with one new trade between consecutive calculations.
    NewTrade,
    /// (iv) (ii) with one new end-of-day settlement between consecutive calculations.
    NewSettlement,
}

impl Shape {
    fn parse(s: &str) -> Shape {
        match s {
            "i" => Shape::TaskTen,
            "ii" => Shape::RealEngine,
            "iii" => Shape::NewTrade,
            "iv" => Shape::NewSettlement,
            _ => panic!("unknown shape {s}"),
        }
    }
    fn label(self) -> &'static str {
        match self {
            Shape::TaskTen => "i",
            Shape::RealEngine => "ii",
            Shape::NewTrade => "iii",
            Shape::NewSettlement => "iv",
        }
    }
}

const ENGINE_VERSION: &str = "fundedflow-risk/1";
/// The profit-target rule id a consistency rule pushes after its sorted references (`evaluate.ts:695`).
const TARGET_RULE: &str = "00000000-0000-4000-8000-0000000000e9";

fn canonical(v: &Value) -> Value {
    serde_json::from_str(&canonical_engine_json(v)).unwrap()
}

/// `[...new Set(v)].sort()`: a set in UTF-16 order.
fn unique(mut v: Vec<String>) -> Vec<String> {
    v.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    v.dedup();
    v
}

/// `evaluate.ts:793-803`, written out independently of the codec.
fn engine_references(inputs: &Value, policy: &Value) -> Vec<String> {
    let s = |v: &Value| v.as_str().unwrap().to_string();
    let mut v: Vec<String> = policy["reconciliationRevisionIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(s)
        .collect();
    for o in inputs["observations"].as_array().unwrap() {
        v.push(s(&o["id"]));
        v.push(s(&o["sourceReference"]));
    }
    for t in inputs["trades"].as_array().unwrap() {
        v.push(s(&t["id"]));
        if let Some(batch) = t["importBatchId"].as_str().filter(|b| !b.is_empty()) {
            v.push(batch.to_string());
        }
    }
    for kind in ["ledger", "ledgerHistory", "phaseHistory"] {
        v.extend(inputs[kind].as_array().unwrap().iter().map(|e| s(&e["id"])));
    }
    unique(v)
}

/// Three rule outcomes over `references`, as `evaluate.ts:863-876` builds them, plus the tails pushed after the
/// sort: end-of-day history ids (`:516`) and the profit-target rule id (`:695`). Metrics, operands and formulas
/// are constants, so their lengths never depend on N. The first rule is breached.
fn real_rules(inputs: &Value, references: &[String]) -> Value {
    let version = &inputs["applicableAssignment"]["rulebookVersionId"];
    let detail = inputs["rulebookVersions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| &v["version"]["id"] == version)
        .cloned()
        .unwrap_or(Value::Null);
    let mut defs: Vec<(String, String, String)> = detail["rules"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| {
            (
                r["ruleKey"].as_str().unwrap().to_string(),
                r["id"].as_str().unwrap().to_string(),
                r["ruleType"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    defs.sort();
    defs.truncate(3);
    for n in defs.len()..3 {
        defs.push((
            format!("zz_synthetic_{n}"),
            format!("00000000-0000-4000-8000-0000000000e{n}"),
            if n == 1 {
                "max_drawdown"
            } else {
                "profit_target"
            }
            .into(),
        ));
    }
    let history: Vec<String> = inputs["observations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["kind"] == "eod_settlement" && o["basis"] == "balance")
        .map(|o| o["id"].as_str().unwrap().to_string())
        .collect();
    let rules: Vec<Value> = defs
        .iter()
        .enumerate()
        .map(|(i, (key, id, rule_type))| {
            let claims: Vec<String> = detail["claims"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|c| c["ruleDefinitionId"] == id.as_str())
                .flat_map(|c| [c["id"].clone(), c["sourceId"].clone()])
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            let mut refs = unique(references.iter().cloned().chain(claims).collect());
            match i {
                1 => refs.extend(history.iter().cloned()),
                2 => refs.push(TARGET_RULE.into()),
                _ => {}
            }
            json!({ "ruleId": id, "ruleKey": key, "ruleType": rule_type,
                "state": if i == 0 { "breached" } else { "satisfied" },
                "reasonCode": if i == 0 { "limit_reached" } else { "within_limit" },
                "metrics": {}, "formula": "synthetic constant formula", "operands": { "amount": "1000" },
                "sourceReferences": refs, "missingInputs": [], "evidence": [], "assumptions": ["synthetic"] })
        })
        .collect();
    Value::Array(rules)
}

/// A calculation of exactly this capture in the given shape. With `canonical`, inputs and policy are frozen as
/// the TS mapper freezes them (`snapshot.ts:80`); without, `inputs` is the capture as read (the TASK-010 harness
/// payload). Either way the hash is the engine's.
pub(crate) fn shape_input(
    cap: &RiskCapture,
    shape: Shape,
    canonical_inputs: bool,
) -> SnapshotInput {
    let mut inputs = cap.inputs.clone();
    let mut policy = json!({ "ruleCurrency": null, "ruleCurrencySourceClaimIds": [], "boundary": null, "boundarySourceClaimIds": [],
        "reconciliationRevisionIds": cap.reconciliation_revision_ids, "personalCautionHeadroom": null, "priorBreaches": cap.prior_breaches });
    if canonical_inputs {
        inputs = canonical(&inputs);
        policy = canonical(&policy);
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(
            canonical_engine_json(
                &json!({"engineVersion": ENGINE_VERSION, "input": inputs, "policy": policy})
            )
            .as_bytes()
        )
    );
    let assignment = &inputs["applicableAssignment"];
    let version = assignment["rulebookVersionId"].as_str().map(str::to_string);
    let mut engine = json!({ "accountId": inputs["account"]["id"], "rulebookVersionId": version, "assignmentId": assignment["id"],
        "programmePhaseId": null, "phasePathId": null, "engineVersion": ENGINE_VERSION, "tradingDay": inputs["effectiveTradingDay"],
        "asOf": inputs["asOf"], "dataAsOf": null, "inputsHash": hash, "status": "Unknown", "balance": null, "realizedDayPnl": null,
        "tradingDaysCompleted": null, "rules": [] });
    if shape != Shape::TaskTen {
        let references = engine_references(&inputs, &policy);
        engine["rules"] = real_rules(&inputs, &references);
        engine["sourceReferences"] = json!(references);
        engine["status"] = json!("Stop");
        engine["assumptions"] = json!(["synthetic constant assumption"]);
    }
    let status = engine["status"].as_str().unwrap().to_ascii_lowercase();
    serde_json::from_value(json!({
        "accountId": inputs["account"]["id"], "rulebookVersionId": version, "tradingDay": inputs["effectiveTradingDay"], "isEndOfDay": false,
        "dataAsOf": null, "dataSource": "manual", "engineVersion": ENGINE_VERSION, "inputsHash": hash, "feesIncluded": true,
        "unrealizedIncluded": false, "balance": null, "realizedDayPnl": null, "unrealizedPnl": null, "dailyLossLimit": null,
        "dailyLossRemaining": null, "drawdownMode": null, "highWaterMark": null, "drawdownFloor": null, "drawdownHeadroom": null,
        "drawdownLocked": null, "profitTarget": null, "tradingDaysCompleted": null, "tradingDaysRequired": null,
        "status": status, "statusReasons": ["synthetic"],
        "explanation": { "engine": engine, "inputs": inputs, "policy": policy, "recalculation": "synthetic" },
    }))
    .unwrap()
}

const HARNESS_AS_OF: &str = "2026-12-31T21:00:00.000Z";

fn harness_query(account: &str) -> RiskInputsQuery {
    RiskInputsQuery {
        account_id: account.into(),
        as_of: HARNESS_AS_OF.into(),
        coverage: Coverage {
            baseline: "available".into(),
            closed_trades: "available".into(),
            fees: "available".into(),
            ledger: "available".into(),
            open_positions: "unsupported".into(),
            eod_history: "available".into(),
            intraday_history: "unsupported".into(),
            source_reference: "synthetic statement".into(),
        },
    }
}

/// A synthetic closed trade, the `i`th of a top-up.
fn synthetic_trade(account: &str, i: usize) -> TradeInput {
    let entry = chrono::DateTime::parse_from_rfc3339("2026-01-05T14:30:00Z").unwrap()
        + chrono::Duration::minutes(i as i64 * 7);
    let exit = entry + chrono::Duration::minutes(5);
    TradeInput {
        account_id: account.into(),
        symbol: "ESZ6".into(),
        side: if i.is_multiple_of(2) { "long" } else { "short" }.into(),
        quantity: "1".into(),
        entry_at: entry.to_rfc3339(),
        entry_price: "5000.25".into(),
        exit_at: Some(exit.to_rfc3339()),
        exit_price: Some("5001.50".into()),
        fees: Some("4.12".into()),
        realized_pnl: None,
        notes: None,
    }
}

/// A synthetic end-of-day settlement, the `k`th of a run.
fn synthetic_settlement(account: &str, currency: &str, k: usize) -> ObservationInput {
    let at = chrono::DateTime::parse_from_rfc3339("2026-11-02T22:00:00Z").unwrap()
        + chrono::Duration::hours(k as i64);
    ObservationInput {
        account_id: account.into(),
        kind: "eod_settlement".into(),
        value: Some("50100".into()),
        currency: currency.into(),
        basis: "balance".into(),
        observed_at: at.to_rfc3339(),
        source_category: "firm_dashboard".into(),
        source_reference: "synthetic settlement".into(),
        confirmation: "user_confirmed".into(),
        confidence: "user_reported".into(),
        valid_until: None,
        actor: "harness".into(),
        note: None,
    }
}

/// What one checkpoint of a run records (TASK-010's table, plus the new-table rows, timings and fallbacks).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Measure {
    pub k: usize,
    pub file_bytes: u64,
    pub page_count: i64,
    pub freelist: i64,
    pub used_bytes: i64,
    pub explanation_bytes: i64,
    pub snapshots: i64,
    pub frozen_rows: i64,
    pub total_rows: i64,
    /// `data.json` bytes of a real export, or None when the export refused (a cap) or was not measured.
    pub data_json: Option<u64>,
    pub export_refusal: Option<String>,
    /// Capture + promote, summed over every calculation so far.
    pub promote_ms: f64,
    pub list_ms: f64,
    pub fallbacks: u64,
}

fn table_rows(c: &Connection) -> (i64, i64) {
    let tables: Vec<String> = c
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let (mut frozen, mut total) = (0, 0);
    for t in tables {
        let n: i64 = c
            .query_row(&format!("SELECT count(*) FROM \"{t}\""), [], |r| r.get(0))
            .unwrap();
        total += n;
        if t.starts_with("risk_frozen_") {
            frozen += n;
        }
    }
    (frozen, total)
}

/// Codec fallbacks so far on this thread (0 before TASK-045, which had no codec).
fn fallbacks() -> u64 {
    super::frozen_v1::fallback_total()
}

/// Measures the journal. `root` (the data folder of a file journal) adds the file size and a real export.
pub(crate) fn measure(
    c: &Connection,
    account: &str,
    k: usize,
    promote_ms: f64,
    root: Option<&Path>,
) -> Measure {
    let pragma = |name: &str| {
        c.pragma_query_value(None, name, |r| r.get::<_, i64>(0))
            .unwrap()
    };
    let mut m = Measure {
        k,
        promote_ms,
        fallbacks: fallbacks(),
        ..Measure::default()
    };
    if let Some(root) = root {
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        m.file_bytes = std::fs::metadata(root.join(crate::db::DB_FILE_NAME))
            .unwrap()
            .len();
    }
    m.page_count = pragma("page_count");
    m.freelist = pragma("freelist_count");
    m.used_bytes = (m.page_count - m.freelist) * pragma("page_size");
    m.explanation_bytes = c
        .query_row(
            "SELECT coalesce(sum(length(CAST(explanation_json AS BLOB))), 0) FROM account_snapshots",
            [],
            |r| r.get(0),
        )
        .unwrap();
    m.snapshots = c
        .query_row("SELECT count(*) FROM account_snapshots", [], |r| r.get(0))
        .unwrap();
    (m.frozen_rows, m.total_rows) = table_rows(c);
    let t = Instant::now();
    snapshots::list(c, account, None, None, false).unwrap();
    m.list_ms = t.elapsed().as_secs_f64() * 1000.0;
    if let Some(root) = root {
        let out = tempfile::tempdir().unwrap();
        let zip = out.path().join("export.zip");
        match crate::data_controls::export_journal(
            c,
            root,
            crate::data_controls::ExportRequest {
                destination: zip.to_string_lossy().into(),
                acknowledge_plaintext: true,
            },
        ) {
            Ok(_) => {
                let mut archive = zip::ZipArchive::new(std::fs::File::open(&zip).unwrap()).unwrap();
                m.data_json = Some(archive.by_name("data.json").unwrap().size());
            }
            Err(e) => m.export_refusal = Some(format!("{e:?}")),
        }
    }
    m
}

/// Runs K calculations of `shape` on `account`, topped up to `n` trades, recording a measure at k = 0 and at each
/// checkpoint. Shapes (iii) and (iv) insert their new record before every calculation after the first; that time
/// is not counted.
pub(crate) fn run_shape(
    c: &mut Connection,
    account: &str,
    shape: Shape,
    n: usize,
    checkpoints: &[usize],
    root: Option<&Path>,
) -> Vec<Measure> {
    let have: i64 = c
        .query_row(
            "SELECT count(*) FROM trades WHERE account_id = ?1 AND deleted_at IS NULL",
            [account],
            |r| r.get(0),
        )
        .unwrap();
    for i in have as usize..n {
        trades::create(c, synthetic_trade(account, i)).unwrap();
    }
    let currency: String = c
        .query_row(
            "SELECT currency FROM accounts WHERE id = ?1",
            [account],
            |r| r.get(0),
        )
        .unwrap();
    let mut out = vec![measure(c, account, 0, 0.0, root)];
    let mut promote_ms = 0.0;
    let last = checkpoints.iter().copied().max().unwrap_or(0);
    for k in 1..=last {
        if k > 1 && shape == Shape::NewTrade {
            trades::create(c, synthetic_trade(account, n + k)).unwrap();
        }
        if k > 1 && shape == Shape::NewSettlement {
            evidence::create(c, synthetic_settlement(account, &currency, k)).unwrap();
        }
        let t = Instant::now();
        let cap = risk_promotion::capture(c, harness_query(account)).unwrap();
        risk_promotion::promote(c, shape_input(&cap, shape, true)).unwrap();
        promote_ms += t.elapsed().as_secs_f64() * 1000.0;
        if checkpoints.contains(&k) {
            out.push(measure(c, account, k, promote_ms, root));
        }
    }
    out
}

/// The growth harness (spec step 7; TASK-010's method). Disposable journals only: it copies the seed into a fresh
/// temporary folder per run and never opens anything else.
///
/// 1. In `apps/desktop/src-tauri`: `cargo run --offline --locked --example seed-demo-journal -- --data-dir
///    <scratch>/seed/com.fundedflow.desktop --preset stress`.
/// 2. `FF_GROWTH_SEED_DB=<scratch>/seed/com.fundedflow.desktop/fundedflow.db [FF_GROWTH_RUNS="ii:2000:1,50,250;.."]
///    [FF_GROWTH_OUT=<file.csv>] cargo test --offline --locked --release --lib frozen_v1_growth_harness --
///    --ignored --nocapture`. Each run is `shape:N:checkpoints`; the default is every run of the spec.
#[test]
#[ignore = "growth harness: needs a seeded stress journal (FF_GROWTH_SEED_DB); see the doc comment"]
fn frozen_v1_growth_harness() {
    let seed = std::path::PathBuf::from(
        std::env::var("FF_GROWTH_SEED_DB")
            .expect("FF_GROWTH_SEED_DB names the seeded stress journal"),
    );
    let runs = std::env::var("FF_GROWTH_RUNS").unwrap_or_else(|_| {
        let mut runs = Vec::new();
        for shape in ["i", "ii", "iii", "iv"] {
            for n in [500, 2000, 10000] {
                runs.push(format!("{shape}:{n}:1,50"));
            }
        }
        runs.push("ii:2000:1,50,250".into());
        runs.join(";")
    });
    let mut csv = String::from(
        "shape,N,K,file_bytes,page_count,freelist,used_bytes,snapshots,explanation_bytes,frozen_rows,total_rows,data_json,export_refusal,promote_ms_total,list_ms,fallbacks\n",
    );
    for run in runs.split(';').filter(|r| !r.is_empty()) {
        let parts: Vec<&str> = run.split(':').collect();
        let shape = Shape::parse(parts[0]);
        let n: usize = parts[1].parse().unwrap();
        let checkpoints: Vec<usize> = parts[2].split(',').map(|k| k.parse().unwrap()).collect();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("com.fundedflow.desktop");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::copy(&seed, root.join(crate::db::DB_FILE_NAME)).unwrap();
        let mut c = crate::db::open_file(&root.join(crate::db::DB_FILE_NAME)).unwrap();
        let account: String = c
            .query_row(
                "SELECT a.id FROM accounts a WHERE a.archived_at IS NULL ORDER BY
                   (SELECT count(*) FROM trades t WHERE t.account_id = a.id AND t.deleted_at IS NULL) DESC, a.id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let start = fallbacks();
        for m in run_shape(&mut c, &account, shape, n, &checkpoints, Some(&root)) {
            let line = format!(
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{:.1},{:.1},{}\n",
                shape.label(),
                n,
                m.k,
                m.file_bytes,
                m.page_count,
                m.freelist,
                m.used_bytes,
                m.snapshots,
                m.explanation_bytes,
                m.frozen_rows,
                m.total_rows,
                m.data_json.map_or("refused".into(), |b| b.to_string()),
                m.export_refusal.unwrap_or_default().replace(',', ";"),
                m.promote_ms,
                m.list_ms,
                m.fallbacks - start
            );
            print!("{line}");
            csv.push_str(&line);
        }
    }
    if let Ok(out) = std::env::var("FF_GROWTH_OUT") {
        std::fs::write(out, csv).unwrap();
    }
}

// ---------------------------------------------------------------------------
// End of the section that also ran on the baseline.
// ---------------------------------------------------------------------------

/// Turns a journal at version 23 or later back into what version 22 stored: every calculation inline (its
/// decoded explanation, serialized as `insert_prepared` did before TASK-045) and no frozen-source tables.
pub(crate) fn before_migration_23(c: &Connection) {
    let ids: Vec<String> = c
        .prepare("SELECT id FROM account_snapshots ORDER BY rowid")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let decoded: Vec<(String, String)> = ids
        .into_iter()
        .map(|id| {
            let s = snapshots::get(c, &id).unwrap();
            (id, serde_json::to_string(&s.explanation).unwrap())
        })
        .collect();
    let trigger: String = c
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name = 'account_snapshot_no_update'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    c.execute_batch("DROP TRIGGER account_snapshot_no_update")
        .unwrap();
    for (id, text) in decoded {
        c.execute(
            "UPDATE account_snapshots SET explanation_json = ?2 WHERE id = ?1",
            params![id, text],
        )
        .unwrap();
    }
    c.execute_batch(&trigger).unwrap();
    c.execute_batch(
        "DROP TABLE risk_frozen_spans; DROP TABLE risk_frozen_records; PRAGMA user_version = 22;",
    )
    .unwrap();
}

use super::frozen_v1;
use super::risk_promotion_tests::{
    CUTOFF, JournalFile, calc, capture, delete_data, export_archive, restore_archive, seeded,
    without_fees_recorded,
};
use super::tests::db;
use crate::data_controls;

/// The stored text of a calculation (what `explanation_json` holds).
fn stored(c: &Connection, id: &str) -> String {
    c.query_row(
        "SELECT explanation_json FROM account_snapshots WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .unwrap()
}

pub(crate) fn is_compact(c: &Connection, id: &str) -> bool {
    frozen_v1::is_compact(&serde_json::from_str(&stored(c, id)).unwrap())
}

/// `get`, `list` and `latest` all return `expected`, and the decoded row still re-proves its inputs hash
/// (`validate_engine_payload`, which no read path runs).
fn assert_reads(c: &Connection, s: &snapshots::Snapshot, expected: &Value) {
    let got = snapshots::get(c, &s.id).unwrap();
    assert_eq!(&got.explanation, expected);
    assert_eq!(&got, s);
    let listed = snapshots::list(c, &s.account_id, None, None, false).unwrap();
    assert_eq!(listed.iter().find(|x| x.id == s.id), Some(s));
    if let Some(latest) = snapshots::latest(c, &s.account_id).unwrap() {
        assert_eq!(latest, snapshots::get(c, &latest.id).unwrap());
    }
    if s.engine_version.starts_with("fundedflow-risk/") {
        assert!(
            snapshots::engine_payload_valid(&got),
            "inputs hash re-proves"
        );
    }
}

fn frozen_rows(c: &Connection) -> i64 {
    super::risk_promotion_tests::count(c, "risk_frozen_records")
        + super::risk_promotion_tests::count(c, "risk_frozen_spans")
}

/// Real TypeScript output (`engine-contract.json`, canonical inputs from the mapper): every case is stored
/// compact with no fallback and reads back exactly.
#[test]
fn engine_contract_cases_are_stored_compact_and_read_back_exactly() {
    const ACCOUNT: &str = "00000000-0000-4000-8000-000000000001";
    const VERSION: &str = "00000000-0000-4000-8000-000000000020";
    const AT: &str = "2026-10-01T00:00:00.000Z";
    let mut c = db();
    c.execute("INSERT INTO accounts(id,name,account_type,status,currency,starting_balance_micros,timezone,trading_day_reset_time,created_at,updated_at) VALUES(?1,'Synthetic','evaluation','active','USD',50000000000,'America/New_York','17:00',?2,?2)", params![ACCOUNT, AT]).unwrap();
    c.execute("INSERT INTO providers(id,slug,display_name,record_status,created_at,updated_at) VALUES('provider','synthetic','Synthetic','active',?1,?1)", [AT]).unwrap();
    c.execute("INSERT INTO rulebooks(id,provider_id,slug,display_name,record_status,created_at,updated_at) VALUES('book','provider','synthetic','Synthetic','active',?1,?1)", [AT]).unwrap();
    c.execute("INSERT INTO rulebook_versions(id,rulebook_id,version_number,schema_version,verification_status,origin,captured_at,verified_by,verified_at,record_status,created_at,updated_at) VALUES(?1,'book',1,1,'verified','catalogue',?2,'synthetic reviewer',?2,'active',?2,?2)", params![VERSION, AT]).unwrap();
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../../packages/domain/test/fixtures/engine-contract.json"
    ))
    .unwrap();
    assert_eq!(cases.len(), 3);
    for case in cases {
        let input: SnapshotInput = serde_json::from_value(case["snapshot"].clone()).unwrap();
        let fallbacks = frozen_v1::fallback_total();
        let saved = snapshots::save(&mut c, input).unwrap();
        assert_eq!(frozen_v1::fallback_total(), fallbacks, "no fallback");
        assert!(is_compact(&c, &saved.id), "{}", case["name"]);
        assert_reads(&c, &saved, &case["snapshot"]["explanation"]);
    }
}

/// Shapes (i) to (iv), three calculations each: compact, no fallback, exact reads, and every rule's references
/// (result, rule tails, carried breach pointers) rebuilt.
#[test]
fn each_payload_shape_round_trips_compact_with_no_fallback() {
    for shape in [
        Shape::TaskTen,
        Shape::RealEngine,
        Shape::NewTrade,
        Shape::NewSettlement,
    ] {
        let mut c = db();
        let ctx = seeded(&mut c);
        let fallbacks = frozen_v1::fallback_total();
        for k in 0..3 {
            if k > 0 && shape == Shape::NewTrade {
                trades::create(&mut c, synthetic_trade(&ctx.account, k)).unwrap();
            }
            if k > 0 && shape == Shape::NewSettlement {
                evidence::create(&mut c, synthetic_settlement(&ctx.account, "USD", k)).unwrap();
            }
            let cap = capture(&mut c, &ctx.account, CUTOFF);
            let input = shape_input(&cap, shape, true);
            let expected = input.explanation.clone();
            let saved = risk_promotion::promote(&mut c, input).unwrap();
            assert!(is_compact(&c, &saved.id), "{shape:?} {k}");
            assert_reads(&c, &saved, &expected);
            if shape != Shape::TaskTen && k > 0 {
                assert_eq!(
                    expected["policy"]["priorBreaches"]
                        .as_array()
                        .unwrap()
                        .len(),
                    1,
                    "the breach is carried"
                );
                assert!(
                    stored(&c, &saved.id).contains("\"breaches\":"),
                    "as a pointer"
                );
            }
        }
        assert_eq!(
            frozen_v1::fallback_total(),
            fallbacks,
            "{shape:?}: no fallback"
        );
        assert_eq!(
            risk_promotion::current(&mut c, &ctx.account)
                .unwrap()
                .sources_unchanged,
            Some(true)
        );
    }
}

/// A caller payload whose inputs are not canonical (TASK-010's `calc`, inputs as captured) falls back by
/// design: stored byte for byte as before TASK-045, counted once, and read back unchanged.
#[test]
fn a_non_canonical_payload_is_stored_inline_and_reads_back_unchanged() {
    let mut c = db();
    let ctx = seeded(&mut c);
    trades::create(&mut c, synthetic_trade(&ctx.account, 1)).unwrap();
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    let input = calc(&cap, true);
    assert_ne!(
        input.explanation["inputs"],
        canonical(&input.explanation["inputs"])
    );
    let expected = input.explanation.clone();
    let fallbacks = frozen_v1::fallback_total();
    let saved = risk_promotion::promote(&mut c, input).unwrap();
    assert_eq!(frozen_v1::fallback_total(), fallbacks + 1);
    assert_eq!(
        stored(&c, &saved.id),
        serde_json::to_string(&expected).unwrap()
    );
    assert_eq!(frozen_rows(&c), 0, "nothing was written for it");
    assert_reads(&c, &saved, &expected);
}

/// An explanation that itself has a top-level "$ff" key (any caller payload) is wrapped, never read as compact.
#[test]
fn a_caller_explanation_with_the_marker_key_reads_back_unchanged() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let mut input = calc(&capture(&mut c, &ctx.account, CUTOFF), false);
    input.engine_version = "legacy".into();
    input.explanation = json!({ "$ff": "frozen-v1", "explanation": { "note": "caller text" } });
    let saved = snapshots::save(&mut c, input.clone()).unwrap();
    assert_eq!(saved.explanation, input.explanation);
    assert!(stored(&c, &saved.id).contains("\"inline\":"));
}

/// Old values survive edits: an edited trade keeps its old values in the older calculation, and a deleted trade
/// stays in every calculation that used it.
#[test]
fn old_values_survive_edits_and_deletes() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let promote = |c: &mut Connection| {
        let cap = capture(c, &ctx.account, CUTOFF);
        let input = shape_input(&cap, Shape::RealEngine, true);
        let expected = input.explanation.clone();
        let saved = risk_promotion::promote(c, input).unwrap();
        assert!(is_compact(c, &saved.id));
        (saved, expected)
    };
    let price = |s: &snapshots::Snapshot| -> Vec<Value> {
        s.explanation["inputs"]["trades"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["exitPrice"].clone())
            .collect()
    };
    let (first, first_expected) = promote(&mut c);
    let original = serde_json::to_value(trades::get(&c, &ctx.trade).unwrap()).unwrap();
    trades::update(
        &mut c,
        &ctx.trade,
        TradeInput {
            exit_price: Some("5010.75".into()),
            ..super::tests::trade_input(&ctx.account)
        },
    )
    .unwrap();
    let (second, second_expected) = promote(&mut c);
    trades::delete(&mut c, &ctx.trade).unwrap();
    let (third, third_expected) = promote(&mut c);
    for (s, expected) in [
        (&first, &first_expected),
        (&second, &second_expected),
        (&third, &third_expected),
    ] {
        assert_reads(&c, s, expected);
    }
    let first = snapshots::get(&c, &first.id).unwrap();
    let second = snapshots::get(&c, &second.id).unwrap();
    let third = snapshots::get(&c, &third.id).unwrap();
    assert_eq!(price(&first), vec![original["exitPrice"].clone()]);
    assert_ne!(
        price(&first),
        price(&second),
        "the edit is not in calculation 1"
    );
    assert!(price(&third).is_empty(), "the deleted trade left the list");
    assert_eq!(
        first.explanation["inputs"]["trades"][0]["id"],
        json!(ctx.trade),
        "and stays in the calculations that used it"
    );
    assert_eq!(
        second.explanation["inputs"]["trades"][0]["id"],
        json!(ctx.trade)
    );
}

/// Stale and fresh saves of `save_account_snapshot` alternate generations. Every row decodes exactly; growth is
/// recorded, not bounded (the spec's stated exception).
#[test]
fn alternating_stale_and_fresh_saves_decode_exactly() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let stale = shape_input(&capture(&mut c, &ctx.account, CUTOFF), Shape::TaskTen, true);
    trades::create(&mut c, synthetic_trade(&ctx.account, 1)).unwrap();
    let fresh = shape_input(&capture(&mut c, &ctx.account, CUTOFF), Shape::TaskTen, true);
    let mut saved = Vec::new();
    let mut growth = Vec::new();
    for i in 0..6 {
        let input = if i % 2 == 0 {
            stale.clone()
        } else {
            fresh.clone()
        };
        let expected = input.explanation.clone();
        saved.push((snapshots::save(&mut c, input).unwrap(), expected));
        growth.push(frozen_rows(&c));
    }
    for (s, expected) in &saved {
        assert!(is_compact(&c, &s.id));
        assert_reads(&c, s, expected);
    }
    println!("frozen rows after each alternating save: {growth:?}");
    // Each return to the fresh list reopens the new trade's span (a stale save only closes it): growth with the
    // number of switches, not bounded.
    assert!(growth.windows(2).all(|w| w[1] >= w[0]));
    assert_eq!(
        growth[5] - growth[1],
        2,
        "one span per return to the fresh list"
    );
}

/// A list holding the same record twice, and a record version that leaves a list and comes back, decode exactly.
#[test]
fn duplicates_and_reentry_decode_exactly() {
    let mut c = db();
    let ctx = seeded(&mut c);
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    assert_eq!(cap.inputs["ledger"].as_array().unwrap().len(), 1);
    let variant = |trades_twice: bool, with_ledger: bool| {
        let mut cap = cap.clone();
        if trades_twice {
            let t = cap.inputs["trades"][0].clone();
            cap.inputs["trades"] = json!([t, t]);
        }
        if !with_ledger {
            cap.inputs["ledger"] = json!([]);
        }
        shape_input(&cap, Shape::TaskTen, true)
    };
    let mut saved = Vec::new();
    for input in [
        variant(false, true),
        variant(true, false),
        variant(false, true),
    ] {
        let expected = input.explanation.clone();
        saved.push((snapshots::save(&mut c, input).unwrap(), expected));
    }
    for (s, expected) in &saved {
        assert!(is_compact(&c, &s.id));
        assert_reads(&c, s, expected);
    }
    assert_eq!(saved[1].1["inputs"]["trades"].as_array().unwrap().len(), 2);
    let twice: i64 = c
        .query_row(
            "SELECT count(*) FROM risk_frozen_spans WHERE kind = 'trades' AND multiplicity = 2",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(twice, 1, "a duplicate is a multiplicity");
    let reentered: i64 = c
        .query_row(
            "SELECT count(DISTINCT from_generation) FROM risk_frozen_spans WHERE kind = 'ledger'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(reentered, 2, "the returning ledger entry gets a new span");
}

/// The `frozen-v1` bytes never change once shipped (migration 23 calls this encoder).
#[test]
fn golden_frozen_v1_encoding() {
    const ACCOUNT: &str = "00000000-0000-4000-8000-0000000000a9";
    const SOURCE_CALC: &str = "00000000-0000-4000-8000-0000000000f1";
    let c = db();
    c.execute("INSERT INTO accounts(id,name,account_type,status,currency,starting_balance_micros,timezone,trading_day_reset_time,created_at,updated_at) VALUES(?1,'Golden','evaluation','active','USD',50000000000,'America/New_York','17:00','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')", [ACCOUNT]).unwrap();
    let breach_source = json!({ "engine": { "assignmentId": "as1", "asOf": "2026-10-19T20:00:00.000Z", "rulebookVersionId": "v1",
        "rules": [{ "ruleId": "rule9", "ruleKey": "daily_loss", "state": "breached", "sourceReferences": ["x2", "x1"] }] },
        "inputs": {}, "policy": {} });
    c.execute("INSERT INTO account_snapshots(id,account_id,trading_day,is_end_of_day,data_source,calculated_at,engine_version,inputs_hash,status,explanation_json) VALUES(?1,?2,'2026-10-19',0,'manual','2026-10-19T20:00:00.000Z','fundedflow-risk/1','h','stop',?3)",
        params![SOURCE_CALC, ACCOUNT, breach_source.to_string()]).unwrap();
    let inputs = canonical(
        &json!({ "schemaVersion": 1, "account": { "id": ACCOUNT }, "asOf": "2026-10-20T20:00:00.000Z",
        "observations": [{ "id": "o1", "sourceReference": "dash", "kind": "eod_settlement" }, { "id": "o2", "sourceReference": "dash", "kind": "balance" }],
        "trades": [{ "id": "t1", "importBatchId": null }, { "id": "t2", "importBatchId": "b1" }, { "id": "t2", "importBatchId": "b1" }],
        "ledger": [], "ledgerHistory": [], "phaseHistory": [{ "id": "p1" }], "assignments": [{ "id": "as1" }],
        "rulebookVersions": [{ "version": { "id": "v1" } }], "coverage": { "fees": "available" }, "missingInputs": [] }),
    );
    let policy = canonical(
        &json!({ "reconciliationRevisionIds": ["r1"], "priorBreaches": [{ "accountId": ACCOUNT, "assignmentId": "as1",
        "observedAt": "2026-10-19T20:00:00.000Z", "ruleKey": "daily_loss", "rulebookVersionId": "v1", "sourceReferences": ["x1", "x2"] }] }),
    );
    let refs = ["b1", "dash", "o1", "o2", "p1", "r1", "t1", "t2"];
    let explanation = json!({ "engine": { "sourceReferences": refs, "rules": [{ "ruleId": "rule1", "ruleKey": "daily_loss", "state": "breached",
        "sourceReferences": ["b1", "c1", "dash", "o1", "o2", "p1", "r1", "t1", "t2", "o1", "target"] }] },
        "inputs": inputs, "policy": policy, "recalculation": "golden" });
    let encoded = frozen_v1::encode(&c, ACCOUNT, "fundedflow-risk/1", &explanation, None).unwrap();
    assert_eq!(encoded.fallbacks, 0);
    let rows: Vec<String> = c
        .prepare("SELECT s.kind || '|' || s.record_hash || '|' || s.from_generation || '|' || coalesce(s.to_generation, '-') || '|' || s.multiplicity || '|' || r.record_json
                  FROM risk_frozen_spans s JOIN risk_frozen_records r USING (account_id, kind, record_hash) ORDER BY 1")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(encoded.text, GOLDEN_TEXT);
    assert_eq!(rows, GOLDEN_ROWS);
    let decoded = frozen_v1::Decoder::new(&c)
        .decode(ACCOUNT, serde_json::from_str(&encoded.text).unwrap())
        .unwrap();
    assert_eq!(decoded, explanation);
}

const GOLDEN_TEXT: &str = r#"{"$ff":"frozen-v1","breaches":[[0,"00000000-0000-4000-8000-0000000000f1","rule9"]],"explanation":{"engine":{"rules":[{"ruleId":"rule1","ruleKey":"daily_loss","state":"breached"}]},"inputs":{"account":{"id":"00000000-0000-4000-8000-0000000000a9"},"asOf":"2026-10-20T20:00:00.000Z","coverage":{"fees":"available"},"missingInputs":[],"schemaVersion":1},"policy":{"priorBreaches":[{"accountId":"00000000-0000-4000-8000-0000000000a9","assignmentId":"as1","observedAt":"2026-10-19T20:00:00.000Z","ruleKey":"daily_loss","rulebookVersionId":"v1"}],"reconciliationRevisionIds":["r1"]},"recalculation":"golden"},"generation":1,"lists":["assignments","ledger","ledgerHistory","observations","phaseHistory","rulebookVersions","trades"],"refs":true,"rules":[[0,["c1"],[0,"target"]]]}"#;
const GOLDEN_ROWS: &[&str] = &[
    r#"assignments|96a8c1e14f6983b78cc46c9e3c506280a162b02c8f1b2725b9bfc87ada32c14b|1|-|1|{"id":"as1"}"#,
    r#"observations|6e1ef4a3d6dd1920e825f4d15411a4df5bc1a0b5e363207003bb0bc4ea4fae4c|1|-|1|{"id":"o2","kind":"balance","sourceReference":"dash"}"#,
    r#"observations|ebb0c45e529a148d27a7fa91ce9f7582cfde82aaa7e16655e70ac14068c74399|1|-|1|{"id":"o1","kind":"eod_settlement","sourceReference":"dash"}"#,
    r#"phaseHistory|5c5216011e5e4c3df866eeb887c1ee57e37fc2c98a375748042d134f0dc4d5a0|1|-|1|{"id":"p1"}"#,
    r#"rulebookVersions|e2bf9fa8c9af93895351272663d186f9e68978a394fba5d3812614e925b8ce50|1|-|1|{"version":{"id":"v1"}}"#,
    r#"trades|1ba68001e7709cdcb452c6fe2d7f1ab6f6712dc0af5b1a833c8960130c627c83|1|-|1|{"id":"t1","importBatchId":null}"#,
    r#"trades|f6af0486eb6093354827921c3121f4486dc427316a1c1e9add658b35b35286be|1|-|2|{"id":"t2","importBatchId":"b1"}"#,
];

/// Fast regression for the bounded-growth target: shape (ii) at N = 50 and N = 400, K = 10. Explanation bytes and
/// new-table rows added per calculation are exactly equal, and within the shape (ii) bound.
#[test]
fn shape_ii_growth_does_not_depend_on_the_number_of_trades() {
    let per_n = |n: usize| {
        let mut c = db();
        let ctx = seeded(&mut c);
        let m = run_shape(&mut c, &ctx.account, Shape::RealEngine, n, &[1, 10], None);
        assert_eq!(m[2].fallbacks, m[0].fallbacks, "no fallback");
        (
            m[2].explanation_bytes - m[0].explanation_bytes,
            m[2].frozen_rows - m[1].frozen_rows,
        )
    };
    let (small, large) = (per_n(50), per_n(400));
    println!("N=50: {small:?}; N=400: {large:?}");
    assert_eq!(small.0, large.0, "explanation bytes over 10 calculations");
    assert_eq!(
        small.1, large.1,
        "new-table rows after the first calculation"
    );
    assert_eq!(small.1, 0, "unchanged sources add no rows");
    assert!(small.0 / 10 <= 16 * 1024);
}

/// Account deletion previews and removes the account's frozen records and spans; the other account keeps its own.
/// Whole-journal erase removes them all. `PRAGMA foreign_key_check` stays clean.
#[test]
fn account_deletion_and_erase_count_and_remove_frozen_sources() {
    let root = tempfile::tempdir().unwrap();
    let mut c = db();
    let ctx = seeded(&mut c);
    let doomed = super::accounts::create(&mut c, super::tests::account_input("Eval C"))
        .unwrap()
        .id;
    trades::create(&mut c, super::tests::trade_input(&doomed)).unwrap();
    for account in [&doomed, &ctx.other] {
        let cap = capture(&mut c, account, CUTOFF);
        risk_promotion::promote(&mut c, shape_input(&cap, Shape::TaskTen, true)).unwrap();
    }
    let rows = |c: &Connection, table: &str, account: &str| -> i64 {
        c.query_row(
            &format!("SELECT count(*) FROM {table} WHERE account_id = ?1"),
            [account],
            |r| r.get(0),
        )
        .unwrap()
    };
    let (records, spans) = (
        rows(&c, "risk_frozen_records", &doomed),
        rows(&c, "risk_frozen_spans", &doomed),
    );
    let kept = (
        rows(&c, "risk_frozen_records", &ctx.other),
        rows(&c, "risk_frozen_spans", &ctx.other),
    );
    assert!(records > 0 && spans > 0 && kept.0 > 0);
    let scope = json!({ "kind": "account", "accountId": doomed });
    let preview = data_controls::preview_deletion(
        &c,
        root.path(),
        serde_json::from_value(json!({ "scope": scope })).unwrap(),
    )
    .unwrap();
    assert_eq!(
        preview.affected_entities["risk_frozen_records"],
        records as u64
    );
    assert_eq!(preview.affected_entities["risk_frozen_spans"], spans as u64);
    delete_data(&mut c, root.path(), scope);
    assert_eq!(rows(&c, "risk_frozen_records", &doomed), 0);
    assert_eq!(rows(&c, "risk_frozen_spans", &doomed), 0);
    assert_eq!(
        (
            rows(&c, "risk_frozen_records", &ctx.other),
            rows(&c, "risk_frozen_spans", &ctx.other)
        ),
        kept
    );
    assert!(
        !c.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap()
    );
    let erase = data_controls::preview_deletion(
        &c,
        root.path(),
        serde_json::from_value(json!({ "scope": { "kind": "journal" } })).unwrap(),
    )
    .unwrap();
    assert_eq!(
        erase.affected_entities["risk_frozen_records"],
        kept.0 as u64
    );
    assert_eq!(erase.affected_entities["risk_frozen_spans"], kept.1 as u64);
    delete_data(&mut c, root.path(), json!({ "kind": "journal" }));
    assert_eq!(frozen_rows(&c), 0);
    assert!(
        !c.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap()
    );
}

type Observed = (Vec<snapshots::Snapshot>, Vec<Option<bool>>, Value, String);

/// Everything a reader can observe about an account's calculations: every DTO, each one's freshness, the current
/// result and a fresh capture's fingerprint (which covers `prior_breaches`).
fn observed(c: &mut Connection, account: &str) -> Observed {
    let list = snapshots::list(c, account, None, None, false).unwrap();
    let fresh = list
        .iter()
        .map(|s| {
            risk_promotion::freshness(c, &s.id)
                .unwrap()
                .sources_unchanged
        })
        .collect();
    let current = risk_promotion::current(c, account).unwrap();
    let current = json!([
        current.snapshot.map(|s| s.id),
        current.sources_unchanged,
        current.promoted_at
    ]);
    let print = capture(c, account, CUTOFF).source_fingerprint;
    (list, fresh, current, print)
}

/// A journal at schema 22 (calculations inline, no frozen tables) holding a non-canonical calculation and shapes
/// (i) and (ii) twice (the second carries the first's breach), with `n` trades on the account.
fn schema_22_journal(file: &JournalFile, n: usize) -> (String, Vec<String>, Vec<String>) {
    let mut c = file.open();
    let ctx = seeded(&mut c);
    for i in 1..n {
        trades::create(&mut c, synthetic_trade(&ctx.account, i)).unwrap();
    }
    let cap = capture(&mut c, &ctx.account, CUTOFF);
    let inline = vec![snapshots::save(&mut c, calc(&cap, false)).unwrap().id];
    let mut eligible = Vec::new();
    for shape in [Shape::TaskTen, Shape::RealEngine, Shape::RealEngine] {
        let cap = capture(&mut c, &ctx.account, CUTOFF);
        eligible.push(
            risk_promotion::promote(&mut c, shape_input(&cap, shape, true))
                .unwrap()
                .id,
        );
    }
    before_migration_23(&c);
    (ctx.account, eligible, inline)
}

/// A journal file at the latest schema whose calculations are compact: two shape (ii) calculations of one
/// account (the second points at the first's breach) and a shape (i) calculation of another. Returns the second
/// calculation's id and the other account's calculation id (for the archive integrity tests).
pub(crate) fn compact_journal(path: &Path) -> (String, String) {
    let mut c = crate::db::open_file(path).unwrap();
    let ctx = seeded(&mut c);
    let mut promote = |account: &str, shape| {
        let cap = capture(&mut c, account, CUTOFF);
        risk_promotion::promote(&mut c, shape_input(&cap, shape, true))
            .unwrap()
            .id
    };
    promote(&ctx.account, Shape::RealEngine);
    let pointer = promote(&ctx.account, Shape::RealEngine);
    let other = promote(&ctx.other, Shape::TaskTen);
    assert!(stored(&c, &pointer).contains("\"breaches\":"));
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    (pointer, other)
}

fn folder_bytes(dir: &Path) -> u64 {
    let mut total = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let meta = entry.metadata().unwrap();
        total += if meta.is_dir() {
            folder_bytes(&entry.path())
        } else {
            meta.len()
        };
    }
    total
}

/// Migration 23 on a large schema-22 journal, in two processes so the second one's peak memory is the upgrade's
/// alone: `FF_UPGRADE_PHASE=build` writes the journal (`FF_UPGRADE_RUN=shape:N:K`, default `ii:2000:50`) into
/// `FF_UPGRADE_DIR`, then `FF_UPGRADE_PHASE=migrate` opens it (backup, migration 23) and prints the time. Needs
/// `FF_GROWTH_SEED_DB` for the build phase.
#[test]
#[ignore = "upgrade timing: needs FF_UPGRADE_PHASE, FF_UPGRADE_DIR and a seed"]
fn frozen_v1_upgrade_timing() {
    let dir = std::path::PathBuf::from(std::env::var("FF_UPGRADE_DIR").unwrap());
    let run = std::env::var("FF_UPGRADE_RUN").unwrap_or_else(|_| "ii:2000:50".into());
    let parts: Vec<&str> = run.split(':').collect();
    let (shape, n, k) = (
        Shape::parse(parts[0]),
        parts[1].parse::<usize>().unwrap(),
        parts[2].parse::<usize>().unwrap(),
    );
    let path = dir.join(crate::db::DB_FILE_NAME);
    match std::env::var("FF_UPGRADE_PHASE").unwrap().as_str() {
        "build" => {
            let seed = std::path::PathBuf::from(std::env::var("FF_GROWTH_SEED_DB").unwrap());
            schema_22_seeded(&seed, &dir, shape, n, k);
            let c = Connection::open(&path).unwrap();
            let text: i64 = c
                .query_row(
                    "SELECT sum(length(CAST(explanation_json AS BLOB))) FROM account_snapshots",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            println!(
                "built {run} at schema 22: {} bytes, explanation_json {text} bytes",
                std::fs::metadata(&path).unwrap().len()
            );
        }
        _ => {
            let t = Instant::now();
            let c = crate::db::open_file(&path).unwrap();
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            let fallbacks = fallbacks();
            let compact: i64 = c
                .query_row(
                    "SELECT count(*) FROM account_snapshots WHERE json_extract(explanation_json, '$.\"$ff\"') IS NOT NULL",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let breaches: i64 = c
                .query_row(
                    "SELECT count(*) FROM account_snapshots WHERE json_extract(explanation_json, '$.breaches') IS NOT NULL",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            println!(
                "migrated {run}: open + backup + migration 23 {ms:.1} ms; {compact} compact rows, {breaches} with breach pointers, {fallbacks} fallbacks"
            );
        }
    }
}

/// Copies the seed, tops its busiest account up to `n` trades, stores `k` calculations of `shape` and turns the
/// journal back into schema 22 (inline rows, as a pre-TASK-045 build stored them).
fn schema_22_seeded(seed: &Path, root: &Path, shape: Shape, n: usize, k: usize) -> String {
    std::fs::create_dir_all(root).unwrap();
    std::fs::copy(seed, root.join(crate::db::DB_FILE_NAME)).unwrap();
    let mut c = crate::db::open_file(&root.join(crate::db::DB_FILE_NAME)).unwrap();
    let account: String = c
        .query_row(
            "SELECT a.id FROM accounts a WHERE a.archived_at IS NULL ORDER BY
               (SELECT count(*) FROM trades t WHERE t.account_id = a.id AND t.deleted_at IS NULL) DESC, a.id LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    run_shape(&mut c, &account, shape, n, &[k], None);
    before_migration_23(&c);
    c.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    account
}

/// The upgrade and restore-cost harness (acceptance criteria "Old-journal upgrade" and "Restore cost"), on the same
/// seed as the growth harness: `FF_GROWTH_SEED_DB=<seed> cargo test --offline --locked --release --lib
/// frozen_v1_upgrade_harness -- --ignored --nocapture`. Disposable temporary folders only.
#[test]
#[ignore = "upgrade harness: needs a seeded stress journal (FF_GROWTH_SEED_DB)"]
fn frozen_v1_upgrade_harness() {
    let seed = std::path::PathBuf::from(std::env::var("FF_GROWTH_SEED_DB").unwrap());
    let export = |c: &Connection, root: &Path, out: &Path| {
        crate::data_controls::export_journal(
            c,
            root,
            crate::data_controls::ExportRequest {
                destination: out.to_string_lossy().into(),
                acknowledge_plaintext: true,
            },
        )
    };
    let data_json = |zip: &Path| {
        zip::ZipArchive::new(std::fs::File::open(zip).unwrap())
            .unwrap()
            .by_name("data.json")
            .unwrap()
            .size()
    };
    // 1. N = 2,000, K = 50, shape (i): over the 64 MiB cap at schema 22; exports after the upgrade.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("big");
    schema_22_seeded(&seed, &root, Shape::TaskTen, 2000, 50);
    {
        let c = Connection::open(root.join(crate::db::DB_FILE_NAME)).unwrap();
        let used: i64 = c
            .query_row("SELECT (SELECT page_count FROM pragma_page_count()) - (SELECT freelist_count FROM pragma_freelist_count())", [], |r| r.get(0))
            .unwrap();
        let refused = export(&c, &root, &dir.path().join("v22.zip"));
        println!(
            "schema 22: used pages {} bytes; export: {:?}",
            used * 4096,
            refused.as_ref().err()
        );
        assert!(refused.is_err(), "over the cap before the upgrade");
    }
    let t = Instant::now();
    let c = crate::db::open_file(&root.join(crate::db::DB_FILE_NAME)).unwrap();
    println!(
        "open + migrate to 23: {:.1} ms",
        t.elapsed().as_secs_f64() * 1000.0
    );
    let out = dir.path().join("v23.zip");
    export(&c, &root, &out).unwrap();
    println!(
        "schema 23 export succeeded; data.json {} bytes",
        data_json(&out)
    );
    drop(c);
    drop(dir);

    // 2. Restore cost: the largest schema-22 journal of this kind that still exports (K = 45), restored over a
    //    fresh journal. Inspect and prepare each migrate a candidate; the peak is mirrored step by step.
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    schema_22_seeded(&seed, &source, Shape::TaskTen, 2000, 45);
    let archive = dir.path().join("v22.zip");
    {
        let c = Connection::open(source.join(crate::db::DB_FILE_NAME)).unwrap();
        export(&c, &source, &archive).unwrap();
    }
    println!(
        "schema 22 archive: {} bytes, data.json {} bytes",
        std::fs::metadata(&archive).unwrap().len(),
        data_json(&archive)
    );
    let live_root = dir.path().join("live");
    let live = crate::db::open_file(&live_root.join(crate::db::DB_FILE_NAME)).unwrap();
    let t = Instant::now();
    let preview = crate::data_controls::inspect_restore(
        &live,
        &live_root,
        crate::data_controls::InspectRequest {
            source: archive.to_string_lossy().into(),
        },
    )
    .unwrap();
    println!(
        "inspect: {:.1} ms; required_free_bytes {}",
        t.elapsed().as_secs_f64() * 1000.0,
        preview.required_free_bytes
    );
    let t = Instant::now();
    crate::data_controls::prepare_restore(
        &live,
        &live_root,
        crate::data_controls::RestoreRequest {
            source: archive.to_string_lossy().into(),
            preview_token: preview.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        },
    )
    .unwrap();
    println!("prepare: {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);
    // The mirror: extract the archive as staging does, then migrate a candidate (with its before-v23 copy and WAL)
    // and total every file present at that moment.
    let extract = |into: &Path| {
        std::fs::create_dir_all(into).unwrap();
        let mut z = zip::ZipArchive::new(std::fs::File::open(&archive).unwrap()).unwrap();
        for i in 0..z.len() {
            let mut e = z.by_index(i).unwrap();
            let path = into.join(e.name().unwrap().as_ref());
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::io::copy(&mut e, &mut std::fs::File::create(path).unwrap()).unwrap();
        }
    };
    let mirror = dir.path().join("mirror");
    let inspect_stage = mirror.join("inspect");
    extract(&inspect_stage);
    let t = Instant::now();
    let candidate =
        crate::db::open_restore_candidate(&inspect_stage.join("journal.sqlite")).unwrap();
    let inspect_ms = t.elapsed().as_secs_f64() * 1000.0;
    let inspect_peak = folder_bytes(&mirror);
    drop(candidate);
    std::fs::remove_dir_all(&inspect_stage).unwrap();
    let prepare_stage = mirror.join("prepare-stage");
    extract(&prepare_stage);
    let op = mirror.join("operation");
    std::fs::create_dir_all(&op).unwrap();
    std::fs::copy(
        prepare_stage.join("journal.sqlite"),
        op.join("candidate.db"),
    )
    .unwrap();
    let t = Instant::now();
    let candidate = crate::db::open_restore_candidate(&op.join("candidate.db")).unwrap();
    let prepare_ms = t.elapsed().as_secs_f64() * 1000.0;
    let prepare_peak = folder_bytes(&mirror);
    drop(candidate);
    println!(
        "mirror: inspect migrate {inspect_ms:.1} ms, peak {inspect_peak} bytes; prepare migrate {prepare_ms:.1} ms, peak {prepare_peak} bytes; required_free_bytes {}",
        preview.required_free_bytes
    );
    assert!(inspect_peak <= preview.required_free_bytes);
    assert!(prepare_peak <= preview.required_free_bytes);
}

/// Opens a journal file without migrating it.
fn raw(file: &JournalFile) -> Connection {
    let c = Connection::open(file.0.join(crate::db::DB_FILE_NAME)).unwrap();
    crate::db::configure(&c).unwrap();
    c
}

/// The migration 23 upgrade: every DTO, freshness, the current result and the capture fingerprint are unchanged;
/// eligible rows shrink by at least 90% in total and the non-canonical row is byte-identical.
#[test]
fn migration_23_compacts_eligible_calculations_and_changes_nothing_observable() {
    let file = JournalFile::new();
    let (account, eligible, inline) = schema_22_journal(&file, 300);
    let (before, texts, inline_text);
    {
        let mut c = raw(&file);
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            22
        );
        texts = eligible
            .iter()
            .map(|id| stored(&c, id).len())
            .sum::<usize>();
        inline_text = stored(&c, &inline[0]);
        assert!(eligible.iter().chain(&inline).all(|id| !is_compact(&c, id)));
        // Reads at schema 22 run with this build's store code; inline rows pass through the decoder unchanged.
        before = observed(&mut c, &account);
    }
    let mut c = file.open();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        23
    );
    assert!(eligible.iter().all(|id| is_compact(&c, id)));
    let after_texts = eligible
        .iter()
        .map(|id| stored(&c, id).len())
        .sum::<usize>();
    println!("eligible explanation_json: {texts} -> {after_texts} bytes");
    assert!(after_texts * 10 <= texts, "at least 90% smaller");
    assert_eq!(stored(&c, &inline[0]), inline_text, "byte-identical");
    assert_eq!(observed(&mut c, &account), before);
    for s in &before.0 {
        assert!(snapshots::engine_payload_valid(
            &snapshots::get(&c, &s.id).unwrap()
        ));
    }
    // Idempotent: running the data step again changes nothing.
    let texts_now: Vec<String> = before.0.iter().map(|s| stored(&c, &s.id)).collect();
    let rows = frozen_rows(&c);
    {
        let tx = c.transaction().unwrap();
        frozen_v1::backfill(&tx, false).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(
        before
            .0
            .iter()
            .map(|s| stored(&c, &s.id))
            .collect::<Vec<_>>(),
        texts_now
    );
    assert_eq!(frozen_rows(&c), rows);
}

/// Before migration 23 nothing is encoded, so the migration wraps every pre-existing explanation with a top-level
/// "$ff" key, including one shaped exactly like the compact form; each reads back unchanged.
#[test]
fn migration_23_wraps_pre_existing_marker_keys() {
    let file = JournalFile::new();
    let originals = [
        json!({ "$ff": 1 }),
        json!({ "$ff": "frozen-v1", "explanation": { "note": "caller text" } }),
        json!({ "$ff": "frozen-v1", "inline": { "note": "caller text" } }),
    ];
    let mut ids = Vec::new();
    {
        let mut c = file.open();
        let ctx = seeded(&mut c);
        before_migration_23(&c);
        for (i, explanation) in originals.iter().enumerate() {
            let id = format!("00000000-0000-4000-8000-00000000ff0{i}");
            c.execute(
                "INSERT INTO account_snapshots(id,account_id,trading_day,is_end_of_day,data_source,calculated_at,engine_version,inputs_hash,status,status_reasons_json,explanation_json)
                 VALUES(?1,?2,'2026-10-19',0,'manual','2026-10-19T20:00:00.000Z','legacy','h','unknown','[\"caller\"]',?3)",
                params![id, ctx.account, explanation.to_string()],
            )
            .unwrap();
            ids.push(id);
        }
    }
    let c = file.open();
    for (id, original) in ids.iter().zip(&originals) {
        assert_eq!(&snapshots::get(&c, id).unwrap().explanation, original);
        assert!(stored(&c, id).starts_with(r#"{"$ff":"frozen-v1","inline":"#));
    }
}

/// Reading many calculations rebuilds a list only when it changed: with one new settlement per calculation
/// (shape iv), listing rebuilds `observations` per calculation but `trades` once, and a decoder never keeps more
/// than `LIST_CACHE` lists (`verify` reads every calculation of a journal with one).
#[test]
fn reading_calculations_rebuilds_only_the_lists_that_changed() {
    const K: usize = frozen_v1::LIST_CACHE + 4;
    let mut c = db();
    let ctx = seeded(&mut c);
    let mut ids = Vec::new();
    for k in 0..K {
        if k > 0 {
            evidence::create(&mut c, synthetic_settlement(&ctx.account, "USD", k)).unwrap();
        }
        let cap = capture(&mut c, &ctx.account, CUTOFF);
        let input = shape_input(&cap, Shape::NewSettlement, true);
        ids.push(risk_promotion::promote(&mut c, input).unwrap().id);
    }
    assert!(ids.iter().all(|id| is_compact(&c, id)));
    let (trades, observations) = (
        frozen_v1::list_builds("trades"),
        frozen_v1::list_builds("observations"),
    );
    let listed = snapshots::list(&c, &ctx.account, None, None, false).unwrap();
    assert_eq!(listed.len(), K);
    assert_eq!(
        frozen_v1::list_builds("trades") - trades,
        1,
        "trades unchanged"
    );
    assert_eq!(
        frozen_v1::list_builds("observations") - observations,
        K as u64,
        "one observations list per calculation"
    );
    let mut decoder = frozen_v1::Decoder::new(&c);
    for id in &ids {
        decoder
            .decode(&ctx.account, serde_json::from_str(&stored(&c, id)).unwrap())
            .unwrap();
        assert!(decoder.cached_lists() <= frozen_v1::LIST_CACHE);
    }
    assert!(frozen_v1::verify(&c).unwrap());
}

/// Migration 23 finds each carried breach's source among the earlier calculations of the same cutoff,
/// assignment and rulebook version, newest first, so each lookup parses one row instead of every calculation.
#[test]
fn migration_23_parses_one_candidate_per_carried_breach() {
    const K: usize = 6;
    let file = JournalFile::new();
    let ids: Vec<String> = {
        let mut c = file.open();
        let ctx = seeded(&mut c);
        let ids = (0..K)
            .map(|_| {
                let cap = capture(&mut c, &ctx.account, CUTOFF);
                risk_promotion::promote(&mut c, shape_input(&cap, Shape::RealEngine, true))
                    .unwrap()
                    .id
            })
            .collect();
        before_migration_23(&c);
        ids
    };
    let before = frozen_v1::breach_candidates();
    let c = file.open();
    assert_eq!(
        frozen_v1::breach_candidates() - before,
        (K - 1) as u64,
        "one candidate per carried breach"
    );
    let position = |id: &str| -> (String, String) {
        c.query_row(
            "SELECT calculated_at, id FROM account_snapshots WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    };
    let mut pointers = 0;
    for id in &ids {
        let raw: Value = serde_json::from_str(&stored(&c, id)).unwrap();
        for b in raw["breaches"].as_array().into_iter().flatten() {
            let target = b[1].as_str().unwrap();
            assert!(position(target) < position(id), "an earlier calculation");
            pointers += 1;
        }
    }
    assert_eq!(pointers, K - 1);
}

/// Archive round trips: a schema-23 export restores with equal DTOs; schema-22 and schema-21 archives with inline
/// rows inspect at their own version and restore, migrated and compacted, with equal DTOs.
#[test]
fn archives_of_schema_21_22_and_23_restore_with_equal_calculations() {
    for version in [23u32, 22, 21] {
        let file = JournalFile::new();
        let archives = tempfile::tempdir().unwrap();
        let (account, eligible, _) = schema_22_journal(&file, 20);
        let before = observed(&mut raw(&file), &account);
        if version == 21 {
            without_fees_recorded(&raw(&file), 21);
        }
        let archive = archives.path().join("journal.zip");
        {
            let c = if version == 23 {
                file.open()
            } else {
                raw(&file)
            };
            export_archive(&c, &file, &archive);
        }
        let mut entries = zip::ZipArchive::new(std::fs::File::open(&archive).unwrap()).unwrap();
        let manifest: Value =
            serde_json::from_reader(entries.by_name("manifest.json").unwrap()).unwrap();
        assert_eq!(manifest["schemaVersion"], json!(version));
        // Restore over a different, fresh journal.
        let target = JournalFile::new();
        let c = target.open();
        let mut c = restore_archive(c, &target, &archive);
        assert!(eligible.iter().all(|id| is_compact(&c, id)), "v{version}");
        assert_eq!(observed(&mut c, &account), before, "v{version}");
    }
}
