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
    if f.metadata()?.len() > MAX_TOTAL {
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
    if key.is_empty()
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
pub fn no_symlink_components(path: &Path) -> Result<()> {
    let mut current = std::path::PathBuf::new();
    for part in path.components() {
        current.push(part);
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                return Err(fail(Code::UnsafePath));
            }
        } else {
            break;
        }
    }
    Ok(())
}
pub fn space(dir: &Path, needed: u64) -> Result<()> {
    if fs2::available_space(dir)? < needed.saturating_add(16 * 1024 * 1024) {
        return Err(fail(Code::InsufficientSpace));
    }
    Ok(())
}
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    no_symlink_components(path)?;
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
