//! Replace-only restart installation. Durable intent precedes mutation; incomplete installs roll back.
use super::{Code, Result, archive, fail, filesystem::*};
use crate::db;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
const PENDING: &str = "data-controls-pending.json";
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectRequest {
    pub source: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub state: String,
    pub manifest: archive::ArchiveManifest,
    pub archive_sha256: String,
    pub preview_token: String,
    pub replaced_entities: super::Counts,
    pub required_confirmation: String,
    pub required_free_bytes: u64,
    pub warnings: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreRequest {
    pub source: String,
    pub preview_token: String,
    pub confirmation: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub operation_id: String,
    pub state: String,
    pub safety_backup_id: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    operation_id: String,
    phase: String,
}
fn operation(root: &Path, id: &str) -> Result<PathBuf> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(fail(Code::UnsafePath));
    }
    let path = root.join("data-controls").join(id);
    no_symlink_components(&path)?;
    Ok(path)
}
fn content_hash(c: &Connection) -> Result<String> {
    Ok(digest(&serde_json::to_vec(&archive::dump(c)?)?))
}
fn token(archive_hash: &str, current_hash: &str) -> String {
    digest(format!("restore-v1\0replace\0{archive_hash}\0{current_hash}").as_bytes())
}
fn counts(c: &Connection) -> Result<super::Counts> {
    Ok(archive::dump(c)?
        .iter()
        .map(|(k, v)| (k.clone(), v.rows.len() as u64))
        .collect())
}
pub fn inspect(c: &Connection, root: &Path, request: InspectRequest) -> Result<RestorePreview> {
    no_symlink_components(root)?;
    space(root, MAX_TOTAL * 4)?;
    let stage = archive::inspect_to(Path::new(&request.source), &workspace(root)?)?;
    // Also prove that all required upgrades can run without touching active data.
    let mut candidate = db::open_file(&stage.directory.path().join("journal.sqlite"))
        .map_err(|_| fail(Code::Integrity))?;
    db::migrate(&mut candidate).map_err(|_| fail(Code::Integrity))?;
    let archive_sha256 = stage.source_hash.clone();
    let preview_token = token(&archive_sha256, &content_hash(c)?);
    Ok(RestorePreview { state: "validated".into(), manifest: stage.manifest,
        archive_sha256, preview_token, replaced_entities: counts(c)?, required_confirmation: "REPLACE ENTIRE JOURNAL".into(),
        required_free_bytes: MAX_TOTAL * 4 + 16 * 1024 * 1024,
        warnings: vec!["Plaintext archive; hashes are integrity checks, not authentication.".into(),
            "Replaces the entire journal and app-managed attachments after exclusive restart; never merges.".into(),
            "External backups remain untouched. A local pre-restore safety copy remains until explicitly removed.".into()] })
}
/// Must be called with the runtime lock, followed by closing the connection before any further writes.
pub fn prepare(c: &Connection, root: &Path, request: RestoreRequest) -> Result<RestoreResult> {
    if request.confirmation != "REPLACE ENTIRE JOURNAL" {
        return Err(fail(Code::ConfirmationRequired));
    }
    if root.join(PENDING).exists() {
        return Err(fail(Code::RecoveryRequired));
    }
    let preview = inspect(
        c,
        root,
        InspectRequest {
            source: request.source.clone(),
        },
    )?;
    if preview.preview_token != request.preview_token {
        return Err(fail(Code::StalePreview));
    }
    // Reopen the input only into controlled staging, then verify the exact inspected file identity.
    let staged = archive::inspect_to(Path::new(&request.source), &workspace(root)?)?;
    if staged.source_hash != preview.archive_sha256 {
        return Err(fail(Code::StalePreview));
    }
    let id = crate::domain::new_id();
    let op = operation(root, &id)?;
    private_dir(op.parent().ok_or_else(|| fail(Code::UnsafePath))?)?;
    private_dir(&op)?;
    // No persistent intent exists yet: any failure here leaves only an inert operation directory.
    let candidate = op.join("candidate.db");
    fs::copy(staged.directory.path().join("journal.sqlite"), &candidate)?;
    {
        let upgraded = db::open_file(&candidate).map_err(|_| fail(Code::Integrity))?;
        upgraded.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }
    archive::validate_database(&candidate, db::latest_version())?;
    FileSync::sync(&candidate)?;
    copy_inventory(
        &staged.directory.path().join("attachments"),
        &op.join("candidate-attachments"),
        &staged.manifest.attachments,
    )?;
    archive::snapshot(c, &op.join("safety.db"))?;
    let original_attachments = archive::inventory(c, &root.join("attachments"))?;
    // Copy the whole managed root, rejecting stray/unsafe files: no unbacked-up bytes can disappear.
    copy_managed(
        &root.join("attachments"),
        &op.join("safety-attachments"),
        &original_attachments,
    )?;
    write_new(
        &op.join("safety-inventory.json"),
        &serde_json::to_vec(&original_attachments)?,
    )?;
    write_new(
        &op.join("candidate-inventory.json"),
        &serde_json::to_vec(&staged.manifest.attachments)?,
    )?;
    sync_dir(&op)?;
    sync_dir(op.parent().ok_or_else(|| fail(Code::UnsafePath))?)?;
    write_pending(
        root,
        &Pending {
            operation_id: id.clone(),
            phase: "prepared".into(),
        },
    )?;
    Ok(RestoreResult {
        operation_id: id.clone(),
        state: "restart_required".into(),
        safety_backup_id: id,
    })
}
struct FileSync;
impl FileSync {
    fn sync(p: &Path) -> Result<()> {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(p)?
            .sync_all()?;
        Ok(())
    }
}
fn write_pending(root: &Path, value: &Pending) -> Result<()> {
    no_symlink_components(&root.join(PENDING))?;
    let mut temp = tempfile::NamedTempFile::new_in(root)?;
    use std::io::Write;
    temp.write_all(&serde_json::to_vec(value)?)?;
    temp.as_file().sync_all()?;
    temp.persist(root.join(PENDING))
        .map_err(|_| fail(Code::Io))?;
    sync_dir(root)
}
pub(crate) fn copy_inventory(
    source: &Path,
    target: &Path,
    list: &[super::Attachment],
) -> Result<()> {
    no_symlink_components(source)?;
    no_symlink_components(target)?;
    fs::create_dir_all(target)?;
    for a in list {
        relative(&a.storage_key)?;
        let path = source.join(&a.storage_key);
        no_symlink_components(&path)?;
        regular(&path)?;
        if fs::metadata(&path)?.len() != a.byte_size || hash_file(&path)? != a.sha256 {
            return Err(fail(Code::MissingAttachment));
        }
        let dest = target.join(&a.storage_key);
        let data = fs::read(path)?;
        write_new(&dest, &data)?;
        if hash_file(&dest)? != a.sha256 {
            return Err(fail(Code::MissingAttachment));
        }
    }
    sync_tree(target)
}
fn sync_tree(root: &Path) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            sync_tree(&path)?;
        }
    }
    sync_dir(root)
}
fn managed_files(root: &Path, prefix: &str, names: &mut Vec<String>) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }
    no_symlink_components(root)?;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| fail(Code::UnsafePath))?;
        let key = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        relative(&key)?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(fail(Code::UnsafePath));
        }
        if metadata.is_dir() {
            managed_files(&entry.path(), &key, names)?;
        } else {
            regular(&entry.path())?;
            names.push(key);
        }
    }
    Ok(())
}
pub(crate) fn copy_managed(source: &Path, target: &Path, list: &[super::Attachment]) -> Result<()> {
    validate_managed(source, list)?;
    copy_inventory(source, target, list)
}
pub(crate) fn validate_managed(source: &Path, list: &[super::Attachment]) -> Result<()> {
    let mut files = Vec::new();
    managed_files(source, "", &mut files)?;
    let expected: std::collections::BTreeSet<_> =
        list.iter().map(|a| a.storage_key.clone()).collect();
    if files.into_iter().collect::<std::collections::BTreeSet<_>>() != expected {
        return Err(fail(Code::UnsupportedOwnership));
    }
    Ok(())
}
fn replace_database(source: &Path, live: &Path) -> Result<()> {
    // No SQLite connection may exist here. Pending intent makes interrupted multi-file swaps recoverable.
    let parent = live.parent().ok_or_else(|| fail(Code::UnsafePath))?;
    no_symlink_components(live)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    std::io::copy(&mut std::fs::File::open(source)?, &mut staged)?;
    staged.as_file().sync_all()?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let path = PathBuf::from(format!("{}{suffix}", live.display()));
        no_symlink_components(&path)?;
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    staged.persist(live).map_err(|_| fail(Code::Io))?;
    sync_dir(parent)
}
fn replace_attachments(root: &Path, source: &Path, list: &[super::Attachment]) -> Result<()> {
    let target = root.join("attachments");
    no_symlink_components(&target)?;
    if target.exists() {
        fs::remove_dir_all(&target)?;
    }
    copy_inventory(source, &target, list)?;
    sync_dir(root)
}
/// Called before opening SQLite, while this process holds the journal ownership lock.
/// An interrupted prepared operation installs; an interrupted installing operation always rolls back.
pub fn recover(root: &Path, live: &Path) -> Result<()> {
    recover_with(root, live, || Ok(()))
}
fn recover_with(
    root: &Path,
    live: &Path,
    after_database: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let marker = root.join(PENDING);
    if !marker.exists() {
        return Ok(());
    }
    regular(&marker)?;
    if fs::metadata(&marker)?.len() > 4096 {
        return Err(fail(Code::RecoveryRequired));
    }
    let mut pending: Pending = serde_json::from_slice(&fs::read(&marker)?)?;
    let op = operation(root, &pending.operation_id)?;
    let safety: Vec<super::Attachment> =
        serde_json::from_slice(&fs::read(op.join("safety-inventory.json"))?)?;
    let candidate: Vec<super::Attachment> =
        serde_json::from_slice(&fs::read(op.join("candidate-inventory.json"))?)?;
    match pending.phase.as_str() {
        "committed" => {}
        "prepared" => {
            archive::validate_database(&op.join("candidate.db"), db::latest_version())?;
            pending.phase = "installing".into();
            write_pending(root, &pending)?;
            let install: Result<()> = (|| {
                replace_database(&op.join("candidate.db"), live)?;
                after_database()?;
                replace_attachments(root, &op.join("candidate-attachments"), &candidate)?;
                Ok(())
            })();
            if install.is_err() {
                rollback(root, live, &op, &safety)?;
                fs::remove_file(&marker)?;
                sync_dir(root)?;
                return Err(fail(Code::RecoveryRequired));
            }
            pending.phase = "committed".into();
            write_pending(root, &pending)?;
        }
        "installing" => {
            rollback(root, live, &op, &safety)?;
        }
        _ => return Err(fail(Code::RecoveryRequired)),
    }
    fs::remove_file(marker)?;
    sync_dir(root)?;
    Ok(())
}
fn rollback(root: &Path, live: &Path, op: &Path, safety: &[super::Attachment]) -> Result<()> {
    archive::validate_database(&op.join("safety.db"), db::latest_version())?;
    replace_attachments(root, &op.join("safety-attachments"), safety)?;
    replace_database(&op.join("safety.db"), live)
}
#[cfg(test)]
pub(super) fn recover_failing(root: &Path, live: &Path) -> Result<()> {
    recover_with(root, live, || Err(fail(Code::Io)))
}

fn workspace(root: &Path) -> Result<PathBuf> {
    let path = root.join("data-controls-work");
    private_dir(&path)?;
    sync_dir(root)?;
    Ok(path)
}
