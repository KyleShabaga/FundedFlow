"""The four comparison publishers named by Build 29.25, as presets that install DISABLED.

Each preset records the public policy review done for this build on 2026-10-21 (robots.txt, the terms page and
what it says about automated access and reuse). That review is information for the operator, not a decision: the
operator still reads the current terms, records a decision per host and enables the publisher explicitly. None of
these presets claims that automated collection is permitted.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from fundedflow_collector.db import registry
from fundedflow_collector.db.registry import Publisher, RegistryError
from fundedflow_collector.outcomes import HostRole, SourceKind

PRESET_VERSION = "2026-10-21"
REVIEWED_ON = "2026-10-21"
#: Affiliate redirects, admin and API areas, deals and coupons: never in scope for any directory preset.
COMMON_EXCLUDES = ["/go/*", "/out/*", "/recommends/*", "/visit/*", "/api/*", "/admin/*", "/wp-admin/*", "*coupon*"]


@dataclass(frozen=True)
class Preset:
    key: str
    display_name: str
    homepage_url: str
    adapter: str
    hosts: tuple[str, ...]
    seeds: tuple[tuple[str, str], ...]  # (url, label)
    allowed_paths: tuple[str, ...]
    excluded_paths: tuple[str, ...]
    capture_mode: str
    max_fetches: int
    max_depth: int
    policy_review: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> str:
        return str(self.policy_review.get("summary", ""))


PRESETS: dict[str, Preset] = {
    p.key: p
    for p in (
        Preset(
            key="onlypropfirms",
            display_name="OnlyPropFirms",
            homepage_url="https://onlypropfirms.com/",
            adapter="onlypropfirms",
            hosts=("onlypropfirms.com",),
            seeds=(
                ("https://onlypropfirms.com/prop-firm-comparison", "Prop firm comparison"),
                ("https://onlypropfirms.com/prop-firms", "True cost to funding"),
                ("https://onlypropfirms.com/prop-firm-starting-costs", "Starting costs"),
                ("https://onlypropfirms.com/largest-drawdown", "Largest drawdown"),
            ),
            allowed_paths=(
                "/prop-firm-comparison*",
                "/prop-firms",
                "/prop-firms/",
                "/prop-firms?page=*",
                "/prop-firms/*",
                "/prop-firm-starting-costs*",
                "/largest-drawdown*",
            ),
            excluded_paths=(*COMMON_EXCLUDES, "/best-prop-firm-deals*", "/blog/*", "/courses/*"),
            capture_mode="auto",
            max_fetches=40,
            max_depth=1,
            policy_review={
                "reviewed_on": REVIEWED_ON,
                "robots_url": "https://onlypropfirms.com/robots.txt",
                "robots": "One group for all agents; disallows /wp-admin/ only; sitemap declared; no crawl-delay or "
                "content signals.",
                "terms_url": "https://onlypropfirms.com/privacy-policy",
                "terms": "The only legal page is a combined privacy/terms page. It does not address automated access, "
                "scraping or reuse of comparison data, and has no copyright or IP section.",
                "data_api": "No public data API or data licence found.",
                "suggested_decision": "unclear",
                "summary": "robots.txt allows these paths; terms silent on automation and reuse. Treat as unclear: "
                "ask for permission, or acknowledge unclear terms (slow 5 s pace) after your own review.",
                "page_notes": "Home page sections are built in the browser; comparison pages may need the browser "
                "fallback or a manual capture.",
            },
        ),
        Preset(
            key="traderssecondbrain",
            display_name="Trader's Second Brain",
            homepage_url="https://traderssecondbrain.com/prop-firms",
            adapter="traderssecondbrain",
            hosts=("traderssecondbrain.com",),
            seeds=(("https://traderssecondbrain.com/prop-firms", "Prop firm directory"),),
            allowed_paths=("/prop-firms", "/prop-firms/", "/prop-firms?page=*", "/prop-firm/*", "/guides/*-review*"),
            excluded_paths=(*COMMON_EXCLUDES, "/track-prop/*", "/prop-firms/data.json", "/tools/*", "*placement=*"),
            capture_mode="auto",
            max_fetches=40,
            max_depth=2,
            policy_review={
                "reviewed_on": REVIEWED_ON,
                "robots_url": "https://traderssecondbrain.com/robots.txt",
                "robots": "Allows / for all agents; disallows /api/ and /go/; three sitemaps declared; no "
                "crawl-delay or content signals.",
                "terms_url": "https://traderssecondbrain.com/terms",
                "terms": "Acceptable use forbids automating abusive traffic and scraping protected areas; it does not "
                "say whether reading public pages automatically is allowed. Research presentation and original copy "
                "are owned by the publisher and no rights are granted beyond those stated. Contact: the support "
                "address in the terms.",
                "data_api": "A /prop-firms/data.json file is linked from the directory, but the terms grant no licence "
                "for it; it is excluded.",
                "suggested_decision": "unclear",
                "summary": "robots.txt allows the directory and firm pages; terms restrict reuse and are unclear on "
                "automated reading of public pages. Ask for permission before enabling.",
                "page_notes": "Fit scores, rankings and offers are the publisher's own and are never read as rules.",
            },
        ),
        Preset(
            key="propfirmmatch-futures",
            display_name="Prop Firm Match (Futures)",
            homepage_url="https://propfirmmatch.com/futures",
            adapter="propfirmmatch-futures",
            hosts=("propfirmmatch.com",),
            seeds=(
                ("https://propfirmmatch.com/futures", "Futures firms"),
                ("https://propfirmmatch.com/futures/prop-firm-challenges", "Futures challenges"),
            ),
            allowed_paths=(
                "/futures",
                "/futures?page=*",
                "/futures/prop-firm-challenges*",
                "/futures/prop-firms/*",
            ),
            excluded_paths=(
                *COMMON_EXCLUDES,
                "*sort=*",
                "*extendedFilters=*",
                "/_next/data/*",
                "/decide/*",
                "/cdn-cgi/*",
                "/futures/prop-firms/*/discussion*",
            ),
            capture_mode="manual_only",
            max_fetches=30,
            max_depth=1,
            policy_review={
                "reviewed_on": REVIEWED_ON,
                "robots_url": "https://propfirmmatch.com/robots.txt",
                "robots": "One group for all agents; allows most of the site but disallows sort= and "
                "extendedFilters= URLs, /_next/data/, /api/surveys, /static/, /decide/, /cdn-cgi/ and profile "
                "discussion pages.",
                "terms_url": "https://propfirmmatch.com/futures/terms-and-conditions",
                "terms": "Not readable by an automated client: the terms page and /futures both answered HTTP 403 to "
                "an automated request on the review date. Read them in your browser.",
                "data_api": "No public data API found.",
                "suggested_decision": "prohibited",
                "summary": "The site refuses automated requests (HTTP 403). Manual capture only: save pages from your "
                "browser and import them. Do not try to work around the block.",
                "page_notes": "The challenge table keeps programme, steps, size and phase separate.",
            },
        ),
        Preset(
            key="propfirmgorilla",
            display_name="Prop Firm Gorilla",
            homepage_url="https://propfirmgorilla.com/",
            adapter="propfirmgorilla",
            hosts=("propfirmgorilla.com",),
            seeds=(("https://propfirmgorilla.com/firms", "Firm directory"),),
            allowed_paths=("/firms", "/firms/", "/firms?page=*", "/firms/*"),
            excluded_paths=(*COMMON_EXCLUDES, "/deals*", "/matchup*", "/blog/*", "/news/*", "/submit-a-review*"),
            capture_mode="auto",
            max_fetches=40,
            max_depth=1,
            policy_review={
                "reviewed_on": REVIEWED_ON,
                "robots_url": "https://propfirmgorilla.com/robots.txt",
                "robots": "Allows / for all agents; disallows /admin/ and /api/; sitemap declared; no crawl-delay or "
                "content signals.",
                "terms_url": "https://propfirmgorilla.com/terms-of-service",
                "terms": "Section 8 says site content is owned by the operator and forbids unauthorised reproduction "
                "or distribution; nothing on automated access. Contact: the admin address in section 11.",
                "data_api": "No public data API found.",
                "suggested_decision": "unclear",
                "summary": "robots.txt allows /firms; terms forbid unauthorised reproduction and are silent on "
                "automated reading. Ask for permission before enabling.",
                "page_notes": "Lists and plan details were empty in the static HTML (built in the browser): expect "
                "js_unavailable without the browser extra, or use manual capture.",
            },
        ),
    )
}


def install_preset(conn: sqlite3.Connection, key: str, now: datetime) -> Publisher:
    """Create a publisher, its hosts and its seed pages from a preset. It stays disabled with no terms decision."""
    preset = PRESETS.get(key)
    if preset is None:
        raise RegistryError(f"unknown preset {key!r}; presets: {', '.join(sorted(PRESETS))}")
    publisher = registry.add_publisher(
        conn,
        publisher_key=preset.key,
        display_name=preset.display_name,
        homepage_url=preset.homepage_url,
        adapter=preset.adapter,
        now=now,
        capture_mode=preset.capture_mode,
        allowed_paths=list(preset.allowed_paths),
        excluded_paths=list(preset.excluded_paths),
        max_fetches=preset.max_fetches,
        max_depth=preset.max_depth,
        policy_review=preset.policy_review,
        preset_version=PRESET_VERSION,
    )
    for host in preset.hosts:
        registry.add_host(conn, publisher, host, HostRole.HOMEPAGE, now)
    for url, label in preset.seeds:
        registry.add_source(conn, publisher, url=url, kind=SourceKind.PAGE, now=now, label=label, priority=50)
    return publisher
