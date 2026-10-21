"""One firm or publisher run: discovery, then the fail-closed policy pipeline for every URL, fetching, parsing
and storage.

Pipeline per URL (architecture doc §8.1): canonical URL -> allowlist and excluded paths -> firm/source enabled ->
terms gate -> circuit breaker -> budget and deadline -> robots.txt -> sitemap lastmod skip -> pacing -> DNS-pinned
GET (each redirect hop re-checked) -> response classification -> parse -> store. Firms run one after another,
never in parallel, and only when the operator runs a command.

A comparison publisher (Build 29.25) runs through exactly the same pipeline. Its adapter only narrows it: URLs must
be pages the adapter reads, inside the publisher's allowed paths; there is no sitemap discovery; links are followed
only to the page kinds the adapter names, with a cap on list pages; and each stored page version is read into
directory observations. Links to firms' own sites or affiliate redirects are never followed (other hosts are not
authorised for a publisher).
"""

from __future__ import annotations

import heapq
import itertools
import sqlite3
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from fundedflow_collector import USER_AGENT_PRODUCT, ids
from fundedflow_collector.clock import Clock, format_instant, parse_instant
from fundedflow_collector.config import Settings
from fundedflow_collector.db import registry, runs
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.registry import Host, Owner, Publisher, Source
from fundedflow_collector.db.runs import AttemptRecord
from fundedflow_collector.db.snapshots import EvidenceInput, record_failure, record_unchanged, store_evidence
from fundedflow_collector.directory.adapters import get_adapter
from fundedflow_collector.directory.model import PageKind
from fundedflow_collector.directory.store import extract_and_store
from fundedflow_collector.discovery import relevance, sitemaps, zendesk
from fundedflow_collector.logging_setup import log_event, redact_url
from fundedflow_collector.net.client import (
    ACCEPT_HTML,
    ACCEPT_JSON,
    ACCEPT_PDF,
    ACCEPT_ROBOTS,
    ACCEPT_XML,
    Block,
    Fetcher,
    FetchRequest,
    FetchResult,
    HostRunState,
)
from fundedflow_collector.net.fixture_transport import FixtureSite
from fundedflow_collector.net.resolver import Resolver
from fundedflow_collector.outcomes import (
    OUTCOME_INFO,
    Category,
    FetchMethod,
    HostRole,
    Outcome,
    SourceChannel,
    SourceKind,
)
from fundedflow_collector.parse.document import ParsedDocument, ParseError, ParseTimeout
from fundedflow_collector.parse.hashing import sha256_bytes
from fundedflow_collector.parse.html import parse_html
from fundedflow_collector.parse.pdf import parse_pdf
from fundedflow_collector.parse.text import parse_text
from fundedflow_collector.policy import circuit, robots
from fundedflow_collector.policy.addresses import is_public_address
from fundedflow_collector.policy.budget import RunBudget
from fundedflow_collector.policy.pacing import HostPacer
from fundedflow_collector.policy.terms import min_delay_for, terms_block_reason
from fundedflow_collector.policy.urls import UrlRejected, canonicalize, host_of, matches_excluded, resolve_link
from fundedflow_collector.render.browser import Renderer, RenderError

HTML_TYPES = frozenset({"text/html", "application/xhtml+xml"})
XML_TYPES = frozenset(
    {"application/xml", "text/xml", "application/x-gzip", "application/gzip", "application/octet-stream"}
)

Command = Literal["discover", "fetch"]


@dataclass
class RunOptions:
    command: Command
    dry_run: bool = False
    force: bool = False
    discover: bool = True
    use_browser: bool = True
    max_fetches: int | None = None
    fixture_site: Path | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "command": self.command,
            "dry_run": self.dry_run,
            "force": self.force,
            "discover": self.discover,
            "use_browser": self.use_browser,
            "max_fetches": self.max_fetches,
            "fixture_site": str(self.fixture_site) if self.fixture_site else None,
        }


@dataclass
class TargetResult:
    url: str
    outcome: Outcome
    reason: str | None = None
    snapshot_id: str | None = None
    counted: bool = True
    directory: str | None = None  # publisher runs: what the adapter made of the page (extraction status)
    directory_detail: str | None = None


@dataclass
class RunSummary:
    firm_key: str
    run_id: str | None
    status: str
    fetches_used: int = 0
    results: list[TargetResult] = field(default_factory=list)
    not_fetched: int = 0
    dry_run_lines: list[tuple[str, str, str]] = field(default_factory=list)
    message: str | None = None
    budget: int = 0

    def counts(self) -> Counter[str]:
        """Outcome counts, leaving out uncounted probes such as a guessed /sitemap.xml that does not exist."""
        return Counter(r.outcome.value for r in self.results if r.counted)

    def directory_counts(self) -> Counter[str]:
        return Counter(r.directory for r in self.results if r.directory)

    def exit_code(self) -> int:
        categories = {OUTCOME_INFO[r.outcome].category for r in self.results if r.counted}
        if Category.FAILURE in categories:
            return 5
        if Category.POLICY in categories or self.status in ("skipped_disabled", "deadline_exceeded"):
            return 4
        return 0


@dataclass
class Environment:
    """Everything a run needs from the outside world. Tests substitute the fetcher, resolver, renderer and clock."""

    conn: sqlite3.Connection
    settings: Settings
    config_sha256: str
    clock: Clock
    fetcher: Fetcher | None
    resolver: Resolver | None
    renderer: Renderer | None
    fixture: FixtureSite | None = None
    progress: Any = None  # callable(str) for console progress
    should_stop: Any = None  # callable() -> bool; the GUI's Stop button

    def stop_requested(self) -> bool:
        return bool(self.should_stop is not None and self.should_stop())

    @property
    def fetch_method(self) -> FetchMethod:
        return FetchMethod.FIXTURE_REPLAY if self.fixture is not None else FetchMethod.HTTP


@dataclass(order=True)
class _Target:
    sort_key: tuple[int, int, int, str]
    url: str = field(compare=False)
    kind: SourceKind = field(compare=False)
    channel: SourceChannel = field(compare=False)
    depth: int = field(compare=False)
    lastmod: str | None = field(compare=False, default=None)
    source: Source | None = field(compare=False, default=None)
    article: zendesk.Article | None = field(compare=False, default=None)
    api_url: str | None = field(compare=False, default=None)


class FirmRunner:
    def __init__(self, env: Environment, firm: Owner, options: RunOptions, batch_id: str) -> None:
        self.env = env
        self.conn = env.conn
        self.settings = env.settings
        self.clock = env.clock
        self.firm = firm
        self.options = options
        self.batch_id = batch_id
        hosts = registry.list_hosts(self.conn, firm.id)
        self.doc_hosts: dict[str, Host] = {h.host: h for h in hosts if h.role is not HostRole.ASSET}
        self.asset_hosts: set[str] = {h.host for h in hosts if h.role is HostRole.ASSET}
        limit = self.settings.budget.fetches_per_firm_run
        for override in (firm.max_fetches, options.max_fetches):
            if override is not None:
                limit = min(limit, override)
        self.max_depth = min(
            self.settings.limits.max_depth,
            firm.max_depth if firm.max_depth is not None else self.settings.limits.max_depth,
        )
        self.budget = RunBudget(limit, self.settings.budget.run_deadline_minutes, self.clock)
        self.pacer = HostPacer(self.clock, self.settings)
        self.host_state: dict[str, HostRunState] = {}
        self.robots: dict[str, robots.RobotsRules] = {}
        self.tripped: set[str] = set()
        self.seen: set[str] = set()
        self.queue: list[_Target] = []
        self.pending: dict[str, _Target] = {}
        # Sitemap and Zendesk source URLs are entry points for discovery, never fetched as pages.
        self.special_sources = {
            s.canonical_url
            for s in registry.list_sources(self.conn, firm.id)
            if s.kind in (SourceKind.SITEMAP, SourceKind.ZENDESK)
        }
        self._counter = itertools.count()
        self.adapter = get_adapter(firm.adapter) if isinstance(firm, Publisher) else None
        self.list_pages: Counter[PageKind] = Counter()
        self.page_kinds: dict[str, PageKind] = {}
        self.run_id: str | None = None
        self.summary = RunSummary(firm_key=firm.owner_key, run_id=None, status="running", budget=limit)

    # ------------------------------------------------------------------ entry point

    def run(self) -> RunSummary:
        if isinstance(self.firm, Publisher) and self.firm.capture_mode == "manual_only":
            self.summary.status = "skipped_manual_only"
            self.summary.message = (
                f"{self.firm.owner_key} is manual capture only: nothing is fetched. Save its pages in your browser "
                "and import them (Manual capture)."
            )
            return self.summary
        if not self.firm.enabled and not (isinstance(self.firm, Publisher) and self.options.dry_run):
            self.summary.status = "skipped_disabled"
            self.summary.message = f"{self.firm.owner_key} is disabled: {self.firm.disabled_reason}"
            return self.summary
        if self.options.dry_run:
            return self._dry_run()
        self.run_id = runs.start_run(
            self.conn,
            firm_id=self.firm.id,
            batch_id=self.batch_id,
            command=self.options.command,
            now=self.clock.now(),
            options=self.options.as_dict(),
            config_sha256=self.env.config_sha256,
        )
        self.summary.run_id = self.run_id
        log_event("run_started", run_id=self.run_id, firm=self.firm.owner_key, command=self.options.command)
        try:
            if self.options.command == "fetch":
                self._enqueue_known()
            if self.options.command == "discover" or self.options.discover:
                self._discover()
            if self.options.command == "fetch":
                self._drain()
        except KeyboardInterrupt:
            runs.finish_run(
                self.conn, self.run_id, status="aborted", fetches_used=self.budget.used, now=self.clock.now()
            )
            raise
        if self.env.stop_requested():
            status = "aborted"
        else:
            status = "deadline_exceeded" if self.budget.deadline_passed else "completed"
        runs.finish_run(self.conn, self.run_id, status=status, fetches_used=self.budget.used, now=self.clock.now())
        self.summary.status = status
        self.summary.fetches_used = self.budget.used
        log_event(
            "run_finished",
            run_id=self.run_id,
            firm=self.firm.owner_key,
            status=status,
            fetches=self.budget.used,
            outcomes=dict(self.summary.counts()),
        )
        return self.summary

    # ------------------------------------------------------------------ policy

    def _progress(self, text: str) -> None:
        if self.env.progress is not None:
            self.env.progress(text)

    def check(
        self,
        url: str,
        *,
        source: Source | None = None,
        fetch_robots: bool = True,
        scope: bool = True,
        ignore_disabled: bool = False,
    ) -> Block | None:
        """The pre-request policy checks for one URL. Returns a Block, or None when the request may go ahead."""
        try:
            url = canonicalize(url)
        except UrlRejected as exc:
            return Block(Outcome.URL_REJECTED, exc.reason)
        host = host_of(url)
        host_row = self.doc_hosts.get(host)
        if host_row is None:
            return Block(Outcome.NOT_ALLOWLISTED, f"{host} is not an authorised host for {self.firm.owner_key}")
        pattern = matches_excluded(url, self.firm.excluded_paths)
        if pattern is not None:
            return Block(Outcome.EXCLUDED_PATH, f"matches excluded pattern {pattern}")
        if scope and isinstance(self.firm, Publisher):
            reason = self._outside_scope(url)
            if reason is not None:
                return Block(Outcome.EXCLUDED_PATH, reason)
        if not ignore_disabled and (not self.firm.enabled or (source is not None and not source.enabled)):
            return Block(Outcome.DISABLED, "firm or source is disabled")
        reason = terms_block_reason(host_row, self.clock.now())
        if reason is not None:
            if isinstance(self.firm, Publisher):
                reason = reason.replace("collector host terms", "collector directory terms")
            return Block(Outcome.TERMS_BLOCKED, reason)
        state = circuit.current(self.conn, host, self.clock.now(), persist=not self.options.dry_run)
        if state.open or host in self.tripped:
            return Block(Outcome.CIRCUIT_OPEN, f"{host} is stopped ({state.state.value}): {state.reason or ''}".strip())
        rules = self._robots_for(url, fetch=fetch_robots)
        if rules is None:
            return None  # dry run without a cached robots.txt: reported by the caller
        if rules.status_class == "unreachable" or rules.too_slow:
            return Block(Outcome.ROBOTS_UNREACHABLE, rules.describe())
        if not rules.allows(url):
            return Block(Outcome.ROBOTS_BLOCKED, "robots.txt disallows this URL for FundedFlowCollector")
        return None

    def _outside_scope(self, url: str) -> str | None:
        assert isinstance(self.firm, Publisher)
        assert self.adapter is not None
        reason = registry.path_outside_scope(self.firm, url)
        if reason is not None:
            return reason
        if self.adapter.classify(url) is None:
            return f"not a page the {self.adapter.name} adapter reads"
        return None

    def _robots_hop_check(self, url: str) -> Block | None:
        try:
            host = host_of(canonicalize(url))
        except UrlRejected as exc:
            return Block(Outcome.URL_REJECTED, exc.reason)
        if host not in self.doc_hosts:
            return Block(Outcome.NOT_ALLOWLISTED, f"robots.txt redirect to unauthorised host {host}")
        return None

    def _robots_for(self, url: str, *, fetch: bool) -> robots.RobotsRules | None:
        host = host_of(url)
        if host in self.robots:
            return self.robots[host]
        now = self.clock.now()
        rules = robots.cached(self.conn, host, now)
        if rules is None and not fetch:
            return None
        if rules is None:
            rules = self._fetch_robots(url, host)
        self.robots[host] = rules
        return rules

    def _fetch_robots(self, url: str, host: str) -> robots.RobotsRules:
        assert self.env.fetcher is not None
        scheme = url.split(":", 1)[0]
        robots_url = f"{scheme}://{host}/robots.txt"
        self.pacer.wait(host, self._min_delay(host))
        result = self.env.fetcher.fetch(
            FetchRequest(
                url=robots_url,
                accept=ACCEPT_ROBOTS,
                max_bytes=robots.ROBOTS_MAX_BYTES,
                retry=False,
                trip_on_denial=False,
                allow_truncate=True,
            ),
            self._robots_hop_check,
            self._state(host),
        )
        self.pacer.record(host, result.duration_ms / 1000)
        if result.trip is not None:
            self._trip(host, result)
        status = (
            result.status
            if result.outcome
            in (None, Outcome.ACCESS_DENIED, Outcome.HTTP_ERROR, Outcome.RATE_LIMITED, Outcome.SERVER_ERROR)
            else None
        )
        if result.outcome is Outcome.BLOCKED_BOT_PROTECTION:
            status = None
        body = (result.body or b"").decode("utf-8", "replace") if status is not None and 200 <= status <= 299 else None
        rules = robots.store(self.conn, host, status, body, self.clock.now(), run_id=self.run_id, firm_id=self.firm.id)
        self._progress(f"  {host}: {rules.describe()}")
        return rules

    def _min_delay(self, host: str) -> float:
        host_row = self.doc_hosts.get(host)
        delay = min_delay_for(host_row, self.settings) if host_row else self.settings.pacing.min_delay_seconds
        rules = self.robots.get(host)
        robots_delay = rules.delay_seconds() if rules else None
        return max(delay, robots_delay or 0.0)

    def _state(self, host: str) -> HostRunState:
        return self.host_state.setdefault(host, HostRunState())

    def _trip(self, host: str, result: FetchResult) -> None:
        assert result.trip is not None
        self.tripped.add(host)
        circuit.trip(
            self.conn,
            host,
            result.trip,
            result.reason or result.trip.value,
            self.clock.now(),
            run_id=self.run_id,
            firm_id=self.firm.id,
        )
        self._progress(f"  {host}: STOPPED ({result.trip.value}: {result.reason})")

    # ------------------------------------------------------------------ discovery

    def _discover(self) -> None:
        self._progress(f"Discovering {self.firm.owner_key}")
        if isinstance(self.firm, Publisher):
            self._progress("  publishers use their seed pages and the adapter's links (no sitemap discovery)")
            return
        candidates: list[tuple[str, int, str]] = []
        for source in registry.list_sources(self.conn, self.firm.id):
            if source.kind is SourceKind.SITEMAP and source.enabled:
                candidates.append((source.canonical_url, 0, "sitemap"))
        for host in sorted(self.doc_hosts):
            scheme = "http" if self.firm.homepage_url.startswith("http://") else "https"
            probe = f"{scheme}://{host}/"
            if self.check(probe) is not None:
                continue
            rules = self.robots.get(host)
            for loc in rules.sitemaps() if rules else []:
                candidates.append((loc, 0, "robots_sitemap"))
            candidates.append((f"{scheme}://{host}/sitemap.xml", 0, "guessed"))
        visited: set[str] = set()
        pending = list(candidates)
        while pending:
            loc, depth, via = pending.pop(0)
            try:
                url = canonicalize(loc)
            except UrlRejected:
                continue
            if url in visited or depth > sitemaps.MAX_INDEX_DEPTH:
                continue
            visited.add(url)
            if host_of(url) not in self.doc_hosts:
                continue  # sitemap references to other hosts are dropped
            doc = self._fetch_sitemap(url, counted=via != "guessed")
            if doc is None:
                continue
            for child in doc.children:
                pending.append((child.loc, depth + 1, "sitemap"))
            for entry in doc.urls:
                self._discovered(
                    entry.loc,
                    via="robots_sitemap" if via == "robots_sitemap" else "sitemap",
                    depth=0,
                    lastmod=entry.lastmod,
                    channel=SourceChannel.SITEMAP,
                )
        for source in registry.list_sources(self.conn, self.firm.id):
            if source.kind is SourceKind.ZENDESK and source.enabled:
                self._discover_zendesk(source)

    def _fetch_sitemap(self, url: str, *, counted: bool) -> sitemaps.SitemapDocument | None:
        result = self._request(
            url, accept=ACCEPT_XML, max_bytes=self.settings.limits.max_sitemap_bytes, counted=counted
        )
        if result is None or not result.ok or result.body is None:
            return None
        try:
            return sitemaps.parse_sitemap(
                result.body,
                max_bytes=self.settings.limits.max_sitemap_bytes,
                max_urls=self.settings.limits.max_sitemap_urls,
            )
        except sitemaps.SitemapError as exc:
            self._progress(f"  sitemap {url}: {exc}")
            return None

    def _request(
        self, url: str, *, accept: str, max_bytes: int, counted: bool = True, source: Source | None = None
    ) -> FetchResult | None:
        """A discovery request (sitemap or API page) through the full pipeline; failures become attempt rows."""
        block = self._budget_block() or self.check(url, source=source)
        started = format_instant(self.clock.now())
        if block is not None:
            self._record_block(url, block, started, counted=counted)
            return None
        result = self._do_fetch(url, FetchRequest(url=url, accept=accept, max_bytes=max_bytes))
        if not result.ok:
            attempt = self._attempt_from(result, source_id=None)
            if not counted and result.status == 404:
                attempt.error_detail = "HTTP 404: no sitemap at this address (normal; not counted as a failure)"
            record_failure(self.conn, attempt=attempt, now=self.clock.now())
            self.summary.results.append(
                TargetResult(
                    url,
                    attempt.outcome,
                    attempt.policy_reason or attempt.error_detail,
                    counted=counted and result.status != 404,
                )
            )
            return None
        return result

    def _discovered(
        self,
        loc: str,
        *,
        via: str,
        depth: int,
        channel: SourceChannel,
        lastmod: str | None = None,
        anchor: str = "",
        from_attempt: str | None = None,
        score: int | None = None,
    ) -> None:
        try:
            url = canonicalize(loc)
        except UrlRejected:
            return
        host = host_of(url)
        if host not in self.doc_hosts:
            decision = Outcome.NOT_ALLOWLISTED.value
        elif matches_excluded(url, self.firm.excluded_paths) or (
            isinstance(self.firm, Publisher) and self._outside_scope(url)
        ):
            decision = Outcome.EXCLUDED_PATH.value
        elif (url in self.seen and url not in self.pending) or url in self.special_sources:
            return
        else:
            decision = "queued"
        score = relevance.score(url, anchor) if score is None else score
        assert self.run_id is not None
        with transaction(self.conn):
            runs.insert_discovered_link(
                self.conn,
                run_id=self.run_id,
                firm_id=self.firm.id,
                url=url,
                via=via,
                depth=depth,
                decision=decision,
                now=self.clock.now(),
                relevance=score,
                anchor_text=anchor or None,
                sitemap_lastmod=lastmod,
                from_attempt_id=from_attempt,
            )
        if decision == "queued" and self.options.command == "fetch":
            kind = SourceKind.PDF if url.lower().endswith(".pdf") else SourceKind.PAGE
            self._push(url, kind=kind, channel=channel, depth=depth, priority=0, score=score, lastmod=lastmod)

    def _discover_zendesk(self, source: Source) -> None:
        try:
            centre = zendesk.help_center(source.canonical_url)
        except zendesk.ZendeskError as exc:
            self._progress(f"  {source.canonical_url}: {exc}")
            return
        started_at = int(self.clock.now().timestamp())
        url: str | None = (
            centre.incremental_url(source.zendesk_cursor)
            if source.zendesk_cursor and not self.options.force
            else centre.list_url
        )
        end_time: int | None = None
        complete = False
        for _ in range(zendesk.MAX_API_PAGES):
            if url is None:
                complete = True
                break
            result = self._request(
                url, accept=ACCEPT_JSON, max_bytes=self.settings.limits.max_html_bytes, source=source
            )
            if result is None or result.body is None:
                break
            try:
                page = zendesk.parse_article_page(result.body, centre.locale)
            except zendesk.ZendeskError as exc:
                attempt = self._attempt_from(result, source_id=source.id)
                attempt.outcome, attempt.error_detail = Outcome.PARSE_ERROR, str(exc)
                record_failure(self.conn, attempt=attempt, now=self.clock.now(), source=source)
                self.summary.results.append(TargetResult(url, Outcome.PARSE_ERROR, str(exc)))
                break
            end_time = page.end_time or end_time
            for article in page.articles:
                self._discovered(
                    article.html_url,
                    via="zendesk",
                    depth=0,
                    channel=SourceChannel.PLATFORM_API,
                    anchor=article.title or "",
                )
                if self.options.command == "fetch":
                    self._push_article(article, api_url=url)
            url = page.next_page
        if complete:
            with transaction(self.conn):
                registry.update_source_state(
                    self.conn, source.id, self.clock.now(), zendesk_cursor=end_time or started_at
                )

    # ------------------------------------------------------------------ queue

    def _push(
        self,
        url: str,
        *,
        kind: SourceKind,
        channel: SourceChannel,
        depth: int,
        priority: int,
        score: int,
        lastmod: str | None = None,
        source: Source | None = None,
    ) -> None:
        key = (-priority, -score, depth, f"{next(self._counter):08d}")
        existing = self.pending.get(url)
        if existing is not None:
            # Merge: keep the higher priority, any sitemap lastmod, and the registered source.
            existing.sort_key = min(existing.sort_key, key)
            existing.lastmod = existing.lastmod or lastmod
            existing.source = existing.source or source
            if channel is SourceChannel.SEED:
                existing.channel = channel
            heapq.heapify(self.queue)
            return
        if url in self.seen:
            return
        self.seen.add(url)
        target = _Target(key, url, kind, channel, depth, lastmod, source)
        self.pending[url] = target
        heapq.heappush(self.queue, target)

    def _push_article(self, article: zendesk.Article, api_url: str) -> None:
        try:
            url = canonicalize(article.html_url)
        except UrlRejected:
            return
        if host_of(url) not in self.doc_hosts or matches_excluded(url, self.firm.excluded_paths):
            return
        # The API already returned this article's content, so a queued page fetch of the same URL is dropped.
        if url in self.pending:
            self.queue = [t for t in self.queue if t.url != url]
            heapq.heapify(self.queue)
        elif url in self.seen:
            return
        self.seen.add(url)
        key = (-50, -relevance.score(url, article.title or ""), 0, f"{next(self._counter):08d}")
        target = _Target(key, url, SourceKind.PAGE, SourceChannel.PLATFORM_API, 0, article=article, api_url=api_url)
        self.pending[url] = target
        heapq.heappush(self.queue, target)

    def _enqueue_known(self) -> None:
        for source in registry.list_sources(self.conn, self.firm.id):
            if source.kind in (SourceKind.SITEMAP, SourceKind.ZENDESK):
                continue
            if source.source_channel is SourceChannel.MANUAL_CAPTURE:
                continue
            if source.source_channel is SourceChannel.PLATFORM_API:
                continue  # refreshed only through the platform API, never by fetching the article page
            priority = 100 + source.priority if source.source_channel is SourceChannel.SEED else source.priority
            self._push(
                source.canonical_url,
                kind=source.kind,
                channel=source.source_channel,
                depth=0,
                priority=priority,
                score=relevance.score(source.canonical_url, source.label or ""),
                source=source,
            )
        if not self.options.discover:
            for row in self.conn.execute(
                "SELECT url, sitemap_lastmod, relevance FROM discovered_links WHERE firm_id = ? AND decision = 'queued'"
                " AND run_id = (SELECT run_id FROM discovered_links WHERE firm_id = ? ORDER BY discovered_at DESC"
                " LIMIT 1)",
                (self.firm.id, self.firm.id),
            ):
                url = str(row["url"])
                kind = SourceKind.PDF if url.lower().endswith(".pdf") else SourceKind.PAGE
                self._push(
                    url,
                    kind=kind,
                    channel=SourceChannel.SITEMAP,
                    depth=0,
                    priority=0,
                    score=int(row["relevance"]),
                    lastmod=row["sitemap_lastmod"],
                )

    def _drain(self) -> None:
        self._progress(f"Fetching {self.firm.owner_key} (budget {self.budget.limit} requests)")
        while self.queue:
            target = heapq.heappop(self.queue)
            self.pending.pop(target.url, None)
            block = self._budget_block()
            if block is not None:
                remaining = [target, *self.queue]
                self.queue = []
                self.pending.clear()
                seeds = [t for t in remaining if t.channel is SourceChannel.SEED]
                for seed in seeds:
                    self._record_block(seed.url, block, format_instant(self.clock.now()), source=seed.source)
                self.summary.not_fetched = len(remaining) - len(seeds)
                break
            if target.article is not None:
                self._store_article(target)
            else:
                self._process(target)

    def _budget_block(self) -> Block | None:
        if self.env.stop_requested():
            return Block(Outcome.DEADLINE_EXCEEDED, "stopped by the operator")
        if self.budget.deadline_passed:
            return Block(Outcome.DEADLINE_EXCEEDED, "run deadline reached")
        if self.budget.exhausted:
            return Block(Outcome.BUDGET_EXHAUSTED, f"fetch budget of {self.budget.limit} used")
        return None

    # ------------------------------------------------------------------ one URL

    def _process(self, target: _Target) -> None:
        source = target.source or registry.get_source(self.conn, ids.source_id(self.firm.owner_key, target.url))
        started = format_instant(self.clock.now())
        block = self.check(target.url, source=source)
        if block is not None:
            self._record_block(target.url, block, started, source=source)
            return
        if target.lastmod and source is not None and source.last_success_at and not self.options.force:
            lastmod = sitemaps.parse_lastmod(target.lastmod)
            if lastmod is not None and lastmod <= parse_instant(source.last_success_at):
                self._record_block(
                    target.url,
                    Block(Outcome.SKIPPED_LASTMOD, f"sitemap lastmod {target.lastmod}"),
                    started,
                    source=source,
                )
                return
        with transaction(self.conn):
            kind = source.kind if source is not None else target.kind
            source = source or registry.ensure_source(
                self.conn, self.firm, target.url, kind, target.channel, self.clock.now()
            )
        if source.requires_js:
            self._render(target, source, http_result=None, http_doc=None)
            return
        accept = ACCEPT_PDF if source.kind is SourceKind.PDF else ACCEPT_HTML
        max_bytes = (
            self.settings.limits.max_pdf_bytes
            if source.kind is SourceKind.PDF
            else max(self.settings.limits.max_html_bytes, self.settings.limits.max_pdf_bytes)
        )
        result = self._do_fetch(
            target.url,
            FetchRequest(
                url=target.url,
                accept=accept,
                max_bytes=max_bytes,
                # --force re-downloads (and re-renders) even when the server would answer 304.
                etag=None if self.options.force else source.etag,
                last_modified=None if self.options.force else source.last_modified,
            ),
        )
        if not result.ok:
            attempt = self._attempt_from(result, source_id=source.id)
            record_failure(self.conn, attempt=attempt, now=self.clock.now(), source=source)
            self.summary.results.append(
                TargetResult(target.url, attempt.outcome, attempt.policy_reason or attempt.error_detail)
            )
            self._progress(f"  {attempt.outcome.value:<24} {redact_url(target.url)}")
            return
        if result.status == 304:
            attempt = self._attempt_from(result, source_id=source.id)
            record_unchanged(self.conn, source=source, attempt=attempt, now=self.clock.now())
            self.summary.results.append(
                TargetResult(
                    target.url,
                    Outcome.UNCHANGED,
                    "304 Not Modified",
                    source.latest_snapshot_id,
                    directory="unchanged" if self.adapter is not None else None,
                )
            )
            self._progress(f"  {'unchanged':<24} {redact_url(target.url)} (304)")
            return
        self._handle_document(target, source, result)

    def _handle_document(self, target: _Target, source: Source, result: FetchResult) -> None:
        body = result.body or b""
        ctype = result.content_type
        doc: ParsedDocument | None = None
        try:
            if ctype in HTML_TYPES:
                if len(body) > self.settings.limits.max_html_bytes:
                    raise ParseError(f"HTML is over the {self.settings.limits.max_html_bytes}-byte limit")
                doc = parse_html(
                    body,
                    max_bytes=self.settings.limits.max_html_bytes,
                    charset=result.charset,
                    min_text_chars=self.settings.browser.min_text_chars,
                )
            elif ctype == "application/pdf" or (ctype == "application/octet-stream" and body.startswith(b"%PDF-")):
                pdf = self.settings.pdf
                doc = parse_pdf(
                    body,
                    max_bytes=self.settings.limits.max_pdf_bytes,
                    timeout_seconds=pdf.timeout_seconds,
                    max_pages=pdf.max_pages,
                    max_memory_mib=pdf.max_memory_mib,
                    max_text_chars=pdf.max_text_chars,
                )
            elif ctype == "text/plain":
                doc = parse_text(body, max_bytes=self.settings.limits.max_html_bytes, charset=result.charset)
            else:
                self._fail(
                    target, source, result, Outcome.UNSUPPORTED_CONTENT_TYPE, f"content type {ctype or 'missing'}"
                )
                return
        except ParseTimeout as exc:
            self._fail(target, source, result, Outcome.PARSE_TIMEOUT, str(exc))
            return
        except ParseError as exc:
            self._fail(target, source, result, Outcome.PARSE_ERROR, str(exc))
            return
        assert doc is not None
        if ctype in HTML_TYPES and "thin_content" in doc.warnings and self._browser_allowed(source):
            self._render(target, source, http_result=result, http_doc=doc)
            return
        self._store(target, source, result, doc, self.env.fetch_method, body)

    def _fail(self, target: _Target, source: Source, result: FetchResult, outcome: Outcome, detail: str) -> None:
        attempt = self._attempt_from(result, source_id=source.id)
        attempt.outcome, attempt.error_detail = outcome, detail[:500]
        record_failure(self.conn, attempt=attempt, now=self.clock.now(), source=source)
        self.summary.results.append(TargetResult(target.url, outcome, detail))
        self._progress(f"  {outcome.value:<24} {redact_url(target.url)}")

    def _store(
        self,
        target: _Target,
        source: Source,
        result: FetchResult,
        doc: ParsedDocument,
        method: FetchMethod,
        body: bytes,
    ) -> None:
        attempt = self._attempt_from(result, source_id=source.id, method=method)
        evidence = EvidenceInput(
            document=doc,
            requested_url=target.url,
            final_url=result.final_url or target.url,
            captured_at=attempt.started_at,
            content_type=result.content_type or "text/html",
            fetch_method=method,
            source_channel=source.source_channel.value,
            http_status=result.status,
            redirect_chain=result.redirect_chain,
            raw_bytes=body,
            raw_sha256=attempt.raw_sha256,
            etag=result.headers.get("etag"),
            last_modified=result.headers.get("last-modified"),
        )
        outcome, snapshot_id = store_evidence(
            self.conn,
            firm=self.firm,
            source=source,
            attempt=attempt,
            evidence=evidence,
            now=self.clock.now(),
            retain_raw=self.settings.raw.retain,
            raw_retention_days=self.settings.raw.retention_days,
        )
        entry = TargetResult(target.url, outcome, None, snapshot_id)
        self.summary.results.append(entry)
        if isinstance(self.firm, Publisher):
            self._read_directory_page(target, source, attempt.id, attempt.started_at, snapshot_id, body, method, entry)
            return
        self._progress(f"  {outcome.value:<24} {redact_url(target.url)}")
        if target.depth < self.max_depth:
            self._follow_links(doc, base=result.final_url or target.url, depth=target.depth, attempt_id=attempt.id)

    def _read_directory_page(
        self,
        target: _Target,
        source: Source,
        attempt_id: str,
        observed_at: str,
        snapshot_id: str,
        body: bytes,
        method: FetchMethod,
        entry: TargetResult,
    ) -> None:
        """Read a stored publisher page into observations, then follow only the links its adapter allows."""
        assert isinstance(self.firm, Publisher)
        assert self.adapter is not None
        stored = extract_and_store(
            self.conn,
            publisher=self.firm,
            source=source,
            snapshot_id=snapshot_id,
            attempt_id=attempt_id,
            html=body,
            page_url=target.url,
            capture_channel=method.value,
            observed_at=observed_at,
            now=self.clock.now(),
        )
        entry.directory, entry.directory_detail = stored.status, stored.describe()
        self._progress(f"  {entry.outcome.value:<24} {redact_url(target.url)} [{stored.describe()}]")
        kind = self.adapter.classify(target.url) or PageKind.UNSUPPORTED
        for url, anchor in stored.links:
            next_kind = self.adapter.follow(kind, url)
            if next_kind is None or url in self.seen:
                continue
            pagination = next_kind is kind and self.adapter.page_number(url) > 1
            depth = target.depth if pagination else target.depth + 1
            if depth > self.max_depth:
                continue
            if pagination:
                if self.list_pages[kind] + 1 >= self.adapter.max_pagination_pages:
                    continue
                self.list_pages[kind] += 1
            self._discovered(
                url,
                via="link",
                depth=depth,
                channel=SourceChannel.LINK,
                anchor=anchor,
                from_attempt=attempt_id,
                score=10 if pagination else 0,
            )

    def _follow_links(self, doc: ParsedDocument, *, base: str, depth: int, attempt_id: str) -> None:
        for link in doc.links:
            try:
                url = resolve_link(base, link.href)
            except UrlRejected:
                continue
            if url in self.seen or host_of(url) not in self.doc_hosts:
                continue
            if relevance.score(url, link.text) <= 0:
                continue  # bounded *relevant* link following
            self._discovered(
                url, via="link", depth=depth + 1, channel=SourceChannel.LINK, anchor=link.text, from_attempt=attempt_id
            )

    # ------------------------------------------------------------------ browser fallback

    def _browser_allowed(self, source: Source) -> bool:
        return (
            self.env.renderer is not None
            and self.options.use_browser
            and not source.js_disabled
            and self.settings.browser.enabled == "auto"
        )

    def _render(
        self, target: _Target, source: Source, http_result: FetchResult | None, http_doc: ParsedDocument | None
    ) -> None:
        started = format_instant(self.clock.now())
        if not self._browser_allowed(source):
            attempt = AttemptRecord(
                firm_id=self.firm.id,
                run_id=self.run_id,
                source_id=source.id,
                requested_url=target.url,
                fetch_method=FetchMethod.BROWSER,
                started_at=started,
                outcome=Outcome.RENDER_UNAVAILABLE,
                error_detail="this source needs JavaScript and the browser is not available",
            )
            record_failure(self.conn, attempt=attempt, now=self.clock.now(), source=source)
            self.summary.results.append(TargetResult(target.url, Outcome.RENDER_UNAVAILABLE))
            self._progress(f"  {'render_unavailable':<24} {redact_url(target.url)}")
            return
        block = self._budget_block()
        if block is not None:
            self._record_block(target.url, block, started, source=source)
            return
        assert self.env.renderer is not None
        host = host_of(target.url)
        host_ips = self._validated_ips()
        self.pacer.wait(host, self._min_delay(host))
        self.budget.spend(1)
        try:
            rendered = self.env.renderer.render(
                target.url,
                allowed_hosts=set(self.doc_hosts),
                asset_hosts=set(self.asset_hosts),
                host_ips=host_ips,
                fixture=self.env.fixture,
            )
        except RenderError as exc:
            self.pacer.record(host, 0)
            attempt = AttemptRecord(
                firm_id=self.firm.id,
                run_id=self.run_id,
                source_id=source.id,
                requested_url=target.url,
                fetch_method=self._browser_method(),
                started_at=started,
                outcome=Outcome.RENDER_ERROR,
                error_detail=str(exc)[:500],
            )
            record_failure(self.conn, attempt=attempt, now=self.clock.now(), source=source)
            self.summary.results.append(TargetResult(target.url, Outcome.RENDER_ERROR, str(exc)))
            return
        self.pacer.record(host, rendered.duration_ms / 1000)
        html = rendered.html.encode("utf-8")
        result = FetchResult(
            requested_url=target.url,
            started_at=started,
            final_url=rendered.final_url,
            status=rendered.status,
            headers={"content-type": "text/html; charset=utf-8"},
            body=html,
            duration_ms=rendered.duration_ms,
            requests_made=1,
        )
        from fundedflow_collector.net.challenge import detect_challenge

        challenge = detect_challenge(rendered.status or 200, rendered.headers, html)
        final_host = host_of(rendered.final_url) if rendered.final_url.startswith("http") else host
        if challenge is not None or (rendered.status is not None and rendered.status in (401, 403, 451)):
            from fundedflow_collector.outcomes import CircuitState

            result.outcome = Outcome.BLOCKED_BOT_PROTECTION if challenge else Outcome.ACCESS_DENIED
            result.reason = challenge or f"HTTP {rendered.status} in the browser"
            result.trip = CircuitState.BLOCKED_BOT_PROTECTION if challenge else CircuitState.ACCESS_DENIED
            self._trip(final_host, result)
            self._fail(target, source, result, result.outcome, result.reason)
            return
        if rendered.status is not None and rendered.status >= 400:
            self._fail(target, source, result, Outcome.HTTP_ERROR, f"HTTP {rendered.status} in the browser")
            return
        if final_host not in self.doc_hosts:
            self._fail(
                target, source, result, Outcome.NOT_ALLOWLISTED, f"browser ended on unauthorised host {final_host}"
            )
            return
        if rendered.final_url != target.url:
            block = self.check(rendered.final_url)
            if block is not None:
                self._fail(target, source, result, block.outcome, f"browser redirect: {block.reason}")
                return
        try:
            doc = parse_html(
                html, max_bytes=self.settings.limits.max_html_bytes, min_text_chars=self.settings.browser.min_text_chars
            )
        except ParseError as exc:
            self._fail(target, source, result, Outcome.PARSE_ERROR, str(exc))
            return
        if http_result is not None and http_doc is not None:
            if len(doc.text) <= len(http_doc.text):
                # Rendering added nothing: keep the plain HTTP version (a short static page, not a JS page).
                self._store(target, source, http_result, http_doc, self.env.fetch_method, http_result.body or b"")
                return
            # Keep the HTTP validators so the next run can ask "changed?" with a cheap conditional GET.
            for name in ("etag", "last-modified"):
                if name in http_result.headers:
                    result.headers[name] = http_result.headers[name]
        doc.parser_name = "playwright+" + doc.parser_name
        if rendered.blocked_requests:
            doc.warnings = sorted({*doc.warnings, "browser_requests_blocked"})
        self._store(target, source, result, doc, self._browser_method(), html)

    def _browser_method(self) -> FetchMethod:
        return FetchMethod.FIXTURE_REPLAY if self.env.fixture is not None else FetchMethod.BROWSER

    def _validated_ips(self) -> dict[str, str]:
        """Resolve each allowed host once and keep only public addresses, for Chromium's resolver rules."""
        if self.env.fixture is not None or self.env.resolver is None:
            return {}
        mapping: dict[str, str] = {}
        for host in sorted({*self.doc_hosts, *self.asset_hosts}):
            try:
                addresses = self.env.resolver.resolve(host, 443)
            except OSError:
                continue
            if addresses and all(is_public_address(a) for a in addresses):
                mapping[host] = addresses[0]
        return mapping

    # ------------------------------------------------------------------ Zendesk articles

    def _store_article(self, target: _Target) -> None:
        article = target.article
        assert article is not None
        assert target.api_url is not None
        started = format_instant(self.clock.now())
        with transaction(self.conn):
            source = registry.ensure_source(
                self.conn, self.firm, target.url, SourceKind.PAGE, SourceChannel.PLATFORM_API, self.clock.now()
            )
        body = article.body.encode("utf-8")
        try:
            doc = parse_html(
                body, max_bytes=self.settings.limits.max_html_bytes, min_text_chars=0, title_override=article.title
            )
        except ParseError as exc:
            attempt = AttemptRecord(
                firm_id=self.firm.id,
                run_id=self.run_id,
                source_id=source.id,
                requested_url=target.api_url,
                fetch_method=self._api_method(),
                started_at=started,
                outcome=Outcome.PARSE_ERROR,
                error_detail=str(exc)[:500],
            )
            record_failure(self.conn, attempt=attempt, now=self.clock.now(), source=source)
            self.summary.results.append(TargetResult(target.url, Outcome.PARSE_ERROR, str(exc)))
            return
        doc.parser_name = "zendesk-api+" + doc.parser_name
        attempt = AttemptRecord(
            firm_id=self.firm.id,
            run_id=self.run_id,
            source_id=source.id,
            requested_url=target.api_url,
            final_url=target.url,
            fetch_method=self._api_method(),
            started_at=started,
            outcome=Outcome.NEW_SNAPSHOT,
            http_status=200,
            bytes=len(body),
            raw_sha256=sha256_bytes(body),
            duration_ms=0,
        )
        evidence = EvidenceInput(
            document=doc,
            requested_url=target.api_url,
            final_url=target.url,
            captured_at=started,
            content_type="text/html",
            fetch_method=self._api_method(),
            source_channel=SourceChannel.PLATFORM_API.value,
            http_status=200,
            raw_bytes=body,
            raw_sha256=attempt.raw_sha256,
            platform_metadata={
                "zendesk": {
                    "article_id": article.id,
                    "locale": article.locale,
                    "updated_at": article.updated_at,
                    "edited_at": article.edited_at,
                    "section_id": article.section_id,
                }
            },
        )
        outcome, snapshot_id = store_evidence(
            self.conn,
            firm=self.firm,
            source=source,
            attempt=attempt,
            evidence=evidence,
            now=self.clock.now(),
            retain_raw=self.settings.raw.retain,
            raw_retention_days=self.settings.raw.retention_days,
        )
        self.summary.results.append(TargetResult(target.url, outcome, None, snapshot_id))
        self._progress(f"  {outcome.value:<24} {redact_url(target.url)} (Zendesk API)")

    def _api_method(self) -> FetchMethod:
        return FetchMethod.FIXTURE_REPLAY if self.env.fixture is not None else FetchMethod.PLATFORM_API

    # ------------------------------------------------------------------ helpers

    def _do_fetch(self, url: str, request: FetchRequest) -> FetchResult:
        assert self.env.fetcher is not None
        host = host_of(url)
        self.pacer.wait(host, self._min_delay(host))
        result = self.env.fetcher.fetch(request, lambda hop: self.check(hop), self._state(host))
        self.budget.spend(result.requests_made)
        self.pacer.record(host, result.duration_ms / 1000)
        if result.trip is not None:
            trip_host = host_of(result.final_url) if result.final_url else host
            self._trip(trip_host, result)
        return result

    def _attempt_from(
        self, result: FetchResult, *, source_id: str | None, method: FetchMethod | None = None
    ) -> AttemptRecord:
        outcome = result.outcome or Outcome.NEW_SNAPSHOT
        is_policy = OUTCOME_INFO[outcome].category is Category.POLICY
        return AttemptRecord(
            firm_id=self.firm.id,
            run_id=self.run_id,
            source_id=source_id,
            requested_url=result.requested_url,
            final_url=result.final_url,
            redirect_chain=result.redirect_chain,
            fetch_method=method or self.env.fetch_method,
            started_at=result.started_at,
            duration_ms=result.duration_ms,
            resolved_ip=result.resolved_ip,
            conditional=result.conditional,
            http_status=result.status,
            response_headers=result.headers,
            bytes=len(result.body) if result.body is not None else None,
            raw_sha256=sha256_bytes(result.body) if result.body is not None else None,
            outcome=outcome,
            policy_reason=result.reason if is_policy else None,
            error_detail=None if is_policy else result.reason,
        )

    def _record_block(
        self, url: str, block: Block, started: str, *, source: Source | None = None, counted: bool = True
    ) -> None:
        if self.options.dry_run:
            return
        attempt = AttemptRecord(
            firm_id=self.firm.id,
            run_id=self.run_id,
            source_id=source.id if source else None,
            requested_url=url,
            fetch_method=self.env.fetch_method,
            started_at=started,
            outcome=block.outcome,
            policy_reason=block.reason,
        )
        record_failure(self.conn, attempt=attempt, now=self.clock.now(), source=source)
        self.summary.results.append(TargetResult(url, block.outcome, block.reason, counted=counted))
        self._progress(f"  {block.outcome.value:<24} {redact_url(url)}")

    # ------------------------------------------------------------------ dry run

    def _dry_run(self) -> RunSummary:
        """Evaluate known targets against policy with no network and no writes."""
        self.summary.status = "dry_run"
        ignore_disabled = isinstance(self.firm, Publisher) and not self.firm.enabled
        if ignore_disabled:
            self.summary.message = (
                f"{self.firm.owner_key} is disabled ({self.firm.disabled_reason}); this preview shows what each "
                "request would meet after it is enabled."
            )
        targets: list[str] = []
        for source in registry.list_sources(self.conn, self.firm.id):
            if source.source_channel is not SourceChannel.MANUAL_CAPTURE:
                targets.append(source.canonical_url)
        for row in self.conn.execute(
            "SELECT DISTINCT url FROM discovered_links WHERE firm_id = ? AND decision = 'queued' ORDER BY url",
            (self.firm.id,),
        ):
            if row["url"] not in targets:
                targets.append(str(row["url"]))
        for url in targets:
            host = host_of(url)
            block = self.check(url, fetch_robots=False, ignore_disabled=ignore_disabled)
            if block is not None:
                self.summary.dry_run_lines.append((block.outcome.value, url, block.reason))
                self.summary.results.append(TargetResult(url, block.outcome, block.reason))
            elif host not in self.robots:
                self.summary.dry_run_lines.append(("allowed", url, "robots.txt not cached: would fetch it first"))
            else:
                self.summary.dry_run_lines.append(
                    ("allowed", url, f"would wait {self._min_delay(host):g} s per request")
                )
        return self.summary


def user_agent_suffix(info_url: str | None) -> str:
    return f"{USER_AGENT_PRODUCT} (+{info_url or 'https://example.invalid/fundedflow-collector'})"


def run_firms(env: Environment, firms: Sequence[Owner], options: RunOptions) -> list[RunSummary]:
    """Run firms one after another (never in parallel)."""
    batch_id = ids.new_id("batch")
    summaries = []
    for firm in firms:
        summaries.append(FirmRunner(env, firm, options, batch_id).run())
    return summaries
