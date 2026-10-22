//! First-run acceptance of the bundled privacy notice and user agreement (NA-3).
//!
//! The record belongs to this install, not to a journal: it is a small JSON file in Tauri's app config
//! directory (`%APPDATA%\com.fundedflow.desktop\legal-acceptance.json` on Windows), next to but separate
//! from `fundedflow.db`. Export, restore and erase never read or write it, and reading it never touches the
//! journal, so the first-run screen works while the journal is still opening or has failed to open.
//!
//! The documents themselves are bundled with the frontend (`src/legal`); this module only stores which
//! versions and digests were accepted, and when. A missing, unreadable or malformed record reads as "not
//! accepted" (the screen is shown again), never as an error.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::domain;
use crate::error::{AppError, AppResult};

pub const ACCEPTANCE_FILE_NAME: &str = "legal-acceptance.json";
const MAX_DOCUMENTS: usize = 8;
const MAX_FILE_BYTES: u64 = 16 * 1024;

/// One accepted document: which text, by id, version and SHA-256 digest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedDocument {
    pub id: String,
    pub version: String,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegalAcceptance {
    pub documents: Vec<AcceptedDocument>,
    /// Set here when the record is written, never taken from the caller.
    pub accepted_at: String,
}

/// Where the record lives; an error when the app config directory couldn't be resolved.
pub struct LegalStore {
    path: Result<PathBuf, String>,
}

impl LegalStore {
    pub fn new(dir: Result<PathBuf, String>) -> Self {
        Self { path: dir.map(|dir| dir.join(ACCEPTANCE_FILE_NAME)) }
    }
}

fn token_ok(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'+'))
}

fn validate(documents: &[AcceptedDocument]) -> AppResult<()> {
    if documents.is_empty() || documents.len() > MAX_DOCUMENTS {
        return Err(AppError::invalid("documents", format!("between 1 and {MAX_DOCUMENTS} documents are required")));
    }
    for (index, doc) in documents.iter().enumerate() {
        if !token_ok(&doc.id) {
            return Err(AppError::invalid(&format!("documents[{index}].id"), "must be a short identifier"));
        }
        if !token_ok(&doc.version) {
            return Err(AppError::invalid(&format!("documents[{index}].version"), "must be a short version"));
        }
        if doc.digest.len() != 64 || !doc.digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err(AppError::invalid(&format!("documents[{index}].digest"), "must be a lowercase SHA-256 hex digest"));
        }
        if documents[..index].iter().any(|other| other.id == doc.id) {
            return Err(AppError::invalid(&format!("documents[{index}].id"), "is listed twice"));
        }
    }
    Ok(())
}

/// The stored record, or `None` when there is none or it can't be trusted (unreadable, too large,
/// malformed, or failing validation).
pub fn read(path: &Path) -> Option<LegalAcceptance> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return None;
    }
    let record: LegalAcceptance = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    validate(&record.documents).ok()?;
    chrono::DateTime::parse_from_rfc3339(&record.accepted_at).ok()?;
    Some(record)
}

/// Replaces the record atomically (a temporary file in the same directory, flushed, then renamed).
pub fn write(path: &Path, documents: Vec<AcceptedDocument>, accepted_at: String) -> AppResult<LegalAcceptance> {
    validate(&documents)?;
    let record = LegalAcceptance { documents, accepted_at };
    let unavailable = |e: std::io::Error| AppError::Unavailable { message: format!("the acceptance record could not be saved: {e}") };
    let dir = path.parent().ok_or_else(|| AppError::Unavailable { message: "the app config folder is unknown".into() })?;
    fs::create_dir_all(dir).map_err(unavailable)?;
    let mut file = tempfile::NamedTempFile::new_in(dir).map_err(unavailable)?;
    let bytes = serde_json::to_vec_pretty(&record).map_err(|e| AppError::Unavailable { message: e.to_string() })?;
    file.write_all(&bytes).map_err(unavailable)?;
    file.as_file().sync_all().map_err(unavailable)?;
    file.persist(path).map_err(|e| unavailable(e.error))?;
    Ok(record)
}

/// Read-only: the stored acceptance, or `null` when the first-run screen should be shown.
#[tauri::command]
pub fn get_legal_acceptance(store: State<'_, LegalStore>) -> Option<LegalAcceptance> {
    store.path.as_ref().ok().and_then(|path| read(path))
}

/// Records that the user accepted these document versions now.
#[tauri::command]
pub fn record_legal_acceptance(store: State<'_, LegalStore>, documents: Vec<AcceptedDocument>) -> AppResult<LegalAcceptance> {
    let path = store.path.as_ref().map_err(|e| AppError::Unavailable { message: e.clone() })?;
    write(path, documents, domain::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(id: &str) -> AcceptedDocument {
        AcceptedDocument { id: id.into(), version: "0.1.0-draft".into(), digest: "ab".repeat(32) }
    }
    const AT: &str = "2026-10-21T18:00:00.000Z";

    #[test]
    fn missing_record_reads_as_not_accepted() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(&dir.path().join(ACCEPTANCE_FILE_NAME)), None);
    }

    #[test]
    fn write_then_read_round_trips_and_creates_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config").join(ACCEPTANCE_FILE_NAME);
        let written = write(&path, vec![doc("privacy-notice"), doc("user-agreement")], AT.into()).unwrap();
        assert_eq!(read(&path), Some(written.clone()));
        assert_eq!(written.accepted_at, AT);
        // Accepting again replaces the record rather than appending to it.
        let mut newer = doc("privacy-notice");
        newer.version = "0.2.0".into();
        write(&path, vec![newer.clone()], "2026-10-22T09:00:00.000Z".into()).unwrap();
        assert_eq!(read(&path).unwrap().documents, vec![newer]);
        let leftovers: Vec<_> = fs::read_dir(path.parent().unwrap()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temporary files remain");
    }

    #[test]
    fn corrupt_or_tampered_records_read_as_not_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(ACCEPTANCE_FILE_NAME);
        let bad: &[&[u8]] = &[
            b"",
            b"not json",
            b"{\"documents\":[],\"acceptedAt\":\"2026-10-21T18:00:00.000Z\"}",
            b"{\"documents\":[{\"id\":\"p\",\"version\":\"1\",\"digest\":\"xyz\"}],\"acceptedAt\":\"2026-10-21T18:00:00.000Z\"}",
            b"{\"documents\":[{\"id\":\"p\",\"version\":\"1\",\"digest\":\"abababababababababababababababababababababababababababababababab\"}],\"acceptedAt\":\"yesterday\"}",
            b"{\"documents\":[{\"id\":\"p\",\"version\":\"1\",\"digest\":\"abababababababababababababababababababababababababababababababab\"}],\"acceptedAt\":\"2026-10-21T18:00:00.000Z\",\"extra\":1}",
            &[0xff, 0xfe, 0x00],
        ];
        for content in bad {
            fs::write(&path, content).unwrap();
            assert_eq!(read(&path), None, "{:?}", String::from_utf8_lossy(content));
        }
        fs::write(&path, vec![b' '; MAX_FILE_BYTES as usize + 1]).unwrap();
        assert_eq!(read(&path), None, "oversized file");
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(read(&path), None, "a folder in its place");
    }

    #[test]
    fn invalid_documents_are_refused_and_nothing_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(ACCEPTANCE_FILE_NAME);
        let mut upper = doc("privacy-notice");
        upper.digest = "AB".repeat(32);
        let cases = vec![
            vec![],
            vec![doc("")],
            vec![doc("privacy notice")],
            vec![upper],
            vec![doc("privacy-notice"), doc("privacy-notice")],
            (0..=MAX_DOCUMENTS).map(|i| doc(&format!("doc-{i}"))).collect(),
        ];
        for documents in cases {
            assert!(matches!(write(&path, documents, AT.into()), Err(AppError::Validation { .. })));
        }
        assert!(!path.exists());
    }

    #[test]
    fn an_unresolved_config_folder_reads_as_not_accepted_and_refuses_writes() {
        let store = LegalStore::new(Err("no app config dir".into()));
        assert!(store.path.as_ref().ok().and_then(|p| read(p)).is_none());
        assert!(store.path.is_err());
    }
}
