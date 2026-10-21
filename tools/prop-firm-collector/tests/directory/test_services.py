"""Shared services used by both the CLI and the window for publishers."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from fundedflow_collector import services
from fundedflow_collector.clock import FakeClock
from fundedflow_collector.config import ConfigError, Settings, load_settings
from fundedflow_collector.db import registry
from fundedflow_collector.directory import presets
from fundedflow_collector.outcomes import Outcome
from fundedflow_collector.paths import resolve_paths
from tests.conftest import Harness, add_firm, install_publisher, run_publisher


def test_every_outcome_is_in_exactly_one_bucket() -> None:
    explicit = [o for members in services.BUCKETS.values() for o in members]
    assert len(explicit) == len(set(explicit))
    for outcome in Outcome:
        assert services.outcome_bucket(outcome) in services.BUCKET_ORDER
    assert services.outcome_bucket(Outcome.NEW_SNAPSHOT) == "collected"
    assert services.outcome_bucket(Outcome.ROBOTS_BLOCKED) == "blocked"
    assert services.outcome_bucket(Outcome.PARSE_ERROR) == "failed"


def test_owner_selection_keeps_firms_and_publishers_apart(conn: sqlite3.Connection, clock: FakeClock) -> None:
    add_firm(conn, clock)
    install_publisher(conn, clock, "onlypropfirms")
    presets.install_preset(conn, "propfirmgorilla", clock.now())
    assert [o.owner_key for o in services.select_owners(conn, all_firms=True)] == ["example-firm"]
    assert [o.owner_key for o in services.select_owners(conn, all_publishers=True)] == ["publisher:onlypropfirms"]
    picked = services.select_owners(conn, publisher_keys=["propfirmgorilla", "propfirmgorilla"])
    assert [o.owner_key for o in picked] == ["publisher:propfirmgorilla"]
    with pytest.raises(registry.RegistryError):
        services.select_owners(conn, publisher_keys=["example-firm"])


def test_summary_lines_report_counts_and_page_problems(dharness: Harness) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    summary = run_publisher(dharness, "onlypropfirms")
    lines = "\n".join(services.summary_lines([summary], dry_run=False))
    assert "collected" in lines and "blocked 0" in lines
    assert "pages read:" in lines and "structure_changed: https://onlypropfirms.com/prop-firms/contoso-funding" in lines
    buckets = services.bucket_counts(summary)
    assert buckets["collected"] == summary.counts()[Outcome.NEW_SNAPSHOT.value]


def test_health_checks_list_publishers(tmp_path: Path, clock: FakeClock) -> None:
    from fundedflow_collector.db.connection import open_database

    paths = resolve_paths(tmp_path / "data")
    conn = open_database(paths.db, create=True)
    presets.install_preset(conn, "propfirmmatch-futures", clock.now())
    conn.close()
    health = services.health_checks(paths, paths.default_config, clock, browser_check=lambda: (False, "test"))
    line = next(c for c in health.checks if c.label == "publisher propfirmmatch-futures")
    assert "Needs manual capture" in line.detail


def test_directory_settings_have_bounds(tmp_path: Path) -> None:
    assert Settings().directory.stale_after_days == 30
    config = tmp_path / "c.toml"
    config.write_text("[directory]\nstale_after_days = 0\n", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_settings(config)
    config.write_text("[directory]\nfollow_affiliate_links = true\n", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_settings(config)  # unknown keys are refused: there is no setting that widens scope
