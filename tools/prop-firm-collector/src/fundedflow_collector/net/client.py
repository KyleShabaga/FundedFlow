"""The fetch client: GET only, manual re-validated redirects, conditional requests, byte caps and the retry and
circuit-breaker rules of research addendum §1–§2.

No cookies are stored or sent, system proxies and .netrc are ignored (`trust_env=False`), and every redirect hop
goes back through the caller's policy check before it is requested.
"""

from __future__ import annotations

import email.utils
import http.cookiejar
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.request import Request as _UrllibRequest  # noqa: TID251 - type only, for the cookie policy signature

import httpx

from fundedflow_collector import USER_AGENT_PRODUCT
from fundedflow_collector.clock import Clock, format_instant
from fundedflow_collector.config import Settings
from fundedflow_collector.logging_setup import redact_headers
from fundedflow_collector.net.challenge import detect_challenge
from fundedflow_collector.net.pinned_backend import AddressBlocked, PinnedNetworkBackend
from fundedflow_collector.outcomes import CircuitState, Outcome
from fundedflow_collector.policy.urls import UrlRejected, host_of, resolve_link

MAX_REDIRECTS = 5
MAX_HEADER_BYTES = 64 * 1024
ERROR_BODY_SAMPLE = 256 * 1024
RETRY_AFTER_CAP_SECONDS = 300.0
RETRY_AFTER_DEFAULT_SECONDS = 60.0
FORBIDDEN_RETRY_SECONDS = 60.0
SERVER_ERROR_BACKOFF = (5.0, 15.0)
NETWORK_RETRY_SECONDS = 10.0
RECORDED_HEADERS = frozenset(
    {
        "content-type",
        "content-length",
        "etag",
        "last-modified",
        "retry-after",
        "cf-mitigated",
        "server",
        "location",
        "cache-control",
        "x-robots-tag",
        "content-encoding",
        "date",
        "x-amzn-waf-action",
        "age",
    }
)

ACCEPT_HTML = "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5"
ACCEPT_PDF = "application/pdf"
ACCEPT_XML = "application/xml,text/xml;q=0.9,application/x-gzip;q=0.5"
ACCEPT_JSON = "application/json"
ACCEPT_ROBOTS = "text/plain"


class NoCookiesPolicy(http.cookiejar.CookiePolicy):
    """Never accept or return a cookie."""

    netscape = True
    rfc2965 = False
    hide_cookie2 = True

    def set_ok(self, cookie: http.cookiejar.Cookie, request: _UrllibRequest) -> bool:
        return False

    def return_ok(self, cookie: http.cookiejar.Cookie, request: _UrllibRequest) -> bool:
        return False

    def domain_return_ok(self, domain: str, request: _UrllibRequest) -> bool:
        return False

    def path_return_ok(self, path: str, request: _UrllibRequest) -> bool:
        return False


class UserAgentNotConfigured(Exception):
    pass


def build_user_agent(settings: Settings, *, required: bool = True) -> str:
    info = settings.user_agent.info_url
    if info is None:
        if required:
            raise UserAgentNotConfigured(
                "set user_agent.info_url in collector.toml before fetching; see `collector doctor`"
            )
        info = "https://example.invalid/fundedflow-collector"
    contact = f"; {settings.user_agent.contact}" if settings.user_agent.contact else ""
    return f"Mozilla/5.0 (compatible; {USER_AGENT_PRODUCT}; +{info}{contact})"


def _strip_cookies(request: httpx.Request) -> None:
    """Belt and braces: no Cookie header ever leaves the collector."""
    request.headers.pop("cookie", None)


def make_client(settings: Settings, transport: httpx.BaseTransport, user_agent: str) -> httpx.Client:
    limits = settings.limits
    return httpx.Client(
        transport=transport,
        trust_env=False,
        follow_redirects=False,
        # A plain CookieJar is used as-is by httpx (an httpx.Cookies would be copied into a default jar).
        cookies=http.cookiejar.CookieJar(policy=NoCookiesPolicy()),
        event_hooks={"request": [_strip_cookies]},
        timeout=httpx.Timeout(
            connect=limits.connect_timeout_seconds,
            read=limits.read_timeout_seconds,
            write=limits.read_timeout_seconds,
            pool=limits.connect_timeout_seconds,
        ),
        headers={
            "User-Agent": user_agent,
            "Accept-Language": "en",
            "Accept-Encoding": "gzip, deflate, br",
        },
    )


@dataclass
class Block:
    """A policy refusal for a URL (from the caller's hop check)."""

    outcome: Outcome
    reason: str


HopCheck = Callable[[str], Block | None]


@dataclass
class HostRunState:
    """Per-host counters for one run (the third 429 in a run trips the circuit)."""

    rate_limited_count: int = 0


@dataclass
class FetchRequest:
    url: str
    accept: str
    max_bytes: int
    etag: str | None = None
    last_modified: str | None = None
    #: robots.txt: no retries, 4xx is "unavailable" rather than a denial, and an oversize body is truncated.
    retry: bool = True
    trip_on_denial: bool = True
    allow_truncate: bool = False


@dataclass
class FetchResult:
    requested_url: str
    started_at: str
    final_url: str | None = None
    redirect_chain: list[str] = field(default_factory=list)
    status: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes | None = None
    duration_ms: int = 0
    resolved_ip: str | None = None
    conditional: bool = False
    outcome: Outcome | None = None
    reason: str | None = None
    trip: CircuitState | None = None
    requests_made: int = 0

    @property
    def ok(self) -> bool:
        return self.outcome is None and self.status in (200, 304)

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "").split(";", 1)[0].strip().lower()

    @property
    def charset(self) -> str | None:
        for part in self.headers.get("content-type", "").split(";")[1:]:
            key, _, value = part.strip().partition("=")
            if key.lower() == "charset" and value:
                return value.strip("\"' ")
        return None


@dataclass
class _Response:
    status: int
    headers: dict[str, str]
    body: bytes
    final_url: str
    chain: list[str]


class Fetcher:
    def __init__(
        self, client: httpx.Client, clock: Clock, settings: Settings, backend: PinnedNetworkBackend | None = None
    ) -> None:
        self._client = client
        self._clock = clock
        self._settings = settings
        self._backend = backend

    def close(self) -> None:
        self._client.close()

    def fetch(self, request: FetchRequest, hop_check: HopCheck, host_state: HostRunState) -> FetchResult:
        result = FetchResult(
            requested_url=request.url,
            started_at=format_instant(self._clock.now()),
            conditional=bool(request.etag or request.last_modified),
        )
        began = time.monotonic()
        forbidden_retried = False
        server_retries = 0
        network_retried = False
        while True:
            result.requests_made += 1
            try:
                response = self._send(request, hop_check, result)
            except _Blocked as blocked:
                result.outcome, result.reason = blocked.block.outcome, blocked.block.reason
                break
            except AddressBlocked as exc:
                result.outcome, result.reason = Outcome.ADDRESS_BLOCKED, exc.detail
                break
            except _TooLarge as exc:
                result.outcome, result.reason = Outcome.TOO_LARGE, str(exc)
                break
            except UrlRejected as exc:
                result.outcome, result.reason = Outcome.URL_REJECTED, f"redirect target rejected: {exc.reason}"
                break
            except (httpx.TimeoutException, _TotalTimeout) as exc:
                if not network_retried and request.retry:
                    network_retried = True
                    self._clock.sleep(NETWORK_RETRY_SECONDS)
                    continue
                result.outcome, result.reason = Outcome.TIMEOUT, str(exc) or "timed out"
                break
            except httpx.HTTPError as exc:
                if not network_retried and request.retry:
                    network_retried = True
                    self._clock.sleep(NETWORK_RETRY_SECONDS)
                    continue
                result.outcome, result.reason = Outcome.NETWORK_ERROR, f"{type(exc).__name__}: {exc}"[:300]
                break

            result.status = response.status
            result.headers = response.headers
            result.final_url = response.final_url
            result.redirect_chain = response.chain
            status = response.status
            challenge = detect_challenge(status, response.headers, response.body)
            if challenge is not None:
                result.outcome, result.reason = Outcome.BLOCKED_BOT_PROTECTION, challenge
                result.trip = CircuitState.BLOCKED_BOT_PROTECTION
                break
            if status in (200, 304):
                result.body = response.body if status == 200 else None
                break
            if status in (401, 451) or (status == 403 and not request.trip_on_denial):
                result.outcome, result.reason = Outcome.ACCESS_DENIED, f"HTTP {status}"
                result.trip = CircuitState.ACCESS_DENIED if request.trip_on_denial else None
                break
            if status == 403:
                if not forbidden_retried and request.retry:
                    forbidden_retried = True
                    self._clock.sleep(FORBIDDEN_RETRY_SECONDS)
                    continue
                result.outcome, result.reason = Outcome.ACCESS_DENIED, "HTTP 403 persisted after one retry"
                result.trip = CircuitState.ACCESS_DENIED
                break
            if status == 429:
                host_state.rate_limited_count += 1
                if host_state.rate_limited_count >= 3:
                    result.outcome, result.reason = Outcome.RATE_LIMITED, "third HTTP 429 in this run"
                    result.trip = CircuitState.RATE_LIMITED
                    break
                if not request.retry:
                    result.outcome, result.reason = Outcome.RATE_LIMITED, "HTTP 429"
                    break
                self._clock.sleep(retry_after_seconds(response.headers.get("retry-after"), self._clock.now()))
                continue
            if 500 <= status <= 599:
                if request.retry and server_retries < len(SERVER_ERROR_BACKOFF):
                    self._clock.sleep(SERVER_ERROR_BACKOFF[server_retries])
                    server_retries += 1
                    continue
                result.outcome, result.reason = Outcome.SERVER_ERROR, f"HTTP {status} after retries"
                break
            if 300 <= status <= 399:
                result.outcome, result.reason = Outcome.HTTP_ERROR, f"HTTP {status} without a usable Location"
                break
            result.outcome, result.reason = Outcome.HTTP_ERROR, f"HTTP {status}"
            break
        result.duration_ms = int((time.monotonic() - began) * 1000)
        if self._backend is not None and result.final_url:
            result.resolved_ip = self._backend.last_ip_for(host_of(result.final_url))
        result.headers = {k: v for k, v in redact_headers(result.headers).items() if k in RECORDED_HEADERS}
        return result

    def _send(self, request: FetchRequest, hop_check: HopCheck, result: FetchResult) -> _Response:
        url = request.url
        chain: list[str] = []
        deadline = time.monotonic() + self._settings.limits.total_timeout_seconds
        for hop in range(MAX_REDIRECTS + 1):
            result.redirect_chain = list(chain)
            result.final_url = url
            if hop > 0:
                block = hop_check(url)
                if block is not None:
                    result.redirect_chain = chain
                    result.final_url = url
                    raise _Blocked(block)
            headers = {"Accept": request.accept}
            if hop == 0 and request.etag:
                headers["If-None-Match"] = request.etag
            if hop == 0 and request.last_modified:
                headers["If-Modified-Since"] = request.last_modified
            with self._client.stream("GET", url, headers=headers) as response:
                raw_headers = response.headers.raw
                if sum(len(k) + len(v) + 4 for k, v in raw_headers) > MAX_HEADER_BYTES:
                    raise _TooLarge("response headers exceed 64 KiB")
                header_map = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in raw_headers}
                status = response.status_code
                location = header_map.get("location")
                if status in (301, 302, 303, 307, 308) and location:
                    chain.append(url)
                    url = resolve_link(url, location)
                    continue
                limit = request.max_bytes if status == 200 else ERROR_BODY_SAMPLE
                body = self._read_capped(response, limit, deadline, strict=status == 200 and not request.allow_truncate)
                return _Response(status=status, headers=header_map, body=body, final_url=url, chain=chain)
        result.redirect_chain = chain
        raise _Blocked(Block(Outcome.HTTP_ERROR, f"more than {MAX_REDIRECTS} redirects"))

    @staticmethod
    def _read_capped(response: httpx.Response, limit: int, deadline: float, *, strict: bool) -> bytes:
        declared = response.headers.get("content-length")
        if strict and declared and declared.isdigit() and int(declared) > limit:
            raise _TooLarge(f"declared size {declared} bytes exceeds the {limit}-byte limit")
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_bytes():  # decoded bytes, so gzip/br bombs hit the cap too
            total += len(chunk)
            if total > limit:
                if strict:
                    raise _TooLarge(f"response exceeds the {limit}-byte limit")
                chunks.append(chunk[: limit - (total - len(chunk))])
                break
            chunks.append(chunk)
            if time.monotonic() > deadline:
                raise _TotalTimeout("response took longer than the total timeout")
        return b"".join(chunks)


class _Blocked(Exception):
    def __init__(self, block: Block) -> None:
        super().__init__(block.reason)
        self.block = block


class _TooLarge(Exception):
    pass


class _TotalTimeout(Exception):
    pass


def retry_after_seconds(value: str | None, now: datetime) -> float:
    """Seconds to wait for a Retry-After header (delta-seconds or HTTP date), capped at 5 minutes."""
    if not value:
        return RETRY_AFTER_DEFAULT_SECONDS
    text = value.strip()
    if text.isdigit():
        return min(float(text), RETRY_AFTER_CAP_SECONDS)
    try:
        when = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return RETRY_AFTER_DEFAULT_SECONDS
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return min(max((when - now).total_seconds(), 0.0), RETRY_AFTER_CAP_SECONDS)
