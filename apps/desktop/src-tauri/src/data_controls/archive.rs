use super::{Attachment, Code, Counts, Result, fail, filesystem::*};
use crate::db;
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    path::Path,
};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

pub const FORMAT: &str = "fundedflow-journal";
pub const VERSION: u32 = 1;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveManifest {
    pub format: String,
    pub format_version: u32,
    pub schema_version: u32,
    pub producer_version: String,
    pub created_at: String,
    pub export_id: String,
    pub protection: String,
    pub entities: Counts,
    pub account_ids: Vec<String>,
    pub financial_encoding: String,
    pub time_encoding: String,
    pub attachments: Vec<Attachment>,
    pub entries: Vec<Entry>,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
    pub max_entries: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub operation_id: String,
    pub state: String,
    pub bytes: u64,
    pub sha256: String,
    pub plaintext: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Cell {
    Null,
    Integer(String),
    Real(String),
    Text(String),
    Blob(Vec<u8>),
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Table {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    pub rowids: Vec<Option<String>>,
}
pub type Data = BTreeMap<String, Table>;
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
pub fn dump(conn: &Connection) -> Result<Data> {
    let pages: i64 = conn.pragma_query_value(None, "page_count", |r| r.get(0))?;
    let page_size: i64 = conn.pragma_query_value(None, "page_size", |r| r.get(0))?;
    if pages.saturating_mul(page_size) > MAX_ENTRY as i64 {
        return Err(fail(Code::LimitExceeded));
    }
    let mut stmt = conn.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
    let tables = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut data = BTreeMap::new();
    let mut total = 0u64;
    for name in tables {
        let count: i64 =
            conn.query_row(&format!("SELECT count(*) FROM {}", quote(&name)), [], |r| {
                r.get(0)
            })?;
        total += count as u64;
        if total > 500_000 {
            return Err(fail(Code::LimitExceeded));
        }
        let without: bool = conn.query_row(
            "SELECT instr(upper(sql),'WITHOUT ROWID')>0 FROM sqlite_schema WHERE name=?1",
            [&name],
            |r| r.get(0),
        )?;
        let order = if without { "1,2" } else { "rowid" };
        let mut stmt = conn.prepare(&format!("SELECT * FROM {} ORDER BY {order}", quote(&name)))?;
        let rowids: Vec<Option<String>> = if without {
            vec![None; count as usize]
        } else {
            let mut ids = conn.prepare(&format!(
                "SELECT rowid FROM {} ORDER BY rowid",
                quote(&name)
            ))?;
            ids.query_map([], |r| Ok(Some(r.get::<_, i64>(0)?.to_string())))?
                .collect::<rusqlite::Result<_>>()?
        };
        let columns: Vec<String> = stmt.column_names().iter().map(|v| v.to_string()).collect();
        let width = columns.len();
        let mut rows = Vec::new();
        let mut query = stmt.query([])?;
        while let Some(row) = query.next()? {
            let mut values = Vec::new();
            for i in 0..width {
                values.push(match row.get_ref(i)? {
                    ValueRef::Null => Cell::Null,
                    ValueRef::Integer(v) => Cell::Integer(v.to_string()),
                    ValueRef::Real(v) => Cell::Real(v.to_string()),
                    ValueRef::Text(v) => Cell::Text(
                        std::str::from_utf8(v)
                            .map_err(|_| fail(Code::Integrity))?
                            .to_string(),
                    ),
                    ValueRef::Blob(v) => Cell::Blob(v.to_vec()),
                });
            }
            rows.push(values);
        }
        data.insert(
            name,
            Table {
                columns,
                rows,
                rowids,
            },
        );
    }
    Ok(data)
}
pub fn attachments(conn: &Connection) -> Result<Vec<Attachment>> {
    let mut s =
        conn.prepare("SELECT id,storage_key,byte_size,sha256 FROM attachments ORDER BY id")?;
    Ok(s.query_map([], |r| {
        Ok(Attachment {
            id: r.get(0)?,
            storage_key: r.get(1)?,
            byte_size: r.get::<_, i64>(2)? as u64,
            sha256: r.get(3)?,
        })
    })?
    .collect::<rusqlite::Result<_>>()?)
}
pub fn inventory(conn: &Connection, root: &Path) -> Result<Vec<Attachment>> {
    let list = attachments(conn)?;
    let mut keys = BTreeSet::new();
    for a in &list {
        relative(&a.storage_key)?;
        if !keys.insert(a.storage_key.to_lowercase()) {
            return Err(fail(Code::UnsafePath));
        }
        let path = root.join(&a.storage_key);
        no_symlink_components(&path)?;
        regular(&path)?;
        if a.byte_size > MAX_ENTRY
            || fs::metadata(&path)?.len() != a.byte_size
            || hash_file(&path)? != a.sha256
        {
            return Err(fail(Code::MissingAttachment));
        }
    }
    Ok(list)
}
pub fn snapshot(conn: &Connection, destination: &Path) -> Result<()> {
    if destination.exists() {
        return Err(fail(Code::UnsafePath));
    }
    let mut target = Connection::open(destination)?;
    let backup = rusqlite::backup::Backup::new(conn, &mut target)?;
    if backup.step(-1)? != rusqlite::backup::StepResult::Done {
        return Err(fail(Code::Busy));
    }
    drop(backup);
    target.pragma_update(None, "journal_mode", "DELETE")?;
    drop(target);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(destination, fs::Permissions::from_mode(0o600))?;
    }
    File::open(destination)?.sync_all()?;
    if fs::metadata(destination)?.len() > MAX_ENTRY {
        return Err(fail(Code::LimitExceeded));
    }
    Ok(())
}
pub fn readonly(path: &Path) -> Result<Connection> {
    let c = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    c.pragma_update(None, "trusted_schema", false)?;
    Ok(c)
}
pub fn account_ids(c: &Connection) -> Result<Vec<String>> {
    let mut s = c.prepare("SELECT id FROM accounts ORDER BY id")?;
    Ok(s.query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}
pub fn export(
    conn: &Connection,
    root: &Path,
    destination: &Path,
    plaintext_ack: bool,
) -> Result<ExportResult> {
    if !plaintext_ack {
        return Err(fail(Code::ConfirmationRequired));
    }
    no_symlink_components(destination)?;
    let parent = destination
        .parent()
        .filter(|p| p.is_dir())
        .ok_or_else(|| fail(Code::UnsafePath))?;
    space(parent, MAX_TOTAL * 2)?;
    let temp = tempfile::tempdir_in(parent)?;
    let image = temp.path().join("journal.sqlite");
    snapshot(conn, &image)?;
    let c = readonly(&image)?;
    let schema: u32 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if !(3..=db::latest_version()).contains(&schema) {
        return Err(fail(Code::UnsupportedVersion));
    }
    let data = dump(&c)?;
    let bytes = serde_json::to_vec(&data)?;
    if bytes.len() as u64 > MAX_ENTRY {
        return Err(fail(Code::LimitExceeded));
    }
    let data_path = temp.path().join("data.json");
    write_new(&data_path, &bytes)?;
    let csv_path = temp.path().join("trades.csv");
    export_csv(&c, &csv_path, None, true)?;
    let attached = inventory(&c, root)?;
    let mut files = vec![
        ("journal.sqlite".to_string(), image),
        ("data.json".to_string(), data_path),
        ("trades.csv".to_string(), csv_path),
    ];
    for a in &attached {
        files.push((
            format!("attachments/{}", a.storage_key),
            root.join(&a.storage_key),
        ));
    }
    if files.len() + 1 > MAX_ENTRIES {
        return Err(fail(Code::LimitExceeded));
    }
    let entries = files
        .iter()
        .map(|(name, p)| {
            Ok(Entry {
                path: name.clone(),
                bytes: fs::metadata(p)?.len(),
                sha256: hash_file(p)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if entries.iter().map(|e| e.bytes).sum::<u64>() > MAX_TOTAL {
        return Err(fail(Code::LimitExceeded));
    }
    let manifest = ArchiveManifest {
        format: FORMAT.into(),
        format_version: VERSION,
        schema_version: schema,
        producer_version: env!("CARGO_PKG_VERSION").into(),
        created_at: crate::domain::now(),
        export_id: crate::domain::new_id(),
        protection: "plaintext".into(),
        entities: data
            .iter()
            .map(|(k, v)| (k.clone(), v.rows.len() as u64))
            .collect(),
        account_ids: account_ids(&c)?,
        financial_encoding: "sqlite-i64-micros-and-exact-decimal-text;JSON-integers-as-text".into(),
        time_encoding: "stored-UTC-instants;account-IANA-zone-and-reset;stored-trading-day".into(),
        attachments: attached,
        entries,
        max_entry_bytes: MAX_ENTRY,
        max_total_bytes: MAX_TOTAL,
        max_entries: MAX_ENTRIES,
    };
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut zip = ZipWriter::new(output.as_file_mut());
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .unix_permissions(0o600);
        zip.start_file("manifest.json", options)?;
        zip.write_all(&serde_json::to_vec(&manifest)?)?;
        for (name, path) in &files {
            zip.start_file(name, options)?;
            std::io::copy(&mut File::open(path)?, &mut zip)?;
        }
        zip.finish()?;
    }
    // Re-inspect the emitted archive, including files which could have changed during copying.
    let validated = inspect_to(output.path(), temp.path())?;
    if validated.manifest != manifest {
        return Err(fail(Code::Integrity));
    }
    let result = ExportResult {
        operation_id: manifest.export_id,
        state: "completed".into(),
        bytes: output.as_file().metadata()?.len(),
        sha256: hash_file(output.path())?,
        plaintext: true,
    };
    publish(output, destination)?;
    Ok(result)
}
pub struct Inspected {
    pub source_hash: String,
    pub manifest: ArchiveManifest,
    pub directory: tempfile::TempDir,
}
pub fn inspect_to(source: &Path, workspace: &Path) -> Result<Inspected> {
    regular(source)?;
    no_symlink_components(source)?;
    let source_hash = hash_file(source)?;
    let mut input = File::open(source)?;
    let mut magic = [0u8; 4];
    input
        .read_exact(&mut magic)
        .map_err(|_| fail(Code::InvalidArchive))?;
    if magic != *b"PK\x03\x04" {
        return Err(fail(Code::InvalidArchive));
    }
    use std::io::Seek;
    input.rewind()?;
    if input.metadata()?.len() > MAX_TOTAL + 2 * 1024 * 1024 {
        return Err(fail(Code::LimitExceeded));
    }
    let mut zip = ZipArchive::new(input)?;
    if zip.len() > MAX_ENTRIES || zip.len() < 4 {
        return Err(fail(Code::LimitExceeded));
    }
    let dir = tempfile::tempdir_in(workspace)?;
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        relative(&name)?;
        if !names.insert(name.to_lowercase())
            || entry.is_dir()
            || entry.is_symlink()
            || entry
                .unix_mode()
                .is_some_and(|m| m & 0o170000 != 0 && m & 0o170000 != 0o100000)
            || entry.compression() != zip::CompressionMethod::Stored
            || entry.encrypted()
            || entry.extra_data().is_some_and(|bytes| !bytes.is_empty())
        {
            return Err(fail(Code::UnsafePath));
        }
        let limit = if name == "manifest.json" {
            1024 * 1024
        } else {
            MAX_ENTRY
        };
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| fail(Code::LimitExceeded))?;
        if entry.size() > limit || total > MAX_TOTAL {
            return Err(fail(Code::LimitExceeded));
        }
        // Never extract symlink/link metadata. Only explicit fresh regular files are written.
        let mut bytes = Vec::new();
        (&mut entry).take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 != entry.size() {
            return Err(fail(Code::InvalidArchive));
        }
        write_new(&dir.path().join(&name), &bytes)?;
    }
    let manifest: ArchiveManifest =
        serde_json::from_slice(&fs::read(dir.path().join("manifest.json"))?)?;
    if manifest.format != FORMAT
        || manifest.format_version != VERSION
        || !(3..=db::latest_version()).contains(&manifest.schema_version)
        || manifest.protection != "plaintext"
        || manifest.max_entry_bytes != MAX_ENTRY
        || manifest.max_total_bytes != MAX_TOTAL
        || manifest.max_entries != MAX_ENTRIES
    {
        return Err(fail(Code::UnsupportedVersion));
    }
    let mut expected = BTreeSet::from(["manifest.json".into()]);
    for e in &manifest.entries {
        relative(&e.path)?;
        if !expected.insert(e.path.to_lowercase()) {
            return Err(fail(Code::Integrity));
        }
        let path = dir.path().join(&e.path);
        if fs::metadata(&path)
            .map_err(|_| fail(Code::Integrity))?
            .len()
            != e.bytes
            || hash_file(&path)? != e.sha256
        {
            return Err(fail(Code::Integrity));
        }
    }
    if expected != names {
        return Err(fail(Code::Integrity));
    }
    validate_database(&dir.path().join("journal.sqlite"), manifest.schema_version)?;
    let c = readonly(&dir.path().join("journal.sqlite"))?;
    let data = dump(&c)?;
    let portable: Data = serde_json::from_slice(&fs::read(dir.path().join("data.json"))?)?;
    if data != portable
        || manifest.entities
            != data
                .iter()
                .map(|(k, v)| (k.clone(), v.rows.len() as u64))
                .collect()
        || manifest.account_ids != account_ids(&c)?
        || manifest.attachments != inventory(&c, &dir.path().join("attachments"))?
    {
        return Err(fail(Code::Integrity));
    }
    let expected_payload: BTreeSet<String> = [
        "journal.sqlite".into(),
        "data.json".into(),
        "trades.csv".into(),
    ]
    .into_iter()
    .chain(
        manifest
            .attachments
            .iter()
            .map(|a| format!("attachments/{}", a.storage_key)),
    )
    .collect();
    let comparison = dir.path().join("csv-comparison");
    fs::create_dir(&comparison)?;
    let csv = export_csv(&c, &comparison.join("trades.csv"), None, true)?;
    if hash_file(&dir.path().join("trades.csv"))? != csv.sha256 {
        return Err(fail(Code::Integrity));
    }
    if expected_payload != manifest.entries.iter().map(|e| e.path.clone()).collect() {
        return Err(fail(Code::Integrity));
    }
    if hash_file(source)? != source_hash {
        return Err(fail(Code::StalePreview));
    }
    Ok(Inspected {
        source_hash,
        manifest,
        directory: dir,
    })
}
fn schema(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut s = conn.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name")?;
    Ok(s.query_map([], |r| {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get::<_, String>(2)?.replace("\r\n", "\n"),
        ))
    })?
    .collect::<rusqlite::Result<_>>()?)
}
pub fn validate_database(path: &Path, version: u32) -> Result<()> {
    let c = readonly(path)?;
    let actual: u32 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if actual != version {
        return Err(fail(Code::Integrity));
    }
    let mut reference = Connection::open_in_memory()?;
    db::migrate_with(&mut reference, &db::MIGRATIONS[..version as usize])
        .map_err(|_| fail(Code::Database))?;
    if schema(&c)? != schema(&reference)? {
        return Err(fail(Code::Integrity));
    }
    let integrity: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" || c.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(fail(Code::Integrity));
    }
    if version >= 9 {
        for sql in [
            "SELECT 1 FROM account_rulebook_assignments a JOIN rulebook_versions v ON v.id=a.rulebook_version_id JOIN rulebooks b ON b.id=v.rulebook_id WHERE b.owner_account_id IS NOT NULL AND b.owner_account_id<>a.account_id LIMIT 1",
            "SELECT 1 FROM account_rulebook_assignments a JOIN account_phase_events e ON e.id=a.account_phase_event_id WHERE a.account_id<>e.account_id LIMIT 1",
        ] {
            if c.prepare(sql)?.exists([])? {
                return Err(fail(Code::Integrity));
            }
        }
    }
    if version >= 14 {
        for sql in [
            "SELECT 1 FROM financial_observations WHERE json_extract(payload_json,'$.id') IS NOT id OR json_extract(payload_json,'$.accountId') IS NOT account_id OR json_extract(payload_json,'$.supersedesId') IS NOT supersedes_id LIMIT 1",
            "SELECT 1 FROM financial_observations a JOIN financial_observations b ON b.id=a.supersedes_id WHERE a.account_id<>b.account_id LIMIT 1",
            "SELECT 1 FROM ledger_revisions r JOIN account_ledger_entries e ON e.id=r.entry_id WHERE r.account_id<>e.account_id OR json_extract(r.entry_json,'$.id') IS NOT r.entry_id OR json_extract(r.entry_json,'$.accountId') IS NOT r.account_id LIMIT 1",
            "SELECT 1 FROM ledger_revisions a JOIN ledger_revisions b ON b.id=a.supersedes_id WHERE a.account_id<>b.account_id OR a.entry_id<>b.entry_id LIMIT 1",
            "SELECT 1 FROM financial_reconciliations WHERE json_extract(payload_json,'$.id') IS NOT id OR json_extract(payload_json,'$.accountId') IS NOT account_id OR json_extract(payload_json,'$.request.accountId') IS NOT account_id OR json_extract(payload_json,'$.observation.accountId') IS NOT account_id OR json_extract(payload_json,'$.baseline.accountId') IS NOT account_id LIMIT 1",
            "SELECT 1 FROM reconciliation_resolutions WHERE json_extract(payload_json,'$.id') IS NOT id OR json_extract(payload_json,'$.reconciliationId') IS NOT reconciliation_id LIMIT 1",
        ] {
            if c.prepare(sql)?.exists([])? {
                return Err(fail(Code::Integrity));
            }
        }
    }
    // Cross-account provenance which FK checks alone cannot establish.
    for sql in [
        "SELECT 1 FROM trades t JOIN import_batches b ON b.id=t.import_batch_id WHERE t.account_id<>b.account_id LIMIT 1",
        "SELECT 1 FROM trades t JOIN import_rows r ON r.id=t.import_row_id WHERE t.import_batch_id IS NOT r.batch_id LIMIT 1",
        "SELECT 1 FROM journal_entries j JOIN trades t ON t.id=j.trade_id WHERE j.account_id<>t.account_id LIMIT 1",
    ] {
        if c.prepare(sql)?.exists([])? {
            return Err(fail(Code::Integrity));
        }
    }
    Ok(())
}
pub fn export_csv(
    conn: &Connection,
    destination: &Path,
    account_id: Option<&str>,
    plaintext_ack: bool,
) -> Result<ExportResult> {
    if !plaintext_ack {
        return Err(fail(Code::ConfirmationRequired));
    }
    no_symlink_components(destination)?;
    let parent = destination
        .parent()
        .filter(|p| p.is_dir())
        .ok_or_else(|| fail(Code::UnsafePath))?;
    space(parent, MAX_ENTRY)?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    let mut writer = csv::Writer::from_writer(output.as_file_mut());
    writer
        .write_record([
            "account_id",
            "trade_id",
            "symbol",
            "side",
            "quantity",
            "entry_at_utc",
            "exit_at_utc",
            "trading_day",
            "entry_price",
            "exit_price",
            "fees",
            "net_pnl",
            "pnl_status",
            "source",
            "import_batch_id",
            "import_row_id",
            "notes",
            "deleted_at_utc",
            "account_currency",
            "account_name",
            "account_timezone",
        ])
        .map_err(|_| fail(Code::Io))?;
    let mut s = conn.prepare("SELECT t.account_id,t.id,t.symbol,t.side,t.quantity,t.entry_at,t.exit_at,t.trading_day,t.entry_price,t.exit_price,t.fees_micros,t.net_pnl_micros,t.pnl_status,t.source,t.import_batch_id,t.import_row_id,t.notes_md,t.deleted_at,a.currency,a.name,a.timezone FROM trades t JOIN accounts a ON a.id=t.account_id WHERE (?1 IS NULL OR t.account_id=?1) ORDER BY t.account_id,t.entry_at,t.id")?;
    let mut rows = s.query([account_id])?;
    while let Some(row) = rows.next()? {
        let mut cells = Vec::new();
        for i in 0..21 {
            let value = if i == 10 || i == 11 {
                row.get::<_, Option<i64>>(i)?
                    .map(crate::domain::micros_to_string)
            } else {
                row.get::<_, Option<String>>(i)?
            };
            // CSV is for humans; protect spreadsheet formulas. Portable JSON/SQLite remain lossless.
            let v = value.unwrap_or_default();
            cells.push(
                if v.trim_start().starts_with(['=', '+', '-', '@', '\t', '\r'])
                    && i != 10
                    && i != 11
                {
                    format!("'{v}")
                } else {
                    v
                },
            );
        }
        writer.write_record(cells).map_err(|_| fail(Code::Io))?;
        if writer.get_ref().metadata()?.len() > MAX_ENTRY {
            return Err(fail(Code::LimitExceeded));
        }
    }
    writer.flush()?;
    drop(writer);
    let result = ExportResult {
        operation_id: crate::domain::new_id(),
        state: "completed".into(),
        bytes: output.as_file().metadata()?.len(),
        sha256: hash_file(output.path())?,
        plaintext: true,
    };
    publish(output, destination)?;
    Ok(result)
}
