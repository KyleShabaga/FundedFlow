"""Optional Playwright adapter. Rendering tests run only when the [browser] extra and Chromium are installed.

Every page request is fulfilled from the local fixture site through `page.route`, and Chromium is launched with
`--host-resolver-rules` that map every other name to NOTFOUND, so these tests make no internet requests.
pytest-socket is relaxed for them only because Playwright's driver uses a local socket pair.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from fundedflow_collector.net.fixture_transport import FixtureSite
from fundedflow_collector.render.browser import (
    PlaywrightRenderer,
    RenderError,
    browser_status,
    resolver_rules,
    route_allows,
)
from tests.conftest import REAL_LOCALAPPDATA, Harness, add_firm, add_seed

DASHBOARD = "https://www.example-firm.test/funded-dashboard"
ALLOWED = {"www.example-firm.test", "help.example-firm.test"}


def test_route_allowlist() -> None:
    assert route_allows(DASHBOARD, "document", ALLOWED, set())
    assert route_allows("https://www.example-firm.test/static/app.js", "script", ALLOWED, set())
    assert route_allows("https://help.example-firm.test/api/x", "fetch", ALLOWED, set())
    assert not route_allows("https://www.example-firm.test/static/banner.png", "image", ALLOWED, set())
    assert not route_allows("https://www.example-firm.test/font.woff2", "font", ALLOWED, set())
    assert not route_allows("https://www.example-firm.test/style.css", "stylesheet", ALLOWED, set())
    assert not route_allows("https://tracker.unrelated-site.test/pixel.js", "script", ALLOWED, set())
    assert route_allows("https://cdn.vendor.test/widget.js", "script", ALLOWED, {"cdn.vendor.test"})
    assert not route_allows("https://cdn.vendor.test/page", "document", ALLOWED, {"cdn.vendor.test"})
    assert not route_allows("data:text/html,<p>x</p>", "document", ALLOWED, set())
    assert not route_allows("ws://www.example-firm.test/socket", "websocket", ALLOWED, set())


def test_resolver_rules_pin_hosts_and_refuse_everything_else() -> None:
    rules = resolver_rules({"www.example-firm.test": "93.184.216.34", "v6.example-firm.test": "2606:4700::1"})
    assert rules == (
        "MAP v6.example-firm.test [2606:4700::1], MAP www.example-firm.test 93.184.216.34, MAP * ~NOTFOUND"
    )
    assert resolver_rules({}) == "MAP * ~NOTFOUND"


@pytest.fixture
def chromium(monkeypatch: pytest.MonkeyPatch) -> None:
    browsers = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or (
        str(Path(REAL_LOCALAPPDATA) / "ms-playwright") if REAL_LOCALAPPDATA else None
    )
    if browsers:
        monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", browsers)
    available, detail = browser_status()
    if not available:
        pytest.skip(f"browser extra not available: {detail}")


def renderer() -> PlaywrightRenderer:
    return PlaywrightRenderer(
        user_agent_suffix="FundedFlowCollector/0.1 (+https://example.invalid/ffc)", navigation_timeout_seconds=30
    )


@pytest.mark.browser
@pytest.mark.enable_socket
def test_renders_js_page_and_blocks_off_allowlist_and_media_requests(chromium: None, site_copy: Path) -> None:
    site = FixtureSite(site_copy)
    result = renderer().render(DASHBOARD, allowed_hosts=ALLOWED, asset_hosts=set(), host_ips={}, fixture=site)
    assert "Funded account rules" in result.html and "Scaling plan" in result.html
    assert result.status == 200 and result.final_url == DASHBOARD
    blocked = " ".join(result.blocked_requests)
    assert "tracker.unrelated-site.test/pixel.js" in blocked
    assert "banner.png" in blocked
    assert all("unrelated-site" not in url and not url.endswith(".png") for url in site.requests)
    assert "https://www.example-firm.test/static/app.js" in site.requests


@pytest.mark.browser
@pytest.mark.enable_socket
def test_chromium_cannot_resolve_names_outside_the_rules(chromium: None) -> None:
    """No fixture: the request continues to Chromium's resolver, which the rules make fail for every name."""
    with pytest.raises(RenderError, match=r"ERR_NAME_NOT_RESOLVED|net::"):
        renderer().render(
            "https://www.example-firm.test/", allowed_hosts=ALLOWED, asset_hosts=set(), host_ips={}, fixture=None
        )


@pytest.mark.browser
@pytest.mark.enable_socket
def test_runner_uses_the_browser_when_http_text_is_too_thin(chromium: None, harness: Harness) -> None:
    harness.renderer = renderer()
    firm = add_firm(harness.conn, harness.clock)
    add_seed(harness.conn, firm, harness.clock, DASHBOARD)
    summary = harness.run(discover=False)
    assert [r.outcome.value for r in summary.results] == ["new_snapshot"]
    row = harness.conn.execute("SELECT * FROM source_snapshots").fetchone()
    assert row["parser_name"] == "playwright+trafilatura+bs4"
    assert row["fetch_method"] == "fixture_replay"
    assert "Scaling plan" in row["text"] and "thin_content" not in row["warnings"]
    assert "browser_requests_blocked" in row["warnings"]


@pytest.mark.browser
@pytest.mark.enable_socket
def test_no_browser_flag_and_js_disabled_sources_skip_rendering(chromium: None, harness: Harness) -> None:
    harness.renderer = renderer()
    firm = add_firm(harness.conn, harness.clock)
    add_seed(harness.conn, firm, harness.clock, DASHBOARD, js_disabled=True)
    harness.run(discover=False)
    row = harness.conn.execute("SELECT parser_name, warnings FROM source_snapshots").fetchone()
    assert row["parser_name"] == "trafilatura+bs4" and "thin_content" in row["warnings"]


@pytest.mark.browser
@pytest.mark.enable_socket
def test_short_static_page_keeps_the_http_version_and_js_page_uses_304_next_time(
    chromium: None, harness: Harness
) -> None:
    harness.renderer = renderer()
    firm = add_firm(harness.conn, harness.clock)
    add_seed(harness.conn, firm, harness.clock, DASHBOARD)
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/payout-policy")
    harness.run(discover=False)
    rows = {
        r["requested_url"]: r
        for r in harness.conn.execute("SELECT requested_url, parser_name, fetch_method FROM source_snapshots")
    }
    assert rows["https://www.example-firm.test/payout-policy"]["parser_name"] == "trafilatura+bs4"
    assert rows[DASHBOARD]["parser_name"] == "playwright+trafilatura+bs4"
    etags = dict(harness.conn.execute("SELECT canonical_url, etag FROM collector_sources").fetchall())
    assert all(etags.values())
    harness.advance_days(1)
    again = harness.run(discover=False)
    assert {r.reason for r in again.results} == {"304 Not Modified"}
    forced = harness.run(discover=False, force=True)
    assert {r.outcome.value for r in forced.results} == {"unchanged"}
    assert {r.reason for r in forced.results} == {None}


@pytest.mark.browser
@pytest.mark.enable_socket
def test_in_browser_redirect_to_a_robots_disallowed_page_is_refused(
    chromium: None, harness: Harness, site_copy: Path
) -> None:
    page = site_copy / "www.example-firm.test" / "moved.html"
    page.write_text(
        '<html><head><script>location.replace("/private/internal")</script></head><body>Moving</body></html>',
        encoding="utf-8",
    )
    harness.renderer = renderer()
    firm = add_firm(harness.conn, harness.clock)
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/moved", requires_js=True)
    summary = harness.run(discover=False)
    assert [r.outcome.value for r in summary.results] == ["robots_blocked"]
    assert harness.conn.execute("SELECT COUNT(*) FROM source_snapshots").fetchone()[0] == 0
