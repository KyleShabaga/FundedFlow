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
