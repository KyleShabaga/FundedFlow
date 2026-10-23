use std::str::FromStr;

use rusqlite::{Connection, OptionalExtension, Row, params};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::{AccountCtx, account_ctx, load_instruments};
use crate::domain::{
    Instrument, Pnl, Side, TradeDraft, TradeFields, canonical, format_instant, micros_to_string,
    new_id, now, parse_instant, parse_payload_time, realized_pnl, resolve_instrument, trading_day,
    validate_trade,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// Whether fees were given (an explicit 0 included). When false, `fees` is "0" but the fees are unknown,
    /// so views show the net P&L as unknown; stored P&L is unchanged (gross − 0). Never part of risk inputs.
    pub fees_recorded: bool,
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    #[serde(with = "crate::domain::duration_wire")]
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

pub(crate) fn derive(
    f: &TradeFields,
    ctx: &AccountCtx,
    instruments: &[Instrument],
) -> AppResult<Derived> {
    let instrument = resolve_instrument(&f.symbol, instruments);
    let pnl = realized_pnl(f, instrument, &ctx.currency)
        .map_err(|m| AppError::invalid("exitPrice", m))?;
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
                             pnl_status, notes_md, created_at, updated_at, fees_recorded)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                 ?21, ?22, ?23, ?23, ?24)",
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
            f.fees_recorded,
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
        r.price_format_type, r.tick_size, r.entry_basis, t.fees_recorded
    FROM trades t LEFT JOIN trade_round_trips r ON r.trade_id = t.id";

/// `SELECT` plus the deletion time as column 37.
const SELECT_DELETED: &str = "SELECT t.id, t.account_id, t.source, t.import_batch_id, t.broker_trade_id, t.symbol, t.side,
        t.quantity, t.entry_at, t.entry_price, t.exit_at, t.exit_price, t.fees_micros, t.trading_day,
        t.reported_pnl_micros, t.gross_pnl_micros, t.net_pnl_micros, t.pnl_status, t.notes_md, t.created_at,
        t.updated_at,
        r.trade_id, r.buy_fill_id, r.sell_fill_id, r.buy_price, r.sell_price, r.bought_at, r.sold_at,
        r.bought_at_source, r.sold_at_source, r.duration_source, r.duration_seconds, r.price_format,
        r.price_format_type, r.tick_size, r.entry_basis, t.fees_recorded, t.deleted_at
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
        fees_recorded: r.get(36)?,
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
    conn.query_row(
        &format!("{SELECT} WHERE t.id = ?1 AND t.deleted_at IS NULL"),
        [id],
        from_row,
    )
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

/// Optional guards for `update_with`: the stored revision the edit started from, and why.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TradeChangeOptions {
    /// The trade's `updatedAt` as last read. A later change is a conflict, never an overwrite.
    pub expected_updated_at: Option<String>,
    pub reason: Option<String>,
}

/// One row of a trade's append-only correction history (Build 20).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeCorrection {
    pub id: String,
    pub trade_id: String,
    /// "edit" | "delete" | "restore" | "import_restore"
    pub kind: String,
    pub corrected_at: String,
    pub actor: String,
    pub reason: Option<String>,
    pub changed_fields: Vec<String>,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
}

/// The stored values a correction records, as the Trade DTO names them.
fn values(t: &Trade) -> serde_json::Value {
    serde_json::json!({
        "symbol": t.symbol, "side": t.side, "quantity": t.quantity, "entryAt": t.entry_at,
        "entryPrice": t.entry_price, "exitAt": t.exit_at, "exitPrice": t.exit_price, "fees": t.fees,
        "feesRecorded": t.fees_recorded, "tradingDay": t.trading_day, "reportedPnl": t.reported_pnl, "grossPnl": t.gross_pnl,
        "realizedPnl": t.realized_pnl, "pnlStatus": t.pnl_status, "notes": t.notes,
    })
}

const ACTOR: &str = "local_user";
const MAX_REASON_CHARS: usize = 2000;

fn reason(text: Option<String>) -> AppResult<Option<String>> {
    let text = super::opt_text(text);
    if text
        .as_ref()
        .is_some_and(|r| r.chars().count() > MAX_REASON_CHARS)
    {
        return Err(AppError::invalid(
            "reason",
            format!("must be at most {MAX_REASON_CHARS} characters"),
        ));
    }
    Ok(text)
}

struct Change<'a> {
    kind: &'a str,
    actor: &'a str,
    reason: Option<&'a str>,
    changed: &'a [String],
    before: Option<&'a Trade>,
    after: Option<&'a Trade>,
    at: &'a str,
}

fn record(conn: &Connection, trade_id: &str, account_id: &str, c: Change) -> AppResult<()> {
    conn.execute(
        "INSERT INTO trade_corrections (id, trade_id, account_id, kind, corrected_at, actor, reason, changed_fields,
                                        before_json, after_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            new_id(),
            trade_id,
            account_id,
            c.kind,
            c.at,
            c.actor,
            c.reason,
            serde_json::to_string(c.changed).unwrap_or_else(|_| "[]".into()),
            c.before.map(|t| values(t).to_string()),
            c.after.map(|t| values(t).to_string()),
        ],
    )?;
    Ok(())
}

/// A write time strictly after `previous`, so a revision always changes.
pub(crate) fn later_than(previous: &str) -> String {
    let current = now();
    match parse_instant(previous) {
        Some(p) if current.as_str() <= previous => {
            format_instant(p + chrono::Duration::milliseconds(1))
        }
        _ => current,
    }
}

/// Replace a trade's editable fields. Imported trades can be corrected too;
/// their account, import provenance, original CSV row and source fills never
/// change. (Tests and older callers; commands use `update_with`.)
#[cfg(test)]
pub fn update(conn: &mut Connection, id: &str, input: TradeInput) -> AppResult<Trade> {
    update_with(conn, id, input, TradeChangeOptions::default())
}

/// `update` with an optional revision guard and reason. Every change is
/// recorded in `trade_corrections` with the old and new stored values, in the
/// same transaction; an edit that changes nothing writes nothing.
pub fn update_with(
    conn: &mut Connection,
    id: &str,
    input: TradeInput,
    options: TradeChangeOptions,
) -> AppResult<Trade> {
    let reason = reason(options.reason)?;
    let tx = conn.transaction()?;
    let before = get(&tx, id)?;
    if before.account_id != input.account_id {
        return Err(AppError::invalid(
            "accountId",
            "a trade cannot be moved to another account",
        ));
    }
    if let Some(expected) = &options.expected_updated_at
        && *expected != before.updated_at
    {
        return Err(AppError::Conflict {
            message: "this trade was changed after you opened it; reload it and apply your correction again".into(),
        });
    }
    let fields = validate(&input)?;
    let ctx = account_ctx(&tx, &before.account_id)?;
    let d = derive(&fields, &ctx, &load_instruments(&tx)?)?;
    let at = later_than(&before.updated_at);
    tx.execute(
        "UPDATE trades SET symbol = ?2, instrument_id = ?3, side = ?4, quantity = ?5, entry_at = ?6,
                entry_price = ?7, exit_at = ?8, exit_price = ?9, fees_micros = ?10, trading_day = ?11,
                reported_pnl_micros = ?12, gross_pnl_micros = ?13, net_pnl_micros = ?14, pnl_status = ?15,
                notes_md = ?16, updated_at = ?17, fees_recorded = ?18
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
            at,
            fields.fees_recorded,
        ],
    )?;
    let after = get(&tx, id)?;
    let (old, new) = (values(&before), values(&after));
    let changed: Vec<String> = new
        .as_object()
        .map(|m| {
            m.keys()
                .filter(|k| old.get(*k) != new.get(*k))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if changed.is_empty() {
        // Nothing changed: the transaction rolls back, keeping the stored revision and writing no history.
        return Ok(before);
    }
    let change = Change {
        kind: "edit",
        actor: ACTOR,
        reason: reason.as_deref(),
        changed: &changed,
        before: Some(&before),
        after: Some(&after),
        at: &at,
    };
    record(&tx, id, &before.account_id, change)?;
    tx.commit()?;
    Ok(after)
}

/// Soft-delete a trade and unlink journal entries that referenced it. An
/// imported trade keeps its dedup key, so re-importing its CSV row restores it
/// (`restore`) rather than creating a second trade. Its review, checklist
/// results and screenshots are kept and come back with it.
#[cfg(test)]
pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    delete_with(conn, id, None)
}

pub fn delete_with(conn: &mut Connection, id: &str, why: Option<String>) -> AppResult<()> {
    let why = reason(why)?;
    let tx = conn.transaction()?;
    let before = get(&tx, id)?;
    account_ctx(&tx, &before.account_id)?;
    let at = later_than(&before.updated_at);
    tx.execute(
        "UPDATE trades SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, at],
    )?;
    tx.execute(
        "UPDATE journal_entries SET trade_id = NULL, updated_at = ?2 WHERE trade_id = ?1",
        params![id, at],
    )?;
    let change = Change {
        kind: "delete",
        actor: ACTOR,
        reason: why.as_deref(),
        changed: &[],
        before: Some(&before),
        after: None,
        at: &at,
    };
    record(&tx, id, &before.account_id, change)?;
    tx.commit()?;
    Ok(())
}

/// Un-delete a trade as it was saved (a CSV re-import of its row). Journal
/// links cleared by `delete` are not restored.
pub(crate) fn restore(conn: &Connection, id: &str) -> AppResult<()> {
    restore_as(conn, id, "import_restore", "csv_import", None).map(|_| ())
}

fn restore_as(
    conn: &Connection,
    id: &str,
    kind: &str,
    actor: &str,
    why: Option<&str>,
) -> AppResult<Trade> {
    let previous: Option<(String, String)> = conn
        .query_row(
            "SELECT account_id, updated_at FROM trades WHERE id = ?1 AND deleted_at IS NOT NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (account_id, updated_at) =
        previous.ok_or_else(|| AppError::not_found("deleted trade", id))?;
    let at = later_than(&updated_at);
    conn.execute(
        "UPDATE trades SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, at],
    )?;
    let after = get(conn, id)?;
    record(
        conn,
        id,
        &account_id,
        Change {
            kind,
            actor,
            reason: why,
            changed: &[],
            before: None,
            after: Some(&after),
            at: &at,
        },
    )?;
    Ok(after)
}

/// The trader undoes a delete: the trade comes back exactly as stored, with its
/// review and screenshots. Archived accounts are read-only.
pub fn restore_deleted(
    conn: &mut Connection,
    account_id: &str,
    id: &str,
    why: Option<String>,
) -> AppResult<Trade> {
    let why = reason(why)?;
    let tx = conn.transaction()?;
    account_ctx(&tx, account_id)?;
    let owner: Option<String> = tx
        .query_row("SELECT account_id FROM trades WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .optional()?;
    if owner.as_deref() != Some(account_id) {
        return Err(AppError::not_found("deleted trade", id));
    }
    let trade = restore_as(&tx, id, "restore", ACTOR, why.as_deref())?;
    tx.commit()?;
    Ok(trade)
}

/// A soft-deleted trade and when it was deleted.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedTrade {
    pub trade: Trade,
    pub deleted_at: String,
}

/// Soft-deleted trades of an account, most recently deleted first.
pub fn list_deleted(conn: &Connection, account_id: &str) -> AppResult<Vec<DeletedTrade>> {
    super::require_account(conn, account_id)?;
    let mut stmt = conn.prepare(&format!(
        "{SELECT_DELETED} WHERE t.account_id = ?1 AND t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC, t.id"
    ))?;
    let rows = stmt.query_map([account_id], |r| {
        Ok(DeletedTrade {
            trade: from_row(r)?,
            deleted_at: r.get(37)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn corrections(conn: &Connection, trade_id: &str) -> AppResult<Vec<TradeCorrection>> {
    let mut stmt = conn.prepare(
        "SELECT id, trade_id, kind, corrected_at, actor, reason, changed_fields, before_json, after_json
         FROM trade_corrections WHERE trade_id = ?1 ORDER BY corrected_at, rowid",
    )?;
    let json = |s: Option<String>| s.and_then(|s| serde_json::from_str(&s).ok());
    let rows = stmt.query_map([trade_id], |r| {
        Ok(TradeCorrection {
            id: r.get(0)?,
            trade_id: r.get(1)?,
            kind: r.get(2)?,
            corrected_at: r.get(3)?,
            actor: r.get(4)?,
            reason: r.get(5)?,
            changed_fields: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
            before: json(r.get(7)?),
            after: json(r.get(8)?),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Where an imported trade came from: its batch and its original CSV row, unchanged.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub batch_id: String,
    pub file_name: String,
    pub file_sha256: String,
    /// "performance" | "generic"
    pub source_format: String,
    pub source_timezone: String,
    pub imported_at: String,
    pub row_number: Option<i64>,
    pub line_number: Option<i64>,
    /// The file's header row, as recorded with the import.
    pub headers: Vec<String>,
    /// The original cells exactly as read from the file, in header order.
    pub raw_cells: Option<Vec<String>>,
}

/// A trade with its provenance, correction history and its neighbours in the account.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeDetail {
    pub trade: Trade,
    pub import_source: Option<ImportSource>,
    pub corrections: Vec<TradeCorrection>,
    /// Neighbours among the account's active trades in entry order (oldest first).
    pub previous_trade_id: Option<String>,
    pub next_trade_id: Option<String>,
    /// 1-based place of this trade in that order, and the number of active trades.
    pub position: i64,
    pub total: i64,
}

/// One active trade of `account_id`. A trade of another account is "not found":
/// nothing about it is returned.
pub fn detail(conn: &Connection, account_id: &str, id: &str) -> AppResult<TradeDetail> {
    super::require_account(conn, account_id)?;
    let trade = get(conn, id)?;
    if trade.account_id != account_id {
        return Err(AppError::not_found("trade", id));
    }
    let import_source = conn
        .query_row(
            "SELECT b.id, b.file_name, b.file_sha256, b.source_format, b.source_timezone, b.created_at,
                    r.row_number, r.line_number, r.raw_json, json_extract(b.mapping_snapshot_json, '$.headers')
             FROM trades t JOIN import_batches b ON b.id = t.import_batch_id
             LEFT JOIN import_rows r ON r.id = t.import_row_id
             WHERE t.id = ?1",
            [id],
            |r| {
                Ok(ImportSource {
                    batch_id: r.get(0)?,
                    file_name: r.get(1)?,
                    file_sha256: r.get(2)?,
                    source_format: r.get(3)?,
                    source_timezone: r.get(4)?,
                    imported_at: r.get(5)?,
                    row_number: r.get(6)?,
                    line_number: r.get(7)?,
                    raw_cells: r.get::<_, Option<String>>(8)?.and_then(|s| serde_json::from_str(&s).ok()),
                    headers: r
                        .get::<_, Option<String>>(9)?
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default(),
                })
            },
        )
        .optional()?;
    let neighbour = |sql: &str| -> AppResult<Option<String>> {
        Ok(conn
            .query_row(sql, params![account_id, trade.entry_at, id], |r| r.get(0))
            .optional()?)
    };
    let previous_trade_id = neighbour(
        "SELECT id FROM trades WHERE account_id = ?1 AND deleted_at IS NULL
           AND (entry_at < ?2 OR (entry_at = ?2 AND id < ?3)) ORDER BY entry_at DESC, id DESC LIMIT 1",
    )?;
    let next_trade_id = neighbour(
        "SELECT id FROM trades WHERE account_id = ?1 AND deleted_at IS NULL
           AND (entry_at > ?2 OR (entry_at = ?2 AND id > ?3)) ORDER BY entry_at, id LIMIT 1",
    )?;
    let (position, total): (i64, i64) = conn.query_row(
        "SELECT (SELECT count(*) FROM trades WHERE account_id = ?1 AND deleted_at IS NULL
                   AND (entry_at < ?2 OR (entry_at = ?2 AND id <= ?3))),
                (SELECT count(*) FROM trades WHERE account_id = ?1 AND deleted_at IS NULL)",
        params![account_id, trade.entry_at, id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(TradeDetail {
        corrections: corrections(conn, id)?,
        trade,
        import_source,
        previous_trade_id,
        next_trade_id,
        position,
        total,
    })
}

// Recompute trading day, instrument and P&L for every trade of an account
/// (after its currency, timezone or reset time changed).
pub(crate) fn rederive_account(conn: &Connection, account_id: &str) -> AppResult<()> {
    let ctx = account_ctx(conn, account_id)?;
    let instruments = load_instruments(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, symbol, side, quantity, entry_at, entry_price, exit_at, exit_price, fees_micros,
                reported_pnl_micros, fees_recorded
         FROM trades WHERE account_id = ?1",
    )?;
    let rows: Vec<(String, TradeFields)> = stmt
        .query_map([account_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                [
                    r.get::<_, String>(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ],
                [r.get::<_, Option<String>>(6)?, r.get(7)?],
                (r.get::<_, i64>(8)?, r.get::<_, bool>(10)?),
                r.get::<_, Option<i64>>(9)?,
            ))
        })?
        .map(|row| {
            let (
                id,
                [symbol, side, qty, entry_at, entry_price],
                [exit_at, exit_price],
                (fees, fees_recorded),
                reported,
            ) = row?;
            let corrupt = || AppError::Database {
                message: format!("stored trade '{id}' is invalid"),
            };
            let dec = |s: &str| Decimal::from_str(s).ok();
            let fields = TradeFields {
                symbol,
                side: Side::parse(&side).ok_or_else(corrupt)?,
                quantity: dec(&qty).ok_or_else(corrupt)?,
                entry_at: parse_instant(&entry_at).ok_or_else(corrupt)?,
                entry_price: dec(&entry_price).ok_or_else(corrupt)?,
                exit_at: exit_at
                    .map(|s| parse_instant(&s).ok_or_else(corrupt))
                    .transpose()?,
                exit_price: exit_price
                    .map(|s| dec(&s).ok_or_else(corrupt))
                    .transpose()?,
                fees_micros: fees,
                fees_recorded,
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
            params![
                id,
                d.trading_day,
                d.instrument_id,
                d.pnl.gross_micros,
                d.pnl.net_micros,
                d.pnl.status
            ],
        )?;
    }
    Ok(())
}
