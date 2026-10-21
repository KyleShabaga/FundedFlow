//! Developer tools (Build 26.9): Add Fake Data and Reset All Data.
//!
//! Compiled only into debug builds (`tauri dev`): `lib.rs` declares this module
//! and registers its commands under `cfg(debug_assertions)`, so a release build
//! has neither the code nor the command entry points, whatever the frontend
//! does. Even in a debug build both actions refuse to run unless the app was
//! started on an explicitly isolated test journal: `FUNDEDFLOW_DEV_DATA_DIR`
//! naming an app-specific `com.fundedflow.desktop` directory that is not the
//! per-user journal. See docs/development/dev-tools.md.

pub mod plan;
pub mod reset;
mod rng;
pub mod seed;

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::runtime::Runtime;

/// Names the isolated test journal's data directory for a debug build.
pub const DEV_DATA_DIR_ENV: &str = "FUNDEDFLOW_DEV_DATA_DIR";

/// Where this debug run keeps its journal, and whether the developer tools may touch it.
#[derive(Debug, Clone, PartialEq)]
pub struct DevEnvironment {
    pub identifier: String,
    /// The per-user journal directory (never a target of the tools).
    pub default_dir: Option<PathBuf>,
    /// The isolated test journal, when `FUNDEDFLOW_DEV_DATA_DIR` names a valid one.
    pub isolated: Option<PathBuf>,
    /// Why `FUNDEDFLOW_DEV_DATA_DIR` was refused.
    pub problem: Option<String>,
}

fn same_path(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let (a, b) = (canon(a), canon(b));
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

fn inside(child: &Path, parent: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let (c, p) = (canon(child), canon(parent));
    if cfg!(windows) {
        c.to_string_lossy().to_lowercase().starts_with(&format!("{}\\", p.to_string_lossy().to_lowercase()))
    } else {
        c.starts_with(&p) && c != p
    }
}

/// An isolated test journal directory: absolute, named like the app's own data directory (the
/// reset tool accepts nothing else), a real directory if it exists, and neither the per-user
/// journal nor inside it.
pub fn validate_isolated(raw: &Path, default_dir: Option<&Path>, identifier: &str) -> Result<PathBuf, String> {
    if !raw.is_absolute() {
        return Err(format!("{DEV_DATA_DIR_ENV} must be an absolute path"));
    }
    if raw.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err(format!("{DEV_DATA_DIR_ENV} must not contain '.' or '..'"));
    }
    if raw.file_name().and_then(|n| n.to_str()) != Some(identifier) {
        return Err(format!("{DEV_DATA_DIR_ENV} must end in an app-specific '{identifier}' directory"));
    }
    if let Ok(meta) = std::fs::symlink_metadata(raw)
        && (meta.file_type().is_symlink() || !meta.is_dir())
    {
        return Err(format!("{DEV_DATA_DIR_ENV} must be a real directory, not a file or symlink"));
    }
    if let Some(default) = default_dir {
        if same_path(raw, default) {
            return Err(format!("{DEV_DATA_DIR_ENV} points at the real per-user journal; use a separate test directory"));
        }
        if inside(raw, default) || inside(default, raw) {
            return Err(format!("{DEV_DATA_DIR_ENV} must not be inside (or contain) the real per-user journal"));
        }
    }
    Ok(raw.to_path_buf())
}

impl DevEnvironment {
    pub fn resolve(env_value: Option<OsString>, default_dir: Option<PathBuf>, identifier: &str) -> Self {
        let (isolated, problem) = match env_value.filter(|v| !v.is_empty()) {
            None => (None, None),
            Some(v) => match validate_isolated(Path::new(&v), default_dir.as_deref(), identifier) {
                Ok(p) => (Some(p), None),
                Err(e) => (None, Some(e)),
            },
        };
        DevEnvironment { identifier: identifier.into(), default_dir, isolated, problem }
    }

    pub fn from_env(default_dir: Option<PathBuf>, identifier: &str) -> Self {
        Self::resolve(std::env::var_os(DEV_DATA_DIR_ENV), default_dir, identifier)
    }

    /// The directory the journal opens in. A refused `FUNDEDFLOW_DEV_DATA_DIR` is an error, never a
    /// silent fallback to the real journal.
    pub fn data_dir(&self, default: Result<PathBuf, String>) -> Result<PathBuf, String> {
        match (&self.isolated, &self.problem) {
            (Some(dir), _) => Ok(dir.clone()),
            (None, Some(problem)) => Err(format!("Developer test journal refused: {problem}")),
            (None, None) => default,
        }
    }

    /// The isolated directory, required by both tools.
    fn require_isolated(&self, runtime: &Runtime) -> AppResult<PathBuf> {
        let Some(dir) = &self.isolated else {
            return Err(AppError::Conflict {
                message: match &self.problem {
                    Some(p) => format!("developer tools are disabled: {p}"),
                    None => format!(
                        "developer tools only work on an isolated test journal. Start FundedFlow with `npm run dev:test-journal` \
                         (or set {DEV_DATA_DIR_ENV} to a separate '{}' directory).",
                        self.identifier
                    ),
                },
            });
        };
        // Belt and braces: the open journal must be that directory.
        if !runtime.data_dir().is_some_and(|open| same_path(&open, dir)) {
            return Err(AppError::Conflict { message: "the open journal is not the isolated test journal; nothing was changed".into() });
        }
        Ok(dir.clone())
    }
}

/// Tauri-managed state of the developer tools.
pub struct DevState {
    pub env: DevEnvironment,
    busy: AtomicBool,
}

impl DevState {
    pub fn new(env: DevEnvironment) -> Self {
        DevState { env, busy: AtomicBool::new(false) }
    }

    /// One developer action at a time; a second click while one runs is refused, not queued.
    fn claim(&self) -> AppResult<Busy<'_>> {
        if self.busy.swap(true, Ordering::AcqRel) {
            return Err(AppError::Conflict { message: "another developer action is still running".into() });
        }
        Ok(Busy(&self.busy))
    }
}

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevToolsStatus {
    pub isolated: bool,
    pub data_dir: Option<String>,
    pub default_data_dir: Option<String>,
    pub problem: Option<String>,
    pub env_var: &'static str,
    pub presets: Vec<PresetInfo>,
    pub default_seed: u32,
    /// The outcome of the last Reset All Data handoff, until dismissed.
    pub last_reset: Option<reset::ResetReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub id: plan::Preset,
    pub scenarios: Vec<&'static str>,
    pub window_days: i64,
}

fn display(p: &Path) -> String {
    p.display().to_string()
}

#[tauri::command]
pub fn dev_tools_status(dev: State<'_, DevState>) -> DevToolsStatus {
    let env = &dev.env;
    DevToolsStatus {
        isolated: env.isolated.is_some(),
        data_dir: env.isolated.as_deref().map(display),
        default_data_dir: env.default_dir.as_deref().map(display),
        problem: env.problem.clone(),
        env_var: DEV_DATA_DIR_ENV,
        presets: [plan::Preset::UiSmoke, plan::Preset::Stress]
            .into_iter()
            .map(|id| PresetInfo { id, scenarios: id.scenarios().to_vec(), window_days: id.window_days() })
            .collect(),
        default_seed: seed::DEFAULT_SEED,
        last_reset: env.isolated.as_deref().and_then(|dir| reset::read_report(dir, &env.identifier)),
    }
}

#[tauri::command]
pub async fn dev_seed_fake_data(dev: State<'_, DevState>, db: State<'_, Runtime>, options: seed::SeedOptions) -> AppResult<seed::SeedReport> {
    let _busy = dev.claim()?;
    let dir = dev.env.require_isolated(&db)?;
    db.with(|c| seed::run(c, &dir, &options))
}

#[tauri::command]
pub async fn dev_reset_preview(dev: State<'_, DevState>, db: State<'_, Runtime>) -> AppResult<reset::ResetPreview> {
    let _busy = dev.claim()?;
    let dir = dev.env.require_isolated(&db)?;
    reset::preview(&db, &dir)
}

/// Typed confirmation, then: close the journal, hand the reset to the external helper, and quit
/// so the existing tool's running-app check passes. The helper never runs against an open journal.
#[tauri::command]
pub async fn dev_reset_handoff(app: AppHandle, dev: State<'_, DevState>, db: State<'_, Runtime>, confirmation: String) -> AppResult<reset::ResetHandoff> {
    let _busy = dev.claim()?;
    let dir = dev.env.require_isolated(&db)?;
    let handoff = reset::handoff(&db, &dir, &dev.env.identifier, &confirmation)?;
    std::thread::spawn(move || {
        // Let the response reach the window before the process exits.
        std::thread::sleep(std::time::Duration::from_millis(900));
        app.exit(0);
    });
    Ok(handoff)
}

#[tauri::command]
pub fn dev_dismiss_reset_report(dev: State<'_, DevState>) -> AppResult<()> {
    if let Some(dir) = &dev.env.isolated {
        reset::dismiss_report(dir, &dev.env.identifier)?;
    }
    Ok(())
}

/// The command-line seeder (`cargo run --example seed-demo-journal`): the same plan and writer as
/// Add Fake Data, on a journal that FundedFlow does not have open.
pub fn cli(args: &[String]) -> Result<String, String> {
    let mut data_dir = None;
    let mut options = seed::SeedOptions { preset: plan::Preset::UiSmoke, seed: None, anchor_day: None, scenarios: None };
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = || it.next().cloned().ok_or_else(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "--data-dir" => data_dir = Some(PathBuf::from(value()?)),
            "--preset" => {
                options.preset = match value()?.as_str() {
                    "ui_smoke" => plan::Preset::UiSmoke,
                    "stress" => plan::Preset::Stress,
                    other => return Err(format!("unknown preset '{other}' (ui_smoke or stress)")),
                }
            }
            "--seed" => options.seed = Some(value()?.parse().map_err(|_| "--seed must be a whole number from 0 to 4294967295".to_string())?),
            "--anchor" => options.anchor_day = Some(value()?),
            "--scenario" | "--scenarios" => options.scenarios = Some(value()?.split(',').map(|s| s.trim().to_string()).collect()),
            "--help" | "-h" => return Ok(CLI_HELP.into()),
            other => return Err(format!("unknown argument '{other}'\n\n{CLI_HELP}")),
        }
    }
    let identifier = "com.fundedflow.desktop";
    let raw = data_dir.ok_or_else(|| format!("--data-dir is required\n\n{CLI_HELP}"))?;
    let dir = validate_isolated(&raw, default_data_dir_guess(identifier).as_deref(), identifier)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    // The app's own lock: refuses while FundedFlow has this journal open.
    let _owner = crate::data_controls::filesystem_ownership(&dir).map_err(|_| "FundedFlow has this journal open (or the directory is unsafe); close it first".to_string())?;
    let mut conn = crate::db::open_file(&dir.join(crate::db::DB_FILE_NAME)).map_err(|e| e.to_string())?;
    let report = seed::run(&mut conn, &dir, &options).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&report).map_err(|e| e.to_string())
}

const CLI_HELP: &str = "Usage: cargo run --example seed-demo-journal -- --data-dir <test-dir>/com.fundedflow.desktop \
[--preset ui_smoke|stress] [--seed N] [--anchor YYYY-MM-DD] [--scenario a,b]\n\
Seeds synthetic DEMO / TEST DATA into an isolated test journal (never the per-user journal). Close FundedFlow first.";

/// The per-user journal directory, as Tauri resolves it (see scripts/reset-test-data.mjs).
pub fn default_data_dir_guess(identifier: &str) -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from).or_else(|| home.map(|h| h.join("AppData").join("Roaming"))).map(|d| d.join(identifier))
    } else if cfg!(target_os = "macos") {
        home.map(|h| h.join("Library").join("Application Support").join(identifier))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| home.map(|h| h.join(".local").join("share")))
            .map(|d| d.join(identifier))
    }
}

#[cfg(test)]
mod tests;
