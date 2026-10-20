//! Errors returned by Tauri commands. Serialized as `{ kind, message, issues? }`
//! and mirrored by `appErrorSchema` in `src/lib/data/schemas.ts`.

use rusqlite::ErrorCode;
use serde::Serialize;

/// A problem with one input field (or CSV column).
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldIssue {
    pub field: String,
    pub message: String,
}

impl FieldIssue {
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self { field: field.into(), message: message.into() }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    Validation { message: String, issues: Vec<FieldIssue> },
    NotFound { message: String },
    /// A uniqueness or relationship constraint rejected the write.
    Conflict { message: String },
    Database { message: String },
    /// The journal database is not open; see `runtime_status`.
    Unavailable { message: String },
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn validation(issues: Vec<FieldIssue>) -> Self {
        let message = match issues.as_slice() {
            [one] => format!("{}: {}", one.field, one.message),
            _ => format!("{} fields are invalid", issues.len()),
        };
        AppError::Validation { message, issues }
    }

    pub fn invalid(field: &str, message: impl Into<String>) -> Self {
        Self::validation(vec![FieldIssue::new(field, message)])
    }

    pub fn not_found(what: &str, id: &str) -> Self {
        AppError::NotFound { message: format!("{what} '{id}' was not found") }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match &e {
            rusqlite::Error::SqliteFailure(f, msg) if f.code == ErrorCode::ConstraintViolation => {
                AppError::Conflict { message: msg.clone().unwrap_or_else(|| e.to_string()) }
            }
            _ => AppError::Database { message: e.to_string() },
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Validation { message, .. }
            | AppError::NotFound { message }
            | AppError::Conflict { message }
            | AppError::Database { message }
            | AppError::Unavailable { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for AppError {}

/// Collects field issues during validation.
#[derive(Default)]
pub struct Issues(pub Vec<FieldIssue>);

impl Issues {
    pub fn add(&mut self, field: &str, message: impl Into<String>) {
        self.0.push(FieldIssue::new(field, message));
    }

    pub fn into_result(self) -> AppResult<()> {
        if self.0.is_empty() { Ok(()) } else { Err(AppError::validation(self.0)) }
    }
}
