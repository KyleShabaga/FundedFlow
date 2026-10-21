"""`doctor`, `init-db`, `prune-raw` and `reset`."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Annotated

import typer

from fundedflow_collector import services
from fundedflow_collector.cli import exit_codes
from fundedflow_collector.cli.common import clock, fail, handle_errors, state
from fundedflow_collector.config import EXAMPLE_CONFIG
from fundedflow_collector.db.connection import RunLock
from fundedflow_collector.db.migrate import current_version
from fundedflow_collector.db.snapshots import prune_raw
from fundedflow_collector.paths import guard_against_app_database
from fundedflow_collector.render.browser import browser_status


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
    health = services.health_checks(app.paths, app.config_file, clock, browser_check=browser_status)
    for check in health.checks:
        typer.echo(f"[{check.status:<4}] {check.label:<22} {check.detail}")
    if health.stopped_early:
        failed_settings = any(c.label == "settings" and c.status == "FAIL" for c in health.checks)
        raise typer.Exit(exit_codes.CONFIG if health.problems or failed_settings else exit_codes.OK)
    typer.echo("")
    typer.echo("Healthy." if health.problems == 0 else f"{health.problems} problem(s) found.")
    raise typer.Exit(exit_codes.CONFIG if health.problems else exit_codes.OK)


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
