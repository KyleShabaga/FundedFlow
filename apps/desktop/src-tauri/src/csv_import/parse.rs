//! Reading CSV text into a header row and raw records. RFC 4180 quoting
//! (embedded commas, quotes and newlines), CRLF or LF line endings and a
//! leading UTF-8 BOM are handled by the `csv` crate; this layer adds limits
//! and per-record line numbers.

use crate::error::FieldIssue;

pub const MAX_CSV_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_CSV_ROWS: usize = 50_000;

pub struct RawRow {
    /// 1 = first record after the header.
    pub row_number: u32,
    /// Line in the file where the record starts (the header is line 1).
    pub line_number: u64,
    pub cells: Vec<String>,
    /// Set when the record could not be read at all.
    pub read_error: Option<String>,
}

impl RawRow {
    pub fn is_blank(&self) -> bool {
        self.read_error.is_none() && self.cells.iter().all(|c| c.trim().is_empty())
    }
}

#[derive(Default)]
pub struct ParsedCsv {
    pub headers: Vec<String>,
    pub rows: Vec<RawRow>,
    /// Problems that make the whole file unusable.
    pub issues: Vec<FieldIssue>,
}

pub fn parse(content: &str) -> ParsedCsv {
    let mut out = ParsedCsv::default();
    if content.len() > MAX_CSV_BYTES {
        out.issues.push(FieldIssue::new(
            "content",
            format!("The file is larger than {} MB.", MAX_CSV_BYTES / 1024 / 1024),
        ));
        return out;
    }
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    if text.trim().is_empty() {
        out.issues.push(FieldIssue::new("content", "The file is empty."));
        return out;
    }

    let mut reader = csv::ReaderBuilder::new().has_headers(true).flexible(true).from_reader(text.as_bytes());
    match reader.headers() {
        Ok(h) if h.iter().any(|c| !c.trim().is_empty()) => out.headers = h.iter().map(str::to_string).collect(),
        Ok(_) => {
            out.issues.push(FieldIssue::new("content", "The first line must be a header row with column names."));
            return out;
        }
        Err(e) => {
            out.issues.push(FieldIssue::new("content", format!("The header row cannot be read: {e}")));
            return out;
        }
    }

    // Line numbers come from byte offsets: the reader's own line counter is
    // off by one for CRLF files.
    let bytes = text.as_bytes();
    let mut counted = (0usize, 1u64);
    let mut line_at = |pos: Option<&csv::Position>| -> u64 {
        let Some(mut offset) = pos.map(|p| p.byte() as usize) else { return 0 };
        // After a CRLF (or skipped empty lines) the reported start can be a
        // line break; a record itself never starts with one.
        while matches!(bytes.get(offset), Some(b'\n' | b'\r')) {
            offset += 1;
        }
        let (from, line) = counted;
        let end = offset.min(bytes.len()).max(from);
        let line = line + bytes[from..end].iter().filter(|b| **b == b'\n').count() as u64;
        counted = (end, line);
        line
    };
    for (i, record) in reader.records().enumerate() {
        if i >= MAX_CSV_ROWS {
            out.issues.push(FieldIssue::new(
                "content",
                format!("The file has more than {MAX_CSV_ROWS} data rows; split it into smaller files."),
            ));
            break;
        }
        let row_number = i as u32 + 1;
        out.rows.push(match record {
            Ok(r) => RawRow {
                row_number,
                line_number: line_at(r.position()),
                cells: r.iter().map(str::to_string).collect(),
                read_error: None,
            },
            Err(e) => RawRow {
                row_number,
                line_number: line_at(e.position()),
                cells: Vec::new(),
                read_error: Some(format!("unreadable record: {e}")),
            },
        });
    }
    if out.rows.is_empty() && out.issues.is_empty() {
        out.issues.push(FieldIssue::new("content", "The file has a header row but no data rows."));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_quotes_line_endings_and_bom() {
        let csv = "\u{feff}a,b,c\r\n\"x, y\",\"say \"\"hi\"\"\",\"multi\nline\"\r\n1,2,3\n";
        let p = parse(csv);
        assert!(p.issues.is_empty());
        assert_eq!(p.headers, ["a", "b", "c"]);
        assert_eq!(p.rows[0].cells, ["x, y", "say \"hi\"", "multi\nline"]);
        assert_eq!((p.rows[0].line_number, p.rows[1].line_number), (2, 4));
        assert_eq!(p.rows[1].cells, ["1", "2", "3"]);
    }

    #[test]
    fn reports_empty_and_header_only_files() {
        for (csv, expect) in [("", "empty"), ("\u{feff}\r\n", "empty"), (",,\n1,2,3\n", "header row"), ("a,b\n", "no data rows")] {
            let p = parse(csv);
            assert!(p.issues[0].message.contains(expect), "{csv:?}: {:?}", p.issues);
        }
    }

    #[test]
    fn blank_and_ragged_rows_are_kept_for_reporting() {
        let p = parse("a,b\n,\n1\n1,2,3\n");
        assert!(p.rows[0].is_blank());
        assert_eq!(p.rows[1].cells.len(), 1);
        assert_eq!(p.rows[2].cells.len(), 3);
    }
}
