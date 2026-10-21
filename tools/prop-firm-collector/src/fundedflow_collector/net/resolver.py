"""DNS resolution behind a small protocol so tests can substitute a fake resolver."""

from __future__ import annotations

import socket
from typing import Protocol


class Resolver(Protocol):
    def resolve(self, host: str, port: int) -> list[str]: ...


class SystemResolver:
    def resolve(self, host: str, port: int) -> list[str]:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
        seen: list[str] = []
        for _family, _type, _proto, _canon, sockaddr in infos:
            address = str(sockaddr[0]).split("%", 1)[0] if ":" in str(sockaddr[0]) else str(sockaddr[0])
            if address not in seen:
                seen.append(address)
        return seen
