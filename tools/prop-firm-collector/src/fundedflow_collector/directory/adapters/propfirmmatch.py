"""Prop Firm Match, futures section (propfirmmatch.com/futures): firm listing, challenge table and firm profiles.

Policy status at the 2026-10-21 review: the site answered automated requests (including its terms page) with
HTTP 403, so the preset is manual capture only and this adapter reads pages the operator saved from a browser.
robots.txt also disallows `sort=` and `extendedFilters=` URLs and `/_next/data/`; this adapter never builds such
URLs. The challenge table keeps programme, step count (variant), account size and phase as separate dimensions.
"""

from __future__ import annotations

from typing import ClassVar

from bs4 import BeautifulSoup

from fundedflow_collector.directory.adapters.base import (
    COMMERCIAL,
    EDITORIAL,
    IGNORE,
    D,
    DirectoryAdapter,
    F,
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
from fundedflow_collector.directory.tables import StructureChanged

NOT_A_RULE = IGNORE("firm metadata, not a rule")
LISTING = spec(
    {
        "Firm": D("firm"),
        "Rating": EDITORIAL,
        "Reviews": EDITORIAL,
        "Country": NOT_A_RULE,
        "Platforms": NOT_A_RULE,
        "Max Allocation": F("max_allocation"),
        "Offer": COMMERCIAL,
    },
    signature=["Firm", "Max Allocation"],
    required=["firm"],
)
_CHALLENGE_COLUMNS = {
    "Program": D("programme"),
    "Steps": D("variant"),
    "Account Size": D("size"),
    "Phase": D("phase"),
    "Profit Target": F("profit_target"),
    "Daily Loss": F("daily_loss_limit"),
    "Max Loss": F("max_drawdown"),
    "Drawdown Type": F("drawdown_type"),
    "Consistency Rule": F("consistency_rule"),
    "Min. Trading Days": F("min_trading_days"),
    "Payout Split": F("payout_split"),
    "Price": F("evaluation_fee"),
    "Discount": COMMERCIAL,
    "Rating": EDITORIAL,
}
CHALLENGES = spec(
    {"Firm": D("firm"), **_CHALLENGE_COLUMNS},
    signature=["Firm", "Program", "Account Size"],
    required=["firm", "programme", "size"],
)
PROFILE = spec(_CHALLENGE_COLUMNS, signature=["Program", "Account Size"], required=["programme", "size"])


class PropFirmMatchFuturesAdapter(DirectoryAdapter):
    name = "propfirmmatch-futures"
    version = "1.0.0"
    description = "Prop Firm Match futures listing, challenge table and firm profiles"
    page_rules = (
        rule(PageKind.LISTING, r"/futures/?"),
        rule(PageKind.COMPARISON, r"/futures/prop-firm-challenges/?"),
        rule(PageKind.PROFILE, r"/futures/prop-firms/[a-z0-9-]{2,80}/?"),
    )
    follows: ClassVar[dict[PageKind, frozenset[PageKind]]] = {
        PageKind.LISTING: frozenset({PageKind.LISTING, PageKind.PROFILE, PageKind.COMPARISON}),
        PageKind.COMPARISON: frozenset({PageKind.COMPARISON, PageKind.PROFILE}),
    }
    market_by_path = (("/futures", Market.FUTURES),)

    def read_page(self, kind: PageKind, soup: BeautifulSoup, url: str) -> Extraction:
        warnings: list[str] = []
        market = self.market_for(url)
        records: list[ExtractedRecord] = []
        if kind is PageKind.PROFILE:
            firm = page_title(soup)
            if not firm:
                raise StructureChanged("profile page has no <h1> firm name")
            base = RecordIdentity(
                firm_name=firm,
                market=market,
                publisher_entry_id=url.rstrip("/").rsplit("/", 1)[-1],
                entry_url=url,
                first_party_url=self.first_party_link(soup, url),
            )
            tables = [t for t in self.tables(soup) if PROFILE.matches(t)]
            for table in tables:
                records.extend(self.wide_table_records(table, PROFILE, base=base, url=url, warnings=warnings))
            return Extraction(kind, ExtractionStatus.COLLECTED, records, warnings=warnings)
        table_spec = LISTING if kind is PageKind.LISTING else CHALLENGES
        found = next((t for t in self.tables(soup) if table_spec.matches(t)), None)
        if found is None:
            status, detail = self._empty_or_missing(soup)
            return Extraction(kind, status, detail=detail)
        base = RecordIdentity(firm_name="", market=market)
        records = self.wide_table_records(found, table_spec, base=base, url=url, warnings=warnings)
        return Extraction(kind, ExtractionStatus.COLLECTED, records, warnings=warnings)
