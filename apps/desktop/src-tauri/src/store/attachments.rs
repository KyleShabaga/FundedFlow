//! Trade screenshots (Build 20).
//!
//! Bytes live under `<app data>/attachments/<storage_key>`, the convention the
//! Build 24 archive and restore read: the key is opaque, relative and portable
//! (`screenshots/<uuid>.<ext>`), never a path from the user's machine. Every
//! row records its owner account, byte size and SHA-256, and a review link
//! must be in the same account (trigger).
//!
//! Ingestion takes bytes from the webview (pick, paste or drop), never a file
//! path. The type comes from the file signature, not the name; size, count and
//! decoded dimensions are bounded. The file is written to a temporary name and
//! renamed into place before the database rows are committed; if the
//! transaction fails the file is removed again. A missing or changed file is
//! reported as such and never breaks reading the review's text.
//!
//! Removing a screenshot soft-deletes its link and row. The bytes stay, because
//! the Build 24 archive inventory covers soft-deleted rows; permanent removal
//! belongs to Build 24's deletion and cleanup.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::account_ctx;
use crate::domain::{new_id, now};
use crate::error::{AppError, AppResult};

pub const MAX_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_PER_REVIEW: i64 = 20;
pub const MAX_SIDE: u32 = 16_384;
pub const MAX_PIXELS: u64 = 120_000_000;
pub const ATTACHMENTS_DIR: &str = "attachments";
const MAX_NAME_CHARS: usize = 255;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMeta {
    pub id: String,
    /// The name it had on the trader's computer (display only; never used as a path).
    pub file_name: Option<String>,
    pub mime_type: String,
    pub byte_size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub sha256: String,
    pub caption: Option<String>,
    pub created_at: String,
    /// "ok" | "missing" | "changed" (size differs) | "unknown" (no data folder). Bytes are checked on read.
    pub file_status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenshotInput {
    pub account_id: String,
    pub trade_id: String,
    pub file_name: Option<String>,
    /// The file's bytes, base64 (standard alphabet, padded).
    pub data_base64: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotData {
    pub attachment_id: String,
    /// "ok": `data_base64` holds the verified bytes. "missing": no file. "corrupt": the file no longer
    /// matches its recorded size, hash or image type.
    pub status: String,
    pub mime_type: String,
    pub data_base64: Option<String>,
}

/// Image type and dimensions from the file signature and header.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImageInfo {
    pub mime: &'static str,
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
}

fn be16(b: &[u8], i: usize) -> Option<u32> {
    Some(u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32)
}
fn le16(b: &[u8], i: usize) -> Option<u32> {
    Some(u16::from_le_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32)
}
fn le24(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *b.get(i)?,
        *b.get(i + 1)?,
        *b.get(i + 2)?,
        0,
    ]))
}

/// PNG, JPEG or WebP, identified by signature, with dimensions read from the header.
/// Anything else, or a header that does not parse, is None.
pub fn sniff(bytes: &[u8]) -> Option<ImageInfo> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        // The first chunk must be IHDR: width and height are big-endian u32 at 16 and 20.
        if bytes.get(12..16)? != b"IHDR" {
            return None;
        }
        let w = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
        let h = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
        return Some(ImageInfo {
            mime: "image/png",
            ext: "png",
            width: w,
            height: h,
        });
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        // Walk the markers to the first start-of-frame.
        let mut i = 2;
        while i + 4 <= bytes.len() {
            if bytes[i] != 0xFF {
                return None;
            }
            let marker = bytes[i + 1];
            if marker == 0xFF {
                i += 1;
                continue;
            }
            if marker == 0xD8 || (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
                i += 2;
                continue;
            }
            let len = be16(bytes, i + 2)? as usize;
            if len < 2 {
                return None;
            }
            let sof = matches!(marker, 0xC0..=0xCF) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
            if sof {
                let h = be16(bytes, i + 5)?;
                let w = be16(bytes, i + 7)?;
                return Some(ImageInfo {
                    mime: "image/jpeg",
                    ext: "jpg",
                    width: w,
                    height: h,
                });
            }
            if marker == 0xDA || marker == 0xD9 {
                return None;
            }
            i += 2 + len;
        }
        return None;
    }
    if bytes.len() >= 30 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        let (w, h) = match &bytes[12..16] {
            b"VP8 " => {
                if bytes.get(23..26)? != [0x9D, 0x01, 0x2A] {
                    return None;
                }
                (le16(bytes, 26)? & 0x3FFF, le16(bytes, 28)? & 0x3FFF)
            }
            b"VP8L" => {
                if *bytes.get(20)? != 0x2F {
                    return None;
                }
                let bits = u32::from_le_bytes(bytes.get(21..25)?.try_into().ok()?);
                ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
            }
            b"VP8X" => (le24(bytes, 24)? + 1, le24(bytes, 27)? + 1),
            _ => return None,
        };
        return Some(ImageInfo {
            mime: "image/webp",
            ext: "webp",
            width: w,
            height: h,
        });
    }
    None
}

/// Validates bytes as a screenshot: supported type, size and decoded dimensions.
pub fn check_image(bytes: &[u8]) -> AppResult<ImageInfo> {
    if bytes.is_empty() {
        return Err(AppError::invalid("file", "the file is empty"));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::invalid(
            "file",
            "screenshots can be at most 10 MB",
        ));
    }
    let info = sniff(bytes).ok_or_else(|| {
        AppError::invalid(
            "file",
            "only PNG, JPEG and WebP images can be attached (checked from the file's contents)",
        )
    })?;
    if info.width == 0 || info.height == 0 {
        return Err(AppError::invalid("file", "the image has no pixels"));
    }
    if info.width > MAX_SIDE
        || info.height > MAX_SIDE
        || info.width as u64 * info.height as u64 > MAX_PIXELS
    {
        return Err(AppError::invalid(
            "file",
            format!(
                "the image is too large ({} × {} pixels)",
                info.width, info.height
            ),
        ));
    }
    Ok(info)
}

fn display_name(name: Option<String>) -> Option<String> {
    // Keep only the final component and printable characters; this is a label, not a path.
    let name = name?;
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    let clean = clean.trim().to_string();
    (!clean.is_empty()).then_some(clean)
}

fn hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Write `bytes` to `root/key` without ever replacing an existing file: a temporary name in the same
/// folder, flushed, then renamed into place.
fn write_new(root: &Path, key: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let target = root.join(key);
    let dir = target
        .parent()
        .ok_or_else(|| std::io::Error::other("no parent folder"))?;
    fs::create_dir_all(dir)?;
    if fs::symlink_metadata(&target).is_ok() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "attachment file already exists",
        ));
    }
    let temp = dir.join(format!(".{}.part", new_id()));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&temp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map(|_| target)
}

/// Attach a screenshot to a trade's review (creating an empty review if the trade has none).
/// The review's text and revision are not touched, so a failure here never loses notes.
pub fn add(
    conn: &mut Connection,
    root: &Path,
    input: ScreenshotInput,
) -> AppResult<AttachmentMeta> {
    let encoded = input.data_base64.trim();
    if encoded.len() > MAX_BYTES.div_ceil(3) * 4 + 4 {
        return Err(AppError::invalid(
            "file",
            "screenshots can be at most 10 MB",
        ));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| AppError::invalid("file", "the file data could not be read"))?;
    let info = check_image(&bytes)?;
    let sha = hex(&bytes);
    let name = display_name(input.file_name);

    // Check ownership and limits before writing anything to disk.
    {
        let tx = conn.transaction()?;
        account_ctx(&tx, &input.account_id)?;
        let owner: Option<String> = tx
            .query_row(
                "SELECT account_id FROM trades WHERE id = ?1 AND deleted_at IS NULL",
                [&input.trade_id],
                |r| r.get(0),
            )
            .optional()?;
        if owner.as_deref() != Some(input.account_id.as_str()) {
            return Err(AppError::not_found("trade", &input.trade_id));
        }
        let (count, duplicate): (i64, bool) = tx.query_row(
            "SELECT count(*), coalesce(max(a.sha256 = ?2), 0)
             FROM attachment_links l JOIN attachments a ON a.id = l.attachment_id
             JOIN trade_reviews r ON r.id = l.trade_review_id
             WHERE r.trade_id = ?1 AND r.deleted_at IS NULL AND l.deleted_at IS NULL",
            params![input.trade_id, sha],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if duplicate {
            return Err(AppError::Conflict {
                message: "this screenshot is already attached to the trade".into(),
            });
        }
        if count >= MAX_PER_REVIEW {
            return Err(AppError::invalid(
                "file",
                format!("a trade can have at most {MAX_PER_REVIEW} screenshots"),
            ));
        }
    }

    let id = new_id();
    let key = format!("screenshots/{id}.{}", info.ext);
    let base = root.join(ATTACHMENTS_DIR);
    let path = write_new(&base, &key, &bytes).map_err(|e| AppError::Database {
        message: format!("the screenshot could not be saved to the data folder: {e}"),
    })?;
    let saved = (|| -> AppResult<()> {
        let tx = conn.transaction()?;
        let review_id = super::reviews::ensure(&tx, &input.account_id, &input.trade_id)?;
        let now = now();
        tx.execute(
            "INSERT INTO attachments (id, kind, storage_key, original_name, mime_type, byte_size, sha256, created_at,
                                      updated_at, account_id, width, height)
             VALUES (?1, 'screenshot', ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10)",
            params![id, key, name, info.mime, bytes.len() as i64, sha, now, input.account_id, info.width, info.height],
        )?;
        let order: i64 = tx.query_row(
            "SELECT coalesce(max(sort_order) + 1, 0) FROM attachment_links WHERE trade_review_id = ?1",
            [&review_id],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO attachment_links (id, attachment_id, trade_review_id, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![new_id(), id, review_id, order, now],
        )?;
        tx.commit()?;
        Ok(())
    })();
    if let Err(e) = saved {
        // Nothing points at the file: remove it so no unowned bytes are left behind.
        let _ = fs::remove_file(&path);
        return Err(e);
    }
    meta(conn, Some(root), &id)?.ok_or_else(|| AppError::not_found("attachment", &id))
}

const META: &str = "SELECT a.id, a.original_name, a.mime_type, a.byte_size, a.width, a.height, a.sha256, l.caption,
        a.created_at, a.storage_key
    FROM attachment_links l JOIN attachments a ON a.id = l.attachment_id
    WHERE l.deleted_at IS NULL AND a.deleted_at IS NULL";

fn file_status(root: Option<&Path>, key: &str, size: i64) -> String {
    let Some(root) = root else {
        return "unknown".into();
    };
    match fs::symlink_metadata(root.join(ATTACHMENTS_DIR).join(key)) {
        Ok(m) if m.is_file() && m.len() == size as u64 => "ok".into(),
        Ok(_) => "changed".into(),
        Err(_) => "missing".into(),
    }
}

fn meta_row(
    root: Option<&Path>,
) -> impl Fn(&rusqlite::Row) -> rusqlite::Result<AttachmentMeta> + '_ {
    move |r| {
        let size: i64 = r.get(3)?;
        let key: String = r.get(9)?;
        Ok(AttachmentMeta {
            id: r.get(0)?,
            file_name: r.get(1)?,
            mime_type: r.get(2)?,
            byte_size: size,
            width: r.get(4)?,
            height: r.get(5)?,
            sha256: r.get(6)?,
            caption: r.get(7)?,
            created_at: r.get(8)?,
            file_status: file_status(root, &key, size),
        })
    }
}

fn meta(conn: &Connection, root: Option<&Path>, id: &str) -> AppResult<Option<AttachmentMeta>> {
    Ok(conn
        .query_row(&format!("{META} AND a.id = ?1"), [id], meta_row(root))
        .optional()?)
}

pub(crate) fn for_review(
    conn: &Connection,
    root: Option<&Path>,
    review_id: &str,
) -> AppResult<Vec<AttachmentMeta>> {
    let mut stmt = conn.prepare(&format!(
        "{META} AND l.trade_review_id = ?1 ORDER BY l.sort_order, l.id"
    ))?;
    Ok(stmt
        .query_map([review_id], meta_row(root))?
        .collect::<rusqlite::Result<_>>()?)
}

/// The screenshot's account, storage key, size, hash and type, when it is attached to an active trade of `account_id`.
fn owned(
    conn: &Connection,
    account_id: &str,
    id: &str,
) -> AppResult<(String, i64, String, String)> {
    conn.query_row(
        "SELECT a.storage_key, a.byte_size, a.sha256, a.mime_type
         FROM attachments a JOIN attachment_links l ON l.attachment_id = a.id
         JOIN trade_reviews r ON r.id = l.trade_review_id JOIN trades t ON t.id = r.trade_id
         WHERE a.id = ?1 AND a.account_id = ?2 AND r.account_id = ?2 AND t.account_id = ?2
           AND a.deleted_at IS NULL AND l.deleted_at IS NULL AND t.deleted_at IS NULL",
        params![id, account_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("screenshot", id))
}

/// The screenshot's bytes after checking its size, hash and type, or a missing/corrupt status.
pub fn read(
    conn: &Connection,
    root: &Path,
    account_id: &str,
    id: &str,
) -> AppResult<ScreenshotData> {
    let (key, size, sha, mime) = owned(conn, account_id, id)?;
    let path = root.join(ATTACHMENTS_DIR).join(&key);
    let status = |s: &str, data: Option<String>| ScreenshotData {
        attachment_id: id.to_string(),
        status: s.into(),
        mime_type: mime.clone(),
        data_base64: data,
    };
    let Ok(m) = fs::symlink_metadata(&path) else {
        return Ok(status("missing", None));
    };
    if !m.is_file() || m.len() != size as u64 {
        return Ok(status("corrupt", None));
    }
    let Ok(bytes) = fs::read(&path) else {
        return Ok(status("missing", None));
    };
    if hex(&bytes) != sha || sniff(&bytes).map(|i| i.mime) != Some(mime.as_str()) {
        return Ok(status("corrupt", None));
    }
    Ok(status("ok", Some(STANDARD.encode(bytes))))
}

/// Detach a screenshot from its trade. The row and bytes are kept (see the module notes).
pub fn remove(conn: &mut Connection, account_id: &str, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    account_ctx(&tx, account_id)?;
    owned(&tx, account_id, id)?;
    let now = now();
    tx.execute("UPDATE attachment_links SET deleted_at = ?2, updated_at = ?2 WHERE attachment_id = ?1 AND deleted_at IS NULL", params![id, now])?;
    tx.execute(
        "UPDATE attachments SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    tx.commit()?;
    Ok(())
}
