"""Reading publisher tables by their header text, failing closed when the layout is not the expected one.

Adapters describe tables by visible header labels, not CSS classes, so cosmetic redesigns do not matter. A wide
table with a column the adapter does not know, a missing required column, or rows whose width does not match the
header is a `structure_changed` result with no observations from that table: values are never read from a shifted
column. Key-value tables (label | value) are different: an unknown label cannot shift anything, so it is skipped
and reported in the page warnings instead of failing the page.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Tag

from fundedflow_collector.directory.values import clean

HEADINGS = ("h1", "h2", "h3", "h4")


class StructureChanged(Exception):
    """The page no longer has the structure this adapter version was written for."""


@dataclass
class Cell:
    text: str
    links: list[tuple[str, str]]
    node: Tag | None = None

    def first_link(self) -> str | None:
        return self.links[0][0] if self.links else None


@dataclass
class Table:
    index: int
    headers: list[str]
    rows: list[list[Cell]]
    headings: list[str]  # nearest preceding headings, innermost first
    node: Tag
    truncated: bool = False


@dataclass(frozen=True)
class Column:
    role: str  # firm | programme | firm_programme | size | phase | variant | market | field | ignore
    field: str | None = None
    reason: str | None = None  # why an ignored column is ignored, e.g. "editorial rating"


@dataclass
class TableSpec:
    """Expected columns of one kind of wide table. Keys are `header_key()` forms of the visible header text."""

    columns: dict[str, Column]
    signature: frozenset[str]  # header keys that identify this table on the page
    required_roles: frozenset[str] = frozenset()

    def matches(self, table: Table) -> bool:
        keys = {header_key(h) for h in table.headers}
        return self.signature <= keys


@dataclass
class KeyValueSpec:
    labels: dict[str, Column]  # label key -> field/dimension
    unknown: list[str] = field(default_factory=list)


def header_key(text: str) -> str:
    return re.sub(r"[\s]+", " ", re.sub(r"[.:*?!()]", "", clean(text).lower())).strip()


def soup_of(html: bytes) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def _cell(node: Tag) -> Cell:
    links = []
    for anchor in node.find_all("a"):
        href = anchor.get("href")
        if isinstance(href, str) and href.strip():
            links.append((href.strip(), clean(anchor.get_text(" ", strip=True))))
    return Cell(clean(node.get_text(" ", strip=True)), links, node)


def _span(node: Tag, name: str) -> int:
    value = node.get(name)
    try:
        number = int(str(value)) if value is not None else 1
    except ValueError:
        return 1
    return max(1, min(number, 50))


def _headings(node: Tag) -> list[str]:
    return [clean(h.get_text(" ", strip=True)) for h in node.find_all_previous(list(HEADINGS), limit=6)]


def read_tables(soup: BeautifulSoup, *, max_rows: int) -> list[Table]:
    """Every table with a header row, with row/col spans expanded. Rows past `max_rows` are cut and flagged."""
    tables: list[Table] = []
    for index, node in enumerate(soup.find_all("table")):
        rows = [tr for tr in node.find_all("tr") if tr.find_parent("table") is node]
        if not rows:
            continue
        header_row = rows[0]
        header_cells = header_row.find_all(["th", "td"], recursive=False)
        if not header_cells or not header_row.find("th"):
            continue  # a layout table, or a table without headers: not something an adapter reads
        headers: list[str] = []
        for th in header_cells:
            headers.extend([clean(th.get_text(" ", strip=True))] * _span(th, "colspan"))
        grid: list[list[Cell]] = []
        carry: dict[int, tuple[Cell, int]] = {}
        truncated = False
        for tr in rows[1:]:
            if len(grid) >= max_rows:
                truncated = True
                break
            cells = tr.find_all(["td", "th"], recursive=False)
            row: list[Cell] = []
            queue = list(cells)
            col = 0
            while queue or col in carry:
                if col in carry:
                    carried, remaining = carry[col]
                    row.append(carried)
                    if remaining <= 1:
                        del carry[col]
                    else:
                        carry[col] = (carried, remaining - 1)
                    col += 1
                    continue
                td = queue.pop(0)
                value = _cell(td)
                width = _span(td, "colspan")
                height = _span(td, "rowspan")
                for _ in range(width):
                    row.append(value)
                    if height > 1:
                        carry[col] = (value, height - 1)
                    col += 1
            if not any(c.text or c.links for c in row):
                continue
            grid.append(row)
        tables.append(Table(index, headers, grid, _headings(node), node, truncated))
    return tables


def map_columns(table: Table, spec: TableSpec) -> list[Column]:
    """The role of each column, or StructureChanged if any header is unknown or a required role is missing."""
    columns: list[Column] = []
    for header in table.headers:
        column = spec.columns.get(header_key(header))
        if column is None:
            raise StructureChanged(f"table {table.index}: unexpected column {header!r}")
        columns.append(column)
    present = {c.role for c in columns}
    missing = spec.required_roles - present
    if missing:
        raise StructureChanged(f"table {table.index}: missing {', '.join(sorted(missing))} column")
    for number, row in enumerate(table.rows, start=1):
        if len(row) != len(columns):
            raise StructureChanged(
                f"table {table.index} row {number}: {len(row)} cells under {len(columns)} headers (columns shifted?)"
            )
    return columns


def key_value_rows(node: Tag) -> list[tuple[str, Cell]]:
    """Label/value pairs from a two-column table or a <dl> inside `node`."""
    pairs: list[tuple[str, Cell]] = []
    for table in node.find_all("table") if node.name != "table" else [node]:
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"], recursive=False)
            if len(cells) == 2:
                pairs.append((clean(cells[0].get_text(" ", strip=True)), _cell(cells[1])))
    for dl in node.find_all("dl") if node.name != "dl" else [node]:
        for dt in dl.find_all("dt"):
            dd = dt.find_next_sibling("dd")
            if isinstance(dd, Tag):
                pairs.append((clean(dt.get_text(" ", strip=True)), _cell(dd)))
    return pairs


def visible_text(soup: BeautifulSoup) -> str:
    body = soup.body or soup
    return clean(body.get_text(" ", strip=True))


def looks_client_rendered(soup: BeautifulSoup) -> bool:
    """An app shell without its data: template placeholders, an empty app root, or a 'needs JavaScript' notice."""
    text = visible_text(soup)
    if re.search(r"\{[a-z_]{2,40}\}", text):
        return True
    noscript = " ".join(n.get_text(" ", strip=True).lower() for n in soup.find_all("noscript"))
    if "javascript" in noscript and len(text) < 600:
        return True
    for root_id in ("__next", "root", "app", "__nuxt"):
        node = soup.find(id=root_id)
        if isinstance(node, Tag) and not clean(node.get_text(" ", strip=True)):
            return True
    return False
