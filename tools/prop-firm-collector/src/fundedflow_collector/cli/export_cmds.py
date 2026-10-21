"""`export` and `validate`."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Annotated

import typer

from fundedflow_collector.cli import exit_codes
from fundedflow_collector.cli.common import clock, fail, handle_errors, state
from fundedflow_collector.clock import format_instant, parse_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.export.csv_diag import to_csv
from fundedflow_collector.export.envelope import SCHEMA_VERSION, build_envelope, serialise
from fundedflow_collector.export.validate import validation_errors


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".ffc-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


@handle_errors
def export(
    ctx: typer.Context,
    firm: Annotated[list[str] | None, typer.Option("--firm", help="Firm key (repeatable).")] = None,
    all_firms: Annotated[bool, typer.Option("--all", help="Every firm.")] = False,
    out: Annotated[Path | None, typer.Option("--out", help="Output file (default: exports folder).")] = None,
    include_attempts: Annotated[bool, typer.Option("--include-attempts", help="Add the full attempt log.")] = False,
    generated_at: Annotated[
        str | None, typer.Option("--generated-at", help="Fixed UTC time, for reproducible files.")
    ] = None,
    csv_out: Annotated[Path | None, typer.Option("--csv", help="Also write a diagnostic CSV (no page text).")] = None,
) -> None:
    """Write a schema-validated v1 evidence envelope (unverified) for Build 31."""
    if bool(firm) == all_firms:
        raise fail("choose --firm KEY (repeatable) or --all", exit_codes.USAGE)
    app = state(ctx)
    conn = app.connect()
    try:
        stamp = format_instant(parse_instant(generated_at)) if generated_at else format_instant(clock.now())
    except ValueError as exc:
        raise fail(f"--generated-at: {exc}", exit_codes.USAGE) from exc
    envelope = build_envelope(
        conn, firm_keys=firm if firm else None, generated_at=stamp, include_attempts=include_attempts
    )
    data = serialise(envelope)
    errors = validation_errors(json.loads(data))
    if errors:
        for line in errors:
            typer.echo(f"  {line}", err=True)
        raise fail("export failed schema validation; nothing was written", exit_codes.SCHEMA_INVALID)
    target = out or app.paths.exports / f"collector-evidence-{stamp[:10]}-{envelope.export_id[4:12]}.json"
    _atomic_write(target, data)
    if csv_out is not None:
        _atomic_write(csv_out, to_csv(envelope))
    with transaction(conn):
        conn.execute(
            "INSERT OR REPLACE INTO export_batches (export_id, generated_at, path, firm_keys, snapshot_count,"
            " file_sha256, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                envelope.export_id,
                stamp,
                str(target.resolve()),
                json.dumps([f.firm_key for f in envelope.firms]),
                len(envelope.snapshots),
                hashlib.sha256(data).hexdigest(),
                SCHEMA_VERSION,
            ),
        )
    typer.echo(f"Wrote {target}")
    typer.echo(f"  export_id  {envelope.export_id}")
    typer.echo(f"  firms {len(envelope.firms)}, snapshots {len(envelope.snapshots)}, attempts {len(envelope.attempts)}")
    typer.echo("  schema     collector-snapshot-v1: valid")
    typer.echo("  status     unverified evidence (not rules, not verified provider data)")
    if csv_out is not None:
        typer.echo(f"  csv        {csv_out}")


@handle_errors
def validate(file: Annotated[Path, typer.Argument(exists=True, dir_okay=False)]) -> None:
    """Validate an evidence envelope file against the checked-in v1 JSON Schema."""
    try:
        document = json.loads(file.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise fail(f"{file} is not JSON: {exc}", exit_codes.SCHEMA_INVALID) from exc
    errors = validation_errors(document)
    if errors:
        for line in errors:
            typer.echo(f"  {line}")
        raise fail(f"{file} does not match collector-snapshot-v1", exit_codes.SCHEMA_INVALID)
    snapshots = len(document.get("snapshots", []))
    typer.echo(f"{file}: valid collector-snapshot-v1 ({snapshots} snapshots, {document['verification_status']})")
