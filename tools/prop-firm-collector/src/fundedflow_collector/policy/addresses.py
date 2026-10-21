"""Which resolved addresses the collector may connect to: globally routable unicast only."""

from __future__ import annotations

import ipaddress

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_NAT64_LOCAL = ipaddress.ip_network("64:ff9b:1::/48")


def _embedded_ipv4(addr: ipaddress.IPv6Address) -> list[ipaddress.IPv4Address]:
    found: list[ipaddress.IPv4Address] = []
    if addr.ipv4_mapped is not None:
        found.append(addr.ipv4_mapped)
    if addr.sixtofour is not None:
        found.append(addr.sixtofour)
    if addr.teredo is not None:
        found.extend(addr.teredo)
    if addr in _NAT64:
        found.append(ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF))
    return found


def is_public_address(value: str | IPAddress) -> bool:
    """True only for globally routable unicast addresses (and any IPv4 they embed)."""
    try:
        addr = ipaddress.ip_address(value) if isinstance(value, str) else value
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.scope_id is not None or addr in _NAT64_LOCAL:
            return False
        embedded = _embedded_ipv4(addr)
        if embedded:
            return all(is_public_address(v4) for v4 in embedded)
    if addr.is_multicast or addr.is_unspecified or addr.is_loopback or addr.is_link_local:
        return False
    if addr.is_private or addr.is_reserved:
        return False
    return addr.is_global
