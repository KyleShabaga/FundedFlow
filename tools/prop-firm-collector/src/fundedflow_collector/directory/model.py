"""The vocabulary shared by adapters, storage, review and export. Every stored status string comes from here."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class PageKind(StrEnum):
    LISTING = "listing"  # a directory list of firms (often paginated)
    COMPARISON = "comparison"  # a comparison table across firms and programmes
    PROFILE = "profile"  # one firm's page on the publisher's site
    RULES_GUIDE = "rules_guide"  # the publisher's own write-up of a firm's rules
    UNSUPPORTED = "unsupported"  # in scope for snapshots, but the adapter reads no structure from it


class ExtractionStatus(StrEnum):
    COLLECTED = "collected"
    NO_RECORDS = "no_records"
    JS_UNAVAILABLE = "js_unavailable"
    STRUCTURE_CHANGED = "structure_changed"
    PARSE_ERROR = "parse_error"
    UNSUPPORTED_PAGE = "unsupported_page"


class Phase(StrEnum):
    EVALUATION = "evaluation"  # an evaluation whose step is not shown
    EVALUATION_STEP_1 = "evaluation_step_1"
    EVALUATION_STEP_2 = "evaluation_step_2"
    EVALUATION_STEP_3 = "evaluation_step_3"
    SIMULATED_FUNDED = "simulated_funded"
    INSTANT_FUNDED = "instant_funded"
    UNSPECIFIED = "unspecified"


class Market(StrEnum):
    FUTURES = "futures"
    FOREX_CFD = "forex_cfd"
    CRYPTO = "crypto"
    STOCKS = "stocks"
    MULTIPLE = "multiple"
    UNSPECIFIED = "unspecified"


class ValueKind(StrEnum):
    VALUE = "value"
    UNKNOWN = "unknown"  # blank, dash or "?": the publisher shows nothing
    NONE = "none"  # the publisher says there is no such rule ("None", "No limit")
    NOT_APPLICABLE = "not_applicable"
    SEE_RULES = "see_rules"  # "See rules", "Varies": a pointer, not a value


class Confidence(StrEnum):
    OBSERVED = "observed"
    UNCERTAIN = "uncertain"


class ObservationStatus(StrEnum):
    """Review status, worked out when read. Third-party agreement is never `officially_verified`."""

    OBSERVED = "observed"
    UNCERTAIN = "uncertain"
    CONFLICTING = "conflicting"
    STALE = "stale"
    SUPERSEDED = "superseded"
    OFFICIALLY_VERIFIED = "officially_verified"


@dataclass(frozen=True)
class FieldInfo:
    label: str
    unit: str | None  # percent_or_money | days | percent | text | enum


#: The rule-candidate fields a publisher can be observed to state. Ratings, rankings, fit scores, affiliate offers,
#: coupons and popularity are deliberately absent: adapters drop those columns and say so in their warnings.
FIELDS: dict[str, FieldInfo] = {
    "profit_target": FieldInfo("Profit target", "percent_or_money"),
    "max_drawdown": FieldInfo("Maximum drawdown", "percent_or_money"),
    "daily_loss_limit": FieldInfo("Daily loss limit", "percent_or_money"),
    "drawdown_type": FieldInfo("Drawdown type (trailing/static)", "enum"),
    "consistency_rule": FieldInfo("Consistency requirement", "percent"),
    "min_trading_days": FieldInfo("Minimum trading days", "days"),
    "time_limit": FieldInfo("Time limit", "days"),
    "payout_split": FieldInfo("Payout split", "percent"),
    "payout_frequency": FieldInfo("Payout frequency", "text"),
    "payout_conditions": FieldInfo("Payout conditions", "text"),
    "evaluation_fee": FieldInfo("Evaluation price (as displayed)", "money"),
    "activation_fee": FieldInfo("Activation fee (as displayed)", "money"),
    "max_allocation": FieldInfo("Maximum allocation", "money"),
    "other_restriction": FieldInfo("Other displayed restriction", "text"),
}


@dataclass
class RecordIdentity:
    """Who and what a row describes, exactly as displayed. Missing dimensions stay missing."""

    firm_name: str
    programme_name: str | None = None
    variant: str | None = None
    account_size_raw: str | None = None
    phase: Phase = Phase.UNSPECIFIED
    market: Market = Market.UNSPECIFIED
    publisher_entry_id: str | None = None
    entry_url: str | None = None
    first_party_url: str | None = None


@dataclass
class FieldObservation:
    field: str
    raw_label: str
    raw_value: str
    location: str
    publisher_qualifier: str | None = None


@dataclass
class ExtractedRecord:
    identity: RecordIdentity
    fields: list[FieldObservation] = field(default_factory=list)


@dataclass
class Extraction:
    page_kind: PageKind
    status: ExtractionStatus
    records: list[ExtractedRecord] = field(default_factory=list)
    detail: str | None = None
    warnings: list[str] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)  # (absolute URL, anchor) the adapter wants followed

    @property
    def observation_count(self) -> int:
        return sum(len(r.fields) for r in self.records)


#: What the operator sees for each per-page state (Build 29.25 card, section 4).
PAGE_STATE_LABELS: dict[str, str] = {
    "not_reviewed": "Not reviewed",
    "disabled_by_terms": "Disabled by terms",
    "robots_blocked": "Blocked by robots",
    "rate_limited": "Rate limited",
    "manual_capture": "Needs manual capture",
    "structure_changed": "Page structure changed",
    "no_records": "No public records available",
    "collected": "Collected — unverified",
    "unchanged": "Unchanged — unverified",
    "js_unavailable": "Needs JavaScript (manual capture)",
    "permissions_blocked": "Blocked by the site",
    "parse_error": "Could not read the page",
    "unsupported_page": "Stored, not structured",
    "failed": "Failed",
}
