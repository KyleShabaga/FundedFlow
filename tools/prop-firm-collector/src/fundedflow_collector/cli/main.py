"""Entry point for the `collector` command."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from fundedflow_collector import __version__
from fundedflow_collector.cli import admin_cmds, export_cmds, inspect_cmds, registry_cmds, run_cmds
from fundedflow_collector.cli.common import AppState, configure_console

app = typer.Typer(
    name="collector",
    help=(
        "FundedFlow prop-firm collector: collects public rule pages as UNVERIFIED evidence, politely and honestly. "
        "It never logs in, bypasses blocks or interprets rules, and never touches the FundedFlow app database."
    ),
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_enable=False,
    rich_markup_mode=None,
)


def _version(value: bool) -> None:
    if value:
        typer.echo(f"fundedflow-collector {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    ctx: typer.Context,
    data_dir: Annotated[
        Path | None,
        typer.Option(
            "--data-dir",
            envvar="FFC_DATA_DIR",
            help="Collector data folder (default %LOCALAPPDATA%\\FundedFlow\\Collector).",
        ),
    ] = None,
    config: Annotated[
        Path | None,
        typer.Option(
            "--config",
            envvar="FFC_CONFIG",
            help="Settings file (default <data folder>\\collector.toml).",
        ),
    ] = None,
    version: Annotated[
        bool, typer.Option("--version", callback=_version, is_eager=True, help="Show the version.")
    ] = False,
) -> None:
    state = AppState(data_dir=data_dir, config_path=config)
    ctx.obj = state
    ctx.call_on_close(state.close)


app.command("doctor")(admin_cmds.doctor)
app.command("init-db")(admin_cmds.init_db)
app.add_typer(registry_cmds.firm_app, name="firm")
app.add_typer(registry_cmds.host_app, name="host")
app.add_typer(registry_cmds.source_app, name="source")
app.command("discover")(run_cmds.discover)
app.command("fetch")(run_cmds.fetch)
app.command("import-capture")(run_cmds.import_capture_cmd)
app.add_typer(inspect_cmds.runs_app, name="runs")
app.add_typer(inspect_cmds.snapshots_app, name="snapshots")
app.command("export")(export_cmds.export)
app.command("validate")(export_cmds.validate)
app.command("prune-raw")(admin_cmds.prune_raw_cmd)
app.command("reset")(admin_cmds.reset)


def run() -> None:
    configure_console()
    app()
