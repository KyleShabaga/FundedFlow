//! Reset All Data: a safe handoff from the running app to the existing
//! developer reset tool (`scripts/reset-test-data.mjs`, Build 26.8). This
//! module adds no deletion or backup logic of its own.
//!
//! 1. Validate: the target is the isolated test journal (`mod.rs`).
//! 2. Preview: run the tool without `--yes`; it applies its own path, symlink
//!    and identifier checks, and proves Node and the tool can run before the
//!    app gives up its journal.
//! 3. Confirm: the user types RESET (checked here as well as in the UI).
//! 4. Close: checkpoint and close the journal connection and release the
//!    data-directory lock.
//! 5. Hand off: start `scripts/dev-reset-handoff.mjs` as a detached process,
//!    then the app quits. The helper waits until no FundedFlow process is
//!    running and calls the tool's `resetTestData`, which repeats its own
//!    running-app refusal. If the helper cannot start, the journal is reopened.
//! 6. Report: the helper writes the outcome (backup path or error) to a report
//!    file beside the data directory; the next start shows it.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::runtime::Runtime;

/// The repository's scripts folder (debug builds run from a checkout).
fn scripts_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("scripts")
}

/// Node.js, as on the developer's PATH (override with FUNDEDFLOW_NODE).
fn node() -> std::ffi::OsString {
    std::env::var_os("FUNDEDFLOW_NODE").unwrap_or_else(|| "node".into())
}

pub fn report_path(data_dir: &Path, identifier: &str) -> PathBuf {
    data_dir.with_file_name(format!("{identifier}.dev-reset.json"))
}

fn log_path(data_dir: &Path, identifier: &str) -> PathBuf {
    data_dir.with_file_name(format!("{identifier}.dev-reset.log"))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetReport {
    /// pending (handed off, not finished), completed, unchanged (nothing to reset) or failed.
    pub status: String,
    pub requested_at: String,
    pub finished_at: Option<String>,
    pub data_dir: String,
    /// Where the previous journal was moved, when the reset ran.
    pub backup: Option<String>,
    pub message: String,
    pub log: Option<String>,
}

pub fn read_report(data_dir: &Path, identifier: &str) -> Option<ResetReport> {
    let text = std::fs::read_to_string(report_path(data_dir, identifier)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn dismiss_report(data_dir: &Path, identifier: &str) -> AppResult<()> {
    match std::fs::remove_file(report_path(data_dir, identifier)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::Database { message: format!("could not remove the reset report: {e}") }),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCounts {
    pub accounts: i64,
    pub archived_accounts: i64,
    pub trades: i64,
    pub import_batches: i64,
    pub journal_entries: i64,
    pub trade_reviews: i64,
    pub daily_reviews: i64,
    pub rulebooks: i64,
    pub observations: i64,
    pub snapshots: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPreview {
    pub data_dir: String,
    /// The tool's own description of what a reset covers.
    pub scope: String,
    pub counts: RecordCounts,
    /// The sibling directory the tool moves the journal to (it adds a timestamp and id).
    pub backup_pattern: String,
    pub tool: String,
    /// The tool's preview output, verbatim.
    pub tool_output: String,
    /// The equivalent command line.
    pub cli: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetHandoff {
    pub data_dir: String,
    pub report: String,
    pub log: String,
    /// How to start FundedFlow on the test journal again.
    pub reopen: String,
}

fn counts(runtime: &Runtime) -> AppResult<RecordCounts> {
    runtime.with(|c| {
        let n = |sql: &str| -> AppResult<i64> { Ok(c.query_row(sql, [], |r| r.get(0))?) };
        Ok(RecordCounts {
            accounts: n("SELECT count(*) FROM accounts")?,
            archived_accounts: n("SELECT count(*) FROM accounts WHERE archived_at IS NOT NULL")?,
            trades: n("SELECT count(*) FROM trades")?,
            import_batches: n("SELECT count(*) FROM import_batches")?,
            journal_entries: n("SELECT count(*) FROM journal_entries")?,
            trade_reviews: n("SELECT count(*) FROM trade_reviews")?,
            daily_reviews: n("SELECT count(*) FROM daily_reviews")?,
            rulebooks: n("SELECT count(*) FROM rulebooks WHERE owner_account_id IS NOT NULL")?,
            observations: n("SELECT count(*) FROM financial_observations")?,
            snapshots: n("SELECT count(*) FROM account_snapshots")?,
        })
    })
}

/// Run the existing tool in preview mode (never `--yes`).
fn run_tool_preview(data_dir: &Path) -> AppResult<(String, String)> {
    let tool = scripts_dir().join("reset-test-data.mjs");
    if !tool.is_file() {
        return Err(AppError::Conflict { message: format!("the reset tool was not found at {}", tool.display()) });
    }
    let output = Command::new(node())
        .arg(&tool)
        .arg("--all")
        .arg("--data-dir")
        .arg(data_dir)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| AppError::Conflict { message: format!("could not run Node.js for the reset tool ({e}); nothing was changed") })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(AppError::Conflict { message: format!("the reset tool refused the preview: {}", if stderr.is_empty() { &stdout } else { &stderr }) });
    }
    Ok((tool.display().to_string(), stdout))
}

pub fn preview(runtime: &Runtime, data_dir: &Path) -> AppResult<ResetPreview> {
    let counts = counts(runtime)?;
    let (tool, tool_output) = run_tool_preview(data_dir)?;
    let scope = tool_output
        .lines()
        .find(|l| l.starts_with("All local journal data"))
        .unwrap_or("All local journal data in the directory.")
        .to_string();
    Ok(ResetPreview {
        data_dir: data_dir.display().to_string(),
        scope,
        counts,
        backup_pattern: format!("{}.backup-<timestamp>-<id>", data_dir.display()),
        cli: format!("node scripts/reset-test-data.mjs --all --yes --data-dir \"{}\"", data_dir.display()),
        tool,
        tool_output,
    })
}

fn write_report(data_dir: &Path, identifier: &str, report: &ResetReport) -> AppResult<()> {
    let text = serde_json::to_string_pretty(report).map_err(|e| AppError::Database { message: e.to_string() })?;
    std::fs::write(report_path(data_dir, identifier), text)
        .map_err(|e| AppError::Database { message: format!("could not write the reset report beside the test journal: {e}") })
}

/// Start the helper in its own process group (Unix) or detached (Windows), so it outlives the app.
fn spawn_helper(data_dir: &Path, identifier: &str) -> std::io::Result<()> {
    let log = std::fs::OpenOptions::new().create(true).append(true).open(log_path(data_dir, identifier))?;
    let mut command = Command::new(node());
    command
        .arg(scripts_dir().join("dev-reset-handoff.mjs"))
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--report")
        .arg(report_path(data_dir, identifier))
        .arg("--wait-pid")
        .arg(std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        // Leave a `cargo run` job when allowed, so closing the dev session does not end the helper.
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        if command.spawn().is_ok() {
            return Ok(());
        }
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map(|_| ())
}

pub fn handoff(runtime: &Runtime, data_dir: &Path, identifier: &str, confirmation: &str) -> AppResult<ResetHandoff> {
    if confirmation != "RESET" {
        return Err(AppError::invalid("confirmation", "Type RESET to confirm"));
    }
    if !scripts_dir().join("dev-reset-handoff.mjs").is_file() {
        return Err(AppError::Conflict { message: "the reset handoff helper is missing; nothing was changed".into() });
    }
    // The tool must accept this target before the journal is given up.
    run_tool_preview(data_dir)?;
    let requested_at = crate::domain::now();
    let pending = ResetReport {
        status: "pending".into(),
        requested_at: requested_at.clone(),
        finished_at: None,
        data_dir: data_dir.display().to_string(),
        backup: None,
        message: "Reset handed off; waiting for FundedFlow to close.".into(),
        log: Some(log_path(data_dir, identifier).display().to_string()),
    };
    write_report(data_dir, identifier, &pending)?;
    runtime.release_for_handoff();
    if let Err(e) = spawn_helper(data_dir, identifier) {
        // Nothing was reset: take the journal back and say so.
        let failed = ResetReport {
            status: "failed".into(),
            finished_at: Some(crate::domain::now()),
            message: format!("The reset helper could not start ({e}). Nothing was reset."),
            ..pending
        };
        let _ = write_report(data_dir, identifier, &failed);
        if runtime.begin_initialize() {
            runtime.initialize();
        }
        return Err(AppError::Conflict { message: failed.message });
    }
    Ok(ResetHandoff {
        data_dir: data_dir.display().to_string(),
        report: report_path(data_dir, identifier).display().to_string(),
        log: log_path(data_dir, identifier).display().to_string(),
        reopen: "npm run dev:test-journal".into(),
    })
}
