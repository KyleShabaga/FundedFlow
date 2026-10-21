"""Immutable source snapshots, deduplication and optional raw-byte retention (D4)."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from fundedflow_collector import ids
from fundedflow_collector.clock import format_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.registry import Firm, Source, get_source, update_source_state
from fundedflow_collector.db.runs import AttemptRecord, insert_attempt
from fundedflow_collector.outcomes import FetchMethod, Outcome
from fundedflow_collector.parse.document import ParsedDocument
from fundedflow_collector.parse.hashing import NORMALIZATION_VERSION, content_hash


@dataclass
class EvidenceInput:
    """A successfully parsed document plus where it came from."""

    document: ParsedDocument
    requested_url: str
    final_url: str
    captured_at: str
    content_type: str
    fetch_method: FetchMethod
    source_channel: str
    http_status: int | None = None
    redirect_chain: list[str] = field(default_factory=list)
    raw_bytes: bytes | None = None
    raw_sha256: str | None = None
    platform_metadata: dict[str, Any] | None = None
    etag: str | None = None
    last_modified: str | None = None


def find_snapshot(conn: sqlite3.Connection, source_id: str, digest: str) -> sqlite3.Row | None:
    return conn.execute(  # type: ignore[no-any-return]
        "SELECT * FROM source_snapshots WHERE source_id = ? AND content_hash = ?", (source_id, digest)
    ).fetchone()


def get_snapshot(conn: sqlite3.Connection, snapshot_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM source_snapshots WHERE id = ?", (snapshot_id,)).fetchone()  # type: ignore[no-any-return]


def list_snapshots(
    conn: sqlite3.Connection,
    firm_id: str | None = None,
    url: str | None = None,
    limit: int = 50,
) -> list[sqlite3.Row]:
    sql = (
        "SELECT s.id, s.captured_at, s.title, s.content_hash, s.fetch_method, s.content_type, s.final_url,"
        " s.warnings, c.canonical_url, f.firm_key, length(s.text) AS text_chars"
        " FROM source_snapshots s JOIN collector_sources c ON c.id = s.source_id"
        " JOIN collector_firms f ON f.id = s.firm_id"
    )
    clauses: list[str] = []
    params: list[object] = []
    if firm_id is not None:
        clauses.append("s.firm_id = ?")
        params.append(firm_id)
    if url is not None:
        clauses.append("c.canonical_url = ?")
        params.append(url)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY s.captured_at DESC, s.id LIMIT ?"
    params.append(limit)
    return list(conn.execute(sql, params))


def store_evidence(
    conn: sqlite3.Connection,
    *,
    firm: Firm,
    source: Source,
    attempt: AttemptRecord,
    evidence: EvidenceInput,
    now: datetime,
    retain_raw: bool = False,
    raw_retention_days: int = 90,
) -> tuple[Outcome, str]:
    """Record an attempt that produced a document, creating a snapshot only for content not seen before.

    Returns (outcome, snapshot_id). Same content as the latest snapshot -> `unchanged`; same as an earlier one ->
    `matched_earlier_snapshot`; otherwise a new immutable snapshot -> `new_snapshot`. One transaction.
    """
    doc = evidence.document
    digest = content_hash(doc)
    source = get_source(conn, source.id) or source
    previous_raw = _latest_raw_sha(conn, source)
    with transaction(conn):
        existing = find_snapshot(conn, source.id, digest)
        if existing is not None:
            sid = str(existing["id"])
            outcome = Outcome.UNCHANGED if source.latest_snapshot_id == sid else Outcome.MATCHED_EARLIER_SNAPSHOT
        else:
            sid = ids.snapshot_id(firm.firm_key, source.canonical_url, digest)
            warnings = list(doc.warnings)
            if previous_raw is not None and evidence.raw_sha256 == previous_raw and source.latest_snapshot_id:
                warnings.append("normalization_changed")
            conn.execute(
                "INSERT INTO source_snapshots (id, source_id, firm_id, content_hash, normalization_version,"
                " captured_at, first_attempt_id, requested_url, final_url, redirect_chain, http_status, title,"
                " text, structure, content_type, fetch_method, source_channel, parser_name, parser_version,"
                " warnings, raw_sha256, platform_metadata)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    sid,
                    source.id,
                    firm.id,
                    digest,
                    NORMALIZATION_VERSION,
                    evidence.captured_at,
                    attempt.id,
                    evidence.requested_url,
                    evidence.final_url,
                    json.dumps(evidence.redirect_chain),
                    evidence.http_status,
                    doc.title,
                    doc.text,
                    json.dumps(doc.structure(), ensure_ascii=False, sort_keys=True),
                    evidence.content_type,
                    evidence.fetch_method.value,
                    evidence.source_channel,
                    doc.parser_name,
                    doc.parser_version,
                    json.dumps(sorted(set(warnings))),
                    evidence.raw_sha256,
                    json.dumps(evidence.platform_metadata, sort_keys=True) if evidence.platform_metadata else None,
                ),
            )
            outcome = Outcome.NEW_SNAPSHOT
        attempt.outcome = outcome
        attempt.snapshot_id = sid
        attempt.parser_name = doc.parser_name
        attempt.parser_version = doc.parser_version
        insert_attempt(conn, attempt)
        state: dict[str, object] = {
            "last_attempt_at": attempt.started_at,
            "last_success_at": attempt.started_at,
            "last_outcome": outcome.value,
            "latest_snapshot_id": sid,
        }
        if evidence.fetch_method is not FetchMethod.MANUAL_CAPTURE:
            state["etag"] = evidence.etag
            state["last_modified"] = evidence.last_modified
        update_source_state(conn, source.id, now, **state)
        if retain_raw and evidence.raw_bytes is not None and evidence.raw_sha256 is not None:
            conn.execute(
                "INSERT OR IGNORE INTO raw_payloads (sha256, bytes, content_type, stored_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    evidence.raw_sha256,
                    evidence.raw_bytes,
                    evidence.content_type,
                    format_instant(now),
                    format_instant(now + timedelta(days=raw_retention_days)),
                ),
            )
    return outcome, sid


def _latest_raw_sha(conn: sqlite3.Connection, source: Source) -> str | None:
    if source.latest_snapshot_id is None:
        return None
    row = conn.execute("SELECT raw_sha256 FROM source_snapshots WHERE id = ?", (source.latest_snapshot_id,)).fetchone()
    return None if row is None else row["raw_sha256"]


def record_unchanged(
    conn: sqlite3.Connection,
    *,
    source: Source,
    attempt: AttemptRecord,
    now: datetime,
) -> None:
    """A 304 Not Modified: record the attempt against the latest snapshot without a body."""
    with transaction(conn):
        attempt.outcome = Outcome.UNCHANGED
        attempt.snapshot_id = source.latest_snapshot_id
        insert_attempt(conn, attempt)
        update_source_state(
            conn,
            source.id,
            now,
            last_attempt_at=attempt.started_at,
            last_success_at=attempt.started_at,
            last_outcome=Outcome.UNCHANGED.value,
        )


def record_failure(
    conn: sqlite3.Connection,
    *,
    attempt: AttemptRecord,
    now: datetime,
    source: Source | None = None,
) -> None:
    """Record a blocked or failed attempt. Existing snapshots are never touched."""
    with transaction(conn):
        insert_attempt(conn, attempt)
        if source is not None:
            update_source_state(
                conn, source.id, now, last_attempt_at=attempt.started_at, last_outcome=attempt.outcome.value
            )


def observations(conn: sqlite3.Connection, snapshot_id: str) -> tuple[str | None, str | None, int]:
    row = conn.execute(
        "SELECT MIN(started_at) AS first, MAX(started_at) AS last, COUNT(*) AS n FROM fetch_attempts"
        " WHERE snapshot_id = ?",
        (snapshot_id,),
    ).fetchone()
    return row["first"], row["last"], int(row["n"])


def prune_raw(conn: sqlite3.Connection, now: datetime) -> int:
    with transaction(conn):
        cur = conn.execute("DELETE FROM raw_payloads WHERE expires_at <= ?", (format_instant(now),))
    return cur.rowcount
