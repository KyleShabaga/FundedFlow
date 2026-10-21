//! Command payloads exactly as the frontend receives them over Tauri IPC.
//!
//! Every read command is a thin `db.with(|c| store::…)` wrapper, so serialising
//! the store results gives the wire JSON. This test records those payloads for
//! a fresh journal that exercises every frontend view model, and for the real
//! v3 and v4 journals after upgrade, into
//! `apps/desktop/src/test/fixtures/command-wire.json`. The desktop test
//! `features/shared/wire-contract.test.ts` then runs every record through the
//! Build 14 view-model mappers, so a Rust payload change that the frontend
//! would reject fails a test instead of a screen.
//!
//! Generated ids and "now" timestamps are replaced with stable placeholders
//! (consistently, so cross-references still match). A plain `cargo test`
//! checks the file; after an intentional change run
//!
//! ```text
//! FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --lib wire_contract
//! ```
//!
//! and review the diff.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::{from_value, json, Value};

use crate::csv_import;
use crate::db::open_file;
use crate::store::tests::db;
use crate::store::{accounts, attempts, daily_reviews, insights, journal, ledger, settings, snapshots, trades};

const V3: &[u8] = include_bytes!("db/fixtures/fundedflow-v3.db");
const V4: &[u8] = include_bytes!("db/fixtures/fundedflow-v4.db");

/// Imports with duplicates and one unparseable price, so problem rows exist.
const CSV: &str = "symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
MNQZ6,-2,0,0.25,900000000001,900000000002,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,33sec
MNQZ6,-2,0,0.25,900000000003,900000000004,2,29800.00,29790.50,$(38.00),10/16/2026 17:10:00,10/16/2026 17:20:00,10min
MNQZ6,-2,0,0.25,900000000001,900000000002,1,29774.25,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,33sec
MNQZ6,-2,0,0.25,900000000007,900000000008,1,abc,29787.25,$26.00,10/19/2026 07:47:48,10/19/2026 07:48:21,33sec
";

const PLACEHOLDER_INSTANT: &str = "2026-01-01T00:00:00.000Z";
/// "Now" for daily-review reads and writes, so the current trading day and plan timing are stable.
fn review_now() -> chrono::DateTime<chrono::Utc> {
    "2026-10-20T15:00:00Z".parse().unwrap()
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/test/fixtures/command-wire.json")
}

fn wire<T: Serialize>(value: T) -> Value {
    serde_json::to_value(value).unwrap()
}

/// Every read payload a screen can request, per account, as the commands return them.
fn payloads(conn: &mut Connection) -> Value {
    let accounts = accounts::list_with(conn, true).unwrap();
    let per_account: Vec<Value> = accounts
        .iter()
        .map(|a| {
            let batches = csv_import::list_batches(conn, &a.id).unwrap();
            let problem_rows: Vec<Value> = batches
                .iter()
                .map(|b| json!({ "batchId": b.id, "rows": wire(csv_import::list_problem_rows(conn, &b.id).unwrap()) }))
                .collect();
            let reviews = daily_reviews::list_at(conn, &a.id, review_now()).unwrap();
            let days: Vec<Value> = reviews
                .reviews
                .iter()
                .map(|r| wire(daily_reviews::get_day_at(conn, &a.id, &r.trading_day, review_now()).unwrap()))
                .collect();
            json!({
                "accountId": a.id,
                "history": wire(accounts::history(conn, &a.id).unwrap()),
                "lineage": wire(attempts::lineage(conn, &a.id).unwrap()),
                "deletionPreview": wire(attempts::deletion_preview(conn, &a.id).unwrap()),
                "trades": wire(trades::list(conn, &a.id).unwrap()),
                "journal": wire(journal::list(conn, &a.id).unwrap()),
                "imports": wire(batches),
                "problemRows": problem_rows,
                "ledger": wire(ledger::list(conn, &a.id).unwrap()),
                "balanceAdjustment": wire(ledger::balance_adjustment(conn, &a.id).unwrap()),
                "snapshots": wire(snapshots::list(conn, &a.id, None, None, false).unwrap()),
                "latestSnapshot": wire(snapshots::latest(conn, &a.id).unwrap()),
                "dailyReviews": wire(&reviews),
                "dailyReviewDays": days,
            })
        })
        .collect();
    // Build 23: the Insights snapshot of every account (archived included), as one request.
    let all_ids = accounts.iter().map(|a| a.id.clone()).collect::<Vec<_>>();
    let insights = if all_ids.is_empty() {
        Value::Null
    } else {
        wire(insights::dataset_at(conn, insights::InsightsQuery { account_ids: all_ids }, PLACEHOLDER_INSTANT).unwrap())
    };
    json!({ "accounts": wire(accounts), "perAccount": per_account, "settings": wire(settings::list(conn).unwrap()), "insights": insights })
}

/// A new journal with every kind of record the frontend models.
fn fresh() -> Value {
    let mut conn = db();
    let account = |name: &str, currency: &str| {
        json!({
            "name": name, "broker": "Tradovate", "propFirm": "Topstep", "externalRef": null, "accountType": "evaluation",
            "status": "active", "currency": currency, "startingBalance": "50000", "timezone": "America/New_York",
            "tradingDayResetTime": "17:00", "notes": null
        })
    };
    let usd = accounts::create(&mut conn, from_value(account("Eval 50K", "USD")).unwrap()).unwrap();
    let eur = accounts::create(&mut conn, from_value(account("Euro account", "EUR")).unwrap()).unwrap();
    let trade = |id: &str, exit: bool| {
        json!({
            "accountId": id, "symbol": "ESZ6", "side": "long", "quantity": "1", "entryAt": "2026-10-19T13:30:00Z",
            "entryPrice": "5000.25", "exitAt": if exit { json!("2026-10-19T14:00:00-04:00") } else { Value::Null },
            "exitPrice": if exit { json!("5004.50") } else { Value::Null }, "fees": "4.12", "realizedPnl": null, "notes": null
        })
    };
    let closed = trades::create(&mut conn, from_value(trade(&usd.id, true)).unwrap()).unwrap();
    trades::create(&mut conn, from_value(trade(&usd.id, false)).unwrap()).unwrap();
    trades::create(&mut conn, from_value(trade(&eur.id, true)).unwrap()).unwrap();
    journal::create(
        &mut conn,
        from_value(json!({
            "accountId": usd.id, "tradeId": closed.id, "entryAt": "2026-10-19T21:00:00Z",
            "title": "Review", "body": "Waited for the retest.", "tags": ["patience"]
        }))
        .unwrap(),
    )
    .unwrap();
    // Daily reviews: a completed review of a traded day and a no-trade-day draft (Build 22).
    daily_reviews::save_at(
        &mut conn,
        from_value(json!({
            "accountId": usd.id, "tradingDay": "2026-10-19", "expectedRevision": null,
            "plan": { "focus": "A+ only", "maxRisk": "250" }, "reflection": { "keyLesson": "Wait for the retest" },
            "noTradeDay": false, "checklistId": null, "answers": [], "action": "complete"
        }))
        .unwrap(),
        review_now(),
    )
    .unwrap();
    daily_reviews::save_at(
        &mut conn,
        from_value(json!({
            "accountId": usd.id, "tradingDay": "2026-10-16", "expectedRevision": null, "plan": {}, "reflection": {},
            "noTradeDay": true, "checklistId": null, "answers": [], "action": "save"
        }))
        .unwrap(),
        review_now(),
    )
    .unwrap();
    for content in [CSV, "not,a,known,format\n1,2,3,4\n"] {
        // The second file fails as a whole: a persisted failed batch.
        let _ = csv_import::commit(
            &mut conn,
            &from_value(json!({ "accountId": usd.id, "fileName": "Performance.csv", "content": content, "timezone": "America/New_York" })).unwrap(),
        );
    }
    for (kind, amount) in [("payout", "-1500.50"), ("evaluation_fee", "-165")] {
        ledger::create(
            &mut conn,
            from_value(json!({ "accountId": usd.id, "kind": kind, "amount": amount, "affectsBalance": null, "effectiveAt": "2026-10-19T21:30:00Z", "note": null })).unwrap(),
        )
        .unwrap();
    }
    let snapshot = |status: &str| {
        json!({
            "accountId": usd.id, "rulebookVersionId": null, "tradingDay": "2026-10-19", "isEndOfDay": status == "safe",
            "dataAsOf": if status == "safe" { json!("2026-10-19T20:55:00Z") } else { Value::Null }, "dataSource": "csv_import",
            "engineVersion": "test-1", "inputsHash": "abc123", "feesIncluded": true, "unrealizedIncluded": false,
            "balance": "50212.5", "realizedDayPnl": "212.5", "unrealizedPnl": null,
            "dailyLossLimit": if status == "safe" { json!("1000") } else { Value::Null },
            "dailyLossRemaining": if status == "safe" { json!("1212.5") } else { Value::Null },
            "drawdownMode": null, "highWaterMark": null, "drawdownFloor": null, "drawdownHeadroom": null, "drawdownLocked": false,
            "profitTarget": null, "tradingDaysCompleted": 1, "tradingDaysRequired": null, "status": status,
            "statusReasons": if status == "safe" { json!([]) } else { json!(["No rulebook assigned"]) },
            "explanation": { "inputs": { "trades": [closed.id] } }
        })
    };
    snapshots::save(&mut conn, from_value(snapshot("unknown")).unwrap()).unwrap();
    snapshots::save(&mut conn, from_value(snapshot("safe")).unwrap()).unwrap();
    accounts::change_status(&mut conn, &usd.id, from_value(json!({ "status": "failed", "effectiveAt": null, "cause": null, "note": null })).unwrap()).unwrap();
    attempts::reset(
        &mut conn,
        from_value(json!({
            "predecessorAccountId": usd.id, "priorOutcome": "failed", "effectiveAt": "2026-10-20T15:00:00-04:00",
            "reason": null, "source": "provider_email", "name": "Eval 50K attempt 2", "externalRef": null,
            "startingBalance": "50000", "catalogue": null, "rulebook": { "kind": "decideLater" }, "notes": null
        }))
        .unwrap(),
    )
    .unwrap();
    accounts::archive(&mut conn, &eur.id).unwrap();
    settings::set(&conn, "ui.theme", &json!("dark")).unwrap();
    payloads(&mut conn)
}

/// A real journal from an older release, upgraded to the current schema on open.
fn upgraded(bytes: &[u8]) -> Value {
    let dir = std::env::temp_dir().join(format!("fundedflow-wire-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("journal.db");
    std::fs::write(&path, bytes).unwrap();
    let value = {
        let mut conn = open_file(&path).unwrap();
        payloads(&mut conn)
    };
    let _ = std::fs::remove_dir_all(&dir);
    value
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// Content without generated ids or this run's timestamps: a sort key that is the same on every run.
fn sort_key(value: &Value, run_started: &str) -> String {
    let mut v = value.clone();
    fn blank(v: &mut Value, run_started: &str) {
        match v {
            Value::String(s) if is_uuid(s) || (s.len() == 24 && s.ends_with('Z') && s.as_str() >= run_started) => *s = String::new(),
            Value::Array(items) => items.iter_mut().for_each(|i| blank(i, run_started)),
            Value::Object(map) => map.values_mut().for_each(|i| blank(i, run_started)),
            _ => {}
        }
    }
    blank(&mut v, run_started);
    v.to_string()
}

/// Records created in the same millisecond come back in either order. Order is not part of this
/// contract (the frontend sorts for display), so arrays are sorted by content before ids are assigned.
fn sort_arrays(value: &mut Value, run_started: &str) {
    match value {
        Value::Array(items) => {
            items.iter_mut().for_each(|v| sort_arrays(v, run_started));
            items.sort_by_cached_key(|v| sort_key(v, run_started));
        }
        Value::Object(map) => map.values_mut().for_each(|v| sort_arrays(v, run_started)),
        _ => {}
    }
}

/// Replaces generated ids and timestamps from this run with stable placeholders.
fn stabilise(value: &mut Value, run_started: &str, ids: &mut HashMap<String, String>) {
    match value {
        Value::String(s) => {
            if is_uuid(s) {
                let next = format!("id-{}", ids.len() + 1);
                *s = ids.entry(s.clone()).or_insert(next).clone();
            } else if s.len() == 24 && s.ends_with('Z') && s.as_bytes()[10] == b'T' && s.as_str() >= run_started {
                *s = PLACEHOLDER_INSTANT.into();
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| stabilise(v, run_started, ids)),
        Value::Object(map) => map.values_mut().for_each(|v| stabilise(v, run_started, ids)),
        _ => {}
    }
}

#[test]
fn command_wire_fixture_matches_rust() {
    // Truncated to the second so instants written during this run sort after it.
    let run_started = format!("{}.000Z", &crate::domain::now()[..19]);
    let mut ids = HashMap::new();
    let mut fixture = json!({
        "description": "Generated by src-tauri/src/wire_contract.rs; checked by apps/desktop/src/features/shared/wire-contract.test.ts. Do not edit by hand.",
        "journals": { "fresh": fresh(), "v3Upgraded": upgraded(V3), "v4Upgraded": upgraded(V4) }
    });
    sort_arrays(&mut fixture, &run_started);
    stabilise(&mut fixture, &run_started, &mut ids);
    let path = fixture_path();
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some_and(|v| v == "1") {
        std::fs::write(&path, serde_json::to_string_pretty(&fixture).unwrap() + "\n").unwrap();
        return;
    }
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let stored: Value = serde_json::from_str(&text).unwrap();
    assert!(
        stored == fixture,
        "command-wire.json does not match the Rust command payloads (rerun with FUNDEDFLOW_UPDATE_FIXTURES=1 if the change is intended)"
    );
}
