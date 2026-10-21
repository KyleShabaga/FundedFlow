"""Crawl runs, append-only fetch attempts and discovered links (D4)."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from fundedflow_collector import __version__, ids
from fundedflow_collector.clock import format_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.outcomes import FetchMethod, Outcome


@dataclass
class AttemptRecord:
    firm_id: str
    requested_url: str
    fetch_method: FetchMethod
    started_at: str
    outcome: Outcome
    run_id: str | None = None
    source_id: str | None = None
    final_url: str | None = None
    redirect_chain: list[str] = field(default_factory=list)
    duration_ms: int | None = None
    resolved_ip: str | None = None
    conditional: bool = False
    http_status: int | None = None
    response_headers: dict[str, str] = field(default_factory=dict)
    bytes: int | None = None
    raw_sha256: str | None = None
    policy_reason: str | None = None
    error_detail: str | None = None
    parser_name: str | None = None
    parser_version: str | None = None
    snapshot_id: str | None = None
    id: str = field(default_factory=lambda: ids.new_id("att"))


def start_run(
    conn: sqlite3.Connection,
    *,
    firm_id: str,
    batch_id: str,
    command: str,
    now: datetime,
    options: dict[str, Any],
    config_sha256: str,
) -> str:
    run_id = ids.new_id("run")
    with transaction(conn):
        conn.execute(
            "INSERT INTO crawl_runs (id, batch_id, firm_id, command, started_at, status, options, config_sha256,"
            " collector_version) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)",
            (
                run_id,
                batch_id,
                firm_id,
                command,
                format_instant(now),
                json.dumps(options, sort_keys=True),
                config_sha256,
                __version__,
            ),
        )
    return run_id


def finish_run(conn: sqlite3.Connection, run_id: str, *, status: str, fetches_used: int, now: datetime) -> None:
    with transaction(conn):
        conn.execute(
            "UPDATE crawl_runs SET status = ?, fetches_used = ?, finished_at = ? WHERE id = ?",
            (status, fetches_used, format_instant(now), run_id),
        )


def insert_attempt(conn: sqlite3.Connection, a: AttemptRecord) -> None:
    """Insert one attempt row. Call inside a transaction."""
    conn.execute(
        "INSERT INTO fetch_attempts (id, run_id, firm_id, source_id, requested_url, final_url, redirect_chain,"
        " fetch_method, started_at, duration_ms, resolved_ip, conditional, http_status, response_headers, bytes,"
        " raw_sha256, outcome, policy_reason, error_detail, parser_name, parser_version, snapshot_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            a.id,
            a.run_id,
            a.firm_id,
            a.source_id,
            a.requested_url,
            a.final_url,
            json.dumps(a.redirect_chain),
            a.fetch_method.value,
            a.started_at,
            a.duration_ms,
            a.resolved_ip,
            int(a.conditional),
            a.http_status,
            json.dumps(a.response_headers, sort_keys=True),
            a.bytes,
            a.raw_sha256,
            a.outcome.value,
            a.policy_reason,
            a.error_detail,
            a.parser_name,
            a.parser_version,
            a.snapshot_id,
        ),
    )


def insert_discovered_link(
    conn: sqlite3.Connection,
    *,
    run_id: str,
    firm_id: str,
    url: str,
    via: str,
    depth: int,
    decision: str,
    now: datetime,
    relevance: int = 0,
    anchor_text: str | None = None,
    sitemap_lastmod: str | None = None,
    from_attempt_id: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO discovered_links (id, run_id, firm_id, url, via, from_attempt_id, anchor_text, sitemap_lastmod,"
        " depth, relevance, decision, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            ids.new_id("lnk"),
            run_id,
            firm_id,
            url,
            via,
            from_attempt_id,
            (anchor_text or "")[:300] or None,
            sitemap_lastmod,
            depth,
            relevance,
            decision,
            format_instant(now),
        ),
    )


def list_runs(conn: sqlite3.Connection, firm_id: str | None = None, limit: int = 20) -> list[sqlite3.Row]:
    sql = (
        "SELECT r.*, COALESCE(f.firm_key, 'publisher:' || p.publisher_key) AS firm_key,"
        " (SELECT COUNT(*) FROM fetch_attempts a WHERE a.run_id = r.id) AS attempt_count"
        " FROM crawl_runs r LEFT JOIN collector_firms f ON f.id = r.firm_id LEFT JOIN directory_publishers p ON p.id = r.firm_id"
    )
    if firm_id is not None:
        return list(conn.execute(sql + " WHERE r.firm_id = ? ORDER BY r.started_at DESC LIMIT ?", (firm_id, limit)))
    return list(conn.execute(sql + " ORDER BY r.started_at DESC LIMIT ?", (limit,)))


def get_run(conn: sqlite3.Connection, run_id: str) -> sqlite3.Row | None:
    return conn.execute(  # type: ignore[no-any-return]
        "SELECT r.*, COALESCE(f.firm_key, 'publisher:' || p.publisher_key) AS firm_key FROM crawl_runs r"
        " LEFT JOIN collector_firms f ON f.id = r.firm_id LEFT JOIN directory_publishers p ON p.id = r.firm_id WHERE r.id = ?",
        (run_id,),
    ).fetchone()


def list_attempts(conn: sqlite3.Connection, run_id: str) -> list[sqlite3.Row]:
    return list(conn.execute("SELECT * FROM fetch_attempts WHERE run_id = ? ORDER BY started_at, rowid", (run_id,)))


def outcome_counts(conn: sqlite3.Connection, run_id: str) -> dict[str, int]:
    rows = conn.execute(
        "SELECT outcome, COUNT(*) AS n FROM fetch_attempts WHERE run_id = ? GROUP BY outcome ORDER BY outcome",
        (run_id,),
    )
    return {r["outcome"]: int(r["n"]) for r in rows}
