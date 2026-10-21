//! Native service outputs pinned for TypeScript parsing. Normalize volatile metadata only.
use super::*;
use std::{fs, path::Path};
fn normalize(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                match key.as_str() {
                    "operationId" | "exportId" | "safetyBackupId" => {
                        *value = serde_json::json!("00000000-0000-4000-8000-000000000001")
                    }
                    "sha256" | "archiveSha256" | "previewToken" => {
                        *value = serde_json::json!("0".repeat(64))
                    }
                    "createdAt" => *value = serde_json::json!("2026-10-20T00:00:00.000Z"),
                    "bytes" => *value = serde_json::json!(0),
                    _ => normalize(value),
                }
            }
        }
        serde_json::Value::Array(values) => {
            for v in values {
                normalize(v)
            }
        }
        _ => {}
    }
}
#[test]
fn native_data_control_outputs_match_portable_wire_fixture() {
    let source = tempfile::tempdir().unwrap();
    let path = source.path().join("source.db");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db/fixtures/fundedflow-v3.db"),
        &path,
    )
    .unwrap();
    let c = rusqlite::Connection::open(&path).unwrap();
    let out = source.path().join("backup.zip");
    let export = archive::export(&c, &source.path().join("attachments"), &out, true).unwrap();
    let csv = archive::export_csv(&c, &source.path().join("trades.csv"), None, true).unwrap();
    let target = tempfile::tempdir().unwrap();
    let mut c = crate::db::open_file(&target.path().join(crate::db::DB_FILE_NAME)).unwrap();
    let deletion = deletion::preview(
        &c,
        target.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Journal,
        },
    )
    .unwrap();
    let deleted = deletion::execute(
        &mut c,
        target.path(),
        deletion::DeleteRequest {
            scope: deletion::Scope::Journal,
            preview_token: deletion.preview_token.clone(),
            confirmation: deletion.required_confirmation.clone(),
        },
    )
    .unwrap();
    deletion::recover_cleanup(&c, target.path()).unwrap();
    let preview = restore::inspect(
        &c,
        target.path(),
        restore::InspectRequest {
            source: out.to_string_lossy().into(),
        },
    )
    .unwrap();
    let restored = restore::prepare(
        &c,
        target.path(),
        restore::RestoreRequest {
            source: out.to_string_lossy().into(),
            preview_token: preview.preview_token.clone(),
            confirmation: preview.required_confirmation.clone(),
        },
    )
    .unwrap();
    let mut result = serde_json::json!([
        {"command":"export_journal_archive","output":export}, {"command":"export_trade_csv","output":csv},
        {"command":"inspect_journal_archive","output":preview}, {"command":"restore_journal_archive","output":restored},
        {"command":"preview_permanent_deletion","output":deletion}, {"command":"permanently_delete_data","output":deleted},
        {"command":"retry_data_cleanup","output":null}, {"command":"error","output":super::fail(Code::StalePreview)},
    ]);
    normalize(&mut result);
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/domain/test/fixtures/data-controls-wire.json");
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some() {
        fs::write(
            &fixture,
            format!("{}\n", serde_json::to_string_pretty(&result).unwrap()),
        )
        .unwrap();
    }
    let expected: serde_json::Value = serde_json::from_slice(&fs::read(fixture).unwrap()).unwrap();
    assert_eq!(result, expected);
}
