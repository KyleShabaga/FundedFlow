"""Sitemap parsing with defusedxml: no DTDs or entities, streaming gzip cap, at most 50,000 URLs per file.

Index depth and cycle detection are enforced by the runner, which knows which sitemaps it has visited.
"""

from __future__ import annotations

import gzip
import io
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

MAX_INDEX_DEPTH = 2


class SitemapError(Exception):
    pass


@dataclass(frozen=True)
class SitemapEntry:
    loc: str
    lastmod: str | None


@dataclass
class SitemapDocument:
    urls: list[SitemapEntry] = field(default_factory=list)
    children: list[SitemapEntry] = field(default_factory=list)
    truncated: bool = False


def decompress_if_gzip(raw: bytes, max_bytes: int) -> bytes:
    if not raw.startswith(b"\x1f\x8b"):
        return raw
    out = io.BytesIO()
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            while chunk := stream.read(65536):
                out.write(chunk)
                if out.tell() > max_bytes:
                    raise SitemapError(f"decompressed sitemap exceeds {max_bytes} bytes")
    except (OSError, EOFError, zlib.error) as exc:
        raise SitemapError(f"invalid gzip sitemap: {exc}") from exc
    return out.getvalue()


def _local(tag: object) -> str:
    text = str(tag)
    return text.rsplit("}", 1)[-1].lower()


def parse_sitemap(raw: bytes, *, max_bytes: int, max_urls: int) -> SitemapDocument:
    data = decompress_if_gzip(raw, max_bytes)
    if len(data) > max_bytes:
        raise SitemapError(f"sitemap exceeds {max_bytes} bytes")
    try:
        root = ElementTree.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (DefusedXmlException, ElementTree.ParseError) as exc:
        raise SitemapError(f"sitemap XML rejected: {exc}") from exc
    kind = _local(root.tag)
    if kind not in ("urlset", "sitemapindex"):
        raise SitemapError(f"not a sitemap (root element {kind!r})")
    doc = SitemapDocument()
    child_name = "url" if kind == "urlset" else "sitemap"
    for element in root:
        if _local(element.tag) != child_name:
            continue
        loc = lastmod = None
        for part in element:
            name = _local(part.tag)
            if name == "loc" and part.text:
                loc = part.text.strip()
            elif name == "lastmod" and part.text:
                lastmod = part.text.strip()
        if not loc:
            continue
        target = doc.urls if kind == "urlset" else doc.children
        if len(target) >= max_urls:
            doc.truncated = True
            break
        target.append(SitemapEntry(loc=loc, lastmod=lastmod))
    return doc


def parse_lastmod(value: str | None) -> datetime | None:
    """W3C datetime (`2026-10-01` or a full timestamp). Date-only values are taken as midnight UTC."""
    if not value:
        return None
    text = value.strip()
    try:
        if len(text) == 10:
            return datetime.fromisoformat(text).replace(tzinfo=UTC)
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
