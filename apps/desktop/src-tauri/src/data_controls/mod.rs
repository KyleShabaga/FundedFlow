//! Offline data controls. No content or caller-selected paths are logged.
mod archive;
mod deletion;
pub use deletion::{DeleteRequest, DeleteResult, DeletionPreview, PreviewRequest};
pub use deletion::{execute as delete_data, preview as preview_deletion, recover_cleanup};
mod filesystem;
mod restore;
pub use restore::{InspectRequest, RestorePreview, RestoreRequest, RestoreResult};
pub use restore::{inspect as inspect_restore, prepare as prepare_restore, recover};
#[cfg(test)]
mod security_tests;
#[cfg(test)]
mod tests;

pub use archive::ExportResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    InvalidArchive,
    UnsupportedVersion,
    Integrity,
    UnsafePath,
    LimitExceeded,
    MissingAttachment,
    InsufficientSpace,
    Io,
    Database,
    ConfirmationRequired,
    StalePreview,
    LinkedAttempts,
    UnsupportedOwnership,
    Busy,
    RecoveryRequired,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlError {
    pub code: Code,
    pub message: String,
    /// Which limit was exceeded and the measured value. Never a path or row content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
pub type Result<T> = std::result::Result<T, ControlError>;
pub(crate) fn fail(code: Code) -> ControlError {
    let message = match code {
        Code::InvalidArchive => "The archive is malformed or incomplete.",
        Code::UnsupportedVersion => "This archive or journal version is not supported by this app.",
        Code::Integrity => "Journal data, references or checksums do not agree.",
        Code::UnsafePath => "A file path is unsafe or aliases another file.",
        Code::LimitExceeded => "The operation exceeds the supported data limits.",
        Code::MissingAttachment => {
            "Required attachment bytes are missing or do not match their inventory."
        }
        Code::InsufficientSpace => "There is insufficient free disk space for a safe operation.",
        Code::Io => {
            "A local file operation failed. Existing saved data was not intentionally removed."
        }
        Code::Database => "A database operation failed.",
        Code::ConfirmationRequired => {
            "Explicit confirmation of the preview and operation is required."
        }
        Code::StalePreview => "Data changed after the preview. Inspect again before confirming.",
        Code::LinkedAttempts => {
            "This account is linked to another attempt. Permanent deletion is blocked."
        }
        Code::UnsupportedOwnership => {
            "Related data has ambiguous ownership. Permanent deletion is blocked."
        }
        Code::Busy => "Another FundedFlow process owns this journal.",
        Code::RecoveryRequired => {
            "A recovery operation must finish before journal access can resume."
        }
    };
    ControlError {
        code,
        message: message.into(),
        detail: None,
    }
}
/// `LimitExceeded` naming the component over its limit, for example `database pages: 70254592 bytes, limit 67108864 bytes`.
pub(crate) fn over_limit(component: &str, measured: u64, limit: u64, unit: &str) -> ControlError {
    let unit = if unit.is_empty() { String::new() } else { format!(" {unit}") };
    ControlError {
        detail: Some(format!("{component}: {measured}{unit}, limit {limit}{unit}")),
        ..fail(Code::LimitExceeded)
    }
}
impl From<std::io::Error> for ControlError {
    fn from(_: std::io::Error) -> Self {
        fail(Code::Io)
    }
}
impl From<rusqlite::Error> for ControlError {
    fn from(_: rusqlite::Error) -> Self {
        fail(Code::Database)
    }
}
impl From<serde_json::Error> for ControlError {
    fn from(_: serde_json::Error) -> Self {
        fail(Code::InvalidArchive)
    }
}
impl From<zip::result::ZipError> for ControlError {
    fn from(_: zip::result::ZipError) -> Self {
        fail(Code::InvalidArchive)
    }
}

pub type Counts = BTreeMap<String, u64>;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    pub id: String,
    pub storage_key: String,
    pub byte_size: u64,
    pub sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    pub destination: String,
    pub acknowledge_plaintext: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvExportRequest {
    pub destination: String,
    #[serde(deserialize_with = "explicit_nullable")]
    pub account_id: Option<String>,
    pub acknowledge_plaintext: bool,
}
pub fn export_journal(
    c: &rusqlite::Connection,
    root: &std::path::Path,
    request: ExportRequest,
) -> Result<ExportResult> {
    archive::export(
        c,
        &root.join("attachments"),
        std::path::Path::new(&request.destination),
        request.acknowledge_plaintext,
    )
}
pub fn export_trades(c: &rusqlite::Connection, request: CsvExportRequest) -> Result<ExportResult> {
    if let Some(id) = &request.account_id
        && !c.query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1)",
            [id],
            |r| r.get::<_, bool>(0),
        )?
    {
        return Err(fail(Code::Integrity));
    }
    archive::export_csv(
        c,
        std::path::Path::new(&request.destination),
        request.account_id.as_deref(),
        request.acknowledge_plaintext,
    )
}

/// Cross-process ownership is held by Runtime for its lifetime, including recovery.
pub fn filesystem_ownership(root: &std::path::Path) -> Result<std::fs::File> {
    filesystem::no_symlink_components(root)?;
    let path = root.join("fundedflow.lock");
    filesystem::no_symlink_components(&path)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)?;
    fs2::FileExt::try_lock_exclusive(&file).map_err(|_| fail(Code::Busy))?;
    Ok(file)
}
#[cfg(test)]
mod wire_tests;

fn explicit_nullable<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[cfg(test)]
mod current_schema_tests;
