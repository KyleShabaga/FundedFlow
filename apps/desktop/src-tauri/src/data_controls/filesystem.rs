use super::{Code, Result, fail};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path},
};

pub const MAX_ENTRY: u64 = 64 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 256 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 4096;
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn hash_file(path: &Path) -> Result<String> {
    let f = File::open(path)?;
    if f.metadata()?.len() > MAX_TOTAL + 2 * 1024 * 1024 {
        return Err(fail(Code::LimitExceeded));
    }
    let mut reader = std::io::BufReader::new(f);
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
/// Portable Windows-safe components, even when inspection runs on another OS.
pub fn relative(key: &str) -> Result<()> {
    if !key.is_ascii()
        || key.is_empty()
        || key.len() > 240
        || key.contains('\\')
        || key.contains(':')
        || key.contains('\0')
    {
        return Err(fail(Code::UnsafePath));
    }
    for part in key.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
            || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        {
            return Err(fail(Code::UnsafePath));
        }
    }
    if Path::new(key)
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(fail(Code::UnsafePath));
    }
    Ok(())
}
pub fn regular(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(|_| fail(Code::MissingAttachment))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(fail(Code::UnsafePath));
        }
    }
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(fail(Code::UnsafePath));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() != 1 {
            return Err(fail(Code::UnsafePath));
        }
    }
    Ok(())
}
/// Full walk from the first component: no existing ancestor may be a link, nor on Windows any reparse point.
/// Kept for user-chosen export and restore paths (TR-007/WIN-002); app-owned paths use `no_link_below`.
pub fn no_symlink_components(path: &Path) -> Result<()> {
    let mut current = std::path::PathBuf::new();
    for part in path.components() {
        current.push(part);
        if let Ok(meta) = fs::symlink_metadata(&current) {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(fail(Code::UnsafePath));
                }
            }
            if meta.file_type().is_symlink() {
                return Err(fail(Code::UnsafePath));
            }
        } else {
            break;
        }
    }
    Ok(())
}
/// The root-anchored check for app-owned paths (TASK-018). `anchor` is the data folder, or a folder FundedFlow
/// created beneath it; the OS-resolved prefix above it is trusted, so a junctioned profile, a redirected Roaming
/// folder or a mount point above the data folder no longer blocks the journal. `path` must be `anchor` or lie
/// inside it. On Windows the anchor and every existing component below it must not be a link: std's `is_symlink`
/// is true for symbolic links and for name-surrogate reparse points such as junctions and mount points.
/// Elsewhere the full walk of `no_symlink_components` still applies.
pub fn no_link_below(anchor: &Path, path: &Path) -> Result<()> {
    let rest = path
        .strip_prefix(anchor)
        .map_err(|_| fail(Code::UnsafePath))?;
    if rest
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(fail(Code::UnsafePath));
    }
    #[cfg(windows)]
    {
        let mut current = anchor.to_path_buf();
        let mut parts = rest.components();
        loop {
            match fs::symlink_metadata(&current) {
                Ok(meta) if meta.file_type().is_symlink() => return Err(fail(Code::UnsafePath)),
                Ok(_) => {}
                Err(_) => break,
            }
            match parts.next() {
                Some(part) => current.push(part),
                None => break,
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        no_symlink_components(path)
    }
}
pub fn space(dir: &Path, needed: u64) -> Result<()> {
    if fs2::available_space(dir)? < needed.saturating_add(16 * 1024 * 1024) {
        return Err(fail(Code::InsufficientSpace));
    }
    Ok(())
}
/// A new file in the export temp folder beside a user-chosen destination: full-walk check.
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    no_symlink_components(path)?;
    create_new(path, bytes)
}
/// A new file at an app-owned path below `anchor` (see `no_link_below`).
pub fn write_new_under(anchor: &Path, path: &Path, bytes: &[u8]) -> Result<()> {
    no_link_below(anchor, path)?;
    create_new(path, bytes)
}
fn create_new(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}
pub fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}
pub fn publish(temp: tempfile::NamedTempFile, destination: &Path) -> Result<()> {
    temp.as_file().sync_all()?;
    temp.persist_noclobber(destination)
        .map_err(|_| fail(Code::Io))?;
    sync_dir(destination.parent().ok_or_else(|| fail(Code::UnsafePath))?)
}

/// An app-owned private folder below `anchor` (see `no_link_below`).
pub fn private_dir(anchor: &Path, path: &Path) -> Result<()> {
    no_link_below(anchor, path)?;
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
