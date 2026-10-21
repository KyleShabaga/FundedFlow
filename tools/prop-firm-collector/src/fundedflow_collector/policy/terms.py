"""Terms-of-use gate (research addendum §4). The operator records the decision; the collector only enforces it."""

from __future__ import annotations

from datetime import datetime, timedelta

from fundedflow_collector.clock import parse_instant
from fundedflow_collector.config import Settings
from fundedflow_collector.db.registry import Host
from fundedflow_collector.outcomes import TermsDecision

REVIEW_VALID_DAYS = 365


def terms_block_reason(host: Host | None, now: datetime) -> str | None:
    """Why live fetching from this host is not allowed, or None if it is."""
    if host is None:
        return "host is not authorised for this firm"
    if host.terms_decision is None or host.terms_reviewed_at is None:
        return f"no terms review recorded for {host.host}; use `collector host terms`"
    reviewed = parse_instant(host.terms_reviewed_at)
    if now - reviewed > timedelta(days=REVIEW_VALID_DAYS):
        return f"terms review for {host.host} is older than {REVIEW_VALID_DAYS} days; review it again"
    if host.terms_decision is TermsDecision.PROHIBITED:
        return f"terms for {host.host} prohibit automated access; use manual capture"
    if host.terms_decision is TermsDecision.UNCLEAR and host.unclear_terms_accepted_at is None:
        return f"terms for {host.host} are unclear and were not acknowledged with --accept-unclear-terms"
    return None


def review_expires(host: Host) -> datetime | None:
    if host.terms_reviewed_at is None:
        return None
    return parse_instant(host.terms_reviewed_at) + timedelta(days=REVIEW_VALID_DAYS)


def min_delay_for(host: Host, settings: Settings) -> float:
    """The slowest pacing that the settings and the host's terms review require."""
    delay = settings.pacing.min_delay_seconds
    if host.terms_decision is TermsDecision.UNCLEAR:
        delay = max(delay, settings.pacing.unclear_terms_delay_seconds)
    if host.terms_min_delay_seconds is not None:
        delay = max(delay, host.terms_min_delay_seconds)
    return delay
