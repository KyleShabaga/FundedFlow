use super::*;
use rusqlite::Connection;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};
fn good(root: &Path) -> std::path::PathBuf {
    let c = crate::db::open_file(&root.join("source.db")).unwrap();
    let out = root.join("good.zip");
    archive::export(&c, &root.join("attachments"), &out, true).unwrap();
    out
}
fn unpack(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut z = ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let mut result = Vec::new();
    for i in 0..z.len() {
        let mut e = z.by_index(i).unwrap();
        let mut bytes = Vec::new();
        e.read_to_end(&mut bytes).unwrap();
        result.push((e.name().into(), bytes));
    }
    result
}
fn repack(path: &Path, entries: Vec<(String, Vec<u8>)>) {
    let mut z = ZipWriter::new(fs::File::create(path).unwrap());
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, bytes) in entries {
        z.start_file(name, options).unwrap();
        z.write_all(&bytes).unwrap();
    }
    z.finish().unwrap();
}
#[test]
fn malicious_paths_aliases_symlinks_and_missing_entries_never_escape_staging() {
    let dir = tempfile::tempdir().unwrap();
    let good = good(dir.path());
    let original = unpack(&good);
    for name in [
        "../escape",
        "/absolute",
        "C:/absolute",
        "attachments/../../escape",
        "attachments\\evil",
        "CON",
        "manifest.json.",
        "MANIFEST.JSON",
    ] {
        let path = dir.path().join("attack.zip");
        let mut entries = original.clone();
        entries.push((name.into(), b"bad".to_vec()));
        repack(&path, entries);
        assert!(archive::inspect_to(&path, dir.path()).is_err(), "{name}");
        assert!(!dir.path().parent().unwrap().join("escape").exists());
    }
    let link = dir.path().join("link.zip");
    let mut z = ZipWriter::new(fs::File::create(&link).unwrap());
    z.add_symlink(
        "attachments/link",
        "../../outside",
        SimpleFileOptions::default(),
    )
    .unwrap();
    for (name, bytes) in original.clone() {
        z.start_file(name, SimpleFileOptions::default()).unwrap();
        z.write_all(&bytes).unwrap();
    }
    z.finish().unwrap();
    assert!(archive::inspect_to(&link, dir.path()).is_err());
    let mut missing = original;
    missing.retain(|(name, _)| name != "data.json");
    let path = dir.path().join("missing.zip");
    repack(&path, missing);
    assert!(archive::inspect_to(&path, dir.path()).is_err());
}
#[test]
fn checksums_counts_portable_values_unknown_manifest_fields_and_newer_versions_fail() {
    let dir = tempfile::tempdir().unwrap();
    let good = good(dir.path());
    for attack in 0..7 {
        let mut entries = unpack(&good);
        let manifest = entries
            .iter_mut()
            .find(|(n, _)| n == "manifest.json")
            .unwrap();
        let mut value: serde_json::Value = serde_json::from_slice(&manifest.1).unwrap();
        match attack {
            0 => value["entries"][0]["sha256"] = serde_json::json!("0".repeat(64)),
            1 => value["entities"]["accounts"] = serde_json::json!(99),
            2 => value["formatVersion"] = serde_json::json!(99),
            3 => value["schemaVersion"] = serde_json::json!(crate::db::latest_version() + 1),
            4 => value["unexpected"] = serde_json::json!(true),
            5 => value["accountIds"] = serde_json::json!(["fake"]),
            _ => {
                value["entries"][1]["sha256"] = serde_json::json!(filesystem::digest(b"{}"));
                value["entries"][1]["bytes"] = serde_json::json!(2);
            }
        }
        manifest.1 = serde_json::to_vec(&value).unwrap();
        if attack == 6 {
            entries
                .iter_mut()
                .find(|(n, _)| n == "data.json")
                .unwrap()
                .1 = b"{}".to_vec();
        }
        let path = dir.path().join("attack.zip");
        repack(&path, entries);
        assert!(
            archive::inspect_to(&path, dir.path()).is_err(),
            "attack {attack}"
        );
    }
}
#[test]
fn truncated_wrong_magic_crc_resource_and_disk_limits_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let good = good(dir.path());
    let bytes = fs::read(&good).unwrap();
    for data in [
        b"not a zip".to_vec(),
        bytes[..bytes.len() / 2].to_vec(),
        [b"preamble".as_slice(), bytes.as_slice()].concat(),
    ] {
        let path = dir.path().join("bad.zip");
        fs::write(&path, data).unwrap();
        assert!(archive::inspect_to(&path, dir.path()).is_err());
    }
    let mut crc = bytes.clone();
    let pos = crc
        .windows(b"fundedflow-journal".len())
        .position(|v| v == b"fundedflow-journal")
        .unwrap();
    crc[pos] ^= 1;
    let path = dir.path().join("crc.zip");
    fs::write(&path, crc).unwrap();
    assert!(archive::inspect_to(&path, dir.path()).is_err());
    let mut bomb = bytes;
    let pos = bomb.windows(4).position(|v| v == b"PK\x01\x02").unwrap();
    bomb[pos + 24..pos + 28].copy_from_slice(&((filesystem::MAX_ENTRY + 1) as u32).to_le_bytes());
    fs::write(&path, bomb).unwrap();
    assert!(archive::inspect_to(&path, dir.path()).is_err());
    let entries = (0..filesystem::MAX_ENTRIES + 1)
        .map(|i| (format!("file{i}"), vec![]))
        .collect();
    repack(&path, entries);
    assert_eq!(
        archive::inspect_to(&path, dir.path()).err().unwrap().code,
        Code::LimitExceeded
    );
    assert_eq!(
        filesystem::space(dir.path(), u64::MAX).unwrap_err().code,
        Code::InsufficientSpace
    );
}
#[test]
fn archive_supplied_schema_code_and_cross_account_provenance_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let good = good(dir.path());
    for sql in [
        "CREATE TRIGGER evil AFTER INSERT ON settings BEGIN DELETE FROM accounts; END;",
        "PRAGMA writable_schema=ON; DELETE FROM sqlite_schema WHERE name='ix_trades_account_entry';",
    ] {
        let inspection = archive::inspect_to(&good, dir.path()).unwrap();
        let path = inspection.directory.path().join("journal.sqlite");
        let c = Connection::open(&path).unwrap();
        c.execute_batch(sql).unwrap();
        drop(c);
        assert_eq!(
            archive::validate_database(&path, crate::db::latest_version())
                .unwrap_err()
                .code,
            Code::Integrity
        );
    }
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db/fixtures/fundedflow-v3.db");
    let path = dir.path().join("invalid.db");
    fs::copy(&fixture, &path).unwrap();
    let c = Connection::open(&path).unwrap();
    let trigger: String = c
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='trg_trades_provenance_immutable'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    c.execute_batch("DROP TRIGGER trg_trades_provenance_immutable")
        .unwrap();
    c.execute("UPDATE trades SET account_id=(SELECT id FROM accounts WHERE id<>trades.account_id LIMIT 1) WHERE source='csv_import'",[]).unwrap();
    c.execute_batch(&trigger).unwrap();
    drop(c);
    // All declared FKs and schema SQL still match; provenance must also agree across accounts.
    assert_eq!(
        archive::validate_database(&path, 3).unwrap_err().code,
        Code::Integrity
    );
}
#[test]
fn populated_v3_archive_inspects_then_upgrades_only_staged_copy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db/fixtures/fundedflow-v3.db"),
        &path,
    )
    .unwrap();
    let original = fs::read(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    let before = archive::dump(&c).unwrap();
    let out = dir.path().join("legacy.zip");
    archive::export(&c, &dir.path().join("attachments"), &out, true).unwrap();
    drop(c);
    assert_eq!(fs::read(&path).unwrap(), original);
    let target = tempfile::tempdir().unwrap();
    let live = target.path().join(crate::db::DB_FILE_NAME);
    let current = crate::db::open_file(&live).unwrap();
    let p = restore::inspect(
        &current,
        target.path(),
        restore::InspectRequest {
            source: out.to_string_lossy().into(),
        },
    )
    .unwrap();
    assert_eq!(p.manifest.schema_version, 3);
    let expected = archive::inspect_to(&out, dir.path()).unwrap();
    let upgraded = crate::db::open_file(&expected.directory.path().join("journal.sqlite")).unwrap();
    let upgraded_data = archive::dump(&upgraded).unwrap();
    restore::prepare(
        &current,
        target.path(),
        restore::RestoreRequest {
            source: out.to_string_lossy().into(),
            preview_token: p.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        },
    )
    .unwrap();
    drop(current);
    restore::recover(target.path(), &live).unwrap();
    let restored = crate::db::open_file(&live).unwrap();
    let data = archive::dump(&restored).unwrap();
    assert_eq!(data["accounts"].rows.len(), before["accounts"].rows.len());
    assert_eq!(data["import_rows"], upgraded_data["import_rows"]);
    assert_eq!(
        data["trade_round_trips"],
        upgraded_data["trade_round_trips"]
    );
    assert_eq!(
        archive::account_ids(&restored).unwrap(),
        p.manifest.account_ids
    );
    assert_eq!(fs::read(&path).unwrap(), original);
}
