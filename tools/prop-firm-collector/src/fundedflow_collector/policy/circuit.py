"""Host circuit breaker (research addendum §2).

`rate_limited` clears itself after a 24-hour cooldown. `blocked_bot_protection` and `access_denied` stay open
until the operator runs `collector host reenable`. A tripped host is never retried via another path, subdomain,
method or channel.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta

from fundedflow_collector.clock import format_instant, parse_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.policy_log import record_event
from fundedflow_collector.outcomes import CircuitState

RATE_LIMIT_COOLDOWN = timedelta(hours=24)


@dataclass(frozen=True)
class Circuit:
    host: str
    state: CircuitState
    reason: str | None
    tripped_at: str | None
    cooldown_until: str | None

    @property
    def open(self) -> bool:
        return self.state is not CircuitState.CLOSED


def current(conn: sqlite3.Connection, host: str, now: datetime, *, persist: bool = True) -> Circuit:
    row = conn.execute("SELECT * FROM host_circuits WHERE host = ?", (host,)).fetchone()
    if row is None:
        return Circuit(host, CircuitState.CLOSED, None, None, None)
    state = CircuitState(row["state"])
    if state is CircuitState.RATE_LIMITED and row["cooldown_until"] and parse_instant(row["cooldown_until"]) <= now:
        if not persist:
            return Circuit(host, CircuitState.CLOSED, None, row["tripped_at"], None)
        with transaction(conn):
            conn.execute(
                "UPDATE host_circuits SET state = 'closed', reason = NULL, cooldown_until = NULL, updated_at = ?"
                " WHERE host = ?",
                (format_instant(now), host),
            )
            record_event(conn, now=now, kind="circuit_expired", host=host, detail={"previous": state.value})
        return Circuit(host, CircuitState.CLOSED, None, row["tripped_at"], None)
    return Circuit(host, state, row["reason"], row["tripped_at"], row["cooldown_until"])


def trip(
    conn: sqlite3.Connection,
    host: str,
    state: CircuitState,
    reason: str,
    now: datetime,
    *,
    run_id: str | None,
    firm_id: str | None,
) -> Circuit:
    if state is CircuitState.CLOSED:
        raise ValueError("trip needs an open state")
    until = format_instant(now + RATE_LIMIT_COOLDOWN) if state is CircuitState.RATE_LIMITED else None
    stamp = format_instant(now)
    with transaction(conn):
        conn.execute(
            "INSERT INTO host_circuits (host, state, reason, tripped_at, cooldown_until, run_id, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (host) DO UPDATE SET state = excluded.state,"
            " reason = excluded.reason, tripped_at = excluded.tripped_at, cooldown_until = excluded.cooldown_until,"
            " run_id = excluded.run_id, updated_at = excluded.updated_at",
            (host, state.value, reason, stamp, until, run_id, stamp),
        )
        record_event(
            conn,
            now=now,
            kind="circuit_tripped",
            host=host,
            firm_id=firm_id,
            run_id=run_id,
            detail={"state": state.value, "reason": reason, "cooldown_until": until},
        )
    return Circuit(host, state, reason, stamp, until)


def reenable(conn: sqlite3.Connection, host: str, reason: str, now: datetime) -> Circuit:
    if not reason.strip():
        raise ValueError("a reason is required to re-enable a host")
    previous = current(conn, host, now)
    stamp = format_instant(now)
    with transaction(conn):
        conn.execute(
            "INSERT INTO host_circuits (host, state, updated_at) VALUES (?, 'closed', ?) ON CONFLICT (host) DO UPDATE"
            " SET state = 'closed', reason = NULL, cooldown_until = NULL, updated_at = excluded.updated_at",
            (host, stamp),
        )
        record_event(
            conn,
            now=now,
            kind="circuit_reenabled",
            host=host,
            detail={"previous": previous.state.value, "reason": reason},
        )
    return Circuit(host, CircuitState.CLOSED, None, previous.tripped_at, None)


def list_open(conn: sqlite3.Connection, now: datetime) -> list[Circuit]:
    hosts = [r["host"] for r in conn.execute("SELECT host FROM host_circuits WHERE state <> 'closed' ORDER BY host")]
    return [c for c in (current(conn, h, now) for h in hosts) if c.open]
