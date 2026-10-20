//! Golden baseline from the current Rust engine. TS checks DTO compatibility only;
//! it has no CSV normalization implementation yet. Never call this algorithm parity.
use super::*;
use serde_json::{json, Value};

#[test]
fn normalization_v1_golden_baseline_matches_rust() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test_csvimport/build17/normalization-v1.json");
    let mut fixture: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(fixture["fixtureVersion"], 1);
    assert_eq!(fixture["behaviorBaseline"], "rust-csv-v1");
    let update = std::env::var_os("FUNDEDFLOW_UPDATE_CSV_FIXTURES").is_some_and(|v| v == "1");
    for case in fixture["cases"].as_array_mut().unwrap() {
        let mut conn = db();
        let account = accounts::create(
            &mut conn,
            crate::store::accounts::AccountInput {
                currency: case["account"]["currency"].as_str().unwrap().into(),
                timezone: case["account"]["timezone"].as_str().unwrap().into(),
                trading_day_reset_time: case["account"]["tradingDayResetTime"].as_str().unwrap().into(),
                ..account_input("Golden CSV")
            },
        )
        .unwrap();
        let mut req: CsvImportRequest = serde_json::from_value(case["request"].clone()).unwrap();
        req.account_id = account.id;
        let p = preview(&conn, &req).unwrap();
        assert_no_records(&conn);
        let analysis = analyze(&conn, &req).unwrap();
        let keys: Vec<Option<String>> = analysis
            .outcomes
            .iter()
            .map(|o| match o {
                Outcome::Valid { trade, .. } => Some(dedup::key(&trade.identity)),
                _ => None,
            })
            .collect();
        let (batch, commit_error) = match commit(&mut conn, &req) {
            Ok(batch) => {
                let mut value = serde_json::to_value(batch).unwrap();
                value["id"] = json!("<batch-id>");
                value["accountId"] = json!("<account-id>");
                value["createdAt"] = json!("2026-01-01T00:00:00.000Z");
                value["completedAt"] = json!("2026-01-01T00:00:00.000Z");
                (value, Value::Null)
            }
            Err(AppError::Validation { .. }) => (Value::Null, json!("validation")),
            Err(error) => panic!("unexpected commit failure for {}: {error}", case["name"]),
        };
        let expected = json!({ "preview": p, "dedupKeys": keys, "batch": batch, "commitError": commit_error });
        if update {
            case["expected"] = expected;
        } else {
            assert_eq!(
                case["expected"], expected,
                "{}: Rust CSV baseline changed; review before regenerating",
                case["name"]
            );
        }
    }
    if update {
        std::fs::write(path, serde_json::to_string_pretty(&fixture).unwrap() + "\n").unwrap();
    }
}
