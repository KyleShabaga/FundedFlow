//! CSV trade import: parse → detect format and map headers → normalize and
//! validate each row → classify duplicates → (on commit) persist atomically.
//!
//! Two formats are supported: round-trip performance exports (a buy fill and
//! a sell fill per row) and generic one-trade-per-row CSVs. Every row of a
//! committed file is kept in `import_rows` with its original cells, errors
//! and warnings, so nothing is silently dropped. See docs/data-model.md#csv-import.

pub mod dedup;
pub mod detect;
pub mod normalize;
pub mod parse;
pub mod values;
mod target;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::domain::{canonical, format_instant, micros_to_string, new_id, now, parse_tz};
use crate::error::{AppError, AppResult, FieldIssue};
use crate::store::{account_ctx, load_instruments, trades};
use dedup::{Duplicate, Match, Restore};
pub use detect::{ColumnMapping, Format};
use detect::{Detection, MappedField};
use normalize::{NormalizedTrade, Outcome};
use parse::{ParsedCsv, MAX_CSV_BYTES, MAX_CSV_ROWS};
use values::{detect_date_format, DateFormat};

/// Rows echoed in full by a preview; beyond this only rows needing
/// attention (invalid, duplicate, blank or with warnings) are listed.
const PREVIEW_ROW_LIMIT: usize = 2_000;

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FormatChoice {
    #[default]
    Auto,
    Generic,
    Performance,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DateFormatChoice {
    #[default]
    Auto,
    Ymd,
    Mdy,
    Dmy,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvImportRequest {
    pub account_id: String,
    pub file_name: String,
    /// The file's text (UTF-8; a leading BOM is ignored).
    pub content: String,
    /// IANA zone for timestamps in the file that carry no offset.
    pub timezone: String,
    #[serde(default)]
    pub format: FormatChoice,
    #[serde(default)]
    pub date_format: DateFormatChoice,
    /// Explicit header per field for generic files; omitted = match by name.
    #[serde(default)]
    pub columns: Option<ColumnMapping>,
    /// Required at commit, ignored by preview; never part of its own digest.
    #[serde(default)]
    pub target_acknowledgement: Option<target::Acknowledgement>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradePreview {
    pub symbol: String,
    pub side: &'static str,
    /// Paired-fill rows: which fill opened the trade ("buy_first", "sell_first", "same_time").
    pub entry_basis: Option<&'static str>,
    pub quantity: String,
    pub entry_at: String,
    pub entry_price: String,
    pub exit_at: Option<String>,
    pub exit_price: Option<String>,
    pub fees: String,
    pub trading_day: String,
    pub realized_pnl: Option<String>,
    pub reported_pnl: Option<String>,
    pub pnl_status: &'static str,
    pub buy_fill_id: Option<String>,
    pub sell_fill_id: Option<String>,
    pub bought_at_source: Option<String>,
    pub sold_at_source: Option<String>,
    pub duration: Option<String>,
    pub duration_seconds: Option<u64>,
    pub broker_trade_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowReport {
    pub row_number: u32,
    /// Line of the file where the record starts (header = line 1).
    pub line_number: u64,
    /// "new" | "duplicate" | "blank" | "invalid"
    pub status: &'static str,
    pub errors: Vec<FieldIssue>,
    pub warnings: Vec<FieldIssue>,
    pub duplicate: Option<Duplicate>,
    /// For a "new" row: the deleted trade it brings back instead of inserting one.
    pub restores: Option<Restore>,
    pub raw: Vec<String>,
    pub trade: Option<TradePreview>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub max_bytes: usize,
    pub max_rows: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub target_assessment: target::Assessment,
    pub format: Format,
    pub format_reason: String,
    pub date_format: Option<DateFormat>,
    pub date_format_reason: String,
    pub headers: Vec<String>,
    pub mapping: Vec<MappedField>,
    pub ignored_headers: Vec<String>,
    /// Problems with the file, mapping or settings; when non-empty nothing can be imported.
    pub file_issues: Vec<FieldIssue>,
    pub file_warnings: Vec<FieldIssue>,
    /// A file with the same SHA-256 was already committed to this account.
    pub file_previously_imported: bool,
    pub row_count: u32,
    pub new_count: u32,
    /// New rows that restore a deleted trade (included in `new_count`).
    pub restore_count: u32,
    pub duplicate_count: u32,
    pub blank_count: u32,
    pub invalid_count: u32,
    /// Rows (any status) with at least one warning.
    pub warning_count: u32,
    pub rows: Vec<RowReport>,
    /// Plain new rows left out of `rows` beyond the preview limit.
    pub rows_omitted: u32,
    pub limits: Limits,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatch {
    pub id: String,
    pub account_id: String,
    pub file_name: String,
    pub file_sha256: String,
    pub file_size: i64,
    pub source_format: String,
    /// "committed" | "failed"
    pub status: String,
    pub row_count: i64,
    pub imported_count: i64,
    /// Duplicates plus blank rows.
    pub skipped_count: i64,
    pub duplicate_count: i64,
    /// Invalid rows.
    pub failed_count: i64,
    pub warning_count: i64,
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
    pub errors: Vec<FieldIssue>,
    pub warnings: Vec<FieldIssue>,
    pub raw: Vec<String>,
    pub duplicate_of_trade_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Analysis (no writes)
// ---------------------------------------------------------------------------

struct Analysis {
    parsed: ParsedCsv,
    detection: Option<Detection>,
    date_format: Option<DateFormat>,
    date_format_reason: String,
    file_issues: Vec<FieldIssue>,
    file_warnings: Vec<FieldIssue>,
    outcomes: Vec<Outcome>,
    sha256: String,
}

impl Analysis {
    fn format(&self) -> Format {
        self.detection.as_ref().map(|d| d.format).unwrap_or(Format::Generic)
    }
}

fn choose_date_format(req: &CsvImportRequest, parsed: &ParsedCsv, d: &Detection) -> Result<(DateFormat, String), String> {
    let explicit = match req.date_format {
        DateFormatChoice::Ymd => Some(DateFormat::Ymd),
        DateFormatChoice::Mdy => Some(DateFormat::Mdy),
        DateFormatChoice::Dmy => Some(DateFormat::Dmy),
        DateFormatChoice::Auto => None,
    };
    if let Some(f) = explicit {
        return Ok((f, format!("{} (chosen)", f.label())));
    }
    let time_fields: &[&str] = match d.format {
        Format::Performance => &["boughtTimestamp", "soldTimestamp"],
        Format::Generic => &["entryTime", "exitTime"],
    };
    let samples: Vec<&str> = parsed
        .rows
        .iter()
        .take(1_000)
        .flat_map(|r| time_fields.iter().filter_map(|f| d.columns.get(f).and_then(|i| r.cells.get(i))))
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    match (d.format, detect_date_format(&samples)) {
        (_, Ok(found)) => Ok(found),
        // Performance exports write month first; say so instead of guessing silently.
        (Format::Performance, Err(e)) if e.contains("Choose the date format") => {
            Ok((DateFormat::Mdy, "M/D/YYYY HH:MM:SS, the performance export's date format".into()))
        }
        (_, Err(e)) => Err(e),
    }
}

fn analyze(conn: &Connection, req: &CsvImportRequest) -> AppResult<Analysis> {
    let account = account_ctx(conn, &req.account_id)?;
    let instruments = load_instruments(conn)?;
    let mut a = Analysis {
        parsed: ParsedCsv::default(),
        detection: None,
        date_format: None,
        date_format_reason: String::new(),
        file_issues: Vec::new(),
        file_warnings: Vec::new(),
        outcomes: Vec::new(),
        sha256: dedup::sha256_hex(req.content.as_bytes()),
    };
    let name = req.file_name.trim();
    if name.is_empty() || name.chars().count() > 255 {
        a.file_issues.push(FieldIssue::new("fileName", "must be 1–255 characters"));
    }
    let tz = parse_tz(&req.timezone);
    if tz.is_none() {
        a.file_issues.push(FieldIssue::new("timezone", "must be an IANA time zone such as America/New_York"));
    }

    a.parsed = parse::parse(&req.content);
    a.file_issues.append(&mut a.parsed.issues);
    if a.parsed.headers.is_empty() {
        return Ok(a);
    }
    let format = match req.format {
        FormatChoice::Auto => None,
        FormatChoice::Generic => Some(Format::Generic),
        FormatChoice::Performance => Some(Format::Performance),
    };
    let mut d = detect::detect(&a.parsed.headers, format, req.columns.as_ref());
    a.file_issues.append(&mut d.issues);
    a.file_warnings.append(&mut d.warnings);
    match choose_date_format(req, &a.parsed, &d) {
        Ok((f, reason)) => {
            a.date_format = Some(f);
            a.date_format_reason = reason;
        }
        Err(e) => a.file_issues.push(FieldIssue::new("dateFormat", e)),
    }
    if a.file_issues.is_empty() {
        let ctx = normalize::Ctx {
            format: d.format,
            columns: &d.columns,
            headers: &a.parsed.headers,
            tz: tz.unwrap(),
            date_format: a.date_format.unwrap(),
            account: &account,
            instruments: &instruments,
        };
        a.outcomes = a.parsed.rows.iter().map(|r| normalize::normalize(r, &ctx)).collect();
    }
    a.detection = Some(d);
    Ok(a)
}

fn trade_preview(t: &NormalizedTrade) -> TradePreview {
    let (f, d, rt) = (&t.fields, &t.derived, t.round_trip.as_ref());
    TradePreview {
        symbol: f.symbol.clone(),
        side: f.side.as_str(),
        entry_basis: rt.map(|r| r.entry_basis.as_str()),
        quantity: canonical(f.quantity),
        entry_at: format_instant(f.entry_at),
        entry_price: canonical(f.entry_price),
        exit_at: f.exit_at.map(format_instant),
        exit_price: f.exit_price.map(canonical),
        fees: micros_to_string(f.fees_micros),
        trading_day: d.trading_day.clone(),
        realized_pnl: d.pnl.net_micros.map(micros_to_string),
        reported_pnl: f.reported_pnl_micros.map(micros_to_string),
        pnl_status: d.pnl.status,
        buy_fill_id: rt.and_then(|r| r.buy_fill_id.clone()),
        sell_fill_id: rt.and_then(|r| r.sell_fill_id.clone()),
        bought_at_source: rt.map(|r| r.bought_at_source.clone()),
        sold_at_source: rt.map(|r| r.sold_at_source.clone()),
        duration: rt.and_then(|r| r.duration_source.clone()),
        duration_seconds: rt.and_then(|r| r.duration_seconds),
        broker_trade_id: t.broker_trade_id.clone(),
    }
}

fn pairs(a: &Analysis) -> Vec<(&parse::RawRow, &Outcome)> {
    a.parsed.rows.iter().zip(a.outcomes.iter()).collect()
}

fn warnings_of(o: &Outcome) -> &[FieldIssue] {
    match o {
        Outcome::Blank => &[],
        Outcome::Invalid { warnings, .. } | Outcome::Valid { warnings, .. } => warnings,
    }
}

/// Validate a file and report what a commit would do. Writes nothing.
pub fn preview(conn: &Connection, req: &CsvImportRequest) -> AppResult<CsvPreview> {
    let a = analyze(conn, req)?;
    let file_previously_imported: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM import_batches
                        WHERE account_id = ?1 AND file_sha256 = ?2 AND status = 'committed')",
        params![req.account_id, a.sha256],
        |r| r.get(0),
    )?;
    let rows = pairs(&a);
    let matches = dedup::classify(conn, &req.account_id, &rows)?;
    let d = a.detection.as_ref();
    let mut p = CsvPreview {
        target_assessment: target::assess(conn, req, &a, &matches)?,
        format: a.format(),
        format_reason: d.map(|d| d.reason.clone()).unwrap_or_default(),
        date_format: a.date_format,
        date_format_reason: a.date_format_reason.clone(),
        headers: a.parsed.headers.clone(),
        mapping: d.map(|d| d.mapping.clone()).unwrap_or_default(),
        ignored_headers: d.map(|d| d.ignored_headers.clone()).unwrap_or_default(),
        file_issues: a.file_issues.clone(),
        file_warnings: a.file_warnings.clone(),
        file_previously_imported,
        row_count: a.parsed.rows.len() as u32,
        new_count: 0,
        restore_count: 0,
        duplicate_count: 0,
        blank_count: 0,
        invalid_count: 0,
        warning_count: 0,
        rows: Vec::new(),
        rows_omitted: 0,
        limits: Limits { max_bytes: MAX_CSV_BYTES, max_rows: MAX_CSV_ROWS },
    };
    for (i, ((raw, outcome), m)) in rows.into_iter().zip(matches).enumerate() {
        let (duplicate, restores, ambiguous) = match m {
            Match::New => (None, None, None),
            Match::Restore(r) => (None, Some(r), None),
            Match::Duplicate(d) => (Some(d), None, None),
            Match::Ambiguous(a) => (None, None, Some(a)),
        };
        let warnings = warnings_of(outcome).to_vec();
        p.warning_count += u32::from(!warnings.is_empty());
        let (status, errors, trade) = match outcome {
            Outcome::Blank => ("blank", Vec::new(), None),
            Outcome::Invalid { errors, .. } => ("invalid", errors.clone(), None),
            Outcome::Valid { .. } if ambiguous.is_some() => {
                ("invalid", vec![FieldIssue::new("identity", ambiguous.as_ref().unwrap().reason.clone())], None)
            }
            Outcome::Valid { trade, .. } => {
                (if duplicate.is_some() { "duplicate" } else { "new" }, Vec::new(), Some(trade_preview(trade)))
            }
        };
        match status {
            "blank" => p.blank_count += 1,
            "invalid" => p.invalid_count += 1,
            "duplicate" => p.duplicate_count += 1,
            _ => {
                p.new_count += 1;
                p.restore_count += u32::from(restores.is_some());
            }
        }
        if i >= PREVIEW_ROW_LIMIT && status == "new" && warnings.is_empty() && restores.is_none() {
            p.rows_omitted += 1;
            continue;
        }
        p.rows.push(RowReport {
            row_number: raw.row_number,
            line_number: raw.line_number,
            status,
            errors,
            warnings,
            duplicate,
            restores,
            raw: raw.cells.clone(),
            trade,
        });
    }
    Ok(p)
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".into())
}

fn snapshot(req: &CsvImportRequest, a: &Analysis) -> String {
    let d = a.detection.as_ref();
    serde_json::json!({
        "format": a.format(),
        "dateFormat": a.date_format,
        "timezone": req.timezone,
        "headers": a.parsed.headers,
        "mapping": d.map(|d| &d.mapping),
        "columns": req.columns,
        "attemptAssessmentContract": 1,
        "targetAcknowledgement": req.target_acknowledgement,
    })
    .to_string()
}

fn insert_round_trip(conn: &Connection, trade_id: &str, rt: &normalize::RoundTrip) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO trade_round_trips (trade_id, buy_fill_id, sell_fill_id, buy_price, sell_price, bought_at,
                                        sold_at, bought_at_source, sold_at_source, duration_source,
                                        duration_seconds, price_format, price_format_type, tick_size, entry_basis)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            trade_id,
            rt.buy_fill_id,
            rt.sell_fill_id,
            canonical(rt.buy_price),
            canonical(rt.sell_price),
            format_instant(rt.bought_at),
            format_instant(rt.sold_at),
            rt.bought_at_source,
            rt.sold_at_source,
            rt.duration_source,
            rt.duration_seconds.map(|s| s as i64),
            rt.price_format,
            rt.price_format_type,
            rt.tick_size,
            rt.entry_basis.as_str(),
        ],
    )?;
    Ok(())
}

fn write_batch(conn: &mut Connection, req: &CsvImportRequest, started: &str) -> AppResult<String> {
    let batch_id = new_id();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    // Read current settings, lineage and classification under the same write
    // reservation as the import. Other connections cannot reset between them.
    let current = analyze(&tx, req)?;
    let a = &current;
    if !a.file_issues.is_empty() {
        return Err(AppError::validation(a.file_issues.clone()));
    }
    let rows = pairs(a);
    let matches = dedup::classify(&tx, &req.account_id, &rows)?;
    target::verify(req, &target::assess(&tx, req, a, &matches)?)?;
    // Counts start at zero and are filled in once every row is written.
    tx.execute(
        "INSERT INTO import_batches (id, account_id, file_name, file_sha256, file_size, mapping_snapshot_json,
                                     source_timezone, source_format, status, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'committed', ?9, ?9)",
        params![
            batch_id,
            req.account_id,
            req.file_name.trim(),
            a.sha256,
            req.content.len() as i64,
            snapshot(req, a),
            req.timezone.trim(),
            a.format().as_str(),
            started
        ],
    )?;

    let (mut imported, mut duplicate, mut blank, mut failed, mut warned) = (0i64, 0i64, 0i64, 0i64, 0i64);
    // Trades inserted or restored by this batch, so in-file duplicates can point at them.
    let mut inserted: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for ((raw, outcome), m) in rows.into_iter().zip(matches) {
        let row_id = new_id();
        let warnings = warnings_of(outcome);
        warned += i64::from(!warnings.is_empty());
        let (status, errors, duplicate_of): (&str, Vec<FieldIssue>, Option<String>) = match (outcome, &m) {
            (Outcome::Blank, _) => ("skipped", vec![FieldIssue::new("row", "blank row")], None),
            (Outcome::Invalid { errors, .. }, _) => ("invalid", errors.clone(), None),
            (Outcome::Valid { .. }, Match::Duplicate(d)) => (
                "duplicate",
                vec![FieldIssue::new("row", d.reason.clone())],
                d.trade_id.clone().or_else(|| inserted.get(&d.key).cloned()),
            ),
            // The row record keeps why it wrote no new trade.
            (Outcome::Valid { .. }, Match::Restore(r)) => ("imported", vec![FieldIssue::new("row", r.reason.clone())], None),
            // Recorded, never guessed: see dedup::Ambiguity.
            (Outcome::Valid { .. }, Match::Ambiguous(a)) => ("invalid", vec![FieldIssue::new("identity", a.reason.clone())], None),
            (Outcome::Valid { .. }, Match::New) => ("imported", Vec::new(), None),
        };
        match status {
            "skipped" => blank += 1,
            "invalid" => failed += 1,
            "duplicate" => duplicate += 1,
            _ => imported += 1,
        }
        tx.execute(
            "INSERT INTO import_rows (id, batch_id, row_number, line_number, raw_json, status, issues_json,
                                      warnings_json, duplicate_of_trade_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                row_id,
                batch_id,
                raw.row_number,
                raw.line_number.max(1) as i64,
                json(&raw.cells),
                status,
                json(&errors),
                json(&warnings),
                duplicate_of
            ],
        )?;
        if let (Outcome::Valid { .. }, Match::Restore(r)) = (outcome, &m) {
            trades::restore(&tx, &r.trade_id)?;
            inserted.insert(r.key.clone(), r.trade_id.clone());
        }
        if let (Outcome::Valid { trade, .. }, Match::New) = (outcome, &m) {
            let key = dedup::key(&trade.identity);
            let prov = trades::Provenance {
                batch_id: &batch_id,
                row_id: &row_id,
                dedup_key: &key,
                broker_trade_id: trade.broker_trade_id.as_deref(),
            };
            let trade_id = trades::insert(&tx, &req.account_id, Some(&prov), &trade.fields, &trade.derived, started)?;
            if let Some(rt) = &trade.round_trip {
                insert_round_trip(&tx, &trade_id, rt)?;
            }
            inserted.insert(key, trade_id);
        }
    }

    tx.execute(
        "UPDATE import_batches SET row_count = ?2, imported_count = ?3, skipped_count = ?4, duplicate_count = ?5,
                failed_count = ?6, warning_count = ?7, completed_at = ?8
         WHERE id = ?1",
        params![batch_id, a.parsed.rows.len() as i64, imported, duplicate + blank, duplicate, failed, warned, now()],
    )?;
    tx.commit()?;
    Ok(batch_id)
}

/// Record an attempt that wrote no trades, so import history explains it.
fn record_failed(conn: &Connection, req: &CsvImportRequest, a: &Analysis, started: &str, error: &str) -> AppResult<()> {
    let name = req.file_name.trim();
    let name: String = if name.is_empty() { "(unnamed)".into() } else { name.chars().take(255).collect() };
    conn.execute(
        "INSERT INTO import_batches (id, account_id, file_name, file_sha256, file_size, mapping_snapshot_json,
                                     source_timezone, source_format, status, row_count, failed_count,
                                     error_summary, created_at, completed_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'failed', ?9, ?9, ?10, ?11, ?12
         WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?2 AND archived_at IS NULL)",
        params![
            new_id(),
            req.account_id,
            name,
            a.sha256,
            req.content.len() as i64,
            snapshot(req, a),
            req.timezone.trim(),
            a.format().as_str(),
            a.parsed.rows.len() as i64,
            error,
            started,
            now()
        ],
    )?;
    Ok(())
}

/// Import a previewed file in one transaction: new valid rows become trades;
/// duplicates and blank rows are skipped; invalid rows are recorded with
/// their errors. If the file is unusable or any write fails, nothing is
/// imported and a `failed` batch records the attempt.
pub fn commit(conn: &mut Connection, req: &CsvImportRequest) -> AppResult<ImportBatch> {
    let started = now();
    let a = analyze(conn, req)?;
    let result = if a.file_issues.is_empty() {
        write_batch(conn, req, &started)
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

/// Test callers outside the acknowledgement regression suite model the complete
/// preview/review flow. Production callers must send their actual reviewed token.
#[cfg(test)]
pub(crate) fn commit_reviewed(conn: &mut Connection, req: &CsvImportRequest) -> AppResult<ImportBatch> {
    let p = preview(conn, req)?;
    let mut reviewed = req.clone();
    reviewed.target_acknowledgement = Some(target::Acknowledgement {
        preview_token: p.target_assessment.preview_token,
        historical_confirmed: true,
    });
    commit(conn, &reviewed)
}

const BATCH_SELECT: &str = "SELECT id, account_id, file_name, file_sha256, file_size, source_format, status,
        row_count, imported_count, skipped_count, duplicate_count, failed_count, warning_count, error_summary,
        created_at, completed_at
    FROM import_batches";

fn batch_from_row(r: &Row) -> rusqlite::Result<ImportBatch> {
    Ok(ImportBatch {
        id: r.get(0)?,
        account_id: r.get(1)?,
        file_name: r.get(2)?,
        file_sha256: r.get(3)?,
        file_size: r.get(4)?,
        source_format: r.get(5)?,
        status: r.get(6)?,
        row_count: r.get(7)?,
        imported_count: r.get(8)?,
        skipped_count: r.get(9)?,
        duplicate_count: r.get(10)?,
        failed_count: r.get(11)?,
        warning_count: r.get(12)?,
        error_summary: r.get(13)?,
        created_at: r.get(14)?,
        completed_at: r.get(15)?,
    })
}

pub fn get_batch(conn: &Connection, id: &str) -> AppResult<ImportBatch> {
    conn.query_row(&format!("{BATCH_SELECT} WHERE id = ?1"), [id], batch_from_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("import", id))
}

/// Import attempts for an account, newest first.
pub fn list_batches(conn: &Connection, account_id: &str) -> AppResult<Vec<ImportBatch>> {
    crate::store::require_account(conn, account_id)?;
    let mut stmt = conn.prepare(&format!("{BATCH_SELECT} WHERE account_id = ?1 ORDER BY created_at DESC, id"))?;
    let rows = stmt.query_map([account_id], batch_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Rows of an import that were not imported or carried warnings.
pub fn list_problem_rows(conn: &Connection, batch_id: &str) -> AppResult<Vec<ImportRowRecord>> {
    get_batch(conn, batch_id)?;
    let mut stmt = conn.prepare(
        "SELECT row_number, line_number, status, issues_json, warnings_json, raw_json, duplicate_of_trade_id
         FROM import_rows WHERE batch_id = ?1 AND (status <> 'imported' OR warnings_json <> '[]')
         ORDER BY row_number",
    )?;
    fn json_col<T: serde::de::DeserializeOwned>(r: &Row, i: usize) -> rusqlite::Result<T> {
        serde_json::from_str(&r.get::<_, String>(i)?)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(i, rusqlite::types::Type::Text, Box::new(e)))
    }
    let rows = stmt.query_map([batch_id], |r| {
        Ok(ImportRowRecord {
            row_number: r.get(0)?,
            line_number: r.get(1)?,
            status: r.get(2)?,
            errors: json_col(r, 3)?,
            warnings: json_col(r, 4)?,
            raw: json_col(r, 5)?,
            duplicate_of_trade_id: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests;
