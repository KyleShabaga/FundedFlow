//! Permanent deletion uses normal live constraints. Ambiguous ownership/lineage is blocked.
use super::{Code, Counts, Result, archive, fail, filesystem::*};
use crate::db;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::Path};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Scope {
    Account {
        #[serde(rename = "accountId")]
        account_id: String,
    },
    Journal,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewRequest {
    pub scope: Scope,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionPreview {
    pub scope: Scope,
    pub account_name: Option<String>,
    pub affected_entities: Counts,
    pub attachments: Vec<super::Attachment>,
    pub linked_account_ids: Vec<String>,
    pub blockers: Vec<String>,
    pub preview_token: String,
    pub required_confirmation: String,
    pub warnings: Vec<String>,
    pub local_recovery_copies: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteRequest {
    pub scope: Scope,
    pub preview_token: String,
    pub confirmation: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub operation_id: String,
    pub state: String,
    pub affected_entities: Counts,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cleanup {
    operation_id: String,
    whole_journal: bool,
    attachments: Vec<super::Attachment>,
    recovery_copies: Vec<String>,
}
fn owned_attachments(c: &Connection, id: &str) -> Result<Vec<super::Attachment>> {
    let mut s=c.prepare("SELECT DISTINCT a.id FROM attachments a WHERE a.account_id=?1 OR a.id IN (
        SELECT source_attachment_id FROM import_batches WHERE account_id=?1
        UNION SELECT l.attachment_id FROM attachment_links l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.account_id=?1
        UNION SELECT l.attachment_id FROM attachment_links l JOIN trade_reviews r ON r.id=l.trade_review_id JOIN trades t ON t.id=r.trade_id WHERE t.account_id=?1)")?;
    let ids = s
        .query_map([id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<BTreeSet<_>>>()?;
    Ok(archive::attachments(c)?
        .into_iter()
        .filter(|a| ids.contains(&a.id))
        .collect())
}
fn remove_account(c: &mut Connection, id: &str, attachments: &[super::Attachment]) -> Result<()> {
    let tx = c.transaction()?;
    tx.execute("DELETE FROM accounts WHERE id=?1", [id])?;
    for a in attachments {
        tx.execute("DELETE FROM attachments WHERE id=?1 AND (account_id IS NULL OR account_id=?2) AND NOT EXISTS(SELECT 1 FROM attachment_links WHERE attachment_id=?1) AND NOT EXISTS(SELECT 1 FROM import_batches WHERE source_attachment_id=?1)",rusqlite::params![a.id,id])?;
    }
    if tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(fail(Code::Integrity));
    }
    tx.commit()?;
    Ok(())
}
fn clone_db(c: &Connection) -> Result<Connection> {
    let mut target = Connection::open_in_memory()?;
    {
        let b = rusqlite::backup::Backup::new(c, &mut target)?;
        if b.step(-1)? != rusqlite::backup::StepResult::Done {
            return Err(fail(Code::Busy));
        }
    }
    db::configure(&target)?;
    Ok(target)
}
fn recovery_copies(root: &Path) -> Result<Vec<String>> {
    let mut paths = Vec::new();
    let controls = root.join("data-controls");
    no_symlink_components(&controls)?;
    if controls.exists() {
        for e in fs::read_dir(&controls)? {
            let e = e?;
            let id = e
                .file_name()
                .into_string()
                .map_err(|_| fail(Code::UnsafePath))?;
            if uuid::Uuid::parse_str(&id).is_err() || !e.file_type()?.is_dir() {
                return Err(fail(Code::UnsupportedOwnership));
            }
            paths.push(format!("data-controls/{id}"));
        }
    }
    for e in fs::read_dir(root)? {
        let e = e?;
        let name = e
            .file_name()
            .into_string()
            .map_err(|_| fail(Code::UnsafePath))?;
        if name.starts_with("fundedflow.db.before-v") && name.ends_with(".bak") {
            regular(&e.path())?;
            paths.push(name);
        }
    }
    let work = root.join("data-controls-work");
    no_symlink_components(&work)?;
    if work.exists() {
        if !work.is_dir() {
            return Err(fail(Code::UnsupportedOwnership));
        }
        paths.push("data-controls-work".into());
    }
    paths.sort();
    Ok(paths)
}
pub fn preview(c: &Connection, root: &Path, request: PreviewRequest) -> Result<DeletionPreview> {
    let before = archive::counts(c)?;
    let content = archive::content_hash(c)?;
    let mut blockers = Vec::new();
    let mut linked = Vec::new();
    let mut attachments;
    let mut name = None;
    let mut affected = Counts::new();
    let copies = recovery_copies(root)?;
    match &request.scope {
        Scope::Account { account_id: id } => {
            name = Some(
                c.query_row("SELECT name FROM accounts WHERE id=?1", [id], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|_| fail(Code::Integrity))?,
            );
            let mut s=c.prepare("SELECT id FROM accounts WHERE parent_account_id=?1 UNION SELECT parent_account_id FROM accounts WHERE id=?1 AND parent_account_id IS NOT NULL UNION SELECT predecessor_account_id FROM account_attempt_links WHERE successor_account_id=?1 UNION SELECT successor_account_id FROM account_attempt_links WHERE predecessor_account_id=?1")?;
            linked = s
                .query_map([id], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            if !linked.is_empty() {
                blockers.push("linked_attempts".into());
            }
            if c.prepare("SELECT 1 FROM account_phase_events WHERE account_id=?1 LIMIT 1")?
                .exists([id])?
            {
                blockers.push("immutable_phase_history".into());
            }
            if c.prepare("SELECT 1 FROM rulebook_events e JOIN rulebooks b ON b.id=e.rulebook_id WHERE e.account_id=?1 AND b.owner_account_id IS NOT ?1 LIMIT 1")?.exists([id])? {
                blockers.push("immutable_shared_rulebook_history".into());
            }
            if c.prepare("SELECT 1 FROM audit_events UNION ALL SELECT 1 FROM sync_outbox LIMIT 1")?
                .exists([])?
            {
                blockers.push("unsupported_audit_or_sync_ownership".into());
            }
            if c.prepare("SELECT 1 FROM attachment_links l JOIN attachments a ON a.id=l.attachment_id LEFT JOIN trade_reviews r ON r.id=l.trade_review_id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.account_id IS NOT NULL AND ((a.account_id=?1 AND (coalesce(r.account_id,j.account_id) IS NOT ?1)) OR (coalesce(r.account_id,j.account_id)=?1 AND a.account_id IS NOT ?1)) LIMIT 1")?.exists([id])? {
                blockers.push("attachment_owner_conflict".into());
            }
            attachments = owned_attachments(c, id)?;
            let mut simulation = clone_db(c)?;
            match remove_account(&mut simulation, id, &attachments) {
                Ok(()) => {
                    let after = archive::counts(&simulation)?;
                    for (k, v) in &before {
                        let remaining = after.get(k).copied().unwrap_or(0);
                        if remaining < *v {
                            affected.insert(k.clone(), v - remaining);
                        }
                    }
                    let remaining = archive::attachments(&simulation)?;
                    attachments.retain(|a| !remaining.iter().any(|r| r.id == a.id));
                }
                Err(_) => {
                    if blockers.is_empty() {
                        blockers.push("immutable_or_shared_provenance".into());
                    }
                    // A blocked preview still enumerates direct ownership; no neighbour is added to the deletion scope.
                    for k in before.keys() {
                        let table = archive::quote(k);
                        let columns: Vec<String> = c
                            .prepare(&format!("SELECT * FROM {table} LIMIT 0"))?
                            .column_names()
                            .iter()
                            .map(|v| v.to_string())
                            .collect();
                        if let Some(column) =
                            columns.iter().find(|v| *v == "account_id" || *v == "owner_account_id")
                        {
                            // Text values equal to the id, byte for byte, as before.
                            let column = archive::quote(column);
                            let count: i64 = c.query_row(
                                &format!("SELECT count(*) FROM {table} WHERE typeof({column})='text' AND {column}=?1 COLLATE BINARY"),
                                [id],
                                |r| r.get(0),
                            )?;
                            if count > 0 {
                                affected.insert(k.clone(), count as u64);
                            }
                        }
                    }
                    affected.insert("accounts".into(), 1);
                }
            }
        }
        Scope::Journal => {
            attachments = archive::inventory(c, &root.join("attachments"))?;
            // Reject stray bytes before promising a complete whole-journal erase.
            super::restore::validate_managed(&root.join("attachments"), &attachments)?;
            affected = before.clone();
        }
    }
    let confirmation = match &request.scope {
        Scope::Account { account_id } => format!("DELETE ACCOUNT {account_id}"),
        Scope::Journal => "ERASE ENTIRE JOURNAL".into(),
    };
    let payload = serde_json::to_vec(&(
        "deletion-v1",
        &request.scope,
        &content,
        &attachments,
        &copies,
        &blockers,
    ))?;
    Ok(DeletionPreview { scope:request.scope, account_name:name, affected_entities:affected, attachments, linked_account_ids:linked, blockers,
        preview_token:digest(&payload),required_confirmation:confirmation,local_recovery_copies:copies.len() as u64,
        warnings:vec!["Permanent application-data deletion, separate from reversible account archiving.".into(),
            "External/user-exported backups remain untouched; this is not a forensic secure-erase guarantee.".into(),
            "Whole-journal erasure also removes app-managed recovery copies; account deletion leaves them intact.".into()] })
}
pub fn execute(c: &mut Connection, root: &Path, request: DeleteRequest) -> Result<DeleteResult> {
    // Files may be removed only after the SQLite commit is durable, even when the app normally uses NORMAL.
    let previous: i64 = c.pragma_query_value(None, "synchronous", |r| r.get(0))?;
    c.pragma_update(None, "synchronous", "FULL")?;
    let result = execute_durable(c, root, request);
    // Keeping FULL after a failed setting restore is safe; only the performance setting differs.
    let _ = c.pragma_update(None, "synchronous", previous);
    result
}
fn execute_durable(
    c: &mut Connection,
    root: &Path,
    request: DeleteRequest,
) -> Result<DeleteResult> {
    recover_cleanup(c, root)?;
    if root.join("data-controls-pending.json").exists() {
        return Err(fail(Code::RecoveryRequired));
    }
    let p = preview(
        c,
        root,
        PreviewRequest {
            scope: request.scope.clone(),
        },
    )?;
    if request.confirmation != p.required_confirmation {
        return Err(fail(Code::ConfirmationRequired));
    }
    if request.preview_token != p.preview_token {
        return Err(fail(Code::StalePreview));
    }
    if !p.linked_account_ids.is_empty() {
        return Err(fail(Code::LinkedAttempts));
    }
    if !p.blockers.is_empty() {
        return Err(fail(Code::UnsupportedOwnership));
    }
    let operation_id = crate::domain::new_id();
    let whole = matches!(request.scope, Scope::Journal);
    let cleanup = Cleanup {
        operation_id: operation_id.clone(),
        whole_journal: whole,
        attachments: p.attachments.clone(),
        recovery_copies: if whole {
            recovery_copies(root)?
        } else {
            vec![]
        },
    };
    let queue = root.join("data-controls-cleanup");
    no_symlink_components(&queue)?;
    private_dir(&queue)?;
    let marker = queue.join(format!("{operation_id}.json"));
    write_new(&marker, &serde_json::to_vec(&cleanup)?)?;
    sync_dir(&queue)?;
    sync_dir(root)?;
    match &request.scope {
        Scope::Account { account_id } => remove_account(c, account_id, &p.attachments)?,
        Scope::Journal => {
            let mut empty = Connection::open_in_memory()?;
            db::migrate(&mut empty).map_err(|_| fail(Code::Database))?;
            empty.execute(
                "INSERT INTO app_meta(key,value) VALUES('data_controls.erase_operation',?1)",
                [&operation_id],
            )?;
            let b = rusqlite::backup::Backup::new(&empty, c)?;
            if b.step(-1)? != rusqlite::backup::StepResult::Done {
                return Err(fail(Code::Busy));
            }
        }
    }
    let state = if recover_cleanup(c, root).is_ok() {
        "completed"
    } else {
        "cleanup_pending"
    };
    Ok(DeleteResult {
        operation_id,
        state: state.into(),
        affected_entities: p.affected_entities,
    })
}
/// Retry after commit/startup. Never remove bytes if a live DB row still owns the key or id.
pub fn recover_cleanup(c: &Connection, root: &Path) -> Result<()> {
    let queue = root.join("data-controls-cleanup");
    no_symlink_components(&queue)?;
    if !queue.exists() {
        return Ok(());
    }
    for e in fs::read_dir(&queue)? {
        let file = e?.path();
        regular(&file)?;
        if fs::metadata(&file)?.len() > 1024 * 1024 {
            return Err(fail(Code::LimitExceeded));
        }
        let cleanup: Cleanup = serde_json::from_slice(&fs::read(&file)?)?;
        for a in &cleanup.attachments {
            relative(&a.storage_key)?;
            let owned = c
                .prepare("SELECT 1 FROM attachments WHERE id=?1 OR storage_key=?2 LIMIT 1")?
                .exists(params![a.id, a.storage_key])?;
            if !owned {
                let path = root.join("attachments").join(&a.storage_key);
                no_symlink_components(&path)?;
                if path.exists() {
                    regular(&path)?;
                    fs::remove_file(&path)?;
                    if let Some(parent) = path.parent() {
                        sync_dir(parent)?;
                    }
                }
            }
        }
        let marker: Option<String> = c
            .query_row(
                "SELECT value FROM app_meta WHERE key='data_controls.erase_operation'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if cleanup.whole_journal && marker.as_deref() == Some(&cleanup.operation_id) {
            for key in &cleanup.recovery_copies {
                relative(key)?;
                if !(key == "data-controls-work"
                    || key.starts_with("data-controls/")
                    || (key.starts_with("fundedflow.db.before-v") && key.ends_with(".bak")))
                {
                    return Err(fail(Code::UnsafePath));
                }
                let path = root.join(key);
                no_symlink_components(&path)?;
                if path.is_dir() {
                    fs::remove_dir_all(&path)?;
                    if let Some(parent) = path.parent() {
                        sync_dir(parent)?;
                    }
                } else if path.exists() {
                    fs::remove_file(&path)?;
                    if let Some(parent) = path.parent() {
                        sync_dir(parent)?;
                    }
                }
            }
        }
        fs::remove_file(&file)?;
        sync_dir(&queue)?;
    }
    Ok(())
}
use rusqlite::OptionalExtension;
