"""Prop Firm Gorilla (propfirmgorilla.com): the /firms directory and /firms/<slug> firm pages.

Layout notes from the 2026-10-21 public review: the home page's matchup builder, deals and plan lists were empty
in the static HTML (built in the browser), so a list without cards is reported as `js_unavailable`, never as "no
firms". Firm pages separate "Evaluation rules" from "Funded rules"; those headings set the phase, so evaluation and
simulated-funded values of one plan are never mixed. The user-built matchup pages are out of scope.
"""

from __future__ import annotations

from typing import ClassVar

from bs4 import BeautifulSoup

from fundedflow_collector.directory.adapters.base import (
    D,
    DirectoryAdapter,
    F,
    heading_of,
    page_title,
    rule,
)
from fundedflow_collector.directory.model import (
    ExtractedRecord,
    Extraction,
    ExtractionStatus,
    PageKind,
    RecordIdentity,
)
from fundedflow_collector.directory.tables import KeyValueSpec, StructureChanged, header_key
from fundedflow_collector.directory.values import parse_phase

RULE_LABELS = {
    header_key(k): v
    for k, v in {
        "Account size": D("size"),
        "Market": D("market"),
        "Profit target": F("profit_target"),
        "Daily loss limit": F("daily_loss_limit"),
        "Max drawdown": F("max_drawdown"),
        "Drawdown type": F("drawdown_type"),
        "Consistency rule": F("consistency_rule"),
        "Minimum trading days": F("min_trading_days"),
        "Time limit": F("time_limit"),
        "Payout split": F("payout_split"),
        "Payout frequency": F("payout_frequency"),
        "Payout conditions": F("payout_conditions"),
        "Price": F("evaluation_fee"),
        "Activation fee": F("activation_fee"),
    }.items()
}


class PropFirmGorillaAdapter(DirectoryAdapter):
    name = "propfirmgorilla"
    version = "1.0.0"
    description = "Prop Firm Gorilla firm directory and firm pages (evaluation and funded rules)"
    page_rules = (
        rule(PageKind.LISTING, r"/firms/?"),
        rule(PageKind.PROFILE, r"/firms/[a-z0-9-]{2,80}/?"),
    )
    follows: ClassVar[dict[PageKind, frozenset[PageKind]]] = {
        PageKind.LISTING: frozenset({PageKind.LISTING, PageKind.PROFILE}),
    }

    def read_page(self, kind: PageKind, soup: BeautifulSoup, url: str) -> Extraction:
        if kind is PageKind.LISTING:
            profiles = [u for u, _t in self.links(soup, url) if self.classify(u) is PageKind.PROFILE]
            if not profiles:
                status, detail = self._empty_or_missing(soup)
                return Extraction(kind, status, detail=detail)
            return Extraction(kind, ExtractionStatus.COLLECTED, detail=f"{len(profiles)} firm pages listed")
        firm = page_title(soup)
        if not firm:
            raise StructureChanged("firm page has no <h1> firm name")
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        official = self.first_party_link(soup, url)
        labels = KeyValueSpec(dict(RULE_LABELS))
        records: list[ExtractedRecord] = []
        for number, table in enumerate(soup.find_all("table")):
            section = heading_of(table, ("h3",)) or ""
            phase = parse_phase(section)
            if not section.lower().endswith("rules"):
                continue
            plan = heading_of(table, ("h2",))
            identity = RecordIdentity(
                firm_name=firm,
                programme_name=plan.removeprefix("Plan:").strip() if plan else None,
                phase=phase,
                publisher_entry_id=slug,
                entry_url=url,
                first_party_url=official,
            )
            record = self.key_value_record(
                table, labels, identity=identity, location=f"{section} table {number}", url=url
            )
            if record is not None:
                records.append(record)
        warnings = ["labels not read: " + ", ".join(sorted(set(labels.unknown)))] if labels.unknown else []
        return Extraction(kind, ExtractionStatus.COLLECTED, records, warnings=warnings)
