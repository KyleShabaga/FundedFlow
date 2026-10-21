//! Native preview/commit agreement. Attempt intervals are exact instants, never
//! calendar days. The token is a content digest, not an authorization credential.
use std::collections::HashSet;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{dedup, pairs, trade_preview, Analysis, CsvImportRequest, Match, Outcome};
use crate::domain::{format_instant, parse_payload_time};
use crate::error::{AppError, AppResult};
use crate::store::accounts;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Acknowledgement {
    pub preview_token: String,
    pub historical_confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assessment {
    pub preview_token: String,
    pub blocked: Option<String>,
    pub confirmations: Vec<String>,
    pub start_inclusive: Option<String>,
    pub end_exclusive: Option<String>,
    pub candidate_count: u32,
}

type Link = (String, String, String);

/// Read the entire connected path, including later resets, without using broker
/// references or mutable aggregate counts as identity. Detect corrupt/legacy paths.
fn path(conn: &Connection, account_id: &str) -> AppResult<(Vec<Link>, bool)> {
    let mut root = account_id.to_string();
    let mut seen = HashSet::new();
    loop {
        if !seen.insert(root.clone()) || seen.len() > 10_000 {
            return Ok((vec![], false));
        }
        let prev: Option<String> = conn.query_row(
            "SELECT predecessor_account_id FROM account_attempt_links WHERE successor_account_id = ?1",
            [&root], |r| r.get(0),
        ).optional()?;
        match prev {
            Some(id) => root = id,
            None => break,
        }
    }
    // Legacy parent links do not establish an exact interval. Never infer a date.
    let legacy_parent: Option<String> = conn.query_row(
        "SELECT parent_account_id FROM accounts WHERE id = ?1",
        [&root],
        |r| r.get(0),
    )?;
    let mut links = Vec::new();
    let mut at = root;
    seen.clear();
    loop {
        if !seen.insert(at.clone()) || seen.len() > 10_000 {
            return Ok((links, false));
        }
        let next: Option<(String, String)> = conn.query_row(
            "SELECT successor_account_id, effective_at FROM account_attempt_links WHERE predecessor_account_id = ?1",
            [&at], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        match next {
            Some((id, time)) => {
                links.push((at, id.clone(), time));
                at = id;
            }
            None => break,
        }
    }
    Ok((links, legacy_parent.is_none()))
}

pub(super) fn assess(
    conn: &Connection,
    req: &CsvImportRequest,
    a: &Analysis,
    matches: &[Match],
) -> AppResult<Assessment> {
    let account = accounts::get_any(conn, &req.account_id)?;
    let (links, mut complete) = path(conn, &req.account_id)?;
    let mut start = None;
    let mut end = None;
    let mut previous = None;
    for (from, to, raw) in &links {
        match parse_payload_time(raw) {
            Ok(time) => {
                if previous.is_some_and(|p| time <= p) {
                    complete = false;
                }
                previous = Some(time);
                if to == &req.account_id {
                    start = Some(time);
                }
                if from == &req.account_id {
                    end = Some(time);
                }
            }
            Err(_) => complete = false,
        }
    }
    let mut assessment = Assessment {
        preview_token: String::new(),
        blocked: if account.archived_at.is_some() {
            Some("Archived attempts are read-only. Restore the account before importing.".into())
        } else if !complete {
            Some("This attempt's reset boundaries are incomplete or inconsistent. Review its lineage before importing.".into())
        } else {
            None
        },
        confirmations: vec![],
        start_inclusive: start.map(format_instant),
        end_exclusive: end.map(format_instant),
        candidate_count: 0,
    };
    let mut classified = Vec::new();
    let mut outside = 0u32;
    for ((raw, outcome), m) in pairs(a).into_iter().zip(matches) {
        let Outcome::Valid { trade, .. } = outcome else {
            continue;
        };
        // Bind classification as well as normalized candidates. A concurrent insert,
        // deletion, restore or correction requires a fresh preview.
        let (entry, exit, saved) = match m {
            Match::Restore(r) => {
                let saved: (String, Option<String>, String, String, Option<String>) = conn.query_row(
                    "SELECT entry_at, exit_at, trading_day, updated_at, deleted_at FROM trades WHERE id = ?1 AND account_id = ?2",
                    [&r.trade_id, &req.account_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                )?;
                let entry =
                    parse_payload_time(&saved.0).map_err(|e| AppError::invalid("target", e))?;
                let exit = saved
                    .1
                    .as_deref()
                    .map(parse_payload_time)
                    .transpose()
                    .map_err(|e| AppError::invalid("target", e))?;
                (entry, exit, Some(json!(saved)))
            }
            _ => (trade.fields.entry_at, trade.fields.exit_at, None),
        };
        classified.push(json!([
            raw.row_number,
            trade_preview(trade),
            format!("{m:?}"),
            saved
        ]));
        if matches!(m, Match::Duplicate(_)) {
            continue;
        }
        assessment.candidate_count += 1;
        let fits = |instant: DateTime<Utc>| {
            start.is_none_or(|s| instant >= s) && end.is_none_or(|e| instant < e)
        };
        if !fits(entry) || exit.is_some_and(|t| !fits(t)) {
            outside += 1;
        }
    }
    if outside > 0 && assessment.blocked.is_none() {
        assessment.blocked = Some(format!("{outside} importable row(s) fall outside this attempt's exact reset interval or span a reset. Choose the correct attempt or split the file; trades are never moved automatically."));
    }
    if assessment.candidate_count > 0 && account.status != "active" {
        assessment.confirmations.push(format!(
            "{} has status {}. Confirm these trades belong to this attempt.",
            account.name, account.status
        ));
    }
    assessment.preview_token = dedup::sha256_hex(json!({
        "contract": 1, "account": account, "links": links, "complete": complete,
        "request": {"accountId": req.account_id, "fileName": req.file_name, "contentHash": a.sha256,
            "timezone": req.timezone, "format": req.format, "dateFormat": req.date_format, "columns": req.columns},
        "classified": classified, "blocked": assessment.blocked, "confirmations": assessment.confirmations,
    }).to_string().as_bytes());
    Ok(assessment)
}

pub(super) fn verify(req: &CsvImportRequest, assessment: &Assessment) -> AppResult<()> {
    if let Some(reason) = &assessment.blocked {
        return Err(AppError::invalid("target", reason));
    }
    let ack = req.target_acknowledgement.as_ref().ok_or_else(|| {
        AppError::invalid(
            "targetAcknowledgement",
            "Preview this file and review the destination before importing.",
        )
    })?;
    if ack.preview_token != assessment.preview_token {
        return Err(AppError::invalid("targetAcknowledgement", "The file, destination or lineage changed. Preview the file again and review the destination."));
    }
    if !assessment.confirmations.is_empty() && !ack.historical_confirmed {
        return Err(AppError::invalid(
            "targetAcknowledgement",
            "Confirm that these trades belong to this non-active attempt.",
        ));
    }
    Ok(())
}
