//! Build 8.75 handoff to Build 9.5: `fixtures/fundedflow-v8-legacy-rules.db`
//! holds every shape of legacy account-owned rulebook, rule and snapshot that
//! docs/rulebook-migration.md maps. These tests pin what the fixture contains,
//! that this build opens it without change, and that the matrix's derived
//! values (assignment intervals, rule keys, parameter keys) are computable
//! from the legacy rows alone.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Connection;

use super::upgrade_tests::{dump, dump_like, read_only, version, Journal};
use super::*;

const LEGACY_RULES: &[u8] = include_bytes!("fixtures/fundedflow-v8-legacy-rules.db");

/// The matrix's assignment interval: each non-deleted version that was ever
/// active governs from its effective_from until the next such version of the
/// same account (half-open; NULL = still in force). Drafts are never assigned.
/// Kept identical to docs/rulebook-migration.md.
const ASSIGNMENT_INTERVALS: &str = "
SELECT v.id, v.account_id, v.effective_from AS effective_from,
       LEAD(v.effective_from) OVER (PARTITION BY v.account_id ORDER BY v.effective_from, v.version_number)
           AS effective_to
FROM rulebook_versions v
WHERE v.status IN ('active', 'retired') AND v.deleted_at IS NULL";

/// The matrix's stable rule key: the type for one-per-type rules, plus origin
/// and sort order where a version may hold several of the type.
const RULE_KEYS: &str = "
SELECT r.id,
       CASE WHEN r.rule_type IN ('manual_check', 'max_position_size')
            THEN r.rule_type || ':' || r.origin || ':' || r.sort_order
            WHEN r.origin = 'personal' THEN r.rule_type || ':personal'
            ELSE r.rule_type END AS rule_key
FROM rules r";

fn rv(n: u32) -> String {
    format!("01900000-0000-7000-8000-0000000a{n:04x}")
}

fn strings(conn: &Connection, sql: &str) -> BTreeSet<String> {
    conn.prepare(sql).unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn the_legacy_rules_fixture_covers_every_matrix_case() {
    let conn = read_only(&Journal::copy_of(LEGACY_RULES).0);
    assert_eq!(version(&conn), 8);
    let set = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<BTreeSet<_>>();

    assert_eq!(strings(&conn, "SELECT status FROM rulebook_versions"), set(&["active", "draft", "retired"]));
    assert_eq!(strings(&conn, "SELECT source FROM rulebook_versions"), set(&["copied", "manual", "template"]));
    assert_eq!(count(&conn, "SELECT count(*) FROM rulebook_versions WHERE deleted_at IS NOT NULL"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM rulebook_versions WHERE verified_at IS NOT NULL"), 2);
    assert_eq!(count(&conn, "SELECT count(*) FROM rulebook_versions WHERE source_reference IS NOT NULL"), 3);
    assert_eq!(
        strings(&conn, "SELECT rule_type FROM rules"),
        set(&["consistency", "daily_loss_limit", "manual_check", "max_drawdown", "max_position_size",
              "max_trades_per_day", "min_trading_days", "profit_target"]),
    );
    assert_eq!(strings(&conn, "SELECT origin FROM rules"), set(&["firm", "personal"]));
    assert_eq!(strings(&conn, "SELECT value_state FROM rules"), set(&["known", "unknown"]));
    assert_eq!(strings(&conn, "SELECT evaluation FROM rules"), set(&["calculated", "manual_confirmation"]));

    // Accounts: one with a successor, one archived with an active rulebook, one with none.
    assert_eq!(
        count(&conn, "SELECT count(*) FROM accounts a JOIN accounts p ON p.id = a.parent_account_id
                      WHERE a.name = 'Funded 50K' AND p.name = 'Eval 50K'"),
        1
    );
    assert_eq!(
        count(&conn, "SELECT count(*) FROM accounts a JOIN rulebook_versions v ON v.account_id = a.id
                      WHERE a.archived_at IS NOT NULL AND v.status = 'active'"),
        1
    );
    assert_eq!(
        count(&conn, "SELECT count(*) FROM accounts a WHERE NOT EXISTS
                      (SELECT 1 FROM rulebook_versions v WHERE v.account_id = a.id)"),
        1
    );
    // Snapshots pinned to a retired and an active version, and one with none.
    assert_eq!(
        strings(&conn, "SELECT coalesce(v.status, 'none') FROM account_snapshots s
                        LEFT JOIN rulebook_versions v ON v.id = s.rulebook_version_id"),
        set(&["active", "none", "retired"]),
    );
}

#[test]
fn this_build_opens_the_legacy_rules_journal_without_changes() {
    let db = Journal::copy_of(LEGACY_RULES);
    let before = dump(&read_only(&db.0), &[]);
    let conn = open_file(&db.0).unwrap();
    assert_eq!(version(&conn), latest_version());
    assert_eq!(dump_like(&conn, &before), before);
    assert_eq!(count(&conn, "SELECT count(*) FROM pragma_foreign_key_check"), 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM rules"), 18);
}

#[test]
fn assignment_intervals_follow_effective_from_and_contain_their_snapshots() {
    let conn = read_only(&Journal::copy_of(LEGACY_RULES).0);
    let intervals: BTreeMap<String, (String, Option<String>)> = conn
        .prepare(ASSIGNMENT_INTERVALS)
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, (r.get(2)?, r.get(3)?))))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let at = |from: &str, to: Option<&str>| (from.to_string(), to.map(String::from));
    assert_eq!(
        intervals,
        BTreeMap::from([
            (rv(1), at("2026-09-01", Some("2026-10-01"))), // Eval v1, retired by v2
            (rv(2), at("2026-10-01", None)),               // Eval v2, in force
            (rv(0x11), at("2026-10-15", None)),            // Funded v1
            (rv(0x21), at("2026-10-01", None)),            // archived account's v1
        ]),
        "drafts (v3) and deleted drafts (v4) are never assigned"
    );

    // Every snapshot that names a version falls inside that version's interval,
    // so pinning it to the converted version keeps its meaning.
    let pinned: Vec<(String, String)> = conn
        .prepare("SELECT rulebook_version_id, trading_day FROM account_snapshots WHERE rulebook_version_id IS NOT NULL")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(pinned.len(), 3);
    for (v, day) in pinned {
        let (from, to) = &intervals[&v];
        assert!(day >= *from && to.as_ref().is_none_or(|to| day < *to), "{day} outside {v} [{from}, {to:?})");
    }
}

#[test]
fn rule_keys_are_unique_per_version() {
    let conn = read_only(&Journal::copy_of(LEGACY_RULES).0);
    let keys: Vec<(String, String)> = conn
        .prepare(&format!("SELECT r.rulebook_version_id, k.rule_key FROM rules r JOIN ({RULE_KEYS}) k ON k.id = r.id"))
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let unique: BTreeSet<_> = keys.iter().collect();
    assert_eq!(unique.len(), keys.len(), "{keys:?}");
    let v1: BTreeSet<&str> = keys.iter().filter(|(v, _)| *v == rv(1)).map(|(_, k)| k.as_str()).collect();
    assert!(v1.contains("max_position_size:firm:5") && v1.contains("max_position_size:firm:6"), "{v1:?}");
    assert!(v1.contains("max_trades_per_day:personal") && v1.contains("manual_check:personal:9"), "{v1:?}");
}

#[test]
fn legacy_parameters_use_only_the_keys_the_matrix_maps() {
    let conn = read_only(&Journal::copy_of(LEGACY_RULES).0);
    // docs/rulebook-migration.md, "Rule parameters".
    let mapped: BTreeMap<&str, &[&str]> = BTreeMap::from([
        ("profit_target", &["amount_micros"][..]),
        ("daily_loss_limit", &["amount_micros", "basis"][..]),
        ("max_drawdown", &["amount_micros", "includes_unrealized", "lock", "mode"][..]),
        ("min_trading_days", &["days", "min_day_profit_micros"][..]),
        ("consistency", &["max_best_day_share_bps"][..]),
        ("max_position_size", &["max_contracts", "symbol_root"][..]),
        ("max_trades_per_day", &["count"][..]),
        ("manual_check", &["description"][..]),
    ]);
    let rows: Vec<(String, String, String)> = conn
        .prepare("SELECT rule_type, value_state, params_json FROM rules")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for (rule_type, state, params) in rows {
        let value: serde_json::Value = serde_json::from_str(&params).unwrap();
        let keys: BTreeSet<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        if state == "unknown" {
            assert!(keys.is_empty(), "an unknown value carries no parameters: {rule_type} {params}");
            continue;
        }
        let allowed: BTreeSet<&str> = mapped[rule_type.as_str()].iter().copied().collect();
        assert!(keys.is_subset(&allowed), "{rule_type}: {keys:?} not in {allowed:?}");
        // Money is already micro-units; nothing to rescale.
        for (k, v) in value.as_object().unwrap() {
            if k.ends_with("_micros") {
                assert!(v.is_i64(), "{rule_type}.{k} = {v}");
            }
        }
    }
}
