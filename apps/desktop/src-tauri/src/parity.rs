//! Golden-fixture parity with `@fundedflow/domain`.
//!
//! The fixtures under `packages/domain/test/fixtures/` are language-neutral
//! JSON: humans write the inputs, this module computes every expected output
//! with the Rust code (which stays authoritative), and the TypeScript tests in
//! `packages/domain/test/` must reproduce them. A plain `cargo test` checks the
//! files; to regenerate the outputs after an intentional Rust change run
//!
//! ```text
//! FUNDEDFLOW_UPDATE_FIXTURES=1 cargo test --lib parity
//! ```
//!
//! and review the diff. See docs/architecture/packages.md#parity-fixtures.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::domain::{canonical, micros_to_string, parse_decimal, to_micros};
use crate::store::accounts::{self, AccountInput};
use crate::store::tests::db;
use crate::store::trades::{self, TradeInput};

/// Placeholder ids and timestamps written in place of generated values.
const ACCOUNT_ID: &str = "<account-id>";
const TRADE_ID: &str = "<trade-id>";
const TIMESTAMP: &str = "2026-01-01T00:00:00.000Z";

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/domain/test/fixtures").join(name)
}

fn updating() -> bool {
    std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some_and(|v| v == "1")
}

/// Fills each case's computed fields from Rust, then either rewrites the file
/// (update mode) or fails listing every case whose stored outputs differ.
fn check(name: &str, compute: impl Fn(&str, &mut Value)) {
    let path = fixture_path(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let original: Value = serde_json::from_str(&text).unwrap();
    let mut fixture = original.clone();
    let groups = fixture.as_object_mut().unwrap();
    for (group, cases) in groups.iter_mut() {
        if let Some(cases) = cases.as_array_mut() {
            for case in cases {
                compute(group, case);
            }
        }
    }
    if updating() {
        std::fs::write(&path, serde_json::to_string_pretty(&fixture).unwrap() + "\n").unwrap();
        return;
    }
    let stale: Vec<String> = original
        .as_object()
        .unwrap()
        .iter()
        .filter_map(|(group, cases)| Some((group, cases.as_array()?)))
        .flat_map(|(group, cases)| {
            let fresh = fixture[group].as_array().unwrap();
            cases.iter().zip(fresh).filter(|(a, b)| a != b).map(move |(_, b)| format!("{group}: {b}"))
        })
        .collect();
    assert!(
        stale.is_empty(),
        "{name} does not match the Rust implementation (rerun with FUNDEDFLOW_UPDATE_FIXTURES=1 if the change is intended):\n{}",
        stale.join("\n")
    );
}

fn opt_string(v: Option<String>) -> Value {
    v.map_or(Value::Null, Value::String)
}

#[test]
fn money_fixture_matches_rust() {
    check("money.json", |group, case| match group {
        "decimal" => {
            let input = case["input"].as_str().unwrap();
            let d = parse_decimal(input);
            let micros = d.and_then(to_micros);
            case["canonical"] = opt_string(d.map(canonical));
            case["micros"] = opt_string(micros.map(|m| m.to_string()));
            case["money"] = opt_string(micros.map(micros_to_string));
        }
        "microsToString" => {
            let micros: i64 = case["micros"].as_str().unwrap().parse().unwrap();
            case["money"] = json!(micros_to_string(micros));
        }
        _ => {}
    });
}

#[test]
fn trade_contract_fixture_matches_rust() {
    check("trade-contract.json", |group, case| {
        if group != "cases" {
            return;
        }
        let mut conn = db();
        let account_input: AccountInput = serde_json::from_value(case["account"].clone()).unwrap();
        let mut account = accounts::create(&mut conn, account_input).unwrap();

        let mut trade_json = case["trade"].clone();
        trade_json["accountId"] = json!(account.id);
        let trade_input: TradeInput = serde_json::from_value(trade_json).unwrap();
        let mut trade = trades::create(&mut conn, trade_input).unwrap();

        account.id = ACCOUNT_ID.into();
        account.created_at = TIMESTAMP.into();
        account.updated_at = TIMESTAMP.into();
        trade.id = TRADE_ID.into();
        trade.account_id = ACCOUNT_ID.into();
        trade.created_at = TIMESTAMP.into();
        trade.updated_at = TIMESTAMP.into();
        // Exact bytes as sent over Tauri IPC (serde_json, compact).
        case["accountWire"] = json!(serde_json::to_string(&account).unwrap());
        case["tradeWire"] = json!(serde_json::to_string(&trade).unwrap());
    });
}
