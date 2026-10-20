//! Format detection and header mapping.
//!
//! * `performance`: a round-trip export with one buy fill and one sell fill
//!   per row (`buyPrice`, `sellPrice`, `boughtTimestamp`, `soldTimestamp`, ...),
//!   as produced by Tradovate-style "Performance" reports.
//! * `generic`: one trade per row with a side and entry (and optional exit)
//!   columns, mapped by the user or matched by common broker header names.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::FieldIssue;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Generic,
    Performance,
}

impl Format {
    pub fn as_str(self) -> &'static str {
        match self {
            Format::Generic => "generic",
            Format::Performance => "performance",
        }
    }
}

/// CSV header name per generic trade field. Matching ignores case, spaces
/// and punctuation. Blank optional fields are unmapped.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
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

/// A normalized field and the header it was taken from.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappedField {
    pub field: &'static str,
    pub header: Option<String>,
    pub required: bool,
}

struct FieldSpec {
    field: &'static str,
    required: bool,
    /// Normalized header names that map to this field automatically.
    names: &'static [&'static str],
}

const PERFORMANCE_FIELDS: &[FieldSpec] = &[
    FieldSpec { field: "symbol", required: true, names: &["symbol"] },
    FieldSpec { field: "quantity", required: true, names: &["qty"] },
    FieldSpec { field: "buyPrice", required: true, names: &["buyprice"] },
    FieldSpec { field: "sellPrice", required: true, names: &["sellprice"] },
    FieldSpec { field: "boughtTimestamp", required: true, names: &["boughttimestamp"] },
    FieldSpec { field: "soldTimestamp", required: true, names: &["soldtimestamp"] },
    FieldSpec { field: "buyFillId", required: false, names: &["buyfillid"] },
    FieldSpec { field: "sellFillId", required: false, names: &["sellfillid"] },
    FieldSpec { field: "realizedPnl", required: false, names: &["pnl"] },
    FieldSpec { field: "duration", required: false, names: &["duration"] },
    FieldSpec { field: "priceFormat", required: false, names: &["priceformat"] },
    FieldSpec { field: "priceFormatType", required: false, names: &["priceformattype"] },
    FieldSpec { field: "tickSize", required: false, names: &["ticksize"] },
];

const GENERIC_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        field: "symbol",
        required: true,
        names: &["symbol", "ticker", "instrument", "contract", "contractname", "product", "market"],
    },
    FieldSpec {
        field: "side",
        required: true,
        names: &["side", "action", "direction", "buysell", "bs", "tradeside", "longshort"],
    },
    FieldSpec {
        field: "quantity",
        required: true,
        names: &["qty", "quantity", "size", "contracts", "shares", "filledqty", "lots"],
    },
    FieldSpec {
        field: "entryTime",
        required: true,
        names: &[
            "entrytime", "entrydate", "entrydatetime", "entrytimestamp", "opentime", "opendate",
            "opendatetime", "opened", "openedat", "timeopened",
        ],
    },
    FieldSpec {
        field: "entryPrice",
        required: true,
        names: &["entryprice", "entry", "openprice", "avgentryprice", "averageentryprice", "priceopen"],
    },
    FieldSpec {
        field: "exitTime",
        required: false,
        names: &[
            "exittime", "exitdate", "exitdatetime", "exittimestamp", "closetime", "closedate",
            "closedatetime", "closed", "closedat", "timeclosed",
        ],
    },
    FieldSpec {
        field: "exitPrice",
        required: false,
        names: &["exitprice", "exit", "closeprice", "avgexitprice", "averageexitprice", "priceclose"],
    },
    FieldSpec { field: "fees", required: false, names: &["fees", "fee", "commission", "commissions", "totalfees", "comm"] },
    FieldSpec {
        field: "realizedPnl",
        required: false,
        names: &["pnl", "pl", "profitloss", "realizedpnl", "realizedpl", "grosspnl", "grosspl", "profit"],
    },
    FieldSpec { field: "brokerTradeId", required: false, names: &["tradeid", "id", "positionid", "ticket", "dealid"] },
    FieldSpec { field: "notes", required: false, names: &["notes", "note", "comment", "comments"] },
];

/// Lowercase letters and digits only: `Buy Price`, `buy_price` and
/// `buyPrice` all become `buyprice`; `P&L` becomes `pl`.
pub fn normalize_header(h: &str) -> String {
    h.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

/// Column index per normalized field name.
#[derive(Debug, Default)]
pub struct Columns(HashMap<&'static str, usize>);

impl Columns {
    pub fn get(&self, field: &str) -> Option<usize> {
        self.0.get(field).copied()
    }
}

#[derive(Debug)]
pub struct Detection {
    pub format: Format,
    pub reason: String,
    pub columns: Columns,
    pub mapping: Vec<MappedField>,
    /// Headers that feed no field (kept in the stored raw row).
    pub ignored_headers: Vec<String>,
    /// Problems that stop the import.
    pub issues: Vec<FieldIssue>,
    /// Non-blocking notes about the header row.
    pub warnings: Vec<FieldIssue>,
}

fn header_positions(headers: &[String]) -> HashMap<String, Vec<usize>> {
    let mut map: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, h) in headers.iter().enumerate() {
        let n = normalize_header(h);
        if !n.is_empty() {
            map.entry(n).or_default().push(i);
        }
    }
    map
}

fn is_performance(positions: &HashMap<String, Vec<usize>>) -> bool {
    PERFORMANCE_FIELDS
        .iter()
        .filter(|f| f.required)
        .all(|f| f.names.iter().any(|n| positions.contains_key(*n)))
}

/// The user's explicit header choice for each generic field, if any.
fn explicit_names(m: &ColumnMapping) -> HashMap<&'static str, Option<String>> {
    let pick = |s: &Option<String>| s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    HashMap::from([
        ("symbol", pick(&Some(m.symbol.clone()))),
        ("side", pick(&Some(m.side.clone()))),
        ("quantity", pick(&Some(m.quantity.clone()))),
        ("entryTime", pick(&Some(m.entry_time.clone()))),
        ("entryPrice", pick(&Some(m.entry_price.clone()))),
        ("exitTime", pick(&m.exit_time)),
        ("exitPrice", pick(&m.exit_price)),
        ("fees", pick(&m.fees)),
        ("realizedPnl", pick(&m.realized_pnl)),
        ("brokerTradeId", pick(&m.broker_trade_id)),
        ("notes", pick(&m.notes)),
    ])
}

fn list(names: &[&str]) -> String {
    names.join(", ")
}

/// Choose the format and map headers to fields. `format` is the user's
/// choice (`None` = detect); `columns` is an explicit generic mapping.
pub fn detect(headers: &[String], format: Option<Format>, columns: Option<&ColumnMapping>) -> Detection {
    let positions = header_positions(headers);
    let looks_performance = is_performance(&positions);
    let (format, reason) = match (format, columns) {
        (Some(Format::Performance), _) => (Format::Performance, "Performance export (chosen)".to_string()),
        (Some(Format::Generic), Some(_)) | (None, Some(_)) => {
            (Format::Generic, "Generic trade CSV using your column mapping".to_string())
        }
        (Some(Format::Generic), None) => (Format::Generic, "Generic trade CSV (chosen), columns matched by name".to_string()),
        (None, None) if looks_performance => (
            Format::Performance,
            "Round-trip performance export: each row pairs a buy fill with a sell fill \
             (found buyPrice, sellPrice, boughtTimestamp and soldTimestamp)"
                .to_string(),
        ),
        (None, None) => (Format::Generic, "Generic trade CSV, columns matched by name".to_string()),
    };

    let specs = match format {
        Format::Performance => PERFORMANCE_FIELDS,
        Format::Generic => GENERIC_FIELDS,
    };
    let explicit = (format == Format::Generic).then(|| columns.map(explicit_names)).flatten();

    let mut d = Detection {
        format,
        reason,
        columns: Columns::default(),
        mapping: Vec::new(),
        ignored_headers: Vec::new(),
        issues: Vec::new(),
        warnings: Vec::new(),
    };
    let mut used: Vec<usize> = Vec::new();
    for spec in specs {
        let wanted: Vec<String> = match &explicit {
            Some(map) => map.get(spec.field).cloned().flatten().map(|h| vec![normalize_header(&h)]).unwrap_or_default(),
            None => spec.names.iter().map(|n| n.to_string()).collect(),
        };
        let found = wanted.iter().find_map(|n| positions.get(n).map(|p| (n, p)));
        let header = match found {
            Some((_, idx)) if idx.len() > 1 => {
                let cols: Vec<String> = idx.iter().map(|i| (i + 1).to_string()).collect();
                d.issues.push(FieldIssue::new(
                    format!("columns.{}", spec.field),
                    format!(
                        "Header '{}' appears in more than one column ({}); rename or remove the extra column.",
                        headers[idx[0]].trim(),
                        cols.join(", ")
                    ),
                ));
                None
            }
            Some((_, idx)) => {
                d.columns.0.insert(spec.field, idx[0]);
                used.push(idx[0]);
                Some(headers[idx[0]].trim().to_string())
            }
            None => {
                if let Some(Some(h)) = explicit.as_ref().and_then(|m| m.get(spec.field)) {
                    d.issues.push(FieldIssue::new(
                        format!("columns.{}", spec.field),
                        format!("Column '{h}' is not in the file."),
                    ));
                } else if spec.required {
                    let msg = match &explicit {
                        Some(_) => "Choose the column for this required field.".to_string(),
                        None => format!("No column found (looked for: {}).", list(spec.names)),
                    };
                    d.issues.push(FieldIssue::new(format!("columns.{}", spec.field), msg));
                }
                None
            }
        };
        d.mapping.push(MappedField { field: spec.field, header, required: spec.required });
    }

    if format == Format::Generic {
        // Judge what was asked for, so a missing explicit column is not
        // mistaken for "neither mapped".
        let mapped = |f: &str| match &explicit {
            Some(map) => map.get(f).is_some_and(|h| h.is_some()),
            None => d.columns.get(f).is_some(),
        };
        if mapped("exitTime") != mapped("exitPrice") {
            d.issues.push(FieldIssue::new("columns.exitPrice", "Map exit time and exit price together, or neither."));
        }
    }
    if format == Format::Performance && !looks_performance && d.issues.is_empty() {
        d.warnings.push(FieldIssue::new("format", "Headers only partly match a performance export."));
    }

    for (i, h) in headers.iter().enumerate() {
        if used.contains(&i) {
            continue;
        }
        if h.trim().is_empty() {
            d.warnings.push(FieldIssue::new("headers", format!("Column {} has no header and is ignored.", i + 1)));
        } else if positions.get(&normalize_header(h)).is_some_and(|p| p.len() > 1 && p[0] == i) {
            d.warnings.push(FieldIssue::new("headers", format!("Header '{}' appears more than once and is ignored.", h.trim())));
            d.ignored_headers.push(h.trim().to_string());
        } else {
            d.ignored_headers.push(h.trim().to_string());
        }
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(s: &str) -> Vec<String> {
        s.split(',').map(str::to_string).collect()
    }

    #[test]
    fn detects_the_performance_export_and_maps_every_column() {
        let h = headers(
            "symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration",
        );
        let d = detect(&h, None, None);
        assert_eq!(d.format, Format::Performance);
        assert!(d.issues.is_empty() && d.warnings.is_empty() && d.ignored_headers.is_empty(), "{d:?}");
        assert!(d.mapping.iter().all(|m| m.header.is_some()), "{:?}", d.mapping);
        assert_eq!(d.columns.get("tickSize"), Some(3));
        assert_eq!(d.columns.get("soldTimestamp"), Some(11));
    }

    #[test]
    fn matches_common_broker_headers_for_generic_files() {
        let h = headers("Ticker,Action,Quantity,Open Time,Open Price,Close Time,Close Price,Commission,P&L,Trade ID,Account");
        let d = detect(&h, None, None);
        assert_eq!(d.format, Format::Generic);
        assert!(d.issues.is_empty(), "{:?}", d.issues);
        assert_eq!(d.columns.get("side"), Some(1));
        assert_eq!(d.columns.get("realizedPnl"), Some(8));
        assert_eq!(d.ignored_headers, ["Account"]);
    }

    #[test]
    fn reports_missing_and_duplicate_headers() {
        let d = detect(&headers("Symbol,Qty,Qty,Entry Time,Entry Price"), None, None);
        let fields: Vec<_> = d.issues.iter().map(|i| i.field.as_str()).collect();
        assert_eq!(fields, ["columns.side", "columns.quantity"]);
        assert!(d.issues[1].message.contains("(2, 3)"), "{}", d.issues[1].message);

        let forced = detect(&headers("Symbol,Side"), Some(Format::Performance), None);
        assert_eq!(forced.issues.len(), 5, "{:?}", forced.issues);
    }

    #[test]
    fn explicit_mapping_wins_and_is_checked() {
        let m = ColumnMapping {
            symbol: "Contract".into(),
            side: "B/S".into(),
            quantity: "Size".into(),
            entry_time: "When".into(),
            entry_price: "Px".into(),
            exit_time: Some("Exit At".into()),
            ..Default::default()
        };
        let d = detect(&headers("contract,b/s,size,when,px"), None, Some(&m));
        let fields: Vec<_> = d.issues.iter().map(|i| i.field.as_str()).collect();
        assert_eq!(fields, ["columns.exitTime", "columns.exitPrice"]);
        assert_eq!(d.columns.get("side"), Some(1));
    }
}
