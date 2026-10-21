"""Zendesk Help Center adapter (the only platform adapter in Build 29).

Uses the anonymous list-articles endpoint on open help centers, and on later runs the incremental endpoint with
the stored cursor time so only changed articles are listed. Every API call goes through the same policy pipeline
as a page (allowlist, terms, robots, pacing, budget, circuit breaker). If the API refuses (401/403), the host
circuit trips and the collector does not fall back to scraping the help center's HTML pages.

Each article becomes a source keyed by its `html_url`, with the API `body` HTML as content.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.parse import urlsplit

MAX_API_PAGES = 20
PAGE_SIZE = 100


class ZendeskError(Exception):
    pass


@dataclass(frozen=True)
class HelpCenter:
    host: str
    locale: str
    scheme: str = "https"

    @property
    def list_url(self) -> str:
        return (
            f"{self.scheme}://{self.host}/api/v2/help_center/{self.locale}/articles.json"
            f"?per_page={PAGE_SIZE}&sort_by=updated_at&sort_order=desc"
        )

    def incremental_url(self, start_time: int) -> str:
        return f"{self.scheme}://{self.host}/api/v2/help_center/incremental/articles.json?start_time={start_time}"


@dataclass(frozen=True)
class Article:
    id: int
    html_url: str
    title: str | None
    body: str
    locale: str | None
    updated_at: str | None
    edited_at: str | None
    section_id: int | None


@dataclass
class ArticlePage:
    articles: list[Article]
    next_page: str | None
    end_time: int | None


def help_center(source_url: str) -> HelpCenter:
    parts = urlsplit(source_url)
    segments = [s for s in parts.path.split("/") if s]
    if len(segments) < 2 or segments[0] != "hc":
        raise ZendeskError("a Zendesk source URL looks like https://help.example.com/hc/en-us")
    if not parts.hostname:
        raise ZendeskError("Zendesk source URL has no host")
    return HelpCenter(host=parts.hostname, locale=segments[1].lower(), scheme=parts.scheme or "https")


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def parse_article_page(raw: bytes, locale: str) -> ArticlePage:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ZendeskError(f"Zendesk response is not JSON: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("articles"), list):
        raise ZendeskError("Zendesk response has no articles list")
    articles: list[Article] = []
    for item in data["articles"]:
        if not isinstance(item, dict) or item.get("draft") is True:
            continue
        article_id = _int(item.get("id"))
        html_url = _str(item.get("html_url"))
        body = _str(item.get("body"))
        item_locale = _str(item.get("locale"))
        if article_id is None or html_url is None or body is None:
            continue
        if item_locale is not None and item_locale.lower() != locale:
            continue
        articles.append(
            Article(
                id=article_id,
                html_url=html_url,
                title=_str(item.get("title")),
                body=body,
                locale=item_locale,
                updated_at=_str(item.get("updated_at")),
                edited_at=_str(item.get("edited_at")),
                section_id=_int(item.get("section_id")),
            )
        )
    next_page = _str(data.get("next_page"))
    links = data.get("links")
    meta = data.get("meta")
    if next_page is None and isinstance(links, dict) and isinstance(meta, dict) and meta.get("has_more") is True:
        next_page = _str(links.get("next"))
    return ArticlePage(articles=articles, next_page=next_page, end_time=_int(data.get("end_time")))
