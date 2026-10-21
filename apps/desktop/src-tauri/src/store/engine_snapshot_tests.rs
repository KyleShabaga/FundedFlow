use super::{
    snapshots::{self, SnapshotInput},
    tests::db,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
const ACCOUNT: &str = "00000000-0000-4000-8000-000000000001";
const VERSION: &str = "00000000-0000-4000-8000-000000000020";
const AT: &str = "2026-10-01T00:00:00.000Z";
fn fixture() -> Vec<Value> {
    serde_json::from_str(include_str!(
        "../../../../../packages/domain/test/fixtures/engine-contract.json"
    ))
    .unwrap()
}
fn seed(c: &Connection) {
    c.execute("INSERT INTO accounts(id,name,account_type,status,currency,starting_balance_micros,timezone,trading_day_reset_time,created_at,updated_at) VALUES(?1,'Synthetic','evaluation','active','USD',50000000000,'America/New_York','17:00',?2,?2)",params![ACCOUNT,AT]).unwrap();
    c.execute("INSERT INTO providers(id,slug,display_name,record_status,created_at,updated_at) VALUES('provider','synthetic','Synthetic','active',?1,?1)",[AT]).unwrap();
    c.execute("INSERT INTO rulebooks(id,provider_id,slug,display_name,record_status,created_at,updated_at) VALUES('book','provider','synthetic','Synthetic','active',?1,?1)",[AT]).unwrap();
    c.execute("INSERT INTO rulebook_versions(id,rulebook_id,version_number,schema_version,verification_status,origin,captured_at,verified_by,verified_at,record_status,created_at,updated_at) VALUES(?1,'book',1,1,'verified','catalogue',?2,'synthetic reviewer',?2,'active',?2,?2)",params![VERSION,AT]).unwrap();
}
#[test]
fn engine_payload_roundtrips_native_nulls_exact_values_hash_and_eod_identity() {
    let mut c = db();
    seed(&c);
    let mut outputs = vec![];
    for f in fixture() {
        let payload: SnapshotInput = serde_json::from_value(f["snapshot"].clone()).unwrap();
        let first = snapshots::save(&mut c, payload.clone()).unwrap();
        let second = snapshots::save(&mut c, payload).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            serde_json::to_value(&first).unwrap()["balance"],
            f["snapshot"]["balance"]
        );
        assert_eq!(first.explanation, f["snapshot"]["explanation"]);
        outputs.push(first);
    }
    assert_eq!(outputs.len(), 3);
    assert_ne!(outputs[0].id, outputs[2].id);
    assert_eq!(outputs[2].balance.as_deref(), Some("50000.000001"));
    assert!(outputs[1].balance.is_none());
    assert!(outputs[1].realized_day_pnl.is_none());
    assert!(outputs[1].trading_days_completed.is_none());
    assert!(outputs[1].drawdown_locked.is_none());
    assert!(c
        .execute("UPDATE account_snapshots SET balance_micros=0", [])
        .is_err());
    assert!(c.execute("DELETE FROM account_snapshots", []).is_err());
}
#[test]
fn rejects_tampered_engine_identity_and_false_safe_nulls_without_writes() {
    let mut c = db();
    seed(&c);
    let f = fixture();
    let base = f[0]["snapshot"].clone();
    for path in [
        "/inputsHash",
        "/accountId",
        "/balance",
        "/explanation/engine/status",
        "/explanation/inputs/account/startingBalance",
    ] {
        let mut bad = base.clone();
        *bad.pointer_mut(path).unwrap() = json!("invalid");
        let input: SnapshotInput = serde_json::from_value(bad).unwrap();
        assert!(snapshots::save(&mut c, input).is_err(), "{path}");
    }
    let mut nulls = f[1]["snapshot"].clone();
    nulls["status"] = json!("safe");
    nulls["engineVersion"] = json!("legacy");
    let input: SnapshotInput = serde_json::from_value(nulls).unwrap();
    assert!(snapshots::save(&mut c, input).is_err());
    assert!(snapshots::list(&c, ACCOUNT, None, None, false)
        .unwrap()
        .is_empty());
}
#[test]
fn v14_snapshot_upgrade_preserves_legacy_and_reopens_with_backup() {
    let dir = std::env::temp_dir().join(format!("fundedflow-engine-{}", crate::domain::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("fundedflow.db");
    let mut c = Connection::open(&path).unwrap();
    crate::db::migrate_with(&mut c, &crate::db::MIGRATIONS[..14]).unwrap();
    seed(&c);
    let f = fixture();
    let mut payload = f[0]["snapshot"].clone();
    payload["engineVersion"] = json!("legacy");
    let old = snapshots::save(&mut c, serde_json::from_value(payload).unwrap()).unwrap();
    drop(c);
    let upgraded = crate::db::open_file(&path).unwrap();
    assert_eq!(snapshots::get(&upgraded, &old.id).unwrap(), old);
    drop(upgraded);
    let b = Connection::open(crate::db::backup_path(&path)).unwrap();
    assert_eq!(
        b.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        14
    );
    drop(b);
    let mut reopened = crate::db::open_file(&path).unwrap();
    snapshots::save(
        &mut reopened,
        serde_json::from_value(f[1]["snapshot"].clone()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        snapshots::list(&reopened, ACCOUNT, None, None, false)
            .unwrap()
            .len(),
        2
    );
    drop(reopened);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn failed_v15_migration_rolls_back_rows_schema_and_user_version() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate_with(&mut c, &crate::db::MIGRATIONS[..14]).unwrap();
    seed(&c);
    let f = fixture();
    let mut payload = f[0]["snapshot"].clone();
    payload["engineVersion"] = json!("legacy");
    let old = snapshots::save(&mut c, serde_json::from_value(payload).unwrap()).unwrap();
    let failing = Box::leak(
        format!(
            "{}\nSELECT nonexistent FROM deliberate_failure;",
            include_str!("../../migrations/0015_nullable_engine_snapshots.sql")
        )
        .into_boxed_str(),
    );
    assert!(crate::db::migrate_with(
        &mut c,
        &[crate::db::Migration {
            version: 15,
            name: "injected_failure",
            step: crate::db::Step::Sql(failing)
        }]
    )
    .is_err());
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        14
    );
    assert_eq!(snapshots::get(&c, &old.id).unwrap(), old);
    crate::db::migrate(&mut c).unwrap();
    assert_eq!(snapshots::get(&c, &old.id).unwrap(), old);
}
#[test]
fn snapshot_write_failure_and_archival_do_not_leave_partial_history() {
    let mut c = db();
    seed(&c);
    let f = fixture();
    c.execute_batch("CREATE TEMP TRIGGER fail_snapshot BEFORE INSERT ON account_snapshots BEGIN SELECT RAISE(ABORT,'simulated disk error'); END;").unwrap();
    assert!(snapshots::save(
        &mut c,
        serde_json::from_value(f[0]["snapshot"].clone()).unwrap()
    )
    .is_err());
    assert!(snapshots::list(&c, ACCOUNT, None, None, false)
        .unwrap()
        .is_empty());
    c.execute_batch("DROP TRIGGER fail_snapshot").unwrap();
    let saved = snapshots::save(
        &mut c,
        serde_json::from_value(f[0]["snapshot"].clone()).unwrap(),
    )
    .unwrap();
    super::accounts::archive(&mut c, ACCOUNT).unwrap();
    assert!(snapshots::save(
        &mut c,
        serde_json::from_value(f[1]["snapshot"].clone()).unwrap()
    )
    .is_err());
    assert_eq!(snapshots::get(&c, &saved.id).unwrap(), saved);
}

/// Independent native reference arithmetic for newly introduced rule metrics;
/// not a second production rules engine. Both runtimes consume these exact outputs.
#[test]
fn engine_money_math_fixture_matches_native_exact_reference() {
    use crate::domain::{micros_to_string, parse_decimal, to_micros};
    let m = |s: &str| to_micros(parse_decimal(s).unwrap()).unwrap();
    let mut cases = vec![
        json!({"name":"static_micro","kind":"drawdown","method":"static","opening":"50000","peak":"50000","balance":"49999.999999","amount":"2000","trigger":null,"lockedFloor":null}),
        json!({"name":"eod_trailing","kind":"drawdown","method":"end_of_day_trailing","opening":"50000","peak":"52500","balance":"51000","amount":"2000","trigger":null,"lockedFloor":null}),
        json!({"name":"intraday_checkpoint_estimate","kind":"drawdown","method":"intraday_trailing","opening":"50000","peak":"53000","balance":"51200","amount":"2000","trigger":null,"lockedFloor":null}),
        json!({"name":"locked_eod","kind":"drawdown","method":"end_of_day_trailing","opening":"50000","peak":"53000","balance":"53000","amount":"2000","trigger":"52500","lockedFloor":"50500"}),
        json!({"name":"daily_micro_loss","kind":"daily","limit":"100","net":"-100.000001"}),
        json!({"name":"consistency_exact_share","kind":"consistency","best":"150","total":"299","share":"0.5"}),
    ];
    for c in &mut cases {
        c["expected"] = match c["kind"].as_str().unwrap() {
            "drawdown" => {
                let peak = m(c["peak"].as_str().unwrap()).max(m(c["opening"].as_str().unwrap()));
                let locked = c["trigger"].as_str().is_some_and(|t| peak >= m(t));
                let floor = if locked {
                    m(c["lockedFloor"].as_str().unwrap())
                } else {
                    peak.checked_sub(m(c["amount"].as_str().unwrap())).unwrap()
                };
                let headroom = m(c["balance"].as_str().unwrap())
                    .checked_sub(floor)
                    .unwrap();
                json!({"drawdownFloor":micros_to_string(floor),"drawdownHeadroom":micros_to_string(headroom),"drawdownLocked":locked})
            }
            "daily" => {
                json!({"dailyLossRemaining":micros_to_string(m(c["limit"].as_str().unwrap()).checked_add(m(c["net"].as_str().unwrap())).unwrap())})
            }
            "consistency" => {
                json!({"attained":i128::from(m(c["best"].as_str().unwrap()))*1000000<=i128::from(m(c["total"].as_str().unwrap()))*i128::from(m(c["share"].as_str().unwrap()))})
            }
            _ => unreachable!(),
        };
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/domain/test/fixtures/engine-math.json");
    if std::env::var_os("FUNDEDFLOW_UPDATE_FIXTURES").is_some() {
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&cases).unwrap()),
        )
        .unwrap();
    }
    let expected: Value = serde_json::from_str(
        &std::fs::read_to_string(path).expect("Generate native reference fixture deliberately"),
    )
    .unwrap();
    assert_eq!(expected, json!(cases));
}
