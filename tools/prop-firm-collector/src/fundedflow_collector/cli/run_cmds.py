"""`discover`, `fetch` and `import-capture`."""

from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path
from typing import Annotated

import typer

from fundedflow_collector.capture import import_capture
from fundedflow_collector.cli import exit_codes
from fundedflow_collector.cli.common import AppState, clock, fail, handle_errors, state, table
from fundedflow_collector.config import Settings
from fundedflow_collector.db import registry
from fundedflow_collector.db.connection import RunLock
from fundedflow_collector.db.migrate import recover_interrupted_runs
from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.net.client import Fetcher, build_user_agent, make_client
from fundedflow_collector.net.fixture_transport import FixtureSite
from fundedflow_collector.net.pinned_backend import PinnedNetworkBackend
from fundedflow_collector.net.resolver import SystemResolver
from fundedflow_collector.net.transport import PinnedTransport
from fundedflow_collector.outcomes import OUTCOME_INFO, Category
from fundedflow_collector.parse.document import ParseError, ParseTimeout
from fundedflow_collector.render.browser import PlaywrightRenderer, Renderer, browser_status
from fundedflow_collector.runner import Command, Environment, RunOptions, RunSummary, run_firms, user_agent_suffix


def build_environment(
    conn: sqlite3.Connection,
    settings: Settings,
    config_sha: str,
    *,
    fixture_dir: Path | None,
    use_browser: bool,
    headed: bool,
    live: bool,
) -> Environment:
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
        available, _ = browser_status()
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
        progress=lambda text: typer.echo(text),
    )


def _select_firms(conn: sqlite3.Connection, firm: str | None, all_firms: bool) -> list[registry.Firm]:
    if bool(firm) == all_firms:
        raise fail("choose exactly one of --firm KEY or --all", exit_codes.USAGE)
    if all_firms:
        return [f for f in registry.list_firms(conn) if f.enabled]
    assert firm is not None
    return [registry.require_firm(conn, firm)]


def _report(summaries: list[RunSummary], dry_run: bool) -> int:
    code = exit_codes.OK
    for summary in summaries:
        if summary.message:
            typer.echo(summary.message)
        if dry_run:
            typer.echo(f"Dry run for {summary.firm_key} (no network, nothing saved):")
            if summary.dry_run_lines:
                typer.echo(table(["DECISION", "URL", "WHY"], summary.dry_run_lines, max_width=80))
            else:
                typer.echo("  No known targets yet. Add sources, or run `collector discover`.")
        else:
            counts = summary.counts()
            parts = ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "nothing to do"
            typer.echo(f"{summary.firm_key}: {summary.status}; {summary.fetches_used} requests; {parts}")
            if summary.not_fetched:
                typer.echo(f"  {summary.not_fetched} queued URLs were not fetched (budget or deadline).")
            if summary.run_id:
                typer.echo(f"  Details: collector runs show {summary.run_id}")
            blocked = sorted(
                {r.outcome.value for r in summary.results if OUTCOME_INFO[r.outcome].category is not Category.OK}
            )
            for outcome in blocked:
                info = OUTCOME_INFO[next(r.outcome for r in summary.results if r.outcome.value == outcome)]
                typer.echo(f"  {outcome}: {info.action}")
        code = max(code, summary.exit_code())
    return code


def _run(
    ctx: typer.Context, command: Command, firm: str | None, all_firms: bool, options: RunOptions, *, headed: bool
) -> None:
    app: AppState = state(ctx)
    settings, sha = app.settings()
    conn = app.connect()
    firms = _select_firms(conn, firm, all_firms)
    if not firms:
        typer.echo("No enabled firms.")
        return
    if options.dry_run:
        env = build_environment(
            conn, settings, sha, fixture_dir=options.fixture_site, use_browser=False, headed=False, live=False
        )
        raise typer.Exit(_report(run_firms(env, firms, options), dry_run=True))
    with RunLock(app.paths.data_dir):
        recover_interrupted_runs(conn)
        env = build_environment(
            conn,
            settings,
            sha,
            fixture_dir=options.fixture_site,
            use_browser=options.use_browser,
            headed=headed,
            live=True,
        )
        if options.fixture_site is not None:
            typer.echo(f"Fixture replay from {options.fixture_site} (no network; recorded as fixture_replay).")
        elif env.renderer is None and options.use_browser and command == "fetch":
            typer.echo("Browser fallback: not available (optional [browser] extra not installed).")
        try:
            summaries = run_firms(env, firms, options)
        finally:
            if env.fetcher is not None:
                env.fetcher.close()
    raise typer.Exit(_report(summaries, dry_run=False))


FirmOpt = Annotated[str | None, typer.Option("--firm", help="Firm key.")]
AllOpt = Annotated[bool, typer.Option("--all", help="Every enabled firm, one after another.")]
DryRunOpt = Annotated[bool, typer.Option("--dry-run", help="Show allowed vs blocked targets; no network.")]
FixtureOpt = Annotated[
    Path | None,
    typer.Option(
        "--fixture-site",
        help="Replay a local fixture site directory instead of the network.",
        exists=True,
        file_okay=False,
    ),
]


@handle_errors
def discover(
    ctx: typer.Context,
    firm: FirmOpt = None,
    all_firms: AllOpt = False,
    dry_run: DryRunOpt = False,
    fixture_site: FixtureOpt = None,
) -> None:
    """Find candidate pages from robots.txt sitemaps, sitemap.xml and Zendesk listings. Stores no snapshots."""
    options = RunOptions(command="discover", dry_run=dry_run, fixture_site=fixture_site)
    _run(ctx, "discover", firm, all_firms, options, headed=False)


@handle_errors
def fetch(
    ctx: typer.Context,
    firm: FirmOpt = None,
    all_firms: AllOpt = False,
    dry_run: DryRunOpt = False,
    force: Annotated[bool, typer.Option("--force", help="Fetch even if sitemap lastmod says unchanged.")] = False,
    no_discover: Annotated[bool, typer.Option("--no-discover", help="Skip discovery; use known URLs.")] = False,
    no_browser: Annotated[bool, typer.Option("--no-browser", help="Never use the browser fallback.")] = False,
    headed: Annotated[bool, typer.Option("--headed", help="Show the browser window (debugging).")] = False,
    max_fetches: Annotated[int | None, typer.Option("--max-fetches", help="Lower budget for this run.")] = None,
    fixture_site: FixtureOpt = None,
) -> None:
    """Discover (unless --no-discover), then fetch seeds and relevant pages within the budget."""
    if max_fetches is not None and not 1 <= max_fetches <= 300:
        raise fail("--max-fetches must be between 1 and 300", exit_codes.USAGE)
    options = RunOptions(
        command="fetch",
        dry_run=dry_run,
        force=force,
        discover=not no_discover,
        use_browser=not no_browser,
        max_fetches=max_fetches,
        fixture_site=fixture_site,
    )
    _run(ctx, "fetch", firm, all_firms, options, headed=headed)


@handle_errors
def import_capture_cmd(
    ctx: typer.Context,
    firm: Annotated[str, typer.Option("--firm")],
    url: Annotated[str, typer.Option("--url", help="The page's original address.")],
    file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, help=".html, .htm, .pdf or .txt")],
    captured_at: Annotated[
        str | None, typer.Option("--captured-at", help="When you saved it, UTC, e.g. 2026-10-20T14:30:00Z.")
    ] = None,
) -> None:
    """Import a page you saved from your browser. Makes no network requests."""
    app = state(ctx)
    settings, _ = app.settings()
    conn = app.connect()
    with RunLock(app.paths.data_dir):
        try:
            result = import_capture(conn, settings, clock, firm_key=firm, url=url, file=file, captured_at=captured_at)
        except RegistryError:
            raise
        except (ParseError, ParseTimeout) as exc:
            raise fail(f"{file.name} could not be parsed: {exc}", exit_codes.FETCH_FAILED) from exc
        except ValueError as exc:
            raise fail(f"--captured-at: {exc}", exit_codes.USAGE) from exc
    typer.echo(f"{result.outcome.value}: {result.snapshot_id}")
    typer.echo(f"  title     {result.title or '-'}")
    typer.echo(f"  text      {result.text_chars} characters")
    typer.echo(f"  captured  {result.captured_at} (manual_capture)")
    if result.warnings:
        typer.echo(f"  warnings  {', '.join(result.warnings)}")
