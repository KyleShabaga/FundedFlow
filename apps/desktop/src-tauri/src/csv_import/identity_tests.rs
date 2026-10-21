//! P0-01 fill-pair identity regressions. All CSV values here are synthetic.
use super::*;

const PAIRS: &str = "symbol,qty,buyPrice,sellPrice,buyFillId,sellFillId,boughtTimestamp,soldTimestamp";
/// Two distinct pairs whose unversioned keys were both `fills:a:b:c`.
const COLON_IN_BUY: &str = "MNQ,1,21000,21001,a:b,c,10/19/2026 09:30:00,10/19/2026 09:31:00";
const COLON_IN_SELL: &str = "MNQ,1,21000,21001,a,b:c,10/19/2026 09:30:00,10/19/2026 09:31:00";

fn csv(lines: &[&str]) -> String {
    let mut out = format!("{PAIRS}\n");
    for line in lines {
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn fill_pairs(conn: &Connection, account: &str) -> Vec<(String, String, String)> {
    conn.prepare(
        "SELECT t.id, rt.buy_fill_id, rt.sell_fill_id FROM trades t JOIN trade_round_trips rt ON rt.trade_id = t.id
         WHERE t.account_id = ?1 AND t.deleted_at IS NULL ORDER BY rt.buy_fill_id, rt.sell_fill_id",
    )
    .unwrap()
    .query_map([account], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

#[test]
fn colliding_fill_pairs_are_distinct_trades_in_one_file_and_across_imports() {
    let (mut conn, account) = setup();
    let both = csv(&[COLON_IN_BUY, COLON_IN_SELL]);
    let p = preview(&conn, &request(&account, &both)).unwrap();
    assert_eq!((p.new_count, p.duplicate_count), (2, 0), "{:?}", p.rows.iter().map(|r| &r.duplicate).collect::<Vec<_>>());
    let batch = commit(&mut conn, &request(&account, &both)).unwrap();
    assert_eq!((batch.imported_count, batch.duplicate_count), (2, 0));
    let saved = fill_pairs(&conn, &account);
    assert_eq!(
        saved.iter().map(|(_, b, s)| (b.as_str(), s.as_str())).collect::<Vec<_>>(),
        [("a", "b:c"), ("a:b", "c")]
    );

    // Separate imports: the second pair is new, not a duplicate of the first.
    let (mut conn, account) = setup();
    assert_eq!(commit(&mut conn, &request(&account, &csv(&[COLON_IN_BUY]))).unwrap().imported_count, 1);
    let second = commit(&mut conn, &request(&account, &csv(&[COLON_IN_SELL]))).unwrap();
    assert_eq!((second.imported_count, second.duplicate_count), (1, 0));
    assert_eq!(fill_pairs(&conn, &account).len(), 2);
}

#[test]
fn version_2_keys_are_distinct_for_every_split_of_supported_ids() {
    // Every way of splitting a colon-separated text into (buy, sell) is a different pair with a different key.
    let text = "a:b::c:d:";
    let splits: Vec<(String, String)> =
        text.match_indices(':').map(|(i, _)| (text[..i].to_string(), text[i + 1..].to_string())).collect();
    let mut keys: Vec<String> = splits.iter().map(|(b, s)| dedup::fill_pair_key(b, s)).collect();
    keys.extend(["fills2", "a", "1:a", "12", "x:y"].iter().flat_map(|b| ["", "z", ":"].map(|s| dedup::fill_pair_key(b, s))));
    let unique: std::collections::HashSet<&String> = keys.iter().collect();
    assert_eq!(unique.len(), keys.len(), "{keys:?}");
    // Deterministic, and never in the unversioned key space or another strategy's prefix.
    assert_eq!(dedup::fill_pair_key("a:b", "c"), "fills2:3:a:b:c");
    assert_eq!(dedup::fill_pair_key("a", "b:c"), "fills2:1:a:b:c");
    assert_eq!(dedup::fill_pair_key("707776450007", "707776450023"), "fills2:12:707776450007:707776450023");
    for key in &keys {
        assert!(key.starts_with("fills2:") && !key.starts_with("fills:") && !key.starts_with("id:") && !key.starts_with("rt:"));
    }
    // The legacy encoding is the collision this replaces.
    assert_eq!(dedup::legacy_fill_pair_key("a:b", "c"), dedup::legacy_fill_pair_key("a", "b:c"));
}

/// A journal written by the earlier release: `(a:b, c)` saved under `fills:a:b:c`, its colliding
/// partner skipped as a duplicate of it, and one ordinary pair.
fn legacy_journal(conn: &mut Connection, account: &str) -> (String, String) {
    let file = csv(&[COLON_IN_BUY, COLON_IN_SELL, "MNQ,1,21000,21002,buy17,sell17,10/19/2026 10:30:00,10/19/2026 10:31:00"]);
    let batch = dedup::as_legacy_writer(|| commit(conn, &request(account, &file)).unwrap());
    assert_eq!((batch.imported_count, batch.duplicate_count), (2, 1), "the earlier release skipped (a, b:c)");
    let keys: Vec<(String, String)> = conn
        .prepare("SELECT dedup_key, id FROM trades WHERE account_id = ?1 ORDER BY dedup_key")
        .unwrap()
        .query_map([account], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(keys.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["fills:a:b:c", "fills:buy17:sell17"]);
    (keys[0].1.clone(), keys[1].1.clone())
}

#[test]
fn legacy_journals_stay_idempotent_after_reopen_and_formerly_skipped_pairs_import() {
    let file = regressions::JournalFile::new();
    let account;
    let (legacy_colon, legacy_plain);
    {
        let mut conn = file.open();
        account = accounts::create(&mut conn, account_input("Legacy")).unwrap().id;
        (legacy_colon, legacy_plain) = legacy_journal(&mut conn, &account);
    }
    let reimport = csv(&[COLON_IN_BUY, COLON_IN_SELL, "MNQ,1,21000,21002,buy17,sell17,10/19/2026 10:30:00,10/19/2026 10:31:00"]);
    let new_id;
    {
        let mut conn = file.open();
        let p = preview(&conn, &request(&account, &reimport)).unwrap();
        assert_eq!((p.new_count, p.duplicate_count, p.invalid_count), (1, 2, 0));
        // The exact stored pair, not the shared legacy key, decides the match.
        let dup = |line: u64| row(&p, line).duplicate.clone().unwrap();
        assert_eq!((dup(2).of, dup(2).trade_id.as_deref()), ("saved", Some(legacy_colon.as_str())));
        assert_eq!(dup(4).trade_id.as_deref(), Some(legacy_plain.as_str()));
        assert_eq!(row(&p, 3).status, "new", "(a, b:c) is not the trade saved as (a:b, c)");
        let batch = commit(&mut conn, &request(&account, &reimport)).unwrap();
        assert_eq!((batch.imported_count, batch.duplicate_count), (1, 2));
        let links: Vec<Option<String>> = list_problem_rows(&conn, &batch.id).unwrap().into_iter().map(|r| r.duplicate_of_trade_id).collect();
        assert_eq!(links, [Some(legacy_colon.clone()), Some(legacy_plain.clone())]);
        new_id = fill_pairs(&conn, &account).into_iter().find(|(_, b, _)| b == "a").unwrap().0;
        let stored: String = conn.query_row("SELECT dedup_key FROM trades WHERE id = ?1", [&new_id], |r| r.get(0)).unwrap();
        assert_eq!(stored, "fills2:1:a:b:c");
    }
    // Reopened: everything is now a duplicate of its own trade, legacy keys and history untouched.
    let mut conn = file.open();
    let batch = commit(&mut conn, &request(&account, &reimport)).unwrap();
    assert_eq!((batch.imported_count, batch.duplicate_count), (0, 3));
    let links: Vec<Option<String>> = list_problem_rows(&conn, &batch.id).unwrap().into_iter().map(|r| r.duplicate_of_trade_id).collect();
    assert_eq!(links, [Some(legacy_colon.clone()), Some(new_id), Some(legacy_plain.clone())]);
    let first_batch = list_batches(&conn, &account).unwrap().pop().unwrap();
    let original: Vec<Option<String>> =
        list_problem_rows(&conn, &first_batch.id).unwrap().into_iter().map(|r| r.duplicate_of_trade_id).collect();
    assert_eq!(original, [Some(legacy_colon.clone())], "earlier duplicate provenance is not rewritten");
    let legacy_keys = count(&conn, "SELECT count(*) FROM trades WHERE dedup_key LIKE 'fills:%'");
    assert_eq!(legacy_keys, 2);
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 3);
}

#[test]
fn restoring_a_deleted_trade_matches_its_exact_pair_and_keeps_its_id() {
    for legacy in [true, false] {
        let (mut conn, account) = setup();
        let saved = csv(&[COLON_IN_BUY]);
        if legacy {
            dedup::as_legacy_writer(|| commit(&mut conn, &request(&account, &saved)).unwrap());
        } else {
            commit(&mut conn, &request(&account, &saved)).unwrap();
        }
        let original = trade_store::list(&conn, &account).unwrap().remove(0);
        trade_store::delete(&mut conn, &original.id).unwrap();

        // Only the colliding partner: it must not bring back (a:b, c).
        let other = preview(&conn, &request(&account, &csv(&[COLON_IN_SELL]))).unwrap();
        assert_eq!((other.new_count, other.restore_count), (1, 0), "legacy={legacy}");
        assert!(other.rows[0].restores.is_none());

        let both = csv(&[COLON_IN_SELL, COLON_IN_BUY, COLON_IN_BUY]);
        let p = preview(&conn, &request(&account, &both)).unwrap();
        assert_eq!((p.new_count, p.restore_count, p.duplicate_count), (2, 1, 1));
        assert_eq!(row(&p, 3).restores.as_ref().unwrap().trade_id, original.id);
        let batch = commit(&mut conn, &request(&account, &both)).unwrap();
        assert_eq!((batch.imported_count, batch.duplicate_count), (2, 1));
        let pairs = fill_pairs(&conn, &account);
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs.iter().find(|(_, b, _)| b == "a:b").unwrap().0, original.id, "restored under its own ID");
        let links: Vec<Option<String>> = list_problem_rows(&conn, &batch.id).unwrap().into_iter().map(|r| r.duplicate_of_trade_id).collect();
        assert_eq!(links, [Some(original.id.clone())], "the repeat links to the restored trade");
    }
}

#[test]
fn another_account_is_independent_of_legacy_and_current_fill_pair_keys() {
    let (mut conn, a) = setup();
    let b = accounts::create(&mut conn, account_input("Independent")).unwrap().id;
    legacy_journal(&mut conn, &a);
    let both = csv(&[COLON_IN_BUY, COLON_IN_SELL]);
    let p = preview(&conn, &request(&b, &both)).unwrap();
    assert_eq!((p.new_count, p.duplicate_count, p.restore_count), (2, 0, 0));
    commit(&mut conn, &request(&b, &both)).unwrap();
    assert_eq!(fill_pairs(&conn, &b).len(), 2);
    // A's view is unchanged by B's current-version trades.
    let again = preview(&conn, &request(&a, &both)).unwrap();
    assert_eq!((again.new_count, again.duplicate_count), (1, 1));
    let b_ids: Vec<String> = fill_pairs(&conn, &b).into_iter().map(|(id, ..)| id).collect();
    assert!(again.rows.iter().filter_map(|r| r.duplicate.as_ref()).all(|d| !b_ids.contains(d.trade_id.as_ref().unwrap())));
}

#[test]
fn a_legacy_trade_whose_stored_pair_is_unreadable_is_reported_not_guessed() {
    let (mut conn, account) = setup();
    let (legacy_colon, _) = legacy_journal(&mut conn, &account);
    // Simulate a journal whose paired-fill source row for that trade is gone.
    conn.execute("DELETE FROM trade_round_trips WHERE trade_id = ?1", [&legacy_colon]).unwrap();
    let file = csv(&[COLON_IN_SELL, COLON_IN_BUY, COLON_IN_SELL]);
    let p = preview(&conn, &request(&account, &file)).unwrap();
    assert_eq!((p.new_count, p.duplicate_count, p.restore_count, p.invalid_count), (0, 0, 0, 3));
    for r in &p.rows {
        assert_eq!(r.status, "invalid");
        assert_eq!(fields(&r.errors), ["identity"]);
        assert!(r.errors[0].message.starts_with("Couldn't tell whether this row is already saved"), "{}", r.errors[0].message);
        assert!(!r.errors[0].message.contains("fills:"), "no internal key in the message");
    }
    assert_eq!(p.target_assessment.candidate_count, 0);
    let before = count(&conn, "SELECT count(*) FROM trades");
    let batch = commit(&mut conn, &request(&account, &file)).unwrap();
    assert_eq!((batch.imported_count, batch.failed_count, batch.duplicate_count), (0, 3, 0));
    assert_eq!(count(&conn, "SELECT count(*) FROM trades"), before, "nothing inserted, restored or matched");
    let rows = list_problem_rows(&conn, &batch.id).unwrap();
    assert!(rows.iter().all(|r| r.status == "invalid" && r.duplicate_of_trade_id.is_none() && fields(&r.errors) == ["identity"]));
}

#[test]
fn a_failed_write_rolls_back_legacy_restores_and_new_pairs_together() {
    let file = regressions::JournalFile::new();
    let (account, legacy_colon);
    let both = csv(&[COLON_IN_BUY, COLON_IN_SELL]);
    {
        let mut conn = file.open();
        account = accounts::create(&mut conn, account_input("Rollback")).unwrap().id;
        dedup::as_legacy_writer(|| commit(&mut conn, &request(&account, &csv(&[COLON_IN_BUY]))).unwrap());
        legacy_colon = trade_store::list(&conn, &account).unwrap().remove(0).id;
        trade_store::delete(&mut conn, &legacy_colon).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER interrupt_import BEFORE INSERT ON trade_round_trips WHEN NEW.sell_fill_id = 'b:c'
             BEGIN SELECT RAISE(ROLLBACK, 'interrupted import (simulated)'); END;",
        )
        .unwrap();
        // Restores (a:b, c) first, then fails inserting (a, b:c): neither survives.
        assert!(commit(&mut conn, &request(&account, &both)).is_err());
        assert!(trade_store::list(&conn, &account).unwrap().is_empty());
        assert_eq!(count(&conn, "SELECT count(*) FROM trades"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM trades WHERE dedup_key LIKE 'fills2:%'"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM import_rows"), 1);
        conn.execute_batch("DROP TRIGGER interrupt_import").unwrap();
    }
    let mut conn = file.open();
    let batch = commit(&mut conn, &request(&account, &both)).unwrap();
    assert_eq!(batch.imported_count, 2);
    assert!(fill_pairs(&conn, &account).iter().any(|(id, b, _)| id == &legacy_colon && b == "a:b"));
}

#[test]
fn broker_id_and_fallback_keys_are_unchanged() {
    use normalize::Identity;
    assert_eq!(dedup::key(&Identity::TradeId("T:17".into())), "id:T:17");
    assert_eq!(dedup::key(&Identity::Composite("x".into())), format!("rt:{}", dedup::sha256_hex(b"x")));
}
