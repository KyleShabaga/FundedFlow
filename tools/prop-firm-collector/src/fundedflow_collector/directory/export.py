"""`collector-directory-observations-v1`: the export of publisher observations, separate from Build 29's
`collector-snapshot-v1` (which is unchanged and never contains publisher data).

Deterministic: lists are sorted and `export_id` is a hash of the content, so the same database state gives the same
file apart from `generated_at`. Every field value carries its full provenance and `verification_status`, which is
`unverified` unless an operator recorded an official verification. Pages that could not be read are listed with
their status, so a partial collection is reported as such rather than hidden.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import Counter
from datetime import datetime
from typing import Any

from fundedflow_collector import __version__
from fundedflow_collector.clock import format_instant
from fundedflow_collector.db.registry import list_hosts, list_publishers
from fundedflow_collector.directory import review
from fundedflow_collector.directory.adapters import get_adapter
from fundedflow_collector.directory.model import ObservationStatus
from fundedflow_collector.outcomes import HostRole
from fundedflow_collector.policy import circuit

KIND = "fundedflow.collector.directory_observations"
SCHEMA_VERSION = 1
SCHEMA_NAME = "collector-directory-observations-v1"
NOTICE = (
    "Unverified third-party observations from prop-firm comparison publishers. They are not rules, not official "
    "firm data and not approved; publisher ratings, rankings and offers are excluded."
)


def build(
    conn: sqlite3.Connection,
    *,
    now: datetime,
    publisher_keys: list[str] | None = None,
    include_superseded: bool = False,
    stale_after_days: int = 30,
) -> dict[str, Any]:
    publishers = [p for p in list_publishers(conn) if publisher_keys is None or p.publisher_key in publisher_keys]
    wanted = {p.publisher_key for p in publishers}
    views = [
        v
        for v in review.load(conn, now=now, stale_after_days=stale_after_days, include_superseded=include_superseded)
        if v.row["publisher_key"] in wanted
    ]
    items = [
        i for i in review.review_items(views, conn, stale_after_days=stale_after_days) if set(i.publishers) & wanted
    ]
    records: dict[str, dict[str, Any]] = {}
    for view in views:
        row = view.row
        record = records.setdefault(
            row["record_key"],
            {
                "record_key": row["record_key"],
                "publisher_key": row["publisher_key"],
                "firm": {
                    "name": row["firm_name"],
                    "normalized": row["firm_norm"],
                    "mapped_firm_key": view.mapped_firm_key,
                    "mapping": view.mapping,
                },
                "programme": {"name": row["programme_name"], "normalized": row["programme_norm"]},
                "variant": {"name": row["variant"], "normalized": row["variant_norm"]},
                "account_size": {
                    "raw": row["account_size_raw"],
                    "amount": row["account_size"],
                    "currency": row["currency"],
                },
                "phase": row["phase"],
                "market": row["market"],
                "publisher_entry_id": row["publisher_entry_id"],
                "entry_url": row["entry_url"],
                "first_party_url": row["first_party_url"],
                "fields": [],
            },
        )
        record["fields"].append(
            {
                "observation_id": row["id"],
                "field": row["field"],
                "raw_label": row["raw_label"],
                "raw_value": row["raw_value"],
                "value_kind": row["value_kind"],
                "normalized": view.normalized_value,
                "confidence": row["confidence"],
                "uncertain_reason": row["uncertain_reason"],
                "publisher_qualifier": row["publisher_qualifier"],
                "status": view.status.value,
                "status_reasons": sorted(set(view.reasons)),
                "verification_status": "officially_verified"
                if view.status is ObservationStatus.OFFICIALLY_VERIFIED
                else "unverified",
                "provenance": {
                    "publisher_key": row["publisher_key"],
                    "page_url": row["page_url"],
                    "snapshot_id": row["snapshot_id"],
                    "content_hash": row["content_hash"],
                    "observed_at": row["observed_at"],
                    "adapter_name": row["adapter_name"],
                    "adapter_version": row["adapter_version"],
                    "capture_channel": row["capture_channel"],
                    "location": row["location"],
                },
            }
        )
    for record in records.values():
        record["fields"].sort(key=lambda f: (f["field"], f["provenance"]["observed_at"], f["observation_id"]))
    pages = _pages(conn, wanted)
    statuses = Counter(f["status"] for r in records.values() for f in r["fields"])
    document: dict[str, Any] = {
        "kind": KIND,
        "schema_version": SCHEMA_VERSION,
        "export_id": "",
        "generated_at": format_instant(now),
        "producer": {"name": "fundedflow-collector", "version": __version__, "hash_algorithm": "sha256"},
        "notice": NOTICE,
        "scope": {
            "publishers": sorted(wanted),
            "include_superseded": include_superseded,
            "stale_after_days": stale_after_days,
        },
        "publishers": [_publisher(conn, p, now) for p in publishers],
        "pages": pages,
        "records": sorted(records.values(), key=lambda r: (r["publisher_key"], r["firm"]["normalized"], r["record_key"])),
        "review_items": [
            {
                "key": i.key,
                "kind": i.kind,
                "title": i.title,
                "detail": i.detail,
                "observation_ids": sorted(i.observation_ids),
                "publishers": sorted(i.publishers),
                "dismissed": i.dismissed,
                "note": i.note,
            }
            for i in sorted(items, key=lambda i: i.key)
        ],
        "summary": {
            "records": len(records),
            "observations": sum(len(r["fields"]) for r in records.values()),
            "by_status": dict(sorted(statuses.items())),
            "pages_by_status": dict(sorted(Counter(p["extraction_status"] for p in pages).items())),
        },
    }
    document["export_id"] = "dexp_" + _content_hash(document)[:24]
    return document


def _content_hash(document: dict[str, Any]) -> str:
    stable = {k: v for k, v in document.items() if k not in ("export_id", "generated_at")}
    stable["publishers"] = [{k: v for k, v in p.items() if k != "state"} for p in stable["publishers"]]
    return hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _publisher(conn: sqlite3.Connection, publisher: Any, now: datetime) -> dict[str, Any]:
    status = review.publisher_status(conn, publisher, now)
    adapter = get_adapter(publisher.adapter)
    hosts = []
    for host in list_hosts(conn, publisher.id):
        if host.role is HostRole.ASSET:
            continue
        hosts.append(
            {
                "host": host.host,
                "authorisation": "operator_approved_publisher",
                "terms_decision": host.terms_decision.value if host.terms_decision else None,
                "terms_reviewed_at": host.terms_reviewed_at,
                "terms_url": host.terms_url,
                "circuit_state": circuit.current(conn, host.host, now, persist=False).state.value,
            }
        )
    review_record = publisher.policy_review or {}
    return {
        "publisher_key": publisher.publisher_key,
        "display_name": publisher.display_name,
        "homepage_url": publisher.homepage_url,
        "role": "third_party_comparison_publisher",
        "adapter": adapter.name,
        "adapter_version": adapter.version,
        "capture_mode": publisher.capture_mode,
        "enabled": publisher.enabled,
        "state": status.state,
        "hosts": hosts,
        "policy_review": {
            k: review_record.get(k) for k in ("reviewed_on", "suggested_decision", "summary", "robots_url", "terms_url")
        },
        "last_checked_at": status.last_checked,
        "last_change_at": status.last_change,
    }


def _pages(conn: sqlite3.Connection, wanted: set[str]) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT p.publisher_key, s.canonical_url, s.last_outcome, s.last_attempt_at, s.latest_snapshot_id,"
        " e.page_kind, e.status, e.detail, e.record_count, e.warnings, e.adapter_version, n.content_hash,"
        " n.captured_at FROM collector_sources s JOIN directory_publishers p ON p.id = s.firm_id"
        " LEFT JOIN source_snapshots n ON n.id = s.latest_snapshot_id"
        " LEFT JOIN directory_extractions e ON e.id = (SELECT e2.id FROM directory_extractions e2"
        "  WHERE e2.snapshot_id = s.latest_snapshot_id ORDER BY e2.extracted_at DESC LIMIT 1)"
        " ORDER BY p.publisher_key, s.canonical_url"
    )
    pages = []
    for row in rows:
        if row["publisher_key"] not in wanted:
            continue
        pages.append(
            {
                "publisher_key": row["publisher_key"],
                "url": row["canonical_url"],
                "page_kind": row["page_kind"],
                "extraction_status": row["status"] or "not_read",
                "page_state": review.page_state(row["last_outcome"], row["status"]),
                "detail": row["detail"],
                "last_outcome": row["last_outcome"],
                "last_attempt_at": row["last_attempt_at"],
                "snapshot_id": row["latest_snapshot_id"],
                "content_hash": row["content_hash"],
                "captured_at": row["captured_at"],
                "adapter_version": row["adapter_version"],
                "record_count": int(row["record_count"] or 0),
                "warnings": json.loads(row["warnings"]) if row["warnings"] else [],
            }
        )
    return pages


def serialise(document: dict[str, Any]) -> bytes:
    return (json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
