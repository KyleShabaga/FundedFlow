"""Machine-readable outcome codes and registry enums. The single source of truth for every status string."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Category(StrEnum):
    OK = "ok"
    POLICY = "policy"
    FAILURE = "failure"


class Outcome(StrEnum):
    NEW_SNAPSHOT = "new_snapshot"
    MATCHED_EARLIER_SNAPSHOT = "matched_earlier_snapshot"
    UNCHANGED = "unchanged"
    SKIPPED_LASTMOD = "skipped_lastmod"
    NOT_ALLOWLISTED = "not_allowlisted"
    EXCLUDED_PATH = "excluded_path"
    URL_REJECTED = "url_rejected"
    ADDRESS_BLOCKED = "address_blocked"
    DISABLED = "disabled"
    TERMS_BLOCKED = "terms_blocked"
    ROBOTS_BLOCKED = "robots_blocked"
    ROBOTS_UNREACHABLE = "robots_unreachable"
    CIRCUIT_OPEN = "circuit_open"
    BUDGET_EXHAUSTED = "budget_exhausted"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    ACCESS_DENIED = "access_denied"
    BLOCKED_BOT_PROTECTION = "blocked_bot_protection"
    RATE_LIMITED = "rate_limited"
    HTTP_ERROR = "http_error"
    SERVER_ERROR = "server_error"
    TIMEOUT = "timeout"
    NETWORK_ERROR = "network_error"
    TOO_LARGE = "too_large"
    UNSUPPORTED_CONTENT_TYPE = "unsupported_content_type"
    PARSE_ERROR = "parse_error"
    PARSE_TIMEOUT = "parse_timeout"
    RENDER_UNAVAILABLE = "render_unavailable"
    RENDER_ERROR = "render_error"


@dataclass(frozen=True)
class OutcomeInfo:
    category: Category
    meaning: str
    action: str


OUTCOME_INFO: dict[Outcome, OutcomeInfo] = {
    Outcome.NEW_SNAPSHOT: OutcomeInfo(
        Category.OK,
        "Page fetched; its content is new or changed, so a new snapshot was stored.",
        "Nothing. A changed page is not a confirmed rule change.",
    ),
    Outcome.MATCHED_EARLIER_SNAPSHOT: OutcomeInfo(
        Category.OK, "Content changed back to text already stored in an earlier snapshot.", "Nothing."
    ),
    Outcome.UNCHANGED: OutcomeInfo(
        Category.OK, "Server said 304 Not Modified, or the content matches the latest snapshot.", "Nothing."
    ),
    Outcome.SKIPPED_LASTMOD: OutcomeInfo(
        Category.OK,
        "Sitemap lastmod is not newer than the last snapshot, so the page was not requested.",
        "Nothing. Use --force to fetch anyway.",
    ),
    Outcome.NOT_ALLOWLISTED: OutcomeInfo(
        Category.POLICY,
        "The URL (or a redirect) points at a host you have not authorised for this firm.",
        "Add the host with `host add` only if it is the firm's own site.",
    ),
    Outcome.EXCLUDED_PATH: OutcomeInfo(
        Category.POLICY, "The path matches one of the firm's excluded patterns.", "Nothing, or edit the patterns."
    ),
    Outcome.URL_REJECTED: OutcomeInfo(
        Category.POLICY, "Unsafe or invalid URL (scheme, credentials, port, IP literal or length).", "Fix the URL."
    ),
    Outcome.ADDRESS_BLOCKED: OutcomeInfo(
        Category.POLICY,
        "The host resolved to a private, loopback, link-local or reserved address.",
        "Nothing. The collector only connects to public internet addresses.",
    ),
    Outcome.DISABLED: OutcomeInfo(
        Category.POLICY, "The firm or source is disabled.", "Enable it if that was a mistake."
    ),
    Outcome.TERMS_BLOCKED: OutcomeInfo(
        Category.POLICY,
        "No current terms review allows automated access to this host (missing, older than 365 days, "
        "prohibited, or unclear without --accept-unclear-terms).",
        "Review the terms with `host terms`, or use manual capture.",
    ),
    Outcome.ROBOTS_BLOCKED: OutcomeInfo(
        Category.POLICY, "robots.txt disallows this URL for FundedFlowCollector.", "Use manual capture."
    ),
    Outcome.ROBOTS_UNREACHABLE: OutcomeInfo(
        Category.POLICY,
        "robots.txt could not be read (429, 5xx, timeout), which RFC 9309 treats as disallow-all.",
        "Try again another day, or use manual capture.",
    ),
    Outcome.CIRCUIT_OPEN: OutcomeInfo(
        Category.POLICY,
        "This host is stopped after an earlier block or rate limit.",
        "See `host list`. Rate limits clear after 24 h; other blocks need `host reenable`.",
    ),
    Outcome.BUDGET_EXHAUSTED: OutcomeInfo(
        Category.POLICY, "The per-firm fetch budget for this run is used up.", "Run again later."
    ),
    Outcome.DEADLINE_EXCEEDED: OutcomeInfo(Category.POLICY, "The run reached its time limit.", "Run again later."),
    Outcome.ACCESS_DENIED: OutcomeInfo(
        Category.FAILURE,
        "The site answered 401, 451 or a persistent 403. The host is stopped.",
        "Do not work around it. Use manual capture or ask the firm, then `host reenable` if they agree.",
    ),
    Outcome.BLOCKED_BOT_PROTECTION: OutcomeInfo(
        Category.FAILURE,
        "The site showed a bot challenge. The host is stopped until you re-enable it.",
        "Do not work around it. Use manual capture or ask the firm.",
    ),
    Outcome.RATE_LIMITED: OutcomeInfo(
        Category.FAILURE,
        "The site answered 429 Too Many Requests.",
        "Wait. A third 429 in one run stops the host for 24 hours.",
    ),
    Outcome.HTTP_ERROR: OutcomeInfo(
        Category.FAILURE,
        "The site answered another 4xx status, such as 404 Not Found.",
        "Check the URL; older snapshots are kept.",
    ),
    Outcome.SERVER_ERROR: OutcomeInfo(Category.FAILURE, "The site answered 5xx after retries.", "Try again later."),
    Outcome.TIMEOUT: OutcomeInfo(Category.FAILURE, "The request timed out.", "Try again later."),
    Outcome.NETWORK_ERROR: OutcomeInfo(
        Category.FAILURE, "DNS or connection failure.", "Check your internet connection."
    ),
    Outcome.TOO_LARGE: OutcomeInfo(
        Category.FAILURE, "The response exceeded the size limit.", "Use manual capture if you need it."
    ),
    Outcome.UNSUPPORTED_CONTENT_TYPE: OutcomeInfo(
        Category.FAILURE, "The response is not HTML, PDF, XML, JSON or plain text.", "Nothing."
    ),
    Outcome.PARSE_ERROR: OutcomeInfo(
        Category.FAILURE, "The document could not be parsed.", "Try manual capture as PDF or text."
    ),
    Outcome.PARSE_TIMEOUT: OutcomeInfo(
        Category.FAILURE,
        "PDF extraction exceeded its time or memory limit and was stopped.",
        "Use manual capture as text.",
    ),
    Outcome.RENDER_UNAVAILABLE: OutcomeInfo(
        Category.FAILURE,
        "The page needs JavaScript but the [browser] extra is not installed or is turned off.",
        "Install the extra, or use manual capture.",
    ),
    Outcome.RENDER_ERROR: OutcomeInfo(
        Category.FAILURE, "The browser could not render the page.", "Try again, or use manual capture."
    ),
}

SNAPSHOT_OUTCOMES = frozenset({Outcome.NEW_SNAPSHOT, Outcome.MATCHED_EARLIER_SNAPSHOT, Outcome.UNCHANGED})


class CircuitState(StrEnum):
    CLOSED = "closed"
    RATE_LIMITED = "rate_limited"
    BLOCKED_BOT_PROTECTION = "blocked_bot_protection"
    ACCESS_DENIED = "access_denied"


class TermsDecision(StrEnum):
    ALLOWED = "allowed"
    ALLOWED_WITH_LIMITS = "allowed_with_limits"
    PROHIBITED = "prohibited"
    UNCLEAR = "unclear"


class HostRole(StrEnum):
    HOMEPAGE = "homepage"
    HELP_CENTER = "help_center"
    DOCS = "docs"
    ASSET = "asset"


class SourceKind(StrEnum):
    PAGE = "page"
    PDF = "pdf"
    SITEMAP = "sitemap"
    ZENDESK = "zendesk"


class SourceChannel(StrEnum):
    MANUAL_CAPTURE = "manual_capture"
    PLATFORM_API = "platform_api"
    SEED = "seed"
    SITEMAP = "sitemap"
    LINK = "link"


class FetchMethod(StrEnum):
    HTTP = "http"
    BROWSER = "browser"
    PLATFORM_API = "platform_api"
    MANUAL_CAPTURE = "manual_capture"
    FIXTURE_REPLAY = "fixture_replay"
