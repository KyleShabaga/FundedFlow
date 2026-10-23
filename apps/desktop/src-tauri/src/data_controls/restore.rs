//! Replace-only restart installation. Durable intent precedes mutation; incomplete installs roll back.
use super::{Code, Result, archive, fail, filesystem::*, over_limit};
use crate::db;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
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
    archive::content_hash(c)
}
fn token(archive_hash: &str, current_hash: &str) -> String {
    digest(format!("restore-v1\0replace\0{archive_hash}\0{current_hash}").as_bytes())
}
fn counts(c: &Connection) -> Result<super::Counts> {
    archive::counts(c)
}
/// The margin `space()` adds to every free-space check.
const MARGIN: u64 = 16 * 1024 * 1024;
/// Free bytes a restore over a live journal of `page_count × page_size` needs.
#[derive(Debug, PartialEq)]
pub(super) struct Required {
    /// What `inspect` checks at the data folder (before the margin).
    pub inspect_check: u64,
    /// What `inspect` reports as `required_free_bytes` (the check plus the margin).
    pub advertised: u64,
    /// What `prepare` checks at the operation folder before taking the safety copy (before the margin).
    pub prepare_check: u64,
}
pub(super) fn required(page_count: u64, page_size: u64) -> Required {
    // The safety copy is a backup of every page, committed WAL pages included, and VACUUM then needs room
    // for a second copy.
    let safety = page_count.saturating_mul(page_size).saturating_mul(2);
    Required {
        inspect_check: (MAX_TOTAL * 4).saturating_add(safety),
        advertised: (MAX_TOTAL * 4 + MARGIN).saturating_add(safety),
        prepare_check: safety,
    }
}
fn live_required(c: &Connection) -> Result<Required> {
    let get = |name| c.pragma_query_value(None, name, |r| r.get::<_, i64>(0));
    Ok(required(
        get("page_count")?.max(0) as u64,
        get("page_size")?.max(0) as u64,
    ))
}
/// Free bytes at a folder. Tests substitute a fixed figure.
pub(super) type Available<'a> = &'a dyn Fn(&Path) -> Result<u64>;
fn disk(dir: &Path) -> Result<u64> {
    Ok(fs2::available_space(dir)?)
}
/// `space()`, with the available figure supplied.
fn ensure(available: Available, dir: &Path, needed: u64) -> Result<()> {
    if available(dir)? < needed.saturating_add(MARGIN) {
        return Err(fail(Code::InsufficientSpace));
    }
    Ok(())
}
pub fn inspect(c: &Connection, root: &Path, request: InspectRequest) -> Result<RestorePreview> {
    inspect_with(c, root, request, &disk)
}
pub(super) fn inspect_with(
    c: &Connection,
    root: &Path,
    request: InspectRequest,
    available: Available,
) -> Result<RestorePreview> {
    no_symlink_components(root)?;
    let required = live_required(c)?;
    ensure(available, root, required.inspect_check)?;
    let stage = archive::inspect_to(Path::new(&request.source), &workspace(root)?)?;
    // Also prove that all required upgrades can run without touching active data.
    let mut candidate = db::open_restore_candidate(&stage.directory.path().join("journal.sqlite"))
        .map_err(|_| fail(Code::Integrity))?;
    db::migrate(&mut candidate).map_err(|_| fail(Code::Integrity))?;
    let archive_sha256 = stage.source_hash.clone();
    let preview_token = token(&archive_sha256, &content_hash(c)?);
    let mut warnings: Vec<String> = vec![
        "Plaintext archive; hashes are integrity checks, not authentication.".into(),
        "Replaces the entire journal and app-managed attachments after exclusive restart; never merges.".into(),
        "External backups remain untouched. A local pre-restore safety copy remains until explicitly removed.".into(),
    ];
    // Missing or changed screenshots never block a restore; the preview names them.
    warnings.extend(archive::attachment_warnings(
        c,
        &archive::survey(c, &root.join("attachments"))?,
    )?);
    Ok(RestorePreview {
        state: "validated".into(),
        manifest: stage.manifest,
        archive_sha256,
        preview_token,
        replaced_entities: counts(c)?,
        required_confirmation: "REPLACE ENTIRE JOURNAL".into(),
        required_free_bytes: required.advertised,
        warnings,
    })
}
/// Must be called with the runtime lock, followed by closing the connection before any further writes.
pub fn prepare(c: &Connection, root: &Path, request: RestoreRequest) -> Result<RestoreResult> {
    prepare_with(c, root, request, &disk)
}
pub(super) fn prepare_with(
    c: &Connection,
    root: &Path,
    request: RestoreRequest,
    available: Available,
) -> Result<RestoreResult> {
    if request.confirmation != "REPLACE ENTIRE JOURNAL" {
        return Err(fail(Code::ConfirmationRequired));
    }
    if root.join(PENDING).exists() {
        return Err(fail(Code::RecoveryRequired));
    }
    let preview = inspect_with(
        c,
        root,
        InspectRequest {
            source: request.source.clone(),
        },
        available,
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
        let upgraded = db::open_restore_candidate(&candidate).map_err(|_| fail(Code::Integrity))?;
        upgraded.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }
    archive::validate_database(&candidate, db::latest_version())?;
    FileSync::sync(&candidate)?;
    copy_inventory(
        &staged.directory.path().join("attachments"),
        &op.join("candidate-attachments"),
        &staged.manifest.attachments,
    )?;
    // The safety copy is local only: uncapped, but it must fit before any persistent intent is written.
    ensure(available, &op, live_required(c)?.prepare_check)?;
    archive::local_snapshot(c, &op.join("safety.db"))?;
    let survey = archive::survey(c, &root.join("attachments"))?;
    // The safety inventory lists verified files only; rollback reinstates exactly these.
    let original_attachments = survey.present.clone();
    // Copy the verified files and any unowned managed extras, refusing unsafe or unrecognised files: no
    // unbacked-up bytes can disappear. Changed files are recorded, so they are never taken for extras.
    copy_managed(
        &root.join("attachments"),
        &op.join("safety-attachments"),
        &original_attachments,
        &survey.changed_keys(),
    )?;
    // Changed bytes are kept apart before anything is replaced; if they cannot be, nothing is.
    let unverified = preserve_unverified(
        &root.join("attachments"),
        &op.join("safety-changed-attachments"),
        &survey,
        available,
        &op,
    )?;
    write_new(
        &op.join("safety-inventory.json"),
        &serde_json::to_vec(&original_attachments)?,
    )?;
    // Always written, empty when nothing is missing or changed. Nothing reads it back: rollback uses only the
    // safety inventory, so a folder from the previous version (which has no such file) rolls back the same way.
    write_new(
        &op.join("safety-missing.json"),
        &serde_json::to_vec(&unverified)?,
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
pub(crate) fn managed_files(root: &Path, prefix: &str, names: &mut Vec<String>) -> Result<()> {
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
/// One `safety-missing.json` entry: an attachments row whose file was missing or changed when the restore was
/// prepared, with the recorded size and hash, and for a changed file those of the copy kept in
/// `safety-changed-attachments/`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Unverified {
    id: String,
    storage_key: String,
    byte_size: u64,
    sha256: String,
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    actual_byte_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actual_sha256: Option<String>,
}
/// Copy each changed file, hash-verified, into `target` (after a free-space check at `op`); record missing ones.
/// Any changed file that is not safely readable fails the restore before its intent is written.
fn preserve_unverified(
    source: &Path,
    target: &Path,
    survey: &archive::Survey,
    available: Available,
    op: &Path,
) -> Result<Vec<Unverified>> {
    let record = |a: &super::Attachment, state, actual: Option<(u64, String)>| Unverified {
        id: a.id.clone(),
        storage_key: a.storage_key.clone(),
        byte_size: a.byte_size,
        sha256: a.sha256.clone(),
        state,
        actual_byte_size: actual.as_ref().map(|(len, _)| *len),
        actual_sha256: actual.map(|(_, hash)| hash),
    };
    let mut entries: Vec<Unverified> = survey
        .missing
        .iter()
        .map(|a| record(a, "missing", None))
        .collect();
    if !survey.changed.is_empty() {
        let mut needed = 0u64;
        for a in &survey.changed {
            needed = needed.saturating_add(fs::metadata(source.join(&a.storage_key))?.len());
        }
        ensure(available, op, needed)?;
        for a in &survey.changed {
            relative(&a.storage_key)?;
            let path = source.join(&a.storage_key);
            no_symlink_components(&path)?;
            regular(&path)?;
            let len = fs::metadata(&path)?.len();
            if len > MAX_ENTRY {
                return Err(over_limit("changed attachment", len, MAX_ENTRY, "bytes"));
            }
            let hash = hash_file(&path)?;
            let dest = target.join(&a.storage_key);
            write_new(&dest, &fs::read(&path)?)?;
            if hash_file(&dest)? != hash {
                return Err(fail(Code::Integrity));
            }
            entries.push(record(a, "changed", Some((len, hash))));
        }
        sync_tree(target)?;
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}
/// Whether `key` is a name FundedFlow itself writes under `attachments/` (`store/attachments.rs`): a finished
/// screenshot `screenshots/<uuid>.<png|jpg|webp>` or an interrupted write `screenshots/.<uuid>.part`, with `<uuid>`
/// in the lowercase hyphenated form `domain::new_id` produces. Unreferenced files like these are leftovers of a
/// crash or a failed removal, not someone else's data.
pub(crate) fn is_managed_extra(key: &str) -> bool {
    let Some(name) = key.strip_prefix("screenshots/") else {
        return false;
    };
    let id = match name.strip_prefix('.').and_then(|n| n.strip_suffix(".part")) {
        Some(id) => id,
        None => match name.rsplit_once('.') {
            Some((id, "png" | "jpg" | "webp")) => id,
            _ => return false,
        },
    };
    uuid::Uuid::parse_str(id).is_ok_and(|u| u.hyphenated().to_string() == id)
}
/// Copies the listed attachments and, hash-verified, the unowned managed extras: no bytes are lost.
pub(crate) fn copy_managed(
    source: &Path,
    target: &Path,
    list: &[super::Attachment],
    changed: &BTreeSet<String>,
) -> Result<()> {
    let extras = validate_managed(source, list, changed)?;
    copy_inventory(source, target, list)?;
    for key in &extras {
        let path = source.join(key);
        no_symlink_components(&path)?;
        regular(&path)?;
        // Extras have no recorded hash: the copy must match the source as it was read.
        let hash = hash_file(&path)?;
        let dest = target.join(key);
        write_new(&dest, &fs::read(&path)?)?;
        if hash_file(&dest)? != hash {
            return Err(fail(Code::Integrity));
        }
    }
    sync_tree(target)
}
/// The unowned managed extras under `source` (sorted), next to the listed attachments. Unsafe entries (links,
/// reparse points, hard links, non-regular entries, invalid names) fail with `UnsafePath`; any other regular file
/// no row lists fails with `UnrecognizedFile`. `changed` holds keys recorded as changed attachments (TASK-017):
/// never extras. Empty until TASK-017 fills it.
pub(crate) fn validate_managed(
    source: &Path,
    list: &[super::Attachment],
    changed: &BTreeSet<String>,
) -> Result<Vec<String>> {
    let mut files = Vec::new();
    managed_files(source, "", &mut files)?;
    let listed: BTreeSet<&str> = list.iter().map(|a| a.storage_key.as_str()).collect();
    let present: BTreeSet<&str> = files.iter().map(String::as_str).collect();
    if !listed.is_subset(&present) {
        return Err(fail(Code::MissingAttachment));
    }
    let mut extras = Vec::new();
    for key in &files {
        if listed.contains(key.as_str()) || changed.contains(key) {
            continue;
        }
        if !is_managed_extra(key) {
            return Err(fail(Code::UnrecognizedFile));
        }
        extras.push(key.clone());
    }
    extras.sort();
    Ok(extras)
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
    let read_inventory = |name: &str| -> Result<Vec<super::Attachment>> {
        Ok(serde_json::from_slice(&fs::read(op.join(name))?)?)
    };
    match pending.phase.as_str() {
        "committed" => {}
        "prepared" => {
            // Nothing is replaced before "installing". A staged restore that can no longer be read or validated
            // is abandoned (the operation directory stays for inspection) so the original journal opens on retry.
            let staged = read_inventory("safety-inventory.json").and_then(|safety| {
                archive::validate_database(&op.join("candidate.db"), db::latest_version())?;
                Ok((safety, read_inventory("candidate-inventory.json")?))
            });
            let Ok((safety, candidate)) = staged else {
                fs::remove_file(&marker)?;
                sync_dir(root)?;
                return Err(fail(Code::RecoveryRequired));
            };
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
            rollback(root, live, &op, &read_inventory("safety-inventory.json")?)?;
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
