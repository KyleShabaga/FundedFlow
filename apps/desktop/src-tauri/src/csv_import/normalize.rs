//! Turning one CSV record into a validated trade (or row-specific errors).
//! Errors exclude the row; warnings are shown for review but do not.

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use rust_decimal::Decimal;

use super::detect::{Columns, Format};
use super::parse::RawRow;
use super::values::{parse_duration, parse_money, parse_number, parse_timestamp, DateFormat};
use crate::domain::{
    canonical, format_instant, micros_to_string, parse_payload_time, to_micros, validate_trade, Instrument, Side,
    TradeDraft, TradeFields,
};
use crate::error::FieldIssue;
use crate::store::trades::{self, Derived};
use crate::store::AccountCtx;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryBasis {
    BuyFirst,
    SellFirst,
    SameTime,
}

impl EntryBasis {
    pub fn as_str(self) -> &'static str {
        match self {
            EntryBasis::BuyFirst => "buy_first",
            EntryBasis::SellFirst => "sell_first",
            EntryBasis::SameTime => "same_time",
        }
    }
}

/// Source values of a paired-fill row, stored verbatim for audit.
#[derive(Debug, Clone)]
pub struct RoundTrip {
    pub buy_fill_id: Option<String>,
    pub sell_fill_id: Option<String>,
    pub buy_price: Decimal,
    pub sell_price: Decimal,
    pub bought_at: DateTime<Utc>,
    pub sold_at: DateTime<Utc>,
    pub bought_at_source: String,
    pub sold_at_source: String,
    pub duration_source: Option<String>,
    pub duration_seconds: Option<u64>,
    pub price_format: Option<String>,
    pub price_format_type: Option<String>,
    pub tick_size: Option<String>,
    pub entry_basis: EntryBasis,
}

/// What makes a row the same trade as another (see `dedup`).
#[derive(Debug, Clone, PartialEq)]
pub enum Identity {
    FillPair { buy: String, sell: String },
    TradeId(String),
    /// Normalized round-trip fields joined with `|`.
    Composite(String),
}

pub struct NormalizedTrade {
    pub fields: TradeFields,
    pub derived: Derived,
    pub round_trip: Option<RoundTrip>,
    pub broker_trade_id: Option<String>,
    pub identity: Identity,
}

pub enum Outcome {
    Blank,
    Invalid { errors: Vec<FieldIssue>, warnings: Vec<FieldIssue> },
    Valid { trade: Box<NormalizedTrade>, warnings: Vec<FieldIssue> },
}

pub struct Ctx<'a> {
    pub format: Format,
    pub columns: &'a Columns,
    pub headers: &'a [String],
    pub tz: Tz,
    pub date_format: DateFormat,
    pub account: &'a AccountCtx,
    pub instruments: &'a [Instrument],
}

/// Collects a row's findings, naming the CSV column in each message.
struct Row<'a> {
    cells: &'a [String],
    ctx: &'a Ctx<'a>,
    errors: Vec<FieldIssue>,
    warnings: Vec<FieldIssue>,
}

impl<'a> Row<'a> {
    fn column(&self, field: &str) -> String {
        self.ctx
            .columns
            .get(field)
            .and_then(|i| self.ctx.headers.get(i))
            .map(|h| format!(" (column '{}')", h.trim()))
            .unwrap_or_default()
    }

    fn error(&mut self, field: &str, msg: impl Into<String>) {
        let msg = format!("{}{}", msg.into(), self.column(field));
        self.errors.push(FieldIssue::new(field, msg));
    }

    fn warn(&mut self, field: &str, msg: impl Into<String>) {
        let msg = format!("{}{}", msg.into(), self.column(field));
        self.warnings.push(FieldIssue::new(field, msg));
    }

    /// Trimmed cell text; `None` when the field is unmapped or the cell blank.
    fn text(&self, field: &str) -> Option<&'a str> {
        let i = self.ctx.columns.get(field)?;
        self.cells.get(i).map(|c| c.trim()).filter(|c| !c.is_empty())
    }

    fn required(&mut self, field: &str) -> Option<&'a str> {
        let v = self.text(field);
        if v.is_none() {
            self.error(field, "is required");
        }
        v
    }

    fn with<T>(&mut self, field: &str, result: Result<T, String>) -> Option<T> {
        result.map_err(|m| self.error(field, m)).ok()
    }

    fn time(&mut self, field: &str, s: &str) -> Option<DateTime<Utc>> {
        let r = parse_timestamp(s, self.ctx.date_format, self.ctx.tz);
        self.with(field, r)
    }
}

const SYMBOL_EXTRA: &str = " ._/:-+=^#&";

fn check_symbol(row: &mut Row, field: &str, s: &str) {
    if s.chars().count() > 32 || !s.chars().all(|c| c.is_ascii_alphanumeric() || SYMBOL_EXTRA.contains(c)) {
        row.error(field, format!("'{s}' is not a valid symbol (letters, digits and {SYMBOL_EXTRA:?}, up to 32)"));
    }
}

fn check_id(row: &mut Row, field: &str, s: &str) -> Option<String> {
    if s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c)) {
        Some(s.to_string())
    } else {
        row.error(field, format!("'{s}' is not a valid ID (letters, digits, - _ . :, up to 64)"));
        None
    }
}

fn money_text(micros: i64) -> String {
    // i64::MIN has no positive i64 counterpart. Format before moving the sign.
    let s = micros_to_string(micros);
    if micros < 0 { format!("-${}", s.trim_start_matches('-')) } else { format!("${s}") }
}

/// Compare the exported P&L with the calculated one, when both exist.
fn pnl_check(row: &mut Row, fields: &TradeFields, derived: &Derived) {
    if let (Some(reported), "calculated", Some(gross)) =
        (fields.reported_pnl_micros, derived.pnl.status, derived.pnl.gross_micros)
        && reported != gross
    {
        row.warn(
            "realizedPnl",
            format!(
                "Exported P&L {} differs from the calculated {} (price move × quantity × point value); \
                 the calculated value is used",
                money_text(reported),
                money_text(gross)
            ),
        );
    }
}

pub fn normalize(raw: &RawRow, ctx: &Ctx) -> Outcome {
    if raw.is_blank() {
        return Outcome::Blank;
    }
    let mut row = Row { cells: &raw.cells, ctx, errors: Vec::new(), warnings: Vec::new() };
    if let Some(e) = &raw.read_error {
        row.errors.push(FieldIssue::new("row", e.clone()));
        return Outcome::Invalid { errors: row.errors, warnings: row.warnings };
    }
    if raw.cells.len() != ctx.headers.len() {
        row.errors.push(FieldIssue::new(
            "row",
            format!("has {} fields but the header has {}", raw.cells.len(), ctx.headers.len()),
        ));
    }
    let trade = match ctx.format {
        Format::Performance => performance(&mut row),
        Format::Generic => generic(&mut row),
    };
    match trade {
        Some(trade) if row.errors.is_empty() => Outcome::Valid { trade: Box::new(trade), warnings: row.warnings },
        _ => Outcome::Invalid { errors: row.errors, warnings: row.warnings },
    }
}

fn finish(
    row: &mut Row,
    fields: TradeFields,
    round_trip: Option<RoundTrip>,
    broker_trade_id: Option<String>,
    identity: Identity,
) -> Option<NormalizedTrade> {
    if !row.errors.is_empty() {
        return None;
    }
    let derived = match trades::derive(&fields, row.ctx.account, row.ctx.instruments) {
        Ok(d) => d,
        Err(e) => {
            row.error("row", e.to_string());
            return None;
        }
    };
    pnl_check(row, &fields, &derived);
    Some(NormalizedTrade { fields, derived, round_trip, broker_trade_id, identity })
}

/// One buy fill paired with one sell fill. The fill that happened first is
/// the entry: buy first ⇒ long, sell first ⇒ short (flagged for review).
fn performance(row: &mut Row) -> Option<NormalizedTrade> {
    let symbol = row.required("symbol").map(str::to_ascii_uppercase);
    if let Some(s) = &symbol {
        check_symbol(row, "symbol", s);
    }
    let quantity = row.required("quantity").and_then(|s| row.with("quantity", parse_number(s)));
    if quantity.is_some_and(|q| q <= Decimal::ZERO) {
        row.error("quantity", "must be greater than zero");
    }
    let buy_price = row.required("buyPrice").and_then(|s| row.with("buyPrice", parse_number(s)));
    let sell_price = row.required("sellPrice").and_then(|s| row.with("sellPrice", parse_number(s)));
    let bought_src = row.required("boughtTimestamp");
    let sold_src = row.required("soldTimestamp");
    let bought_at = bought_src.and_then(|s| row.time("boughtTimestamp", s));
    let sold_at = sold_src.and_then(|s| row.time("soldTimestamp", s));

    let reported = match row.text("realizedPnl") {
        Some(s) => row.with("realizedPnl", parse_money(s).and_then(|d| to_micros(d).ok_or("is too large".into()))),
        None => {
            if row.ctx.columns.get("realizedPnl").is_some() {
                row.warn("realizedPnl", "is empty; P&L will be calculated from prices");
            }
            None
        }
    };
    let duration_source = row.text("duration").map(str::to_string);
    let duration_seconds = duration_source.as_deref().and_then(|s| {
        row.with("duration", parse_duration(s).and_then(|seconds| {
            // SQLite's duration_seconds is a signed INTEGER. Never wrap on persistence.
            i64::try_from(seconds).map(|_| seconds).map_err(|_| "is too large to store".into())
        }))
    });

    let buy_fill_id = row.text("buyFillId").and_then(|s| check_id(row, "buyFillId", s));
    let sell_fill_id = row.text("sellFillId").and_then(|s| check_id(row, "sellFillId", s));
    let tick_size = row.text("tickSize").map(str::to_string);
    if let Some(t) = &tick_size
        && !parse_number(t).is_ok_and(|d| d > Decimal::ZERO)
    {
        row.warn("tickSize", format!("'{t}' is not a positive tick size; kept as text"));
    }

    let (Some(symbol), Some(quantity), Some(buy_price), Some(sell_price), Some(bought_at), Some(sold_at)) =
        (symbol, quantity, buy_price, sell_price, bought_at, sold_at)
    else {
        return None;
    };
    let (bought_src, sold_src) = (bought_src.unwrap_or_default(), sold_src.unwrap_or_default());

    if bought_at != sold_at && format_instant(bought_at) == format_instant(sold_at) {
        // The persisted millisecond timestamps cannot represent this ordering.
        // Reject the row rather than changing its side/P&L or failing the whole batch at SQLite's CHECK.
        row.error("soldTimestamp", "fill order differs only below stored millisecond precision; export supported timestamps");
    }
    let entry_basis = match bought_at.cmp(&sold_at) {
        std::cmp::Ordering::Less => EntryBasis::BuyFirst,
        std::cmp::Ordering::Equal => EntryBasis::SameTime,
        std::cmp::Ordering::Greater => EntryBasis::SellFirst,
    };
    if entry_basis == EntryBasis::SellFirst {
        row.warn(
            "soldTimestamp",
            format!(
                "Sell fill ({sold_src}) is earlier than buy fill ({bought_src}). Recorded as a short \
                 (entry = sell, exit = buy); both timestamps are stored exactly as supplied. \
                 Review if this was not a short"
            ),
        );
    }
    if let Some(d) = duration_seconds {
        let between = (sold_at - bought_at).num_seconds().unsigned_abs();
        if between.abs_diff(d) > 1 {
            row.warn(
                "duration",
                format!("{} does not match the {between}s between the fills", duration_source.as_deref().unwrap_or("")),
            );
        }
    }
    match (&buy_fill_id, &sell_fill_id) {
        (Some(_), None) | (None, Some(_)) => row.warn(
            if buy_fill_id.is_some() { "sellFillId" } else { "buyFillId" },
            "is missing, so duplicates are detected by the trade's values instead of the fill pair",
        ),
        _ => {}
    }

    let (side, entry_at, entry_price, exit_at, exit_price) = match entry_basis {
        EntryBasis::SellFirst => (Side::Short, sold_at, sell_price, bought_at, buy_price),
        _ => (Side::Long, bought_at, buy_price, sold_at, sell_price),
    };
    let fields = TradeFields {
        symbol: symbol.clone(),
        side,
        quantity,
        entry_at,
        entry_price,
        exit_at: Some(exit_at),
        exit_price: Some(exit_price),
        fees_micros: 0,
        reported_pnl_micros: reported,
        notes: None,
    };
    let identity = match (&buy_fill_id, &sell_fill_id) {
        (Some(b), Some(s)) => Identity::FillPair { buy: b.clone(), sell: s.clone() },
        _ => Identity::Composite(format!(
            "performance|{symbol}|{}|{}|{}|{}|{}|{}",
            canonical(quantity),
            canonical(buy_price),
            canonical(sell_price),
            format_instant(bought_at),
            format_instant(sold_at),
            reported.map(|r| r.to_string()).unwrap_or_default()
        )),
    };
    let round_trip = RoundTrip {
        buy_fill_id,
        sell_fill_id,
        buy_price,
        sell_price,
        bought_at,
        sold_at,
        bought_at_source: bought_src.to_string(),
        sold_at_source: sold_src.to_string(),
        duration_source,
        duration_seconds,
        price_format: row.text("priceFormat").map(str::to_string),
        price_format_type: row.text("priceFormatType").map(str::to_string),
        tick_size,
        entry_basis,
    };
    finish(row, fields, Some(round_trip), None, identity)
}

/// One trade per row with a side, entry and optional exit.
fn generic(row: &mut Row) -> Option<NormalizedTrade> {
    let symbol = row.required("symbol").unwrap_or_default();
    if !symbol.is_empty() {
        check_symbol(row, "symbol", symbol);
    }
    let side = row.required("side").unwrap_or_default();
    let quantity = row.required("quantity").and_then(|s| row.with("quantity", parse_number(s)));
    let entry_price = row.required("entryPrice").and_then(|s| row.with("entryPrice", parse_number(s)));
    let entry_at = row.required("entryTime").and_then(|s| row.time("entryTime", s));
    let exit_price = row.text("exitPrice").and_then(|s| row.with("exitPrice", parse_number(s)));
    let exit_at = row.text("exitTime").and_then(|s| row.time("exitTime", s));
    let fees = row.text("fees").and_then(|s| row.with("fees", parse_money(s)));
    if fees.is_some_and(|f| f < Decimal::ZERO) {
        row.warn("fees", "is negative; taken as a cost of the same amount");
    }
    let pnl = row.text("realizedPnl").and_then(|s| row.with("realizedPnl", parse_money(s)));
    let notes = row.text("notes");
    let broker_trade_id = row.text("brokerTradeId").and_then(|s| check_id(row, "brokerTradeId", s));

    // Shared rules (side, exit pairing and order, limits) via the same
    // validator as manual entry, fed canonical values.
    let failed: Vec<String> = row.errors.iter().map(|e| e.field.clone()).collect();
    let (q, ep, xp, f, p) = (
        quantity.map(canonical).unwrap_or_default(),
        entry_price.map(canonical).unwrap_or_default(),
        exit_price.map(canonical),
        fees.map(|f| canonical(f.abs())),
        pnl.map(canonical),
    );
    let (ea, xa) = (entry_at.map(format_instant).unwrap_or_default(), exit_at.map(format_instant));
    let has_exit_time = row.text("exitTime").is_some();
    let has_exit_price = row.text("exitPrice").is_some();
    let draft = TradeDraft {
        symbol,
        side,
        quantity: &q,
        entry_at: &ea,
        entry_price: &ep,
        // Pass the raw presence through so pairing rules still apply when a
        // value failed to parse (its own error is already recorded).
        exit_at: xa.as_deref().or(has_exit_time.then_some("")),
        exit_price: xp.as_deref().or(has_exit_price.then_some("")),
        fees: f.as_deref(),
        realized_pnl: p.as_deref(),
        notes,
    };
    let fields = match validate_trade(&draft, &parse_payload_time) {
        Ok(f) => Some(f),
        Err(issues) => {
            for i in issues.into_iter().filter(|i| !failed.contains(&i.field)) {
                row.error(&i.field, i.message);
            }
            None
        }
    }?;
    let identity = match &broker_trade_id {
        Some(id) => Identity::TradeId(id.clone()),
        None => Identity::Composite(format!(
            "generic|{}|{}|{}|{}|{}|{}|{}|{}",
            fields.symbol,
            fields.side.as_str(),
            canonical(fields.quantity),
            format_instant(fields.entry_at),
            canonical(fields.entry_price),
            fields.exit_at.map(format_instant).unwrap_or_default(),
            fields.exit_price.map(canonical).unwrap_or_default(),
            fields.reported_pnl_micros.map(|r| r.to_string()).unwrap_or_default()
        )),
    };
    finish(row, fields, None, broker_trade_id, identity)
}
