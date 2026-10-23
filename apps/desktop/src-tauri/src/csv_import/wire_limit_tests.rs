//! P0-04 wire contracts shared with TypeScript (`packages/domain/test/contracts/csv-wire-limits.test.ts` and
//! `apps/desktop/src/lib/data/csv-duration-wire.test.ts`). All CSV values here are synthetic.
use super::*;
use std::path::PathBuf;

fn repo_file(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(rel)
}

#[test]
fn byte_limit_vectors_match_the_shared_specification() {
    let doc: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(repo_file("test_csvimport/limits/byte-limit-v1.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(doc["maxBytes"].as_u64(), Some(MAX_CSV_BYTES as u64));
    let cases = doc["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 13);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let content: String = c["parts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                p["text"]
                    .as_str()
                    .unwrap()
                    .repeat(p["repeat"].as_u64().unwrap() as usize)
            })
            .collect();
        assert_eq!(
            content.len() as u64,
            c["utf8Bytes"].as_u64().unwrap(),
            "{name}: UTF-8 bytes"
        );
        assert_eq!(
            content.encode_utf16().count() as u64,
            c["utf16Units"].as_u64().unwrap(),
            "{name}: UTF-16 units"
        );
        let parsed = parse::parse(&content);
        let too_large = parsed
            .issues
            .iter()
            .any(|i| i.field == "content" && i.message == "The file is larger than 10 MB.");
        assert_eq!(
            !too_large,
            c["accepted"].as_bool().unwrap(),
            "{name}: native acceptance"
        );
        if too_large {
            assert!(
                parsed.rows.is_empty(),
                "{name}: nothing past the cap is parsed"
            );
        }
    }
}

#[test]
fn a_request_with_an_unpaired_surrogate_never_reaches_the_importer() {
    // JSON can spell a lone surrogate; a Rust String can't hold one, so the command's arguments fail to decode.
    // The TypeScript schema refuses the same text before it is sent.
    for content in [r"a,b\n\ud800", r"\udc00a,b\n"] {
        let json = format!(
            r#"{{"accountId":"a","fileName":"t.csv","content":"{content}","timezone":"UTC"}}"#
        );
        assert!(
            serde_json::from_str::<CsvImportRequest>(&json).is_err(),
            "{content}"
        );
    }
    let paired = r#"{"accountId":"a","fileName":"t.csv","content":"😀","timezone":"UTC"}"#;
    assert_eq!(
        serde_json::from_str::<CsvImportRequest>(paired)
            .unwrap()
            .content
            .len(),
        4
    );
}

/// (duration cell, expected native classification): `Some(wire)` for a valid row, `None` for a row error.
const DURATIONS: &[(&str, Option<&str>)] = &[
    ("0sec", Some("0")),
    ("32sec", Some("32")),
    ("9007199254740991sec", Some("9007199254740991")),
    ("9007199254740992sec", Some("\"9007199254740992\"")),
    ("9007199254740993sec", Some("\"9007199254740993\"")),
    ("2562047788015215:30:07", Some("\"9223372036854775807\"")),
    ("9223372036854775807sec", Some("\"9223372036854775807\"")),
    ("9223372036854775808sec", None),
    ("18446744073709551616sec", None),
    ("-5sec", None),
    ("1.5sec", None),
];

fn duration_file() -> String {
    let header = PERFORMANCE.lines().next().unwrap();
    let line = PERFORMANCE.lines().nth(1).unwrap();
    let mut csv = format!("{header}\n");
    for (i, (duration, _)) in DURATIONS.iter().enumerate() {
        // Distinct fill pairs so no row is a duplicate of another.
        let row = line
            .replace("500000000001", &format!("9100000000{i:02}"))
            .replace("500000000002", &format!("9200000000{i:02}"));
        csv.push_str(&row.replace("33sec", duration));
        csv.push('\n');
    }
    csv
}

#[test]
fn duration_wire_is_exact_and_preview_and_commit_classify_the_same_rows() {
    let (mut conn, account) = setup();
    let csv = duration_file();
    let p = preview(&conn, &request(&account, &csv)).unwrap();
    assert!(p.file_issues.is_empty(), "the file itself has no issues");
    let preview_json = serde_json::to_value(&p).unwrap();
    let batch = commit(&mut conn, &request(&account, &csv)).unwrap();
    let records: Vec<(String, Vec<FieldIssue>, Vec<String>)> = conn
        .prepare("SELECT status, issues_json, raw_json FROM import_rows WHERE batch_id = ?1 ORDER BY row_number")
        .unwrap()
        .query_map([&batch.id], |r| {
            let json = |i: usize| r.get::<_, String>(i);
            Ok((r.get(0)?, serde_json::from_str(&json(1)?).unwrap(), serde_json::from_str(&json(2)?).unwrap()))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let trades = serde_json::to_value(trade_store::list(&conn, &account).unwrap()).unwrap();
    let source_lines: Vec<&str> = csv.lines().skip(1).collect();

    let mut fixture_rows = Vec::new();
    for (i, (cell, expected)) in DURATIONS.iter().enumerate() {
        let row = &preview_json["rows"][i];
        let (status, errors, raw) = &records[i];
        // Raw cells are kept exactly, valid or not, in preview and in the committed history.
        assert_eq!(row["raw"].as_array().unwrap()[12], *cell, "{cell}");
        assert_eq!(raw.join(","), source_lines[i], "{cell}");
        match expected {
            Some(wire) => {
                assert_eq!(row["status"], "new", "{cell}");
                assert_eq!(status, "imported", "{cell}");
                assert_eq!(
                    row["trade"]["durationSeconds"].to_string(),
                    *wire,
                    "{cell}: preview wire"
                );
                let stored = trades
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|t| t["roundTrip"]["buyFillId"] == row["trade"]["buyFillId"])
                    .unwrap();
                assert_eq!(
                    stored["roundTrip"]["durationSeconds"].to_string(),
                    *wire,
                    "{cell}: stored trade wire"
                );
                assert_eq!(stored["roundTrip"]["durationSource"], *cell);
            }
            None => {
                assert_eq!(row["status"], "invalid", "{cell}");
                assert_eq!(status, "invalid", "{cell}");
                assert_eq!(fields(&p.rows[i].errors), ["duration"], "{cell}");
                assert_eq!(
                    errors.iter().map(|e| e.field.as_str()).collect::<Vec<_>>(),
                    ["duration"],
                    "{cell}"
                );
            }
        }
        fixture_rows.push(serde_json::json!({
            "durationCell": cell,
            "previewStatus": row["status"],
            "committedStatus": status,
            "previewDurationSeconds": row["trade"].get("durationSeconds").cloned().unwrap_or(serde_json::Value::Null),
        }));
    }
    assert_eq!((batch.imported_count, batch.failed_count), (7, 4));

    // A stored value above 2^53 - 1 reads back exactly in SQLite and round-trips through the trade DTO.
    let max: i64 = conn
        .query_row(
            "SELECT max(duration_seconds) FROM trade_round_trips",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(max, i64::MAX);
    let decoded: Vec<trade_store::Trade> = serde_json::from_value(trades.clone()).unwrap();
    assert!(decoded.iter().any(|t| t.round_trip.as_ref().unwrap().duration_seconds == Some(9_007_199_254_740_993)));

    let stored: Vec<serde_json::Value> = trades
        .as_array()
        .unwrap()
        .iter()
        .map(|t| serde_json::json!({ "durationSource": t["roundTrip"]["durationSource"], "durationSeconds": t["roundTrip"]["durationSeconds"] }))
        .collect();
    let fixture = format!(
        "{}\n",
        serde_json::to_string_pretty(&serde_json::json!({
            "fixtureVersion": 1,
            "generatedBy": "apps/desktop/src-tauri/src/csv_import/wire_limit_tests.rs",
            "rows": fixture_rows,
            "storedTrades": stored,
        }))
        .unwrap()
    );
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/csv-duration-wire.json");
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some() {
        std::fs::write(&path, &fixture).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path)
            .unwrap_or_default()
            .replace("\r\n", "\n"),
        fixture,
        "csv-duration-wire.json does not match native output (rerun with FUNDEDFLOW_UPDATE_FIXTURES=1 if intended)"
    );
}

#[test]
fn duration_wire_refuses_non_canonical_or_out_of_range_input() {
    #[derive(serde::Deserialize)]
    struct W {
        #[serde(with = "crate::domain::duration_wire")]
        d: Option<i64>,
    }
    let ok = |json: &str| serde_json::from_str::<W>(json).map(|w| w.d);
    assert_eq!(ok(r#"{"d":null}"#).unwrap(), None);
    assert_eq!(
        ok(r#"{"d":9007199254740991}"#).unwrap(),
        Some(9_007_199_254_740_991)
    );
    assert_eq!(
        ok(r#"{"d":"9007199254740992"}"#).unwrap(),
        Some(9_007_199_254_740_992)
    );
    assert_eq!(
        ok(r#"{"d":"9223372036854775807"}"#).unwrap(),
        Some(i64::MAX)
    );
    for bad in [
        r#"{"d":9007199254740992}"#,
        r#"{"d":"60"}"#,
        r#"{"d":"9007199254740991"}"#,
        r#"{"d":"09007199254740993"}"#,
        r#"{"d":"+9007199254740993"}"#,
        r#"{"d":"9223372036854775808"}"#,
        r#"{"d":-1}"#,
        r#"{"d":1.5}"#,
    ] {
        assert!(ok(bad).is_err(), "{bad}");
    }
}
