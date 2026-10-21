"""`firm`, `host` and `source` commands (D2 registry)."""

from __future__ import annotations

import tomllib
from datetime import datetime
from pathlib import Path
from typing import Annotated

import typer
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fundedflow_collector.cli.common import clock, echo_json, handle_errors, state, table
from fundedflow_collector.db import registry
from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.outcomes import HostRole, SourceKind, TermsDecision
from fundedflow_collector.policy import circuit
from fundedflow_collector.policy.terms import review_expires, terms_block_reason
from fundedflow_collector.policy.urls import UrlRejected, normalise_host

firm_app = typer.Typer(help="Register and maintain prop firms.", no_args_is_help=True)
host_app = typer.Typer(help="Authorise a firm's own hosts and record terms-of-use reviews.", no_args_is_help=True)
source_app = typer.Typer(help="Seed URLs: pages, PDFs, sitemaps and Zendesk help centers.", no_args_is_help=True)

JsonOpt = Annotated[bool, typer.Option("--json", help="Machine-readable output.")]
FirmOpt = Annotated[str, typer.Option("--firm", help="Firm key, e.g. example-firm.")]


# ---------------------------------------------------------------- firm


@firm_app.command("add")
@handle_errors
def firm_add(
    ctx: typer.Context,
    key: Annotated[str, typer.Argument(help="Short key: lowercase letters, digits, hyphens.")],
    name: Annotated[str, typer.Option("--name", help="Display name.")],
    homepage: Annotated[str, typer.Option("--homepage", help="Official homepage URL.")],
    max_fetches: Annotated[int | None, typer.Option(help="Per-run fetch budget for this firm (1-300).")] = None,
    max_depth: Annotated[int | None, typer.Option(help="Link-following depth (0-5).")] = None,
    exclude: Annotated[list[str] | None, typer.Option("--exclude", help="Excluded path glob, e.g. /blog/*.")] = None,
) -> None:
    """Register a firm. Its hosts still need `host add` and a terms review before anything is fetched."""
    conn = state(ctx).connect()
    firm = registry.add_firm(
        conn,
        firm_key=key,
        display_name=name,
        homepage_url=homepage,
        now=clock.now(),
        max_fetches=max_fetches,
        max_depth=max_depth,
        excluded_paths=exclude or [],
    )
    typer.echo(f"Added firm {firm.firm_key} ({firm.display_name}).")
    typer.echo(f"Next: collector host add --firm {firm.firm_key} --host <host> --role homepage")


@firm_app.command("list")
@handle_errors
def firm_list(ctx: typer.Context, as_json: JsonOpt = False) -> None:
    """List firms."""
    conn = state(ctx).connect()
    firms = registry.list_firms(conn)
    if as_json:
        echo_json([f.__dict__ for f in firms])
        return
    if not firms:
        typer.echo("No firms yet. Add one with `collector firm add`.")
        return
    rows = []
    for f in firms:
        hosts = registry.list_hosts(conn, f.id)
        sources = registry.list_sources(conn, f.id)
        rows.append(
            [
                f.firm_key,
                f.display_name,
                "yes" if f.enabled else f"no ({f.disabled_reason})",
                len(hosts),
                len(sources),
                f.max_fetches or "default",
            ]
        )
    typer.echo(table(["FIRM", "NAME", "ENABLED", "HOSTS", "SOURCES", "MAX FETCHES"], rows))


@firm_app.command("show")
@handle_errors
def firm_show(ctx: typer.Context, key: str, as_json: JsonOpt = False) -> None:
    """Show one firm with its hosts and sources."""
    conn = state(ctx).connect()
    firm = registry.require_firm(conn, key)
    hosts = registry.list_hosts(conn, firm.id)
    sources = registry.list_sources(conn, firm.id)
    if as_json:
        echo_json(
            {"firm": firm.__dict__, "hosts": [h.__dict__ for h in hosts], "sources": [s.__dict__ for s in sources]}
        )
        return
    typer.echo(f"{firm.firm_key}: {firm.display_name}")
    typer.echo(f"  homepage        {firm.homepage_url}")
    typer.echo(f"  enabled         {'yes' if firm.enabled else 'no: ' + str(firm.disabled_reason)}")
    typer.echo(f"  max fetches     {firm.max_fetches or 'default'}   max depth {firm.max_depth or 'default'}")
    typer.echo(f"  excluded paths  {', '.join(firm.excluded_paths) or '-'}")
    typer.echo("")
    typer.echo(_hosts_table(conn, hosts) if hosts else "  No hosts yet.")
    typer.echo("")
    typer.echo(_sources_table(sources) if sources else "  No sources yet.")


@firm_app.command("update")
@handle_errors
def firm_update(
    ctx: typer.Context,
    key: str,
    name: Annotated[str | None, typer.Option("--name")] = None,
    homepage: Annotated[str | None, typer.Option("--homepage")] = None,
    max_fetches: Annotated[int | None, typer.Option()] = None,
    max_depth: Annotated[int | None, typer.Option()] = None,
    exclude: Annotated[list[str] | None, typer.Option("--exclude", help="Replaces the excluded path list.")] = None,
    clear_limits: Annotated[bool, typer.Option(help="Go back to the default budget and depth.")] = False,
) -> None:
    """Update a firm's name, homepage, limits or excluded paths."""
    conn = state(ctx).connect()
    firm = registry.require_firm(conn, key)
    firm = registry.update_firm(
        conn,
        firm,
        now=clock.now(),
        display_name=name,
        homepage_url=homepage,
        max_fetches=max_fetches,
        max_depth=max_depth,
        excluded_paths=exclude,
        clear_limits=clear_limits,
    )
    typer.echo(f"Updated {firm.firm_key}.")


@firm_app.command("disable")
@handle_errors
def firm_disable(ctx: typer.Context, key: str, reason: Annotated[str, typer.Option("--reason")]) -> None:
    """Disable a firm. Nothing is deleted; its evidence stays."""
    conn = state(ctx).connect()
    firm = registry.set_firm_enabled(conn, registry.require_firm(conn, key), False, reason, clock.now())
    typer.echo(f"Disabled {firm.firm_key}: {reason}")


@firm_app.command("enable")
@handle_errors
def firm_enable(ctx: typer.Context, key: str) -> None:
    """Enable a disabled firm."""
    conn = state(ctx).connect()
    firm = registry.set_firm_enabled(conn, registry.require_firm(conn, key), True, None, clock.now())
    typer.echo(f"Enabled {firm.firm_key}.")


class _TermsSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: TermsDecision
    url: str
    notes: str | None = None
    min_delay: float | None = Field(default=None, ge=1.0)
    accept_unclear: bool = False


class _HostSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    host: str
    role: HostRole
    terms: _TermsSpec | None = None


class _SourceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str
    kind: SourceKind = SourceKind.PAGE
    label: str | None = None
    priority: int = 0
    requires_js: bool = False
    no_js: bool = False


class _FirmSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    name: str
    homepage: str
    max_fetches: int | None = None
    max_depth: int | None = None
    excluded_paths: list[str] = []


class _FirmFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    firm: _FirmSpec
    hosts: list[_HostSpec] = []
    sources: list[_SourceSpec] = []


@firm_app.command("import")
@handle_errors
def firm_import(ctx: typer.Context, file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False)]) -> None:
    """Create or update a firm, its hosts, terms reviews and sources from a TOML file."""
    try:
        spec = _FirmFile.model_validate(tomllib.loads(file.read_text(encoding="utf-8-sig")))
    except (tomllib.TOMLDecodeError, ValidationError) as exc:
        raise RegistryError(f"{file}: {exc}") from exc
    conn = state(ctx).connect()
    now = clock.now()
    f = spec.firm
    firm = registry.get_firm(conn, f.key)
    if firm is None:
        firm = registry.add_firm(
            conn,
            firm_key=f.key,
            display_name=f.name,
            homepage_url=f.homepage,
            now=now,
            max_fetches=f.max_fetches,
            max_depth=f.max_depth,
            excluded_paths=f.excluded_paths,
        )
        typer.echo(f"Added firm {firm.firm_key}.")
    else:
        firm = registry.update_firm(
            conn,
            firm,
            now=now,
            display_name=f.name,
            homepage_url=f.homepage,
            max_fetches=f.max_fetches,
            max_depth=f.max_depth,
            excluded_paths=f.excluded_paths,
        )
        typer.echo(f"Updated firm {firm.firm_key}.")
    for h in spec.hosts:
        try:
            name = normalise_host(h.host)
        except UrlRejected as exc:
            raise RegistryError(str(exc)) from exc
        host = registry.get_host(conn, firm.id, name) or registry.add_host(conn, firm, name, h.role, now)
        if h.terms is not None:
            t = h.terms
            unchanged = (
                host.terms_decision is t.decision
                and host.terms_url is not None
                and host.terms_notes == t.notes
                and host.terms_min_delay_seconds == t.min_delay
                and (host.unclear_terms_accepted_at is not None) == t.accept_unclear
            )
            if not unchanged:
                registry.record_terms(
                    conn,
                    firm,
                    host,
                    decision=t.decision,
                    terms_url=t.url,
                    now=now,
                    notes=t.notes,
                    min_delay_seconds=t.min_delay,
                    accept_unclear=t.accept_unclear,
                )
        typer.echo(f"  host {name} ({h.role.value})")
    for s in spec.sources:
        try:
            source = registry.add_source(
                conn,
                firm,
                url=s.url,
                kind=s.kind,
                now=now,
                requires_js=s.requires_js,
                js_disabled=s.no_js,
                label=s.label,
                priority=s.priority,
            )
        except RegistryError as exc:
            if "already exists" not in str(exc):
                raise
            from fundedflow_collector import ids
            from fundedflow_collector.policy.urls import canonicalize

            existing = registry.require_source(conn, ids.source_id(firm.firm_key, canonicalize(s.url)))
            source = registry.update_source(
                conn,
                existing,
                now=now,
                label=s.label,
                priority=s.priority,
                requires_js=s.requires_js,
                js_disabled=s.no_js,
            )
        typer.echo(f"  source {source.canonical_url} ({source.kind.value})")


# ---------------------------------------------------------------- host


def _hosts_table(conn: object, hosts: list[registry.Host]) -> str:
    import sqlite3

    assert isinstance(conn, sqlite3.Connection)
    now = clock.now()
    rows = []
    for h in hosts:
        c = circuit.current(conn, h.host, now)
        blocked = terms_block_reason(h, now)
        expires = review_expires(h)
        terms = h.terms_decision.value if h.terms_decision else "not reviewed"
        if h.terms_decision is TermsDecision.UNCLEAR:
            terms += " (acknowledged)" if h.unclear_terms_accepted_at else " (not acknowledged)"
        status = "manual capture only" if h.role is not HostRole.ASSET and blocked else "ok"
        if h.role is HostRole.ASSET:
            status = "browser assets only"
        circuit_text = c.state.value + (f" until {c.cooldown_until}" if c.cooldown_until else "")
        rows.append([h.host, h.role.value, terms, _date(expires), circuit_text, status])
    return table(["HOST", "ROLE", "TERMS", "REVIEW EXPIRES", "CIRCUIT", "LIVE FETCH"], rows)


def _date(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d") if value else "-"


@host_app.command("add")
@handle_errors
def host_add(
    ctx: typer.Context,
    firm: FirmOpt,
    host: Annotated[str, typer.Option("--host", help="Host name only, e.g. help.example.com.")],
    role: Annotated[HostRole, typer.Option("--role", help="asset = browser scripts/data only.")],
) -> None:
    """Authorise one of the firm's own hosts. Subdomains are never implied: add each one."""
    conn = state(ctx).connect()
    record = registry.add_host(conn, registry.require_firm(conn, firm), host, role, clock.now())
    typer.echo(f"Authorised {record.host} for {firm} as {record.role.value}.")
    if role is not HostRole.ASSET:
        typer.echo(f"Next: read the site's terms, then `collector host terms --firm {firm} --host {record.host} ...`")


@host_app.command("list")
@handle_errors
def host_list(
    ctx: typer.Context, firm: Annotated[str | None, typer.Option("--firm")] = None, as_json: JsonOpt = False
) -> None:
    """Hosts with terms decision, review expiry and circuit state."""
    conn = state(ctx).connect()
    firm_id = registry.require_firm(conn, firm).id if firm else None
    hosts = registry.list_hosts(conn, firm_id)
    if as_json:
        now = clock.now()
        echo_json([{**h.__dict__, "circuit": circuit.current(conn, h.host, now).__dict__} for h in hosts])
        return
    typer.echo(_hosts_table(conn, hosts) if hosts else "No hosts registered.")


@host_app.command("terms")
@handle_errors
def host_terms(
    ctx: typer.Context,
    firm: FirmOpt,
    host: Annotated[str, typer.Option("--host")],
    decision: Annotated[TermsDecision, typer.Option("--decision")],
    terms_url: Annotated[str, typer.Option("--terms-url", help="The terms page you read.")],
    notes: Annotated[str | None, typer.Option("--notes", help="What the terms say about automated access.")] = None,
    min_delay: Annotated[float | None, typer.Option("--min-delay", help="Slower pacing the terms ask for (s).")] = None,
    accept_unclear_terms: Annotated[
        bool, typer.Option("--accept-unclear-terms", help="Acknowledge unclear terms and allow slow (5 s) fetching.")
    ] = False,
) -> None:
    """Record your terms-of-use review for a host (valid for 365 days)."""
    conn = state(ctx).connect()
    firm_row = registry.require_firm(conn, firm)
    record = registry.record_terms(
        conn,
        firm_row,
        registry.require_host(conn, firm_row, host),
        decision=decision,
        terms_url=terms_url,
        now=clock.now(),
        notes=notes,
        min_delay_seconds=min_delay,
        accept_unclear=accept_unclear_terms,
    )
    reason = terms_block_reason(record, clock.now())
    typer.echo(f"Recorded terms for {record.host}: {decision.value}.")
    typer.echo("Live fetching: allowed." if reason is None else f"Live fetching: not allowed ({reason}).")


@host_app.command("reenable")
@handle_errors
def host_reenable(
    ctx: typer.Context,
    host: Annotated[str, typer.Option("--host")],
    reason: Annotated[str, typer.Option("--reason", help="Why it is OK to try again.")],
) -> None:
    """Close a host's circuit after a block. Only do this if the firm agreed or the cause is fixed."""
    conn = state(ctx).connect()
    try:
        name = normalise_host(host)
    except UrlRejected as exc:
        raise RegistryError(str(exc)) from exc
    before = circuit.current(conn, name, clock.now())
    circuit.reenable(conn, name, reason, clock.now())
    typer.echo(f"Re-enabled {name} (was {before.state.value}).")


# ---------------------------------------------------------------- source


def _sources_table(sources: list[registry.Source]) -> str:
    rows = [
        [
            s.id,
            s.canonical_url,
            s.kind.value,
            s.source_channel.value,
            ("js" if s.requires_js else "no-js" if s.js_disabled else "auto"),
            "yes" if s.enabled else "no",
            s.last_outcome,
            (s.last_attempt_at or "")[:16],
        ]
        for s in sources
    ]
    return table(
        ["SOURCE", "URL", "KIND", "CHANNEL", "JS", "ENABLED", "LAST OUTCOME", "LAST ATTEMPT"], rows, max_width=70
    )


@source_app.command("add")
@handle_errors
def source_add(
    ctx: typer.Context,
    firm: FirmOpt,
    url: Annotated[str, typer.Option("--url")],
    kind: Annotated[SourceKind, typer.Option("--kind")] = SourceKind.PAGE,
    requires_js: Annotated[bool, typer.Option("--requires-js", help="Always render with the browser.")] = False,
    no_js: Annotated[bool, typer.Option("--no-js", help="Never use the browser for this source.")] = False,
    label: Annotated[str | None, typer.Option("--label")] = None,
    priority: Annotated[int, typer.Option("--priority", help="-100..100; higher is fetched first.")] = 0,
) -> None:
    """Add a seed URL on one of the firm's authorised hosts."""
    conn = state(ctx).connect()
    source = registry.add_source(
        conn,
        registry.require_firm(conn, firm),
        url=url,
        kind=kind,
        now=clock.now(),
        requires_js=requires_js,
        js_disabled=no_js,
        label=label,
        priority=priority,
    )
    typer.echo(f"Added source {source.id}: {source.canonical_url} ({source.kind.value}).")


@source_app.command("list")
@handle_errors
def source_list(
    ctx: typer.Context, firm: Annotated[str | None, typer.Option("--firm")] = None, as_json: JsonOpt = False
) -> None:
    """List sources, including pages found by discovery."""
    conn = state(ctx).connect()
    firm_id = registry.require_firm(conn, firm).id if firm else None
    sources = registry.list_sources(conn, firm_id)
    if as_json:
        echo_json([s.__dict__ for s in sources])
        return
    typer.echo(_sources_table(sources) if sources else "No sources yet.")


@source_app.command("update")
@handle_errors
def source_update(
    ctx: typer.Context,
    source_id: str,
    label: Annotated[str | None, typer.Option("--label")] = None,
    priority: Annotated[int | None, typer.Option("--priority")] = None,
    requires_js: Annotated[bool | None, typer.Option("--requires-js/--auto-js")] = None,
    no_js: Annotated[bool | None, typer.Option("--no-js/--allow-js")] = None,
) -> None:
    """Change a source's label, priority or browser setting."""
    conn = state(ctx).connect()
    source = registry.update_source(
        conn,
        registry.require_source(conn, source_id),
        now=clock.now(),
        label=label,
        priority=priority,
        requires_js=requires_js,
        js_disabled=no_js,
    )
    typer.echo(f"Updated {source.id}.")


@source_app.command("disable")
@handle_errors
def source_disable(ctx: typer.Context, source_id: str) -> None:
    """Stop fetching a source. Its snapshots are kept."""
    conn = state(ctx).connect()
    registry.update_source(conn, registry.require_source(conn, source_id), now=clock.now(), enabled=False)
    typer.echo(f"Disabled {source_id}.")


@source_app.command("enable")
@handle_errors
def source_enable(ctx: typer.Context, source_id: str) -> None:
    """Re-enable a disabled source."""
    conn = state(ctx).connect()
    registry.update_source(conn, registry.require_source(conn, source_id), now=clock.now(), enabled=True)
    typer.echo(f"Enabled {source_id}.")
