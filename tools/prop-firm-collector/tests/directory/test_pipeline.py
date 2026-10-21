"""Publishers through the shared Build 29 pipeline: policy gates, bounded collection, provenance, change history,
review, migration and the two export contracts. Fixture replay only; no sockets."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from fundedflow_collector.capture import import_capture
from fundedflow_collector.clock import FakeClock
from fundedflow_collector.db import registry
from fundedflow_collector.db.migrate import apply_migrations, bundled_migrations
from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.directory import export as directory_export
from fundedflow_collector.directory import presets, review
from fundedflow_collector.directory.model import ObservationStatus
from fundedflow_collector.export.envelope import build_envelope, serialise
from fundedflow_collector.export.validate import schema_name, validation_errors
from fundedflow_collector.outcomes import HostRole, Outcome, SourceKind, TermsDecision
from tests.conftest import (
    DIRECTORY_CAPTURES,
    TEST_SETTINGS,
    Harness,
    add_firm,
    add_seed,
    install_publisher,
    run_publisher,
)

COMPARISON = "https://onlypropfirms.com/prop-firm-comparison"


def requested(harness: Harness) -> list[str]:
    return list(harness.site.requests)


# ---------------------------------------------------------------- registry and policy gates


def test_presets_install_disabled_with_hosts_seeds_and_a_recorded_review(
    conn: sqlite3.Connection, clock: FakeClock
) -> None:
    for key in presets.PRESETS:
        publisher = presets.install_preset(conn, key, clock.now())
        assert not publisher.enabled
        assert publisher.policy_review["reviewed_on"] == "2026-10-21"
        hosts = registry.list_hosts(conn, publisher.id)
        assert hosts and all(h.terms_decision is None for h in hosts)
        assert registry.list_sources(conn, publisher.id)
    assert registry.require_publisher(conn, "propfirmmatch-futures").capture_mode == "manual_only"
    assert registry.list_firms(conn) == []  # a publisher is never a firm
    with pytest.raises(RegistryError, match="already exists"):
        presets.install_preset(conn, "onlypropfirms", clock.now())


def test_enabling_needs_a_terms_review_and_manual_only_cannot_be_enabled(
    conn: sqlite3.Connection, clock: FakeClock
) -> None:
    publisher = presets.install_preset(conn, "onlypropfirms", clock.now())
    with pytest.raises(RegistryError, match="record a terms review"):
        registry.set_publisher_enabled(conn, publisher, True, None, clock.now())
    manual = presets.install_preset(conn, "propfirmmatch-futures", clock.now())
    with pytest.raises(RegistryError, match="manual capture only"):
        registry.set_publisher_enabled(conn, manual, True, None, clock.now())
    enabled = install_publisher(conn, clock, "traderssecondbrain")
    assert enabled.enabled
    switched = registry.update_publisher(conn, enabled, now=clock.now(), capture_mode="manual_only")
    assert not switched.enabled and switched.disabled_reason == "manual capture only"


def test_publisher_and_firm_hosts_are_kept_apart(conn: sqlite3.Connection, clock: FakeClock) -> None:
    publisher = presets.install_preset(conn, "onlypropfirms", clock.now())
    firm = add_firm(conn, clock)
    with pytest.raises(RegistryError, match="kept apart"):
        registry.add_host(conn, firm, "onlypropfirms.com", HostRole.HOMEPAGE, clock.now())
    with pytest.raises(RegistryError, match="kept apart"):
        registry.add_host(conn, publisher, "www.example-firm.test", HostRole.HOMEPAGE, clock.now())
    with pytest.raises(RegistryError, match="not part of"):
        registry.add_host(conn, publisher, "www.northwind-futures.test", HostRole.HOMEPAGE, clock.now())
    with pytest.raises(RegistryError, match="role"):
        registry.add_host(conn, publisher, "help.onlypropfirms.com", HostRole.HELP_CENTER, clock.now())
    registry.add_host(conn, publisher, "www.onlypropfirms.com", HostRole.HOMEPAGE, clock.now())
    with pytest.raises(RegistryError, match="firm key"):
        registry.add_publisher(
            conn,
            publisher_key="example-firm",
            display_name="x",
            homepage_url="https://x.test/",
            adapter="generic",
            now=clock.now(),
        )


def test_seeds_must_be_in_scope(conn: sqlite3.Connection, clock: FakeClock) -> None:
    publisher = presets.install_preset(conn, "onlypropfirms", clock.now())
    for url, message in (
        ("https://onlypropfirms.com/go/northwind", "excluded"),
        ("https://onlypropfirms.com/about-us", "allowed paths"),
        ("https://elsewhere.test/prop-firms", "authorised"),
    ):
        with pytest.raises(RegistryError, match=message):
            registry.add_source(conn, publisher, url=url, kind=SourceKind.PAGE, now=clock.now())


def test_unreviewed_and_disabled_publishers_make_no_requests(dharness: Harness) -> None:
    presets.install_preset(dharness.conn, "onlypropfirms", dharness.clock.now())
    summary = run_publisher(dharness, "onlypropfirms")
    assert summary.status == "skipped_disabled" and requested(dharness) == []
    preview = run_publisher(dharness, "onlypropfirms", dry_run=True)
    assert preview.status == "dry_run" and requested(dharness) == []
    assert {d for d, _u, _w in preview.dry_run_lines} == {"terms_blocked"}
    assert "disabled" in (preview.message or "")


def test_manual_only_publishers_are_never_fetched(dharness: Harness) -> None:
    presets.install_preset(dharness.conn, "propfirmmatch-futures", dharness.clock.now())
    for dry in (False, True):
        summary = run_publisher(dharness, "propfirmmatch-futures", dry_run=dry)
        assert summary.status == "skipped_manual_only"
    assert requested(dharness) == []


def test_prohibited_terms_block_every_request(dharness: Harness) -> None:
    publisher = install_publisher(
        dharness.conn, dharness.clock, "onlypropfirms", decision=TermsDecision.PROHIBITED, enable=False
    )
    registry.set_publisher_enabled(dharness.conn, publisher, True, None, dharness.clock.now())
    summary = run_publisher(dharness, "onlypropfirms")
    assert set(summary.counts()) == {Outcome.TERMS_BLOCKED.value}
    assert requested(dharness) == []


# ---------------------------------------------------------------- bounded collection


def test_a_practice_run_collects_reads_and_stays_in_scope(dharness: Harness) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    summary = run_publisher(dharness, "onlypropfirms")
    urls = requested(dharness)
    assert summary.status == "completed"
    assert urls[0] == "https://onlypropfirms.com/robots.txt"
    assert all(u.startswith("https://onlypropfirms.com/") for u in urls)  # never a firm site or affiliate host
    assert not any("/go/" in u or "sort=" in u or "northwind-futures.test" in u for u in urls)
    assert f"{COMPARISON}?page=2" in urls
    directory = summary.directory_counts()
    assert directory["collected"] >= 5 and directory["structure_changed"] == 1 and directory["js_unavailable"] == 1
    assert summary.counts()[Outcome.NEW_SNAPSHOT.value] == len(urls) - 1


def test_pagination_is_capped(dharness: Harness, directory_site: Path) -> None:
    from fundedflow_collector.directory.adapters.onlypropfirms import OnlyPropFirmsAdapter

    base = (directory_site / "onlypropfirms.com" / "prop-firm-comparison__page=2.html").read_text(encoding="utf-8")
    for n in range(2, 8):
        next_link = f'<a href="/prop-firm-comparison?page={n + 1}">Next</a>'
        (directory_site / "onlypropfirms.com" / f"prop-firm-comparison__page={n}.html").write_text(
            base.replace("</main>", next_link + "</main>"), encoding="utf-8"
        )
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    pages = [u for u in requested(dharness) if u.startswith(COMPARISON)]
    assert len(pages) == OnlyPropFirmsAdapter.max_pagination_pages


def test_the_budget_caps_a_publisher_run(dharness: Harness) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    summary = run_publisher(dharness, "onlypropfirms", max_fetches=3)
    assert summary.fetches_used <= 3
    assert Outcome.BUDGET_EXHAUSTED.value in summary.counts()


def test_robots_disallow_is_respected(dharness: Harness, directory_site: Path) -> None:
    (directory_site / "onlypropfirms.com" / "robots.txt").write_text(
        "User-agent: *\nDisallow: /prop-firms\n", encoding="utf-8"
    )
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    summary = run_publisher(dharness, "onlypropfirms")
    blocked = [r.url for r in summary.results if r.outcome is Outcome.ROBOTS_BLOCKED]
    assert "https://onlypropfirms.com/prop-firms" in blocked
    assert "https://onlypropfirms.com/prop-firms" not in requested(dharness)


def test_a_challenge_page_stops_the_host_and_other_publishers_still_run(
    dharness: Harness, directory_site: Path
) -> None:
    (directory_site / "_responses.toml").write_text(
        '[[response]]\nurl = "https://onlypropfirms.com/largest-drawdown"\nstatus = 403\n'
        'headers = { "cf-mitigated" = "challenge", "content-type" = "text/html" }\nbody = "Just a moment..."\n',
        encoding="utf-8",
    )
    from fundedflow_collector.net.fixture_transport import FixtureSite

    dharness.site = FixtureSite(directory_site)
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    install_publisher(dharness.conn, dharness.clock, "traderssecondbrain")
    first = run_publisher(dharness, "onlypropfirms")
    assert Outcome.BLOCKED_BOT_PROTECTION.value in first.counts()
    assert Outcome.CIRCUIT_OPEN.value in first.counts()
    second = run_publisher(dharness, "traderssecondbrain")
    assert second.counts()[Outcome.NEW_SNAPSHOT.value] >= 4
    status = review.publisher_status(
        dharness.conn, registry.require_publisher(dharness.conn, "onlypropfirms"), dharness.clock.now()
    )
    assert status.state == "permissions_blocked"


def test_rate_limiting_stops_requests_to_that_host(dharness: Harness, directory_site: Path) -> None:
    lines = "".join(
        f'[[response]]\nurl = "{u}"\nstatus = 429\nheaders = {{ "retry-after" = "1" }}\nbody = "slow down"\n\n'
        for u in (
            "https://onlypropfirms.com/largest-drawdown",
            COMPARISON,
            "https://onlypropfirms.com/prop-firm-starting-costs",
            "https://onlypropfirms.com/prop-firms",
        )
    )
    (directory_site / "_responses.toml").write_text(lines, encoding="utf-8")
    from fundedflow_collector.net.fixture_transport import FixtureSite

    dharness.site = FixtureSite(directory_site)
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    summary = run_publisher(dharness, "onlypropfirms")
    counts = summary.counts()
    assert counts[Outcome.RATE_LIMITED.value] >= 1
    assert Outcome.NEW_SNAPSHOT.value not in counts


# ---------------------------------------------------------------- provenance, change history and review


def test_every_observation_has_full_provenance(dharness: Harness) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    rows = dharness.conn.execute(
        "SELECT o.*, s.content_hash AS snap_hash FROM directory_observations o JOIN source_snapshots s"
        " ON s.id = o.snapshot_id"
    ).fetchall()
    assert rows
    for row in rows:
        assert row["content_hash"] == row["snap_hash"]
        assert row["page_url"].startswith("https://onlypropfirms.com/")
        assert row["adapter_name"] == "onlypropfirms" and row["adapter_version"] == "1.0.0"
        assert row["capture_channel"] == "fixture_replay"
        assert row["raw_label"] and row["location"] and row["observed_at"].endswith("Z")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        dharness.conn.execute("UPDATE directory_observations SET raw_value = 'x'")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        dharness.conn.execute("DELETE FROM directory_observations")


def test_unchanged_pages_add_no_observations_and_changes_keep_history(dharness: Harness, directory_site: Path) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    count = dharness.conn.execute("SELECT COUNT(*) FROM directory_observations").fetchone()[0]
    dharness.advance_days(1)
    second = run_publisher(dharness, "onlypropfirms")
    assert second.counts()[Outcome.UNCHANGED.value] >= 5
    assert dharness.conn.execute("SELECT COUNT(*) FROM directory_observations").fetchone()[0] == count
    page = directory_site / "onlypropfirms.com" / "prop-firm-comparison.html"
    page.write_text(page.read_text(encoding="utf-8").replace("<td>$1,100</td>", "<td>$1,250</td>", 1), encoding="utf-8")
    dharness.advance_days(1)
    run_publisher(dharness, "onlypropfirms")
    views = review.load(dharness.conn, now=dharness.clock.now(), include_superseded=True)
    daily = [
        v
        for v in views
        if v.row["field"] == "daily_loss_limit"
        and v.row["page_url"] == COMPARISON
        and v.row["account_size_raw"] == "$50K"
    ]
    assert {v.status for v in daily} == {ObservationStatus.SUPERSEDED, ObservationStatus.OBSERVED}
    history = review.field_history(dharness.conn, daily[0].row["record_key"], "daily_loss_limit")
    assert [p.value for p in history] == ["$1,100", "$1,250"]
    assert [p.changed for p in history] == [False, True]
    assert history[-1].current and not history[0].current


def test_conflicts_duplicates_and_uncertain_identities(dharness: Harness) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    install_publisher(dharness.conn, dharness.clock, "traderssecondbrain")
    run_publisher(dharness, "onlypropfirms")
    run_publisher(dharness, "traderssecondbrain")
    views = review.load(dharness.conn, now=dharness.clock.now())
    items = review.review_items(views, dharness.conn)
    kinds = {i.kind for i in items}
    assert kinds >= {"conflict", "duplicate", "uncertain_identity"}
    conflict = next(i for i in items if i.kind == "conflict" and "daily loss" in i.title and "evaluation" in i.title)
    assert "onlypropfirms: $1,100" in conflict.detail and "traderssecondbrain: $1,000" in conflict.detail
    conflicting = [v for v in views if v.row["id"] in conflict.observation_ids]
    assert {v.status for v in conflicting} == {ObservationStatus.CONFLICTING}
    # "trailing" and "trailing (end of day)" are not a conflict: one is less specific than the other.
    assert not any(i.kind == "conflict" and "drawdown type" in i.title.lower() for i in items)
    pair = next(i for i in items if i.kind == "uncertain_identity")
    assert pair.key == review.pair_subject("contoso", "contoso funding")
    review.record_action(
        dharness.conn,
        action="keep_separate",
        subject_type="review_item",
        subject_key=pair.key,
        now=dharness.clock.now(),
    )
    after = review.load(dharness.conn, now=dharness.clock.now())
    contoso = [v for v in after if v.row["firm_norm"] == "contoso funding" and v.row["confidence"] == "observed"]
    assert contoso and all(v.status is not ObservationStatus.UNCERTAIN for v in contoso)
    assert next(i for i in review.review_items(after, dharness.conn) if i.key == pair.key).dismissed


def test_operator_mapping_and_official_verification(dharness: Harness) -> None:
    firm = add_firm(dharness.conn, dharness.clock, "northwind", hosts={})
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    review.record_action(
        dharness.conn,
        action="map_firm",
        subject_type="firm_name",
        subject_key=review.firm_name_subject("onlypropfirms", "northwind futures"),
        now=dharness.clock.now(),
        firm_key=firm.firm_key,
    )
    views = review.load(dharness.conn, now=dharness.clock.now())
    mapped = [v for v in views if v.row["firm_norm"] == "northwind futures"]
    assert (
        mapped and {v.mapped_firm_key for v in mapped} == {"northwind"} and {v.mapping for v in mapped} == {"operator"}
    )
    target = mapped[0].row["id"]
    publisher_snapshot = mapped[0].row["snapshot_id"]
    with pytest.raises(RegistryError, match="firm's own site"):
        review.record_action(
            dharness.conn,
            action="verify_official",
            subject_type="observation",
            subject_key=target,
            now=dharness.clock.now(),
            note="checked",
            official_snapshot_id=publisher_snapshot,
        )
    with pytest.raises(RegistryError, match="existing firm"):
        review.record_action(
            dharness.conn,
            action="map_firm",
            subject_type="firm_name",
            subject_key="x|y",
            now=dharness.clock.now(),
            firm_key="no-such-firm",
        )
    harness_firm = add_firm(dharness.conn, dharness.clock, "example-firm")
    add_seed(dharness.conn, harness_firm, dharness.clock, "https://www.example-firm.test/rules")
    official = import_capture(
        dharness.conn,
        TEST_SETTINGS,
        dharness.clock,
        firm_key="example-firm",
        url="https://www.example-firm.test/rules",
        file=DIRECTORY_CAPTURES / "propfirmgorilla-firms-rendered.html",
    )
    review.record_action(
        dharness.conn,
        action="verify_official",
        subject_type="observation",
        subject_key=target,
        now=dharness.clock.now(),
        note="matches the firm's rules page",
        official_snapshot_id=official.snapshot_id,
    )
    verified = next(v for v in review.load(dharness.conn, now=dharness.clock.now()) if v.row["id"] == target)
    assert verified.status is ObservationStatus.OFFICIALLY_VERIFIED
    review.record_action(
        dharness.conn, action="unverify", subject_type="observation", subject_key=target, now=dharness.clock.now()
    )
    assert (
        next(v for v in review.load(dharness.conn, now=dharness.clock.now()) if v.row["id"] == target).verified_by
        is None
    )


def test_stale_values_are_marked(dharness: Harness) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    dharness.advance_days(45)
    views = review.load(dharness.conn, now=dharness.clock.now(), stale_after_days=30)
    assert any(v.status is ObservationStatus.STALE for v in views)
    assert any(i.kind == "stale" for i in review.review_items(views, dharness.conn, stale_after_days=30))


def test_official_evidence_excerpts_come_only_from_the_firms_own_pages(harness: Harness) -> None:
    firm = add_firm(harness.conn, harness.clock)
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/rules")
    harness.run()
    excerpts = review.official_evidence(harness.conn, "example-firm", "daily_loss_limit")
    assert excerpts and all(e.url.startswith("https://www.example-firm.test/") for e in excerpts)
    assert review.official_evidence(harness.conn, "no-such-firm", "daily_loss_limit") == []


# ---------------------------------------------------------------- manual capture


def test_publisher_capture_is_offline_and_tied_to_the_publishers_own_site(
    conn: sqlite3.Connection, clock: FakeClock
) -> None:
    presets.install_preset(conn, "propfirmmatch-futures", clock.now())
    result = import_capture(
        conn,
        TEST_SETTINGS,
        clock,
        publisher_key="propfirmmatch-futures",
        url="https://propfirmmatch.com/futures/prop-firm-challenges",
        file=DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html",
        captured_at="2026-10-21T12:00:00Z",
    )
    assert result.outcome is Outcome.NEW_SNAPSHOT
    assert result.directory is not None and "3 records" in result.directory
    channels = {r[0] for r in conn.execute("SELECT DISTINCT capture_channel FROM directory_observations")}
    assert channels == {"manual_capture"}
    observed = {r[0] for r in conn.execute("SELECT DISTINCT observed_at FROM directory_observations")}
    assert observed == {"2026-10-21T12:00:00.000Z"}
    with pytest.raises(RegistryError, match="not registered"):
        import_capture(
            conn,
            TEST_SETTINGS,
            clock,
            publisher_key="propfirmmatch-futures",
            url="https://www.northwind-futures.test/x",
            file=DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html",
        )
    with pytest.raises(RegistryError, match="excluded"):
        import_capture(
            conn,
            TEST_SETTINGS,
            clock,
            publisher_key="propfirmmatch-futures",
            url="https://propfirmmatch.com/futures/prop-firm-challenges?sort=price",
            file=DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html",
        )
    with pytest.raises(RegistryError, match="firm or a comparison publisher"):
        import_capture(conn, TEST_SETTINGS, clock, url="https://propfirmmatch.com/futures", file=Path("x.html"))


def test_a_changed_capture_is_reported_without_losing_the_earlier_values(
    conn: sqlite3.Connection, clock: FakeClock
) -> None:
    presets.install_preset(conn, "propfirmmatch-futures", clock.now())
    url = "https://propfirmmatch.com/futures/prop-firm-challenges"
    import_capture(
        conn,
        TEST_SETTINGS,
        clock,
        publisher_key="propfirmmatch-futures",
        url=url,
        file=DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html",
    )
    clock.advance(86400)
    changed = import_capture(
        conn,
        TEST_SETTINGS,
        clock,
        publisher_key="propfirmmatch-futures",
        url=url,
        file=DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges-changed.html",
    )
    assert changed.directory is not None and "structure_changed" in changed.directory
    views = review.load(conn, now=clock.now(), include_superseded=True)
    assert views and all(v.status is ObservationStatus.SUPERSEDED for v in views)


# ---------------------------------------------------------------- migration and export compatibility


BUILD_29_ROWS = [
    "INSERT INTO collector_firms (id, firm_key, display_name, homepage_url, created_at, updated_at) VALUES"
    " ('firm_1', 'old-firm', 'Old Firm', 'https://www.old-firm.test/', '2026-10-01T00:00:00.000Z',"
    " '2026-10-01T00:00:00.000Z')",
    "INSERT INTO collector_hosts (id, firm_id, host, role, terms_url, terms_decision, terms_reviewed_at, created_at,"
    " updated_at) VALUES ('host_1', 'firm_1', 'www.old-firm.test', 'homepage', 'https://www.old-firm.test/terms',"
    " 'allowed', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')",
    "INSERT INTO crawl_runs (id, batch_id, firm_id, command, started_at, finished_at, status, fetches_used, options,"
    " config_sha256, collector_version) VALUES ('run_1', 'b', 'firm_1', 'fetch', '2026-10-01T00:00:00.000Z',"
    " '2026-10-01T00:01:00.000Z', 'completed', 2, '{}', 'x', '0.1.0')",
    "INSERT INTO collector_sources (id, firm_id, canonical_url, kind, source_channel, latest_snapshot_id, created_at,"
    " updated_at) VALUES ('src_1', 'firm_1', 'https://www.old-firm.test/rules', 'page', 'seed', 'snap_1',"
    " '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')",
    "INSERT INTO fetch_attempts (id, run_id, firm_id, source_id, requested_url, fetch_method, started_at, outcome,"
    " snapshot_id) VALUES ('att_1', 'run_1', 'firm_1', 'src_1', 'https://www.old-firm.test/rules', 'http',"
    " '2026-10-01T00:00:10.000Z', 'new_snapshot', 'snap_1')",
    "INSERT INTO source_snapshots (id, source_id, firm_id, content_hash, normalization_version, captured_at,"
    " first_attempt_id, requested_url, final_url, text, structure, content_type, fetch_method, source_channel,"
    " parser_name, parser_version) VALUES ('snap_1', 'src_1', 'firm_1', 'sha256:' || printf('%064d', 1), 'norm-v1',"
    " '2026-10-01T00:00:10.000Z', 'att_1', 'https://www.old-firm.test/rules', 'https://www.old-firm.test/rules',"
    " 'Daily loss limit 2%', '{}', 'text/html', 'http', 'seed', 'html', '1')",
    "INSERT INTO discovered_links (id, run_id, firm_id, url, via, depth, decision, discovered_at) VALUES ('lnk_1',"
    " 'run_1', 'firm_1', 'https://www.old-firm.test/faq', 'link', 1, 'queued', '2026-10-01T00:00:20.000Z')",
    "INSERT INTO policy_events (id, at, host, firm_id, kind, detail) VALUES ('pev_1', '2026-10-01T00:00:00.000Z',"
    " 'www.old-firm.test', 'firm_1', 'terms_recorded', '{}')",
]


def test_migration_from_build_29_keeps_every_row(tmp_path: Path, clock: FakeClock) -> None:
    from fundedflow_collector.db.connection import connect

    path = tmp_path / "old.db"
    conn = connect(path)
    apply_migrations(conn, path, bundled_migrations()[:1])
    conn.execute("BEGIN")
    for statement in BUILD_29_ROWS:
        conn.execute(statement)
    conn.execute("COMMIT")
    tables = (
        "collector_firms",
        "collector_hosts",
        "collector_sources",
        "crawl_runs",
        "fetch_attempts",
        "discovered_links",
        "source_snapshots",
        "policy_events",
    )
    before = {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY id")] for t in tables}  # noqa: S608
    envelope_before = serialise(build_envelope(conn, firm_keys=None, generated_at="2026-10-21T00:00:00.000Z"))
    assert apply_migrations(conn, path) == len(bundled_migrations()) - 1
    assert (tmp_path / "old.db.bak-0001").exists()
    after = {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY id")] for t in tables}  # noqa: S608
    assert after == before
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert {r["id"]: r["kind"] for r in conn.execute("SELECT * FROM collection_owners")} == {"firm_1": "firm"}
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE source_snapshots SET text = 'x'")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("DELETE FROM fetch_attempts")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO collector_hosts (id, firm_id, host, role, created_at, updated_at) VALUES"
            " ('host_x', 'no-such-owner', 'x.test', 'homepage', 'a', 'a')"
        )
    assert serialise(build_envelope(conn, firm_keys=None, generated_at="2026-10-21T00:00:00.000Z")) == envelope_before
    new_firm = registry.add_firm(
        conn, firm_key="new-firm", display_name="New", homepage_url="https://new.test/", now=clock.now()
    )
    assert conn.execute("SELECT kind FROM collection_owners WHERE id = ?", (new_firm.id,)).fetchone()[0] == "firm"
    assert apply_migrations(conn, path) == 0
    conn.close()


def test_v1_evidence_export_never_contains_publisher_data(dharness: Harness) -> None:
    add_firm(dharness.conn, dharness.clock)
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    envelope = json.loads(
        serialise(build_envelope(dharness.conn, firm_keys=None, generated_at="2026-10-21T00:00:00.000Z"))
    )
    assert validation_errors(envelope) == []
    assert [f["firm_key"] for f in envelope["firms"]] == ["example-firm"]
    assert "onlypropfirms" not in json.dumps(envelope)


def test_directory_export_is_valid_deterministic_and_partial_success_is_visible(dharness: Harness) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    document = directory_export.build(dharness.conn, now=dharness.clock.now())
    assert schema_name(document) == "collector-directory-observations-v1"
    assert validation_errors(document) == []
    again = directory_export.build(dharness.conn, now=dharness.clock.now())
    assert directory_export.serialise(document) == directory_export.serialise(again)
    dharness.advance_days(1)
    later = directory_export.build(dharness.conn, now=dharness.clock.now())
    assert later["export_id"] == document["export_id"] or later["summary"] != document["summary"]
    statuses = {p["extraction_status"] for p in document["pages"]}
    assert {"collected", "structure_changed", "js_unavailable"} <= statuses
    verifications = {f["verification_status"] for r in document["records"] for f in r["fields"]}
    assert verifications == {"unverified"}
    publisher = document["publishers"][0]
    assert (
        publisher["role"] == "third_party_comparison_publisher" and publisher["hosts"][0]["terms_decision"] == "unclear"
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["records"][0]["fields"][0].update(verification_status="officially_verified"),
        lambda d: d["records"][0]["fields"][0].update(value_kind="none"),  # a none with a normalised value
        lambda d: d["records"][0]["fields"][0].update(field="rating"),
        lambda d: d["records"][0]["fields"][0]["provenance"].pop("content_hash"),
        lambda d: d["records"][0].update(phase="phase 1"),
        lambda d: d.update(schema_version=2),
        lambda d: d["publishers"][0].update(role="prop_firm"),
    ],
)
def test_invalid_directory_exports_are_rejected(dharness: Harness, mutate: object) -> None:
    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    run_publisher(dharness, "onlypropfirms")
    document = directory_export.build(dharness.conn, now=dharness.clock.now())
    first = document["records"][0]["fields"][0]
    if first["normalized"] is None:  # make the "none with a value" mutation meaningful
        first["normalized"] = {"type": "percent", "value": "1"}
        first["value_kind"] = "value"
    mutate(document)  # type: ignore[operator]
    assert validation_errors(document)
