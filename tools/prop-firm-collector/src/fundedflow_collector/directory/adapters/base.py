"""The common adapter contract: which of a publisher's pages are in scope, what links to follow, and how a stored
page version becomes records.

An adapter never makes a request. The runner fetches through the Build 29 pipeline; the adapter classifies URLs
(bounded: known page kinds only, at most `max_pagination_pages` list pages, no filter or sort permutations) and
reads stored HTML. Unknown layouts fail closed (`structure_changed`), client-rendered shells report
`js_unavailable`, and a page the adapter has no reader for is kept as a snapshot only (`unsupported_page`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import ClassVar
from urllib.parse import parse_qsl, urlsplit, urlunsplit

from bs4 import BeautifulSoup, Tag

from fundedflow_collector.directory.model import (
    FIELDS,
    ExtractedRecord,
    Extraction,
    ExtractionStatus,
    FieldObservation,
    Market,
    PageKind,
    Phase,
    RecordIdentity,
)
from fundedflow_collector.directory.tables import (
    Cell,
    Column,
    KeyValueSpec,
    StructureChanged,
    Table,
    TableSpec,
    header_key,
    key_value_rows,
    looks_client_rendered,
    map_columns,
    read_tables,
    soup_of,
)
from fundedflow_collector.directory.values import (
    clean,
    drawdown_basis,
    parse_market,
    parse_phase,
    size_in_text,
)
from fundedflow_collector.policy.urls import UrlRejected, host_of, resolve_link

#: Research qualifiers a publisher attaches to a value. They are kept with the value, never dropped.
DEFAULT_QUALIFIERS = (
    r"verify the exact configuration before checkout",
    r"price not verified",
    r"terms wording requires confirmation",
    r"needs review",
    r"unconfirmed",
    r"as of [a-z]+ \d{4}",
)
OFFICIAL_LINK_TEXT = re.compile(r"official (?:web ?site|site|rules|help ?cent(?:er|re))|firm'?s (?:own )?website", re.I)


@dataclass(frozen=True)
class PageRule:
    kind: PageKind
    pattern: re.Pattern[str]  # full match against the URL path (no query)


def rule(kind: PageKind, pattern: str) -> PageRule:
    return PageRule(kind, re.compile(pattern))


class DirectoryAdapter:
    """Base class. Subclasses set the class attributes and implement `read_page`."""

    name: ClassVar[str]
    version: ClassVar[str]
    description: ClassVar[str]
    page_rules: ClassVar[tuple[PageRule, ...]]
    follows: ClassVar[dict[PageKind, frozenset[PageKind]]] = {}
    pagination_param: ClassVar[str | None] = "page"
    max_pagination_pages: ClassVar[int] = 5
    max_rows: ClassVar[int] = 500
    qualifiers: ClassVar[tuple[str, ...]] = DEFAULT_QUALIFIERS
    #: Markers that mean "this list is genuinely empty" (as opposed to a layout the adapter does not know).
    empty_markers: ClassVar[tuple[str, ...]] = ("no firms found", "no results", "no programmes listed")
    market_by_path: ClassVar[tuple[tuple[str, Market], ...]] = ()

    # ------------------------------------------------------------------ scope

    def classify(self, url: str) -> PageKind | None:
        """The page kind of an in-scope URL, or None. Query strings other than a list page number are refused."""
        parts = urlsplit(url)
        if parts.query:
            params = parse_qsl(parts.query, keep_blank_values=True)
            if self.pagination_param is None or len(params) != 1 or params[0][0] != self.pagination_param:
                return None
            if not params[0][1].isdigit() or not 2 <= int(params[0][1]) <= self.max_pagination_pages:
                return None
        for page_rule in self.page_rules:
            if page_rule.pattern.fullmatch(parts.path):
                if parts.query and page_rule.kind not in (PageKind.LISTING, PageKind.COMPARISON):
                    return None
                return page_rule.kind
        return None

    def follow(self, from_kind: PageKind, url: str) -> PageKind | None:
        kind = self.classify(url)
        if kind is not None and kind in self.follows.get(from_kind, frozenset()):
            return kind
        return None

    def page_number(self, url: str) -> int:
        for name, value in parse_qsl(urlsplit(url).query):
            if name == self.pagination_param and value.isdigit():
                return int(value)
        return 1

    def market_for(self, url: str) -> Market:
        path = urlsplit(url).path
        for prefix, market in self.market_by_path:
            if path.startswith(prefix):
                return market
        return Market.UNSPECIFIED

    # ------------------------------------------------------------------ reading

    def extract(self, html: bytes, url: str) -> Extraction:
        kind = self.classify(url) or PageKind.UNSUPPORTED
        try:
            soup = soup_of(html)
        except Exception as exc:
            return Extraction(kind, ExtractionStatus.PARSE_ERROR, detail=f"HTML could not be parsed: {exc}"[:300])
        links = self.links(soup, url)
        if kind is PageKind.UNSUPPORTED:
            return Extraction(kind, ExtractionStatus.UNSUPPORTED_PAGE, detail="no reader for this page", links=links)
        try:
            extraction = self.read_page(kind, soup, url)
        except StructureChanged as exc:
            extraction = Extraction(kind, ExtractionStatus.STRUCTURE_CHANGED, detail=str(exc)[:500])
        extraction.links = links
        empty = extraction.status is ExtractionStatus.COLLECTED and not extraction.records
        if empty and kind in (PageKind.COMPARISON, PageKind.PROFILE):
            extraction.status, extraction.detail = self._empty_or_missing(soup)
        return extraction

    def read_page(self, kind: PageKind, soup: BeautifulSoup, url: str) -> Extraction:
        raise NotImplementedError

    def links(self, soup: BeautifulSoup, base: str) -> list[tuple[str, str]]:
        found: list[tuple[str, str]] = []
        seen: set[str] = set()
        for anchor in soup.find_all("a"):
            href = anchor.get("href")
            if not isinstance(href, str):
                continue
            try:
                url = resolve_link(base, href)
            except UrlRejected:
                continue
            if url not in seen and host_of(url) == host_of(base) and self.classify(url) is not None:
                seen.add(url)
                found.append((url, clean(anchor.get_text(" ", strip=True))))
        return found

    def _empty_or_missing(self, soup: BeautifulSoup) -> tuple[ExtractionStatus, str]:
        text = clean(soup.get_text(" ", strip=True)).lower()
        if any(marker in text for marker in self.empty_markers):
            return ExtractionStatus.NO_RECORDS, "the page says it lists nothing"
        if looks_client_rendered(soup):
            return ExtractionStatus.JS_UNAVAILABLE, "the list is filled in by JavaScript; use the browser or capture it"
        return ExtractionStatus.STRUCTURE_CHANGED, "the expected table or section was not found"

    # ------------------------------------------------------------------ helpers for subclasses

    def tables(self, soup: BeautifulSoup) -> list[Table]:
        return read_tables(soup, max_rows=self.max_rows)

    def split_qualifier(self, text: str) -> tuple[str, str | None]:
        found: list[str] = []
        value = text
        for pattern in self.qualifiers:
            match = re.search(pattern, value, re.I)
            if match:
                found.append(clean(match.group(0)))
                value = (value[: match.start()] + value[match.end() :]).strip(" ;,·-—")
        return clean(value), "; ".join(found) or None

    def entry_from(self, cell: Cell, base: str) -> tuple[str | None, str | None]:
        """(publisher entry id, entry URL) when a cell links to the publisher's own profile page for the firm."""
        for href, _text in cell.links:
            try:
                url = resolve_link(base, href)
            except UrlRejected:
                continue
            if host_of(url) == host_of(base) and self.classify(url) is PageKind.PROFILE:
                return urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1], url
        return None, None

    def first_party_link(self, soup: BeautifulSoup, base: str) -> str | None:
        """A link the publisher labels as the firm's official site, as displayed but without its query string
        (which on these sites carries affiliate tags). Recorded only, never fetched."""
        for anchor in soup.find_all("a"):
            href = anchor.get("href")
            if not isinstance(href, str) or not OFFICIAL_LINK_TEXT.search(anchor.get_text(" ", strip=True)):
                continue
            try:
                url = resolve_link(base, href)
            except UrlRejected:
                continue
            if host_of(url) != host_of(base):
                parts = urlsplit(url)
                return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        return None

    def wide_table_records(
        self,
        table: Table,
        spec: TableSpec,
        *,
        base: RecordIdentity,
        url: str,
        warnings: list[str],
    ) -> list[ExtractedRecord]:
        columns = map_columns(table, spec)
        ignored = sorted(
            {f"{h} ({c.reason})" for h, c in zip(table.headers, columns, strict=True) if c.role == "ignore"}
        )
        if ignored:
            warnings.append(f"table {table.index}: not read: {', '.join(ignored)}")
        if table.truncated:
            warnings.append(f"table {table.index}: stopped after {self.max_rows} rows")
        records: list[ExtractedRecord] = []
        for number, row in enumerate(table.rows, start=1):
            identity = RecordIdentity(
                firm_name=base.firm_name,
                programme_name=base.programme_name,
                variant=base.variant,
                account_size_raw=base.account_size_raw,
                phase=base.phase,
                market=base.market,
                publisher_entry_id=base.publisher_entry_id,
                entry_url=base.entry_url,
                first_party_url=base.first_party_url,
            )
            fields: list[tuple[str, str, Cell]] = []
            for header, column, cell in zip(table.headers, columns, row, strict=True):
                self._apply_dimension(identity, column, cell, url)
                if column.role == "field" and column.field is not None:
                    fields.append((header, column.field, cell))
            if not identity.firm_name:
                raise StructureChanged(f"table {table.index} row {number}: no firm name")
            if identity.account_size_raw is None:
                identity.account_size_raw = size_in_text(identity.programme_name)
            record = ExtractedRecord(identity)
            has_type_column = any(f == "drawdown_type" for _h, f, _c in fields)
            for header, field_name, cell in fields:
                location = f"table {table.index} row {number} column {header!r}"
                self._add_field(record, field_name, header, cell.text, location, has_type_column)
            records.append(record)
        return records

    def key_value_record(
        self, node: Tag, spec: KeyValueSpec, *, identity: RecordIdentity, location: str, url: str
    ) -> ExtractedRecord | None:
        record = ExtractedRecord(identity)
        fields: list[tuple[str, str, str]] = []
        for label, cell in key_value_rows(node):
            column = spec.labels.get(header_key(label))
            if column is None:
                spec.unknown.append(label)
                continue
            if column.role == "field" and column.field is not None:
                fields.append((label, column.field, cell.text))
            else:
                self._apply_dimension(identity, column, cell, url)
        if not fields:
            return None
        if identity.account_size_raw is None:
            identity.account_size_raw = size_in_text(identity.programme_name)
        has_type = any(f == "drawdown_type" for _l, f, _t in fields)
        for label, field_name, text in fields:
            self._add_field(record, field_name, label, text, f"{location} label {label!r}", has_type)
        return record

    def _apply_dimension(self, identity: RecordIdentity, column: Column, cell: Cell, url: str) -> None:
        text = cell.text
        if column.role == "firm":
            identity.firm_name = self.firm_name(cell)
            entry_id, entry_url = self.entry_from(cell, url)
            identity.publisher_entry_id = entry_id or identity.publisher_entry_id
            identity.entry_url = entry_url or identity.entry_url
        elif column.role == "firm_programme":
            firm, programme = self.split_firm_programme(cell)
            identity.firm_name, identity.programme_name = firm, programme
            entry_id, entry_url = self.entry_from(cell, url)
            identity.publisher_entry_id = entry_id or identity.publisher_entry_id
            identity.entry_url = entry_url or identity.entry_url
        elif column.role == "programme":
            identity.programme_name = text or None
        elif column.role == "size":
            identity.account_size_raw = text or None
        elif column.role == "phase":
            identity.phase = parse_phase(text)
        elif column.role == "variant":
            identity.variant = text or None
        elif column.role == "market":
            identity.market = parse_market(text)

    def _add_field(
        self, record: ExtractedRecord, field_name: str, label: str, raw: str, location: str, has_type_column: bool
    ) -> None:
        assert field_name in FIELDS, field_name
        value, qualifier = self.split_qualifier(raw)
        record.fields.append(FieldObservation(field_name, label, value, location, qualifier))
        if field_name == "max_drawdown" and not has_type_column and drawdown_basis(value):
            record.fields.append(
                FieldObservation("drawdown_type", label, value, location + " (type stated in the drawdown text)")
            )

    def firm_name(self, cell: Cell) -> str:
        anchor_text = cell.links[0][1] if cell.links else ""
        return anchor_text or cell.text

    def split_firm_programme(self, cell: Cell) -> tuple[str, str | None]:
        """A combined "Firm / programme" cell. Default: the link text is the firm, the rest the programme."""
        firm = self.firm_name(cell)
        rest = clean(cell.text.replace(firm, "", 1)).strip(" -—–/|·")
        return firm, rest or None


def heading_phase(headings: list[str]) -> Phase:
    for heading in headings:
        phase = parse_phase(heading)
        if phase is not Phase.UNSPECIFIED:
            return phase
    return Phase.UNSPECIFIED


def heading_of(node: Tag, names: tuple[str, ...]) -> str | None:
    found = node.find_previous(list(names))
    return clean(found.get_text(" ", strip=True)) if isinstance(found, Tag) else None


def page_title(soup: BeautifulSoup) -> str | None:
    h1 = soup.find("h1")
    return clean(h1.get_text(" ", strip=True)) if isinstance(h1, Tag) else None


def spec(columns: dict[str, Column], signature: list[str], required: list[str]) -> TableSpec:
    return TableSpec(
        {header_key(k): v for k, v in columns.items()},
        frozenset(header_key(s) for s in signature),
        frozenset(required),
    )


def F(field_name: str) -> Column:
    return Column("field", field_name)


def D(role: str) -> Column:
    return Column(role)


def IGNORE(reason: str) -> Column:
    return Column("ignore", reason=reason)


EDITORIAL = IGNORE("editorial rating or ranking, not a rule")
COMMERCIAL = IGNORE("affiliate offer, coupon or checkout, not a rule")
DERIVED = IGNORE("the publisher's own calculation, not a displayed rule")
