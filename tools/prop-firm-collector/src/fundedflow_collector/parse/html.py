"""HTML extraction: trafilatura for readable text, BeautifulSoup on lxml for title, headings, tables and links.

Scripts are never executed. `script`, `style`, `template`, `iframe` and similar elements are removed before any
text is taken, and the result is plain text, never trusted HTML.
"""

from __future__ import annotations

import warnings
from importlib import metadata

import trafilatura
from bs4 import BeautifulSoup, MarkupResemblesLocatorWarning, Tag, UnicodeDammit

from fundedflow_collector.parse.document import Heading, Link, ParsedDocument, ParseError, Table
from fundedflow_collector.parse.hashing import normalise_inline, normalise_text

PARSER_NAME = "trafilatura+bs4"
STRIP_TAGS = (
    "script",
    "style",
    "noscript",
    "template",
    "iframe",
    "object",
    "embed",
    "svg",
    "canvas",
    "button",
    "select",
    "textarea",
    "input",
)
MAX_TABLES = 50
MAX_ROWS = 200
MAX_COLS = 30
MAX_CELL_CHARS = 1000
MAX_LINKS = 2000
MAX_HEADINGS = 500


def parser_version() -> str:
    versions = [
        f"{name} {metadata.version(dist)}"
        for name, dist in (("trafilatura", "trafilatura"), ("bs4", "beautifulsoup4"), ("lxml", "lxml"))
    ]
    return "; ".join(versions)


def decode_html(raw: bytes, charset: str | None = None) -> str:
    dammit = UnicodeDammit(raw, [charset] if charset else [], is_html=True)
    if dammit.unicode_markup is None:
        raise ParseError("could not decode HTML")
    return str(dammit.unicode_markup)


def parse_html(
    raw: bytes | str,
    *,
    max_bytes: int,
    charset: str | None = None,
    min_text_chars: int = 300,
    title_override: str | None = None,
) -> ParsedDocument:
    size = len(raw.encode("utf-8")) if isinstance(raw, str) else len(raw)
    if size > max_bytes:
        raise ParseError(f"HTML is {size} bytes, over the {max_bytes}-byte limit")
    markup = raw if isinstance(raw, str) else decode_html(raw, charset)
    warns: list[str] = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", MarkupResemblesLocatorWarning)
        try:
            soup = BeautifulSoup(markup, "lxml")
        except Exception as exc:  # lxml raises several types on hostile input
            raise ParseError(f"HTML could not be parsed: {exc}") from exc
    for element in soup.find_all(STRIP_TAGS):
        element.decompose()
    for element in soup.find_all(True):
        if isinstance(element, Tag):
            for attr in [a for a in element.attrs if a.lower().startswith("on")]:
                del element.attrs[attr]

    title = title_override
    if title is None and soup.title is not None and soup.title.string:
        title = normalise_inline(soup.title.string) or None
    if title is None:
        h1 = soup.find("h1")
        if h1 is not None:
            title = normalise_inline(h1.get_text(" ")) or None

    extracted = None
    try:
        extracted = trafilatura.extract(
            str(soup),
            output_format="txt",
            include_tables=True,
            include_comments=False,
            include_links=False,
            include_images=False,
            favor_recall=True,
            deduplicate=False,
            with_metadata=False,
        )
    except Exception:  # trafilatura is defensive but not exhaustive on malformed markup
        warns.append("trafilatura_failed")
    text = normalise_text(extracted or "")
    body = soup.body or soup
    if len(text) < min_text_chars:
        fallback = normalise_text(body.get_text("\n"))
        if len(fallback) > len(text):
            text = fallback
            warns.append("fallback_full_text")
    if len(text) < min_text_chars:
        warns.append("thin_content")

    headings = _headings(soup, text)
    tables = _tables(soup)
    links = _links(soup)
    return ParsedDocument(
        title=title,
        text=text,
        parser_name=PARSER_NAME,
        parser_version=parser_version(),
        headings=headings,
        tables=tables,
        links=links,
        warnings=sorted(set(warns)),
    )


def _headings(soup: BeautifulSoup, text: str) -> list[Heading]:
    result: list[Heading] = []
    cursor = 0
    for element in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
        if len(result) >= MAX_HEADINGS:
            break
        label = normalise_inline(element.get_text(" "))
        if not label:
            continue
        found = text.find(label, cursor)
        offset = found if found >= 0 else None
        if found >= 0:
            cursor = found + len(label)
        result.append(Heading(level=int(element.name[1]), text=label[:500], offset=offset))
    return result


def _cell(element: Tag) -> str:
    return normalise_inline(element.get_text(" "))[:MAX_CELL_CHARS]


def _tables(soup: BeautifulSoup) -> list[Table]:
    result: list[Table] = []
    for table in soup.find_all("table"):
        if len(result) >= MAX_TABLES:
            break
        if not isinstance(table, Tag) or table.find_parent("table") is not None:
            continue
        caption_el = table.find("caption")
        caption = _cell(caption_el) if isinstance(caption_el, Tag) else None
        heading_el = table.find_previous(["h1", "h2", "h3", "h4", "h5", "h6"])
        heading = normalise_inline(heading_el.get_text(" "))[:500] if isinstance(heading_el, Tag) else None
        rows: list[list[str]] = []
        headers: list[str] = []
        for tr in table.find_all("tr"):
            if not isinstance(tr, Tag) or tr.find_parent("table") is not table:
                continue
            cells = [c for c in tr.find_all(["th", "td"], recursive=False) if isinstance(c, Tag)][:MAX_COLS]
            if not cells:
                continue
            values = [_cell(c) for c in cells]
            if not headers and not rows and all(c.name == "th" for c in cells):
                headers = values
            elif len(rows) < MAX_ROWS:
                rows.append(values)
        if headers or rows:
            result.append(Table(caption=caption or None, preceding_heading=heading or None, headers=headers, rows=rows))
    return result


def _links(soup: BeautifulSoup) -> list[Link]:
    result: list[Link] = []
    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        if len(result) >= MAX_LINKS:
            break
        if not isinstance(anchor, Tag):
            continue
        href = str(anchor.get("href", "")).strip()
        lowered = href.lower()
        if not href or lowered.startswith(("javascript:", "mailto:", "tel:", "data:", "#")):
            continue
        if href in seen:
            continue
        seen.add(href)
        result.append(Link(href=href[:2048], text=normalise_inline(anchor.get_text(" "))[:300]))
    return result
