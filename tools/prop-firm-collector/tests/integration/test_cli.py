"""The `collector` CLI: help, exit codes and the synthetic end-to-end walkthrough (no network)."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fundedflow_collector.cli import admin_cmds, directory_cmds, run_cmds
from fundedflow_collector.cli.main import app
from fundedflow_collector.clock import FakeClock
from tests.conftest import CAPTURES, DIRECTORY_CAPTURES, DIRECTORY_SITE, FIXTURE_SITE, PROJECT

runner = CliRunner()
COMMANDS = [
    [],
    ["doctor"],
    ["init-db"],
    ["firm"],
    ["firm", "add"],
    ["firm", "list"],
    ["firm", "show"],
    ["firm", "update"],
    ["firm", "disable"],
    ["firm", "enable"],
    ["firm", "import"],
    ["host"],
    ["host", "add"],
    ["host", "list"],
    ["host", "terms"],
    ["host", "reenable"],
    ["source"],
    ["source", "add"],
    ["source", "list"],
    ["source", "update"],
    ["source", "disable"],
    ["source", "enable"],
    ["discover"],
    ["fetch"],
    ["import-capture"],
    ["runs"],
    ["runs", "show"],
    ["snapshots"],
    ["snapshots", "show"],
    ["export"],
    ["validate"],
    ["prune-raw"],
    ["reset"],
    ["gui"],
    ["directory"],
    ["directory", "presets"],
    ["directory", "add-preset"],
    ["directory", "add"],
    ["directory", "list"],
    ["directory", "show"],
    ["directory", "update"],
    ["directory", "enable"],
    ["directory", "disable"],
    ["directory", "host-add"],
    ["directory", "terms"],
    ["directory", "seed-add"],
    ["directory", "fetch"],
    ["directory", "capture"],
    ["directory", "observations"],
    ["directory", "show-observation"],
    ["directory", "export"],
    ["directory", "adapters"],
    ["directory", "review"],
    ["directory", "review", "list"],
    ["directory", "review", "map"],
    ["directory", "review", "separate"],
    ["directory", "review", "note"],
    ["directory", "review", "verify"],
    ["directory", "review", "unverify"],
]


def cli(*args: str) -> tuple[int, str]:
    result = runner.invoke(app, list(args))
    return result.exit_code, result.output


@pytest.fixture(autouse=True)
def fake_run_clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    clock = FakeClock()
    monkeypatch.setattr(run_cmds, "clock", clock)
    monkeypatch.setattr(directory_cmds, "clock", clock)
    # The browser adapter has its own tests (tests/browser); here it is reported as unavailable.
    monkeypatch.setattr(run_cmds, "browser_status", lambda: (False, "not used in CLI tests"))
    monkeypatch.setattr(admin_cmds, "browser_status", lambda: (False, "not used in CLI tests"))
    return clock


@pytest.fixture
def ready(tmp_path: Path) -> Path:
    data = Path(os.environ["FFC_DATA_DIR"])
    assert cli("init-db")[0] == 0
    (data / "collector.toml").write_text(
        '[user_agent]\ninfo_url = "https://example.invalid/fundedflow-collector"\n[pacing]\njitter_ms = 0\n',
        encoding="utf-8",
    )
    site = tmp_path / "site"
    shutil.copytree(FIXTURE_SITE, site)
    return site


@pytest.mark.parametrize("command", COMMANDS, ids=lambda c: " ".join(c) or "root")
def test_every_command_has_help(command: list[str]) -> None:
    code, output = cli(*command, "--help")
    assert code == 0, output
    assert "Usage" in output


def test_version() -> None:
    assert cli("--version") == (0, "fundedflow-collector 0.1.0\n")


def test_commands_before_init_db_explain_what_to_do() -> None:
    code, output = cli("firm", "list")
    assert code == 7 and "init-db" in output


def test_registry_validation_exit_codes(ready: Path) -> None:
    assert cli("firm", "add", "Bad Key", "--name", "x", "--homepage", "https://a.test/")[0] == 3
    assert cli("firm", "add", "ok-firm", "--name", "x", "--homepage", "https://127.0.0.1/")[0] == 3
    assert cli("firm", "add", "ok-firm", "--name", "x", "--homepage", "https://ok.test/")[0] == 0
    assert cli("host", "add", "--firm", "ok-firm", "--host", "10.0.0.1", "--role", "homepage")[0] == 3
    assert cli("host", "add", "--firm", "ok-firm", "--host", "www.ok.test", "--role", "nonsense")[0] == 2
    assert cli("source", "add", "--firm", "ok-firm", "--url", "https://www.ok.test/r")[0] == 3  # host not added
    assert cli("fetch")[0] == 2  # neither --firm nor --all
    assert cli("fetch", "--firm", "missing")[0] == 3


def test_live_fetch_refuses_without_info_url(ready: Path) -> None:
    data = Path(os.environ["FFC_DATA_DIR"])
    (data / "collector.toml").write_text("", encoding="utf-8")
    cli("firm", "import", "--file", str(PROJECT / "config" / "firms" / "example-firm.toml"))
    code, output = cli("fetch", "--firm", "example-firm", "--no-discover", "--max-fetches", "1")
    assert code == 3 and "info_url" in output


def test_bad_config_and_app_data_dir_are_refused(ready: Path) -> None:
    data = Path(os.environ["FFC_DATA_DIR"])
    (data / "collector.toml").write_text('proxy = "http://127.0.0.1:8080"\n', encoding="utf-8")
    code, output = cli("fetch", "--firm", "x", "--dry-run")
    assert code == 3 and "proxy" in output
    app_dir = Path(os.environ["APPDATA"]) / "com.fundedflow.desktop"
    code, output = cli("--data-dir", str(app_dir), "init-db")
    assert code == 7 and "refusing" in output
    assert not (app_dir / "collector.db").exists()


def test_validate_rejects_bad_files(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text('{"schema_version": 1}', encoding="utf-8")
    assert cli("validate", str(bad))[0] == 6
    bad.write_text("not json", encoding="utf-8")
    assert cli("validate", str(bad))[0] == 6
    fixture = PROJECT / "tests" / "fixtures" / "collector-snapshot-v1.json"
    code, output = cli("validate", str(fixture))
    assert code == 0 and "valid collector-snapshot-v1" in output


def test_synthetic_walkthrough(ready: Path, tmp_path: Path) -> None:
    """Register firms -> discover -> fetch HTML/PDF/Zendesk -> rerun unchanged -> mutate -> refetch -> capture ->
    inspect -> export -> validate -> reset. The same flow the user guide shows."""
    site = ready
    firm_file = PROJECT / "config" / "firms" / "example-firm.toml"
    assert cli("firm", "import", "--file", str(firm_file))[0] == 0
    assert cli("firm", "import", "--file", str(firm_file))[0] == 0  # idempotent
    code, output = cli(
        "firm",
        "add",
        "sample-funding",
        "--name",
        "Sample Funding Co (synthetic)",
        "--homepage",
        "https://www.sample-funding.test/",
    )
    assert code == 0
    for host, role in (("www.sample-funding.test", "homepage"), ("support.sample-funding.test", "help_center")):
        assert cli("host", "add", "--firm", "sample-funding", "--host", host, "--role", role)[0] == 0
    code, output = cli(
        "host",
        "terms",
        "--firm",
        "sample-funding",
        "--host",
        "www.sample-funding.test",
        "--decision",
        "unclear",
        "--terms-url",
        "https://www.sample-funding.test/terms",
    )
    assert code == 0 and "not allowed" in output
    code, output = cli(
        "host",
        "terms",
        "--firm",
        "sample-funding",
        "--host",
        "www.sample-funding.test",
        "--decision",
        "unclear",
        "--terms-url",
        "https://www.sample-funding.test/terms",
        "--accept-unclear-terms",
    )
    assert code == 0 and "Live fetching: allowed." in output
    assert (
        cli(
            "host",
            "terms",
            "--firm",
            "sample-funding",
            "--host",
            "support.sample-funding.test",
            "--decision",
            "allowed",
            "--terms-url",
            "https://www.sample-funding.test/terms",
        )[0]
        == 0
    )
    assert (
        cli(
            "source",
            "add",
            "--firm",
            "sample-funding",
            "--url",
            "https://www.sample-funding.test/program-rules",
            "--label",
            "Program rules",
        )[0]
        == 0
    )
    assert (
        cli("source", "add", "--firm", "sample-funding", "--url", "https://support.sample-funding.test/rules")[0] == 0
    )

    code, output = cli("fetch", "--all", "--dry-run")
    assert code == 0 and "robots.txt not cached" in output

    code, output = cli("discover", "--firm", "example-firm", "--fixture-site", str(site))
    assert code == 0, output

    code, output = cli("fetch", "--all", "--fixture-site", str(site))
    assert code == 4, output  # robots-blocked page and a bot-protected host are reported
    assert "new_snapshot" in output and "STOPPED (blocked_bot_protection" in output

    code, output = cli("fetch", "--firm", "example-firm", "--fixture-site", str(site))
    assert "unchanged" in output and "new_snapshot" not in output

    faq = site / "www.example-firm.test" / "faq.html"
    faq.write_text(faq.read_text(encoding="utf-8").replace("eight", "ten"), encoding="utf-8")
    code, output = cli("fetch", "--firm", "example-firm", "--fixture-site", str(site))
    assert "new_snapshot             https://www.example-firm.test/faq" in output

    code, output = cli(
        "import-capture",
        "--firm",
        "sample-funding",
        "--url",
        "https://www.sample-funding.test/payouts",
        "--file",
        str(CAPTURES / "sample-funding-payouts.html"),
        "--captured-at",
        "2026-10-20T14:30:00Z",
    )
    assert code == 0 and "manual_capture" in output

    code, output = cli("host", "list")
    assert "blocked_bot_protection" in output and "acknowledged" in output
    code, output = cli("doctor")
    assert "stopped support.sample-funding.test" in output and "banned packages" in output

    code, output = cli("runs", "--json")
    run_list = json.loads(output)
    assert code == 0 and len(run_list) >= 4
    code, output = cli("runs", "show", run_list[0]["id"])
    assert code == 0 and "OUTCOME" in output
    code, output = cli("snapshots", "--firm", "example-firm", "--url", "https://www.example-firm.test/faq", "--json")
    faq_snaps = json.loads(output)
    assert len(faq_snaps) == 2
    code, output = cli("snapshots", "show", faq_snaps[0]["id"], "--text")
    assert code == 0 and "ten trading days" in output and "unverified evidence" in output

    out = tmp_path / "evidence.json"
    csv_out = tmp_path / "evidence.csv"
    code, output = cli(
        "export", "--all", "--out", str(out), "--generated-at", "2026-10-21T00:00:00Z", "--csv", str(csv_out)
    )
    assert code == 0 and "schema     collector-snapshot-v1: valid" in output
    assert cli("validate", str(out))[0] == 0
    first = out.read_bytes()
    cli("export", "--all", "--out", str(out), "--generated-at", "2026-10-21T00:00:00Z")
    assert out.read_bytes() == first
    assert "text" not in csv_out.read_text(encoding="utf-8").splitlines()[0].split(",")

    code, output = cli("host", "reenable", "--host", "support.sample-funding.test", "--reason", "firm agreed")
    assert code == 0 and "was blocked_bot_protection" in output

    code, output = cli("reset")
    assert code == 2 and "would delete" in output
    code, output = cli("reset", "--yes")
    assert code == 0 and "app database was not touched" in output
    assert not (Path(os.environ["FFC_DATA_DIR"]) / "collector.db").exists()
    assert (Path(os.environ["FFC_DATA_DIR"]) / "collector.toml").exists()


def test_directory_walkthrough(ready: Path, tmp_path: Path) -> None:
    """Presets, policy gates, a practice collection, a manual capture, review and export, all through the CLI."""
    code, output = cli("directory", "presets")
    assert code == 0 and "propfirmmatch-futures" in output and "manual_only" in output
    assert cli("directory", "add-preset", "--all")[0] == 0
    code, output = cli("directory", "fetch", "--publisher", "onlypropfirms")
    assert code == 4 and "disabled" in output  # nothing fetched before review (exit 4, as for a disabled firm)
    code, output = cli("directory", "enable", "onlypropfirms")
    assert code == 3 and "terms review" in output
    code, output = cli("directory", "enable", "propfirmmatch-futures")
    assert code == 3 and "manual capture only" in output
    code, output = cli("directory", "fetch", "--publisher", "onlypropfirms", "--dry-run")
    assert code == 4 and "terms_blocked" in output and "collector directory terms" in output
    terms = [
        "directory",
        "terms",
        "--publisher",
        "onlypropfirms",
        "--host",
        "onlypropfirms.com",
        "--decision",
        "unclear",
        "--terms-url",
        "https://onlypropfirms.com/privacy-policy",
        "--accept-unclear-terms",
    ]
    assert cli(*terms)[0] == 0
    assert cli("directory", "enable", "onlypropfirms")[0] == 0
    site = tmp_path / "dsite"
    shutil.copytree(DIRECTORY_SITE, site)
    code, output = cli("directory", "fetch", "--publisher", "onlypropfirms", "--fixture-site", str(site))
    assert code == 0, output
    assert (
        "pages read: collected" in output
        and "structure_changed: https://onlypropfirms.com/prop-firms/contoso" in output
    )
    code, output = cli(
        "directory",
        "capture",
        "--publisher",
        "propfirmmatch-futures",
        "--url",
        "https://propfirmmatch.com/futures/prop-firm-challenges",
        "--file",
        str(DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html"),
    )
    assert code == 0 and "read as   comparison, 3 records" in output
    code, output = cli("import-capture", "--url", "https://x.test/", "--file", str(CAPTURES / "sample-funding-faq.txt"))
    assert code == 2  # neither --firm nor --publisher
    code, output = cli("directory", "list")
    assert code == 0 and "Needs manual capture" in output and "Not reviewed" in output
    code, output = cli("directory", "observations", "--publisher", "onlypropfirms", "--firm", "northwind")
    assert code == 0 and "Daily loss limit" in output
    code, output = cli("directory", "observations", "--json")
    rows = json.loads(output)
    obs = next(r for r in rows if r["publisher_key"] == "propfirmmatch-futures")
    code, output = cli("directory", "show-observation", obs["id"])
    assert code == 0 and "unverified" in output and "History:" in output
    assert cli("directory", "observations", "--status", "approved")[0] == 2
    code, output = cli("directory", "review", "list")
    assert code == 0
    assert (
        cli("directory", "review", "map", "--publisher", "onlypropfirms", "--firm-name", "Northwind", "--to", "nope")[0]
        == 3
    )
    out = tmp_path / "observations.json"
    code, output = cli("directory", "export", "--out", str(out))
    assert code == 0 and "collector-directory-observations-v1: valid" in output
    code, output = cli("validate", str(out))
    assert code == 0 and "valid collector-directory-observations-v1" in output
    code, output = cli("directory", "show", "onlypropfirms")
    assert code == 0 and "third-party comparison publisher" in output and "Page structure changed" in output
    code, output = cli("runs")
    assert code == 0 and "publisher:onlypropfirms" in output
    code, output = cli("directory", "host-add", "--publisher", "onlypropfirms", "--host", "www.northwind-futures.test")
    assert code == 3 and "not part of" in output
