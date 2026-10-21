"""The adapter for an operator-added publisher that has no site-specific reader yet.

Its seed pages are stored as ordinary snapshots (searchable, exportable as Build 29 evidence of the publisher), but
nothing is turned into observations and no links are followed. Writing a real adapter is described in
docs/adapters.md.
"""

from __future__ import annotations

from typing import ClassVar

from bs4 import BeautifulSoup

from fundedflow_collector.directory.adapters.base import DirectoryAdapter
from fundedflow_collector.directory.model import Extraction, ExtractionStatus, PageKind


class GenericAdapter(DirectoryAdapter):
    name = "generic"
    version = "1.0.0"
    description = "Snapshots only: no structured reading and no link following"
    page_rules = ()
    follows: ClassVar[dict[PageKind, frozenset[PageKind]]] = {}

    def classify(self, url: str) -> PageKind | None:
        return PageKind.UNSUPPORTED

    def read_page(self, kind: PageKind, soup: BeautifulSoup, url: str) -> Extraction:
        return Extraction(kind, ExtractionStatus.UNSUPPORTED_PAGE, detail="generic adapter: snapshot only")

    def links(self, soup: BeautifulSoup, base: str) -> list[tuple[str, str]]:
        return []
