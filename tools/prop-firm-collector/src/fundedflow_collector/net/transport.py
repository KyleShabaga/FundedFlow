"""A minimal httpx transport over an httpcore connection pool that uses the DNS-pinned backend.

HTTP/1.1 only, no proxies (none are configurable), no connection retries, TLS verified with certifi's CA bundle.
"""

from __future__ import annotations

import ssl
from collections.abc import Iterator

import certifi
import httpcore
import httpx

from fundedflow_collector.net.pinned_backend import PinnedNetworkBackend

_EXCEPTIONS: list[tuple[type[Exception], type[httpx.HTTPError]]] = [
    (httpcore.ConnectTimeout, httpx.ConnectTimeout),
    (httpcore.ReadTimeout, httpx.ReadTimeout),
    (httpcore.WriteTimeout, httpx.WriteTimeout),
    (httpcore.PoolTimeout, httpx.PoolTimeout),
    (httpcore.TimeoutException, httpx.TimeoutException),
    (httpcore.ConnectError, httpx.ConnectError),
    (httpcore.ReadError, httpx.ReadError),
    (httpcore.WriteError, httpx.WriteError),
    (httpcore.RemoteProtocolError, httpx.RemoteProtocolError),
    (httpcore.LocalProtocolError, httpx.LocalProtocolError),
    (httpcore.ProtocolError, httpx.ProtocolError),
    (httpcore.NetworkError, httpx.NetworkError),
]


def _map(exc: Exception) -> Exception:
    for source, target in _EXCEPTIONS:
        if isinstance(exc, source):
            return target(str(exc))
    return exc


def tls_context() -> ssl.SSLContext:
    context = ssl.create_default_context(cafile=certifi.where())
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


class _Stream(httpx.SyncByteStream):
    def __init__(self, stream: object) -> None:
        self._stream = stream

    def __iter__(self) -> Iterator[bytes]:
        try:
            yield from self._stream  # type: ignore[misc]
        except Exception as exc:
            raise _map(exc) from exc

    def close(self) -> None:
        close = getattr(self._stream, "close", None)
        if close is not None:
            close()


class PinnedTransport(httpx.BaseTransport):
    def __init__(self, backend: PinnedNetworkBackend) -> None:
        self.backend = backend
        self._pool = httpcore.ConnectionPool(
            ssl_context=tls_context(),
            max_connections=1,
            max_keepalive_connections=1,
            keepalive_expiry=5.0,
            http1=True,
            http2=False,
            retries=0,
            network_backend=backend,
        )

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        assert isinstance(request.stream, httpx.SyncByteStream)
        core_request = httpcore.Request(
            method=request.method,
            url=httpcore.URL(
                scheme=request.url.raw_scheme,
                host=request.url.raw_host,
                port=request.url.port,
                target=request.url.raw_path,
            ),
            headers=request.headers.raw,
            content=request.stream,
            extensions=request.extensions,
        )
        try:
            response = self._pool.handle_request(core_request)
        except Exception as exc:
            raise _map(exc) from exc
        return httpx.Response(
            status_code=response.status,
            headers=response.headers,
            stream=_Stream(response.stream),
            extensions=response.extensions,
        )

    def close(self) -> None:
        self._pool.close()
