"""The `collector` CLI: help, exit codes and the synthetic end-to-end walkthrough (no network)."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fundedflow_collector.cli import admin_cmds, run_cmds
from fundedflow_collector.cli.main import app
from fundedflow_collector.clock import FakeClock
from tests.conftest import CAPTURES, FIXTURE_SITE, PROJECT

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
]


def cli(*args: str) -> tuple[int, str]:
    result = runner.invoke(app, list(args))
    return result.exit_code, result.output


@pytest.fixture(autouse=True)
def fake_run_clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    clock = FakeClock()
    monkeypatch.setattr(run_cmds, "clock", clock)
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
