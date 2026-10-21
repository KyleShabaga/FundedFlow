"""Firm, publisher, host and source registry (D2). Operators add, list, update and disable; nothing is deleted.

Two kinds of registry entry own hosts, sources, runs and snapshots (a "collection owner"): prop firms
(`collector_firms`, first-party sources) and comparison publishers (`directory_publishers`, third-party directory
sites, Build 29.25). A host belongs to one kind only, so a publisher can never be authorised under a firm.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fundedflow_collector import ids
from fundedflow_collector.clock import format_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.policy_log import record_event
from fundedflow_collector.outcomes import HostRole, SourceChannel, SourceKind, TermsDecision
from fundedflow_collector.policy.urls import UrlRejected, canonicalize, host_of, matches_excluded, normalise_host

FIRM_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
CAPTURE_MODES = ("auto", "manual_only")


class RegistryError(ValueError):
    pass


@dataclass(frozen=True)
class Firm:
    id: str
    firm_key: str
    display_name: str
    homepage_url: str
    enabled: bool
    disabled_reason: str | None
    max_fetches: int | None
    max_depth: int | None
    excluded_paths: list[str]
    created_at: str
    updated_at: str

    @property
    def owner_key(self) -> str:
        """The key that namespaces this owner's source and snapshot ids (unchanged from Build 29)."""
        return self.firm_key

    @property
    def owner_kind(self) -> str:
        return "firm"


@dataclass(frozen=True)
class Publisher:
    """A third-party comparison/directory publisher. Never a prop firm, never a first-party rule source."""

    id: str
    publisher_key: str
    display_name: str
    homepage_url: str
    adapter: str
    capture_mode: str  # auto | manual_only
    enabled: bool
    disabled_reason: str | None
    max_fetches: int | None
    max_depth: int | None
    allowed_paths: list[str]
    excluded_paths: list[str]
    notes: str | None
    policy_review: dict[str, Any]
    preset_version: str | None
    created_at: str
    updated_at: str

    @property
    def owner_key(self) -> str:
        """Publisher ids live in their own namespace, so they can never collide with a firm's."""
        return f"publisher:{self.publisher_key}"

    @property
    def owner_kind(self) -> str:
        return "publisher"


Owner = Firm | Publisher


@dataclass(frozen=True)
class Host:
    id: str
    firm_id: str
    host: str
    role: HostRole
    terms_url: str | None
    terms_decision: TermsDecision | None
    terms_reviewed_at: str | None
    terms_notes: str | None
    terms_min_delay_seconds: float | None
    unclear_terms_accepted_at: str | None


@dataclass(frozen=True)
class Source:
    id: str
    firm_id: str
    canonical_url: str
    kind: SourceKind
    source_channel: SourceChannel
    requires_js: bool
    js_disabled: bool
    enabled: bool
    priority: int
    label: str | None
    etag: str | None
    last_modified: str | None
    sitemap_lastmod: str | None
    last_attempt_at: str | None
    last_success_at: str | None
    last_outcome: str | None
    latest_snapshot_id: str | None
    zendesk_cursor: int | None


def _firm(row: sqlite3.Row) -> Firm:
    return Firm(
        id=row["id"],
        firm_key=row["firm_key"],
        display_name=row["display_name"],
        homepage_url=row["homepage_url"],
        enabled=bool(row["enabled"]),
        disabled_reason=row["disabled_reason"],
        max_fetches=row["max_fetches"],
        max_depth=row["max_depth"],
        excluded_paths=list(json.loads(row["excluded_paths"])),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _host(row: sqlite3.Row) -> Host:
    return Host(
        id=row["id"],
        firm_id=row["firm_id"],
        host=row["host"],
        role=HostRole(row["role"]),
        terms_url=row["terms_url"],
        terms_decision=TermsDecision(row["terms_decision"]) if row["terms_decision"] else None,
        terms_reviewed_at=row["terms_reviewed_at"],
        terms_notes=row["terms_notes"],
        terms_min_delay_seconds=row["terms_min_delay_seconds"],
        unclear_terms_accepted_at=row["unclear_terms_accepted_at"],
    )


def _source(row: sqlite3.Row) -> Source:
    return Source(
        id=row["id"],
        firm_id=row["firm_id"],
        canonical_url=row["canonical_url"],
        kind=SourceKind(row["kind"]),
        source_channel=SourceChannel(row["source_channel"]),
        requires_js=bool(row["requires_js"]),
        js_disabled=bool(row["js_disabled"]),
        enabled=bool(row["enabled"]),
        priority=row["priority"],
        label=row["label"],
        etag=row["etag"],
        last_modified=row["last_modified"],
        sitemap_lastmod=row["sitemap_lastmod"],
        last_attempt_at=row["last_attempt_at"],
        last_success_at=row["last_success_at"],
        last_outcome=row["last_outcome"],
        latest_snapshot_id=row["latest_snapshot_id"],
        zendesk_cursor=row["zendesk_cursor"],
    )


def _check_url(url: str, what: str) -> str:
    try:
        return canonicalize(url)
    except UrlRejected as exc:
        raise RegistryError(f"{what}: {exc}") from exc


def _check_patterns(patterns: list[str]) -> list[str]:
    for pattern in patterns:
        if not pattern.startswith("/") or len(pattern) > 300:
            raise RegistryError(f"excluded path {pattern!r} must start with '/' and be at most 300 characters")
    return sorted(set(patterns))


# ---------------------------------------------------------------- firms


def add_firm(
    conn: sqlite3.Connection,
    *,
    firm_key: str,
    display_name: str,
    homepage_url: str,
    now: datetime,
    max_fetches: int | None = None,
    max_depth: int | None = None,
    excluded_paths: list[str] | None = None,
) -> Firm:
    if not FIRM_KEY.match(firm_key):
        raise RegistryError("firm key must be 2-64 characters: lowercase letters, digits and hyphens")
    if not display_name.strip() or len(display_name) > 200:
        raise RegistryError("display name must be 1-200 characters")
    homepage = _check_url(homepage_url, "homepage")
    _check_limits(max_fetches, max_depth)
    if get_firm(conn, firm_key) is not None:
        raise RegistryError(f"firm {firm_key!r} already exists")
    stamp = format_instant(now)
    with transaction(conn):
        conn.execute(
            "INSERT INTO collector_firms (id, firm_key, display_name, homepage_url, max_fetches, max_depth,"
            " excluded_paths, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                ids.new_id("firm"),
                firm_key,
                display_name.strip(),
                homepage,
                max_fetches,
                max_depth,
                json.dumps(_check_patterns(excluded_paths or [])),
                stamp,
                stamp,
            ),
        )
    firm = get_firm(conn, firm_key)
    assert firm is not None
    return firm


def _check_limits(max_fetches: int | None, max_depth: int | None) -> None:
    if max_fetches is not None and not 1 <= max_fetches <= 300:
        raise RegistryError("max fetches must be between 1 and 300")
    if max_depth is not None and not 0 <= max_depth <= 5:
        raise RegistryError("max depth must be between 0 and 5")


def get_firm(conn: sqlite3.Connection, firm_key: str) -> Firm | None:
    row = conn.execute("SELECT * FROM collector_firms WHERE firm_key = ?", (firm_key,)).fetchone()
    return _firm(row) if row else None


def get_firm_by_id(conn: sqlite3.Connection, firm_id: str) -> Firm:
    row = conn.execute("SELECT * FROM collector_firms WHERE id = ?", (firm_id,)).fetchone()
    if row is None:
        raise RegistryError(f"unknown firm id {firm_id}")
    return _firm(row)


def require_firm(conn: sqlite3.Connection, firm_key: str) -> Firm:
    firm = get_firm(conn, firm_key)
    if firm is None:
        raise RegistryError(f"unknown firm {firm_key!r}; see `collector firm list`")
    return firm


def list_firms(conn: sqlite3.Connection) -> list[Firm]:
    return [_firm(r) for r in conn.execute("SELECT * FROM collector_firms ORDER BY firm_key")]


def update_firm(
    conn: sqlite3.Connection,
    firm: Firm,
    *,
    now: datetime,
    display_name: str | None = None,
    homepage_url: str | None = None,
    max_fetches: int | None = None,
    max_depth: int | None = None,
    excluded_paths: list[str] | None = None,
    clear_limits: bool = False,
) -> Firm:
    _check_limits(max_fetches, max_depth)
    name = display_name.strip() if display_name is not None else firm.display_name
    if not name or len(name) > 200:
        raise RegistryError("display name must be 1-200 characters")
    homepage = _check_url(homepage_url, "homepage") if homepage_url is not None else firm.homepage_url
    fetches = None if clear_limits else (max_fetches if max_fetches is not None else firm.max_fetches)
    depth = None if clear_limits else (max_depth if max_depth is not None else firm.max_depth)
    patterns = _check_patterns(excluded_paths) if excluded_paths is not None else firm.excluded_paths
    with transaction(conn):
        conn.execute(
            "UPDATE collector_firms SET display_name = ?, homepage_url = ?, max_fetches = ?, max_depth = ?,"
            " excluded_paths = ?, updated_at = ? WHERE id = ?",
            (name, homepage, fetches, depth, json.dumps(patterns), format_instant(now), firm.id),
        )
    return require_firm(conn, firm.firm_key)


def set_firm_enabled(conn: sqlite3.Connection, firm: Firm, enabled: bool, reason: str | None, now: datetime) -> Firm:
    if not enabled and not (reason and reason.strip()):
        raise RegistryError("a reason is required to disable a firm")
    with transaction(conn):
        conn.execute(
            "UPDATE collector_firms SET enabled = ?, disabled_reason = ?, updated_at = ? WHERE id = ?",
            (int(enabled), None if enabled else reason, format_instant(now), firm.id),
        )
        record_event(
            conn,
            now=now,
            kind="firm_enabled" if enabled else "firm_disabled",
            firm_id=firm.id,
            detail={"reason": reason},
        )
    return require_firm(conn, firm.firm_key)


# ---------------------------------------------------------------- comparison publishers (Build 29.25)

PUBLISHER_HOST_ROLES = (HostRole.HOMEPAGE, HostRole.DOCS, HostRole.ASSET)


def _publisher(row: sqlite3.Row) -> Publisher:
    return Publisher(
        id=row["id"],
        publisher_key=row["publisher_key"],
        display_name=row["display_name"],
        homepage_url=row["homepage_url"],
        adapter=row["adapter"],
        capture_mode=row["capture_mode"],
        enabled=bool(row["enabled"]),
        disabled_reason=row["disabled_reason"],
        max_fetches=row["max_fetches"],
        max_depth=row["max_depth"],
        allowed_paths=list(json.loads(row["allowed_paths"])),
        excluded_paths=list(json.loads(row["excluded_paths"])),
        notes=row["notes"],
        policy_review=dict(json.loads(row["policy_review"])),
        preset_version=row["preset_version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def base_domain(host: str) -> str:
    """The publisher's own domain: its homepage host without a leading `www.`."""
    return host[4:] if host.startswith("www.") else host


def _check_publisher_host(publisher: Publisher, host: str, role: HostRole) -> None:
    if role not in PUBLISHER_HOST_ROLES:
        raise RegistryError("a publisher host's role is homepage, docs or asset")
    domain = base_domain(host_of(publisher.homepage_url))
    if role is not HostRole.ASSET and host != domain and not host.endswith("." + domain):
        raise RegistryError(
            f"{host} is not part of {publisher.display_name}'s own site ({domain}). Links to prop firms or affiliate "
            "redirects are never authorised through a publisher; register a firm's own site as a firm instead"
        )


def path_outside_scope(publisher: Publisher, url: str) -> str | None:
    """Why a URL is outside a publisher's configured paths, or None when it is inside them."""
    pattern = matches_excluded(url, publisher.excluded_paths)
    if pattern is not None:
        return f"matches excluded pattern {pattern}"
    if publisher.allowed_paths and matches_excluded(url, publisher.allowed_paths) is None:
        return "outside the publisher's allowed paths"
    return None


def _check_publisher_path(publisher: Publisher, url: str) -> None:
    reason = path_outside_scope(publisher, url)
    if reason is not None:
        raise RegistryError(f"{url} {reason}")


def add_publisher(
    conn: sqlite3.Connection,
    *,
    publisher_key: str,
    display_name: str,
    homepage_url: str,
    adapter: str,
    now: datetime,
    capture_mode: str = "auto",
    allowed_paths: list[str] | None = None,
    excluded_paths: list[str] | None = None,
    max_fetches: int | None = None,
    max_depth: int | None = None,
    notes: str | None = None,
    policy_review: dict[str, Any] | None = None,
    preset_version: str | None = None,
) -> Publisher:
    """Register a publisher. It starts disabled: live collection needs a terms review and an explicit enable."""
    if not FIRM_KEY.match(publisher_key):
        raise RegistryError("publisher key must be 2-64 characters: lowercase letters, digits and hyphens")
    if not display_name.strip() or len(display_name) > 200:
        raise RegistryError("display name must be 1-200 characters")
    if capture_mode not in CAPTURE_MODES:
        raise RegistryError("capture mode is auto or manual_only")
    homepage = _check_url(homepage_url, "homepage")
    _check_limits(max_fetches, max_depth)
    if get_publisher(conn, publisher_key) is not None:
        raise RegistryError(f"publisher {publisher_key!r} already exists")
    if get_firm(conn, publisher_key) is not None:
        raise RegistryError(f"{publisher_key!r} is already a firm key; publishers and firms use different keys")
    stamp = format_instant(now)
    pid = ids.new_id("pub")
    reason = "manual capture only" if capture_mode == "manual_only" else "not reviewed yet"
    with transaction(conn):
        conn.execute("INSERT INTO collection_owners (id, kind, created_at) VALUES (?, 'publisher', ?)", (pid, stamp))
        conn.execute(
            "INSERT INTO directory_publishers (id, publisher_key, display_name, homepage_url, adapter, capture_mode,"
            " enabled, disabled_reason, max_fetches, max_depth, allowed_paths, excluded_paths, notes, policy_review,"
            " preset_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                pid,
                publisher_key,
                display_name.strip(),
                homepage,
                adapter,
                capture_mode,
                reason,
                max_fetches,
                max_depth,
                json.dumps(_check_patterns(allowed_paths or [])),
                json.dumps(_check_patterns(excluded_paths or [])),
                notes,
                json.dumps(policy_review or {}, sort_keys=True, ensure_ascii=False),
                preset_version,
                stamp,
                stamp,
            ),
        )
        record_event(
            conn,
            now=now,
            kind="publisher_added",
            firm_id=pid,
            detail={"publisher_key": publisher_key, "adapter": adapter, "capture_mode": capture_mode},
        )
    return require_publisher(conn, publisher_key)


def get_publisher(conn: sqlite3.Connection, publisher_key: str) -> Publisher | None:
    row = conn.execute("SELECT * FROM directory_publishers WHERE publisher_key = ?", (publisher_key,)).fetchone()
    return _publisher(row) if row else None


def get_publisher_by_id(conn: sqlite3.Connection, publisher_id: str) -> Publisher | None:
    row = conn.execute("SELECT * FROM directory_publishers WHERE id = ?", (publisher_id,)).fetchone()
    return _publisher(row) if row else None


def require_publisher(conn: sqlite3.Connection, publisher_key: str) -> Publisher:
    found = get_publisher(conn, publisher_key)
    if found is None:
        raise RegistryError(f"unknown publisher {publisher_key!r}; see `collector directory list`")
    return found


def list_publishers(conn: sqlite3.Connection) -> list[Publisher]:
    return [_publisher(r) for r in conn.execute("SELECT * FROM directory_publishers ORDER BY publisher_key")]


def update_publisher(
    conn: sqlite3.Connection,
    publisher: Publisher,
    *,
    now: datetime,
    display_name: str | None = None,
    allowed_paths: list[str] | None = None,
    excluded_paths: list[str] | None = None,
    max_fetches: int | None = None,
    max_depth: int | None = None,
    notes: str | None = None,
    capture_mode: str | None = None,
    policy_review: dict[str, Any] | None = None,
) -> Publisher:
    """Change a publisher's settings. Switching to manual_only also turns live collection off."""
    _check_limits(max_fetches, max_depth)
    name = display_name.strip() if display_name is not None else publisher.display_name
    if not name or len(name) > 200:
        raise RegistryError("display name must be 1-200 characters")
    mode = capture_mode or publisher.capture_mode
    if mode not in CAPTURE_MODES:
        raise RegistryError("capture mode is auto or manual_only")
    enabled = publisher.enabled and mode == "auto"
    reason = None if enabled else (publisher.disabled_reason or "manual capture only")
    if publisher.enabled and not enabled:
        reason = "manual capture only"
    allowed = _check_patterns(allowed_paths) if allowed_paths is not None else publisher.allowed_paths
    excluded = _check_patterns(excluded_paths) if excluded_paths is not None else publisher.excluded_paths
    review = policy_review if policy_review is not None else publisher.policy_review
    values: dict[str, object] = {
        "display_name": name,
        "allowed_paths": json.dumps(allowed),
        "excluded_paths": json.dumps(excluded),
        "max_fetches": max_fetches if max_fetches is not None else publisher.max_fetches,
        "max_depth": max_depth if max_depth is not None else publisher.max_depth,
        "notes": notes if notes is not None else publisher.notes,
        "capture_mode": mode,
        "enabled": int(enabled),
        "disabled_reason": reason,
    }
    with transaction(conn):
        conn.execute(
            "UPDATE directory_publishers SET display_name = :display_name, allowed_paths = :allowed_paths,"
            " excluded_paths = :excluded_paths, max_fetches = :max_fetches, max_depth = :max_depth, notes = :notes,"
            " capture_mode = :capture_mode, enabled = :enabled, disabled_reason = :disabled_reason,"
            " policy_review = :policy_review, updated_at = :updated_at WHERE id = :id",
            {
                **values,
                "policy_review": json.dumps(review, sort_keys=True, ensure_ascii=False),
                "updated_at": format_instant(now),
                "id": publisher.id,
            },
        )
        record_event(conn, now=now, kind="publisher_updated", firm_id=publisher.id, detail=values)
    return require_publisher(conn, publisher.publisher_key)


def set_publisher_enabled(
    conn: sqlite3.Connection, publisher: Publisher, enabled: bool, reason: str | None, now: datetime
) -> Publisher:
    """Enable or disable live collection. Enabling needs a recorded terms review for every document host."""
    if enabled:
        if publisher.capture_mode != "auto":
            raise RegistryError(
                f"{publisher.publisher_key} is manual capture only; change its capture mode to auto first, and only "
                "if the publisher's policy now allows automated access"
            )
        hosts = [h for h in list_hosts(conn, publisher.id) if h.role is not HostRole.ASSET]
        if not hosts:
            raise RegistryError(f"{publisher.publisher_key} has no hosts yet")
        missing = [h.host for h in hosts if h.terms_decision is None]
        if missing:
            raise RegistryError(f"record a terms review for {', '.join(missing)} before enabling")
    elif not (reason and reason.strip()):
        raise RegistryError("a reason is required to disable a publisher")
    with transaction(conn):
        conn.execute(
            "UPDATE directory_publishers SET enabled = ?, disabled_reason = ?, updated_at = ? WHERE id = ?",
            (int(enabled), None if enabled else reason, format_instant(now), publisher.id),
        )
        record_event(
            conn,
            now=now,
            kind="publisher_enabled" if enabled else "publisher_disabled",
            firm_id=publisher.id,
            detail={"reason": reason},
        )
    return require_publisher(conn, publisher.publisher_key)


def owner_by_id(conn: sqlite3.Connection, owner_id: str) -> Owner:
    publisher = get_publisher_by_id(conn, owner_id)
    return publisher if publisher is not None else get_firm_by_id(conn, owner_id)


# ---------------------------------------------------------------- hosts


def add_host(conn: sqlite3.Connection, firm: Owner, host: str, role: HostRole, now: datetime) -> Host:
    try:
        name = normalise_host(host)
    except UrlRejected as exc:
        raise RegistryError(str(exc)) from exc
    if get_host(conn, firm.id, name) is not None:
        raise RegistryError(f"host {name} is already registered for {firm.owner_key}")
    other = conn.execute(
        "SELECT o.kind FROM collector_hosts h JOIN collection_owners o ON o.id = h.firm_id WHERE h.host = ?"
        " AND o.kind <> ?",
        (name, firm.owner_kind),
    ).fetchone()
    if other is not None:
        raise RegistryError(
            f"{name} is already registered as a {other['kind']} host; a prop firm's own site and a comparison "
            "publisher's site are kept apart, so one host cannot be both"
        )
    if isinstance(firm, Publisher):
        _check_publisher_host(firm, name, role)
    stamp = format_instant(now)
    with transaction(conn):
        conn.execute(
            "INSERT INTO collector_hosts (id, firm_id, host, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (ids.new_id("host"), firm.id, name, role.value, stamp, stamp),
        )
        record_event(conn, now=now, kind="host_added", firm_id=firm.id, host=name, detail={"role": role.value})
    result = get_host(conn, firm.id, name)
    assert result is not None
    return result


def get_host(conn: sqlite3.Connection, firm_id: str, host: str) -> Host | None:
    row = conn.execute("SELECT * FROM collector_hosts WHERE firm_id = ? AND host = ?", (firm_id, host)).fetchone()
    return _host(row) if row else None


def require_host(conn: sqlite3.Connection, firm: Owner, host: str) -> Host:
    try:
        name = normalise_host(host)
    except UrlRejected as exc:
        raise RegistryError(str(exc)) from exc
    found = get_host(conn, firm.id, name)
    if found is None:
        raise RegistryError(f"host {name} is not registered for {firm.owner_key}; add it with `collector host add`")
    return found


def list_hosts(conn: sqlite3.Connection, firm_id: str | None = None) -> list[Host]:
    if firm_id is None:
        rows = conn.execute(
            "SELECT h.* FROM collector_hosts h JOIN collector_firms f ON f.id = h.firm_id ORDER BY f.firm_key, h.host"
        )
    else:
        rows = conn.execute("SELECT * FROM collector_hosts WHERE firm_id = ? ORDER BY host", (firm_id,))
    return [_host(r) for r in rows]


def record_terms(
    conn: sqlite3.Connection,
    firm: Owner,
    host: Host,
    *,
    decision: TermsDecision,
    terms_url: str,
    now: datetime,
    notes: str | None = None,
    min_delay_seconds: float | None = None,
    accept_unclear: bool = False,
) -> Host:
    """Record the operator's terms review. The collector never makes this decision itself."""
    url = _check_url(terms_url, "terms URL")
    if min_delay_seconds is not None and min_delay_seconds < 1.0:
        raise RegistryError("--min-delay must be at least 1 second")
    if accept_unclear and decision is not TermsDecision.UNCLEAR:
        raise RegistryError("--accept-unclear-terms only applies to --decision unclear")
    stamp = format_instant(now)
    accepted = stamp if accept_unclear else None
    with transaction(conn):
        conn.execute(
            "UPDATE collector_hosts SET terms_url = ?, terms_decision = ?, terms_reviewed_at = ?, terms_notes = ?,"
            " terms_min_delay_seconds = ?, unclear_terms_accepted_at = ?, updated_at = ? WHERE id = ?",
            (url, decision.value, stamp, notes, min_delay_seconds, accepted, stamp, host.id),
        )
        record_event(
            conn,
            now=now,
            kind="terms_recorded",
            firm_id=firm.id,
            host=host.host,
            detail={
                "decision": decision.value,
                "terms_url": url,
                "notes": notes,
                "min_delay_seconds": min_delay_seconds,
            },
        )
        if accept_unclear:
            record_event(
                conn,
                now=now,
                kind="unclear_terms_accepted",
                firm_id=firm.id,
                host=host.host,
                detail={"accepted_at": stamp},
            )
    result = get_host(conn, firm.id, host.host)
    assert result is not None
    return result


# ---------------------------------------------------------------- sources


def add_source(
    conn: sqlite3.Connection,
    firm: Owner,
    *,
    url: str,
    kind: SourceKind,
    now: datetime,
    channel: SourceChannel = SourceChannel.SEED,
    requires_js: bool = False,
    js_disabled: bool = False,
    label: str | None = None,
    priority: int = 0,
) -> Source:
    canonical = _check_url(url, "source URL")
    if requires_js and js_disabled:
        raise RegistryError("--requires-js and --no-js cannot both be set")
    if not -100 <= priority <= 100:
        raise RegistryError("priority must be between -100 and 100")
    host = host_of(canonical)
    registered = get_host(conn, firm.id, host)
    if registered is None or registered.role is HostRole.ASSET:
        raise RegistryError(f"host {host} is not an authorised document host for {firm.owner_key}")
    if isinstance(firm, Publisher):
        _check_publisher_path(firm, canonical)
    if kind is SourceKind.ZENDESK and "/hc/" not in canonical:
        raise RegistryError("a zendesk source URL looks like https://help.example.com/hc/en-us")
    sid = ids.source_id(firm.owner_key, canonical)
    if get_source(conn, sid) is not None:
        raise RegistryError(f"source {canonical} already exists ({sid})")
    stamp = format_instant(now)
    with transaction(conn):
        conn.execute(
            "INSERT INTO collector_sources (id, firm_id, canonical_url, kind, source_channel, requires_js, js_disabled,"
            " priority, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                sid,
                firm.id,
                canonical,
                kind.value,
                channel.value,
                int(requires_js),
                int(js_disabled),
                priority,
                label,
                stamp,
                stamp,
            ),
        )
    result = get_source(conn, sid)
    assert result is not None
    return result


def ensure_source(
    conn: sqlite3.Connection,
    firm: Owner,
    canonical_url: str,
    kind: SourceKind,
    channel: SourceChannel,
    now: datetime,
) -> Source:
    """Get or create a source row for a discovered URL. Must be called inside a transaction."""
    sid = ids.source_id(firm.owner_key, canonical_url)
    existing = get_source(conn, sid)
    if existing is not None:
        return existing
    stamp = format_instant(now)
    conn.execute(
        "INSERT INTO collector_sources (id, firm_id, canonical_url, kind, source_channel, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sid, firm.id, canonical_url, kind.value, channel.value, stamp, stamp),
    )
    created = get_source(conn, sid)
    assert created is not None
    return created


def get_source(conn: sqlite3.Connection, source_id: str) -> Source | None:
    row = conn.execute("SELECT * FROM collector_sources WHERE id = ?", (source_id,)).fetchone()
    return _source(row) if row else None


def require_source(conn: sqlite3.Connection, source_id: str) -> Source:
    found = get_source(conn, source_id)
    if found is None:
        raise RegistryError(f"unknown source {source_id!r}; see `collector source list`")
    return found


def list_sources(conn: sqlite3.Connection, firm_id: str | None = None, *, seeds_only: bool = False) -> list[Source]:
    clauses, params = [], []
    if firm_id is not None:
        clauses.append("firm_id = ?")
        params.append(firm_id)
    if seeds_only:
        clauses.append("source_channel IN ('seed', 'platform_api') AND kind IN ('page','pdf','sitemap','zendesk')")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(f"SELECT * FROM collector_sources {where} ORDER BY canonical_url", params)  # noqa: S608
    return [_source(r) for r in rows]


def update_source(
    conn: sqlite3.Connection,
    source: Source,
    *,
    now: datetime,
    label: str | None = None,
    priority: int | None = None,
    requires_js: bool | None = None,
    js_disabled: bool | None = None,
    enabled: bool | None = None,
) -> Source:
    req = source.requires_js if requires_js is None else requires_js
    nojs = source.js_disabled if js_disabled is None else js_disabled
    if req and nojs:
        raise RegistryError("--requires-js and --no-js cannot both be set")
    prio = source.priority if priority is None else priority
    if not -100 <= prio <= 100:
        raise RegistryError("priority must be between -100 and 100")
    with transaction(conn):
        conn.execute(
            "UPDATE collector_sources SET label = ?, priority = ?, requires_js = ?, js_disabled = ?, enabled = ?,"
            " updated_at = ? WHERE id = ?",
            (
                label if label is not None else source.label,
                prio,
                int(req),
                int(nojs),
                int(source.enabled if enabled is None else enabled),
                format_instant(now),
                source.id,
            ),
        )
    return require_source(conn, source.id)


def update_source_state(conn: sqlite3.Connection, source_id: str, now: datetime, **fields: object) -> None:
    """Update a source's last-fetch state columns. Must be called inside a transaction."""
    allowed = {
        "etag",
        "last_modified",
        "sitemap_lastmod",
        "last_attempt_at",
        "last_success_at",
        "last_outcome",
        "latest_snapshot_id",
        "zendesk_cursor",
    }
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"not source state columns: {sorted(unknown)}")
    if not fields:
        return
    assignments = ", ".join(f"{name} = ?" for name in fields)
    conn.execute(
        f"UPDATE collector_sources SET {assignments}, updated_at = ? WHERE id = ?",  # noqa: S608 - fixed column names
        (*fields.values(), format_instant(now), source_id),
    )
