//! CSV trade import: map columns to trade fields, preview the validation
//! result without writing, then commit every row in one transaction.
//!
//! One CSV row is one round-trip trade. Every row of a committed file is kept
//! in `import_rows` (original cells + status + issues), so skipped and failed
//! rows are never silently lost. See docs/data-model.md#csv-import.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::domain::{
    canonical, format_instant, micros_to_string, new_id, now, parse_instant, parse_tz, validate_trade, TradeDraft,
    TradeFields,
};
use crate::error::{AppError, AppResult, FieldIssue};
use crate::store::trades::{self, Derived, Provenance};
use crate::store::{account_ctx, load_instruments};

pub const MAX_CSV_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_CSV_ROWS: usize = 50_000;
/// How many importable rows the preview echoes back as a sample.
const PREVIEW_SAMPLE_ROWS: usize = 20;

/// CSV header names for each trade field. Matching is case-insensitive and
/// ignores surrounding spaces. Optional fields may be omitted or left blank.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColumnMapping {
    pub symbol: String,
    pub side: String,
    pub quantity: String,
    pub entry_time: String,
    pub entry_price: String,
    pub exit_time: Option<String>,
    pub exit_price: Option<String>,
    pub fees: Option<String>,
    pub realized_pnl: Option<String>,
    pub broker_trade_id: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvImportRequest {
    pub account_id: String,
    pub file_name: String,
    /// The file's text (UTF-8; a leading BOM is ignored).
    pub content: String,
    pub columns: ColumnMapping,
    /// IANA zone for timestamps in the file that carry no offset.
    pub timezone: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradePreview {
    pub symbol: String,
    pub side: String,
    pub quantity: String,
    pub entry_at: String,
    pub entry_price: String,
    pub exit_at: Option<String>,
    pub exit_price: Option<String>,
    pub fees: String,
    pub trading_day: String,
    pub realized_pnl: Option<String>,
    pub pnl_status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowReport {
    pub row_number: u32,
    pub line_number: u64,
    /// "new" | "duplicate" | "skipped" | "invalid"
    pub status: &'static str,
    pub issues: Vec<FieldIssue>,
    pub raw: Vec<String>,
    pub trade: Option<TradePreview>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub headers: Vec<String>,
    /// Problems with the file or mapping as a whole. When non-empty nothing
    /// can be imported.
    pub file_issues: Vec<FieldIssue>,
    /// A file with the same SHA-256 was already committed to this account.
    /// Rows are still de-duplicated individually.
    pub file_previously_imported: bool,
    pub row_count: u32,
    pub new_count: u32,
    pub duplicate_count: u32,
    pub skipped_count: u32,
    pub invalid_count: u32,
    /// Every row that would not be imported, plus a sample of new rows.
    pub rows: Vec<RowReport>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatch {
    pub id: String,
    pub account_id: String,
    pub file_name: String,
    pub file_sha256: String,
    pub file_size: i64,
    /// "committed" | "failed"
    pub status: String,
    pub row_count: i64,
    pub imported_count: i64,
    /// Duplicates plus blank rows.
    pub skipped_count: i64,
    pub duplicate_count: i64,
    pub failed_count: i64,
    pub error_summary: Option<String>,
    pub created_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRowRecord {
    pub row_number: i64,
    pub line_number: i64,
    /// "imported" | "duplicate" | "skipped" | "invalid"
    pub status: String,
    pub issues: Vec<FieldIssue>,
    pub raw: Vec<String>,
    pub duplicate_of_trade_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Parsing and validation (no writes)
// ---------------------------------------------------------------------------

// Most rows are `Valid`, so boxing it would not save memory.
#[allow(clippy::large_enum_variant)]
enum Outcome {
    Blank,
    Invalid(Vec<FieldIssue>),
    Valid { fields: TradeFields, derived: Derived, dedup_key: String, broker_trade_id: Option<String> },
}

struct ParsedRow {
    row_number: u32,
    line_number: u64,
    raw: Vec<String>,
    outcome: Outcome,
}

struct Analysis {
    headers: Vec<String>,
    file_issues: Vec<FieldIssue>,
    rows: Vec<ParsedRow>,
    sha256: String,
}

/// Column index per trade field, resolved against the header row.
#[derive(Default)]
struct Columns {
    symbol: usize,
    side: usize,
    quantity: usize,
    entry_time: usize,
    entry_price: usize,
    exit_time: Option<usize>,
    exit_price: Option<usize>,
    fees: Option<usize>,
    realized_pnl: Option<usize>,
    broker_trade_id: Option<usize>,
    notes: Option<usize>,
    /// Trade field name → header, for row messages.
    header_of: HashMap<&'static str, String>,
}

fn resolve_columns(headers: &[String], m: &ColumnMapping, issues: &mut Vec<FieldIssue>) -> Columns {
    let mut cols = Columns::default();
    let mut find = |field: &'static str, wanted: Option<&str>, required: bool| -> Option<usize> {
        let wanted = wanted.map(str::trim).filter(|w| !w.is_empty());
        let Some(wanted) = wanted else {
            if required {
                issues.push(FieldIssue::new(format!("columns.{field}"), "a column must be chosen"));
            }
            return None;
        };
        let hits: Vec<usize> = headers
            .iter()
            .enumerate()
            .filter(|(_, h)| h.trim().eq_ignore_ascii_case(wanted))
            .map(|(i, _)| i)
            .collect();
        match hits.as_slice() {
            [i] => {
                cols.header_of.insert(field, headers[*i].trim().to_string());
                Some(*i)
            }
            [] => {
                issues.push(FieldIssue::new(format!("columns.{field}"), format!("column '{wanted}' is not in the file")));
                None
            }
            _ => {
                issues.push(FieldIssue::new(format!("columns.{field}"), format!("column '{wanted}' appears more than once")));
                None
            }
        }
    };
    let symbol = find("symbol", Some(&m.symbol), true);
    let side = find("side", Some(&m.side), true);
    let quantity = find("quantity", Some(&m.quantity), true);
    let entry_time = find("entryAt", Some(&m.entry_time), true);
    let entry_price = find("entryPrice", Some(&m.entry_price), true);
    let exit_time = find("exitAt", m.exit_time.as_deref(), false);
    let exit_price = find("exitPrice", m.exit_price.as_deref(), false);
    let fees = find("fees", m.fees.as_deref(), false);
    let realized_pnl = find("realizedPnl", m.realized_pnl.as_deref(), false);
    let broker_trade_id = find("brokerTradeId", m.broker_trade_id.as_deref(), false);
    let notes = find("notes", m.notes.as_deref(), false);
    let mapped = |s: &Option<String>| s.as_deref().is_some_and(|s| !s.trim().is_empty());
    if mapped(&m.exit_time) != mapped(&m.exit_price) {
        issues.push(FieldIssue::new("columns.exitPrice", "exit time and exit price columns must be mapped together"));
    }
    cols.symbol = symbol.unwrap_or(0);
    cols.side = side.unwrap_or(0);
    cols.quantity = quantity.unwrap_or(0);
    cols.entry_time = entry_time.unwrap_or(0);
    cols.entry_price = entry_price.unwrap_or(0);
    cols.exit_time = exit_time;
    cols.exit_price = exit_price;
    cols.fees = fees;
    cols.realized_pnl = realized_pnl;
    cols.broker_trade_id = broker_trade_id;
    cols.notes = notes;
    cols
}

/// Accepts `$1,234.50`, `1 234.5` and accounting negatives `(12.50)`.
fn clean_number(s: &str) -> String {
    let s: String = s.trim().chars().filter(|c| !matches!(c, '$' | ',' | ' ')).collect();
    match s.strip_prefix('(').and_then(|s| s.strip_suffix(')')) {
        Some(inner) => format!("-{inner}"),
        None => s,
    }
}

const NAIVE_FORMATS: &[&str] = &[
    "%Y-%m-%d %H:%M:%S%.f",
    "%Y-%m-%dT%H:%M:%S%.f",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M",
    "%m/%d/%Y %H:%M:%S%.f",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %I:%M %p",
];

/// Timestamps with an offset are taken as-is; naive ones are read in `tz`.
/// Slash dates are month/day/year (US platform exports).
pub fn parse_csv_time(s: &str, tz: Tz) -> Result<DateTime<Utc>, String> {
    let s = s.trim();
    if let Some(t) = parse_instant(s) {
        return Ok(t);
    }
    for f in NAIVE_FORMATS {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, f) {
            return match tz.from_local_datetime(&naive) {
                chrono::LocalResult::Single(t) => Ok(t.with_timezone(&Utc)),
                chrono::LocalResult::Ambiguous(..) => {
                    Err(format!("'{s}' is ambiguous in {tz} (daylight-saving change); add an offset"))
                }
                chrono::LocalResult::None => Err(format!("'{s}' does not exist in {tz} (daylight-saving gap)")),
            };
        }
    }
    Err(format!("'{s}' is not a recognised date-time; use 2026-10-19 09:30:00 or 10/19/2026 09:30:00"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// See docs/data-model.md#duplicate-detection.
fn dedup_base(f: &TradeFields) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        f.symbol,
        f.side.as_str(),
        canonical(f.quantity),
        format_instant(f.entry_at),
        canonical(f.entry_price),
        f.exit_at.map(format_instant).unwrap_or_default(),
        f.exit_price.map(canonical).unwrap_or_default(),
    )
}

fn analyze(conn: &Connection, req: &CsvImportRequest) -> AppResult<Analysis> {
    let ctx = account_ctx(conn, &req.account_id)?;
    let instruments = load_instruments(conn)?;
    let content = req.content.strip_prefix('\u{feff}').unwrap_or(&req.content);
    let mut a = Analysis {
        headers: Vec::new(),
        file_issues: Vec::new(),
        rows: Vec::new(),
        sha256: sha256_hex(req.content.as_bytes()),
    };

    let name = req.file_name.trim();
    if name.is_empty() || name.chars().count() > 255 {
        a.file_issues.push(FieldIssue::new("fileName", "must be 1–255 characters"));
    }
    if req.content.len() > MAX_CSV_BYTES {
        a.file_issues.push(FieldIssue::new("content", format!("file is larger than {} MB", MAX_CSV_BYTES / 1024 / 1024)));
        return Ok(a);
    }
    let tz = parse_tz(&req.timezone);
    if tz.is_none() {
        a.file_issues.push(FieldIssue::new("timezone", "must be an IANA time zone such as America/New_York"));
    }

    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(content.as_bytes());
    match reader.headers() {
        Ok(h) if h.iter().any(|c| !c.trim().is_empty()) => a.headers = h.iter().map(str::to_string).collect(),
        Ok(_) => a.file_issues.push(FieldIssue::new("content", "the file has no header row")),
        Err(e) => a.file_issues.push(FieldIssue::new("content", format!("the header row cannot be read: {e}"))),
    }
    let cols = resolve_columns(&a.headers, &req.columns, &mut a.file_issues);
    if !a.file_issues.is_empty() {
        return Ok(a);
    }
    let tz = tz.unwrap();
    let parse_time = move |s: &str| parse_csv_time(s, tz);

    let mut occurrences: HashMap<String, u32> = HashMap::new();
    for (i, record) in reader.records().enumerate() {
        if i >= MAX_CSV_ROWS {
            a.file_issues.push(FieldIssue::new("content", format!("the file has more than {MAX_CSV_ROWS} rows")));
            break;
        }
        let row_number = i as u32 + 1;
        let record = match record {
            Ok(r) => r,
            Err(e) => {
                a.rows.push(ParsedRow {
                    row_number,
                    line_number: e.position().map(|p| p.line()).unwrap_or(0),
                    raw: Vec::new(),
                    outcome: Outcome::Invalid(vec![FieldIssue::new("row", format!("unreadable row: {e}"))]),
                });
                continue;
            }
        };
        let line_number = record.position().map(|p| p.line()).unwrap_or(0);
        let raw: Vec<String> = record.iter().map(str::to_string).collect();
        if raw.iter().all(|c| c.trim().is_empty()) {
            a.rows.push(ParsedRow { row_number, line_number, raw, outcome: Outcome::Blank });
            continue;
        }

        let cell = |idx: usize| record.get(idx).unwrap_or("");
        let opt_cell = |idx: Option<usize>| idx.map(cell);
        let mut issues = Vec::new();
        if record.len() < a.headers.len() {
            issues.push(FieldIssue::new(
                "row",
                format!("has {} fields but the header has {}", record.len(), a.headers.len()),
            ));
        }
        let quantity = clean_number(cell(cols.quantity));
        let entry_price = clean_number(cell(cols.entry_price));
        let exit_price = opt_cell(cols.exit_price).map(clean_number);
        // Some platforms export costs as negative numbers; fees are stored as a positive cost.
        let fees = opt_cell(cols.fees).map(|f| clean_number(f).trim_start_matches('-').to_string());
        let pnl = opt_cell(cols.realized_pnl).map(clean_number);
        let draft = TradeDraft {
            symbol: cell(cols.symbol),
            side: cell(cols.side),
            quantity: &quantity,
            entry_at: cell(cols.entry_time),
            entry_price: &entry_price,
            exit_at: opt_cell(cols.exit_time),
            exit_price: exit_price.as_deref(),
            fees: fees.as_deref(),
            realized_pnl: pnl.as_deref(),
            notes: opt_cell(cols.notes),
        };
        let outcome = match validate_trade(&draft, &parse_time) {
            Err(field_issues) => {
                issues.extend(field_issues.into_iter().map(|mut fi| {
                    if let Some(h) = cols.header_of.get(fi.field.as_str()) {
                        fi.message = format!("{} (column '{h}')", fi.message);
                    }
                    fi
                }));
                Outcome::Invalid(issues)
            }
            Ok(_) if !issues.is_empty() => Outcome::Invalid(issues),
            Ok(fields) => match trades::derive(&fields, &ctx, &instruments) {
                Err(e) => Outcome::Invalid(vec![FieldIssue::new("row", e.to_string())]),
                Ok(derived) => {
                    let broker_trade_id =
                        opt_cell(cols.broker_trade_id).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
                    let dedup_key = match &broker_trade_id {
                        Some(id) => format!("id:{id}"),
                        None => {
                            let base = dedup_base(&fields);
                            let n = occurrences.entry(base.clone()).or_insert(0);
                            *n += 1;
                            format!("h:{}", sha256_hex(format!("{base}|{n}").as_bytes()))
                        }
                    };
                    Outcome::Valid { fields, derived, dedup_key, broker_trade_id }
                }
            },
        };
        a.rows.push(ParsedRow { row_number, line_number, raw, outcome });
    }
    if a.rows.is_empty() && a.file_issues.is_empty() {
        a.file_issues.push(FieldIssue::new("content", "the file has no data rows"));
    }
    Ok(a)
}

fn existing_trade(conn: &Connection, account_id: &str, dedup_key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM trades WHERE account_id = ?1 AND dedup_key = ?2",
        params![account_id, dedup_key],
        |r| r.get(0),
    )
    .optional()
}

fn trade_preview(f: &TradeFields, d: &Derived) -> TradePreview {
    TradePreview {
        symbol: f.symbol.clone(),
        side: f.side.as_str().to_string(),
        quantity: canonical(f.quantity),
        entry_at: format_instant(f.entry_at),
        entry_price: canonical(f.entry_price),
        exit_at: f.exit_at.map(format_instant),
        exit_price: f.exit_price.map(canonical),
        fees: micros_to_string(f.fees_micros),
        trading_day: d.trading_day.clone(),
        realized_pnl: d.pnl.net_micros.map(micros_to_string),
        pnl_status: d.pnl.status.to_string(),
    }
}

/// Validate a file against a mapping and report what a commit would do.
/// Writes nothing.
pub fn preview(conn: &Connection, req: &CsvImportRequest) -> AppResult<CsvPreview> {
    let a = analyze(conn, req)?;
    let file_previously_imported: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM import_batches
                        WHERE account_id = ?1 AND file_sha256 = ?2 AND status = 'committed')",
        params![req.account_id, a.sha256],
        |r| r.get(0),
    )?;
    let mut p = CsvPreview {
        headers: a.headers,
        file_issues: a.file_issues,
        file_previously_imported,
        row_count: a.rows.len() as u32,
        new_count: 0,
        duplicate_count: 0,
        skipped_count: 0,
        invalid_count: 0,
        rows: Vec::new(),
    };
    let mut seen_in_file: HashMap<String, u32> = HashMap::new();
    let mut sampled = 0usize;
    for row in a.rows {
        let (status, issues, trade) = match &row.outcome {
            Outcome::Blank => {
                p.skipped_count += 1;
                ("skipped", vec![FieldIssue::new("row", "blank row")], None)
            }
            Outcome::Invalid(issues) => {
                p.invalid_count += 1;
                ("invalid", issues.clone(), None)
            }
            Outcome::Valid { fields, derived, dedup_key, .. } => {
                let preview = Some(trade_preview(fields, derived));
                if let Some(first) = seen_in_file.get(dedup_key) {
                    p.duplicate_count += 1;
                    let msg = format!("same broker trade ID as row {first}");
                    ("duplicate", vec![FieldIssue::new("brokerTradeId", msg)], preview)
                } else if existing_trade(conn, &req.account_id, dedup_key)?.is_some() {
                    p.duplicate_count += 1;
                    ("duplicate", vec![FieldIssue::new("row", "already imported into this account")], preview)
                } else {
                    seen_in_file.insert(dedup_key.clone(), row.row_number);
                    p.new_count += 1;
                    ("new", Vec::new(), preview)
                }
            }
        };
        if status != "new" || sampled < PREVIEW_SAMPLE_ROWS {
            sampled += usize::from(status == "new");
            p.rows.push(RowReport {
                row_number: row.row_number,
                line_number: row.line_number,
                status,
                issues,
                raw: row.raw,
                trade,
            });
        }
    }
    p.skipped_count += p.duplicate_count;
    Ok(p)
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

struct Counts {
    imported: i64,
    duplicate: i64,
    blank: i64,
    failed: i64,
}

fn write_batch(conn: &mut Connection, req: &CsvImportRequest, a: &Analysis, started: &str) -> AppResult<String> {
    let batch_id = new_id();
    let snapshot = serde_json::json!({ "columns": req.columns, "timezone": req.timezone, "headers": a.headers });
    let tx = conn.transaction()?;
    // Counts start at zero and are filled in once every row is written.
    tx.execute(
        "INSERT INTO import_batches (id, account_id, file_name, file_sha256, file_size, mapping_snapshot_json,
                                     source_timezone, status, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'committed', ?8, ?8)",
        params![
            batch_id,
            req.account_id,
            req.file_name.trim(),
            a.sha256,
            req.content.len() as i64,
            snapshot.to_string(),
            req.timezone.trim(),
            started
        ],
    )?;

    let mut c = Counts { imported: 0, duplicate: 0, blank: 0, failed: 0 };
    for row in &a.rows {
        let row_id = new_id();
        let raw_json = serde_json::to_string(&row.raw).unwrap_or_else(|_| "[]".into());
        let insert_row = |status: &str, issues: &[FieldIssue], duplicate_of: Option<&str>| {
            tx.execute(
                "INSERT INTO import_rows (id, batch_id, row_number, line_number, raw_json, status, issues_json,
                                          duplicate_of_trade_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    row_id,
                    batch_id,
                    row.row_number,
                    row.line_number.max(1) as i64,
                    raw_json,
                    status,
                    serde_json::to_string(issues).unwrap_or_else(|_| "[]".into()),
                    duplicate_of
                ],
            )
        };
        match &row.outcome {
            Outcome::Blank => {
                c.blank += 1;
                insert_row("skipped", &[FieldIssue::new("row", "blank row")], None)?;
            }
            Outcome::Invalid(issues) => {
                c.failed += 1;
                insert_row("invalid", issues, None)?;
            }
            Outcome::Valid { fields, derived, dedup_key, broker_trade_id } => {
                if let Some(existing) = existing_trade(&tx, &req.account_id, dedup_key)? {
                    c.duplicate += 1;
                    let issue = FieldIssue::new("row", "already imported into this account");
                    insert_row("duplicate", &[issue], Some(&existing))?;
                } else {
                    c.imported += 1;
                    insert_row("imported", &[], None)?;
                    let prov = Provenance {
                        batch_id: &batch_id,
                        row_id: &row_id,
                        dedup_key,
                        broker_trade_id: broker_trade_id.as_deref(),
                    };
                    trades::insert(&tx, &req.account_id, Some(&prov), fields, derived, started)?;
                }
            }
        }
    }

    tx.execute(
        "UPDATE import_batches SET row_count = ?2, imported_count = ?3, skipped_count = ?4, duplicate_count = ?5,
                failed_count = ?6, completed_at = ?7
         WHERE id = ?1",
        params![
            batch_id,
            a.rows.len() as i64,
            c.imported,
            c.duplicate + c.blank,
            c.duplicate,
            c.failed,
            now()
        ],
    )?;
    tx.commit()?;
    Ok(batch_id)
}

/// Record an attempt that wrote no trades, so import history explains it.
fn record_failed(conn: &Connection, req: &CsvImportRequest, a: &Analysis, started: &str, error: &str) -> AppResult<()> {
    let snapshot = serde_json::json!({ "columns": req.columns, "timezone": req.timezone, "headers": a.headers });
    let name = req.file_name.trim();
    let name: String = if name.is_empty() { "(unnamed)".into() } else { name.chars().take(255).collect() };
    conn.execute(
        "INSERT INTO import_batches (id, account_id, file_name, file_sha256, file_size, mapping_snapshot_json,
                                     source_timezone, status, row_count, failed_count, error_summary,
                                     created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'failed', ?8, ?8, ?9, ?10, ?11)",
        params![
            new_id(),
            req.account_id,
            name,
            a.sha256,
            req.content.len() as i64,
            snapshot.to_string(),
            req.timezone.trim(),
            a.rows.len() as i64,
            error,
            started,
            now()
        ],
    )?;
    Ok(())
}

/// Import every row of the file in one transaction. Valid new rows become
/// trades; duplicates and blank rows are skipped; invalid rows are recorded
/// with their issues. If the file or mapping is unusable, or any write fails,
/// nothing is imported and a `failed` batch records the attempt.
pub fn commit(conn: &mut Connection, req: &CsvImportRequest) -> AppResult<ImportBatch> {
    let started = now();
    let a = analyze(conn, req)?;
    let result = if a.file_issues.is_empty() {
        write_batch(conn, req, &a, &started)
    } else {
        Err(AppError::validation(a.file_issues.clone()))
    };
    match result {
        Ok(id) => get_batch(conn, &id),
        Err(err) => {
            // The original error matters more than a failure to log the attempt.
            let _ = record_failed(conn, req, &a, &started, &err.to_string());
            Err(err)
        }
    }
}

const BATCH_SELECT: &str = "SELECT id, account_id, file_name, file_sha256, file_size, status, row_count,
        imported_count, skipped_count, duplicate_count, failed_count, error_summary, created_at, completed_at
    FROM import_batches";

fn batch_from_row(r: &Row) -> rusqlite::Result<ImportBatch> {
    Ok(ImportBatch {
        id: r.get(0)?,
        account_id: r.get(1)?,
        file_name: r.get(2)?,
        file_sha256: r.get(3)?,
        file_size: r.get(4)?,
        status: r.get(5)?,
        row_count: r.get(6)?,
        imported_count: r.get(7)?,
        skipped_count: r.get(8)?,
        duplicate_count: r.get(9)?,
        failed_count: r.get(10)?,
        error_summary: r.get(11)?,
        created_at: r.get(12)?,
        completed_at: r.get(13)?,
    })
}

pub fn get_batch(conn: &Connection, id: &str) -> AppResult<ImportBatch> {
    conn.query_row(&format!("{BATCH_SELECT} WHERE id = ?1"), [id], batch_from_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("import", id))
}

/// Import attempts for an account, newest first.
pub fn list_batches(conn: &Connection, account_id: &str) -> AppResult<Vec<ImportBatch>> {
    account_ctx(conn, account_id)?;
    let mut stmt = conn.prepare(&format!("{BATCH_SELECT} WHERE account_id = ?1 ORDER BY created_at DESC, id"))?;
    let rows = stmt.query_map([account_id], batch_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Rows of a committed import that were not imported, with their issues.
pub fn list_problem_rows(conn: &Connection, batch_id: &str) -> AppResult<Vec<ImportRowRecord>> {
    get_batch(conn, batch_id)?;
    let mut stmt = conn.prepare(
        "SELECT row_number, line_number, status, issues_json, raw_json, duplicate_of_trade_id
         FROM import_rows WHERE batch_id = ?1 AND status <> 'imported' ORDER BY row_number",
    )?;
    let rows = stmt.query_map([batch_id], |r| {
        let json_err = |i, e| rusqlite::Error::FromSqlConversionFailure(i, rusqlite::types::Type::Text, Box::new(e));
        Ok(ImportRowRecord {
            row_number: r.get(0)?,
            line_number: r.get(1)?,
            status: r.get(2)?,
            issues: serde_json::from_str(&r.get::<_, String>(3)?).map_err(|e| json_err(3, e))?,
            raw: serde_json::from_str(&r.get::<_, String>(4)?).map_err(|e| json_err(4, e))?,
            duplicate_of_trade_id: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests;
