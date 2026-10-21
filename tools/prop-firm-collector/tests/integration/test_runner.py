"""End-to-end runs against the synthetic fixture site (no network): discovery, policy, dedupe and failures."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from fundedflow_collector.db import registry
from fundedflow_collector.outcomes import CircuitState, HostRole, Outcome, SourceKind, TermsDecision
from fundedflow_collector.policy import circuit
from tests.conftest import Harness, add_firm, add_seed

RULES = "https://www.example-firm.test/rules"


def outcomes(summary: object) -> dict[str, str]:
    return {r.url: r.outcome.value for r in summary.results}  # type: ignore[attr-defined]


def snapshot_count(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM source_snapshots").fetchone()[0])


def seeded(harness: Harness, **kw: object) -> registry.Firm:
    firm = add_firm(harness.conn, harness.clock, excluded=["/blog/*", "/login*"], **kw)  # type: ignore[arg-type]
    add_seed(harness.conn, firm, harness.clock, RULES, priority=20)
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/docs/rulebook.pdf", SourceKind.PDF)
    add_seed(harness.conn, firm, harness.clock, "https://help.example-firm.test/hc/en-us", SourceKind.ZENDESK)
    return firm


def test_first_run_discovers_and_snapshots_html_pdf_and_zendesk(harness: Harness) -> None:
    seeded(harness)
    summary = harness.run()
    result = outcomes(summary)
    assert result[RULES] == "new_snapshot"
    assert result["https://www.example-firm.test/docs/rulebook.pdf"] == "new_snapshot"
    assert result["https://help.example-firm.test/hc/en-us/articles/1001-What-is-the-daily-loss-limit"] == (
        "new_snapshot"
    )
    assert result["https://www.example-firm.test/private/internal"] == "robots_blocked"
    assert "https://help.example-firm.test/hc/fr/articles/1003-Regles" not in result  # other locale skipped
    assert "https://www.example-firm.test/blog/news" not in result  # excluded path, never requested
    assert not any("other-firm.test" in url or "unrelated-site" in url for url in harness.site.requests)
    assert not any("/blog/" in url or "/login" in url for url in harness.site.requests)
    decisions = {r["url"]: r["decision"] for r in harness.conn.execute("SELECT url, decision FROM discovered_links")}
    assert decisions["https://other-firm.test/rules"] == "not_allowlisted"
    assert decisions["https://www.example-firm.test/blog/news"] == "excluded_path"
    assert summary.status == "completed" and summary.exit_code() == 4  # robots block is reported, not hidden
    row = harness.conn.execute("SELECT * FROM source_snapshots WHERE requested_url = ?", (RULES,)).fetchone()
    assert row["fetch_method"] == "fixture_replay" and row["content_hash"].startswith("sha256:")
    assert "ignore previous instructions" in row["text"]  # hostile text is stored as data only


def test_unchanged_rerun_keeps_one_snapshot_and_adds_attempts(harness: Harness) -> None:
    seeded(harness)
    harness.run()
    before = snapshot_count(harness.conn)
    harness.advance_days(1)
    summary = harness.run()
    assert snapshot_count(harness.conn) == before
    result = outcomes(summary)
    assert result[RULES] == "skipped_lastmod"  # sitemap lastmod is older than the last snapshot
    assert result["https://www.example-firm.test/docs/rulebook.pdf"] == "unchanged"
    attempts = harness.conn.execute(
        "SELECT outcome, conditional, http_status FROM fetch_attempts WHERE requested_url = ? ORDER BY started_at",
        ("https://www.example-firm.test/docs/rulebook.pdf",),
    ).fetchall()
    assert [(a["outcome"], a["conditional"], a["http_status"]) for a in attempts] == [
        ("new_snapshot", 0, 200),
        ("unchanged", 1, 304),
    ]


def test_changed_page_creates_a_new_snapshot_and_reverting_matches_the_old_one(
    harness: Harness, site_copy: Path
) -> None:
    seeded(harness)
    harness.run()
    faq = site_copy / "www.example-firm.test" / "faq.html"
    original = faq.read_text(encoding="utf-8")
    first = harness.conn.execute("SELECT id FROM source_snapshots WHERE requested_url LIKE '%/faq'").fetchone()["id"]

    harness.advance_days(1)
    faq.write_text(original.replace("eight trading days", "ten trading days"), encoding="utf-8")
    changed = outcomes(harness.run())
    assert changed["https://www.example-firm.test/faq"] == "new_snapshot"

    harness.advance_days(1)
    faq.write_text(original, encoding="utf-8")
    reverted = harness.run()
    assert outcomes(reverted)["https://www.example-firm.test/faq"] == "matched_earlier_snapshot"
    rows = harness.conn.execute("SELECT id FROM source_snapshots WHERE requested_url LIKE '%/faq'").fetchall()
    assert len(rows) == 2
    source = harness.conn.execute(
        "SELECT latest_snapshot_id FROM collector_sources WHERE canonical_url LIKE '%/faq'"
    ).fetchone()
    assert source["latest_snapshot_id"] == first


def test_force_ignores_lastmod(harness: Harness) -> None:
    seeded(harness)
    harness.run()
    harness.advance_days(1)
    assert outcomes(harness.run(force=True))[RULES] == "unchanged"


def test_failures_keep_all_previous_snapshots(harness: Harness, site_copy: Path) -> None:
    seeded(harness)
    harness.run()
    before = snapshot_count(harness.conn)
    (site_copy / "www.example-firm.test" / "faq.html").unlink()
    harness.advance_days(1)
    result = outcomes(harness.run())
    assert result["https://www.example-firm.test/faq"] == "http_error"
    assert snapshot_count(harness.conn) == before
    source = harness.conn.execute(
        "SELECT last_outcome, latest_snapshot_id FROM collector_sources WHERE canonical_url LIKE '%/faq'"
    ).fetchone()
    assert source["last_outcome"] == "http_error" and source["latest_snapshot_id"] is not None


def test_terms_gate_blocks_live_fetching_without_any_request(harness: Harness) -> None:
    firm = add_firm(
        harness.conn,
        harness.clock,
        hosts={
            "www.example-firm.test": (HostRole.HOMEPAGE, TermsDecision.PROHIBITED),
        },
    )
    add_seed(harness.conn, firm, harness.clock, RULES)
    summary = harness.run()
    assert outcomes(summary)[RULES] == "terms_blocked"
    assert harness.site.requests == []
    assert summary.exit_code() == 4


def test_unclear_terms_need_acknowledgement_and_use_5s_pacing(harness: Harness) -> None:
    firm = add_firm(
        harness.conn,
        harness.clock,
        hosts={"www.example-firm.test": (HostRole.HOMEPAGE, TermsDecision.UNCLEAR)},
        accept_unclear=True,
    )
    add_seed(harness.conn, firm, harness.clock, RULES)
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/faq")
    harness.run(discover=False)
    assert harness.site.requests[0].endswith("/robots.txt")
    assert harness.clock.slept and min(harness.clock.slept) >= 5.0


def test_stale_terms_review_blocks(harness: Harness) -> None:
    firm = add_firm(harness.conn, harness.clock)
    add_seed(harness.conn, firm, harness.clock, RULES)
    harness.advance_days(366)
    assert outcomes(harness.run())[RULES] == "terms_blocked"


def test_bot_challenge_stops_the_host_and_never_retries_another_way(harness: Harness) -> None:
    firm = add_firm(
        harness.conn,
        harness.clock,
        "sample-funding",
        hosts={
            "www.sample-funding.test": (HostRole.HOMEPAGE, TermsDecision.ALLOWED),
            "support.sample-funding.test": (HostRole.HELP_CENTER, TermsDecision.ALLOWED),
        },
    )
    add_seed(harness.conn, firm, harness.clock, "https://support.sample-funding.test/rules")
    add_seed(harness.conn, firm, harness.clock, "https://www.sample-funding.test/program-rules")
    summary = harness.run("sample-funding")
    result = outcomes(summary)
    assert result["https://support.sample-funding.test/rules"] in ("robots_unreachable", "circuit_open")
    assert result["https://www.sample-funding.test/program-rules"] == "new_snapshot"
    state = circuit.current(harness.conn, "support.sample-funding.test", harness.clock.now())
    assert state.state is CircuitState.BLOCKED_BOT_PROTECTION
    support_requests = [u for u in harness.site.requests if "support.sample-funding.test" in u]
    assert support_requests == ["https://support.sample-funding.test/robots.txt"]
    # Next run, days later: still stopped, still no request.
    harness.advance_days(10)
    again = outcomes(harness.run("sample-funding"))
    assert again["https://support.sample-funding.test/rules"] == "circuit_open"
    assert [u for u in harness.site.requests if "support.sample-funding.test" in u] == support_requests
    assert summary.exit_code() == 4


def test_product_token_robots_group_is_obeyed(harness: Harness) -> None:
    firm = add_firm(
        harness.conn,
        harness.clock,
        "sample-funding",
        hosts={"www.sample-funding.test": (HostRole.HOMEPAGE, TermsDecision.ALLOWED)},
    )
    add_seed(harness.conn, firm, harness.clock, "https://www.sample-funding.test/members/area")
    add_seed(harness.conn, firm, harness.clock, "https://www.sample-funding.test/program-rules")
    result = outcomes(harness.run("sample-funding", discover=False))
    assert result["https://www.sample-funding.test/members/area"] == "robots_blocked"
    assert result["https://www.sample-funding.test/program-rules"] == "new_snapshot"


def test_budget_is_enforced(harness: Harness) -> None:
    seeded(harness, max_fetches=3)
    summary = harness.run()
    assert summary.fetches_used <= 3
    assert any(r.outcome is Outcome.BUDGET_EXHAUSTED for r in summary.results)


def test_deadline_is_enforced(harness: Harness) -> None:
    seeded(harness)
    harness.settings = harness.settings.model_copy(
        update={
            "budget": harness.settings.budget.model_copy(update={"run_deadline_minutes": 1}),
            "pacing": harness.settings.pacing.model_copy(update={"min_delay_seconds": 20.0}),
        }
    )
    summary = harness.run()
    assert summary.status == "deadline_exceeded"
    assert summary.exit_code() >= 4


def test_dry_run_makes_no_requests_and_writes_nothing(harness: Harness) -> None:
    seeded(harness)
    counts_before = {
        t: harness.conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]  # noqa: S608
        for t in ("crawl_runs", "fetch_attempts", "source_snapshots", "policy_events", "robots_cache")
    }
    summary = harness.run(dry_run=True)
    assert harness.site.requests == []
    assert {
        t: harness.conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]  # noqa: S608
        for t in counts_before
    } == counts_before
    assert {line[0] for line in summary.dry_run_lines} == {"allowed"}


def test_dry_run_reports_blocked_targets_after_robots_is_cached(harness: Harness) -> None:
    seeded(harness)
    harness.run()
    summary = harness.run(dry_run=True)
    lines = {url: decision for decision, url, _ in summary.dry_run_lines}
    assert lines["https://www.example-firm.test/private/internal"] == "robots_blocked"
    assert lines[RULES] == "allowed"


def test_zendesk_incremental_cursor_and_no_html_fallback(harness: Harness) -> None:
    seeded(harness)
    harness.run()
    cursor = harness.conn.execute("SELECT zendesk_cursor FROM collector_sources WHERE kind = 'zendesk'").fetchone()[0]
    assert cursor is not None
    harness.advance_days(1)
    harness.run()
    assert any("/incremental/articles.json?start_time=" in u for u in harness.site.requests)
    assert not any("/hc/en-us/articles/" in u for u in harness.site.requests)  # article pages never scraped


def test_js_page_without_browser_is_stored_thin_and_requires_js_reports_unavailable(harness: Harness) -> None:
    firm = add_firm(harness.conn, harness.clock)
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/funded-dashboard")
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/evaluation-rules", requires_js=True)
    result = outcomes(harness.run(discover=False))
    assert result["https://www.example-firm.test/funded-dashboard"] == "new_snapshot"
    warnings = harness.conn.execute(
        "SELECT warnings FROM source_snapshots WHERE requested_url LIKE '%funded-dashboard'"
    ).fetchone()["warnings"]
    assert "thin_content" in warnings
    assert result["https://www.example-firm.test/evaluation-rules"] == "render_unavailable"


def test_disabled_firm_and_source(harness: Harness) -> None:
    firm = seeded(harness)
    source = next(s for s in registry.list_sources(harness.conn, firm.id) if s.canonical_url == RULES)
    registry.update_source(harness.conn, source, now=harness.clock.now(), enabled=False)
    result = outcomes(harness.run(discover=False))
    assert result[source.canonical_url] == "disabled"
    registry.set_firm_enabled(harness.conn, firm, False, "testing", harness.clock.now())
    summary = harness.run()
    assert summary.status == "skipped_disabled" and summary.exit_code() == 4


def test_nothing_becomes_verified_and_no_app_database_is_created(harness: Harness, isolated_env: Path) -> None:
    seeded(harness)
    harness.run()
    app_dir = Path(os.environ["APPDATA"]) / "com.fundedflow.desktop"
    assert not app_dir.exists()
    tables = {r["name"] for r in harness.conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert not tables & {"rulebooks", "rule_candidates", "catalogue_sources", "reviews", "providers"}
    columns = {r["name"] for r in harness.conn.execute("PRAGMA table_info(source_snapshots)")}
    assert "verification_status" not in columns
