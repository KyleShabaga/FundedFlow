//! Build 24 integration against the current journal schema.
use super::{
    tests::{account, journal},
    *,
};
use crate::store::{accounts, attachments, daily_reviews, library, reviews, snapshots, trades};
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::Connection;
use std::{fs, path::Path};
struct Populated {
    c: Connection,
    account: String,
    other: String,
    screenshot: String,
    trade: String,
}
fn trade_input(id: &str) -> trades::TradeInput {
    trades::TradeInput {
        account_id: id.into(),
        symbol: "ESZ6".into(),
        side: "long".into(),
        quantity: "1".into(),
        entry_at: "2026-10-19T13:30:00Z".into(),
        entry_price: "5000.25".into(),
        exit_at: Some("2026-10-19T14:00:00Z".into()),
        exit_price: Some("5004.5".into()),
        fees: Some("4.12".into()),
        realized_pnl: None,
        notes: Some("original".into()),
    }
}
fn screenshot(c: &mut Connection, root: &Path, a: &str, t: &str, marker: u8) -> String {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    bytes.extend(2u32.to_be_bytes());
    bytes.extend(2u32.to_be_bytes());
    bytes.extend([8, 6, 0, 0, 0, 0, 0, 0, 0, marker]);
    attachments::add(
        c,
        root,
        attachments::ScreenshotInput {
            account_id: a.into(),
            trade_id: t.into(),
            file_name: Some("chart.png".into()),
            data_base64: STANDARD.encode(bytes),
        },
    )
    .unwrap()
    .id
}
fn populate(root: &Path) -> Populated {
    let mut c = journal(&root.join(crate::db::DB_FILE_NAME));
    let a = account(&mut c, "active");
    let b = account(&mut c, "archived");
    let t = trades::create(&mut c, trade_input(&a)).unwrap();
    let other = trades::create(&mut c, trade_input(&b)).unwrap();
    let mut corrected = trade_input(&a);
    corrected.notes = Some("corrected with provenance".into());
    trades::update(&mut c, &t.id, corrected).unwrap();
    let checklist = library::save_checklist(
        &mut c,
        None,
        library::ChecklistInput {
            name: "Trade process".into(),
            description: None,
            scope: "trade".into(),
            strategy_id: None,
            items: vec![library::ChecklistItemInput {
                id: None,
                label: "Check risk".into(),
            }],
        },
    )
    .unwrap();
    let input:reviews::ReviewInput=serde_json::from_value(serde_json::json!({"accountId":a,"tradeId":t.id,"checklistId":checklist.id,"reflection":"Recorded reflection","reviewed":true,"tagIds":[],"checklistResults":[{"itemId":checklist.items[0].id,"result":"followed","note":"done"}]})).unwrap();
    reviews::save(&mut c, Some(root), input).unwrap();
    let image = screenshot(&mut c, root, &a, &t.id, 1);
    screenshot(&mut c, root, &b, &other.id, 2);
    let daily = library::save_checklist(
        &mut c,
        None,
        library::ChecklistInput {
            name: "Daily process".into(),
            description: None,
            scope: "daily".into(),
            strategy_id: None,
            items: vec![library::ChecklistItemInput {
                id: None,
                label: "Review session".into(),
            }],
        },
    )
    .unwrap();
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-21T18:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    daily_reviews::save_at(
        &mut c,
        daily_reviews::DailyReviewInput {
            account_id: a.clone(),
            trading_day: t.trading_day.clone(),
            expected_revision: None,
            plan: daily_reviews::PlanInput {
                focus: Some("Wait for setup".into()),
                ..Default::default()
            },
            reflection: daily_reviews::ReflectionInput {
                key_lesson: Some("Retain this exact lesson".into()),
                ..Default::default()
            },
            no_trade_day: false,
            checklist_id: Some(daily.id),
            answers: vec![reviews::ChecklistAnswerInput {
                item_id: daily.items[0].id.clone(),
                result: "followed".into(),
                note: None,
            }],
            action: "complete".into(),
        },
        now,
    )
    .unwrap();
    let snapshot:snapshots::SnapshotInput=serde_json::from_value(serde_json::json!({"accountId":a,"tradingDay":t.trading_day,"isEndOfDay":true,"dataSource":"manual","engineVersion":"build24-fixture","inputsHash":"fixture-unknown","feesIncluded":false,"unrealizedIncluded":false,"balance":null,"realizedDayPnl":null,"drawdownLocked":null,"tradingDaysCompleted":null,"status":"unknown","statusReasons":["fixture_missing_evidence"],"explanation":{"fixture":"unavailable stays null"}})).unwrap();
    snapshots::save(&mut c, snapshot).unwrap();
    accounts::archive(&mut c, &b).unwrap();
    Populated {
        c,
        account: a,
        other: b,
        screenshot: image,
        trade: t.id,
    }
}
fn approved(p: &deletion::DeletionPreview) -> deletion::DeleteRequest {
    deletion::DeleteRequest {
        scope: p.scope.clone(),
        preview_token: p.preview_token.clone(),
        confirmation: p.required_confirmation.clone(),
    }
}
#[test]
fn current_schema_archive_restores_reviews_daily_history_corrections_screenshots_and_null_snapshots() {
    let source = tempfile::tempdir().unwrap();
    let p = populate(source.path());
    let before = archive::dump(&p.c).unwrap();
    for table in [
        "trade_reviews",
        "trade_corrections",
        "checklist_results",
        "daily_reviews",
        "daily_review_answers",
        "daily_review_trades",
        "daily_review_events",
        "attachments",
        "account_snapshots",
    ] {
        assert!(!before[table].rows.is_empty(), "{table}");
    }
    let out = source.path().join("complete.zip");
    archive::export(&p.c, &source.path().join("attachments"), &out, true).unwrap();
    let inspected = archive::inspect_to(&out, source.path()).unwrap();
    assert_eq!(inspected.manifest.schema_version, crate::db::latest_version());
    let target = tempfile::tempdir().unwrap();
    let live = target.path().join(crate::db::DB_FILE_NAME);
    let c = journal(&live);
    let preview = restore::inspect(
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
            preview_token: preview.preview_token,
            confirmation: "REPLACE ENTIRE JOURNAL".into(),
        },
    )
    .unwrap();
    drop(c);
    restore::recover(target.path(), &live).unwrap();
    let c = journal(&live);
    assert_eq!(archive::dump(&c).unwrap(), before);
    // The row dump can't see schema objects: the restored image keeps the current version and its triggers.
    let version: u32 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, crate::db::latest_version());
    for trigger in ["trg_programme_phases_rulebook_provider_insert", "trg_phase_paths_rulebook_provider_update", "trg_catalogue_source_facts_immutable"] {
        let found: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?1", [trigger], |r| r.get(0)).unwrap();
        assert_eq!(found, 1, "{trigger}");
    }
    assert!(
        reviews::get(&c, Some(target.path()), &p.account, &p.trade)
            .unwrap()
            .is_some()
    );
    for a in &inspected.manifest.attachments {
        assert_eq!(
            fs::read(target.path().join("attachments").join(&a.storage_key)).unwrap(),
            fs::read(source.path().join("attachments").join(&a.storage_key)).unwrap()
        );
    }
    assert!(
        accounts::get_any(&c, &p.other)
            .unwrap()
            .archived_at
            .is_some()
    );
}
#[test]
fn schema18_account_delete_counts_daily_history_and_removes_unlinked_owned_images_only() {
    let root = tempfile::tempdir().unwrap();
    let mut p = populate(root.path());
    // An owned screenshot may outlive its review link; ownership remains authoritative.
    attachments::remove(&mut p.c, &p.account, &p.screenshot).unwrap();
    p.c.execute(
        "DELETE FROM attachment_links WHERE attachment_id=?1",
        [&p.screenshot],
    )
    .unwrap();
    let owned = archive::attachments(&p.c)
        .unwrap()
        .into_iter()
        .find(|a| a.id == p.screenshot)
        .unwrap();
    let before = archive::dump(&p.c).unwrap();
    let preview = deletion::preview(
        &p.c,
        root.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Account {
                account_id: p.account.clone(),
            },
        },
    )
    .unwrap();
    assert!(preview.blockers.is_empty(), "{:?}", preview.blockers);
    for table in [
        "trade_reviews",
        "trade_corrections",
        "daily_reviews",
        "daily_review_answers",
        "daily_review_trades",
        "daily_review_events",
        "account_snapshots",
    ] {
        assert!(preview.affected_entities[table] > 0, "{table}");
    }
    assert!(preview.attachments.iter().any(|a| a.id == p.screenshot));
    assert_eq!(
        deletion::execute(&mut p.c, root.path(), approved(&preview))
            .unwrap()
            .state,
        "completed"
    );
    assert!(
        !root
            .path()
            .join("attachments")
            .join(owned.storage_key)
            .exists()
    );
    assert_eq!(archive::account_ids(&p.c).unwrap(), vec![p.other]);
    let after = archive::dump(&p.c).unwrap();
    assert_eq!(before["checklists"], after["checklists"]);
    assert_eq!(before["checklist_items"], after["checklist_items"]);
    assert_eq!(archive::attachments(&p.c).unwrap().len(), 1);
    archive::inventory(&p.c, &root.path().join("attachments")).unwrap();
}
#[test]
fn schema18_invalid_daily_trade_owner_is_rejected_without_schema_changes() {
    let root = tempfile::tempdir().unwrap();
    let p = populate(root.path());
    let trigger: String =
        p.c.query_row(
            "SELECT sql FROM sqlite_schema WHERE name='trg_daily_review_trades_same_account'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    p.c.execute_batch("DROP TRIGGER trg_daily_review_trades_same_account")
        .unwrap();
    p.c.execute("UPDATE daily_review_trades SET trade_id=(SELECT id FROM trades WHERE account_id=?1 LIMIT 1)",[p.other]).unwrap();
    p.c.execute_batch(&trigger).unwrap();
    let out = root.path().join("bad.zip");
    assert_eq!(
        archive::export(&p.c, &root.path().join("attachments"), &out, true)
            .unwrap_err()
            .code,
        Code::Integrity
    );
    assert!(!out.exists());
}
#[test]
fn populated_v8_rulebooks_upgrade_and_roundtrip_under_schema18() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(crate::db::DB_FILE_NAME);
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db/fixtures/fundedflow-v8-legacy-rules.db"),
        &path,
    )
    .unwrap();
    let c = journal(&path);
    let before = archive::dump(&c).unwrap();
    assert!(!before["rulebook_versions"].rows.is_empty());
    let out = root.path().join("versions.zip");
    archive::export(&c, &root.path().join("attachments"), &out, true).unwrap();
    let imported = archive::inspect_to(&out, root.path()).unwrap();
    let restored = archive::readonly(&imported.directory.path().join("journal.sqlite")).unwrap();
    assert_eq!(archive::dump(&restored).unwrap(), before);
}
#[test]
fn shared_rulebook_audit_history_blocks_account_delete_and_remains_exportable() {
    let root = tempfile::tempdir().unwrap();
    let mut c = journal(&root.path().join("live.db"));
    let a = account(&mut c, "historical assignment");
    let at = crate::domain::now();
    let provider = crate::domain::new_id();
    let book = crate::domain::new_id();
    c.execute("INSERT INTO providers(id,slug,display_name,record_status,created_at,updated_at) VALUES(?1,'shared-provider','Provider','active',?2,?2)",rusqlite::params![provider,at]).unwrap();
    c.execute("INSERT INTO rulebooks(id,provider_id,slug,display_name,record_status,created_at,updated_at) VALUES(?1,?2,'shared-book','Shared book','active',?3,?3)",rusqlite::params![book,provider,at]).unwrap();
    c.execute("INSERT INTO rulebook_events(id,rulebook_id,rulebook_version_id,account_id,assignment_id,action,actor,occurred_at) VALUES(?1,?2,?3,?4,?5,'assigned','local_user',?6)",rusqlite::params![crate::domain::new_id(),book,crate::domain::new_id(),a,crate::domain::new_id(),at]).unwrap();
    let before = archive::dump(&c).unwrap();
    let preview = deletion::preview(
        &c,
        root.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Account { account_id: a },
        },
    )
    .unwrap();
    assert!(
        preview
            .blockers
            .iter()
            .any(|b| b == "immutable_shared_rulebook_history")
    );
    assert_eq!(
        deletion::execute(&mut c, root.path(), approved(&preview))
            .unwrap_err()
            .code,
        Code::UnsupportedOwnership
    );
    assert_eq!(archive::dump(&c).unwrap(), before);
    let out = root.path().join("history.zip");
    archive::export(&c, &root.path().join("attachments"), &out, true).unwrap();
    let imported = archive::inspect_to(&out, root.path()).unwrap();
    let restored = archive::readonly(&imported.directory.path().join("journal.sqlite")).unwrap();
    assert_eq!(archive::dump(&restored).unwrap(), before);
}
#[test]
fn schema18_failed_account_delete_rolls_back_daily_and_trade_review_history() {
    let root = tempfile::tempdir().unwrap();
    let mut p = populate(root.path());
    let before = archive::dump(&p.c).unwrap();
    let images = archive::attachments(&p.c).unwrap();
    let preview = deletion::preview(
        &p.c,
        root.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Account {
                account_id: p.account,
            },
        },
    )
    .unwrap();
    assert!(preview.blockers.is_empty());
    p.c.execute_batch("CREATE TEMP TRIGGER fail_account_remove BEFORE DELETE ON main.daily_review_events BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
    assert!(deletion::execute(&mut p.c, root.path(), approved(&preview)).is_err());
    assert_eq!(archive::dump(&p.c).unwrap(), before);
    deletion::recover_cleanup(&p.c, root.path()).unwrap();
    for a in images {
        assert!(root.path().join("attachments").join(a.storage_key).exists());
    }
}
#[test]
fn foreign_owned_legacy_note_attachment_blocks_deletion_without_touching_its_owner() {
    let root = tempfile::tempdir().unwrap();
    let mut p = populate(root.path());
    let foreign: String =
        p.c.query_row(
            "SELECT id FROM attachments WHERE account_id=?1",
            [&p.other],
            |r| r.get(0),
        )
        .unwrap();
    let note = crate::store::journal::create(
        &mut p.c,
        crate::store::journal::JournalEntryInput {
            account_id: p.account.clone(),
            trade_id: None,
            entry_at: "2026-10-19T14:00:00Z".into(),
            title: "legacy note".into(),
            body: "preserve ownership".into(),
            tags: vec![],
        },
    )
    .unwrap();
    p.c.execute("INSERT INTO attachment_links(id,attachment_id,journal_entry_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)",rusqlite::params![crate::domain::new_id(),foreign,note.id,crate::domain::now()]).unwrap();
    let before = archive::dump(&p.c).unwrap();
    let preview = deletion::preview(
        &p.c,
        root.path(),
        deletion::PreviewRequest {
            scope: deletion::Scope::Account {
                account_id: p.account,
            },
        },
    )
    .unwrap();
    assert!(
        preview
            .blockers
            .iter()
            .any(|b| b == "attachment_owner_conflict")
    );
    assert_eq!(
        deletion::execute(&mut p.c, root.path(), approved(&preview))
            .unwrap_err()
            .code,
        Code::UnsupportedOwnership
    );
    assert_eq!(archive::dump(&p.c).unwrap(), before);
    archive::inventory(&p.c, &root.path().join("attachments")).unwrap();
}
