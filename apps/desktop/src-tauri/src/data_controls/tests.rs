use super::*;
use crate::{db, store::accounts};
use rusqlite::Connection;
use std::{fs, path::Path};

pub(super) fn journal(path: &Path) -> Connection {
    db::open_file(path).unwrap()
}
pub(super) fn account(c: &mut Connection, name: &str) -> String {
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
fn backup_with_account(dir: &Path, name: &str) -> std::path::PathBuf {
    let mut c = journal(&dir.join("source.db"));
    account(&mut c, name);
    let path = dir.join("backup.zip");
    archive::export(&c, &dir.join("attachments"), &path, true).unwrap();
    path
}
#[test]
fn restore_inspection_is_readonly_stale_and_wrong_confirmations_fail_before_install() {
    let source = tempfile::tempdir().unwrap();
    let archive = backup_with_account(source.path(), "incoming");
    let target = tempfile::tempdir().unwrap();
    let path = target.path().join(db::DB_FILE_NAME);
    let mut c = journal(&path);
    account(&mut c, "original");
    let before = archive::dump(&c).unwrap();
    let preview = restore::inspect(
        &c,
        target.path(),
        restore::InspectRequest {
            source: archive.to_string_lossy().into(),
        },
    )
    .unwrap();
    assert_eq!(archive::dump(&c).unwrap(), before);
    assert_eq!(
        restore::prepare(
            &c,
            target.path(),
            restore::RestoreRequest {
                source: archive.to_string_lossy().into(),
                preview_token: preview.preview_token.clone(),
                confirmation: "yes".into()
            }
        )
        .unwrap_err()
        .code,
        Code::ConfirmationRequired
    );
    account(&mut c, "changed");
    let after = archive::dump(&c).unwrap();
    assert_eq!(
        restore::prepare(
            &c,
            target.path(),
            restore::RestoreRequest {
                source: archive.to_string_lossy().into(),
                preview_token: preview.preview_token,
                confirmation: "REPLACE ENTIRE JOURNAL".into()
            }
        )
        .unwrap_err()
        .code,
        Code::StalePreview
    );
    assert_eq!(archive::dump(&c).unwrap(), after);
    assert!(!target.path().join("data-controls-pending.json").exists());
}
#[test]
fn restore_waits_for_exclusive_restart_then_preserves_ids_and_safety_copy() {
    let source = tempfile::tempdir().unwrap();
    let archive = backup_with_account(source.path(), "incoming");
    let inspected = archive::inspect_to(&archive, source.path()).unwrap();
    let incoming = archive::dump(
        &archive::readonly(&inspected.directory.path().join("journal.sqlite")).unwrap(),
    )
    .unwrap();
    let target = tempfile::tempdir().unwrap();
    let path = target.path().join(db::DB_FILE_NAME);
    let rt = crate::runtime::Runtime::start(Ok(path.clone()));
    rt.with(|c| {
        account(c, "old");
        Ok(())
    })
    .unwrap();
    let preview = rt
        .with_controls(|c, root| {
            restore::inspect(
                c,
                root,
                restore::InspectRequest {
                    source: archive.to_string_lossy().into(),
                },
            )
        })
        .unwrap();
    let result = rt
        .prepare_restore(restore::RestoreRequest {
            source: archive.to_string_lossy().into(),
            preview_token: preview.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        })
        .unwrap();
    assert_eq!(result.state, "restart_required");
    assert!(rt.with(|_| Ok(())).is_err());
    assert!(rt.begin_initialize());
    assert_eq!(rt.initialize().state, crate::runtime::RuntimeState::Ready);
    rt.with_controls(|c, _| {
        assert_eq!(archive::dump(c).unwrap(), incoming);
        Ok(())
    })
    .unwrap();
    assert!(
        target
            .path()
            .join("data-controls")
            .join(result.safety_backup_id)
            .join("safety.db")
            .exists()
    );
    assert!(!target.path().join("data-controls-pending.json").exists());
}
#[test]
fn failed_swap_and_interrupted_install_restore_the_original_journal() {
    let source = tempfile::tempdir().unwrap();
    let archive = backup_with_account(source.path(), "incoming");
    for crash in [false, true] {
        let target = tempfile::tempdir().unwrap();
        let path = target.path().join(db::DB_FILE_NAME);
        let mut c = journal(&path);
        account(&mut c, "original");
        let before = archive::dump(&c).unwrap();
        let p = restore::inspect(
            &c,
            target.path(),
            restore::InspectRequest {
                source: archive.to_string_lossy().into(),
            },
        )
        .unwrap();
        restore::prepare(
            &c,
            target.path(),
            restore::RestoreRequest {
                source: archive.to_string_lossy().into(),
                preview_token: p.preview_token,
                confirmation: "REPLACE ENTIRE JOURNAL".into(),
            },
        )
        .unwrap();
        drop(c);
        if crash {
            let marker = target.path().join("data-controls-pending.json");
            let text = fs::read_to_string(&marker)
                .unwrap()
                .replace("prepared", "installing");
            fs::write(&marker, text).unwrap();
            fs::write(&path, b"interrupted overwrite").unwrap();
            restore::recover(target.path(), &path).unwrap();
        } else {
            assert!(restore::recover_failing(target.path(), &path).is_err());
        }
        let restored = journal(&path);
        assert_eq!(archive::dump(&restored).unwrap(), before);
        assert!(!target.path().join("data-controls-pending.json").exists());
    }
}
#[test]
fn second_runtime_cannot_access_a_journal_owned_by_another_process_handle() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DB_FILE_NAME);
    let first = crate::runtime::Runtime::start(Ok(path.clone()));
    assert_eq!(first.status().state, crate::runtime::RuntimeState::Ready);
    let second = crate::runtime::Runtime::start(Ok(path));
    assert_eq!(second.status().state, crate::runtime::RuntimeState::Failed);
    drop(first);
    assert!(second.begin_initialize());
    assert_eq!(
        second.initialize().state,
        crate::runtime::RuntimeState::Ready
    );
}
fn journal_note(c: &mut Connection, id: &str) -> String {
    crate::store::journal::create(
        c,
        crate::store::journal::JournalEntryInput {
            account_id: id.into(),
            trade_id: None,
            entry_at: "2026-10-19T14:00:00Z".into(),
            title: "note".into(),
            body: "private".into(),
            tags: vec!["shared-tag".into()],
        },
    )
    .unwrap()
    .id
}
fn image(c: &Connection, root: &Path, entry: &str, id: &str, key: &str) {
    let bytes = b"private screenshot";
    let hash = filesystem::digest(bytes);
    c.execute("INSERT OR IGNORE INTO attachments(id,kind,storage_key,mime_type,byte_size,sha256,created_at,updated_at) VALUES(?1,'screenshot',?2,'image/png',?3,?4,'t','t')",rusqlite::params![id,key,bytes.len() as i64,hash]).unwrap();
    c.execute("INSERT INTO attachment_links(id,attachment_id,journal_entry_id,created_at,updated_at) VALUES(?1,?2,?3,'t','t')",rusqlite::params![crate::domain::new_id(),id,entry]).unwrap();
    fs::create_dir_all(root.join("attachments")).unwrap();
    fs::write(root.join("attachments").join(key), bytes).unwrap();
}
fn approved(p: &deletion::DeletionPreview) -> deletion::DeleteRequest {
    deletion::DeleteRequest {
        scope: p.scope.clone(),
        preview_token: p.preview_token.clone(),
        confirmation: p.required_confirmation.clone(),
    }
}
#[test]
fn account_delete_counts_real_cascades_preserves_shared_data_and_other_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join("live.db"));
    let a = account(&mut c, "A");
    let b = account(&mut c, "B");
    let ja = journal_note(&mut c, &a);
    let jb = journal_note(&mut c, &b);
    image(&c, dir.path(), &ja, "shared", "shared.png");
    image(&c, dir.path(), &jb, "shared", "shared.png");
    image(&c, dir.path(), &ja, "private", "private.png");
    crate::store::ledger::create(
        &mut c,
        crate::store::ledger::LedgerEntryInput {
            account_id: a.clone(),
            kind: "payout".into(),
            amount: "-0.000001".into(),
            affects_balance: None,
            effective_at: "2026-10-19T14:00:00Z".into(),
            note: None,
        },
    )
    .unwrap();
    let p = deletion::preview(
        &c,
        dir.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Account {
                account_id: a.clone(),
            },
        },
    )
    .unwrap();
    assert!(p.blockers.is_empty(), "{:?}", p.blockers);
    assert_eq!(p.affected_entities["accounts"], 1);
    assert_eq!(p.affected_entities["ledger_revisions"], 1);
    assert_eq!(p.attachments.len(), 1);
    assert_eq!(p.attachments[0].id, "private");
    let result = deletion::execute(&mut c, dir.path(), approved(&p)).unwrap();
    assert_eq!(result.state, "completed");
    assert_eq!(archive::account_ids(&c).unwrap(), vec![b]);
    assert!(dir.path().join("attachments/shared.png").exists());
    assert!(!dir.path().join("attachments/private.png").exists());
    assert_eq!(
        c.query_row("SELECT count(*) FROM tags", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(
        !c.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap()
    );
}
#[test]
fn linked_and_phase_history_accounts_are_blocked_without_mutation() {
    for phase in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut c = journal(&dir.path().join("live.db"));
        let a = account(&mut c, "A");
        let b = account(&mut c, "B");
        if phase {
            c.execute("INSERT INTO account_phase_events(id,account_id,to_phase,recorded_at,source,actor) VALUES('phase',?1,'unknown','2026-10-19T14:00:00.000Z','user_entered','user')",[&a]).unwrap();
        } else {
            c.execute(
                "UPDATE accounts SET parent_account_id=?1 WHERE id=?2",
                rusqlite::params![a, b],
            )
            .unwrap();
        }
        let before = archive::dump(&c).unwrap();
        let p = deletion::preview(
            &c,
            dir.path(),
            deletion::PreviewRequest {
                scope: deletion::Scope::Account { account_id: a },
            },
        )
        .unwrap();
        assert!(!p.blockers.is_empty());
        assert!(deletion::execute(&mut c, dir.path(), approved(&p)).is_err());
        assert_eq!(archive::dump(&c).unwrap(), before);
    }
}
#[test]
fn account_delete_transaction_failure_rolls_back_and_cleanup_keeps_owned_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join("live.db"));
    let a = account(&mut c, "A");
    let j = journal_note(&mut c, &a);
    image(&c, dir.path(), &j, "image", "image.png");
    let p = deletion::preview(
        &c,
        dir.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Account { account_id: a },
        },
    )
    .unwrap();
    let before = archive::dump(&c).unwrap();
    // TEMP trigger is deliberately absent from the read-only preview's cloned main database.
    c.execute_batch("CREATE TEMP TRIGGER fail_delete BEFORE DELETE ON main.accounts BEGIN SELECT RAISE(ABORT,'disk failure'); END;").unwrap();
    assert!(deletion::execute(&mut c, dir.path(), approved(&p)).is_err());
    assert_eq!(archive::dump(&c).unwrap(), before);
    deletion::recover_cleanup(&c, dir.path()).unwrap();
    assert!(dir.path().join("attachments/image.png").exists());
}
#[test]
fn whole_journal_erase_is_distinct_atomic_and_cleans_managed_recovery_copies_only() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join("live.db"));
    let a = account(&mut c, "A");
    let j = journal_note(&mut c, &a);
    image(&c, dir.path(), &j, "image", "image.png");
    fs::write(
        dir.path().join("fundedflow.db.before-v14.bak"),
        b"old secret backup",
    )
    .unwrap();
    fs::write(dir.path().join("user-export.zip"), b"user controlled").unwrap();
    let p = deletion::preview(
        &c,
        dir.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Journal,
        },
    )
    .unwrap();
    assert_eq!(p.local_recovery_copies, 1);
    let mut wrong = approved(&p);
    wrong.confirmation = "DELETE ACCOUNT".into();
    assert_eq!(
        deletion::execute(&mut c, dir.path(), wrong)
            .unwrap_err()
            .code,
        Code::ConfirmationRequired
    );
    assert_eq!(
        deletion::execute(&mut c, dir.path(), approved(&p))
            .unwrap()
            .state,
        "completed"
    );
    assert!(archive::account_ids(&c).unwrap().is_empty());
    assert_eq!(
        c.query_row("SELECT count(*) FROM journal_entries", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert!(!dir.path().join("attachments/image.png").exists());
    assert!(!dir.path().join("fundedflow.db.before-v14.bak").exists());
    assert!(dir.path().join("user-export.zip").exists());
}
#[test]
fn deletion_stale_preview_and_missing_confirmation_cannot_erase_new_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join("live.db"));
    account(&mut c, "old");
    let p = deletion::preview(
        &c,
        dir.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Journal,
        },
    )
    .unwrap();
    account(&mut c, "new");
    let before = archive::dump(&c).unwrap();
    assert_eq!(
        deletion::execute(&mut c, dir.path(), approved(&p))
            .unwrap_err()
            .code,
        Code::StalePreview
    );
    assert_eq!(archive::dump(&c).unwrap(), before);
}
#[test]
fn interrupted_restore_recovers_conflicting_attachment_bytes_with_the_original_database() {
    let source = tempfile::tempdir().unwrap();
    let mut from = journal(&source.path().join("source.db"));
    let a = account(&mut from, "incoming");
    let j = journal_note(&mut from, &a);
    image(&from, source.path(), &j, "new-image", "same.png");
    let out = source.path().join("with-images.zip");
    archive::export(&from, &source.path().join("attachments"), &out, true).unwrap();
    for success in [false, true] {
        let target = tempfile::tempdir().unwrap();
        let path = target.path().join(db::DB_FILE_NAME);
        let mut c = journal(&path);
        let old = account(&mut c, "old");
        let j = journal_note(&mut c, &old);
        image(&c, target.path(), &j, "old-image", "same.png");
        let old_bytes = b"different original image";
        fs::write(target.path().join("attachments/same.png"), old_bytes).unwrap();
        c.execute(
            "UPDATE attachments SET sha256=?1,byte_size=?2 WHERE id='old-image'",
            rusqlite::params![filesystem::digest(old_bytes), old_bytes.len() as i64],
        )
        .unwrap();
        let before = archive::dump(&c).unwrap();
        let p = restore::inspect(
            &c,
            target.path(),
            restore::InspectRequest {
                source: out.to_string_lossy().into(),
            },
        )
        .unwrap();
        restore::prepare(
            &c,
            target.path(),
            restore::RestoreRequest {
                source: out.to_string_lossy().into(),
                preview_token: p.preview_token,
                confirmation: "REPLACE ENTIRE JOURNAL".into(),
            },
        )
        .unwrap();
        drop(c);
        if success {
            restore::recover(target.path(), &path).unwrap();
            assert_eq!(
                fs::read(target.path().join("attachments/same.png")).unwrap(),
                b"private screenshot"
            );
        } else {
            assert!(restore::recover_failing(target.path(), &path).is_err());
            let c = journal(&path);
            assert_eq!(archive::dump(&c).unwrap(), before);
            assert_eq!(
                fs::read(target.path().join("attachments/same.png")).unwrap(),
                old_bytes
            );
        }
    }
}
#[test]
fn committed_delete_reports_cleanup_pending_and_retry_is_safe() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join("live.db"));
    let a = account(&mut c, "A");
    let j = journal_note(&mut c, &a);
    image(&c, dir.path(), &j, "image", "image.png");
    let p = deletion::preview(
        &c,
        dir.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Account { account_id: a },
        },
    )
    .unwrap();
    let file = dir.path().join("attachments/image.png");
    fs::remove_file(&file).unwrap();
    fs::create_dir(&file).unwrap();
    assert_eq!(
        deletion::execute(&mut c, dir.path(), approved(&p))
            .unwrap()
            .state,
        "cleanup_pending"
    );
    assert!(archive::account_ids(&c).unwrap().is_empty());
    fs::remove_dir(&file).unwrap();
    fs::write(&file, b"pending bytes").unwrap();
    deletion::recover_cleanup(&c, dir.path()).unwrap();
    assert!(!file.exists());
    deletion::recover_cleanup(&c, dir.path()).unwrap();
}
#[test]
fn whole_journal_sqlite_write_failure_preserves_all_rows_and_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("live.db");
    let mut c = journal(&path);
    let a = account(&mut c, "A");
    let j = journal_note(&mut c, &a);
    image(&c, dir.path(), &j, "image", "image.png");
    let before = archive::dump(&c).unwrap();
    drop(c);
    let mut read_only = archive::readonly(&path).unwrap();
    let p = deletion::preview(
        &read_only,
        dir.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Journal,
        },
    )
    .unwrap();
    assert!(deletion::execute(&mut read_only, dir.path(), approved(&p)).is_err());
    assert_eq!(archive::dump(&read_only).unwrap(), before);
    deletion::recover_cleanup(&read_only, dir.path()).unwrap();
    assert!(dir.path().join("attachments/image.png").exists());
}
#[test]
fn financial_evidence_corrections_reconciliation_and_ledger_provenance_roundtrip_losslessly() {
    use crate::store::{evidence, ledger, reconciliation};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("live.db");
    let mut c = journal(&path);
    let a = account(&mut c, "financial");
    let input = |kind: &str, value: &str, at: &str| evidence::ObservationInput {
        account_id: a.clone(),
        kind: kind.into(),
        value: Some(value.into()),
        currency: "USD".into(),
        basis: "balance".into(),
        observed_at: at.into(),
        source_category: "firm_dashboard".into(),
        source_reference: "synthetic dashboard".into(),
        confirmation: "user_confirmed".into(),
        confidence: "user_reported".into(),
        valid_until: None,
        actor: "tester".into(),
        note: None,
    };
    let baseline = evidence::create(
        &mut c,
        input("opening_balance", "50000", "2026-10-19T00:00:00Z"),
    )
    .unwrap();
    let observed = evidence::create(
        &mut c,
        input("balance", "49999.999999", "2026-10-20T00:00:00Z"),
    )
    .unwrap();
    let corrected = evidence::correct(
        &mut c,
        &observed.id,
        evidence::ObservationCorrection {
            replacement: input("balance", "49999.999998", "2026-10-20T00:00:00Z"),
            reason: "source correction".into(),
        },
    )
    .unwrap();
    ledger::create(
        &mut c,
        ledger::LedgerEntryInput {
            account_id: a.clone(),
            kind: "payout".into(),
            amount: "-0.000002".into(),
            affects_balance: None,
            effective_at: "2026-10-19T14:00:00Z".into(),
            note: None,
        },
    )
    .unwrap();
    let result = reconciliation::create(
        &mut c,
        reconciliation::ReconciliationRequest {
            account_id: a.clone(),
            observation_id: corrected.id,
            baseline_observation_id: baseline.id,
            as_of: "2026-10-20T00:00:00.000Z".into(),
            evaluated_at: "2026-10-20T00:00:00.000Z".into(),
            coverage: reconciliation::Coverage {
                baseline: "available".into(),
                closed_trades: "available".into(),
                fees: "available".into(),
                ledger: "available".into(),
                open_positions: "missing".into(),
                eod_history: "missing".into(),
                intraday_history: "unsupported".into(),
                source_reference: "synthetic checked interval".into(),
            },
        },
    )
    .unwrap();
    reconciliation::resolve(
        &mut c,
        &result.id,
        reconciliation::ResolutionInput {
            status: "reviewed".into(),
            actor: "tester".into(),
            reason: "checked".into(),
        },
    )
    .unwrap();
    let before = archive::dump(&c).unwrap();
    let out = dir.path().join("financial.zip");
    archive::export(&c, &dir.path().join("attachments"), &out, true).unwrap();
    let imported = archive::inspect_to(&out, dir.path()).unwrap();
    let restored = archive::readonly(&imported.directory.path().join("journal.sqlite")).unwrap();
    assert_eq!(archive::dump(&restored).unwrap(), before);
    let trigger: String = c
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='observation_no_update'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    c.execute_batch("DROP TRIGGER observation_no_update")
        .unwrap();
    c.execute("UPDATE financial_observations SET payload_json=json_set(payload_json,'$.accountId','another-attempt') WHERE id=?1",[observed.id]).unwrap();
    c.execute_batch(&trigger).unwrap();
    assert_eq!(
        archive::export(
            &c,
            &dir.path().join("attachments"),
            &dir.path().join("bad.zip"),
            true
        )
        .unwrap_err()
        .code,
        Code::Integrity
    );
}
#[test]
fn interrupted_inspection_workspace_is_private_managed_and_included_in_whole_erasure() {
    let source = tempfile::tempdir().unwrap();
    let archive = backup_with_account(source.path(), "incoming");
    let target = tempfile::tempdir().unwrap();
    let mut c = journal(&target.path().join("live.db"));
    restore::inspect(
        &c,
        target.path(),
        restore::InspectRequest {
            source: archive.to_string_lossy().into(),
        },
    )
    .unwrap();
    let work = target.path().join("data-controls-work");
    assert!(work.is_dir());
    fs::write(
        work.join("interrupted-inspection"),
        b"private old checkpoint",
    )
    .unwrap();
    let p = deletion::preview(
        &c,
        target.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Journal,
        },
    )
    .unwrap();
    assert_eq!(p.local_recovery_copies, 1);
    assert_eq!(
        deletion::execute(&mut c, target.path(), approved(&p))
            .unwrap()
            .state,
        "completed"
    );
    assert!(!work.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let safety = target.path().join("data-controls-cleanup");
        assert_eq!(
            fs::metadata(safety).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
}
#[test]
fn csv_native_request_requires_explicit_all_or_account_scope() {
    assert!(
        serde_json::from_value::<CsvExportRequest>(
            serde_json::json!({"destination":"chosen.csv","acknowledgePlaintext":true})
        )
        .is_err()
    );
    assert!(serde_json::from_value::<CsvExportRequest>(serde_json::json!({"destination":"chosen.csv","accountId":null,"acknowledgePlaintext":true})).is_ok());
}
#[test]
fn archived_failed_passed_attempts_reset_lineage_and_reused_numbers_survive_restore() {
    use crate::store::attempts::{self, ResetInput, RulebookDecision};
    let reset = |c: &mut Connection, from: &str, outcome: &str, name: &str| {
        attempts::reset(
            c,
            ResetInput {
                predecessor_account_id: from.into(),
                prior_outcome: outcome.into(),
                effective_at: "2026-10-20T15:00:00-04:00".into(),
                reason: None,
                source: "provider_email".into(),
                name: name.into(),
                external_ref: Some("ABC-123".into()),
                starting_balance: "50000".into(),
                catalogue: None,
                rulebook: RulebookDecision::DecideLater,
                notes: None,
            },
        )
        .unwrap()
        .successor
        .id
    };
    let source = tempfile::tempdir().unwrap();
    let mut c = journal(&source.path().join("source.db"));
    let first = account(&mut c, "Attempt 1");
    let second = reset(&mut c, &first, "failed", "Attempt 2");
    let third = reset(&mut c, &second, "passed", "Attempt 3");
    accounts::archive(&mut c, &first).unwrap();
    c.execute("INSERT INTO account_phase_events(id,account_id,to_phase,recorded_at,source,actor) VALUES('phase',?1,'unknown','2026-10-21T14:00:00.000Z','user_entered','user')",[&third]).unwrap();
    let expected = archive::dump(&c).unwrap();
    let lineage = attempts::lineage(&c, &third).unwrap();
    let path = source.path().join("backup.zip");
    archive::export(&c, &source.path().join("attachments"), &path, true).unwrap();
    drop(c);

    let target = tempfile::tempdir().unwrap();
    let rt = crate::runtime::Runtime::start(Ok(target.path().join(db::DB_FILE_NAME)));
    let preview = rt
        .with_controls(|c, root| restore::inspect(c, root, restore::InspectRequest { source: path.to_string_lossy().into() }))
        .unwrap();
    assert_eq!(preview.manifest.entities["account_attempt_links"], 2);
    assert_eq!(preview.manifest.entities["account_archive_events"], 1);
    assert_eq!(preview.manifest.entities["account_phase_events"], 1);
    rt.prepare_restore(restore::RestoreRequest {
        source: path.to_string_lossy().into(),
        preview_token: preview.preview_token,
        confirmation: "REPLACE ENTIRE JOURNAL".into(),
    })
    .unwrap();
    assert!(rt.begin_initialize());
    assert_eq!(rt.initialize().state, crate::runtime::RuntimeState::Ready);
    rt.with_controls(|c, _| {
        assert_eq!(archive::dump(c).unwrap(), expected);
        let restored = attempts::lineage(c, &third).unwrap();
        assert_eq!(restored, lineage);
        let states: Vec<_> = restored
            .iter()
            .map(|a| (a.account_id.as_str(), a.status.as_str(), a.archived_at.is_some(), a.external_ref.as_deref()))
            .collect();
        assert_eq!(
            states,
            [
                (first.as_str(), "failed", true, None),
                (second.as_str(), "passed", false, Some("ABC-123")),
                (third.as_str(), "active", false, Some("ABC-123")),
            ]
        );
        Ok(())
    })
    .unwrap();
}
#[test]
fn an_unreadable_staged_restore_is_abandoned_without_touching_the_original() {
    let source = tempfile::tempdir().unwrap();
    let archive = backup_with_account(source.path(), "incoming");
    let target = tempfile::tempdir().unwrap();
    let path = target.path().join(db::DB_FILE_NAME);
    let mut c = journal(&path);
    account(&mut c, "original");
    let before = archive::dump(&c).unwrap();
    let p = restore::inspect(&c, target.path(), restore::InspectRequest { source: archive.to_string_lossy().into() }).unwrap();
    let staged = restore::prepare(
        &c,
        target.path(),
        restore::RestoreRequest {
            source: archive.to_string_lossy().into(),
            preview_token: p.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        },
    )
    .unwrap();
    drop(c);
    let op = target.path().join("data-controls").join(&staged.operation_id);
    fs::write(op.join("candidate.db"), b"damaged after staging").unwrap();
    // The first start reports the abandoned restore; nothing was replaced.
    assert_eq!(restore::recover(target.path(), &path).unwrap_err().code, Code::RecoveryRequired);
    assert!(!target.path().join("data-controls-pending.json").exists());
    assert!(op.join("safety.db").exists());
    // The next start opens the original journal.
    restore::recover(target.path(), &path).unwrap();
    assert_eq!(archive::dump(&journal(&path)).unwrap(), before);
}
/// A journal whose file is mostly free pages: over 64 MiB on disk, a few KiB of live data.
fn bloated(path: &Path) -> Connection {
    let mut c = journal(path);
    account(&mut c, "bloated");
    let filler = format!("\"{}\"", "x".repeat(1024 * 1024));
    for i in 0..72 {
        c.execute(
            "INSERT INTO settings(key,value_json,updated_at) VALUES(?1,?2,'t')",
            rusqlite::params![format!("filler-{i}"), filler],
        )
        .unwrap();
    }
    // A row after the gap, so a renumbered rowid would show in the dump.
    c.execute("INSERT INTO settings(key,value_json,updated_at) VALUES('kept','1','t')", [])
        .unwrap();
    c.execute("DELETE FROM settings WHERE key LIKE 'filler-%'", []).unwrap();
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    c
}
fn pages(c: &Connection) -> (i64, i64) {
    let get = |name| c.pragma_query_value(None, name, |r| r.get::<_, i64>(0)).unwrap();
    (get("page_count"), get("freelist_count"))
}
#[test]
fn free_pages_do_not_count_toward_live_caps_and_the_live_journal_is_never_vacuumed() {
    let target = tempfile::tempdir().unwrap();
    let live = target.path().join(db::DB_FILE_NAME);
    let c = bloated(&live);
    let page_size: i64 = c.pragma_query_value(None, "page_size", |r| r.get(0)).unwrap();
    let before = pages(&c);
    assert!(before.0 * page_size > filesystem::MAX_ENTRY as i64);
    assert!((before.0 - before.1) * page_size < 8 * 1024 * 1024, "{before:?} x {page_size}");
    let data = archive::dump(&c).unwrap();
    deletion::preview(&c, target.path(), deletion::PreviewRequest { scope: deletion::Scope::Journal }).unwrap();
    let out = target.path().join("bloated.zip");
    archive::export(&c, &target.path().join("attachments"), &out, true).unwrap();
    let exported = archive::inspect_to(&out, target.path()).unwrap();
    let image = exported.directory.path().join("journal.sqlite");
    assert!(fs::metadata(&image).unwrap().len() < 8 * 1024 * 1024);
    assert_eq!(archive::dump(&archive::readonly(&image).unwrap()).unwrap(), data);
    assert_eq!(pages(&c), before);
    // Restoring a small archive over the bloated journal snapshots it as the safety copy.
    let source = tempfile::tempdir().unwrap();
    let mut s = journal(&source.path().join("source.db"));
    account(&mut s, "incoming");
    let incoming = source.path().join("incoming.zip");
    archive::export(&s, &source.path().join("attachments"), &incoming, true).unwrap();
    let p = restore::inspect(&c, target.path(), restore::InspectRequest { source: incoming.to_string_lossy().into() })
        .unwrap();
    restore::prepare(
        &c,
        target.path(),
        restore::RestoreRequest {
            source: incoming.to_string_lossy().into(),
            preview_token: p.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        },
    )
    .unwrap();
    assert_eq!(pages(&c), before);
    assert_eq!(archive::dump(&c).unwrap(), data);
}
#[test]
fn a_journal_over_a_real_cap_names_the_component_and_measured_value() {
    let dir = tempfile::tempdir().unwrap();
    let c = journal(&dir.path().join("live.db"));
    let filler = format!("\"{}\"", "x".repeat(1024 * 1024));
    for i in 0..66 {
        c.execute(
            "INSERT INTO settings(key,value_json,updated_at) VALUES(?1,?2,'t')",
            rusqlite::params![format!("filler-{i}"), filler],
        )
        .unwrap();
    }
    let dumped = archive::dump(&c).unwrap_err();
    assert_eq!(dumped.code, Code::LimitExceeded);
    let detail = dumped.detail.unwrap();
    assert!(detail.starts_with("database pages: "), "{detail}");
    assert!(detail.ends_with(" bytes, limit 67108864 bytes"), "{detail}");
    let measured: u64 = detail["database pages: ".len()..].split(' ').next().unwrap().parse().unwrap();
    assert!(measured > filesystem::MAX_ENTRY);
    let exported = archive::export(&c, &dir.path().join("attachments"), &dir.path().join("out.zip"), true).unwrap_err();
    assert_eq!(exported.code, Code::LimitExceeded);
    assert!(exported.detail.unwrap().starts_with("database pages: "));
    // Errors without detail serialize exactly as before.
    assert_eq!(
        serde_json::to_value(fail(Code::Busy)).unwrap(),
        serde_json::json!({"code": "busy", "message": "Another FundedFlow process owns this journal."})
    );
}
/// A journal whose data in use exceeds the 64 MiB archive entry cap.
fn heavy(path: &Path) -> Connection {
    let mut c = journal(path);
    account(&mut c, "heavy");
    let filler = format!("\"{}\"", "x".repeat(1024 * 1024));
    for i in 0..66 {
        c.execute(
            "INSERT INTO settings(key,value_json,updated_at) VALUES(?1,?2,'t')",
            rusqlite::params![format!("filler-{i}"), filler],
        )
        .unwrap();
    }
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    c
}
fn live_bytes(c: &Connection) -> u64 {
    let get = |name| c.pragma_query_value(None, name, |r| r.get::<_, i64>(0)).unwrap() as u64;
    get("page_count") * get("page_size")
}
#[test]
fn over_cap_journals_can_be_previewed_for_erase_and_restore() {
    let source = tempfile::tempdir().unwrap();
    let incoming = backup_with_account(source.path(), "incoming");
    let target = tempfile::tempdir().unwrap();
    let c = heavy(&target.path().join(db::DB_FILE_NAME));
    assert_eq!(archive::dump(&c).unwrap_err().code, Code::LimitExceeded);
    let erase = deletion::preview(&c, target.path(), deletion::PreviewRequest { scope: deletion::Scope::Journal }).unwrap();
    let settings: i64 = c.query_row("SELECT count(*) FROM settings", [], |r| r.get(0)).unwrap();
    assert_eq!(erase.affected_entities["settings"], settings as u64);
    assert_eq!(erase.affected_entities["accounts"], 1);
    let p = restore::inspect(&c, target.path(), restore::InspectRequest { source: incoming.to_string_lossy().into() }).unwrap();
    assert_eq!(p.replaced_entities, erase.affected_entities);
    assert_eq!(
        p.required_free_bytes,
        filesystem::MAX_TOTAL * 4 + 16 * 1024 * 1024 + 2 * live_bytes(&c)
    );
}
#[test]
fn restore_over_an_over_cap_journal_keeps_an_uncapped_safety_copy_and_rolls_back() {
    let source = tempfile::tempdir().unwrap();
    let incoming = backup_with_account(source.path(), "incoming");
    let incoming_data = {
        let inspected = archive::inspect_to(&incoming, source.path()).unwrap();
        archive::dump(&archive::readonly(&inspected.directory.path().join("journal.sqlite")).unwrap()).unwrap()
    };
    for fail_install in [false, true] {
        let target = tempfile::tempdir().unwrap();
        let live = target.path().join(db::DB_FILE_NAME);
        let c = heavy(&live);
        // Guard: the archive cap still applies to export.
        let out = target.path().join("heavy.zip");
        assert_eq!(
            archive::export(&c, &target.path().join("attachments"), &out, true).unwrap_err().code,
            Code::LimitExceeded
        );
        let request = || restore::InspectRequest { source: incoming.to_string_lossy().into() };
        let p = restore::inspect(&c, target.path(), request()).unwrap();
        let token = p.preview_token.clone();
        let result = restore::prepare(
            &c,
            target.path(),
            restore::RestoreRequest {
                source: incoming.to_string_lossy().into(),
                preview_token: p.preview_token,
                confirmation: "REPLACE ENTIRE JOURNAL".into(),
            },
        )
        .unwrap();
        let safety = target.path().join("data-controls").join(&result.operation_id).join("safety.db");
        assert!(fs::metadata(&safety).unwrap().len() > filesystem::MAX_ENTRY);
        drop(c);
        if fail_install {
            assert!(restore::recover_failing(target.path(), &live).is_err());
            let restored = journal(&live);
            // Same content hash as before the restore: the same archive gives the same preview token.
            assert_eq!(restore::inspect(&restored, target.path(), request()).unwrap().preview_token, token);
        } else {
            restore::recover(target.path(), &live).unwrap();
            assert_eq!(archive::dump(&journal(&live)).unwrap(), incoming_data);
        }
        assert!(!target.path().join("data-controls-pending.json").exists());
    }
}
#[test]
fn restore_space_figures_come_from_one_pure_calculation() {
    // 10 pages of 4096 bytes: twice the live journal is 81920 bytes.
    assert_eq!(
        restore::required(10, 4096),
        restore::Required {
            inspect_check: 4 * filesystem::MAX_TOTAL + 81_920,
            advertised: 4 * filesystem::MAX_TOTAL + 16 * 1024 * 1024 + 81_920,
            prepare_check: 81_920,
        }
    );
    assert_eq!(restore::required(10, 4096).advertised, 1_090_519_040 + 81_920);
}
#[test]
fn inspect_and_prepare_refuse_too_little_space_before_any_restore_intent() {
    let source = tempfile::tempdir().unwrap();
    let incoming = backup_with_account(source.path(), "incoming");
    let target = tempfile::tempdir().unwrap();
    let c = heavy(&target.path().join(db::DB_FILE_NAME));
    let request = || restore::InspectRequest { source: incoming.to_string_lossy().into() };
    let get = |name| c.pragma_query_value(None, name, |r| r.get::<_, i64>(0)).unwrap() as u64;
    let required = restore::required(get("page_count"), get("page_size"));
    assert!(required.prepare_check > 2 * filesystem::MAX_ENTRY);
    // Inspect reports, and itself enforces, the figure that includes twice the live journal.
    let short = |_: &Path| Ok(required.advertised - 1);
    assert_eq!(
        restore::inspect_with(&c, target.path(), request(), &short).unwrap_err().code,
        Code::InsufficientSpace
    );
    let exact = |_: &Path| Ok(required.advertised);
    let p = restore::inspect_with(&c, target.path(), request(), &exact).unwrap();
    assert_eq!(p.required_free_bytes, required.advertised);
    // Space runs out at the operation folder between preview and the safety copy.
    let operations = target.path().join("data-controls");
    let shrinking = |dir: &Path| Ok(if dir.starts_with(&operations) { required.prepare_check } else { u64::MAX });
    let before = archive::content_hash(&c).unwrap();
    let refused = restore::prepare_with(
        &c,
        target.path(),
        restore::RestoreRequest {
            source: incoming.to_string_lossy().into(),
            preview_token: p.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        },
        &shrinking,
    )
    .unwrap_err();
    assert_eq!(refused.code, Code::InsufficientSpace);
    assert!(!target.path().join("data-controls-pending.json").exists());
    for op in fs::read_dir(&operations).unwrap() {
        assert!(!op.unwrap().path().join("safety.db").exists());
    }
    assert_eq!(archive::content_hash(&c).unwrap(), before);
}
#[test]
fn content_hash_framing_separates_types_cells_and_rowids() {
    let hash = |sql: &str| {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(&format!("CREATE TABLE t(a,b); {sql}")).unwrap();
        archive::content_hash(&c).unwrap()
    };
    let base = hash("INSERT INTO t VALUES(1,NULL);");
    assert_ne!(base, hash("INSERT INTO t VALUES('1',NULL);"), "Integer 1 vs Text '1'");
    assert_ne!(base, hash("INSERT INTO t VALUES(NULL,1);"), "value moved to the next cell");
    assert_ne!(hash("INSERT INTO t VALUES('ab','c');"), hash("INSERT INTO t VALUES('a','bc');"));
    assert_ne!(base, hash("INSERT INTO t(rowid,a,b) VALUES(7,1,NULL);"), "rowid only");
    assert_eq!(base, hash("INSERT INTO t VALUES(1,NULL);"));
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE t(a); INSERT INTO t VALUES(CAST(x'ff' AS TEXT));").unwrap();
    assert_eq!(archive::content_hash(&c).unwrap_err().code, Code::Integrity);
    assert_eq!(archive::dump(&c).unwrap_err().code, Code::Integrity);
}
#[test]
fn preview_tokens_change_when_any_row_or_rowid_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join(db::DB_FILE_NAME));
    account(&mut c, "a");
    let token = |c: &Connection| {
        deletion::preview(c, dir.path(), deletion::PreviewRequest { scope: deletion::Scope::Journal })
            .unwrap()
            .preview_token
    };
    let first = token(&c);
    assert_eq!(token(&c), first);
    c.execute("INSERT INTO settings(key,value_json,updated_at) VALUES('k','1','t')", []).unwrap();
    let second = token(&c);
    assert_ne!(second, first);
    c.execute("UPDATE settings SET rowid=rowid+100 WHERE key='k'", []).unwrap();
    assert_ne!(token(&c), second, "rowid only");
}
fn queue(root: &Path) -> std::path::PathBuf {
    root.join("data-controls-cleanup")
}
fn quarantine(root: &Path) -> std::path::PathBuf {
    root.join("data-controls-quarantine")
}
fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|d| d.map(|e| e.unwrap().file_name().into_string().unwrap()).collect())
        .unwrap_or_default();
    names.sort();
    names
}
/// A cleanup marker as any build writes it (camelCase `Cleanup`).
fn marker_json(op: &str, whole: bool, attachments: &[(String, String)], copies: &[&str]) -> Vec<u8> {
    let attachments: Vec<_> = attachments
        .iter()
        .map(|(id, key)| serde_json::json!({"id": id, "storageKey": key, "byteSize": 1, "sha256": "0".repeat(64)}))
        .collect();
    serde_json::to_vec(&serde_json::json!({
        "operationId": op, "wholeJournal": whole, "attachments": attachments, "recoveryCopies": copies,
    }))
    .unwrap()
}
fn put_marker(root: &Path, name: &str, bytes: &[u8]) {
    fs::create_dir_all(queue(root)).unwrap();
    fs::write(queue(root).join(name), bytes).unwrap();
}
#[test]
fn a_valid_marker_over_one_mib_from_an_older_build_is_processed_not_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let c = journal(&dir.path().join("live.db"));
    fs::create_dir_all(dir.path().join("attachments")).unwrap();
    fs::write(dir.path().join("attachments/unowned.png"), b"left over").unwrap();
    let mut listed = vec![("unowned".to_string(), "unowned.png".to_string())];
    listed.extend((0..6000).map(|i| (format!("gone-{i}"), format!("{}-{i}.png", "k".repeat(120)))));
    let bytes = marker_json(&crate::domain::new_id(), false, &listed, &[]);
    assert!(bytes.len() > 1024 * 1024);
    put_marker(dir.path(), "big.json", &bytes);
    deletion::recover_cleanup(&c, dir.path()).unwrap();
    assert!(!dir.path().join("attachments/unowned.png").exists());
    assert!(entries(&queue(dir.path())).is_empty());
    assert!(!quarantine(dir.path()).exists());
}
#[test]
fn an_erase_listing_thousands_of_attachments_completes_its_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = journal(&dir.path().join("live.db"));
    account(&mut c, "A");
    let bytes = b"x";
    let hash = filesystem::digest(bytes);
    fs::create_dir_all(dir.path().join("attachments")).unwrap();
    let tx = c.transaction().unwrap();
    for i in 0..4500 {
        let key = format!("{}-{i}.png", "k".repeat(120));
        tx.execute(
            "INSERT INTO attachments(id,kind,storage_key,mime_type,byte_size,sha256,created_at,updated_at) VALUES(?1,'screenshot',?2,'image/png',1,?3,'t','t')",
            rusqlite::params![format!("att-{i}"), key, hash],
        )
        .unwrap();
        fs::write(dir.path().join("attachments").join(&key), bytes).unwrap();
    }
    tx.commit().unwrap();
    let p = deletion::preview(&c, dir.path(), deletion::PreviewRequest { scope: deletion::Scope::Journal }).unwrap();
    assert_eq!(p.attachments.len(), 4500);
    assert_eq!(deletion::execute(&mut c, dir.path(), approved(&p)).unwrap().state, "completed");
    assert!(entries(&dir.path().join("attachments")).is_empty());
    assert!(entries(&queue(dir.path())).is_empty());
}
#[test]
fn an_unparseable_marker_is_quarantined_never_deleted_and_never_blocks() {
    let dir = tempfile::tempdir().unwrap();
    let c = journal(&dir.path().join("live.db"));
    let op = crate::domain::new_id();
    put_marker(dir.path(), &format!("{op}.json"), b"");
    deletion::recover_cleanup(&c, dir.path()).unwrap();
    assert!(entries(&queue(dir.path())).is_empty());
    let held = entries(&quarantine(dir.path()));
    assert_eq!(held.len(), 1);
    assert_eq!(fs::read(quarantine(dir.path()).join(&held[0])).unwrap(), b"");
    // The same file name again keeps both quarantined copies.
    put_marker(dir.path(), &format!("{op}.json"), b"{\"truncated");
    deletion::recover_cleanup(&c, dir.path()).unwrap();
    let held = entries(&quarantine(dir.path()));
    assert_eq!(held.len(), 2);
    let contents: std::collections::BTreeSet<Vec<u8>> = held.iter().map(|n| fs::read(quarantine(dir.path()).join(n)).unwrap()).collect();
    assert_eq!(contents, std::collections::BTreeSet::from([b"".to_vec(), b"{\"truncated".to_vec()]));
}
#[test]
fn one_marker_that_cannot_finish_does_not_stop_the_next() {
    let dir = tempfile::tempdir().unwrap();
    let c = journal(&dir.path().join("live.db"));
    let attachments = dir.path().join("attachments");
    fs::create_dir_all(attachments.join("stuck.png")).unwrap();
    fs::write(attachments.join("free.png"), b"unowned").unwrap();
    let stuck = format!("{}.json", "00000000-0000-4000-8000-000000000001");
    let free = format!("{}.json", "ffffffff-ffff-4fff-bfff-ffffffffffff");
    put_marker(dir.path(), &stuck, &marker_json("00000000-0000-4000-8000-000000000001", false, &[("s".into(), "stuck.png".into())], &[]));
    put_marker(dir.path(), &free, &marker_json("ffffffff-ffff-4fff-bfff-ffffffffffff", false, &[("f".into(), "free.png".into())], &[]));
    let _ = deletion::recover_cleanup(&c, dir.path());
    assert!(!attachments.join("free.png").exists(), "the second marker was processed");
    assert_eq!(entries(&queue(dir.path())), vec![stuck]);
    assert!(attachments.join("stuck.png").is_dir(), "nothing deleted for the pending marker");
}
#[test]
fn whole_journal_erase_removes_the_quarantine_and_account_deletion_keeps_it() {
    for whole in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut c = journal(&dir.path().join("live.db"));
        let a = account(&mut c, "A");
        account(&mut c, "B");
        put_marker(dir.path(), &format!("{}.json", crate::domain::new_id()), b"not json");
        deletion::recover_cleanup(&c, dir.path()).unwrap();
        assert_eq!(entries(&quarantine(dir.path())).len(), 1);
        let scope = if whole { deletion::Scope::Journal } else { deletion::Scope::Account { account_id: a } };
        let p = deletion::preview(&c, dir.path(), deletion::PreviewRequest { scope }).unwrap();
        assert_eq!(deletion::execute(&mut c, dir.path(), approved(&p)).unwrap().state, "completed");
        assert_eq!(quarantine(dir.path()).exists(), !whole, "whole journal: {whole}");
    }
}
/// The cleanup marker exactly as the 92e7980 build reads it (`deletion.rs:49-56`).
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct OldCleanup {
    operation_id: String,
    whole_journal: bool,
    attachments: Vec<super::Attachment>,
    recovery_copies: Vec<String>,
}
/// The 92e7980 recovery-copy allow-list (`deletion.rs:361-363`).
fn old_build_accepts(key: &str) -> bool {
    key == "data-controls-work"
        || key.starts_with("data-controls/")
        || (key.starts_with("fundedflow.db.before-v") && key.ends_with(".bak"))
}
#[test]
fn a_large_cleanup_is_split_into_markers_an_older_build_can_read() {
    let attachments: Vec<super::Attachment> = (0..6000)
        .map(|i| super::Attachment {
            id: format!("att-{i}"),
            storage_key: format!("{}-{i}.png", "k".repeat(120)),
            byte_size: 1,
            sha256: "0".repeat(64),
        })
        .collect();
    let cleanup = deletion::Cleanup {
        operation_id: crate::domain::new_id(),
        whole_journal: true,
        attachments: attachments.clone(),
        recovery_copies: vec!["data-controls-work".into(), "fundedflow.db.before-v14.bak".into()],
    };
    assert!(serde_json::to_vec(&cleanup).unwrap().len() > deletion::MARKER_LIMIT);
    let files = deletion::marker_files(&cleanup).unwrap();
    assert!(files.len() > 1);
    let parsed: Vec<OldCleanup> = files
        .iter()
        .map(|f| {
            assert!(f.len() <= deletion::MARKER_LIMIT, "{} bytes", f.len());
            serde_json::from_slice(f).unwrap()
        })
        .collect();
    assert!(parsed.iter().all(|m| m.operation_id == cleanup.operation_id && m.whole_journal));
    assert_eq!(parsed[0].recovery_copies, cleanup.recovery_copies);
    assert!(parsed[1..].iter().all(|m| m.recovery_copies.is_empty()));
    let rejoined: Vec<super::Attachment> = parsed.into_iter().flat_map(|m| m.attachments).collect();
    assert_eq!(rejoined, attachments);
    // A small cleanup stays one marker, byte-identical to the unsplit serialization.
    let small = deletion::Cleanup { attachments: attachments[..3].to_vec(), ..cleanup };
    assert_eq!(deletion::marker_files(&small).unwrap(), vec![serde_json::to_vec(&small).unwrap()]);
}
#[test]
fn marker_temp_files_are_created_in_the_data_root_never_in_the_queue() {
    let dir = tempfile::tempdir().unwrap();
    let op = crate::domain::new_id();
    let files = vec![b"{}".to_vec(), b"{}".to_vec()];
    let mut seen = Vec::new();
    deletion::write_markers(dir.path(), &op, &files, &mut |temp| {
        assert_eq!(temp.parent(), Some(dir.path()));
        assert!(!temp.starts_with(queue(dir.path())));
        seen.push(entries(&queue(dir.path())).len());
    })
    .unwrap();
    // Each temp file was observed before its marker appeared; only finished markers ever sit in the queue.
    assert_eq!(seen, vec![0, 1]);
    assert_eq!(entries(&queue(dir.path())), vec![format!("{op}-1.json"), format!("{op}-2.json")]);
    assert!(entries(dir.path()).iter().all(|n| n == "data-controls-cleanup"));
    // A name that already exists is never replaced.
    assert!(deletion::write_markers(dir.path(), &op, &files[..1], &mut |_| {}).is_ok());
    assert!(deletion::write_markers(dir.path(), &op, &files[..1], &mut |_| {}).is_err());
}
#[test]
fn markers_this_build_leaves_pending_are_readable_by_the_previous_build() {
    for whole in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut c = journal(&dir.path().join("live.db"));
        let a = account(&mut c, "A");
        let j = journal_note(&mut c, &a);
        image(&c, dir.path(), &j, "image", "image.png");
        fs::write(dir.path().join("fundedflow.db.before-v14.bak"), b"old backup").unwrap();
        let scope = if whole { deletion::Scope::Journal } else { deletion::Scope::Account { account_id: a } };
        let held = dir.path().join("data-controls").join(crate::domain::new_id());
        fs::create_dir_all(&held).unwrap();
        fs::write(held.join("held.bin"), b"x").unwrap();
        let p = deletion::preview(&c, dir.path(), deletion::PreviewRequest { scope }).unwrap();
        // Keep the marker queued. Account scope: its listed file is now a directory. Whole journal (whose
        // execute re-checks the attachment files): a listed recovery copy cannot be removed.
        #[cfg(windows)]
        let _lock = {
            use std::os::windows::fs::OpenOptionsExt;
            fs::OpenOptions::new().read(true).share_mode(0).open(held.join("held.bin")).unwrap()
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&held, fs::Permissions::from_mode(0o500)).unwrap();
        }
        if !whole {
            let file = dir.path().join("attachments/image.png");
            fs::remove_file(&file).unwrap();
            fs::create_dir(&file).unwrap();
        }
        assert_eq!(deletion::execute(&mut c, dir.path(), approved(&p)).unwrap().state, "cleanup_pending");
        let names = entries(&queue(dir.path()));
        assert_eq!(names.len(), 1);
        let old: OldCleanup = serde_json::from_slice(&fs::read(queue(dir.path()).join(&names[0])).unwrap()).unwrap();
        assert_eq!(old.whole_journal, whole);
        assert_eq!(old.attachments.len(), 1);
        assert!(old.recovery_copies.iter().all(|k| old_build_accepts(k)), "{:?}", old.recovery_copies);
        assert_eq!(old.recovery_copies.is_empty(), !whole);
        // A new erase or restore is refused while it is pending.
        assert_eq!(deletion::recover_cleanup(&c, dir.path()).unwrap(), deletion::CleanupOutcome::Pending);
        assert_eq!(deletion::cleanup_state(dir.path()), deletion::CleanupOutcome::Pending);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&held, fs::Permissions::from_mode(0o700)).unwrap();
        }
    }
}
