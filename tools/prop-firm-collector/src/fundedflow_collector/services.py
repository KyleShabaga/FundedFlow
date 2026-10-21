"""Operations shared by the CLI and the desktop GUI, so both run exactly the same code paths."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from importlib import metadata
from pathlib import Path
from typing import Any

from fundedflow_collector import __version__
from fundedflow_collector.clock import Clock, format_instant
from fundedflow_collector.config import ConfigError, Settings, load_settings
from fundedflow_collector.db import registry
from fundedflow_collector.db.connection import open_database, transaction
from fundedflow_collector.db.migrate import bundled_migrations, current_version
from fundedflow_collector.directory import export as directory_export
from fundedflow_collector.directory import review as directory_review
from fundedflow_collector.export.csv_diag import to_csv
from fundedflow_collector.export.envelope import SCHEMA_VERSION, Envelope, build_envelope, serialise
from fundedflow_collector.export.validate import validation_errors
from fundedflow_collector.net.client import Fetcher, build_user_agent, make_client
from fundedflow_collector.net.fixture_transport import FixtureSite
from fundedflow_collector.net.pinned_backend import PinnedNetworkBackend
from fundedflow_collector.net.resolver import SystemResolver
from fundedflow_collector.net.transport import PinnedTransport
from fundedflow_collector.outcomes import OUTCOME_INFO, Category, HostRole, Outcome
from fundedflow_collector.paths import CollectorPaths
from fundedflow_collector.policy import circuit
from fundedflow_collector.policy.terms import review_expires, terms_block_reason
from fundedflow_collector.render.browser import PlaywrightRenderer, Renderer, browser_status
from fundedflow_collector.runner import Environment, RunSummary, user_agent_suffix
from fundedflow_collector.safety import banned_installed

PINNED = {"httpx": "0.28.1", "httpcore": "1.0.9"}
BrowserCheck = Callable[[], tuple[bool, str]]


# ---------------------------------------------------------------- run environment


def build_environment(
    conn: sqlite3.Connection,
    settings: Settings,
    config_sha: str,
    *,
    clock: Clock,
    fixture_dir: Path | None,
    use_browser: bool,
    headed: bool,
    live: bool,
    progress: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    browser_check: BrowserCheck = browser_status,
) -> Environment:
    """Wire the real fetcher (DNS-pinned transport, or fixture replay) and the optional browser into a run."""
    fixture = FixtureSite(fixture_dir) if fixture_dir is not None else None
    if not live:
        return Environment(
            conn=conn,
            settings=settings,
            config_sha256=config_sha,
            clock=clock,
            fetcher=None,
            resolver=None,
            renderer=None,
            fixture=fixture,
            should_stop=should_stop,
        )
    user_agent = build_user_agent(settings, required=fixture is None)
    if fixture is not None:
        fetcher = Fetcher(make_client(settings, fixture.transport(), user_agent), clock, settings)
        resolver = None
    else:
        resolver = SystemResolver()
        backend = PinnedNetworkBackend(resolver)
        fetcher = Fetcher(make_client(settings, PinnedTransport(backend), user_agent), clock, settings, backend)
    renderer: Renderer | None = None
    if use_browser and settings.browser.enabled == "auto" and importlib.util.find_spec("playwright") is not None:
        available, _ = browser_check()
        if available:
            renderer = PlaywrightRenderer(
                user_agent_suffix=user_agent_suffix(settings.user_agent.info_url),
                navigation_timeout_seconds=settings.browser.navigation_timeout_seconds,
                headed=headed,
            )
    return Environment(
        conn=conn,
        settings=settings,
        config_sha256=config_sha,
        clock=clock,
        fetcher=fetcher,
        resolver=resolver,
        renderer=renderer,
        fixture=fixture,
        progress=progress,
        should_stop=should_stop,
    )


# ---------------------------------------------------------------- export


class ExportInvalid(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("export failed schema validation; nothing was written")
        self.errors = errors


@dataclass(frozen=True)
class ExportResult:
    path: Path
    envelope: Envelope
    csv_path: Path | None


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".ffc-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def default_export_path(paths: CollectorPaths, envelope: Envelope) -> Path:
    return paths.exports / f"collector-evidence-{envelope.generated_at[:10]}-{envelope.export_id[4:12]}.json"


def write_export(
    conn: sqlite3.Connection,
    paths: CollectorPaths,
    *,
    firm_keys: list[str] | None,
    generated_at: str,
    out: Path | None = None,
    include_attempts: bool = False,
    csv_out: Path | None = None,
) -> ExportResult:
    """Build, validate and atomically write an evidence envelope. Nothing is written if validation fails."""
    envelope = build_envelope(conn, firm_keys=firm_keys, generated_at=generated_at, include_attempts=include_attempts)
    data = serialise(envelope)
    errors = validation_errors(json.loads(data))
    if errors:
        raise ExportInvalid(errors)
    target = out or default_export_path(paths, envelope)
    atomic_write(target, data)
    if csv_out is not None:
        atomic_write(csv_out, to_csv(envelope))
    with transaction(conn):
        conn.execute(
            "INSERT OR REPLACE INTO export_batches (export_id, generated_at, path, firm_keys, snapshot_count,"
            " file_sha256, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                envelope.export_id,
                generated_at,
                str(target.resolve()),
                json.dumps([f.firm_key for f in envelope.firms]),
                len(envelope.snapshots),
                hashlib.sha256(data).hexdigest(),
                SCHEMA_VERSION,
            ),
        )
    return ExportResult(path=target, envelope=envelope, csv_path=csv_out)


# ---------------------------------------------------------------- comparison publishers (Build 29.25)

#: How the Fetch screen groups outcomes. Every Outcome lands in exactly one bucket (a test checks this).
BUCKETS: dict[str, frozenset[Outcome]] = {
    "collected": frozenset({Outcome.NEW_SNAPSHOT, Outcome.MATCHED_EARLIER_SNAPSHOT}),
    "unchanged": frozenset({Outcome.UNCHANGED, Outcome.SKIPPED_LASTMOD}),
    "skipped": frozenset(
        {
            Outcome.DISABLED,
            Outcome.EXCLUDED_PATH,
            Outcome.NOT_ALLOWLISTED,
            Outcome.URL_REJECTED,
            Outcome.BUDGET_EXHAUSTED,
            Outcome.DEADLINE_EXCEEDED,
        }
    ),
    "blocked": frozenset(
        {
            Outcome.TERMS_BLOCKED,
            Outcome.ROBOTS_BLOCKED,
            Outcome.ROBOTS_UNREACHABLE,
            Outcome.CIRCUIT_OPEN,
            Outcome.ACCESS_DENIED,
            Outcome.BLOCKED_BOT_PROTECTION,
            Outcome.RATE_LIMITED,
            Outcome.ADDRESS_BLOCKED,
        }
    ),
}
BUCKET_ORDER = ("collected", "unchanged", "skipped", "failed", "blocked")


def outcome_bucket(outcome: Outcome) -> str:
    for name, members in BUCKETS.items():
        if outcome in members:
            return name
    return "failed"


def bucket_counts(summary: RunSummary) -> dict[str, int]:
    counts = dict.fromkeys(BUCKET_ORDER, 0)
    for result in summary.results:
        if result.counted:
            counts[outcome_bucket(result.outcome)] += 1
    return counts


def select_owners(
    conn: sqlite3.Connection,
    *,
    firm_keys: list[str] | None = None,
    publisher_keys: list[str] | None = None,
    all_firms: bool = False,
    all_publishers: bool = False,
) -> list[registry.Owner]:
    """Firms and/or publishers to run, in a stable order. `all_*` means every *enabled* one."""
    owners: list[registry.Owner] = []
    if all_firms:
        owners += [f for f in registry.list_firms(conn) if f.enabled]
    owners += [registry.require_firm(conn, k) for k in firm_keys or []]
    if all_publishers:
        owners += [p for p in registry.list_publishers(conn) if p.enabled]
    owners += [registry.require_publisher(conn, k) for k in publisher_keys or []]
    unique: dict[str, registry.Owner] = {}
    for owner in owners:
        unique.setdefault(owner.id, owner)
    return list(unique.values())


def summary_lines(summaries: list[RunSummary], *, dry_run: bool) -> list[str]:
    """Readable run results for the window and logs: counts per site and why anything did not succeed."""
    lines: list[str] = []
    for summary in summaries:
        if summary.message:
            lines.append(summary.message)
        if dry_run:
            lines.append(f"Preview for {summary.firm_key} (no network, nothing saved):")
            if summary.status == "skipped_manual_only":
                continue
            if not summary.dry_run_lines:
                lines.append("  No known targets yet. Add sources, or run a fetch with discovery.")
            for decision, url, why in summary.dry_run_lines:
                lines.append(f"  {decision:<16} {url}  ({why})")
            allowed = sum(1 for d, _u, _w in summary.dry_run_lines if d == "allowed")
            lines.append(
                f"  Planned: {allowed} of {len(summary.dry_run_lines)} known pages allowed; the run may use up to "
                f"{summary.budget} requests (robots.txt and pages found by following links count too)."
            )
            continue
        buckets = bucket_counts(summary)
        counts = ", ".join(f"{k} {v}" for k, v in buckets.items())
        lines.append(f"{summary.firm_key}: {summary.status}; {summary.fetches_used} requests; {counts}")
        outcomes = ", ".join(f"{k} {v}" for k, v in sorted(summary.counts().items()))
        if outcomes:
            lines.append(f"  outcomes: {outcomes}")
        directory = summary.directory_counts()
        if directory:
            lines.append("  pages read: " + ", ".join(f"{k} {v}" for k, v in sorted(directory.items())))
        for outcome in sorted(
            {r.outcome for r in summary.results if r.counted and OUTCOME_INFO[r.outcome].category is not Category.OK}
        ):
            lines.append(f"  {outcome.value}: {OUTCOME_INFO[outcome].action}")
        for result in summary.results:
            if result.directory in ("structure_changed", "js_unavailable", "parse_error"):
                lines.append(f"  {result.directory}: {result.url} ({result.directory_detail})")
    return lines


class DirectoryExportInvalid(ExportInvalid):
    pass


@dataclass(frozen=True)
class DirectoryExportResult:
    path: Path
    document: dict[str, Any]


def write_directory_export(
    conn: sqlite3.Connection,
    paths: CollectorPaths,
    settings: Settings,
    *,
    now: datetime,
    publisher_keys: list[str] | None = None,
    out: Path | None = None,
    include_superseded: bool = False,
) -> DirectoryExportResult:
    """Build, validate and atomically write a collector-directory-observations-v1 file."""
    for key in publisher_keys or []:
        registry.require_publisher(conn, key)
    document = directory_export.build(
        conn,
        now=now,
        publisher_keys=publisher_keys,
        include_superseded=include_superseded,
        stale_after_days=settings.directory.stale_after_days,
    )
    data = directory_export.serialise(document)
    errors = validation_errors(json.loads(data))
    if errors:
        raise DirectoryExportInvalid(errors)
    target = out or paths.exports / (
        f"collector-directory-{document['generated_at'][:10]}-{document['export_id'][5:13]}.json"
    )
    atomic_write(target, data)
    with transaction(conn):
        conn.execute(
            "INSERT OR REPLACE INTO export_batches (export_id, generated_at, path, firm_keys, snapshot_count,"
            " file_sha256, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                document["export_id"],
                document["generated_at"],
                str(target.resolve()),
                json.dumps([f"publisher:{k}" for k in document["scope"]["publishers"]]),
                len(document["pages"]),
                hashlib.sha256(data).hexdigest(),
                directory_export.SCHEMA_VERSION,
            ),
        )
    return DirectoryExportResult(target, document)


# ---------------------------------------------------------------- health checks (`doctor` and the GUI Setup tab)


@dataclass(frozen=True)
class Check:
    status: str  # ok | WARN | FAIL | info
    label: str
    detail: str


@dataclass
class Health:
    checks: list[Check] = field(default_factory=list)
    stopped_early: bool = False

    @property
    def problems(self) -> int:
        return sum(1 for c in self.checks if c.status == "FAIL")

    def add(self, status: str, label: str, detail: str) -> None:
        self.checks.append(Check(status, label, detail))


def health_checks(
    paths: CollectorPaths,
    config_file: Path,
    clock: Clock,
    *,
    browser_check: BrowserCheck = browser_status,
) -> Health:
    health = Health()
    py = sys.version_info
    health.add("ok" if py >= (3, 12) else "FAIL", "python", f"{py.major}.{py.minor}.{py.micro}")
    health.add("ok", "collector", __version__)
    health.add("ok", "data folder", str(paths.data_dir))
    try:
        settings, _ = load_settings(config_file)
        health.add("ok", "settings", str(config_file) + ("" if config_file.exists() else " (not found; defaults)"))
    except ConfigError as exc:
        health.add("FAIL", "settings", str(exc))
        health.stopped_early = True
        return health
    if settings.user_agent.info_url:
        health.add("ok", "user-agent info URL", settings.user_agent.info_url)
        health.add("ok", "user-agent", build_user_agent(settings))
    else:
        health.add("WARN", "user-agent info URL", "not set: live fetching is refused until user_agent.info_url is set")
    banned = banned_installed()
    health.add("FAIL" if banned else "ok", "banned packages", ", ".join(banned) if banned else "none installed")
    for name, expected in PINNED.items():
        actual = metadata.version(name)
        good = actual == expected
        health.add("ok" if good else "FAIL", f"{name} pin", actual if good else f"{actual} (tested with {expected})")
    available, detail = browser_check()
    health.add("ok" if available else "info", "browser extra", detail if available else f"not available: {detail}")
    health.add("ok", "proxies/cookies", "system proxies ignored (trust_env=False); no cookies stored or sent")
    if not paths.db.exists():
        health.add("WARN", "database", "not created yet: run `collector init-db`")
        health.stopped_early = True
        return health
    conn = open_database(paths.db)
    try:
        version = current_version(conn)
        latest = len(bundled_migrations())
        health.add("ok" if version == latest else "WARN", "database", f"{paths.db} (schema {version}/{latest})")
        now = clock.now()
        hosts = registry.list_hosts(conn)
        if not hosts:
            health.add("info", "hosts", "none registered")
        for host in hosts:
            firm = registry.get_firm_by_id(conn, host.firm_id)
            if host.role is HostRole.ASSET:
                health.add("info", f"terms {host.host}", f"{firm.firm_key}: asset host (browser sub-resources only)")
                continue
            reason = terms_block_reason(host, now)
            expires = review_expires(host)
            decision = host.terms_decision.value if host.terms_decision else "not reviewed"
            if reason is None:
                detail = f"{firm.firm_key}: {decision}, review valid until {expires:%Y-%m-%d}" if expires else decision
                health.add("ok", f"terms {host.host}", detail)
            else:
                health.add("WARN", f"terms {host.host}", f"{firm.firm_key}: {decision}; manual capture only ({reason})")
        for publisher in registry.list_publishers(conn):
            status = directory_review.publisher_status(conn, publisher, now)
            level = "ok" if status.state in ("collected", "unchanged") else "info"
            if status.state in ("structure_changed", "permissions_blocked", "rate_limited", "robots_blocked"):
                level = "WARN"
            health.add(level, f"publisher {publisher.publisher_key}", f"{status.label}; {status.terms}")
        open_circuits = circuit.list_open(conn, now)
        if not open_circuits:
            health.add("ok", "stopped hosts", "none")
        for c in open_circuits:
            until = f", cools down at {c.cooldown_until}" if c.cooldown_until else ", needs `collector host reenable`"
            health.add("WARN", f"stopped {c.host}", f"{c.state.value}: {c.reason}{until}")
    finally:
        conn.close()
    return health


def now_instant(clock: Clock) -> str:
    return format_instant(clock.now())
