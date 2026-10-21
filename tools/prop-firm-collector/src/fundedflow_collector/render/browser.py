"""Plain Playwright Chromium renderer (research addendum §8).

Playwright's unmodified default User-Agent with the FundedFlowCollector token appended; no stealth patches or
fingerprint changes. Per page: a fresh browser and context, no persistent profile, service workers blocked,
downloads refused. `page.route` lets through only document/script/XHR/fetch requests to the firm's authorised
hosts (plus scripts and data from operator-approved asset hosts) and aborts everything else, including all
images, media and fonts. Chromium resolves DNS itself, so it is launched with `--host-resolver-rules` mapping
each allowed host to an IP the collector has already validated, and every other name to NOTFOUND.
"""

from __future__ import annotations

import contextlib
import time
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx

from fundedflow_collector.net.fixture_transport import FixtureSite

ALLOWED_RESOURCE_TYPES = frozenset({"document", "script", "xhr", "fetch"})


class RenderError(Exception):
    pass


@dataclass
class RenderResult:
    html: str
    final_url: str
    status: int | None
    headers: dict[str, str]
    duration_ms: int
    blocked_requests: list[str] = field(default_factory=list)


class Renderer(Protocol):
    def render(
        self,
        url: str,
        *,
        allowed_hosts: set[str],
        asset_hosts: set[str],
        host_ips: dict[str, str],
        fixture: FixtureSite | None,
    ) -> RenderResult: ...


def browser_status() -> tuple[bool, str]:
    """Whether the [browser] extra and its Chromium build are installed."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False, "the [browser] extra is not installed"
    try:
        with sync_playwright() as playwright:
            path = playwright.chromium.executable_path
    except Exception as exc:
        return False, f"Playwright could not start: {exc}"[:200]
    from pathlib import Path

    if not Path(path).exists():
        return False, "Chromium is not installed; run `uv run playwright install chromium`"
    return True, f"Chromium at {path}"


def resolver_rules(host_ips: dict[str, str]) -> str:
    rules = [f"MAP {host} {ip if ':' not in ip else '[' + ip + ']'}" for host, ip in sorted(host_ips.items())]
    rules.append("MAP * ~NOTFOUND")
    return ", ".join(rules)


def route_allows(url: str, resource_type: str, allowed_hosts: set[str], asset_hosts: set[str]) -> bool:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or resource_type not in ALLOWED_RESOURCE_TYPES:
        return False
    host = (parts.hostname or "").lower()
    if host in allowed_hosts:
        return True
    return resource_type != "document" and host in asset_hosts


class PlaywrightRenderer:
    def __init__(self, *, user_agent_suffix: str, navigation_timeout_seconds: float, headed: bool = False) -> None:
        self._suffix = user_agent_suffix
        self._timeout_ms = int(navigation_timeout_seconds * 1000)
        self._headed = headed

    def render(
        self,
        url: str,
        *,
        allowed_hosts: set[str],
        asset_hosts: set[str],
        host_ips: dict[str, str],
        fixture: FixtureSite | None,
    ) -> RenderResult:
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RenderError("the [browser] extra is not installed") from exc
        blocked: list[str] = []
        started = time.monotonic()

        def handle(route: Any) -> None:
            request = route.request
            if not route_allows(request.url, request.resource_type, allowed_hosts, asset_hosts):
                blocked.append(f"{request.resource_type} {request.url}"[:300])
                route.abort()
                return
            if fixture is not None:
                response = fixture.respond(httpx.Request("GET", request.url))
                route.fulfill(status=response.status_code, headers=dict(response.headers), body=response.content)
                return
            route.continue_()

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=not self._headed,
                    args=[f"--host-resolver-rules={resolver_rules(host_ips)}"],
                )
                try:
                    probe = browser.new_context()
                    default_ua = str(probe.new_page().evaluate("navigator.userAgent"))
                    probe.close()
                    context = browser.new_context(
                        user_agent=f"{default_ua} {self._suffix}", service_workers="block", accept_downloads=False
                    )
                    context.route("**/*", handle)
                    page = context.new_page()
                    page.set_default_navigation_timeout(self._timeout_ms)
                    page.set_default_timeout(self._timeout_ms)
                    response = page.goto(url, wait_until="load")
                    with contextlib.suppress(PlaywrightError):
                        page.wait_for_load_state("networkidle", timeout=5000)
                    html = page.content()
                    final_url = page.url
                    status = response.status if response is not None else None
                    headers = dict(response.headers) if response is not None else {}
                    context.close()
                finally:
                    browser.close()
        except PlaywrightError as exc:
            raise RenderError(str(exc).splitlines()[0][:300]) from exc
        return RenderResult(
            html=html,
            final_url=final_url,
            status=status,
            headers=headers,
            duration_ms=int((time.monotonic() - started) * 1000),
            blocked_requests=blocked,
        )
