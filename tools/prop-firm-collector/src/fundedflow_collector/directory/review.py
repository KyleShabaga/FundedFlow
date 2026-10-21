"""Reading observations back with their review status, review items, history and official evidence.

Statuses are worked out when read, from immutable rows plus the operator's append-only review actions:

* `superseded` - the page has a newer version (or a newer adapter read it); kept for history.
* `officially_verified` - only after an operator records a `verify_official` action that points at a stored snapshot
  of the firm's *own* site. Agreement between publishers never verifies anything.
* `conflicting` - current observations that describe the same firm, programme, variant, size, currency, phase and
  field disagree (across publishers, or two pages of one publisher).
* `uncertain` - the value or the firm's identity is uncertain.
* `stale` - the page has not been fetched or captured successfully for `stale_after_days`.
* `observed` - none of the above. Still an unverified third-party claim.

Nothing here picks a winner, edits an observation, or touches a firm rule or the FundedFlow app.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from fundedflow_collector import ids
from fundedflow_collector.clock import format_instant, parse_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.registry import Publisher, RegistryError, get_firm, list_firms, list_hosts
from fundedflow_collector.directory import identity
from fundedflow_collector.directory.model import FIELDS, PAGE_STATE_LABELS, ObservationStatus, ValueKind
from fundedflow_collector.outcomes import HostRole, Outcome
from fundedflow_collector.policy import circuit
from fundedflow_collector.policy.terms import terms_block_reason

ACTIONS = ("map_firm", "unmap_firm", "keep_separate", "annotate", "dismiss", "verify_official", "unverify")
SUBJECTS = ("firm_name", "record", "observation", "review_item")
BLOCKED_OUTCOMES = {
    Outcome.ACCESS_DENIED.value: "permissions_blocked",
    Outcome.BLOCKED_BOT_PROTECTION.value: "permissions_blocked",
    Outcome.RATE_LIMITED.value: "rate_limited",
    Outcome.ROBOTS_BLOCKED.value: "robots_blocked",
    Outcome.TERMS_BLOCKED.value: "disabled_by_terms",
}
FIELD_KEYWORDS: dict[str, tuple[str, ...]] = {
    "profit_target": ("profit target",),
    "max_drawdown": ("drawdown", "max loss", "maximum loss"),
    "daily_loss_limit": ("daily loss",),
    "drawdown_type": ("trailing", "static drawdown", "end of day", "end-of-day"),
    "consistency_rule": ("consistency",),
    "min_trading_days": ("trading days", "minimum days"),
    "time_limit": ("time limit",),
    "payout_split": ("profit split", "split", "profit share"),
    "payout_frequency": ("payout",),
    "payout_conditions": ("payout",),
    "evaluation_fee": ("price", "fee"),
    "activation_fee": ("activation",),
    "max_allocation": ("allocation",),
    "other_restriction": ("rule",),
}


@dataclass
class ObservationView:
    row: dict[str, Any]
    current: bool
    identity: str  # canonical collector firm key, or "name:<normalised name>" when not mapped
    mapping: str  # operator | exact_name | none
    mapped_firm_key: str | None
    comparison_key: str
    status: ObservationStatus = ObservationStatus.OBSERVED
    reasons: list[str] = field(default_factory=list)
    verified_by: str | None = None

    @property
    def normalized_value(self) -> dict[str, Any] | None:
        raw = self.row["normalized"]
        return json.loads(raw) if raw else None

    @property
    def signature(self) -> str | None:
        """What this observation claims, for comparison. Unknown and raw-only values claim nothing comparable."""
        kind = self.row["value_kind"]
        if kind == ValueKind.UNKNOWN.value:
            return None
        if kind != ValueKind.VALUE.value:
            return str(kind)
        value = self.normalized_value
        if value is None:
            return None
        # A drawdown's basis is compared through the drawdown_type field; "up to" does not change the amount.
        value = {k: v for k, v in value.items() if k not in ("qualifier", "basis")}
        return json.dumps(value, sort_keys=True)

    def display_value(self) -> str:
        return display(self.row["value_kind"], self.normalized_value, self.row["raw_value"])

    def age_days(self, now: datetime) -> float | None:
        checked = self.row.get("last_success_at") or self.row["observed_at"]
        return (now - parse_instant(checked)).total_seconds() / 86400 if checked else None


@dataclass
class ReviewItem:
    key: str
    kind: str  # conflict | duplicate | uncertain_identity | stale
    title: str
    detail: str
    observation_ids: list[str]
    publishers: list[str]
    dismissed: bool = False
    note: str | None = None


@dataclass
class HistoryPoint:
    observed_at: str
    value: str
    value_kind: str
    changed: bool
    snapshot_id: str
    page_url: str
    current: bool
    last_seen: str | None


@dataclass
class OfficialExcerpt:
    snapshot_id: str
    url: str
    captured_at: str
    excerpt: str


@dataclass
class PublisherStatus:
    publisher: Publisher
    state: str
    label: str
    detail: str
    last_checked: str | None
    last_change: str | None
    pages: int
    current_observations: int
    terms: str
    circuit: str


def money_text(amount: str, currency: object) -> str:
    whole, _, cents = amount.partition(".")
    grouped = f"{int(whole):,}" + (f".{cents}" if cents else "")
    if currency is None:
        return f"{grouped} (no currency shown)"
    mark = str(currency)
    return f"{mark}{grouped}" if mark == "$" else f"{grouped} {mark}"


def display(kind: str, value: dict[str, Any] | None, raw: str) -> str:
    if kind != ValueKind.VALUE.value:
        return {"unknown": "— (not shown)", "none": "none", "not_applicable": "n/a", "see_rules": "see rules"}[kind]
    if value is None:
        return raw
    prefix = {"up_to": "up to ", "at_least": "at least "}.get(str(value.get("qualifier")), "")
    basis = f" ({str(value['basis']).replace('_', ' ')})" if value.get("basis") else ""
    kind_of = value.get("type")
    if kind_of == "percent":
        return f"{prefix}{value['value']}%{basis}"
    if kind_of == "money":
        return f"{prefix}{money_text(str(value['amount']), value.get('currency'))}{basis}"
    if kind_of == "days":
        return f"{prefix}{value['value']} days"
    if kind_of == "drawdown_type":
        return str(value["value"]).replace("_", " ")
    return str(value.get("value", raw))


# ---------------------------------------------------------------- operator actions


def latest_actions(conn: sqlite3.Connection, subject_type: str) -> dict[str, sqlite3.Row]:
    rows = conn.execute(
        "SELECT * FROM directory_review_actions WHERE subject_type = ? ORDER BY at, rowid", (subject_type,)
    )
    latest: dict[str, sqlite3.Row] = {}
    for row in rows:
        latest[str(row["subject_key"])] = row
    return latest


def record_action(
    conn: sqlite3.Connection,
    *,
    action: str,
    subject_type: str,
    subject_key: str,
    now: datetime,
    note: str | None = None,
    firm_key: str | None = None,
    official_snapshot_id: str | None = None,
) -> str:
    """Append one review action. It changes how observations are grouped or labelled, never the observations."""
    if action not in ACTIONS or subject_type not in SUBJECTS:
        raise RegistryError(f"unknown review action {action!r} on {subject_type!r}")
    note = (note or "").strip() or None
    if action == "map_firm" and (not firm_key or get_firm(conn, firm_key) is None):
        raise RegistryError(f"map to an existing firm key (see `collector firm list`), not {firm_key!r}")
    if action in ("annotate", "dismiss") and not note:
        raise RegistryError("a note is required")
    if action == "verify_official":
        if not note or len(note) < 3:
            raise RegistryError("say what you checked on the official page (a short note)")
        row = conn.execute(
            "SELECT s.id, o.kind FROM source_snapshots s JOIN collection_owners o ON o.id = s.firm_id WHERE s.id = ?",
            (official_snapshot_id,),
        ).fetchone()
        if row is None:
            raise RegistryError(f"unknown snapshot {official_snapshot_id!r}")
        if row["kind"] != "firm":
            raise RegistryError("official verification needs a snapshot of the firm's own site, not a publisher page")
    action_id = ids.new_id("drev")
    with transaction(conn):
        conn.execute(
            "INSERT INTO directory_review_actions (id, at, action, subject_type, subject_key, firm_key,"
            " official_snapshot_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (action_id, format_instant(now), action, subject_type, subject_key, firm_key, official_snapshot_id, note),
        )
    return action_id


def firm_name_subject(publisher_key: str, firm_norm: str) -> str:
    return f"{publisher_key}|{firm_norm}"


def pair_subject(a: str, b: str) -> str:
    first, second = sorted((a, b))
    return f"pair|{first}|{second}"


# ---------------------------------------------------------------- loading and status


_SELECT = (
    "SELECT o.*, p.publisher_key, p.display_name AS publisher_name, s.last_success_at, s.latest_snapshot_id,"
    " (o.snapshot_id = s.latest_snapshot_id AND e.extracted_at = (SELECT MAX(e2.extracted_at)"
    " FROM directory_extractions e2 WHERE e2.snapshot_id = o.snapshot_id)) AS is_current"
    " FROM directory_observations o JOIN directory_publishers p ON p.id = o.publisher_id"
    " JOIN collector_sources s ON s.id = o.source_id JOIN directory_extractions e ON e.id = o.extraction_id"
)


def _firm_index(conn: sqlite3.Connection) -> dict[str, list[str]]:
    index: dict[str, list[str]] = defaultdict(list)
    for firm in list_firms(conn):
        for name in {identity.norm_firm(firm.display_name), identity.norm_firm(firm.firm_key.replace("-", " "))}:
            if firm.firm_key not in index[name]:
                index[name].append(firm.firm_key)
    return index


def load(
    conn: sqlite3.Connection,
    *,
    now: datetime,
    stale_after_days: int = 30,
    publisher_key: str | None = None,
    include_superseded: bool = False,
) -> list[ObservationView]:
    """Every observation (current ones, plus superseded ones when asked) with its identity and review status."""
    sql = _SELECT + (" WHERE p.publisher_key = ?" if publisher_key else "") + " ORDER BY o.observed_at, o.id"
    rows = [dict(r) for r in conn.execute(sql, (publisher_key,) if publisher_key else ())]
    firms = _firm_index(conn)
    names = latest_actions(conn, "firm_name")
    verifications = latest_actions(conn, "observation")
    views: list[ObservationView] = []
    for row in rows:
        current = bool(row["is_current"])
        if not current and not include_superseded:
            continue
        action = names.get(firm_name_subject(row["publisher_key"], row["firm_norm"]))
        candidates = firms.get(row["firm_norm"], [])
        if action is not None and action["action"] == "map_firm":
            mapped, mapping = str(action["firm_key"]), "operator"
        elif action is not None and action["action"] == "unmap_firm":
            mapped, mapping = None, "none"
        elif len(candidates) == 1:
            mapped, mapping = candidates[0], "exact_name"
        else:
            mapped, mapping = None, "none"
        ident = mapped or f"name:{row['firm_norm']}"
        view = ObservationView(
            row=row,
            current=current,
            identity=ident,
            mapping=mapping,
            mapped_firm_key=mapped,
            comparison_key=identity.comparison_key(
                ident, row["programme_norm"], row["variant_norm"], row["account_size"], row["currency"], row["phase"]
            ),
        )
        if len(candidates) > 1 and mapping == "none":
            view.reasons.append(f"name matches several registered firms: {', '.join(candidates)}")
        verification = verifications.get(row["id"])
        if verification is not None and verification["action"] == "verify_official":
            view.verified_by = str(verification["id"])
        views.append(view)
    _assign_statuses(views, now, stale_after_days, latest_actions(conn, "review_item"))
    return views


def _assign_statuses(
    views: list[ObservationView], now: datetime, stale_after_days: int, items: dict[str, sqlite3.Row]
) -> None:
    current = [v for v in views if v.current]
    groups: dict[tuple[str, str], list[ObservationView]] = defaultdict(list)
    for view in current:
        groups[(view.comparison_key, view.row["field"])].append(view)
    for members in groups.values():
        claims = distinct_claims(members)
        if len(claims) > 1:
            for view in members:
                if view.signature is not None:
                    view.reasons.append("disagrees with another observation of the same programme and field")
                    view.status = ObservationStatus.CONFLICTING
    uncertain_names = _uncertain_names(current, items)
    cutoff = now - timedelta(days=stale_after_days)
    for view in views:
        if not view.current:
            view.status = ObservationStatus.SUPERSEDED
            continue
        if view.verified_by is not None:
            view.status = ObservationStatus.OFFICIALLY_VERIFIED
            continue
        if view.status is ObservationStatus.CONFLICTING:
            continue
        if view.row["confidence"] == "uncertain":
            view.reasons.append(str(view.row["uncertain_reason"]))
            view.status = ObservationStatus.UNCERTAIN
        elif view.mapping == "none" and view.row["firm_norm"] in uncertain_names:
            view.reasons.append("firm name is similar to another firm's; confirm whether they are the same firm")
            view.status = ObservationStatus.UNCERTAIN
        elif any("several registered firms" in r for r in view.reasons):
            view.status = ObservationStatus.UNCERTAIN
        checked = view.row.get("last_success_at") or view.row["observed_at"]
        if view.status is ObservationStatus.OBSERVED and checked and parse_instant(checked) < cutoff:
            view.reasons.append(f"page not checked for more than {stale_after_days} days")
            view.status = ObservationStatus.STALE


def distinct_claims(members: list[ObservationView]) -> set[str]:
    """The different things a group of observations claims. A plain "trailing" drawdown type is less specific than
    "trailing (end of day)", not a contradiction of it, so it is dropped when a more specific trailing type is there."""
    claims = {v.signature for v in members if v.signature is not None}
    general = json.dumps({"type": "drawdown_type", "value": "trailing"}, sort_keys=True)
    if general in claims and any('"trailing_' in c for c in claims):
        claims.discard(general)
    return claims


def _uncertain_names(current: list[ObservationView], items: dict[str, sqlite3.Row]) -> set[str]:
    names = sorted({v.row["firm_norm"] for v in current if v.mapping == "none"})
    flagged: set[str] = set()
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            if identity.similar(a, b):
                resolved = items.get(pair_subject(a, b))
                if resolved is None or resolved["action"] not in ("keep_separate", "dismiss"):
                    flagged.update((a, b))
    return flagged


# ---------------------------------------------------------------- review queue


def review_items(
    views: list[ObservationView], conn: sqlite3.Connection, *, stale_after_days: int = 30
) -> list[ReviewItem]:
    """Conflicts, duplicates, uncertain identities and stale pages, each with a stable key for review actions."""
    actions = latest_actions(conn, "review_item")
    current = [v for v in views if v.current]
    items: list[ReviewItem] = []
    groups: dict[tuple[str, str], list[ObservationView]] = defaultdict(list)
    for view in current:
        groups[(view.comparison_key, view.row["field"])].append(view)
    for (cmp_key, field_name), members in sorted(groups.items()):
        first = members[0]
        what = _describe(first, field_name)
        claims = distinct_claims(members)
        publishers = sorted({v.row["publisher_key"] for v in members})
        if len(claims) > 1:
            values = "; ".join(sorted({f"{v.row['publisher_key']}: {v.display_value()}" for v in members}))
            items.append(
                ReviewItem(
                    f"conflict|{cmp_key}|{field_name}",
                    "conflict",
                    f"Conflicting {FIELDS[field_name].label.lower()}: {what}",
                    values,
                    [v.row["id"] for v in members],
                    publishers,
                )
            )
            continue
        by_publisher: dict[str, list[ObservationView]] = defaultdict(list)
        for view in members:
            by_publisher[view.row["publisher_key"]].append(view)
        for publisher_key, same in sorted(by_publisher.items()):
            pages = sorted({v.row["page_url"] for v in same})
            if len(same) > 1:
                items.append(
                    ReviewItem(
                        f"duplicate|{publisher_key}|{cmp_key}|{field_name}",
                        "duplicate",
                        f"{FIELDS[field_name].label} shown {len(same)} times by {publisher_key}: {what}",
                        "Same value on: " + ", ".join(pages),
                        [v.row["id"] for v in same],
                        [publisher_key],
                    )
                )
    names: dict[str, set[str]] = defaultdict(set)
    for view in current:
        if view.mapping == "none":
            names[view.row["firm_norm"]].add(view.row["publisher_key"])
    ordered = sorted(names)
    for i, a in enumerate(ordered):
        for b in ordered[i + 1 :]:
            if identity.similar(a, b):
                key = pair_subject(a, b)
                ids_ = [v.row["id"] for v in current if v.row["firm_norm"] in (a, b)]
                items.append(
                    ReviewItem(
                        key,
                        "uncertain_identity",
                        f"Same firm? '{a}' and '{b}'",
                        "Map each name to a registered firm, or mark them as separate firms.",
                        ids_,
                        sorted(names[a] | names[b]),
                    )
                )
    stale: dict[str, list[ObservationView]] = defaultdict(list)
    for view in current:
        if view.status is ObservationStatus.STALE:
            stale[view.row["page_url"]].append(view)
    for page, members in sorted(stale.items()):
        items.append(
            ReviewItem(
                f"stale|{members[0].row['source_id']}",
                "stale",
                f"Not checked for more than {stale_after_days} days: {page}",
                f"{len(members)} values last confirmed {members[0].row.get('last_success_at') or '-'}",
                [v.row["id"] for v in members],
                [members[0].row["publisher_key"]],
            )
        )
    for item in items:
        action = actions.get(item.key)
        if action is not None:
            item.note = action["note"]
            item.dismissed = action["action"] in ("dismiss", "keep_separate")
    return items


def _describe(view: ObservationView, field_name: str) -> str:
    parts = [view.row["firm_name"]]
    if view.row["programme_name"]:
        parts.append(str(view.row["programme_name"]))
    if view.row["variant"]:
        parts.append(str(view.row["variant"]))
    if view.row["account_size_raw"]:
        parts.append(str(view.row["account_size_raw"]))
    if view.row["phase"] != "unspecified":
        parts.append(str(view.row["phase"]).replace("_", " "))
    return " / ".join(parts)


# ---------------------------------------------------------------- history and official evidence


def field_history(conn: sqlite3.Connection, record_key: str, field_name: str) -> list[HistoryPoint]:
    """Every page version that showed this record's field, oldest first, marking where the value changed."""
    rows = conn.execute(
        _SELECT + " WHERE o.record_key = ? AND o.field = ? ORDER BY o.observed_at, o.id", (record_key, field_name)
    ).fetchall()
    points: list[HistoryPoint] = []
    previous: str | None = None
    for row in rows:
        value = display(
            row["value_kind"], json.loads(row["normalized"]) if row["normalized"] else None, row["raw_value"]
        )
        last = conn.execute(
            "SELECT MAX(started_at) FROM fetch_attempts WHERE snapshot_id = ?", (row["snapshot_id"],)
        ).fetchone()[0]
        points.append(
            HistoryPoint(
                observed_at=row["observed_at"],
                value=value,
                value_kind=row["value_kind"],
                changed=previous is not None and value != previous,
                snapshot_id=row["snapshot_id"],
                page_url=row["page_url"],
                current=bool(row["is_current"]),
                last_seen=last,
            )
        )
        previous = value
    return points


def official_evidence(
    conn: sqlite3.Connection, firm_key: str, field_name: str, limit: int = 5
) -> list[OfficialExcerpt]:
    """Dated excerpts from the firm's own stored pages that mention the field, to read next to a publisher claim.
    The collector does not decide which is right."""
    firm = get_firm(conn, firm_key)
    if firm is None:
        return []
    keywords = FIELD_KEYWORDS.get(field_name, ())
    found: list[OfficialExcerpt] = []
    rows = conn.execute(
        "SELECT s.id, s.final_url, s.captured_at, s.text FROM source_snapshots s JOIN collector_sources c"
        " ON c.latest_snapshot_id = s.id WHERE s.firm_id = ? ORDER BY s.captured_at DESC",
        (firm.id,),
    )
    for row in rows:
        text = str(row["text"])
        lowered = text.lower()
        for keyword in keywords:
            at = lowered.find(keyword)
            if at >= 0:
                start, end = max(0, at - 160), min(len(text), at + 200)
                excerpt = ("…" if start else "") + " ".join(text[start:end].split()) + ("…" if end < len(text) else "")
                found.append(OfficialExcerpt(row["id"], row["final_url"], row["captured_at"], excerpt))
                break
        if len(found) >= limit:
            break
    return found


# ---------------------------------------------------------------- publisher and page states


def page_state(last_outcome: str | None, extraction_status: str | None) -> str:
    """One of PAGE_STATE_LABELS' keys for a publisher page, from its last attempt and its latest reading."""
    if last_outcome in BLOCKED_OUTCOMES:
        return BLOCKED_OUTCOMES[last_outcome]
    if last_outcome in (Outcome.CIRCUIT_OPEN.value,):
        return "permissions_blocked"
    if extraction_status in ("structure_changed", "js_unavailable", "no_records", "parse_error", "unsupported_page"):
        return str(extraction_status)
    if last_outcome == Outcome.UNCHANGED.value:
        return "unchanged"
    if extraction_status == "collected":
        return "collected"
    if last_outcome is None:
        return "never_collected"
    return "failed"


STATE_LABELS = {**PAGE_STATE_LABELS, "disabled": "Disabled", "never_collected": "Not collected yet"}


def publisher_status(conn: sqlite3.Connection, publisher: Publisher, now: datetime) -> PublisherStatus:
    hosts = [h for h in list_hosts(conn, publisher.id) if h.role is not HostRole.ASSET]
    terms_parts, circuit_parts = [], []
    not_reviewed, terms_blocked, circuit_state = False, False, None
    for host in hosts:
        decision = host.terms_decision.value if host.terms_decision else "not reviewed"
        reason = terms_block_reason(host, now)
        terms_parts.append(f"{host.host}: {decision}")
        not_reviewed |= host.terms_decision is None
        terms_blocked |= host.terms_decision is not None and reason is not None
        host_circuit = circuit.current(conn, host.host, now, persist=False)
        circuit_parts.append(f"{host.host}: {host_circuit.state.value}")
        if host_circuit.open:
            circuit_state = host_circuit.state.value
    sources = conn.execute(
        "SELECT s.id, s.last_attempt_at, s.last_outcome, s.latest_snapshot_id,"
        " (SELECT e.status FROM directory_extractions e WHERE e.snapshot_id = s.latest_snapshot_id"
        "  ORDER BY e.extracted_at DESC LIMIT 1) AS extraction"
        " FROM collector_sources s WHERE s.firm_id = ?",
        (publisher.id,),
    ).fetchall()
    last_checked = max((r["last_attempt_at"] for r in sources if r["last_attempt_at"]), default=None)
    change = conn.execute(
        "SELECT MAX(s.captured_at) FROM source_snapshots s WHERE s.firm_id = ? AND EXISTS (SELECT 1 FROM"
        " source_snapshots t WHERE t.source_id = s.source_id AND t.captured_at < s.captured_at)",
        (publisher.id,),
    ).fetchone()[0]
    first = conn.execute("SELECT MIN(captured_at) FROM source_snapshots WHERE firm_id = ?", (publisher.id,)).fetchone()[
        0
    ]
    current = conn.execute(
        "SELECT COUNT(*) FROM directory_observations o JOIN collector_sources s ON s.id = o.source_id"
        " AND s.latest_snapshot_id = o.snapshot_id WHERE o.publisher_id = ?",
        (publisher.id,),
    ).fetchone()[0]
    states = [page_state(r["last_outcome"], r["extraction"]) for r in sources]
    if publisher.capture_mode == "manual_only":
        state, detail = "manual_capture", "automated access is not used for this publisher"
    elif not_reviewed:
        state, detail = "not_reviewed", "record a terms review for each host"
    elif terms_blocked:
        state, detail = "disabled_by_terms", "; ".join(terms_parts)
    elif circuit_state == "rate_limited":
        state, detail = "rate_limited", "the site asked the collector to slow down; it cools down by itself"
    elif circuit_state is not None:
        state, detail = "permissions_blocked", "the site refused access; re-enable only with the site's agreement"
    elif not publisher.enabled:
        state, detail = "disabled", publisher.disabled_reason or ""
    else:
        state = next(
            (
                s
                for s in ("robots_blocked", "structure_changed", "js_unavailable", "permissions_blocked")
                if s in states
            ),
            None,
        ) or next((s for s in ("collected", "unchanged", "no_records") if s in states), "never_collected")
        detail = ""
    if state in ("manual_capture", "disabled", "not_reviewed") and any(s == "collected" for s in states):
        detail = (detail + "; " if detail else "") + "has captured pages"
    return PublisherStatus(
        publisher=publisher,
        state=state,
        label=STATE_LABELS[state],
        detail=detail,
        last_checked=last_checked,
        last_change=change or first,
        pages=len(sources),
        current_observations=int(current),
        terms="; ".join(terms_parts) or "no hosts",
        circuit="; ".join(circuit_parts) or "-",
    )
