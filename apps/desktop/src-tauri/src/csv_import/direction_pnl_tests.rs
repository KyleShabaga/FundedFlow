//! B01: long/short classification and realized P&L through the CSV import
//! pipeline, with hand-calculated expected values. All CSV values are synthetic
//! except the MNQZ6 fill pair 707776451322 / 707776451331, copied from a real
//! Performance export. Every expected value is a literal worked out by hand in
//! the comment beside it; none is derived by calling the code under test.
//!
//! FundedFlow has no partial-close, scale-in, scale-out or reversal
//! aggregation: each CSV row is one independent trade. A Performance row is one
//! buy fill paired with one sell fill; two rows that share a fill (a scale-out)
//! are two trades, never merged into one position.

use super::*;
use crate::store::attempts;
use crate::store::insights::{self as insights_store, InsightsQuery};

const PERF_HEADER: &str = "symbol,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp";

/// MNQ (point value $2). Timestamps are America/New_York, EDT (UTC−4) on Tue 20 Oct 2026.
const PERF_ROWS: [&str; 7] = [
    // Line 2, long win: buy first. (21010.25 − 21000) × 1 × 2 = +20.50.
    "MNQZ6,1001,1002,1,21000.00,21010.25,$20.50,10/20/2026 09:30:00,10/20/2026 09:31:00",
    // Line 3, long loss: buy first. (21015 − 21020.50) × 2 × 2 = −22.
    "MNQZ6,1011,1012,2,21020.50,21015.00,$(22.00),10/20/2026 09:40:00,10/20/2026 09:42:00",
    // Line 4, short win (real export row): sold 07:31:23 before bought 07:31:26.
    // (29555 − 29562) × 1 × 2 = −14, negated for short = +14.
    "MNQZ6,707776451322,707776451331,1,29555,29562,$14.00,10/20/2026 07:31:26,10/20/2026 07:31:23",
    // Line 5, short loss: sold 10:00 before bought 10:05. (21050.75 − 21045.25) × 1 × 2 = +11, negated = −11.
    "MNQZ6,1031,1032,1,21050.75,21045.25,$(11.00),10/20/2026 10:05:00,10/20/2026 10:00:00",
    // Line 6, short qty 3 win: sold first. (21000 − 21012.50) × 3 × 2 = −75, negated = +75.
    "MNQZ6,1041,1042,3,21000.00,21012.50,$75.00,10/20/2026 10:20:00,10/20/2026 10:10:00",
    // Line 7, equal timestamps ⇒ taken as long. (sell − buy) × qty × 2 = (21096.50 − 21100) × 1 × 2 = −7.
    "MNQZ6,1051,1052,1,21100.00,21096.50,$(7.00),10/20/2026 10:30:00,10/20/2026 10:30:00",
    // Line 8, short win with a WRONG exported pnl ($25.00): (21200 − 21210) × 1 × 2 = −20, negated = +20.
    "MNQZ6,1061,1062,1,21200.00,21210.00,$25.00,10/20/2026 10:45:00,10/20/2026 10:40:00",
];

/// Wed 21 Oct 2026, America/New_York. ES $50, MNQ $2, MES $5; AAPL and XYZ do not resolve.
const GENERIC_CSV: &str = "Trade ID,Symbol,Side,Qty,Entry Time,Entry Price,Exit Time,Exit Price,Fees,P&L
T1,ESZ6,Long,2,2026-10-21 09:30:00,5000.25,2026-10-21 09:35:00,5003.75,5.00,
T2,ESZ6,Long,2,2026-10-21 09:40:00,5010.00,2026-10-21 09:45:00,5007.25,5.00,
T3,ESZ6,Short,2,2026-10-21 09:50:00,5020.50,2026-10-21 09:55:00,5015.00,5.00,
T4,ESZ6,Short,2,2026-10-21 10:00:00,5015.00,2026-10-21 10:05:00,5016.75,5.00,
T5,MNQZ6,Sell,1,2026-10-21 10:10:00,21000.00,2026-10-21 10:15:00,20990.50,0.74,
T6,ESZ6,Buy,1,2026-10-21 10:20:00,5030.00,2026-10-21 10:25:00,5030.00,2.50,
T7,AAPL,Long,10,2026-10-21 10:30:00,150.00,2026-10-21 10:35:00,151.00,1.00,10.00
T8,XYZ,Short,5,2026-10-21 10:40:00,20.00,2026-10-21 10:45:00,19.00,0.50,
T9,ESZ6,,1,2026-10-21 10:50:00,5000.00,2026-10-21 10:55:00,5001.00,1.00,
T10,ESZ6,flat,1,2026-10-21 11:00:00,5000.00,2026-10-21 11:05:00,5001.00,1.00,
T11,MESZ6,Short,1,2026-10-21 11:10:00,5000.00,2026-10-21 11:15:00,4998.00,,
";

fn perf_csv(rows: &[&str]) -> String {
    let mut out = format!("{PERF_HEADER}\n");
    for r in rows {
        out.push_str(r);
        out.push('\n');
    }
    out
}

/// (side, entry_basis, entry price, exit price, fees, net, status) of a previewed row.
type Seen<'a> = (&'a str, Option<&'a str>, &'a str, Option<&'a str>, &'a str, Option<&'a str>, &'a str);

fn seen(p: &CsvPreview, line: u64) -> Seen<'_> {
    let t = row(p, line).trade.as_ref().unwrap_or_else(|| panic!("line {line} has no trade"));
    (
        t.side,
        t.entry_basis,
        t.entry_price.as_str(),
        t.exit_price.as_deref(),
        t.fees.as_str(),
        t.realized_pnl.as_deref(),
        t.pnl_status,
    )
}

#[test]
fn b01_performance_rows_classify_direction_and_calculate_pnl() {
    let (conn, account) = setup();
    let p = preview(&conn, &request(&account, &perf_csv(&PERF_ROWS))).unwrap();
    assert_eq!(p.format, Format::Performance);
    assert_eq!((p.new_count, p.invalid_count), (7, 0));

    // Performance exports have no fee column: fees "0", so net = gross.
    assert_eq!(seen(&p, 2), ("long", Some("buy_first"), "21000", Some("21010.25"), "0", Some("20.5"), "calculated"));
    assert_eq!(seen(&p, 3), ("long", Some("buy_first"), "21020.5", Some("21015"), "0", Some("-22"), "calculated"));
    assert_eq!(seen(&p, 4), ("short", Some("sell_first"), "29562", Some("29555"), "0", Some("14"), "calculated"));
    assert_eq!(seen(&p, 5), ("short", Some("sell_first"), "21045.25", Some("21050.75"), "0", Some("-11"), "calculated"));
    assert_eq!(seen(&p, 6), ("short", Some("sell_first"), "21012.5", Some("21000"), "0", Some("75"), "calculated"));
    assert_eq!(seen(&p, 7), ("long", Some("same_time"), "21100", Some("21096.5"), "0", Some("-7"), "calculated"));
    assert_eq!(seen(&p, 8), ("short", Some("sell_first"), "21210", Some("21200"), "0", Some("20"), "calculated"));

    // Quantity is kept as given (3 contracts on line 6, 2 on line 3).
    assert_eq!(row(&p, 6).trade.as_ref().unwrap().quantity, "3");
    assert_eq!(row(&p, 3).trade.as_ref().unwrap().quantity, "2");

    // The real export row: entry = sell fill time, exit = buy fill time (07:31:23 / 07:31:26 EDT).
    let real = row(&p, 4).trade.as_ref().unwrap();
    assert_eq!((real.entry_at.as_str(), real.exit_at.as_deref()), ("2026-10-20T11:31:23.000Z", Some("2026-10-20T11:31:26.000Z")));
    assert_eq!((real.buy_fill_id.as_deref(), real.sell_fill_id.as_deref()), (Some("707776451322"), Some("707776451331")));
    assert_eq!(real.reported_pnl.as_deref(), Some("14"));

    // Buy-first and same-time rows carry no warnings; sell-first rows warn on soldTimestamp only, and
    // a matching exported pnl adds no realizedPnl warning.
    for line in [2, 3, 7] {
        assert!(row(&p, line).warnings.is_empty(), "line {line}: {:?}", row(&p, line).warnings);
    }
    for line in [4, 5, 6] {
        assert_eq!(fields(&row(&p, line).warnings), ["soldTimestamp"], "line {line}");
    }
    // Line 8: exported $25.00 vs calculated +20 ⇒ mismatch warning; the calculated value is used.
    let r8 = row(&p, 8);
    assert_eq!(fields(&r8.warnings), ["soldTimestamp", "realizedPnl"]);
    assert!(r8.warnings[1].message.contains("calculated value is used"), "{}", r8.warnings[1].message);
    assert_eq!(r8.trade.as_ref().unwrap().reported_pnl.as_deref(), Some("25"));
    assert_eq!(r8.trade.as_ref().unwrap().realized_pnl.as_deref(), Some("20"));
}

#[test]
fn b01_generic_rows_use_the_side_column_and_fees() {
    let (conn, account) = setup();
    let p = preview(&conn, &request(&account, GENERIC_CSV)).unwrap();
    assert_eq!(p.format, Format::Generic);
    assert!(p.file_issues.is_empty(), "{:?}", p.file_issues);
    assert_eq!((p.new_count, p.invalid_count), (9, 2));

    // T1 long ES win: (5003.75 − 5000.25) × 2 × 50 = +350; net = 350 − 5 = 345.
    assert_eq!(seen(&p, 2), ("long", None, "5000.25", Some("5003.75"), "5", Some("345"), "calculated"));
    // T2 long ES loss: (5007.25 − 5010) × 2 × 50 = −275; net = −275 − 5 = −280.
    assert_eq!(seen(&p, 3), ("long", None, "5010", Some("5007.25"), "5", Some("-280"), "calculated"));
    // T3 short ES win: (5015 − 5020.50) × 2 × 50 = −550, negated = +550; net = 550 − 5 = 545.
    assert_eq!(seen(&p, 4), ("short", None, "5020.5", Some("5015"), "5", Some("545"), "calculated"));
    // T4 short ES loss: (5016.75 − 5015) × 2 × 50 = +175, negated = −175; net = −175 − 5 = −180.
    assert_eq!(seen(&p, 5), ("short", None, "5015", Some("5016.75"), "5", Some("-180"), "calculated"));
    // T5 "Sell" MNQ: (20990.50 − 21000) × 1 × 2 = −19, negated = +19; net = 19 − 0.74 = 18.26.
    assert_eq!(seen(&p, 6), ("short", None, "21000", Some("20990.5"), "0.74", Some("18.26"), "calculated"));
    // T6 flat ES "Buy": (5030 − 5030) × 1 × 50 = 0; net = 0 − 2.50 = −2.50.
    assert_eq!(seen(&p, 7), ("long", None, "5030", Some("5030"), "2.5", Some("-2.5"), "calculated"));
    // T7 AAPL (no instrument), reported 10.00 taken as gross before fees; net = 10 − 1 = 9.
    assert_eq!(seen(&p, 8), ("long", None, "150", Some("151"), "1", Some("9"), "reported"));
    assert_eq!(row(&p, 8).trade.as_ref().unwrap().reported_pnl.as_deref(), Some("10"));
    // T8 XYZ (no instrument, no P&L): net unknown (None, not "0"); fees are kept.
    assert_eq!(seen(&p, 9), ("short", None, "20", Some("19"), "0.5", None, "missing_instrument"));
    assert_eq!(row(&p, 9).trade.as_ref().unwrap().reported_pnl, None);
    // T11 short MES with an empty fees cell: (4998 − 5000) × 1 × 5 = −10, negated = +10; fees 0 ⇒ net 10.
    assert_eq!(seen(&p, 12), ("short", None, "5000", Some("4998"), "0", Some("10"), "calculated"));

    // T9 empty side, T10 "flat": row errors, no trade.
    let t9 = row(&p, 10);
    assert_eq!((t9.status, fields(&t9.errors)), ("invalid", vec!["side"]));
    assert_eq!(t9.errors[0].message, "is required (column 'Side')");
    assert!(t9.trade.is_none());
    let t10 = row(&p, 11);
    assert_eq!((t10.status, fields(&t10.errors)), ("invalid", vec!["side"]));
    assert!(t10.errors[0].message.contains("long or short"), "{}", t10.errors[0].message);
    assert!(t10.trade.is_none());

    // Valid rows carry no warnings (no negative fees, no P&L mismatch).
    for line in [2, 3, 4, 5, 6, 7, 8, 9, 12] {
        assert!(row(&p, line).warnings.is_empty(), "line {line}: {:?}", row(&p, line).warnings);
    }
}

/// (side, gross, fees, net, status) of a stored trade.
fn stored(t: &trade_store::Trade) -> (&str, Option<&str>, &str, Option<&str>, &str) {
    (t.side.as_str(), t.gross_pnl.as_deref(), t.fees.as_str(), t.realized_pnl.as_deref(), t.pnl_status.as_str())
}

#[test]
fn b01_committed_trades_store_the_previewed_pnl_and_totals_exclude_unknowns() {
    let (mut conn, account) = setup();
    let perf = perf_csv(&PERF_ROWS);
    let b = commit(&mut conn, &request(&account, &perf)).unwrap();
    assert_eq!((b.imported_count, b.failed_count), (7, 0));
    let b = commit(&mut conn, &request(&account, GENERIC_CSV)).unwrap();
    assert_eq!((b.imported_count, b.failed_count), (9, 2));

    let saved = trade_store::list(&conn, &account).unwrap();
    assert_eq!(saved.len(), 16);
    let by_sell_fill = |id: &str| {
        saved.iter().find(|t| t.round_trip.as_ref().and_then(|r| r.sell_fill_id.as_deref()) == Some(id)).unwrap()
    };
    let by_trade_id = |id: &str| saved.iter().find(|t| t.broker_trade_id.as_deref() == Some(id)).unwrap();

    // Performance: gross = net (fees 0). Same hand values as the preview test.
    assert_eq!(stored(by_sell_fill("1002")), ("long", Some("20.5"), "0", Some("20.5"), "calculated"));
    assert_eq!(stored(by_sell_fill("1012")), ("long", Some("-22"), "0", Some("-22"), "calculated"));
    assert_eq!(stored(by_sell_fill("707776451331")), ("short", Some("14"), "0", Some("14"), "calculated"));
    assert_eq!(stored(by_sell_fill("1032")), ("short", Some("-11"), "0", Some("-11"), "calculated"));
    assert_eq!(stored(by_sell_fill("1042")), ("short", Some("75"), "0", Some("75"), "calculated"));
    assert_eq!(stored(by_sell_fill("1052")), ("long", Some("-7"), "0", Some("-7"), "calculated"));
    assert_eq!(stored(by_sell_fill("1062")), ("short", Some("20"), "0", Some("20"), "calculated"));
    let real = by_sell_fill("707776451331");
    assert_eq!((real.entry_price.as_str(), real.exit_price.as_deref()), ("29562", Some("29555")));
    assert_eq!(real.round_trip.as_ref().unwrap().entry_basis, "sell_first");
    assert_eq!(by_sell_fill("1062").reported_pnl.as_deref(), Some("25"), "the wrong export value is kept as source data");

    // Generic.
    assert_eq!(stored(by_trade_id("T1")), ("long", Some("350"), "5", Some("345"), "calculated"));
    assert_eq!(stored(by_trade_id("T2")), ("long", Some("-275"), "5", Some("-280"), "calculated"));
    assert_eq!(stored(by_trade_id("T3")), ("short", Some("550"), "5", Some("545"), "calculated"));
    assert_eq!(stored(by_trade_id("T4")), ("short", Some("-175"), "5", Some("-180"), "calculated"));
    assert_eq!(stored(by_trade_id("T5")), ("short", Some("19"), "0.74", Some("18.26"), "calculated"));
    assert_eq!(stored(by_trade_id("T6")), ("long", Some("0"), "2.5", Some("-2.5"), "calculated"));
    assert_eq!(stored(by_trade_id("T7")), ("long", Some("10"), "1", Some("9"), "reported"));
    assert_eq!(stored(by_trade_id("T8")), ("short", None, "0.5", None, "missing_instrument"));
    assert_eq!(stored(by_trade_id("T11")), ("short", Some("10"), "0", Some("10"), "calculated"));
    assert!(saved.iter().all(|t| !matches!(t.broker_trade_id.as_deref(), Some("T9" | "T10"))));
    // Unknown is NULL in the database, not 0.
    assert_eq!(
        count(&conn, "SELECT count(*) FROM trades WHERE symbol = 'XYZ' AND gross_pnl_micros IS NULL AND net_pnl_micros IS NULL"),
        1
    );

    // Hand totals over the 15 trades with a known result (T8 is excluded, not counted as 0):
    //   Performance net = gross: 20.50 − 22 + 14 − 11 + 75 − 7 + 20 = 89.50; fees 0.
    //   Generic gross: 350 − 275 + 550 − 175 + 19 + 0 + 10 + 10 = 489.
    //   Generic fees: 5 + 5 + 5 + 5 + 0.74 + 2.50 + 1 + 0 = 24.24 (T8's 0.50 excluded with its trade).
    //   Generic net: 345 − 280 + 545 − 180 + 18.26 − 2.50 + 9 + 10 = 464.76 (= 489 − 24.24).
    //   All: gross 89.50 + 489 = 578.50; fees 24.24; net 89.50 + 464.76 = 554.26.
    //   Wins (net > 0): 1002, 707776451331, 1042, 1062, T1, T3, T5, T7, T11 = 9.
    //   Losses (net < 0): 1012, 1032, 1052, T2, T4, T6 = 6. Breakevens 0. Win rate 9 / 15 = 60%.

    // Account totals used by the attempts view (`attempts::lineage`): SUM of stored net, unknowns counted apart.
    let lineage = attempts::lineage(&conn, &account).unwrap();
    assert_eq!(lineage.len(), 1);
    assert_eq!(lineage[0].trade_count, 16);
    assert_eq!(lineage[0].net_pnl.as_deref(), Some("554.26"));
    assert_eq!(lineage[0].trades_with_unknown_pnl, 1);

    // Insights totals: the Rust mirror of the TypeScript summary, over the stored Insights dataset.
    let d = insights_store::dataset_at(&conn, InsightsQuery { account_ids: vec![account.clone()] }, "2026-10-21T22:00:00.000Z")
        .unwrap();
    let metric: Vec<crate::insights::MetricTrade> =
        serde_json::from_value(serde_json::to_value(&d.trades).unwrap()).unwrap();
    let s = crate::insights::summarize(&metric);
    let xyz = saved.iter().find(|t| t.symbol == "XYZ").unwrap();
    assert_eq!(s["closed"], 16);
    assert_eq!(s["eligible"], 15);
    assert_eq!(s["unknownPnl"], 1);
    assert_eq!(s["unknownIds"], serde_json::json!([xyz.id]));
    assert_eq!(s["complete"], false);
    assert_eq!(s["net"], serde_json::json!({ "state": "value", "value": "554.26" }));
    assert_eq!(s["gross"], serde_json::json!({ "state": "value", "value": "578.5" }));
    assert_eq!(s["fees"], serde_json::json!({ "state": "value", "value": "24.24" }));
    assert_eq!((s["wins"].clone(), s["losses"].clone(), s["breakevens"].clone()), (9.into(), 6.into(), 0.into()));
    assert_eq!(s["winRate"]["value"]["percent"], "60");
}

#[test]
fn b01_a_scale_out_is_two_independent_trades() {
    let (mut conn, account) = setup();
    // One buy fill (2001, 1 contract each row) closed by two sells: two rows, two trades.
    // Row 1: (21004 − 21000) × 1 × 2 = +8.  Row 2: (21008.50 − 21000) × 1 × 2 = +17.  Total = 25.
    let csv = perf_csv(&[
        "MNQZ6,2001,2002,1,21000.00,21004.00,$8.00,10/20/2026 11:00:00,10/20/2026 11:01:00",
        "MNQZ6,2001,2003,1,21000.00,21008.50,$17.00,10/20/2026 11:00:00,10/20/2026 11:02:00",
    ]);
    let p = preview(&conn, &request(&account, &csv)).unwrap();
    assert_eq!((p.new_count, p.duplicate_count), (2, 0));
    assert_eq!(seen(&p, 2), ("long", Some("buy_first"), "21000", Some("21004"), "0", Some("8"), "calculated"));
    assert_eq!(seen(&p, 3), ("long", Some("buy_first"), "21000", Some("21008.5"), "0", Some("17"), "calculated"));

    commit(&mut conn, &request(&account, &csv)).unwrap();
    let saved = trade_store::list(&conn, &account).unwrap();
    assert_eq!(saved.len(), 2, "no aggregation into one position");
    assert!(saved.iter().all(|t| t.round_trip.as_ref().unwrap().buy_fill_id.as_deref() == Some("2001")));
    let mut gross: Vec<&str> = saved.iter().map(|t| t.gross_pnl.as_deref().unwrap()).collect();
    gross.sort_unstable();
    assert_eq!(gross, ["17", "8"]);
    let lineage = attempts::lineage(&conn, &account).unwrap();
    assert_eq!(lineage[0].net_pnl.as_deref(), Some("25"));
}
