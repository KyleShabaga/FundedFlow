"""Append-only policy log: terms reviews, acknowledgements, circuit changes, robots fetches, content signals."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from fundedflow_collector import ids
from fundedflow_collector.clock import format_instant


def record_event(
    conn: sqlite3.Connection, *, now: datetime, kind: str, firm_id: str | None = None, host: str | None = None,
    detail: dict[str, Any] | None = None, run_id: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO policy_events (id, at, host, firm_id, kind, detail, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (ids.new_id("pev"), format_instant(now), host, firm_id, kind,
         json.dumps(detail or {}, sort_keys=True, ensure_ascii=False), run_id),
    )


def list_events(conn: sqlite3.Connection, host: str | None = None, limit: int = 50) -> list[sqlite3.Row]:
    if host is None:
        return list(conn.execute("SELECT * FROM policy_events ORDER BY at DESC, id LIMIT ?", (limit,)))
    return list(
        conn.execute("SELECT * FROM policy_events WHERE host = ? ORDER BY at DESC, id LIMIT ?", (host, limit))
    )
