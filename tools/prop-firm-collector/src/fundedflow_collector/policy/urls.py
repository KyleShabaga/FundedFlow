"""URL safety and canonical form.

Only http(s), no credentials, ports 80/443, no IP-literal hosts, bounded length. Hosts are lowercased and
IDNA-encoded, default ports dropped, dot segments removed, percent-escapes normalised and fragments stripped.
Query strings are kept in their original order because servers may depend on it.
"""

from __future__ import annotations

import fnmatch
import ipaddress
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

MAX_URL_LENGTH = 2048
ALLOWED_PORTS = frozenset({80, 443})
_HOST_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")
_PCT = re.compile(r"%([0-9A-Fa-f]{2})")
_UNRESERVED = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
_FORBIDDEN_CHARS = re.compile(r"[\x00-\x20\x7f\\]")


class UrlRejected(ValueError):
    def __init__(self, url: str, reason: str) -> None:
        super().__init__(f"{reason}: {url[:200]}")
        self.url = url
        self.reason = reason


def normalise_host(host: str) -> str:
    """Lowercase, IDNA-encode and validate a host name. IP literals are rejected."""
    text = host.strip().rstrip(".").lower()
    if not text:
        raise UrlRejected(host, "empty host")
    if text.startswith("[") or _is_ip_literal(text):
        raise UrlRejected(host, "IP-literal hosts are not allowed")
    try:
        ascii_host = text.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise UrlRejected(host, "invalid internationalised host name") from exc
    labels = ascii_host.split(".")
    if len(ascii_host) > 253 or len(labels) < 2 or not all(_HOST_LABEL.match(label) for label in labels):
        raise UrlRejected(host, "invalid host name")
    return ascii_host


def _is_ip_literal(text: str) -> bool:
    try:
        ipaddress.ip_address(text)
    except ValueError:
        pass
    else:
        return True
    # Legacy numeric forms such as 2130706433 or 0x7f.1 are IP addresses to many resolvers.
    return bool(re.fullmatch(r"(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}", text))


def _normalise_escapes(component: str) -> str:
    def fix(match: re.Match[str]) -> str:
        char = chr(int(match.group(1), 16))
        return char if char in _UNRESERVED else "%" + match.group(1).upper()

    return _PCT.sub(fix, component)


def _encode_unsafe(component: str, safe: str) -> str:
    out = []
    for ch in component:
        if ch in _UNRESERVED or ch in safe or ch == "%":
            out.append(ch)
        else:
            out.extend(f"%{b:02X}" for b in ch.encode("utf-8"))
    return "".join(out)


def _remove_dot_segments(path: str) -> str:
    segments: list[str] = []
    for segment in path.split("/")[1:]:
        if segment == "..":
            if segments:
                segments.pop()
        elif segment != ".":
            segments.append(segment)
    trailing = path.endswith(("/.", "/..")) and segments
    result = "/" + "/".join(segments)
    return result + "/" if trailing and not result.endswith("/") else result


def canonicalize(raw: str) -> str:
    """Return the canonical form of an absolute http(s) URL, or raise UrlRejected."""
    text = raw.strip()
    if len(text) > MAX_URL_LENGTH:
        raise UrlRejected(raw, "URL is too long")
    if _FORBIDDEN_CHARS.search(text):
        raise UrlRejected(raw, "URL contains control characters, spaces or backslashes")
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError as exc:
        raise UrlRejected(raw, "malformed URL") from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise UrlRejected(raw, f"scheme {scheme or '(none)'!r} is not allowed")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise UrlRejected(raw, "URLs with credentials are not allowed")
    if parts.hostname is None:
        raise UrlRejected(raw, "URL has no host")
    host = normalise_host(parts.hostname)
    if port is not None and port not in ALLOWED_PORTS:
        raise UrlRejected(raw, f"port {port} is not allowed (80 and 443 only)")
    default_port = 443 if scheme == "https" else 80
    netloc = host if port in (None, default_port) else f"{host}:{port}"
    path = _remove_dot_segments(_encode_unsafe(_normalise_escapes(parts.path or "/"), "/:@!$&'()*+,;="))
    query = _encode_unsafe(_normalise_escapes(parts.query), "/?:@!$&'()*+,;=")
    canonical = urlunsplit((scheme, netloc, path, query, ""))
    if len(canonical) > MAX_URL_LENGTH:
        raise UrlRejected(raw, "URL is too long")
    return canonical


def resolve_link(base: str, href: str) -> str:
    """Resolve a link found on `base` and canonicalise it."""
    href = href.strip()
    if not href or href.startswith("#"):
        raise UrlRejected(href, "fragment-only link")
    return canonicalize(urljoin(base, href))


def host_of(url: str) -> str:
    host = urlsplit(url).hostname
    if host is None:
        raise UrlRejected(url, "URL has no host")
    return host


def path_of(url: str) -> str:
    parts = urlsplit(url)
    return parts.path + ("?" + parts.query if parts.query else "")


def matches_excluded(url: str, patterns: list[str]) -> str | None:
    """Return the first excluded glob pattern matching the URL path (and query), if any."""
    path = path_of(url)
    for pattern in patterns:
        if fnmatch.fnmatchcase(path, pattern) or fnmatch.fnmatchcase(urlsplit(url).path, pattern):
            return pattern
    return None
