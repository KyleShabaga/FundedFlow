"""`collector directory ...`: comparison publishers (Build 29.25).

Publishers are third-party directory sites, kept apart from firms. Every network action goes through the same
runner as `collector fetch`; review actions only append notes and mappings and never change an observation, a
firm rule or the FundedFlow app.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from fundedflow_collector import services
from fundedflow_collector.cli import exit_codes
from fundedflow_collector.cli.common import clock, echo_json, fail, handle_errors, state, table
from fundedflow_collector.cli.run_cmds import import_capture_cmd, run_owners
from fundedflow_collector.db import registry
from fundedflow_collector.directory import presets, review
from fundedflow_collector.directory.adapters import ADAPTERS, UnknownAdapter, get_adapter
from fundedflow_collector.directory.model import FIELDS, ObservationStatus
from fundedflow_collector.outcomes import HostRole, SourceKind, TermsDecision
from fundedflow_collector.policy.terms import review_expires, terms_block_reason
from fundedflow_collector.runner import RunOptions

directory_app = typer.Typer(
    help="Comparison publishers: third-party prop-firm directory sites (unverified observations only).",
    no_args_is_help=True,
)
review_app = typer.Typer(help="Review duplicates, conflicts and uncertain identities.", no_args_is_help=True)
directory_app.add_typer(review_app, name="review")

PublisherOpt = Annotated[str, typer.Option("--publisher", help="Publisher key, e.g. onlypropfirms.")]
JsonOpt = Annotated[bool, typer.Option("--json", help="Machine-readable output.")]


def _patterns(values: list[str] | None) -> list[str] | None:
    return [v.strip() for v in values if v.strip()] if values is not None else None


# ---------------------------------------------------------------- registry


@directory_app.command("presets")
@handle_errors
def presets_cmd(ctx: typer.Context) -> None:
    """List the built-in publisher presets and the policy review recorded for each."""
    conn = state(ctx).connect()
    rows = []
    for preset in presets.PRESETS.values():
        installed = registry.get_publisher(conn, preset.key) is not None
        rows.append(
            [
                preset.key,
                preset.display_name,
                preset.capture_mode,
                preset.policy_review.get("suggested_decision"),
                "installed" if installed else "-",
            ]
        )
    typer.echo(table(["PRESET", "NAME", "MODE", "REVIEW SUGGESTS", "STATUS"], rows))
    typer.echo("Install one with `collector directory add-preset KEY`. Presets install disabled.")


@directory_app.command("add-preset")
@handle_errors
def add_preset(
    ctx: typer.Context,
    key: Annotated[str | None, typer.Argument(help="Preset key; see `collector directory presets`.")] = None,
    all_presets: Annotated[bool, typer.Option("--all", help="Install every preset not installed yet.")] = False,
) -> None:
    """Install a preset publisher with its hosts and seed pages. It stays disabled until you review its terms."""
    if bool(key) == all_presets:
        raise fail("give a preset KEY or --all", exit_codes.USAGE)
    conn = state(ctx).connect()
    keys = [k for k in presets.PRESETS if registry.get_publisher(conn, k) is None] if all_presets else [str(key)]
    for name in keys:
        publisher = presets.install_preset(conn, name, clock.now())
        typer.echo(
            f"Installed {publisher.publisher_key} ({publisher.display_name}), disabled, {publisher.capture_mode}."
        )
        typer.echo(f"  Policy review {presets.REVIEWED_ON}: {publisher.policy_review.get('summary')}")
    if not keys:
        typer.echo("Every preset is already installed.")


@directory_app.command("add")
@handle_errors
def add(
    ctx: typer.Context,
    key: Annotated[str, typer.Argument(help="Short key: lowercase letters, digits, hyphens.")],
    name: Annotated[str, typer.Option("--name")],
    homepage: Annotated[str, typer.Option("--homepage", help="The publisher's own homepage URL.")],
    adapter: Annotated[
        str, typer.Option("--adapter", help="Adapter name; 'generic' stores snapshots only.")
    ] = "generic",
    manual_only: Annotated[bool, typer.Option("--manual-only", help="Never fetch; manual capture only.")] = False,
    allow: Annotated[list[str] | None, typer.Option("--allow", help="Allowed path glob (repeatable).")] = None,
    exclude: Annotated[list[str] | None, typer.Option("--exclude", help="Excluded path glob (repeatable).")] = None,
    notes: Annotated[str | None, typer.Option("--notes")] = None,
) -> None:
    """Register another permitted publisher. Add its host and record a terms review before enabling it."""
    try:
        get_adapter(adapter)
    except UnknownAdapter as exc:
        raise fail(str(exc), exit_codes.USAGE) from exc
    conn = state(ctx).connect()
    publisher = registry.add_publisher(
        conn,
        publisher_key=key,
        display_name=name,
        homepage_url=homepage,
        adapter=adapter,
        now=clock.now(),
        capture_mode="manual_only" if manual_only else "auto",
        allowed_paths=_patterns(allow),
        excluded_paths=_patterns(exclude) or list(presets.COMMON_EXCLUDES),
        notes=notes,
    )
    typer.echo(f"Added publisher {publisher.publisher_key} (disabled).")
    typer.echo(f"Next: collector directory host-add --publisher {key} --host <host>")


@directory_app.command("list")
@handle_errors
def list_cmd(ctx: typer.Context, as_json: JsonOpt = False) -> None:
    """List publishers with their state, terms and last collection."""
    conn = state(ctx).connect()
    statuses = [review.publisher_status(conn, p, clock.now()) for p in registry.list_publishers(conn)]
    if as_json:
        echo_json(
            [
                {
                    "publisher_key": s.publisher.publisher_key,
                    "state": s.state,
                    "label": s.label,
                    "enabled": s.publisher.enabled,
                    "capture_mode": s.publisher.capture_mode,
                    "terms": s.terms,
                    "circuit": s.circuit,
                    "last_checked": s.last_checked,
                    "last_change": s.last_change,
                    "pages": s.pages,
                    "current_observations": s.current_observations,
                }
                for s in statuses
            ]
        )
        return
    if not statuses:
        typer.echo("No publishers yet. See `collector directory presets`.")
        return
    rows = [
        [
            s.publisher.publisher_key,
            s.label,
            "yes" if s.publisher.enabled else "no",
            s.publisher.capture_mode,
            s.terms,
            s.last_checked,
            s.last_change,
            s.current_observations,
        ]
        for s in statuses
    ]
    typer.echo(table(["PUBLISHER", "STATE", "ENABLED", "MODE", "TERMS", "LAST CHECKED", "LAST CHANGE", "VALUES"], rows))


@directory_app.command("show")
@handle_errors
def show(ctx: typer.Context, key: str) -> None:
    """Show one publisher: policy review, hosts, seed pages and the state of each page."""
    conn = state(ctx).connect()
    publisher = registry.require_publisher(conn, key)
    status = review.publisher_status(conn, publisher, clock.now())
    adapter = get_adapter(publisher.adapter)
    typer.echo(f"{publisher.publisher_key}: {publisher.display_name} (third-party comparison publisher)")
    typer.echo(f"  state           {status.label}{': ' + status.detail if status.detail else ''}")
    typer.echo(f"  homepage        {publisher.homepage_url}")
    typer.echo(f"  adapter         {adapter.name} {adapter.version}: {adapter.description}")
    typer.echo(f"  capture mode    {publisher.capture_mode}")
    typer.echo(f"  enabled         {'yes' if publisher.enabled else 'no: ' + str(publisher.disabled_reason)}")
    typer.echo(f"  allowed paths   {', '.join(publisher.allowed_paths) or '(any the adapter reads)'}")
    typer.echo(f"  excluded paths  {', '.join(publisher.excluded_paths) or '-'}")
    for label, value in sorted(publisher.policy_review.items()):
        typer.echo(f"  review.{label:<20} {value}")
    typer.echo("")
    rows = []
    for host in registry.list_hosts(conn, publisher.id):
        expires = review_expires(host)
        rows.append(
            [
                host.host,
                host.role.value,
                host.terms_decision.value if host.terms_decision else "not reviewed",
                f"{expires:%Y-%m-%d}" if expires else "-",
                terms_block_reason(host, clock.now()) or "allowed",
            ]
        )
    typer.echo(table(["HOST", "ROLE", "TERMS", "EXPIRES", "LIVE FETCH"], rows) if rows else "  No hosts yet.")
    typer.echo("")
    pages = []
    for source in registry.list_sources(conn, publisher.id):
        latest = conn.execute(
            "SELECT status FROM directory_extractions WHERE snapshot_id = ? ORDER BY extracted_at DESC LIMIT 1",
            (source.latest_snapshot_id,),
        ).fetchone()
        page = review.page_state(source.last_outcome, latest["status"] if latest else None)
        pages.append(
            [source.canonical_url, source.source_channel.value, review.STATE_LABELS[page], source.last_attempt_at]
        )
    typer.echo(table(["PAGE", "FOUND VIA", "STATE", "LAST ATTEMPT"], pages) if pages else "  No pages yet.")


@directory_app.command("update")
@handle_errors
def update(
    ctx: typer.Context,
    key: str,
    name: Annotated[str | None, typer.Option("--name")] = None,
    allow: Annotated[list[str] | None, typer.Option("--allow", help="Replace the allowed paths.")] = None,
    exclude: Annotated[list[str] | None, typer.Option("--exclude", help="Replace the excluded paths.")] = None,
    max_fetches: Annotated[int | None, typer.Option("--max-fetches")] = None,
    max_depth: Annotated[int | None, typer.Option("--max-depth")] = None,
    notes: Annotated[str | None, typer.Option("--notes")] = None,
    mode: Annotated[str | None, typer.Option("--mode", help="auto or manual_only.")] = None,
) -> None:
    """Change a publisher's settings. Switching to manual_only also stops live collection."""
    conn = state(ctx).connect()
    publisher = registry.update_publisher(
        conn,
        registry.require_publisher(conn, key),
        now=clock.now(),
        display_name=name,
        allowed_paths=_patterns(allow),
        excluded_paths=_patterns(exclude),
        max_fetches=max_fetches,
        max_depth=max_depth,
        notes=notes,
        capture_mode=mode,
    )
    typer.echo(f"Updated {publisher.publisher_key}.")


@directory_app.command("enable")
@handle_errors
def enable(ctx: typer.Context, key: str) -> None:
    """Allow live collection. Needs a terms review for every host; the terms gate still applies per request."""
    conn = state(ctx).connect()
    publisher = registry.set_publisher_enabled(conn, registry.require_publisher(conn, key), True, None, clock.now())
    typer.echo(
        f"Enabled {publisher.publisher_key}. Preview first: collector directory fetch --publisher {key} --dry-run"
    )


@directory_app.command("disable")
@handle_errors
def disable(ctx: typer.Context, key: str, reason: Annotated[str, typer.Option("--reason")]) -> None:
    """Stop live collection for a publisher. Its pages and observations are kept."""
    conn = state(ctx).connect()
    registry.set_publisher_enabled(conn, registry.require_publisher(conn, key), False, reason, clock.now())
    typer.echo(f"Disabled {key}.")


@directory_app.command("host-add")
@handle_errors
def host_add(ctx: typer.Context, publisher: PublisherOpt, host: Annotated[str, typer.Option("--host")]) -> None:
    """Authorise one of the publisher's own hosts. A prop firm's host can never be added here."""
    conn = state(ctx).connect()
    record = registry.add_host(conn, registry.require_publisher(conn, publisher), host, HostRole.HOMEPAGE, clock.now())
    typer.echo(f"Authorised {record.host} for {publisher}. Next: collector directory terms --publisher {publisher} ...")


@directory_app.command("terms")
@handle_errors
def terms(
    ctx: typer.Context,
    publisher: PublisherOpt,
    host: Annotated[str, typer.Option("--host")],
    decision: Annotated[TermsDecision, typer.Option("--decision")],
    terms_url: Annotated[str, typer.Option("--terms-url", help="The terms page you read.")],
    notes: Annotated[str | None, typer.Option("--notes")] = None,
    min_delay: Annotated[float | None, typer.Option("--min-delay")] = None,
    accept_unclear_terms: Annotated[bool, typer.Option("--accept-unclear-terms")] = False,
) -> None:
    """Record your terms review for a publisher host (the same gate as firm hosts, valid for 365 days)."""
    conn = state(ctx).connect()
    owner = registry.require_publisher(conn, publisher)
    record = registry.record_terms(
        conn,
        owner,
        registry.require_host(conn, owner, host),
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


@directory_app.command("seed-add")
@handle_errors
def seed_add(
    ctx: typer.Context,
    publisher: PublisherOpt,
    url: Annotated[str, typer.Option("--url")],
    label: Annotated[str | None, typer.Option("--label")] = None,
) -> None:
    """Add a starting page. It must be on an authorised host, inside the allowed paths."""
    conn = state(ctx).connect()
    owner = registry.require_publisher(conn, publisher)
    source = registry.add_source(conn, owner, url=url, kind=SourceKind.PAGE, now=clock.now(), label=label, priority=50)
    typer.echo(f"Added {source.canonical_url}.")


# ---------------------------------------------------------------- collection


@directory_app.command("fetch")
@handle_errors
def fetch(
    ctx: typer.Context,
    publisher: Annotated[list[str] | None, typer.Option("--publisher", help="Publisher key (repeatable).")] = None,
    all_publishers: Annotated[bool, typer.Option("--all", help="Every enabled publisher, one after another.")] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Show the planned requests; no network.")] = False,
    force: Annotated[bool, typer.Option("--force", help="Fetch even if a 304 would say unchanged.")] = False,
    no_browser: Annotated[bool, typer.Option("--no-browser")] = False,
    max_fetches: Annotated[int | None, typer.Option("--max-fetches")] = None,
    fixture_site: Annotated[
        Path | None, typer.Option("--fixture-site", exists=True, file_okay=False, help="Replay a local folder.")
    ] = None,
) -> None:
    """Collect from publishers through the same pipeline as `collector fetch` (robots, terms, pacing, budget)."""
    if bool(publisher) == all_publishers:
        raise fail("choose --publisher KEY (repeatable) or --all", exit_codes.USAGE)
    if max_fetches is not None and not 1 <= max_fetches <= 300:
        raise fail("--max-fetches must be between 1 and 300", exit_codes.USAGE)
    conn = state(ctx).connect()
    owners = services.select_owners(conn, publisher_keys=publisher, all_publishers=all_publishers)
    if not owners:
        typer.echo("No enabled publishers.")
        return
    options = RunOptions(
        command="fetch",
        dry_run=dry_run,
        force=force,
        use_browser=not no_browser,
        max_fetches=max_fetches,
        fixture_site=fixture_site,
    )
    run_owners(ctx, conn, owners, options, command="fetch", headed=False)


@directory_app.command("capture")
@handle_errors
def capture(
    ctx: typer.Context,
    publisher: PublisherOpt,
    url: Annotated[str, typer.Option("--url", help="The page's original address.")],
    file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, help=".html, .htm, .pdf or .txt")],
    captured_at: Annotated[str | None, typer.Option("--captured-at", help="When you saved it, UTC.")] = None,
) -> None:
    """Import a publisher page you saved in your browser. Works offline, for every publisher."""
    import_capture_cmd(ctx, firm=None, url=url, file=file, captured_at=captured_at, publisher=publisher)


# ---------------------------------------------------------------- evidence


@directory_app.command("observations")
@handle_errors
def observations(
    ctx: typer.Context,
    publisher: Annotated[str | None, typer.Option("--publisher")] = None,
    firm: Annotated[str | None, typer.Option("--firm", help="Part of a firm name.")] = None,
    status: Annotated[str | None, typer.Option("--status", help="observed, conflicting, uncertain, stale...")] = None,
    include_superseded: Annotated[bool, typer.Option("--history", help="Include superseded values.")] = False,
    as_json: JsonOpt = False,
) -> None:
    """List unverified observations with status and source."""
    app = state(ctx)
    settings, _ = app.settings()
    conn = app.connect()
    if status is not None and status not in {s.value for s in ObservationStatus}:
        raise fail(f"--status must be one of {', '.join(s.value for s in ObservationStatus)}", exit_codes.USAGE)
    views = review.load(
        conn,
        now=clock.now(),
        stale_after_days=settings.directory.stale_after_days,
        publisher_key=publisher,
        include_superseded=include_superseded,
    )
    views = [
        v
        for v in views
        if (firm is None or firm.lower() in v.row["firm_name"].lower()) and (status is None or v.status.value == status)
    ]
    if as_json:
        echo_json([{**v.row, "status": v.status.value, "reasons": v.reasons, "identity": v.identity} for v in views])
        return
    if not views:
        typer.echo("No observations match. Collect or capture publisher pages first.")
        return
    rows = [
        [
            v.row["publisher_key"],
            v.row["firm_name"],
            v.row["programme_name"],
            v.row["account_size_raw"],
            v.row["phase"],
            FIELDS[v.row["field"]].label,
            v.display_value(),
            v.status.value,
            v.row["observed_at"],
            v.row["id"],
        ]
        for v in views
    ]
    typer.echo(
        table(
            ["PUBLISHER", "FIRM", "PROGRAMME", "SIZE", "PHASE", "FIELD", "VALUE", "STATUS", "OBSERVED", "ID"], rows, 40
        )
    )
    typer.echo("All values are unverified third-party claims. Inspect one: collector directory show-observation ID")


@directory_app.command("show-observation")
@handle_errors
def show_observation(ctx: typer.Context, observation_id: str) -> None:
    """One observation with its full provenance, its history and the firm's own pages on the same topic."""
    app = state(ctx)
    settings, _ = app.settings()
    conn = app.connect()
    views = review.load(
        conn, now=clock.now(), stale_after_days=settings.directory.stale_after_days, include_superseded=True
    )
    view = next((v for v in views if v.row["id"] == observation_id), None)
    if view is None:
        raise fail(f"unknown observation {observation_id}", exit_codes.CONFIG)
    row = view.row
    for label, value in (
        ("publisher", f"{row['publisher_name']} ({row['publisher_key']}, third-party)"),
        ("firm", f"{row['firm_name']} -> {view.mapped_firm_key or 'not mapped'} ({view.mapping})"),
        ("programme", row["programme_name"]),
        ("variant", row["variant"]),
        ("account size", row["account_size_raw"]),
        ("phase", row["phase"]),
        ("field", FIELDS[row["field"]].label),
        ("shown as", f"{row['raw_label']}: {row['raw_value']}"),
        ("read as", view.display_value()),
        ("qualifier", row["publisher_qualifier"]),
        ("status", f"{view.status.value} ({'; '.join(view.reasons) or 'no issues found'})"),
        ("verification", "officially verified by the operator" if view.verified_by else "unverified"),
        ("page", row["page_url"]),
        ("snapshot", f"{row['snapshot_id']} ({row['content_hash']})"),
        ("observed", f"{row['observed_at']} via {row['capture_channel']}"),
        ("adapter", f"{row['adapter_name']} {row['adapter_version']}, {row['location']}"),
        ("official link", row["first_party_url"]),
    ):
        typer.echo(f"  {label:<14} {value if value not in (None, '') else '-'}")
    typer.echo("\nHistory:")
    for point in review.field_history(conn, row["record_key"], row["field"]):
        mark = "changed" if point.changed else "       "
        typer.echo(f"  {point.observed_at}  {mark}  {point.value}  {point.page_url}")
    if view.mapped_firm_key:
        typer.echo(f"\nThe firm's own stored pages mentioning this ({view.mapped_firm_key}):")
        excerpts = review.official_evidence(conn, view.mapped_firm_key, row["field"])
        for excerpt in excerpts:
            typer.echo(f"  {excerpt.captured_at}  {excerpt.url}\n    {excerpt.excerpt}")
        if not excerpts:
            typer.echo("  none stored; collect the firm's own rules pages to compare.")


@review_app.command("list")
@handle_errors
def review_list(
    ctx: typer.Context,
    include_dismissed: Annotated[bool, typer.Option("--all", help="Include dismissed items.")] = False,
    as_json: JsonOpt = False,
) -> None:
    """Duplicates, conflicting values, uncertain firm identities and stale pages."""
    app = state(ctx)
    settings, _ = app.settings()
    conn = app.connect()
    days = settings.directory.stale_after_days
    views = review.load(conn, now=clock.now(), stale_after_days=days)
    items = [i for i in review.review_items(views, conn, stale_after_days=days) if include_dismissed or not i.dismissed]
    if as_json:
        echo_json([i.__dict__ for i in items])
        return
    if not items:
        typer.echo("Nothing to review.")
        return
    for item in items:
        flag = " (dismissed)" if item.dismissed else ""
        typer.echo(f"[{item.kind}]{flag} {item.title}\n  {item.detail}\n  key: {item.key}")


@review_app.command("map")
@handle_errors
def review_map(
    ctx: typer.Context,
    publisher: PublisherOpt,
    firm_name: Annotated[str, typer.Option("--firm-name", help="The name as the publisher shows it.")],
    to: Annotated[str, typer.Option("--to", help="Registered firm key.")],
    note: Annotated[str | None, typer.Option("--note")] = None,
) -> None:
    """Say which registered firm a publisher's firm name means. Changes grouping only."""
    from fundedflow_collector.directory.identity import norm_firm

    conn = state(ctx).connect()
    registry.require_publisher(conn, publisher)
    subject = review.firm_name_subject(publisher, norm_firm(firm_name))
    review.record_action(
        conn, action="map_firm", subject_type="firm_name", subject_key=subject, now=clock.now(), firm_key=to, note=note
    )
    typer.echo(f"Mapped {publisher}'s '{firm_name}' to {to}.")


@review_app.command("separate")
@handle_errors
def review_separate(
    ctx: typer.Context,
    first: Annotated[str, typer.Option("--name", help="One normalised firm name from the review item.")],
    second: Annotated[str, typer.Option("--other", help="The other name.")],
    note: Annotated[str | None, typer.Option("--note")] = None,
) -> None:
    """Record that two similar names are different firms."""
    conn = state(ctx).connect()
    key = review.pair_subject(first, second)
    review.record_action(
        conn, action="keep_separate", subject_type="review_item", subject_key=key, now=clock.now(), note=note
    )
    typer.echo(f"Recorded: '{first}' and '{second}' are separate firms.")


@review_app.command("note")
@handle_errors
def review_note(
    ctx: typer.Context,
    key: Annotated[str, typer.Option("--item", help="Review item key, or an observation id.")],
    note: Annotated[str, typer.Option("--note")],
    dismiss: Annotated[bool, typer.Option("--dismiss", help="Also take it off the review list.")] = False,
) -> None:
    """Annotate (and optionally dismiss) a review item or an observation. Nothing is changed or approved."""
    conn = state(ctx).connect()
    subject = "observation" if key.startswith("obs_") else "review_item"
    review.record_action(
        conn,
        action="dismiss" if dismiss else "annotate",
        subject_type=subject,
        subject_key=key,
        now=clock.now(),
        note=note,
    )
    typer.echo("Recorded.")


@review_app.command("verify")
@handle_errors
def review_verify(
    ctx: typer.Context,
    observation: Annotated[str, typer.Option("--observation")],
    official_snapshot: Annotated[str, typer.Option("--official-snapshot", help="Snapshot of the firm's own page.")],
    note: Annotated[str, typer.Option("--note", help="What you checked on the official page.")],
) -> None:
    """Record that you checked a value against the firm's own stored page. It does not change any rule."""
    conn = state(ctx).connect()
    review.record_action(
        conn,
        action="verify_official",
        subject_type="observation",
        subject_key=observation,
        now=clock.now(),
        note=note,
        official_snapshot_id=official_snapshot,
    )
    typer.echo(f"Recorded an official verification of {observation} against {official_snapshot}.")


@review_app.command("unverify")
@handle_errors
def review_unverify(
    ctx: typer.Context,
    observation: Annotated[str, typer.Option("--observation")],
    note: Annotated[str | None, typer.Option("--note")] = None,
) -> None:
    """Withdraw an official verification."""
    conn = state(ctx).connect()
    review.record_action(
        conn, action="unverify", subject_type="observation", subject_key=observation, now=clock.now(), note=note
    )
    typer.echo("Withdrawn.")


@directory_app.command("export")
@handle_errors
def export(
    ctx: typer.Context,
    publisher: Annotated[list[str] | None, typer.Option("--publisher", help="Publisher key (repeatable).")] = None,
    out: Annotated[Path | None, typer.Option("--out")] = None,
    include_superseded: Annotated[bool, typer.Option("--history", help="Include superseded values.")] = False,
) -> None:
    """Write a collector-directory-observations-v1 file (validated before it is saved)."""
    app = state(ctx)
    settings, _ = app.settings()
    conn = app.connect()
    try:
        result = services.write_directory_export(
            conn,
            app.paths,
            settings,
            now=clock.now(),
            publisher_keys=publisher,
            out=out,
            include_superseded=include_superseded,
        )
    except services.ExportInvalid as exc:
        for line in exc.errors:
            typer.echo(f"  {line}", err=True)
        raise fail(str(exc), exit_codes.SCHEMA_INVALID) from exc
    summary = result.document["summary"]
    typer.echo(f"Wrote {result.path}")
    typer.echo(f"  export_id  {result.document['export_id']}")
    typer.echo(
        f"  records {summary['records']}, values {summary['observations']}, pages {len(result.document['pages'])}"
    )
    typer.echo(f"  statuses   {json.dumps(summary['by_status'])}")
    typer.echo("  schema     collector-directory-observations-v1: valid")
    typer.echo("  status     unverified third-party observations (not rules)")


@directory_app.command("adapters")
def adapters_cmd() -> None:
    """List the available adapters."""
    for adapter in ADAPTERS.values():
        typer.echo(f"{adapter.name:<24} {adapter.version:<8} {adapter.description}")
