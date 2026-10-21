"""OnlyPropFirms (onlypropfirms.com): comparison, cost-to-funding, starting-cost and drawdown tables, firm profiles.

Layout notes from the 2026-10-21 public review: the comparison pages are linked from the home page's "Compare
Prop Firms" cards, firm profiles live under /prop-firms/<slug>, and parts of the home page are built in the browser
(template placeholders in the static HTML). The column labels below are the ones this adapter version accepts;
any other column fails the table closed. Deals, coupons and ratings are never read.
"""

from __future__ import annotations

from typing import ClassVar

from bs4 import BeautifulSoup

from fundedflow_collector.directory.adapters.base import (
    COMMERCIAL,
    DERIVED,
    EDITORIAL,
    D,
    DirectoryAdapter,
    F,
    heading_phase,
    page_title,
    rule,
    spec,
)
from fundedflow_collector.directory.model import (
    ExtractedRecord,
    Extraction,
    ExtractionStatus,
    PageKind,
    RecordIdentity,
)
from fundedflow_collector.directory.tables import StructureChanged, header_key

COMPARISON = spec(
    {
        "Prop Firm": D("firm"),
        "Program": D("programme"),
        "Account Size": D("size"),
        "Profit Target": F("profit_target"),
        "Max Drawdown": F("max_drawdown"),
        "Drawdown Type": F("drawdown_type"),
        "Daily Loss Limit": F("daily_loss_limit"),
        "Consistency Rule": F("consistency_rule"),
        "Min. Trading Days": F("min_trading_days"),
        "Price": F("evaluation_fee"),
        "Rating": EDITORIAL,
        "Deal": COMMERCIAL,
    },
    signature=["Prop Firm", "Account Size"],
    required=["firm", "size"],
)
COST_TO_FUNDING = spec(
    {
        "Prop Firm": D("firm"),
        "Account": D("programme"),
        "Evaluation Cost": F("evaluation_fee"),
        "Activation Fee": F("activation_fee"),
        "True Cost to Funding": DERIVED,
        "Discount Code": COMMERCIAL,
    },
    signature=["Prop Firm", "True Cost to Funding"],
    required=["firm", "programme"],
)
STARTING_COSTS = spec(
    {
        "Prop Firm": D("firm"),
        "Cheapest Account": D("programme"),
        "Starting Cost": F("evaluation_fee"),
        "Deal": COMMERCIAL,
    },
    signature=["Prop Firm", "Starting Cost"],
    required=["firm", "programme"],
)
LARGEST_DRAWDOWN = spec(
    {
        "Prop Firm": D("firm"),
        "Program": D("programme"),
        "Account Size": D("size"),
        "Max Drawdown": F("max_drawdown"),
        "Drawdown Type": F("drawdown_type"),
    },
    signature=["Prop Firm", "Max Drawdown"],
    required=["firm"],
)
PROFILE_PROGRAMME = spec(
    {
        "Account Size": D("size"),
        "Phase": D("phase"),
        "Profit Target": F("profit_target"),
        "Max Drawdown": F("max_drawdown"),
        "Drawdown Type": F("drawdown_type"),
        "Daily Loss Limit": F("daily_loss_limit"),
        "Consistency Rule": F("consistency_rule"),
        "Min. Trading Days": F("min_trading_days"),
        "Payout Split": F("payout_split"),
        "Price": F("evaluation_fee"),
    },
    signature=["Account Size", "Profit Target"],
    required=["size"],
)
LIST_SPECS = (COMPARISON, COST_TO_FUNDING, STARTING_COSTS, LARGEST_DRAWDOWN)


class OnlyPropFirmsAdapter(DirectoryAdapter):
    name = "onlypropfirms"
    version = "1.0.0"
    description = "OnlyPropFirms comparison tables and firm profiles"
    page_rules = (
        rule(PageKind.COMPARISON, r"/prop-firm-comparison/?"),
        rule(PageKind.COMPARISON, r"/prop-firm-starting-costs/?"),
        rule(PageKind.COMPARISON, r"/largest-drawdown/?"),
        rule(PageKind.LISTING, r"/prop-firms/?"),
        rule(PageKind.PROFILE, r"/prop-firms/[a-z0-9-]{2,80}/?"),
    )
    follows: ClassVar[dict[PageKind, frozenset[PageKind]]] = {
        PageKind.LISTING: frozenset({PageKind.LISTING, PageKind.PROFILE}),
        PageKind.COMPARISON: frozenset({PageKind.COMPARISON, PageKind.PROFILE}),
    }

    def read_page(self, kind: PageKind, soup: BeautifulSoup, url: str) -> Extraction:
        warnings: list[str] = []
        records: list[ExtractedRecord] = []
        market = self.market_for(url)
        if kind is PageKind.PROFILE:
            records = self._profile(soup, url, warnings)
        else:
            tables = self.tables(soup)
            matched = False
            for table in tables:
                table_spec = next((s for s in LIST_SPECS if s.matches(table)), None)
                if table_spec is None:
                    continue
                matched = True
                base = RecordIdentity(firm_name="", market=market)
                records.extend(self.wide_table_records(table, table_spec, base=base, url=url, warnings=warnings))
            if not matched:
                status, detail = self._empty_or_missing(soup)
                return Extraction(kind, status, detail=detail)
        return Extraction(kind, ExtractionStatus.COLLECTED, records, warnings=warnings)

    def _profile(self, soup: BeautifulSoup, url: str, warnings: list[str]) -> list[ExtractedRecord]:
        firm = page_title(soup)
        if not firm:
            raise StructureChanged("profile page has no <h1> firm name")
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        official = self.first_party_link(soup, url)
        records: list[ExtractedRecord] = []
        for table in self.tables(soup):
            if not PROFILE_PROGRAMME.matches(table):
                if {header_key(h) for h in table.headers} & {"profit target", "max drawdown"}:
                    raise StructureChanged(f"table {table.index}: programme table with unexpected columns")
                continue
            programme = next((h for h in table.headings if h and h != firm), None)
            base = RecordIdentity(
                firm_name=firm,
                programme_name=programme,
                phase=heading_phase(table.headings[:1]),
                market=self.market_for(url),
                publisher_entry_id=slug,
                entry_url=url,
                first_party_url=official,
            )
            records.extend(self.wide_table_records(table, PROFILE_PROGRAMME, base=base, url=url, warnings=warnings))
        return records
