"""`doctor`, `init-db`, `prune-raw` and `reset`."""

from __future__ import annotations

import shutil
import sys
from importlib import metadata
from pathlib import Path
from typing import Annotated

import typer

from fundedflow_collector import __version__
from fundedflow_collector.cli import exit_codes
from fundedflow_collector.cli.common import clock, fail, handle_errors, state
from fundedflow_collector.config import ConfigError
from fundedflow_collector.db import registry
from fundedflow_collector.db.connection import RunLock
from fundedflow_collector.db.migrate import bundled_migrations, current_version
from fundedflow_collector.db.snapshots import prune_raw
from fundedflow_collector.net.client import build_user_agent
from fundedflow_collector.outcomes import HostRole
from fundedflow_collector.paths import guard_against_app_database
from fundedflow_collector.policy import circuit
from fundedflow_collector.policy.terms import review_expires, terms_block_reason
from fundedflow_collector.render.browser import browser_status
from fundedflow_collector.safety import banned_installed

PINNED = {"httpx": "0.28.1", "httpcore": "1.0.9"}
EXAMPLE_CONFIG = """# FundedFlow collector settings. Every value has a safe default; see the README for the full list.

[user_agent]
# Required before live fetching: a page that explains this collector (your repository or a page you control).
# info_url = "https://github.com/KyleShabaga/FundedFlow"
# Optional contact shown in the User-Agent, e.g. an email address.
# contact = "you@example.com"

[pacing]
# min_delay_seconds = 2.0            # floor 1.0
# unclear_terms_delay_seconds = 5.0  # floor 5.0

[budget]
# fetches_per_firm_run = 75          # ceiling 300

[browser]
# enabled = "auto"                   # "auto" uses the optional [browser] extra when installed; "off" never does

[raw]
# retain = false                     # keep raw response bytes (default off)
# retention_days = 90
"""


@handle_errors
def init_db(ctx: typer.Context) -> None:
    """Create the collector data folder and database (safe to run again)."""
    app = state(ctx)
    paths = app.paths
    paths.data_dir.mkdir(parents=True, exist_ok=True)
    existed = paths.db.exists()
    conn = app.connect(create=True)
    version = current_version(conn)
    conn.close()
    if not app.config_file.exists() and app.config_path is None:
        app.config_file.write_text(EXAMPLE_CONFIG, encoding="utf-8")
        typer.echo(f"Wrote example settings to {app.config_file}")
    typer.echo(f"{'Database ready' if existed else 'Created database'}: {paths.db} (schema version {version})")
    typer.echo(f"Logs:    {paths.logs}")
    typer.echo(f"Exports: {paths.exports}")


@handle_errors
def doctor(ctx: typer.Context) -> None:
    """Check the installation and safety settings; list terms reviews and stopped hosts."""
    app = state(ctx)
    problems = 0

    def line(status: str, label: str, detail: str) -> None:
        typer.echo(f"[{status:<4}] {label:<22} {detail}")

    py = sys.version_info
    ok_py = py >= (3, 12)
    problems += 0 if ok_py else 1
    line("ok" if ok_py else "FAIL", "python", f"{py.major}.{py.minor}.{py.micro}")
    line("ok", "collector", __version__)
    line("ok", "data folder", str(app.paths.data_dir))
    try:
        settings, _ = app.settings()
        line("ok", "settings", str(app.config_file) + ("" if app.config_file.exists() else " (not found; defaults)"))
    except ConfigError as exc:
        line("FAIL", "settings", str(exc))
        raise typer.Exit(exit_codes.CONFIG) from exc
    if settings.user_agent.info_url:
        line("ok", "user-agent info URL", settings.user_agent.info_url)
        line("ok", "user-agent", build_user_agent(settings))
    else:
        line("WARN", "user-agent info URL", "not set: live fetching is refused until user_agent.info_url is set")
    banned = banned_installed()
    problems += len(banned)
    line("FAIL" if banned else "ok", "banned packages", ", ".join(banned) if banned else "none installed")
    for name, expected in PINNED.items():
        actual = metadata.version(name)
        good = actual == expected
        problems += 0 if good else 1
        line("ok" if good else "FAIL", f"{name} pin", actual if good else f"{actual} (tested with {expected})")
    available, detail = browser_status()
    line("ok" if available else "info", "browser extra", detail if available else f"not available: {detail}")
    line("ok", "proxies/cookies", "system proxies ignored (trust_env=False); no cookies stored or sent")
    if not app.paths.db.exists():
        line("WARN", "database", "not created yet: run `collector init-db`")
        raise typer.Exit(exit_codes.CONFIG if problems else exit_codes.OK)
    conn = app.connect()
    version = current_version(conn)
    latest = len(bundled_migrations())
    line("ok" if version == latest else "WARN", "database", f"{app.paths.db} (schema {version}/{latest})")
    now = clock.now()
    hosts = registry.list_hosts(conn)
    if not hosts:
        line("info", "hosts", "none registered")
    for host in hosts:
        firm = registry.get_firm_by_id(conn, host.firm_id)
        if host.role is HostRole.ASSET:
            line("info", f"terms {host.host}", f"{firm.firm_key}: asset host (browser sub-resources only)")
            continue
        reason = terms_block_reason(host, now)
        expires = review_expires(host)
        decision = host.terms_decision.value if host.terms_decision else "not reviewed"
        if reason is None:
            line(
                "ok",
                f"terms {host.host}",
                f"{firm.firm_key}: {decision}, review valid until {expires:%Y-%m-%d}" if expires else decision,
            )
        else:
            line("WARN", f"terms {host.host}", f"{firm.firm_key}: {decision}; manual capture only ({reason})")
    open_circuits = circuit.list_open(conn, now)
    if not open_circuits:
        line("ok", "stopped hosts", "none")
    for c in open_circuits:
        until = f", cools down at {c.cooldown_until}" if c.cooldown_until else ", needs `collector host reenable`"
        line("WARN", f"stopped {c.host}", f"{c.state.value}: {c.reason}{until}")
    typer.echo("")
    typer.echo("Healthy." if problems == 0 else f"{problems} problem(s) found.")
    raise typer.Exit(exit_codes.CONFIG if problems else exit_codes.OK)


@handle_errors
def prune_raw_cmd(ctx: typer.Context) -> None:
    """Delete stored raw response bytes past their retention date. Snapshots are never deleted."""
    app = state(ctx)
    conn = app.connect()
    with RunLock(app.paths.data_dir):
        removed = prune_raw(conn, clock.now())
    typer.echo(f"Removed {removed} expired raw payload(s).")


@handle_errors
def reset(
    ctx: typer.Context,
    yes: Annotated[bool, typer.Option("--yes", help="Confirm deleting the collector's own data.")] = False,
    include_config: Annotated[bool, typer.Option("--include-config", help="Also delete collector.toml.")] = False,
) -> None:
    """Delete the collector database, logs and exports in the collector data folder. Never touches the app."""
    app = state(ctx)
    paths = app.paths
    guard_against_app_database(paths.db)
    targets: list[Path] = [paths.db, paths.logs, paths.exports]
    targets += sorted(paths.data_dir.glob("collector.db*")) if paths.data_dir.exists() else []
    if include_config:
        targets.append(paths.default_config)
    existing = sorted({t for t in targets if t.exists()})
    if not existing:
        typer.echo(f"Nothing to delete in {paths.data_dir}.")
        return
    if not yes:
        for target in existing:
            typer.echo(f"  would delete {target}")
        raise fail("add --yes to delete these collector files", exit_codes.USAGE)
    with RunLock(paths.data_dir):
        for target in existing:
            if paths.data_dir not in target.resolve().parents:
                raise fail(f"refusing to delete {target}: outside the collector data folder", exit_codes.DATABASE)
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            except PermissionError as exc:
                raise fail(
                    f"{target} is in use; close other collector windows and try again", exit_codes.DATABASE
                ) from exc
            typer.echo(f"  deleted {target}")
    typer.echo("Collector data reset. The FundedFlow app database was not touched.")
