from __future__ import annotations

import random
import sqlite3
from datetime import timedelta

import pytest

from fundedflow_collector.clock import FakeClock, format_instant
from fundedflow_collector.config import Settings
from fundedflow_collector.db import registry
from fundedflow_collector.outcomes import CircuitState, HostRole, TermsDecision
from fundedflow_collector.policy import circuit, robots
from fundedflow_collector.policy.budget import RunBudget
from fundedflow_collector.policy.pacing import HostPacer
from fundedflow_collector.policy.terms import min_delay_for, terms_block_reason
from tests.conftest import add_firm

# ---------------------------------------------------------------- robots.txt (RFC 9309 status matrix)


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (200, "parsed"),
        (204, "parsed"),
        (401, "unavailable"),
        (403, "unavailable"),
        (404, "unavailable"),
        (410, "unavailable"),
        (451, "unavailable"),
        (429, "unreachable"),
        (500, "unreachable"),
        (503, "unreachable"),
        (None, "unreachable"),
        (301, "unreachable"),
    ],
)
def test_robots_status_matrix(status: int | None, expected: str) -> None:
    assert robots.classify(status) == expected


def rules(body: str | None, status: int | None = 200) -> robots.RobotsRules:
    status_class = robots.classify(status)
    return robots.RobotsRules(
        host="www.example-firm.test",
        status_class=status_class,
        http_status=status,
        body=body if status_class == "parsed" else None,
        fetched_at="2026-10-20T12:00:00.000Z",
    )


def test_unavailable_allows_and_unreachable_disallows_everything() -> None:
    assert rules(None, 404).allows("https://www.example-firm.test/anything")
    assert not rules(None, 503).allows("https://www.example-firm.test/anything")
    assert not rules(None, None).allows("https://www.example-firm.test/")


def test_product_token_group_wins_over_star() -> None:
    body = "User-agent: FundedFlowCollector\nAllow: /\nDisallow: /members/\n\nUser-agent: *\nDisallow: /\n"
    r = rules(body)
    assert r.allows("https://www.sample-funding.test/program-rules")
    assert not r.allows("https://www.sample-funding.test/members/area")


def test_star_group_and_longest_match() -> None:
    body = "User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\nDisallow: /*.pdf$\n"
    r = rules(body)
    assert not r.allows("https://www.example-firm.test/docs/internal")
    assert r.allows("https://www.example-firm.test/docs/public/page")
    assert not r.allows("https://www.example-firm.test/files/rulebook.pdf")
    assert r.allows("https://www.example-firm.test/rules")


def test_crawl_delay_and_request_rate_take_the_stricter() -> None:
    r = rules("User-agent: *\nCrawl-delay: 3\nRequest-rate: 1/10s\n")
    assert r.delay_seconds() == 10.0
    assert rules("User-agent: *\nCrawl-delay: 4\n").delay_seconds() == 4.0
    assert rules("User-agent: *\nDisallow:\n").delay_seconds() is None


def test_sitemaps_and_content_signals() -> None:
    body = (
        "User-agent: *\nAllow: /\nSitemap: https://www.example-firm.test/sitemap.xml\n"
        "Content-Signal: search=yes, ai-train=no\n"
    )
    r = rules(body)
    assert r.sitemaps() == ["https://www.example-firm.test/sitemap.xml"]
    assert robots.content_signals(body) == ["search=yes, ai-train=no"]


def test_pathological_patterns_are_dropped() -> None:
    evil = "User-agent: *\nDisallow: /" + "*a" * 40 + "\nDisallow: /private/\n"
    filtered, warnings = robots.filter_rules(evil)
    assert "*a*a" not in filtered and "/private/" in filtered and warnings
    assert not rules(evil).allows("https://www.example-firm.test/private/x")


def test_robots_cache_lasts_24_hours(conn: sqlite3.Connection, clock: FakeClock) -> None:
    robots.store(
        conn,
        "www.example-firm.test",
        200,
        "User-agent: *\nDisallow: /x\nContent-Signal: ai-train=no\n",
        clock.now(),
        run_id=None,
        firm_id=None,
    )
    assert robots.cached(conn, "www.example-firm.test", clock.now()) is not None
    assert robots.latest_signals(conn, "www.example-firm.test") == ["ai-train=no"]
    clock.advance(timedelta(hours=24, seconds=1).total_seconds())
    assert robots.cached(conn, "www.example-firm.test", clock.now()) is None
    kinds = [r["kind"] for r in conn.execute("SELECT kind FROM policy_events ORDER BY at")]
    assert "robots_fetched" in kinds and "content_signal_seen" in kinds


# ---------------------------------------------------------------- terms gate


@pytest.mark.parametrize(
    ("decision", "accept", "allowed"),
    [
        (TermsDecision.ALLOWED, False, True),
        (TermsDecision.ALLOWED_WITH_LIMITS, False, True),
        (TermsDecision.UNCLEAR, True, True),
        (TermsDecision.UNCLEAR, False, False),
        (TermsDecision.PROHIBITED, False, False),
        (None, False, False),
    ],
)
def test_terms_gate(
    conn: sqlite3.Connection, clock: FakeClock, decision: TermsDecision | None, accept: bool, allowed: bool
) -> None:
    firm = add_firm(conn, clock, hosts={"www.example-firm.test": (HostRole.HOMEPAGE, decision)}, accept_unclear=accept)
    host = registry.require_host(conn, firm, "www.example-firm.test")
    assert (terms_block_reason(host, clock.now()) is None) is allowed


def test_terms_review_goes_stale_after_365_days(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(conn, clock)
    host = registry.require_host(conn, firm, "www.example-firm.test")
    clock.advance(timedelta(days=365).total_seconds())
    assert terms_block_reason(host, clock.now()) is None
    clock.advance(timedelta(days=1).total_seconds())
    assert "older than 365 days" in (terms_block_reason(host, clock.now()) or "")


def test_unclear_acknowledgement_is_recorded_and_slows_pacing(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(
        conn, clock, hosts={"www.example-firm.test": (HostRole.HOMEPAGE, TermsDecision.UNCLEAR)}, accept_unclear=True
    )
    host = registry.require_host(conn, firm, "www.example-firm.test")
    assert host.unclear_terms_accepted_at == format_instant(clock.now())
    events = [r["kind"] for r in conn.execute("SELECT kind FROM policy_events WHERE host = ?", (host.host,))]
    assert "unclear_terms_accepted" in events
    assert min_delay_for(host, Settings()) == 5.0


def test_accept_unclear_only_applies_to_unclear(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(conn, clock, hosts={"www.example-firm.test": (HostRole.HOMEPAGE, None)})
    host = registry.require_host(conn, firm, "www.example-firm.test")
    with pytest.raises(registry.RegistryError):
        registry.record_terms(
            conn,
            firm,
            host,
            decision=TermsDecision.ALLOWED,
            terms_url="https://x.test/terms",
            now=clock.now(),
            accept_unclear=True,
        )


def test_terms_min_delay_only_slows_down(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(conn, clock, hosts={"www.example-firm.test": (HostRole.HOMEPAGE, None)})
    host = registry.require_host(conn, firm, "www.example-firm.test")
    host = registry.record_terms(
        conn,
        firm,
        host,
        decision=TermsDecision.ALLOWED_WITH_LIMITS,
        terms_url="https://www.example-firm.test/terms",
        now=clock.now(),
        min_delay_seconds=7,
    )
    assert min_delay_for(host, Settings()) == 7
    with pytest.raises(registry.RegistryError):
        registry.record_terms(
            conn,
            firm,
            host,
            decision=TermsDecision.ALLOWED,
            terms_url="https://x.test/t",
            now=clock.now(),
            min_delay_seconds=0.5,
        )


# ---------------------------------------------------------------- circuit breaker


def test_rate_limit_cools_down_after_24_hours(conn: sqlite3.Connection, clock: FakeClock) -> None:
    circuit.trip(conn, "h.test", CircuitState.RATE_LIMITED, "third 429", clock.now(), run_id=None, firm_id=None)
    assert circuit.current(conn, "h.test", clock.now()).open
    clock.advance(timedelta(hours=23, minutes=59).total_seconds())
    assert circuit.current(conn, "h.test", clock.now()).open
    clock.advance(120)
    assert not circuit.current(conn, "h.test", clock.now()).open
    kinds = [r["kind"] for r in conn.execute("SELECT kind FROM policy_events ORDER BY at")]
    assert kinds == ["circuit_tripped", "circuit_expired"]


@pytest.mark.parametrize("state", [CircuitState.BLOCKED_BOT_PROTECTION, CircuitState.ACCESS_DENIED])
def test_blocks_need_manual_reenable(conn: sqlite3.Connection, clock: FakeClock, state: CircuitState) -> None:
    circuit.trip(conn, "h.test", state, "challenge", clock.now(), run_id=None, firm_id=None)
    clock.advance(timedelta(days=30).total_seconds())
    assert circuit.current(conn, "h.test", clock.now()).state is state
    with pytest.raises(ValueError, match="reason"):
        circuit.reenable(conn, "h.test", " ", clock.now())
    circuit.reenable(conn, "h.test", "firm confirmed access is fine", clock.now())
    assert not circuit.current(conn, "h.test", clock.now()).open
    assert circuit.list_open(conn, clock.now()) == []


def test_dry_run_circuit_read_does_not_write(conn: sqlite3.Connection, clock: FakeClock) -> None:
    circuit.trip(conn, "h.test", CircuitState.RATE_LIMITED, "429", clock.now(), run_id=None, firm_id=None)
    clock.advance(timedelta(days=2).total_seconds())
    assert not circuit.current(conn, "h.test", clock.now(), persist=False).open
    assert conn.execute("SELECT state FROM host_circuits").fetchone()["state"] == "rate_limited"


# ---------------------------------------------------------------- pacing and budget


def test_pacing_waits_minimum_delay_with_bounded_jitter(clock: FakeClock) -> None:
    pacer = HostPacer(clock, Settings(), random.Random(1))
    assert pacer.wait("a.test", 2.0) == 0.0
    pacer.record("a.test", 0.1)
    slept = pacer.wait("a.test", 2.0)
    assert 2.0 <= slept <= 2.25
    pacer.record("b.test", 0.1)
    clock.advance(5)
    assert pacer.wait("b.test", 2.0) == 0.0


def test_pacing_slows_down_after_slow_responses(clock: FakeClock) -> None:
    pacer = HostPacer(clock, Settings(), random.Random(1))
    pacer.record("a.test", 8.0)
    assert pacer.delay_for("a.test", 2.0) == 16.0
    pacer.record("a.test", 100.0)
    assert pacer.delay_for("a.test", 2.0) == 60.0


def test_budget_and_deadline(clock: FakeClock) -> None:
    budget = RunBudget(3, 1, clock)
    budget.spend(2)
    assert budget.remaining == 1 and not budget.exhausted
    budget.spend()
    assert budget.exhausted
    assert not budget.deadline_passed
    clock.advance(61)
    assert budget.deadline_passed
