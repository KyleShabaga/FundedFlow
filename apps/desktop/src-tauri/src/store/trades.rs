use std::str::FromStr;

use rusqlite::{params, Connection, OptionalExtension, Row};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::{account_ctx, load_instruments, AccountCtx};
use crate::domain::{
    canonical, format_instant, micros_to_string, new_id, now, parse_instant, parse_payload_time, realized_pnl,
    resolve_instrument, trading_day, validate_trade, Instrument, Pnl, Side, TradeDraft, TradeFields,
};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TradeInput {
    pub account_id: String,
    pub symbol: String,
    /// "long" | "short"
    pub side: String,
    /// Decimal strings throughout; instants are ISO 8601 with offset.
    pub quantity: String,
    pub entry_at: String,
    pub entry_price: String,
    pub exit_at: Option<String>,
    pub exit_price: Option<String>,
    /// Total commissions and fees in the account currency.
    pub fees: Option<String>,
    /// Optional P&L reported by the broker, before fees; used when it cannot be calculated.
    pub realized_pnl: Option<String>,
    pub notes: Option<String>,
}

impl TradeInput {
    fn draft(&self) -> TradeDraft<'_> {
        TradeDraft {
            symbol: &self.symbol,
            side: &self.side,
            quantity: &self.quantity,
            entry_at: &self.entry_at,
            entry_price: &self.entry_price,
            exit_at: self.exit_at.as_deref(),
            exit_price: self.exit_price.as_deref(),
            fees: self.fees.as_deref(),
            realized_pnl: self.realized_pnl.as_deref(),
            notes: self.notes.as_deref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub id: String,
    pub account_id: String,
    pub source: String,
    pub import_batch_id: Option<String>,
    pub broker_trade_id: Option<String>,
    pub symbol: String,
    pub side: String,
    pub quantity: String,
    pub entry_at: String,
    pub entry_price: String,
    pub exit_at: Option<String>,
    pub exit_price: Option<String>,
    pub fees: String,
    pub trading_day: String,
    pub reported_pnl: Option<String>,
    pub gross_pnl: Option<String>,
    /// Net realized P&L (gross − fees) when known.
    pub realized_pnl: Option<String>,
    pub pnl_status: String,
    pub notes: Option<String>,
    /// Source values when imported from a paired-fill (performance) export.
    pub round_trip: Option<RoundTripSource>,
    pub created_at: String,
    pub updated_at: String,
}

/// The buy/sell fill pair a trade was normalized from, exactly as supplied.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundTripSource {
    pub buy_fill_id: Option<String>,
    pub sell_fill_id: Option<String>,
    pub buy_price: String,
    pub sell_price: String,
    pub bought_at: String,
    pub sold_at: String,
    pub bought_at_source: String,
    pub sold_at_source: String,
    pub duration_source: Option<String>,
    pub duration_seconds: Option<i64>,
    pub price_format: Option<String>,
    pub price_format_type: Option<String>,
    pub tick_size: Option<String>,
    /// "buy_first" (long), "sell_first" (short; sell filled before buy) or "same_time".
    pub entry_basis: String,
}

/// Values computed from a trade and its account; never taken from input.
pub(crate) struct Derived {
    pub trading_day: String,
    pub instrument_id: Option<String>,
    pub pnl: Pnl,
}

pub(crate) fn derive(f: &TradeFields, ctx: &AccountCtx, instruments: &[Instrument]) -> AppResult<Derived> {
    let instrument = resolve_instrument(&f.symbol, instruments);
    let pnl = realized_pnl(f, instrument, &ctx.currency).map_err(|m| AppError::invalid("exitPrice", m))?;
    Ok(Derived {
        trading_day: trading_day(f.exit_at.unwrap_or(f.entry_at), ctx.tz, ctx.reset).to_string(),
        instrument_id: instrument.map(|i| i.id.clone()),
        pnl,
    })
}

/// Where an imported trade came from.
pub(crate) struct Provenance<'a> {
    pub batch_id: &'a str,
    pub row_id: &'a str,
    pub dedup_key: &'a str,
    pub broker_trade_id: Option<&'a str>,
}

pub(crate) fn insert(
    conn: &Connection,
    account_id: &str,
    prov: Option<&Provenance>,
    f: &TradeFields,
    d: &Derived,
    now: &str,
) -> rusqlite::Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO trades (id, account_id, source, import_batch_id, import_row_id, dedup_key, broker_trade_id,
                             symbol, instrument_id, side, quantity, entry_at, entry_price, exit_at, exit_price,
                             fees_micros, trading_day, reported_pnl_micros, gross_pnl_micros, net_pnl_micros,
                             pnl_status, notes_md, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                 ?21, ?22, ?23, ?23)",
        params![
            id,
            account_id,
            if prov.is_some() { "csv_import" } else { "manual" },
            prov.map(|p| p.batch_id),
            prov.map(|p| p.row_id),
            prov.map(|p| p.dedup_key),
            prov.and_then(|p| p.broker_trade_id),
            f.symbol,
            d.instrument_id,
            f.side.as_str(),
            canonical(f.quantity),
            format_instant(f.entry_at),
            canonical(f.entry_price),
            f.exit_at.map(format_instant),
            f.exit_price.map(canonical),
            f.fees_micros,
            d.trading_day,
            f.reported_pnl_micros,
            d.pnl.gross_micros,
            d.pnl.net_micros,
            d.pnl.status,
            f.notes,
            now,
        ],
    )?;
    Ok(id)
}

const SELECT: &str = "SELECT t.id, t.account_id, t.source, t.import_batch_id, t.broker_trade_id, t.symbol, t.side,
        t.quantity, t.entry_at, t.entry_price, t.exit_at, t.exit_price, t.fees_micros, t.trading_day,
        t.reported_pnl_micros, t.gross_pnl_micros, t.net_pnl_micros, t.pnl_status, t.notes_md, t.created_at,
        t.updated_at,
        r.trade_id, r.buy_fill_id, r.sell_fill_id, r.buy_price, r.sell_price, r.bought_at, r.sold_at,
        r.bought_at_source, r.sold_at_source, r.duration_source, r.duration_seconds, r.price_format,
        r.price_format_type, r.tick_size, r.entry_basis
    FROM trades t LEFT JOIN trade_round_trips r ON r.trade_id = t.id";

fn round_trip_from_row(r: &Row) -> rusqlite::Result<Option<RoundTripSource>> {
    if r.get::<_, Option<String>>(21)?.is_none() {
        return Ok(None);
    }
    Ok(Some(RoundTripSource {
        buy_fill_id: r.get(22)?,
        sell_fill_id: r.get(23)?,
        buy_price: r.get(24)?,
        sell_price: r.get(25)?,
        bought_at: r.get(26)?,
        sold_at: r.get(27)?,
        bought_at_source: r.get(28)?,
        sold_at_source: r.get(29)?,
        duration_source: r.get(30)?,
        duration_seconds: r.get(31)?,
        price_format: r.get(32)?,
        price_format_type: r.get(33)?,
        tick_size: r.get(34)?,
        entry_basis: r.get(35)?,
    }))
}

fn from_row(r: &Row) -> rusqlite::Result<Trade> {
    let money = |i: usize| r.get::<_, Option<i64>>(i).map(|m| m.map(micros_to_string));
    Ok(Trade {
        id: r.get(0)?,
        account_id: r.get(1)?,
        source: r.get(2)?,
        import_batch_id: r.get(3)?,
        broker_trade_id: r.get(4)?,
        symbol: r.get(5)?,
        side: r.get(6)?,
        quantity: r.get(7)?,
        entry_at: r.get(8)?,
        entry_price: r.get(9)?,
        exit_at: r.get(10)?,
        exit_price: r.get(11)?,
        fees: micros_to_string(r.get(12)?),
        trading_day: r.get(13)?,
        reported_pnl: money(14)?,
        gross_pnl: money(15)?,
        realized_pnl: money(16)?,
        pnl_status: r.get(17)?,
        notes: r.get(18)?,
        round_trip: round_trip_from_row(r)?,
        created_at: r.get(19)?,
        updated_at: r.get(20)?,
    })
}

/// Active (not deleted) trades of an account, newest entry first.
pub fn list(conn: &Connection, account_id: &str) -> AppResult<Vec<Trade>> {
    super::require_account(conn, account_id)?;
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE t.account_id = ?1 AND t.deleted_at IS NULL ORDER BY t.entry_at DESC, t.id"
    ))?;
    let rows = stmt.query_map([account_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Trade> {
    conn.query_row(&format!("{SELECT} WHERE t.id = ?1 AND t.deleted_at IS NULL"), [id], from_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("trade", id))
}

fn validate(input: &TradeInput) -> AppResult<TradeFields> {
    validate_trade(&input.draft(), &parse_payload_time).map_err(AppError::validation)
}

pub fn create(conn: &mut Connection, input: TradeInput) -> AppResult<Trade> {
    let fields = validate(&input)?;
    let ctx = account_ctx(conn, &input.account_id)?;
    let derived = derive(&fields, &ctx, &load_instruments(conn)?)?;
    let id = insert(conn, &input.account_id, None, &fields, &derived, &now())?;
    get(conn, &id)
}

/// Replace a trade's editable fields. Imported trades can be corrected too;
/// their account and import provenance never change.
pub fn update(conn: &mut Connection, id: &str, input: TradeInput) -> AppResult<Trade> {
    let account_id: String = conn
        .query_row("SELECT account_id FROM trades WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::not_found("trade", id))?;
    if account_id != input.account_id {
        return Err(AppError::invalid("accountId", "a trade cannot be moved to another account"));
    }
    let fields = validate(&input)?;
    let ctx = account_ctx(conn, &account_id)?;
    let d = derive(&fields, &ctx, &load_instruments(conn)?)?;
    conn.execute(
        "UPDATE trades SET symbol = ?2, instrument_id = ?3, side = ?4, quantity = ?5, entry_at = ?6,
                entry_price = ?7, exit_at = ?8, exit_price = ?9, fees_micros = ?10, trading_day = ?11,
                reported_pnl_micros = ?12, gross_pnl_micros = ?13, net_pnl_micros = ?14, pnl_status = ?15,
                notes_md = ?16, updated_at = ?17
         WHERE id = ?1",
        params![
            id,
            fields.symbol,
            d.instrument_id,
            fields.side.as_str(),
            canonical(fields.quantity),
            format_instant(fields.entry_at),
            canonical(fields.entry_price),
            fields.exit_at.map(format_instant),
            fields.exit_price.map(canonical),
            fields.fees_micros,
            d.trading_day,
            fields.reported_pnl_micros,
            d.pnl.gross_micros,
            d.pnl.net_micros,
            d.pnl.status,
            fields.notes,
            now(),
        ],
    )?;
    get(conn, id)
}

/// Soft-delete a trade and unlink journal entries that referenced it. An
/// imported trade keeps its dedup key, so re-importing its CSV row restores it
/// (`restore`) rather than creating a second trade.
pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    let now = now();
    let tx = conn.transaction()?;
    let n = tx.execute(
        "UPDATE trades SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if n == 0 {
        return Err(AppError::not_found("trade", id));
    }
    tx.execute(
        "UPDATE journal_entries SET trade_id = NULL, updated_at = ?2 WHERE trade_id = ?1",
        params![id, now],
    )?;
    tx.commit()?;
    Ok(())
}

/// Un-delete a trade as it was saved (a CSV re-import of its row). Journal
/// links cleared by `delete` are not restored.
pub(crate) fn restore(conn: &Connection, id: &str) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE trades SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id, now()],
    )?;
    if n == 0 {
        return Err(AppError::not_found("deleted trade", id));
    }
    Ok(())
}

/// Recompute trading day, instrument and P&L for every trade of an account
/// (after its currency, timezone or reset time changed).
pub(crate) fn rederive_account(conn: &Connection, account_id: &str) -> AppResult<()> {
    let ctx = account_ctx(conn, account_id)?;
    let instruments = load_instruments(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, symbol, side, quantity, entry_at, entry_price, exit_at, exit_price, fees_micros,
                reported_pnl_micros
         FROM trades WHERE account_id = ?1",
    )?;
    let rows: Vec<(String, TradeFields)> = stmt
        .query_map([account_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                [r.get::<_, String>(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?],
                [r.get::<_, Option<String>>(6)?, r.get(7)?],
                r.get::<_, i64>(8)?,
                r.get::<_, Option<i64>>(9)?,
            ))
        })?
        .map(|row| {
            let (id, [symbol, side, qty, entry_at, entry_price], [exit_at, exit_price], fees, reported) = row?;
            let corrupt = || AppError::Database { message: format!("stored trade '{id}' is invalid") };
            let dec = |s: &str| Decimal::from_str(s).ok();
            let fields = TradeFields {
                symbol,
                side: Side::parse(&side).ok_or_else(corrupt)?,
                quantity: dec(&qty).ok_or_else(corrupt)?,
                entry_at: parse_instant(&entry_at).ok_or_else(corrupt)?,
                entry_price: dec(&entry_price).ok_or_else(corrupt)?,
                exit_at: exit_at.map(|s| parse_instant(&s).ok_or_else(corrupt)).transpose()?,
                exit_price: exit_price.map(|s| dec(&s).ok_or_else(corrupt)).transpose()?,
                fees_micros: fees,
                reported_pnl_micros: reported,
                notes: None,
            };
            Ok((id, fields))
        })
        .collect::<AppResult<_>>()?;
    for (id, f) in rows {
        let d = derive(&f, &ctx, &instruments)?;
        conn.execute(
            "UPDATE trades SET trading_day = ?2, instrument_id = ?3, gross_pnl_micros = ?4,
                    net_pnl_micros = ?5, pnl_status = ?6
             WHERE id = ?1",
            params![id, d.trading_day, d.instrument_id, d.pnl.gross_micros, d.pnl.net_micros, d.pnl.status],
        )?;
    }
    Ok(())
}
