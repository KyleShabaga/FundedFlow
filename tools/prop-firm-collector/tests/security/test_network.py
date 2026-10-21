"""DNS pinning, rebinding, redirects, caps, cookies and the retry / circuit-breaker matrix (research addendum §1-§6)."""

from __future__ import annotations

import gzip
import socket
import ssl
import threading
from collections.abc import Iterable
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpcore
import httpx
import pytest

from fundedflow_collector.clock import FakeClock
from fundedflow_collector.net.client import (
    Block,
    FetchRequest,
    HostRunState,
    make_client,
    retry_after_seconds,
)
from fundedflow_collector.net.pinned_backend import AddressBlocked, PinnedNetworkBackend
from fundedflow_collector.net.transport import PinnedTransport
from fundedflow_collector.outcomes import CircuitState, Outcome
from tests.conftest import TEST_SETTINGS, UA, Handler, mock_fetcher

MB = 1024 * 1024


class FakeResolver:
    def __init__(self, answers: dict[str, list[list[str]]]) -> None:
        self.answers = {k: list(v) for k, v in answers.items()}
        self.calls: list[str] = []

    def resolve(self, host: str, port: int) -> list[str]:
        self.calls.append(host)
        queue = self.answers[host]
        return queue.pop(0) if len(queue) > 1 else queue[0]


class RecordingStream(httpcore.NetworkStream):
    def __init__(self) -> None:
        self.tls_server_hostname: str | None = None

    def start_tls(
        self, ssl_context: ssl.SSLContext, server_hostname: str | None = None, timeout: float | None = None
    ) -> httpcore.NetworkStream:
        self.tls_server_hostname = server_hostname
        raise httpcore.ConnectError("test stops after recording SNI")

    def close(self) -> None:
        pass


class RecordingBackend(httpcore.NetworkBackend):
    def __init__(self) -> None:
        self.connected: list[tuple[str, int]] = []
        self.streams: list[RecordingStream] = []

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.NetworkStream:
        self.connected.append((host, port))
        stream = RecordingStream()
        self.streams.append(stream)
        return stream


ALLOW_ALL: Block | None = None


def allow(_: str) -> Block | None:
    return ALLOW_ALL


# ---------------------------------------------------------------- DNS-pinned backend


def test_connects_to_the_validated_ip_and_keeps_the_name_for_sni() -> None:
    inner = RecordingBackend()
    backend = PinnedNetworkBackend(FakeResolver({"www.example-firm.test": [["93.184.216.34"]]}), inner)
    client = make_client(TEST_SETTINGS, PinnedTransport(backend), UA)
    with pytest.raises(httpx.ConnectError):
        client.get("https://www.example-firm.test/rules")
    assert inner.connected == [("93.184.216.34", 443)]
    assert inner.streams[0].tls_server_hostname == "www.example-firm.test"
    assert backend.last_ip_for("www.example-firm.test") == "93.184.216.34"


@pytest.mark.parametrize(
    "answer",
    [
        ["127.0.0.1"],
        ["10.1.2.3"],
        ["169.254.169.254"],
        ["::1"],
        ["fe80::1"],
        ["93.184.216.34", "192.168.0.10"],
        ["::ffff:127.0.0.1"],
        ["fd00::5"],
    ],
)
def test_any_non_public_answer_blocks_the_connection(answer: list[str]) -> None:
    inner = RecordingBackend()
    backend = PinnedNetworkBackend(FakeResolver({"evil.test": [answer]}), inner)
    with pytest.raises(AddressBlocked):
        backend.connect_tcp("evil.test", 443)
    assert inner.connected == []


def test_dns_rebinding_cannot_change_the_connected_address() -> None:
    """First lookup public, second lookup loopback: each connection re-resolves and re-validates."""
    inner = RecordingBackend()
    resolver = FakeResolver({"rebind.test": [["93.184.216.34"], ["127.0.0.1"]]})
    backend = PinnedNetworkBackend(resolver, inner)
    backend.connect_tcp("rebind.test", 443)
    with pytest.raises(AddressBlocked):
        backend.connect_tcp("rebind.test", 443)
    assert inner.connected == [("93.184.216.34", 443)]
    assert resolver.calls == ["rebind.test", "rebind.test"]


def test_ipv6_public_answer_is_allowed() -> None:
    inner = RecordingBackend()
    backend = PinnedNetworkBackend(FakeResolver({"v6.test": [["2606:4700:4700::1111"]]}), inner)
    backend.connect_tcp("v6.test", 443)
    assert inner.connected == [("2606:4700:4700::1111", 443)]


def test_ports_and_unix_sockets_are_refused() -> None:
    backend = PinnedNetworkBackend(FakeResolver({"a.test": [["93.184.216.34"]]}), RecordingBackend())
    with pytest.raises(AddressBlocked):
        backend.connect_tcp("a.test", 8080)
    with pytest.raises(AddressBlocked):
        backend.connect_unix_socket("/var/run/docker.sock")


def test_dns_failure_is_a_connect_error() -> None:
    class Failing:
        def resolve(self, host: str, port: int) -> list[str]:
            raise socket.gaierror("no such host")

    with pytest.raises(httpcore.ConnectError):
        PinnedNetworkBackend(Failing(), RecordingBackend()).connect_tcp("nx.test", 443)


def test_redirect_hop_to_a_private_host_is_blocked_through_the_real_transport(clock: FakeClock) -> None:
    """A public host redirects to a name that resolves to 10.0.0.1: the second hop never connects."""

    class RedirectStream(httpcore.NetworkStream):
        def __init__(self) -> None:
            self._sent = False

        def write(self, buffer: bytes, timeout: float | None = None) -> None:
            pass

        def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
            if self._sent:
                return b""
            self._sent = True
            return (
                b"HTTP/1.1 302 Found\r\nLocation: http://intranet.example-firm.test/admin\r\nContent-Length: 0\r\n\r\n"
            )

        def close(self) -> None:
            pass

    class Backend(httpcore.NetworkBackend):
        def __init__(self) -> None:
            self.connected: list[str] = []

        def connect_tcp(
            self,
            host: str,
            port: int,
            timeout: float | None = None,
            local_address: str | None = None,
            socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
        ) -> httpcore.NetworkStream:
            self.connected.append(host)
            return RedirectStream()

    inner = Backend()
    resolver = FakeResolver(
        {"www.example-firm.test": [["93.184.216.34"]], "intranet.example-firm.test": [["10.0.0.1"]]}
    )
    backend = PinnedNetworkBackend(resolver, inner)
    from fundedflow_collector.net.client import Fetcher

    fetcher = Fetcher(make_client(TEST_SETTINGS, PinnedTransport(backend), UA), clock, TEST_SETTINGS, backend)
    result = fetcher.fetch(FetchRequest("http://www.example-firm.test/", "text/html", MB), allow, HostRunState())
    assert result.outcome is Outcome.ADDRESS_BLOCKED
    assert inner.connected == ["93.184.216.34"]
    assert result.redirect_chain == ["http://www.example-firm.test/"]


@pytest.mark.loopback
@pytest.mark.enable_socket
@pytest.mark.allow_hosts(["127.0.0.1"])
def test_real_socket_round_trip_on_loopback_with_a_test_only_policy(clock: FakeClock) -> None:
    """End-to-end through real sockets. The loopback permission is injected in code; no config can do this."""
    seen: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            seen["host"] = self.headers.get("Host", "")
            seen["ua"] = self.headers.get("User-Agent", "")
            seen["cookie"] = self.headers.get("Cookie", "")
            body = b"<html><title>ok</title><body>loopback</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Set-Cookie", "session=abc")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:

        class PortMapping(httpcore.NetworkBackend):
            def connect_tcp(
                self,
                host: str,
                port_: int,
                timeout: float | None = None,
                local_address: str | None = None,
                socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
            ) -> httpcore.NetworkStream:
                assert host == "127.0.0.1"
                return httpcore.SyncBackend().connect_tcp(host, port, timeout=timeout)

        backend = PinnedNetworkBackend(
            FakeResolver({"loop.test": [["127.0.0.1"]]}), PortMapping(), address_allowed=lambda a: a == "127.0.0.1"
        )
        from fundedflow_collector.net.client import Fetcher

        fetcher = Fetcher(make_client(TEST_SETTINGS, PinnedTransport(backend), UA), clock, TEST_SETTINGS, backend)
        for _ in range(2):
            result = fetcher.fetch(FetchRequest("http://loop.test/", "text/html", MB), allow, HostRunState())
            assert result.status == 200 and result.body and b"loopback" in result.body
        assert seen["host"] == "loop.test"
        assert "FundedFlowCollector" in seen["ua"]
        assert seen["cookie"] == ""  # Set-Cookie from the first response was never sent back
        assert result.resolved_ip == "127.0.0.1"
    finally:
        server.shutdown()


# ---------------------------------------------------------------- client behaviour (mock transport)


def test_get_only_honest_headers_and_no_cookies(clock: FakeClock) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, headers={"set-cookie": "sid=1", "content-type": "text/html"}, content=b"ok")

    fetcher = mock_fetcher(handler, clock)
    for _ in range(2):
        fetcher.fetch(FetchRequest("https://www.example-firm.test/", "text/html", MB), allow, HostRunState())
    assert all(r.method == "GET" for r in requests)
    assert all("cookie" not in r.headers for r in requests)
    assert requests[0].headers["user-agent"] == UA
    assert requests[0].headers["accept-encoding"] == "gzip, deflate, br"


def test_conditional_request_and_304(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304, headers={"etag": '"v1"'})
        return httpx.Response(200, headers={"etag": '"v1"', "content-type": "text/html"}, content=b"page")

    fetcher = mock_fetcher(handler, clock)
    first = fetcher.fetch(FetchRequest("https://a.test/", "text/html", MB), allow, HostRunState())
    second = fetcher.fetch(
        FetchRequest("https://a.test/", "text/html", MB, etag='"v1"', last_modified="Tue, 20 Oct 2026 10:00:00 GMT"),
        allow,
        HostRunState(),
    )
    assert first.status == 200 and not first.conditional
    assert second.status == 304 and second.ok and second.body is None and second.conditional


def test_redirects_are_rechecked_and_capped(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/off":
            return httpx.Response(301, headers={"location": "https://evil.test/x"})
        if path.startswith("/loop"):
            n = int(path[5:] or 0)
            return httpx.Response(302, headers={"location": f"/loop{n + 1}"})
        if path == "/ok":
            return httpx.Response(302, headers={"location": "/final"})
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"final")

    checked: list[str] = []

    def hop(url: str) -> Block | None:
        checked.append(url)
        return Block(Outcome.NOT_ALLOWLISTED, "off allowlist") if "evil.test" in url else None

    fetcher = mock_fetcher(handler, clock)
    off = fetcher.fetch(FetchRequest("https://a.test/off", "text/html", MB), hop, HostRunState())
    assert off.outcome is Outcome.NOT_ALLOWLISTED and off.final_url == "https://evil.test/x"
    loop = fetcher.fetch(FetchRequest("https://a.test/loop", "text/html", MB), hop, HostRunState())
    assert loop.outcome is Outcome.HTTP_ERROR and "redirects" in (loop.reason or "")
    assert len(loop.redirect_chain) == 6
    ok = fetcher.fetch(FetchRequest("https://a.test/ok", "text/html", MB), hop, HostRunState())
    assert ok.status == 200 and ok.final_url == "https://a.test/final" and ok.redirect_chain == ["https://a.test/ok"]
    assert "https://a.test/final" in checked


def test_redirect_to_unsafe_scheme_is_rejected(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "file:///C:/Windows/win.ini"})

    result = mock_fetcher(handler, clock).fetch(FetchRequest("https://a.test/", "text/html", MB), allow, HostRunState())
    assert result.outcome is Outcome.URL_REJECTED


def test_byte_caps_including_decompression_bombs(clock: FakeClock) -> None:
    bomb = gzip.compress(b"a" * (20 * MB))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/bomb":
            return httpx.Response(200, headers={"content-encoding": "gzip", "content-type": "text/html"}, content=bomb)
        if request.url.path == "/declared":
            return httpx.Response(
                200, headers={"content-length": str(50 * MB), "content-type": "text/html"}, content=b"x"
            )
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"y" * (2 * MB))

    fetcher = mock_fetcher(handler, clock)
    for path in ("/bomb", "/declared", "/big"):
        result = fetcher.fetch(FetchRequest(f"https://a.test{path}", "text/html", MB), allow, HostRunState())
        assert result.outcome is Outcome.TOO_LARGE, path
    assert len(bomb) < MB


def test_oversized_headers_are_refused(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers=[(f"x-h{i}", "v" * 1000) for i in range(80)], content=b"x")

    result = mock_fetcher(handler, clock).fetch(FetchRequest("https://a.test/", "text/html", MB), allow, HostRunState())
    assert result.outcome is Outcome.TOO_LARGE


def sequence(*responses: httpx.Response) -> tuple[list[str], Handler]:
    calls: list[str] = []
    items = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return items.pop(0) if len(items) > 1 else items[0]

    return calls, handler


@pytest.mark.parametrize("status", [401, 451])
def test_401_and_451_stop_the_host_without_retry(clock: FakeClock, status: int) -> None:
    calls, handler = sequence(httpx.Response(status))
    result = mock_fetcher(handler, clock).fetch(
        FetchRequest("https://a.test/", "text/html", MB),
        allow,
        HostRunState(),
    )
    assert result.outcome is Outcome.ACCESS_DENIED and result.trip is CircuitState.ACCESS_DENIED
    assert len(calls) == 1 and clock.slept == []


def test_plain_403_gets_one_retry_after_60s_then_trips(clock: FakeClock) -> None:
    calls, handler = sequence(httpx.Response(403, content=b"Forbidden"))
    result = mock_fetcher(handler, clock).fetch(
        FetchRequest("https://a.test/", "text/html", MB),
        allow,
        HostRunState(),
    )
    assert len(calls) == 2 and clock.slept == [60.0]
    assert result.outcome is Outcome.ACCESS_DENIED and result.trip is CircuitState.ACCESS_DENIED


def test_403_that_clears_on_retry_is_fine(clock: FakeClock) -> None:
    calls, handler = sequence(
        httpx.Response(403), httpx.Response(200, headers={"content-type": "text/html"}, content=b"ok")
    )
    result = mock_fetcher(handler, clock).fetch(
        FetchRequest("https://a.test/", "text/html", MB),
        allow,
        HostRunState(),
    )
    assert result.ok and len(calls) == 2


def test_challenge_page_trips_without_retry(clock: FakeClock) -> None:
    calls, handler = sequence(
        httpx.Response(403, headers={"cf-mitigated": "challenge"}, content=b"<title>Just a moment...</title>")
    )
    result = mock_fetcher(handler, clock).fetch(
        FetchRequest("https://a.test/", "text/html", MB),
        allow,
        HostRunState(),
    )
    assert result.outcome is Outcome.BLOCKED_BOT_PROTECTION
    assert result.trip is CircuitState.BLOCKED_BOT_PROTECTION
    assert len(calls) == 1


def test_429_honours_retry_after_twice_and_third_trips(clock: FakeClock) -> None:
    calls, handler = sequence(httpx.Response(429, headers={"retry-after": "7"}))
    state = HostRunState()
    result = mock_fetcher(handler, clock).fetch(FetchRequest("https://a.test/", "text/html", MB), allow, state)
    assert clock.slept == [7.0, 7.0]
    assert len(calls) == 3
    assert result.outcome is Outcome.RATE_LIMITED and result.trip is CircuitState.RATE_LIMITED


def test_429_count_is_per_run_across_urls(clock: FakeClock) -> None:
    calls, handler = sequence(
        httpx.Response(429, headers={"retry-after": "1"}),
        httpx.Response(200, headers={"content-type": "text/html"}, content=b"ok"),
    )
    state = HostRunState()
    fetcher = mock_fetcher(handler, clock)
    assert fetcher.fetch(FetchRequest("https://a.test/1", "text/html", MB), allow, state).ok
    assert state.rate_limited_count == 1


def test_retry_after_is_capped_at_five_minutes(clock: FakeClock) -> None:
    assert retry_after_seconds("86400", clock.now()) == 300
    assert retry_after_seconds(None, clock.now()) == 60
    assert retry_after_seconds("Tue, 20 Oct 2026 12:01:00 GMT", clock.now()) == 60
    assert retry_after_seconds("garbage", clock.now()) == 60


def test_5xx_backs_off_then_reports_server_error(clock: FakeClock) -> None:
    calls, handler = sequence(httpx.Response(503))
    result = mock_fetcher(handler, clock).fetch(
        FetchRequest("https://a.test/", "text/html", MB),
        allow,
        HostRunState(),
    )
    assert clock.slept == [5.0, 15.0] and len(calls) == 3
    assert result.outcome is Outcome.SERVER_ERROR and result.trip is None


def test_timeouts_and_network_errors_retry_once(clock: FakeClock) -> None:
    attempts: list[int] = []

    def timeout(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        raise httpx.ReadTimeout("slow", request=request)

    result = mock_fetcher(timeout, clock).fetch(FetchRequest("https://a.test/", "text/html", MB), allow, HostRunState())
    assert result.outcome is Outcome.TIMEOUT and len(attempts) == 2 and clock.slept == [10.0]

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    result = mock_fetcher(refused, FakeClock()).fetch(
        FetchRequest("https://a.test/", "text/html", MB), allow, HostRunState()
    )
    assert result.outcome is Outcome.NETWORK_ERROR


def test_404_is_an_http_error_without_retry(clock: FakeClock) -> None:
    calls, handler = sequence(httpx.Response(404))
    result = mock_fetcher(handler, clock).fetch(
        FetchRequest("https://a.test/", "text/html", MB),
        allow,
        HostRunState(),
    )
    assert result.outcome is Outcome.HTTP_ERROR and len(calls) == 1 and result.trip is None


def test_robots_mode_never_retries_or_trips_on_denial(clock: FakeClock) -> None:
    calls, handler = sequence(httpx.Response(403))
    request = FetchRequest(
        "https://a.test/robots.txt", "text/plain", MB, retry=False, trip_on_denial=False, allow_truncate=True
    )
    result = mock_fetcher(handler, clock).fetch(request, allow, HostRunState())
    assert result.status == 403 and result.trip is None and len(calls) == 1


def test_recorded_headers_are_redacted_and_allowlisted(clock: FakeClock) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html", "set-cookie": "sid=secret", "x-internal": "1", "etag": '"e"'},
            content=b"ok",
        )

    result = mock_fetcher(handler, clock).fetch(FetchRequest("https://a.test/", "text/html", MB), allow, HostRunState())
    assert result.headers == {"content-type": "text/html", "etag": '"e"', "content-length": "2"}
