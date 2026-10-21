"""`runs` and `snapshots`: read-only inspection. Page text is shown as escaped plain text, never rendered."""

from __future__ import annotations

import json
from typing import Annotated

import typer

from fundedflow_collector.cli import exit_codes
from fundedflow_collector.cli.common import echo_json, fail, handle_errors, state, table
from fundedflow_collector.db import registry, runs, snapshots
from fundedflow_collector.logging_setup import redact_url
from fundedflow_collector.policy.urls import UrlRejected, canonicalize

runs_app = typer.Typer(help="Crawl runs and their fetch attempts.", invoke_without_command=True)
snapshots_app = typer.Typer(help="Stored immutable snapshots.", invoke_without_command=True)


def _safe(text: str) -> str:
    """Strip control characters (except newlines and tabs) so page text cannot drive the terminal."""
    return "".join(ch if ch in "\n\t" or (ord(ch) >= 32 and ord(ch) != 127) else "�" for ch in text)


@runs_app.callback()
@handle_errors
def runs_list(
    ctx: typer.Context,
    firm: Annotated[str | None, typer.Option("--firm")] = None,
    limit: Annotated[int, typer.Option("--limit")] = 20,
    as_json: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """List recent runs (newest first)."""
    if ctx.invoked_subcommand is not None:
        return
    conn = state(ctx).connect()
    firm_id = registry.require_firm(conn, firm).id if firm else None
    rows = runs.list_runs(conn, firm_id, limit)
    if as_json:
        echo_json([dict(r) for r in rows])
        return
    if not rows:
        typer.echo("No runs yet.")
        return
    typer.echo(
        table(
            ["RUN", "FIRM", "COMMAND", "STARTED", "STATUS", "REQUESTS", "ATTEMPTS"],
            [
                [
                    r["id"],
                    r["firm_key"],
                    r["command"],
                    r["started_at"],
                    r["status"],
                    r["fetches_used"],
                    r["attempt_count"],
                ]
                for r in rows
            ],
        )
    )


@runs_app.command("show")
@handle_errors
def runs_show(ctx: typer.Context, run_id: str, as_json: Annotated[bool, typer.Option("--json")] = False) -> None:
    """Every attempt in one run, with outcome and reason."""
    conn = state(ctx).connect()
    run = runs.get_run(conn, run_id)
    if run is None:
        raise fail(f"unknown run {run_id}", exit_codes.CONFIG)
    attempts = runs.list_attempts(conn, run_id)
    if as_json:
        echo_json({"run": dict(run), "attempts": [dict(a) for a in attempts]})
        return
    typer.echo(f"Run {run['id']} ({run['firm_key']}, {run['command']}): {run['status']}")
    typer.echo(f"  started {run['started_at']}  finished {run['finished_at'] or '-'}  requests {run['fetches_used']}")
    counts = runs.outcome_counts(conn, run_id)
    typer.echo("  outcomes: " + (", ".join(f"{k} {v}" for k, v in counts.items()) or "none"))
    typer.echo("")
    rows = [
        [
            a["outcome"],
            a["http_status"],
            a["fetch_method"],
            redact_url(a["requested_url"]),
            a["policy_reason"] or a["error_detail"] or "",
        ]
        for a in attempts
    ]
    typer.echo(table(["OUTCOME", "HTTP", "METHOD", "URL", "REASON"], rows, max_width=70))


@snapshots_app.callback()
@handle_errors
def snapshots_list(
    ctx: typer.Context,
    firm: Annotated[str | None, typer.Option("--firm")] = None,
    url: Annotated[str | None, typer.Option("--url")] = None,
    limit: Annotated[int, typer.Option("--limit")] = 50,
    as_json: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """List snapshots (newest first)."""
    if ctx.invoked_subcommand is not None:
        return
    conn = state(ctx).connect()
    firm_id = registry.require_firm(conn, firm).id if firm else None
    canonical = None
    if url is not None:
        try:
            canonical = canonicalize(url)
        except UrlRejected as exc:
            raise fail(str(exc), exit_codes.CONFIG) from exc
    rows = snapshots.list_snapshots(conn, firm_id, canonical, limit)
    if as_json:
        echo_json([dict(r) for r in rows])
        return
    if not rows:
        typer.echo("No snapshots yet.")
        return
    typer.echo(
        table(
            ["SNAPSHOT", "FIRM", "CAPTURED", "METHOD", "CHARS", "URL"],
            [
                [r["id"], r["firm_key"], r["captured_at"], r["fetch_method"], r["text_chars"], r["canonical_url"]]
                for r in rows
            ],
            max_width=70,
        )
    )


@snapshots_app.command("show")
@handle_errors
def snapshots_show(
    ctx: typer.Context,
    snapshot_id: str,
    text: Annotated[bool, typer.Option("--text", help="Print the full text.")] = False,
    as_json: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """One snapshot's provenance, structure summary and (with --text) its normalised text."""
    conn = state(ctx).connect()
    row = snapshots.get_snapshot(conn, snapshot_id)
    if row is None:
        raise fail(f"unknown snapshot {snapshot_id}", exit_codes.CONFIG)
    first, last, count = snapshots.observations(conn, snapshot_id)
    structure = json.loads(row["structure"])
    if as_json:
        echo_json({**dict(row), "structure": structure, "observations": {"first": first, "last": last, "count": count}})
        return
    typer.echo(f"Snapshot {row['id']} (unverified evidence)")
    for label, value in [
        ("requested", row["requested_url"]),
        ("final", row["final_url"]),
        ("captured", row["captured_at"]),
        ("method", row["fetch_method"]),
        ("channel", row["source_channel"]),
        ("http", row["http_status"]),
        ("type", row["content_type"]),
        ("title", row["title"]),
        ("hash", row["content_hash"]),
        ("parser", f"{row['parser_name']} ({row['parser_version']})"),
        ("warnings", row["warnings"]),
        ("seen", f"{count} time(s), first {first}, last {last}"),
        (
            "structure",
            f"{len(structure['headings'])} headings, {len(structure['tables'])} tables, "
            f"{len(structure['links'])} links",
        ),
        ("text", f"{len(row['text'])} characters"),
    ]:
        typer.echo(f"  {label:<10} {_safe(str(value)) if value is not None else '-'}")
    if text:
        typer.echo("")
        typer.echo(_safe(row["text"]))
