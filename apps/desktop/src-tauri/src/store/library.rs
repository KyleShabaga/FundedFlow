//! The review library (Build 20): strategies (playbooks), tags (setup, mistake,
//! emotion, general) and checklists (templates) with their items. They are
//! shared by every account. Nothing a review used is ever hard-deleted:
//! strategies, tags, checklists and items are archived, and a review keeps the
//! labels it was made with (`store::reviews`).

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::opt_text;
use crate::domain::{new_id, now};
use crate::error::{AppError, AppResult, Issues};

pub const TAG_KINDS: [&str; 4] = ["setup", "mistake", "emotion", "general"];
const MAX_NAME_CHARS: usize = 80;
const MAX_TAG_CHARS: usize = 40;
const MAX_ITEM_CHARS: usize = 200;
const MAX_ITEMS: usize = 50;
const MAX_DESCRIPTION_CHARS: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Strategy {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub archived: bool,
    /// Reviews (of any account) that use it.
    pub review_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StrategyInput {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    /// "setup" | "mistake" | "emotion" | "general"
    pub kind: String,
    pub archived: bool,
    pub review_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TagInput {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub label: String,
    pub sort_order: i64,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checklist {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// "trade": reviewed per trade (here); "daily": reviewed with the day (Build 22).
    pub scope: String,
    pub strategy_id: Option<String>,
    pub archived: bool,
    /// Active items first in their order, then archived ones.
    pub items: Vec<ChecklistItem>,
    pub review_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChecklistItemInput {
    /// An existing item of this checklist (renamed or kept), or none for a new item.
    pub id: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChecklistInput {
    pub name: String,
    pub description: Option<String>,
    pub scope: String,
    pub strategy_id: Option<String>,
    /// The checklist's active items in order. Existing items left out are archived, never deleted.
    pub items: Vec<ChecklistItemInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveInput {
    /// "strategy" | "tag" | "checklist"
    pub entity: String,
    pub id: String,
    pub archived: bool,
}

/// Everything the library holds, archived included (flagged).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub strategies: Vec<Strategy>,
    pub tags: Vec<Tag>,
    pub checklists: Vec<Checklist>,
}

fn name_issue(issues: &mut Issues, field: &str, name: &str, max: usize) {
    let n = name.trim().chars().count();
    if n == 0 {
        issues.add(field, "required");
    } else if n > max {
        issues.add(field, format!("must be at most {max} characters"));
    }
}

fn description(issues: &mut Issues, text: Option<String>) -> Option<String> {
    let text = opt_text(text);
    if text.as_ref().is_some_and(|t| t.chars().count() > MAX_DESCRIPTION_CHARS) {
        issues.add("description", format!("must be at most {MAX_DESCRIPTION_CHARS} characters"));
    }
    text
}

/// A uniqueness violation as a readable conflict.
fn unique(e: rusqlite::Error, what: &str) -> AppError {
    match AppError::from(e) {
        AppError::Conflict { .. } => AppError::Conflict { message: format!("{what} with this name already exists") },
        other => other,
    }
}

fn strategy_row(r: &Row) -> rusqlite::Result<Strategy> {
    Ok(Strategy {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        archived: r.get::<_, i64>(3)? == 1,
        review_count: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

const STRATEGY: &str = "SELECT s.id, s.name, s.description_md, s.is_archived,
        (SELECT count(*) FROM trade_reviews r WHERE r.strategy_id = s.id AND r.deleted_at IS NULL),
        s.created_at, s.updated_at
    FROM strategies s WHERE s.deleted_at IS NULL";

pub fn strategies(conn: &Connection) -> AppResult<Vec<Strategy>> {
    let mut stmt = conn.prepare(&format!("{STRATEGY} ORDER BY s.is_archived, s.name COLLATE NOCASE, s.id"))?;
    Ok(stmt.query_map([], strategy_row)?.collect::<rusqlite::Result<_>>()?)
}

pub fn strategy(conn: &Connection, id: &str) -> AppResult<Strategy> {
    conn.query_row(&format!("{STRATEGY} AND s.id = ?1"), [id], strategy_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("strategy", id))
}

pub fn save_strategy(conn: &mut Connection, id: Option<&str>, input: StrategyInput) -> AppResult<Strategy> {
    let mut issues = Issues::default();
    name_issue(&mut issues, "name", &input.name, MAX_NAME_CHARS);
    let description = description(&mut issues, input.description);
    issues.into_result()?;
    let name = input.name.trim();
    let now = now();
    let id = match id {
        Some(id) => {
            strategy(conn, id)?;
            conn.execute(
                "UPDATE strategies SET name = ?2, description_md = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, name, description, now],
            )
            .map_err(|e| unique(e, "a strategy"))?;
            id.to_string()
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO strategies (id, name, description_md, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, name, description, now],
            )
            .map_err(|e| unique(e, "a strategy"))?;
            id
        }
    };
    strategy(conn, &id)
}

fn tag_row(r: &Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        archived: r.get::<_, Option<String>>(3)?.is_some(),
        review_count: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

const TAG: &str = "SELECT t.id, t.name, t.kind, t.archived_at,
        (SELECT count(*) FROM trade_review_tags rt JOIN trade_reviews r ON r.id = rt.trade_review_id
         WHERE rt.tag_id = t.id AND r.deleted_at IS NULL),
        t.created_at, t.updated_at
    FROM tags t WHERE t.deleted_at IS NULL";

pub fn tags(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(&format!(
        "{TAG} ORDER BY t.archived_at IS NOT NULL, t.kind, t.name COLLATE NOCASE, t.id"
    ))?;
    Ok(stmt.query_map([], tag_row)?.collect::<rusqlite::Result<_>>()?)
}

pub fn tag(conn: &Connection, id: &str) -> AppResult<Tag> {
    conn.query_row(&format!("{TAG} AND t.id = ?1"), [id], tag_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("tag", id))
}

pub fn save_tag(conn: &mut Connection, id: Option<&str>, input: TagInput) -> AppResult<Tag> {
    let mut issues = Issues::default();
    name_issue(&mut issues, "name", &input.name, MAX_TAG_CHARS);
    if !TAG_KINDS.contains(&input.kind.as_str()) {
        issues.add("kind", "must be setup, mistake, emotion or general");
    }
    issues.into_result()?;
    let name = input.name.trim();
    let now = now();
    let id = match id {
        Some(id) => {
            tag(conn, id)?;
            conn.execute(
                "UPDATE tags SET name = ?2, kind = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, name, input.kind, now],
            )
            .map_err(|e| unique(e, "a tag of this kind"))?;
            id.to_string()
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO tags (id, name, kind, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, name, input.kind, now],
            )
            .map_err(|e| unique(e, "a tag of this kind"))?;
            id
        }
    };
    tag(conn, &id)
}

fn items(conn: &Connection, checklist_id: &str) -> AppResult<Vec<ChecklistItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, label, sort_order, is_archived FROM checklist_items
         WHERE checklist_id = ?1 AND deleted_at IS NULL ORDER BY is_archived, sort_order, id",
    )?;
    let rows = stmt.query_map([checklist_id], |r| {
        Ok(ChecklistItem { id: r.get(0)?, label: r.get(1)?, sort_order: r.get(2)?, archived: r.get::<_, i64>(3)? == 1 })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

const CHECKLIST: &str = "SELECT c.id, c.name, c.description_md, c.scope, c.strategy_id, c.is_archived,
        (SELECT count(*) FROM trade_reviews r WHERE r.checklist_id = c.id AND r.deleted_at IS NULL)
          + (SELECT count(*) FROM daily_reviews d WHERE d.checklist_id = c.id),
        c.created_at, c.updated_at
    FROM checklists c WHERE c.deleted_at IS NULL";

fn checklist_rows(conn: &Connection, sql: &str, args: &[&str]) -> AppResult<Vec<Checklist>> {
    let mut stmt = conn.prepare(sql)?;
    let heads = stmt
        .query_map(rusqlite::params_from_iter(args), |r| {
            Ok(Checklist {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                scope: r.get(3)?,
                strategy_id: r.get(4)?,
                archived: r.get::<_, i64>(5)? == 1,
                items: Vec::new(),
                review_count: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    heads.into_iter().map(|mut c| Ok({ c.items = items(conn, &c.id)?; c })).collect()
}

pub fn checklists(conn: &Connection) -> AppResult<Vec<Checklist>> {
    checklist_rows(conn, &format!("{CHECKLIST} ORDER BY c.is_archived, c.scope DESC, c.name COLLATE NOCASE, c.id"), &[])
}

pub fn checklist(conn: &Connection, id: &str) -> AppResult<Checklist> {
    checklist_rows(conn, &format!("{CHECKLIST} AND c.id = ?1"), &[id])?
        .pop()
        .ok_or_else(|| AppError::not_found("checklist", id))
}

/// Create or replace a checklist and its items in one transaction. Items keep
/// their ids when renamed, so past reviews still point at them; their past
/// answers keep the label they were given under.
pub fn save_checklist(conn: &mut Connection, id: Option<&str>, input: ChecklistInput) -> AppResult<Checklist> {
    let mut issues = Issues::default();
    name_issue(&mut issues, "name", &input.name, MAX_NAME_CHARS);
    let description = description(&mut issues, input.description);
    if !["trade", "daily"].contains(&input.scope.as_str()) {
        issues.add("scope", "must be trade or daily");
    }
    let strategy_id = opt_text(input.strategy_id);
    if strategy_id.is_some() && input.scope != "trade" {
        issues.add("strategyId", "only a trade checklist belongs to a strategy");
    }
    if input.items.len() > MAX_ITEMS {
        issues.add("items", format!("at most {MAX_ITEMS} items"));
    }
    for (i, item) in input.items.iter().enumerate() {
        name_issue(&mut issues, &format!("items.{i}.label"), &item.label, MAX_ITEM_CHARS);
    }
    let ids: Vec<&str> = input.items.iter().filter_map(|i| i.id.as_deref()).collect();
    if ids.iter().enumerate().any(|(i, a)| ids[..i].contains(a)) {
        issues.add("items", "an item is listed twice");
    }
    issues.into_result()?;
    if let Some(s) = &strategy_id {
        strategy(conn, s).map_err(|_| AppError::invalid("strategyId", "strategy not found"))?;
    }
    let tx = conn.transaction()?;
    let now = now();
    let id = match id {
        Some(id) => {
            let current = checklist(&tx, id)?;
            if current.scope != input.scope && current.review_count > 0 {
                return Err(AppError::invalid("scope", "a checklist that reviews use cannot change scope"));
            }
            tx.execute(
                "UPDATE checklists SET name = ?2, description_md = ?3, scope = ?4, strategy_id = ?5, updated_at = ?6
                 WHERE id = ?1",
                params![id, input.name.trim(), description, input.scope, strategy_id, now],
            )?;
            id.to_string()
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO checklists (id, name, description_md, scope, strategy_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, input.name.trim(), description, input.scope, strategy_id, now],
            )?;
            id
        }
    };
    let existing: Vec<String> = items(&tx, &id)?.into_iter().map(|i| i.id).collect();
    for (order, item) in input.items.iter().enumerate() {
        let label = item.label.trim();
        match &item.id {
            Some(item_id) if existing.contains(item_id) => {
                tx.execute(
                    "UPDATE checklist_items SET label = ?2, sort_order = ?3, is_archived = 0,
                            updated_at = CASE WHEN label = ?2 AND sort_order = ?3 AND is_archived = 0
                                              THEN updated_at ELSE ?4 END
                     WHERE id = ?1",
                    params![item_id, label, order as i64, now],
                )?;
            }
            Some(item_id) => return Err(AppError::invalid("items", format!("item '{item_id}' is not in this checklist"))),
            None => {
                tx.execute(
                    "INSERT INTO checklist_items (id, checklist_id, label, sort_order, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![new_id(), id, label, order as i64, now],
                )?;
            }
        }
    }
    for item_id in existing.iter().filter(|e| !ids.contains(&e.as_str())) {
        tx.execute(
            "UPDATE checklist_items SET is_archived = 1, updated_at = ?2 WHERE id = ?1 AND is_archived = 0",
            params![item_id, now],
        )?;
    }
    tx.commit()?;
    checklist(conn, &id)
}

/// Archive or bring back a strategy, tag or checklist. Archived entries stay on
/// the reviews that use them and cannot be chosen for new ones.
pub fn set_archived(conn: &mut Connection, input: ArchiveInput) -> AppResult<()> {
    let now = now();
    let n = match input.entity.as_str() {
        "strategy" => conn.execute(
            "UPDATE strategies SET is_archived = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
            params![input.id, input.archived as i64, now],
        )?,
        "checklist" => conn.execute(
            "UPDATE checklists SET is_archived = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
            params![input.id, input.archived as i64, now],
        )?,
        "tag" => conn.execute(
            "UPDATE tags SET archived_at = CASE WHEN ?2 THEN coalesce(archived_at, ?3) END, updated_at = ?3
             WHERE id = ?1 AND deleted_at IS NULL",
            params![input.id, input.archived, now],
        )?,
        _ => return Err(AppError::invalid("entity", "must be strategy, tag or checklist")),
    };
    if n == 0 {
        return Err(AppError::not_found(&input.entity, &input.id));
    }
    Ok(())
}

pub fn load(conn: &Connection) -> AppResult<Library> {
    Ok(Library { strategies: strategies(conn)?, tags: tags(conn)?, checklists: checklists(conn)? })
}
