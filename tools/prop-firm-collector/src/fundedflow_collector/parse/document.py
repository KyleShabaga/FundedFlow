"""The parser-neutral result every adapter (HTML, PDF, text, browser, Zendesk) produces."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Heading:
    level: int
    text: str
    offset: int | None


@dataclass(frozen=True)
class Table:
    caption: str | None
    preceding_heading: str | None
    headers: list[str]
    rows: list[list[str]]


@dataclass(frozen=True)
class Link:
    href: str
    text: str


@dataclass
class ParsedDocument:
    title: str | None
    text: str
    parser_name: str
    parser_version: str
    headings: list[Heading] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def structure(self) -> dict[str, Any]:
        return {
            "headings": [{"level": h.level, "text": h.text, "offset": h.offset} for h in self.headings],
            "tables": [
                {"caption": t.caption, "preceding_heading": t.preceding_heading, "headers": t.headers, "rows": t.rows}
                for t in self.tables
            ],
            "links": [{"href": link.href, "text": link.text} for link in self.links],
        }


class ParseError(Exception):
    pass


class ParseTimeout(Exception):
    pass
