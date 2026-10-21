use super::*;
use crate::{db, store::accounts};
use rusqlite::Connection;
use std::{fs, path::Path};

fn journal(path: &Path) -> Connection {
    db::open_file(path).unwrap()
}
fn account(c: &mut Connection, name: &str) -> String {
    accounts::create(
        c,
        accounts::AccountInput {
            name: name.into(),
            account_type: "personal".into(),
            status: "active".into(),
            currency: "USD".into(),
            starting_balance: "50000".into(),
            timezone: "America/Edmonton".into(),
            trading_day_reset_time: "18:00".into(),
            broker: None,
            prop_firm: None,
            external_ref: None,
            notes: None,
        },
    )
    .unwrap()
    .id
}
#[test]
fn wal_export_preserves_exact_tables_and_publishes_complete_archive() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("live.db");
    let mut c = journal(&path);
    let id = account(&mut c, "test");
    let before = archive::dump(&c).unwrap();
    let out = dir.path().join("backup.ffj.zip");
    let result = archive::export(&c, &dir.path().join("attachments"), &out, true).unwrap();
    assert_eq!(result.state, "completed");
    assert!(result.plaintext);
    let inspection = archive::inspect_to(&out, dir.path()).unwrap();
    assert_eq!(inspection.manifest.account_ids, vec![id]);
    let restored = archive::readonly(&inspection.directory.path().join("journal.sqlite")).unwrap();
    assert_eq!(archive::dump(&restored).unwrap(), before);
    assert_eq!(archive::dump(&c).unwrap(), before);
    assert!(archive::export(&c, dir.path(), &out, true).is_err());
    assert_eq!(archive::dump(&c).unwrap(), before);
}
#[test]
fn attachment_bytes_and_checksums_are_required_not_just_paths() {
    let dir = tempfile::tempdir().unwrap();
    let c = journal(&dir.path().join("live.db"));
    let data = b"image bytes";
    let hash = filesystem::digest(data);
    c.execute("INSERT INTO attachments(id,kind,storage_key,mime_type,byte_size,sha256,created_at,updated_at) VALUES('a','screenshot','opaque/file.png','image/png',?1,?2,'t','t')", rusqlite::params![data.len() as i64,hash]).unwrap();
    let root = dir.path().join("attachments");
    let out = dir.path().join("backup.zip");
    assert_eq!(
        archive::export(&c, &root, &out, true).unwrap_err().code,
        Code::MissingAttachment
    );
    fs::create_dir_all(root.join("opaque")).unwrap();
    fs::write(root.join("opaque/file.png"), data).unwrap();
    archive::export(&c, &root, &out, true).unwrap();
    let imported = archive::inspect_to(&out, dir.path()).unwrap();
    assert_eq!(
        fs::read(
            imported
                .directory
                .path()
                .join("attachments/opaque/file.png")
        )
        .unwrap(),
        data
    );
    fs::write(root.join("opaque/file.png"), b"bad").unwrap();
    assert_eq!(
        archive::export(&c, &root, &dir.path().join("bad.zip"), true)
            .unwrap_err()
            .code,
        Code::MissingAttachment
    );
    assert!(!dir.path().join("bad.zip").exists());
}
#[test]
fn plaintext_acknowledgement_and_windows_safe_paths_are_enforced() {
    let dir = tempfile::tempdir().unwrap();
    let c = journal(&dir.path().join("live.db"));
    assert_eq!(
        archive::export(&c, dir.path(), &dir.path().join("out.zip"), false)
            .unwrap_err()
            .code,
        Code::ConfirmationRequired
    );
    for key in [
        "../x", "/x", "C:/x", "x\\y", "x/../y", "CON", "aux.txt", "a.", "a ", "x//y", "x:y",
    ] {
        assert!(filesystem::relative(key).is_err(), "{key}");
    }
    filesystem::relative("opaque/019ab-file.png").unwrap();
}
#[test]
fn csv_is_separate_exact_scoped_and_spreadsheet_safe() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join("live.db"));
    let a = account(&mut c, "A");
    let b = account(&mut c, "B");
    for id in [&a, &b] {
        crate::store::trades::create(
            &mut c,
            crate::store::trades::TradeInput {
                account_id: id.clone(),
                symbol: "ESZ6".into(),
                side: "long".into(),
                quantity: "1".into(),
                entry_at: "2026-10-19T13:30:00Z".into(),
                entry_price: "5000.25".into(),
                exit_at: Some("2026-10-19T14:00:00Z".into()),
                exit_price: Some("5004.5".into()),
                fees: Some("4.12".into()),
                realized_pnl: None,
                notes: Some("=HYPERLINK(\"danger\")".into()),
            },
        )
        .unwrap();
    }
    let out = dir.path().join("trades.csv");
    archive::export_csv(&c, &out, Some(&a), true).unwrap();
    let mut reader = csv::Reader::from_path(out).unwrap();
    let rows = reader
        .records()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(&rows[0][0], a);
    assert_eq!(&rows[0][10], "4.12");
    assert_eq!(&rows[0][11], "208.38");
    assert!(rows[0][16].starts_with("'=HYPERLINK"));
}
