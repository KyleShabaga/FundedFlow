"""DNS-pinned httpcore network backend (research addendum §6).

Validate-then-fetch is unsafe because a second DNS lookup can return a different address (rebinding). This
backend resolves each host once per connection, rejects the connection if *any* resolved address is not
globally routable, and opens the socket to the validated IP. httpcore still passes the original host name for
TLS SNI and the request keeps its Host header, so certificates are verified against the real name.

httpx and httpcore are pinned exactly in pyproject.toml because this implements httpcore's backend interface.
"""

from __future__ import annotations

import ipaddress
import threading
from collections.abc import Callable, Iterable

import httpcore

from fundedflow_collector.net.resolver import Resolver
from fundedflow_collector.policy.addresses import is_public_address
from fundedflow_collector.policy.urls import ALLOWED_PORTS


class AddressBlocked(Exception):
    """A resolved address is not public, or the port is not 80/443. Never retried."""

    def __init__(self, host: str, detail: str) -> None:
        super().__init__(f"{host}: {detail}")
        self.host = host
        self.detail = detail


AddressCheck = Callable[[str], bool]


class PinnedNetworkBackend(httpcore.NetworkBackend):
    def __init__(
        self,
        resolver: Resolver,
        inner: httpcore.NetworkBackend | None = None,
        address_allowed: AddressCheck = is_public_address,
    ) -> None:
        self._resolver = resolver
        self._inner = inner or httpcore.SyncBackend()
        self._address_allowed = address_allowed
        self._lock = threading.Lock()
        self.connections: list[tuple[str, str]] = []

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.NetworkStream:
        if port not in ALLOWED_PORTS:
            raise AddressBlocked(host, f"port {port} is not allowed")
        try:
            addresses = self._resolver.resolve(host, port)
        except OSError as exc:
            raise httpcore.ConnectError(f"DNS lookup failed for {host}: {exc}") from exc
        if not addresses:
            raise httpcore.ConnectError(f"DNS lookup returned no addresses for {host}")
        blocked = [a for a in addresses if not self._address_allowed(a)]
        if blocked:
            raise AddressBlocked(host, "resolves to non-public address(es) " + ", ".join(sorted(blocked)))
        pinned = addresses[0]
        ipaddress.ip_address(pinned)  # the inner backend must receive an IP literal, never a name
        with self._lock:
            self.connections.append((host, pinned))
        return self._inner.connect_tcp(
            pinned, port, timeout=timeout, local_address=local_address, socket_options=socket_options
        )

    def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.NetworkStream:
        raise AddressBlocked(path, "unix sockets are not allowed")

    def sleep(self, seconds: float) -> None:
        self._inner.sleep(seconds)

    def last_ip_for(self, host: str) -> str | None:
        with self._lock:
            for name, ip in reversed(self.connections):
                if name == host:
                    return ip
        return None
