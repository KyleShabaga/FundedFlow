//! Pure domain rules shared by manual entry and CSV import: IDs and time,
//! exact decimals and money, trading days, instrument lookup, realized P&L and
//! trade validation. No database access here.

use std::str::FromStr;

use chrono::{
    DateTime, Datelike, Days, NaiveDate, NaiveTime, SecondsFormat, Timelike, Utc, Weekday,
};
use chrono_tz::Tz;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};

use crate::error::FieldIssue;

pub const MAX_NOTES_CHARS: usize = 20_000;
const MICROS_PER_UNIT: i64 = 1_000_000;

// ---------------------------------------------------------------------------
// Exact JSON integers
// ---------------------------------------------------------------------------

/// Largest integer a JSON number carries exactly into JavaScript (2^53 - 1).
pub const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

/// `durationSeconds` on the wire (P0-04): a JSON number up to [`MAX_SAFE_JSON_INTEGER`], above it a decimal string,
/// so JavaScript receives every stored value exactly. One canonical form per value; values that fit a safe integer
/// serialize exactly as before. The TypeScript side is `durationSecondsSchema` in `@fundedflow/domain`.
pub mod duration_wire {
    use serde::{Deserialize, Deserializer, Serializer};

    use super::MAX_SAFE_JSON_INTEGER;

    pub fn serialize<S: Serializer, T: Copy + Into<i128>>(
        value: &Option<T>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match value.map(Into::into) {
            None => s.serialize_none(),
            Some(n) if (0..=MAX_SAFE_JSON_INTEGER as i128).contains(&n) => {
                s.serialize_u64(n as u64)
            }
            Some(n) => s.serialize_str(&n.to_string()),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            Number(u64),
            Text(String),
        }
        let invalid = |what: &dyn std::fmt::Display| {
            serde::de::Error::custom(format!("durationSeconds {what} is not canonical"))
        };
        Ok(match Option::<Wire>::deserialize(d)? {
            None => None,
            Some(Wire::Number(n)) if n <= MAX_SAFE_JSON_INTEGER => Some(n as i64),
            Some(Wire::Number(n)) => return Err(invalid(&n)),
            Some(Wire::Text(t)) => {
                let canonical = !t.starts_with('0') && t.bytes().all(|b| b.is_ascii_digit());
                match t.parse::<i64>() {
                    Ok(n) if canonical && n as u64 > MAX_SAFE_JSON_INTEGER => Some(n),
                    _ => return Err(invalid(&t)),
                }
            }
        })
    }
}

// ---------------------------------------------------------------------------
// IDs and time
// ---------------------------------------------------------------------------

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// Storage format for instants: `2026-10-19T14:30:05.123Z`.
pub fn format_instant(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn now() -> String {
    format_instant(Utc::now())
}

/// Parse an RFC 3339 / ISO 8601 instant that carries an offset or `Z`.
pub fn parse_instant(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

pub fn parse_tz(s: &str) -> Option<Tz> {
    Tz::from_str(s.trim()).ok()
}

/// `HH:MM`, 24-hour.
pub fn parse_reset_time(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

pub fn format_reset_time(t: NaiveTime) -> String {
    t.format("%H:%M").to_string()
}

/// Reset times an account may use: `00:00` (calendar days) or `12:00`–`23:59`.
/// An afternoon or evening reset opens the *next* day's session, which is what
/// [`trading_day`] assumes; a morning reset would date that morning's trades a
/// day late, so it is rejected.
pub fn is_allowed_reset_time(t: NaiveTime) -> bool {
    t == NaiveTime::MIN || t.hour() >= 12
}

/// The trading day an instant belongs to. Times at or after the account's
/// daily reset (in its timezone) count toward the next calendar day, so with a
/// 17:00 America/New_York reset a Sunday 18:00 fill is Monday's. A 00:00 reset
/// means plain calendar days. A day that falls on a Saturday or Sunday rolls
/// forward to Monday, so a Friday fill after the reset is Monday's.
pub fn trading_day(at: DateTime<Utc>, tz: Tz, reset: NaiveTime) -> NaiveDate {
    let local = at.with_timezone(&tz);
    let mut date = local.date_naive();
    if reset != NaiveTime::MIN && local.time() >= reset {
        date = date.succ_opt().unwrap_or(date);
    }
    let weekend_days = match date.weekday() {
        Weekday::Sat => 2,
        Weekday::Sun => 1,
        _ => 0,
    };
    date.checked_add_days(Days::new(weekend_days))
        .unwrap_or(date)
}

// ---------------------------------------------------------------------------
// Decimals and money
// ---------------------------------------------------------------------------

/// Strict decimal parse: plain digits with an optional sign and point.
pub fn parse_decimal(s: &str) -> Option<Decimal> {
    let s = s.trim();
    let plain = !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+'))
        && s.chars().any(|c| c.is_ascii_digit());
    if !plain {
        return None;
    }
    Decimal::from_str(s).ok()
}

/// Canonical text form used in storage and payloads: `21000.25`, `2`, `-0.5`.
pub fn canonical(d: Decimal) -> String {
    d.normalize().to_string()
}

/// Money to integer micro-units, rounding half away from zero.
pub fn to_micros(d: Decimal) -> Option<i64> {
    d.checked_mul(Decimal::from(MICROS_PER_UNIT))?
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
}

pub fn micros_to_string(m: i64) -> String {
    canonical(Decimal::new(m, 6))
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Instrument {
    pub id: String,
    pub root: String,
    pub currency: String,
    pub point_value: Decimal,
}

const MONTH_CODES: &str = "FGHJKMNQUVXZ";

/// True when `symbol` is `root` itself, `root` + futures month code + year
/// (`MNQZ6`, `MNQZ26`, `MNQZ2026`) or `root` + a separator (`NQ 12-26`).
fn symbol_matches_root(symbol: &str, root: &str) -> bool {
    let Some(rest) = symbol.strip_prefix(root) else {
        return false;
    };
    let mut chars = rest.chars();
    match chars.next() {
        None => true,
        Some(' ' | '.' | '-' | '/' | ':') => true,
        Some(month) if MONTH_CODES.contains(month) => {
            let year = chars.as_str();
            (1..=4).contains(&year.len()) && year.chars().all(|c| c.is_ascii_digit())
        }
        Some(_) => false,
    }
}

/// The instrument whose root is the longest match for `symbol` (so `MESZ6`
/// resolves to MES, not ES). A leading `/` (thinkorswim style) is ignored.
pub fn resolve_instrument<'a>(
    symbol: &str,
    instruments: &'a [Instrument],
) -> Option<&'a Instrument> {
    let s = symbol.trim().trim_start_matches('/').to_ascii_uppercase();
    instruments
        .iter()
        .filter(|i| symbol_matches_root(&s, &i.root))
        .max_by_key(|i| i.root.len())
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Long,
    Short,
}

impl Side {
    /// Accepts trade direction (`long`/`short`) and the order-side words
    /// platforms use for the opening fill (`buy`, `sell`, `B`, `S`, `Bot`, `Sld`).
    pub fn parse(s: &str) -> Option<Side> {
        match s.trim().to_ascii_lowercase().as_str() {
            "long" | "l" | "buy" | "b" | "bot" | "bought" => Some(Side::Long),
            "short" | "s" | "sell" | "sld" | "sold" => Some(Side::Short),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Side::Long => "long",
            Side::Short => "short",
        }
    }
}

/// Unvalidated trade fields as text, from a command payload or a CSV row.
#[derive(Debug, Default, Clone)]
pub struct TradeDraft<'a> {
    pub symbol: &'a str,
    pub side: &'a str,
    pub quantity: &'a str,
    pub entry_at: &'a str,
    pub entry_price: &'a str,
    pub exit_at: Option<&'a str>,
    pub exit_price: Option<&'a str>,
    pub fees: Option<&'a str>,
    pub realized_pnl: Option<&'a str>,
    pub notes: Option<&'a str>,
}

/// Validated trade fields. Field names in issues match the command payload
/// (`entryAt`, `exitPrice`, ...).
#[derive(Debug, Clone, PartialEq)]
pub struct TradeFields {
    pub symbol: String,
    pub side: Side,
    pub quantity: Decimal,
    pub entry_at: DateTime<Utc>,
    pub entry_price: Decimal,
    pub exit_at: Option<DateTime<Utc>>,
    pub exit_price: Option<Decimal>,
    pub fees_micros: i64,
    pub reported_pnl_micros: Option<i64>,
    pub notes: Option<String>,
}

fn present(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

pub type TimeParser<'a> = dyn Fn(&str) -> Result<DateTime<Utc>, String> + 'a;

/// Parser for command payloads: RFC 3339 with an offset.
pub fn parse_payload_time(s: &str) -> Result<DateTime<Utc>, String> {
    parse_instant(s).ok_or_else(|| {
        "must be an ISO 8601 date-time with offset, e.g. 2026-10-19T14:30:00Z".into()
    })
}

pub fn validate_trade(
    d: &TradeDraft,
    parse_time: &TimeParser,
) -> Result<TradeFields, Vec<FieldIssue>> {
    let mut issues = Vec::new();
    let mut issue = |field: &str, msg: &str| issues.push(FieldIssue::new(field, msg));

    let symbol = d.symbol.trim().to_ascii_uppercase();
    if symbol.is_empty() || symbol.chars().count() > 32 {
        issue("symbol", "must be 1–32 characters");
    }
    let side = Side::parse(d.side);
    if side.is_none() {
        issue("side", "must be long or short (buy/sell accepted)");
    }
    let quantity = parse_decimal(d.quantity);
    match quantity {
        None => issue("quantity", "must be a number"),
        Some(q) if q <= Decimal::ZERO => issue("quantity", "must be greater than zero"),
        _ => {}
    }

    let mut time = |field: &str, s: &str| match parse_time(s) {
        Ok(t) if (1970..=2200).contains(&t.year()) => Some(t),
        Ok(_) => {
            issue(field, "year is out of range");
            None
        }
        Err(msg) => {
            issue(field, &msg);
            None
        }
    };
    let entry_at = time("entryAt", d.entry_at);
    let exit_at = present(d.exit_at).and_then(|s| time("exitAt", s));
    let exit_at_given = present(d.exit_at).is_some();

    let entry_price = parse_decimal(d.entry_price);
    if entry_price.is_none() {
        issue("entryPrice", "must be a number");
    }
    let exit_price_given = present(d.exit_price).is_some();
    let exit_price = present(d.exit_price).and_then(parse_decimal);
    if exit_price_given && exit_price.is_none() {
        issue("exitPrice", "must be a number");
    }
    if exit_at_given != exit_price_given {
        issue(
            if exit_at_given { "exitPrice" } else { "exitAt" },
            "exit time and exit price must be given together",
        );
    }
    if let (Some(entry), Some(exit)) = (entry_at, exit_at)
        && exit < entry
    {
        issue("exitAt", "must not be before the entry time");
    }

    let fees_micros = match present(d.fees) {
        None => Some(0),
        Some(s) => match parse_decimal(s) {
            None => {
                issue("fees", "must be a number");
                None
            }
            Some(f) if f < Decimal::ZERO => {
                issue(
                    "fees",
                    "must be zero or positive (total commissions and fees)",
                );
                None
            }
            Some(f) => to_micros(f).or_else(|| {
                issue("fees", "is too large");
                None
            }),
        },
    };

    let reported_pnl_micros = match present(d.realized_pnl) {
        None => None,
        Some(_) if !exit_price_given => {
            issue("realizedPnl", "can only be given for a closed trade");
            None
        }
        Some(s) => match parse_decimal(s).and_then(to_micros) {
            None => {
                issue("realizedPnl", "must be a number");
                None
            }
            some => some,
        },
    };

    let notes = present(d.notes).map(str::to_string);
    if notes
        .as_ref()
        .is_some_and(|n| n.chars().count() > MAX_NOTES_CHARS)
    {
        issue("notes", "is too long");
    }

    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(TradeFields {
        symbol,
        side: side.unwrap(),
        quantity: quantity.unwrap(),
        entry_at: entry_at.unwrap(),
        entry_price: entry_price.unwrap(),
        exit_at,
        exit_price,
        fees_micros: fees_micros.unwrap(),
        reported_pnl_micros,
        notes,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pnl {
    pub gross_micros: Option<i64>,
    pub net_micros: Option<i64>,
    /// 'calculated' | 'reported' | 'open' | 'missing_instrument' | 'currency_mismatch'
    pub status: &'static str,
}

/// Realized P&L in the account currency.
///
/// * Open trades have none (`open`).
/// * If the symbol resolves to an instrument quoted in the account currency:
///   gross = (exit − entry) × quantity × point value, negated for shorts.
/// * Otherwise the source-reported P&L is used if there is one (`reported`);
///   it is assumed to be in the account currency and before fees.
/// * Otherwise none (`missing_instrument` / `currency_mismatch`). No FX conversion.
///
/// Net = gross − fees.
pub fn realized_pnl(
    t: &TradeFields,
    instrument: Option<&Instrument>,
    account_currency: &str,
) -> Result<Pnl, String> {
    let Some(exit) = t.exit_price else {
        return Ok(Pnl {
            gross_micros: None,
            net_micros: None,
            status: "open",
        });
    };
    let too_large = || "P&L is too large to store".to_string();
    let (gross, status) = match instrument {
        Some(i) if i.currency == account_currency => {
            let per_unit = exit
                .checked_sub(t.entry_price)
                .and_then(|m| m.checked_mul(t.quantity))
                .ok_or_else(too_large)?;
            let mut gross = per_unit.checked_mul(i.point_value).ok_or_else(too_large)?;
            if t.side == Side::Short {
                gross = -gross;
            }
            (Some(to_micros(gross).ok_or_else(too_large)?), "calculated")
        }
        _ => match t.reported_pnl_micros {
            Some(r) => (Some(r), "reported"),
            None if instrument.is_some() => (None, "currency_mismatch"),
            None => (None, "missing_instrument"),
        },
    };
    let net = match gross {
        Some(g) => Some(g.checked_sub(t.fees_micros).ok_or_else(too_large)?),
        None => None,
    };
    Ok(Pnl {
        gross_micros: gross,
        net_micros: net,
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instruments() -> Vec<Instrument> {
        [
            ("ES", "50"),
            ("MES", "5"),
            ("MNQ", "2"),
            ("M6E", "12500"),
            ("6E", "125000"),
        ]
        .iter()
        .map(|(root, pv)| Instrument {
            id: format!("builtin:instrument:{root}"),
            root: root.to_string(),
            currency: "USD".into(),
            point_value: Decimal::from_str(pv).unwrap(),
        })
        .collect()
    }

    #[test]
    fn resolves_contract_symbols_to_the_longest_root() {
        let ins = instruments();
        let root = |s: &str| resolve_instrument(s, &ins).map(|i| i.root.as_str());
        assert_eq!(root("ES"), Some("ES"));
        assert_eq!(root("ESZ6"), Some("ES"));
        assert_eq!(root("MESH26"), Some("MES"));
        assert_eq!(root("mnqz2026"), Some("MNQ"));
        assert_eq!(root("/ESZ6"), Some("ES"));
        assert_eq!(root("NQ 12-26"), None);
        assert_eq!(root("M6EZ6"), Some("M6E"));
        assert_eq!(root("6EZ6"), Some("6E"));
        assert_eq!(root("ESPN"), None);
        assert_eq!(root("AAPL"), None);
    }

    #[test]
    fn trading_day_rolls_at_the_reset_time() {
        let ny: Tz = "America/New_York".parse().unwrap();
        let reset = parse_reset_time("17:00").unwrap();
        let at = |s: &str| parse_instant(s).unwrap();
        // 16:59 and 17:00 New York time on 19 Oct 2026 (UTC-4).
        assert_eq!(
            trading_day(at("2026-10-19T20:59:00Z"), ny, reset).to_string(),
            "2026-10-19"
        );
        assert_eq!(
            trading_day(at("2026-10-19T21:00:00Z"), ny, reset).to_string(),
            "2026-10-20"
        );
        let midnight = parse_reset_time("00:00").unwrap();
        assert_eq!(
            trading_day(at("2026-10-19T23:30:00Z"), ny, midnight).to_string(),
            "2026-10-19"
        );
    }

    #[test]
    fn weekend_trading_days_roll_to_monday() {
        let ny: Tz = "America/New_York".parse().unwrap();
        let reset = parse_reset_time("17:00").unwrap();
        let midnight = parse_reset_time("00:00").unwrap();
        let day = |s: &str, r| trading_day(parse_instant(s).unwrap(), ny, r).to_string();
        // Fri 23 Oct 2026: 16:59 is Friday's; 17:30 (after the reset) is Monday's, not Saturday's.
        assert_eq!(day("2026-10-23T20:59:00Z", reset), "2026-10-23");
        assert_eq!(day("2026-10-23T21:30:00Z", reset), "2026-10-26");
        // Saturday and Sunday before the Globex open count toward Monday; Sunday 18:00 is Monday's.
        assert_eq!(day("2026-10-24T15:00:00Z", reset), "2026-10-26");
        assert_eq!(day("2026-10-25T22:00:00Z", reset), "2026-10-26");
        // Calendar-day accounts roll weekends forward too.
        assert_eq!(day("2026-10-24T15:00:00Z", midnight), "2026-10-26");
        assert_eq!(day("2026-10-25T15:00:00Z", midnight), "2026-10-26");
        // DST end (1 Nov 2026, New York UTC-4 → UTC-5): Mon 2 Nov 16:59 local is 21:59Z.
        assert_eq!(day("2026-11-02T21:59:00Z", reset), "2026-11-02");
        assert_eq!(day("2026-11-02T22:00:00Z", reset), "2026-11-03");
    }

    #[test]
    fn only_midnight_or_afternoon_resets_are_allowed() {
        let ok = |s: &str| is_allowed_reset_time(parse_reset_time(s).unwrap());
        assert!(ok("00:00"));
        assert!(ok("12:00"));
        assert!(ok("17:00"));
        assert!(ok("23:59"));
        assert!(!ok("00:01"));
        assert!(!ok("06:00"));
        assert!(!ok("11:59"));
    }

    fn draft() -> TradeDraft<'static> {
        TradeDraft {
            symbol: "mesz6",
            side: "Long",
            quantity: "2",
            entry_at: "2026-10-19T14:30:00Z",
            entry_price: "5000.25",
            exit_at: Some("2026-10-19T14:45:00.5Z"),
            exit_price: Some("5004.00"),
            fees: Some("2.48"),
            ..Default::default()
        }
    }

    #[test]
    fn calculates_long_and_short_pnl_exactly() {
        let ins = instruments();
        let t = validate_trade(&draft(), &parse_payload_time).unwrap();
        assert_eq!(t.symbol, "MESZ6");
        let p = realized_pnl(&t, resolve_instrument(&t.symbol, &ins), "USD").unwrap();
        // (5004 − 5000.25) × 2 × $5 = $37.50; net = 37.50 − 2.48.
        assert_eq!(p.gross_micros, Some(37_500_000));
        assert_eq!(p.net_micros, Some(35_020_000));
        assert_eq!(p.status, "calculated");

        let short = TradeFields {
            side: Side::Short,
            ..t
        };
        let p = realized_pnl(&short, resolve_instrument("MES", &ins), "USD").unwrap();
        assert_eq!(p.gross_micros, Some(-37_500_000));
        assert_eq!(p.net_micros, Some(-39_980_000));
    }

    #[test]
    fn falls_back_to_reported_pnl_and_flags_unknowns() {
        let t = validate_trade(
            &TradeDraft {
                symbol: "AAPL",
                realized_pnl: Some("-12.5"),
                ..draft()
            },
            &parse_payload_time,
        )
        .unwrap();
        let p = realized_pnl(&t, None, "USD").unwrap();
        assert_eq!(
            (p.gross_micros, p.net_micros, p.status),
            (Some(-12_500_000), Some(-14_980_000), "reported")
        );

        let unknown = TradeFields {
            reported_pnl_micros: None,
            ..t.clone()
        };
        assert_eq!(
            realized_pnl(&unknown, None, "USD").unwrap().status,
            "missing_instrument"
        );
        let ins = instruments();
        assert_eq!(
            realized_pnl(&unknown, ins.first(), "EUR").unwrap().status,
            "currency_mismatch"
        );

        let open = TradeFields {
            exit_at: None,
            exit_price: None,
            ..unknown
        };
        assert_eq!(realized_pnl(&open, None, "USD").unwrap().status, "open");
    }

    #[test]
    fn reports_every_invalid_field() {
        let bad = TradeDraft {
            symbol: " ",
            side: "flat",
            quantity: "-1",
            entry_at: "yesterday",
            entry_price: "abc",
            exit_at: Some("2026-10-19T14:45:00Z"),
            exit_price: None,
            fees: Some("-1"),
            realized_pnl: None,
            notes: None,
        };
        let issues = validate_trade(&bad, &parse_payload_time).unwrap_err();
        let fields: Vec<_> = issues.iter().map(|i| i.field.as_str()).collect();
        assert_eq!(
            fields,
            [
                "symbol",
                "side",
                "quantity",
                "entryAt",
                "entryPrice",
                "exitPrice",
                "fees"
            ]
        );

        let backwards = TradeDraft {
            exit_at: Some("2026-10-19T14:00:00Z"),
            ..draft()
        };
        let issues = validate_trade(&backwards, &parse_payload_time).unwrap_err();
        assert_eq!(issues[0].field, "exitAt");
    }

    #[test]
    fn money_round_trips_through_micros() {
        assert_eq!(
            to_micros(Decimal::from_str("0.625").unwrap()),
            Some(625_000)
        );
        assert_eq!(to_micros(Decimal::from_str("0.0000005").unwrap()), Some(1));
        assert_eq!(micros_to_string(50_000_000_000), "50000");
        assert_eq!(micros_to_string(-1_250_000), "-1.25");
        assert_eq!(parse_decimal("1e5"), None);
        assert_eq!(parse_decimal("1,000"), None);
        assert_eq!(canonical(parse_decimal("21000.2500").unwrap()), "21000.25");
    }

    // -----------------------------------------------------------------------
    // B01: long/short classification and realized P&L, hand-calculated.
    // Every expected value below is a literal worked out by hand in the
    // comment beside it; none is derived by calling the code under test.
    // -----------------------------------------------------------------------

    fn unit(point_value: &str) -> Instrument {
        Instrument {
            id: "test:instrument:UNIT".into(),
            root: "UNIT".into(),
            currency: "USD".into(),
            point_value: Decimal::from_str(point_value).unwrap(),
        }
    }

    fn es() -> Instrument {
        Instrument {
            id: "builtin:instrument:ES".into(),
            root: "ES".into(),
            ..unit("50")
        }
    }

    fn closed(side: Side, qty: &str, entry: &str, exit: &str, fees_micros: i64) -> TradeFields {
        TradeFields {
            symbol: "UNIT".into(),
            side,
            quantity: Decimal::from_str(qty).unwrap(),
            entry_at: parse_instant("2026-10-20T13:30:00Z").unwrap(),
            entry_price: Decimal::from_str(entry).unwrap(),
            exit_at: Some(parse_instant("2026-10-20T13:45:00Z").unwrap()),
            exit_price: Some(Decimal::from_str(exit).unwrap()),
            fees_micros,
            reported_pnl_micros: None,
            notes: None,
        }
    }

    /// (gross, net, status) for a trade against `instrument` in a USD account.
    fn pnl(
        t: &TradeFields,
        instrument: Option<&Instrument>,
    ) -> (Option<i64>, Option<i64>, &'static str) {
        let p = realized_pnl(t, instrument, "USD").unwrap();
        (p.gross_micros, p.net_micros, p.status)
    }

    #[test]
    fn b01_the_four_direction_cases_with_unit_point_value() {
        let i = unit("1");
        // Long 100 â†’ 110: (110 âˆ’ 100) Ã— 1 Ã— 1 = +10.
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "110", 0), Some(&i)),
            (Some(10_000_000), Some(10_000_000), "calculated")
        );
        // Long 100 â†’ 90: (90 âˆ’ 100) Ã— 1 Ã— 1 = âˆ’10.
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "90", 0), Some(&i)),
            (Some(-10_000_000), Some(-10_000_000), "calculated")
        );
        // Short 100 â†’ 90: (90 âˆ’ 100) Ã— 1 Ã— 1 = âˆ’10, negated for short = +10.
        assert_eq!(
            pnl(&closed(Side::Short, "1", "100", "90", 0), Some(&i)),
            (Some(10_000_000), Some(10_000_000), "calculated")
        );
        // Short 100 â†’ 110: (110 âˆ’ 100) Ã— 1 Ã— 1 = +10, negated for short = âˆ’10.
        assert_eq!(
            pnl(&closed(Side::Short, "1", "100", "110", 0), Some(&i)),
            (Some(-10_000_000), Some(-10_000_000), "calculated")
        );
    }

    #[test]
    fn b01_flat_trades_are_zero_gross_and_lose_the_fees() {
        let i = unit("1");
        for side in [Side::Long, Side::Short] {
            // (100 âˆ’ 100) Ã— 1 Ã— 1 = 0 either way; no fees â‡’ net 0.
            assert_eq!(
                pnl(&closed(side, "1", "100", "100", 0), Some(&i)),
                (Some(0), Some(0), "calculated"),
                "{side:?}"
            );
            // Fees 1.25: net = 0 âˆ’ 1.25 = âˆ’1.25.
            assert_eq!(
                pnl(&closed(side, "1", "100", "100", 1_250_000), Some(&i)),
                (Some(0), Some(-1_250_000), "calculated"),
                "{side:?}"
            );
        }
        // ES flat, qty 3, fees 4.50: (5000.25 âˆ’ 5000.25) Ã— 3 Ã— 50 = 0; net = 0 âˆ’ 4.50 = âˆ’4.50.
        assert_eq!(
            pnl(
                &closed(Side::Long, "3", "5000.25", "5000.25", 4_500_000),
                Some(&es())
            ),
            (Some(0), Some(-4_500_000), "calculated")
        );
    }

    #[test]
    fn b01_quantity_and_point_value_multiply_for_both_directions() {
        let es = es();
        // Long 3 ES 5000.25 â†’ 5002.75: 2.5 Ã— 3 Ã— 50 = +375; fees 4.50 â‡’ net 370.50.
        assert_eq!(
            pnl(
                &closed(Side::Long, "3", "5000.25", "5002.75", 4_500_000),
                Some(&es)
            ),
            (Some(375_000_000), Some(370_500_000), "calculated")
        );
        // Short 3 ES 5000.25 â†’ 5002.75: 2.5 Ã— 3 Ã— 50 = 375, negated = âˆ’375; fees 4.50 â‡’ net âˆ’379.50.
        assert_eq!(
            pnl(
                &closed(Side::Short, "3", "5000.25", "5002.75", 4_500_000),
                Some(&es)
            ),
            (Some(-375_000_000), Some(-379_500_000), "calculated")
        );
        // Long 3 ES 5002.75 â†’ 5000.25 (loss): âˆ’2.5 Ã— 3 Ã— 50 = âˆ’375; fees 4.50 â‡’ net âˆ’379.50.
        assert_eq!(
            pnl(
                &closed(Side::Long, "3", "5002.75", "5000.25", 4_500_000),
                Some(&es)
            ),
            (Some(-375_000_000), Some(-379_500_000), "calculated")
        );
        // Short 2 ES 5010.50 â†’ 5004.25 (win): (5004.25 âˆ’ 5010.50) = âˆ’6.25 Ã— 2 Ã— 50 = âˆ’625, negated = +625;
        // fees 2.80 â‡’ net 622.20.
        assert_eq!(
            pnl(
                &closed(Side::Short, "2", "5010.50", "5004.25", 2_800_000),
                Some(&es)
            ),
            (Some(625_000_000), Some(622_200_000), "calculated")
        );
        // MNQ (pv 2) short 3 21000 â†’ 21012.50 (loss): 12.5 Ã— 3 Ã— 2 = 75, negated = âˆ’75; fees 1.11 â‡’ net âˆ’76.11.
        let mnq = unit("2");
        assert_eq!(
            pnl(
                &closed(Side::Short, "3", "21000", "21012.50", 1_110_000),
                Some(&mnq)
            ),
            (Some(-75_000_000), Some(-76_110_000), "calculated")
        );
    }

    #[test]
    fn b01_reported_pnl_is_taken_as_gross_and_fees_are_subtracted_once() {
        // Unknown instrument, source P&L 40.00, fees 3.10: gross = 40.00 (reported, assumed BEFORE fees),
        // net = 40.00 âˆ’ 3.10 = 36.90. A source that already reports NET P&L would therefore be charged its
        // fees a second time; that is the documented "before fees" assumption (docs/data-model.md).
        let t = TradeFields {
            reported_pnl_micros: Some(40_000_000),
            ..closed(Side::Long, "1", "100", "101", 3_100_000)
        };
        assert_eq!(
            pnl(&t, None),
            (Some(40_000_000), Some(36_900_000), "reported")
        );
        // Short with a reported loss âˆ’15.50 and fees 0.50: gross âˆ’15.50, net âˆ’15.50 âˆ’ 0.50 = âˆ’16.00.
        // The side does not flip a reported value: the source's sign is kept as is.
        let t = TradeFields {
            reported_pnl_micros: Some(-15_500_000),
            ..closed(Side::Short, "1", "100", "103.10", 500_000)
        };
        assert_eq!(
            pnl(&t, None),
            (Some(-15_500_000), Some(-16_000_000), "reported")
        );
        // Instrument quoted in another currency + a reported value: the reported value is used, not FX-converted.
        let eur = Instrument {
            currency: "EUR".into(),
            ..unit("1")
        };
        let t = TradeFields {
            reported_pnl_micros: Some(7_000_000),
            ..closed(Side::Long, "1", "100", "110", 1_000_000)
        };
        assert_eq!(
            pnl(&t, Some(&eur)),
            (Some(7_000_000), Some(6_000_000), "reported")
        );
    }

    #[test]
    fn b01_unknown_pnl_stays_unknown_never_zero() {
        // No instrument, no reported value: gross and net unknown, even with fees.
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "110", 2_000_000), None),
            (None, None, "missing_instrument")
        );
        assert_eq!(
            pnl(&closed(Side::Short, "1", "100", "90", 0), None),
            (None, None, "missing_instrument")
        );
        // Instrument in EUR, account in USD, no reported value: no FX conversion â‡’ unknown.
        let eur = Instrument {
            currency: "EUR".into(),
            ..unit("1")
        };
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "110", 0), Some(&eur)),
            (None, None, "currency_mismatch")
        );
        // Open (no exit): no P&L even with a known instrument and fees.
        let open = TradeFields {
            exit_at: None,
            exit_price: None,
            ..closed(Side::Short, "1", "100", "90", 1_000_000)
        };
        assert_eq!(pnl(&open, Some(&unit("1"))), (None, None, "open"));
    }

    #[test]
    fn b01_micro_rounding_is_half_away_from_zero_on_both_signs() {
        let i = unit("1");
        // Long 100 â†’ 100.0000005: 0.0000005 Ã— 1 Ã— 1 = 0.5 micro â‡’ rounds away from zero to +1 micro.
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "100.0000005", 0), Some(&i)).0,
            Some(1)
        );
        // Short 100 â†’ 100.0000005: 0.5 micro negated = âˆ’0.5 micro â‡’ âˆ’1 micro (not 0).
        assert_eq!(
            pnl(&closed(Side::Short, "1", "100", "100.0000005", 0), Some(&i)).0,
            Some(-1)
        );
        // Long 100 â†’ 99.9999995: âˆ’0.5 micro â‡’ âˆ’1 micro.
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "99.9999995", 0), Some(&i)).0,
            Some(-1)
        );
        // Below the midpoint: 0.0000004 â‡’ 0.4 micro â‡’ 0; above: 0.0000006 â‡’ 0.6 micro â‡’ 1.
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "100.0000004", 0), Some(&i)).0,
            Some(0)
        );
        assert_eq!(
            pnl(&closed(Side::Long, "1", "100", "100.0000006", 0), Some(&i)).0,
            Some(1)
        );
        // Quantity 3, point value 0.5, move 0.000001: 0.000001 Ã— 3 Ã— 0.5 = 0.0000015 = 1.5 micros â‡’ 2;
        // short â‡’ âˆ’1.5 micros â‡’ âˆ’2. Fees 1 micro â‡’ nets 1 and âˆ’3.
        let half = unit("0.5");
        assert_eq!(
            pnl(
                &closed(Side::Long, "3", "100", "100.000001", 1),
                Some(&half)
            ),
            (Some(2), Some(1), "calculated")
        );
        assert_eq!(
            pnl(
                &closed(Side::Short, "3", "100", "100.000001", 1),
                Some(&half)
            ),
            (Some(-2), Some(-3), "calculated")
        );
        // Point value 12.5, move 0.01, qty 1: 0.125 exactly = 125 000 micros, no rounding needed.
        assert_eq!(
            pnl(
                &closed(Side::Short, "1", "1.10", "1.09", 0),
                Some(&unit("12.5"))
            )
            .0,
            Some(125_000)
        );
    }

    #[test]
    fn b01_a_price_move_beyond_decimal_range_is_an_error_not_a_panic() {
        // −1 − 79228162514264337593543950335 (Decimal::MAX) does not fit a Decimal.
        for side in [Side::Long, Side::Short] {
            let t = closed(side, "1", "79228162514264337593543950335", "-1", 0);
            assert_eq!(
                realized_pnl(&t, Some(&unit("1")), "USD").unwrap_err(),
                "P&L is too large to store",
                "{side:?}"
            );
        }
    }
}
