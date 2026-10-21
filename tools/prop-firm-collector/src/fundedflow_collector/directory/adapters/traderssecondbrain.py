"""Trader's Second Brain (traderssecondbrain.com): the /prop-firms directory, /prop-firm/<slug> programme pages and
/guides/<firm>-review rule guides.

Layout notes from the 2026-10-21 public review: the directory table's columns are Rank, Firm / program, TSB Fit,
Target, Daily loss, Drawdown, Payout, Price / offer and Action; programme details sit under #program-details on the
firm page; rows carry research qualifiers such as "Verify the exact configuration before checkout". Rank and TSB
Fit are the publisher's scores, not rule facts, and Price / offer is an affiliate offer: none of them are read.
"Payout" alone does not say whether it is a split or a schedule, so it is kept as payout conditions text. The
/api/, /go/ and /track-prop/ paths and the unlicensed /prop-firms/data.json file are out of scope.
"""

from __future__ import annotations

from typing import ClassVar

from bs4 import BeautifulSoup, Tag

from fundedflow_collector.directory.adapters.base import (
    COMMERCIAL,
    EDITORIAL,
    D,
    DirectoryAdapter,
    F,
    heading_of,
    heading_phase,
    page_title,
    rule,
    spec,
)
from fundedflow_collector.directory.model import (
    ExtractedRecord,
    Extraction,
    ExtractionStatus,
    Market,
    PageKind,
    RecordIdentity,
)
from fundedflow_collector.directory.tables import KeyValueSpec, StructureChanged, header_key
from fundedflow_collector.policy.urls import UrlRejected, host_of, resolve_link

DIRECTORY = spec(
    {
        "Rank": EDITORIAL,
        "Firm / program": D("firm_programme"),
        "TSB Fit": EDITORIAL,
        "Target": F("profit_target"),
        "Daily loss": F("daily_loss_limit"),
        "Drawdown": F("max_drawdown"),
        "Payout": F("payout_conditions"),
        "Price / offer": COMMERCIAL,
        "Action": COMMERCIAL,
    },
    signature=["Firm / program", "Target"],
    required=["firm_programme"],
)
PROGRAMMES = spec(
    {
        "Program": D("programme"),
        "Account size": D("size"),
        "Phase": D("phase"),
        "Market": D("market"),
        "Profit target": F("profit_target"),
        "Daily loss": F("daily_loss_limit"),
        "Max drawdown": F("max_drawdown"),
        "Drawdown type": F("drawdown_type"),
        "Consistency": F("consistency_rule"),
        "Min. days": F("min_trading_days"),
        "Payout split": F("payout_split"),
        "Payout frequency": F("payout_frequency"),
        "Price": F("evaluation_fee"),
    },
    signature=["Program", "Account size"],
    required=["programme", "size"],
)
GUIDE_LABELS = {
    header_key(k): v
    for k, v in {
        "Account size": D("size"),
        "Phase": D("phase"),
        "Profit target": F("profit_target"),
        "Daily loss limit": F("daily_loss_limit"),
        "Max drawdown": F("max_drawdown"),
        "Drawdown type": F("drawdown_type"),
        "Consistency rule": F("consistency_rule"),
        "Minimum trading days": F("min_trading_days"),
        "Payout split": F("payout_split"),
        "Payout frequency": F("payout_frequency"),
        "Payout conditions": F("payout_conditions"),
        "Time limit": F("time_limit"),
    }.items()
}


class TradersSecondBrainAdapter(DirectoryAdapter):
    name = "traderssecondbrain"
    version = "1.0.0"
    description = "Trader's Second Brain directory, programme pages and rule guides"
    page_rules = (
        rule(PageKind.LISTING, r"/prop-firms/?"),
        rule(PageKind.PROFILE, r"/prop-firm/[a-z0-9-]{2,80}/?"),
        rule(PageKind.RULES_GUIDE, r"/guides/[a-z0-9-]{2,80}-review/?"),
    )
    follows: ClassVar[dict[PageKind, frozenset[PageKind]]] = {
        PageKind.LISTING: frozenset({PageKind.LISTING, PageKind.PROFILE}),
        PageKind.PROFILE: frozenset({PageKind.RULES_GUIDE}),
    }
    empty_markers = ("no firms match", "no firms found", "no programmes listed")

    def read_page(self, kind: PageKind, soup: BeautifulSoup, url: str) -> Extraction:
        warnings: list[str] = []
        if kind is PageKind.LISTING:
            table = next((t for t in self.tables(soup) if DIRECTORY.matches(t)), None)
            if table is None:
                status, detail = self._empty_or_missing(soup)
                return Extraction(kind, status, detail=detail)
            base = RecordIdentity(firm_name="")
            records = self.wide_table_records(table, DIRECTORY, base=base, url=url, warnings=warnings)
            return Extraction(kind, ExtractionStatus.COLLECTED, records, warnings=warnings)
        firm = page_title(soup)
        if not firm:
            raise StructureChanged("page has no <h1> firm name")
        firm = firm.removesuffix(" review").removesuffix(" Review").removesuffix(" rules")
        slug = url.rstrip("/").rsplit("/", 1)[-1].removesuffix("-review")
        official = self.first_party_link(soup, url) or self._source_link(soup, url)
        if kind is PageKind.PROFILE:
            section = soup.find(id="program-details")
            if not isinstance(section, Tag):
                status, detail = self._empty_or_missing(soup)
                return Extraction(kind, status, detail=detail)
            programme_records: list[ExtractedRecord] = []
            inner = BeautifulSoup(str(section), "lxml")
            for table in self.tables(inner):
                if not PROGRAMMES.matches(table):
                    raise StructureChanged(f"#program-details table {table.index}: unexpected columns")
                base = RecordIdentity(
                    firm_name=firm,
                    market=Market.UNSPECIFIED,
                    publisher_entry_id=slug,
                    entry_url=url,
                    first_party_url=official,
                )
                programme_records.extend(
                    self.wide_table_records(table, PROGRAMMES, base=base, url=url, warnings=warnings)
                )
            return Extraction(kind, ExtractionStatus.COLLECTED, programme_records, warnings=warnings)
        return self._guide(soup, url, firm, slug, official, warnings)

    def _guide(
        self, soup: BeautifulSoup, url: str, firm: str, slug: str, official: str | None, warnings: list[str]
    ) -> Extraction:
        records: list[ExtractedRecord] = []
        labels = KeyValueSpec(dict(GUIDE_LABELS))
        for number, table in enumerate(soup.find_all("table")):
            programme = heading_of(table, ("h2",))
            identity = RecordIdentity(
                firm_name=firm,
                programme_name=programme,
                phase=heading_phase([heading_of(table, ("h3",)) or ""]),
                publisher_entry_id=slug,
                entry_url=None,
                first_party_url=official,
            )
            record = self.key_value_record(table, labels, identity=identity, location=f"guide table {number}", url=url)
            if record is not None:
                records.append(record)
        if labels.unknown:
            warnings.append("guide labels not read: " + ", ".join(sorted(set(labels.unknown))))
        if not records:
            return Extraction(
                PageKind.RULES_GUIDE, ExtractionStatus.UNSUPPORTED_PAGE, detail="a prose guide with no rule table"
            )
        return Extraction(PageKind.RULES_GUIDE, ExtractionStatus.COLLECTED, records, warnings=warnings)

    def _source_link(self, soup: BeautifulSoup, url: str) -> str | None:
        """The first external link under the page's "Sources" heading, where the publisher lists its evidence."""
        for heading in soup.find_all(["h2", "h3"]):
            if heading.get_text(" ", strip=True).lower() not in ("sources", "official sources"):
                continue
            listing = heading.find_next(["ul", "ol"])
            if not isinstance(listing, Tag):
                return None
            for anchor in listing.find_all("a"):
                href = anchor.get("href")
                if not isinstance(href, str):
                    continue
                try:
                    link = resolve_link(url, href)
                except UrlRejected:
                    continue
                if host_of(link) != host_of(url):
                    return link.split("?", 1)[0]
        return None
