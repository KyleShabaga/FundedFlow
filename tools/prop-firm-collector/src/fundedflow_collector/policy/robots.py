"""robots.txt per RFC 9309 (research addendum §3), parsed with protego.

Status handling: 2xx -> parse and obey; 4xx except 429 -> "unavailable" (RFC 9309 allows access, and the terms
gate has already required a passing review); 429, 5xx, timeouts and network errors -> "unreachable", which is a
complete disallow. Cached for at most 24 hours. Group matching uses the product token `FundedFlowCollector`,
falling back to `*`. `Content-Signal` lines are recorded so later AI use downstream can respect them.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from protego import Protego

from fundedflow_collector import USER_AGENT_TOKEN
from fundedflow_collector.clock import format_instant, parse_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.policy_log import record_event

ROBOTS_MAX_BYTES = 500 * 1024
CACHE_TTL = timedelta(hours=24)
MAX_PATTERN_CHARS = 1024
MAX_PATTERN_WILDCARDS = 30
SLOW_MATCH_SECONDS = 2.0
_RULE_LINE = re.compile(r"^\s*(allow|disallow)\s*:\s*(.*)$", re.I)
_SIGNAL_LINE = re.compile(r"^\s*content-signal\s*:\s*(.+?)\s*$", re.I)


def filter_rules(body: str) -> tuple[str, list[str]]:
    """Drop pathological Allow/Disallow patterns (ReDoS guard). Returns the filtered body and warnings."""
    kept: list[str] = []
    warnings: list[str] = []
    for line in body.splitlines():
        match = _RULE_LINE.match(line)
        if match:
            pattern = match.group(2).split("#", 1)[0].strip()
            if len(pattern) > MAX_PATTERN_CHARS or pattern.count("*") > MAX_PATTERN_WILDCARDS:
                warnings.append(f"ignored an oversized robots.txt pattern ({len(pattern)} characters)")
                continue
        kept.append(line)
    return "\n".join(kept), warnings


def content_signals(body: str) -> list[str]:
    return [m.group(1) for line in body.splitlines() if (m := _SIGNAL_LINE.match(line))]


@dataclass
class RobotsRules:
    host: str
    status_class: str  # parsed | unavailable | unreachable
    http_status: int | None
    body: str | None
    fetched_at: str
    signals: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    too_slow: bool = False
    _parser: Any = None

    def _protego(self) -> Any:
        if self._parser is None:
            filtered, warns = filter_rules(self.body or "")
            self.warnings.extend(warns)
            self._parser = Protego.parse(filtered)
        return self._parser

    def allows(self, url: str) -> bool:
        if self.status_class == "unreachable" or self.too_slow:
            return False
        if self.status_class == "unavailable":
            return True
        started = time.perf_counter()
        allowed = bool(self._protego().can_fetch(url, USER_AGENT_TOKEN))
        if time.perf_counter() - started > SLOW_MATCH_SECONDS:
            self.too_slow = True  # treat the host as unreachable for the rest of the run
            return False
        return allowed

    def delay_seconds(self) -> float | None:
        """Crawl-delay or Request-rate interval for our group, whichever is stricter (non-standard but honoured)."""
        if self.status_class != "parsed":
            return None
        parser = self._protego()
        delays: list[float] = []
        crawl_delay = parser.crawl_delay(USER_AGENT_TOKEN)
        if crawl_delay is not None:
            delays.append(float(crawl_delay))
        rate = parser.request_rate(USER_AGENT_TOKEN)
        if rate is not None and rate.requests:
            delays.append(float(rate.seconds) / float(rate.requests))
        return min(max(delays), 600.0) if delays else None

    def sitemaps(self) -> list[str]:
        if self.status_class != "parsed":
            return []
        return [str(s) for s in self._protego().sitemaps]

    def describe(self) -> str:
        if self.status_class == "parsed":
            return f"robots.txt read (HTTP {self.http_status})"
        if self.status_class == "unavailable":
            return f"robots.txt unavailable (HTTP {self.http_status}); access allowed by RFC 9309"
        return f"robots.txt unreachable ({self.http_status or 'no response'}); treated as disallow-all"


def classify(status: int | None) -> str:
    if status is not None and 200 <= status <= 299:
        return "parsed"
    if status is not None and 400 <= status <= 499 and status != 429:
        return "unavailable"
    return "unreachable"


def cached(conn: sqlite3.Connection, host: str, now: datetime) -> RobotsRules | None:
    row = conn.execute("SELECT * FROM robots_cache WHERE host = ?", (host,)).fetchone()
    if row is None or now - parse_instant(row["fetched_at"]) > CACHE_TTL:
        return None
    return RobotsRules(
        host=host,
        status_class=row["status_class"],
        http_status=row["http_status"],
        body=row["body"],
        fetched_at=row["fetched_at"],
        signals=list(json.loads(row["content_signals"])),
    )


def store(
    conn: sqlite3.Connection,
    host: str,
    status: int | None,
    body: str | None,
    now: datetime,
    *,
    run_id: str | None,
    firm_id: str | None,
    persist: bool = True,
) -> RobotsRules:
    status_class = classify(status)
    text = body if status_class == "parsed" else None
    signals = content_signals(text or "")
    rules = RobotsRules(
        host=host,
        status_class=status_class,
        http_status=status,
        body=text,
        fetched_at=format_instant(now),
        signals=signals,
    )
    if persist:
        with transaction(conn):
            conn.execute(
                "INSERT INTO robots_cache (host, fetched_at, status_class, http_status, body, content_signals)"
                " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (host) DO UPDATE SET fetched_at = excluded.fetched_at,"
                " status_class = excluded.status_class, http_status = excluded.http_status, body = excluded.body,"
                " content_signals = excluded.content_signals",
                (host, rules.fetched_at, status_class, status, text, json.dumps(signals)),
            )
            record_event(
                conn,
                now=now,
                kind="robots_fetched",
                host=host,
                firm_id=firm_id,
                run_id=run_id,
                detail={"status_class": status_class, "http_status": status},
            )
            for signal in signals:
                record_event(
                    conn,
                    now=now,
                    kind="content_signal_seen",
                    host=host,
                    firm_id=firm_id,
                    run_id=run_id,
                    detail={"content_signal": signal},
                )
    return rules


def latest_signals(conn: sqlite3.Connection, host: str) -> list[str]:
    row = conn.execute("SELECT content_signals FROM robots_cache WHERE host = ?", (host,)).fetchone()
    return [] if row is None else list(json.loads(row["content_signals"]))


def unreachable(host: str, now: datetime, status: int | None = None) -> RobotsRules:
    return RobotsRules(
        host=host, status_class="unreachable", http_status=status, body=None, fetched_at=format_instant(now)
    )
