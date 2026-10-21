"""Shared fixtures. Real network access is disabled for the whole suite (pytest-socket, see pyproject.toml)."""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import httpx
import pytest

from fundedflow_collector.clock import FakeClock
from fundedflow_collector.config import Settings
from fundedflow_collector.db import registry
from fundedflow_collector.db.connection import open_database
from fundedflow_collector.db.registry import Firm
from fundedflow_collector.net.client import Fetcher, make_client
from fundedflow_collector.net.fixture_transport import FixtureSite
from fundedflow_collector.outcomes import HostRole, SourceKind, TermsDecision
from fundedflow_collector.render.browser import Renderer
from fundedflow_collector.runner import Environment, FirmRunner, RunOptions, RunSummary

PROJECT = Path(__file__).resolve().parents[1]
#: Captured before any test isolates LOCALAPPDATA, so browser tests can find Playwright's Chromium.
REAL_LOCALAPPDATA = os.environ.get("LOCALAPPDATA")
FIXTURE_SITE = PROJECT / "examples" / "fixture-site"
CAPTURES = PROJECT / "examples" / "captures"
UA = "Mozilla/5.0 (compatible; FundedFlowCollector/0.1; +https://example.invalid/fundedflow-collector)"
# Jitter off so fake-clock timestamps (and so the pinned export fixture) are deterministic.
TEST_SETTINGS = Settings.model_validate(
    {"user_agent": {"info_url": "https://example.invalid/fundedflow-collector"}, "pacing": {"jitter_ms": 0}}
)


@pytest.fixture(autouse=True)
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point every per-user folder at a temp dir so no test can reach the real app or collector data."""
    home = tmp_path / "home"
    for var, sub in (("APPDATA", "Roaming"), ("LOCALAPPDATA", "Local"), ("FFC_DATA_DIR", "collector")):
        path = home / sub
        path.mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv(var, str(path))
    monkeypatch.delenv("FFC_CONFIG", raising=False)
    return home


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    connection = open_database(tmp_path / "data" / "collector.db", create=True)
    yield connection
    connection.close()


def add_firm(
    conn: sqlite3.Connection,
    clock: FakeClock,
    key: str = "example-firm",
    *,
    hosts: dict[str, tuple[HostRole, TermsDecision | None]] | None = None,
    accept_unclear: bool = False,
    max_fetches: int | None = None,
    excluded: list[str] | None = None,
) -> Firm:
    firm = registry.add_firm(
        conn,
        firm_key=key,
        display_name=f"{key} (synthetic)",
        homepage_url="https://www.example-firm.test/",
        now=clock.now(),
        max_fetches=max_fetches,
        excluded_paths=excluded or [],
    )
    hosts = (
        hosts
        if hosts is not None
        else {
            "www.example-firm.test": (HostRole.HOMEPAGE, TermsDecision.ALLOWED),
            "help.example-firm.test": (HostRole.HELP_CENTER, TermsDecision.ALLOWED),
        }
    )
    for name, (role, decision) in hosts.items():
        host = registry.add_host(conn, firm, name, role, clock.now())
        if decision is not None:
            registry.record_terms(
                conn,
                firm,
                host,
                decision=decision,
                terms_url="https://www.example-firm.test/terms",
                now=clock.now(),
                accept_unclear=accept_unclear and decision is TermsDecision.UNCLEAR,
            )
    return firm


def add_seed(
    conn: sqlite3.Connection, firm: Firm, clock: FakeClock, url: str, kind: SourceKind = SourceKind.PAGE, **kw: object
) -> registry.Source:
    return registry.add_source(conn, firm, url=url, kind=kind, now=clock.now(), **kw)  # type: ignore[arg-type]


@dataclass
class Harness:
    conn: sqlite3.Connection
    clock: FakeClock
    site: FixtureSite
    settings: Settings
    renderer: Renderer | None = None

    def env(self) -> Environment:
        fetcher = Fetcher(make_client(self.settings, self.site.transport(), UA), self.clock, self.settings)
        return Environment(
            conn=self.conn,
            settings=self.settings,
            config_sha256="0" * 64,
            clock=self.clock,
            fetcher=fetcher,
            resolver=None,
            renderer=self.renderer,
            fixture=self.site,
        )

    def run(self, firm_key: str = "example-firm", **options: object) -> RunSummary:
        firm = registry.require_firm(self.conn, firm_key)
        opts = RunOptions(command=options.pop("command", "fetch"), **options)  # type: ignore[arg-type]
        return FirmRunner(self.env(), firm, opts, "batch_test").run()

    def advance_days(self, days: float) -> None:
        self.clock.advance(timedelta(days=days).total_seconds())


@pytest.fixture
def site_copy(tmp_path: Path) -> Path:
    """A writable copy of the synthetic fixture site, so tests can change pages."""
    import shutil

    target = tmp_path / "site"
    shutil.copytree(FIXTURE_SITE, target)
    return target


@pytest.fixture
def harness(conn: sqlite3.Connection, clock: FakeClock, site_copy: Path) -> Harness:
    return Harness(conn=conn, clock=clock, site=FixtureSite(site_copy), settings=TEST_SETTINGS)


Handler = Callable[[httpx.Request], httpx.Response]


def mock_fetcher(handler: Handler, clock: FakeClock, settings: Settings = TEST_SETTINGS) -> Fetcher:
    return Fetcher(make_client(settings, httpx.MockTransport(handler), UA), clock, settings)
