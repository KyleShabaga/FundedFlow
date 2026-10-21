"""Envelope v1 (D5): versioned, deterministic, unverified source evidence for Build 31.

The models mirror `docs/contracts/collector-snapshot-v1.schema.json`; every export is validated against that
schema before it is written. There are no fields for rules, money, phases, programmes, prices or approvals.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from fundedflow_collector import __version__
from fundedflow_collector.db import registry
from fundedflow_collector.db.snapshots import observations
from fundedflow_collector.outcomes import CircuitState
from fundedflow_collector.parse.hashing import NORMALIZATION_VERSION
from fundedflow_collector.policy import robots
from fundedflow_collector.policy.urls import UrlRejected, host_of, resolve_link

SCHEMA_VERSION = 1
KIND = "fundedflow.collector.evidence"
NOTICE = "Unverified source evidence collected by FundedFlowCollector. Not rules and not verified provider data."


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Producer(_Model):
    name: Literal["fundedflow-collector"] = "fundedflow-collector"
    version: str
    normalization_version: str
    hash_algorithm: Literal["sha256"] = "sha256"


class HostOut(_Model):
    host: str
    role: str
    authorisation: Literal["operator_approved_first_party"] = "operator_approved_first_party"
    terms_decision: str | None
    terms_reviewed_at: str | None
    terms_url: str | None
    content_signals: list[str]
    circuit_state: str


class LatestAttempt(_Model):
    at: str
    outcome: str
    http_status: int | None
    reason: str | None


class SourceOut(_Model):
    source_id: str
    canonical_url: str
    kind: str
    source_channel: str
    enabled: bool
    latest_snapshot_id: str | None
    latest_attempt: LatestAttempt | None


class FirmOut(_Model):
    firm_key: str
    display_name: str
    homepage_url: str
    enabled: bool
    hosts: list[HostOut]
    sources: list[SourceOut]


class HeadingOut(_Model):
    level: int
    text: str
    offset: int | None


class TableOut(_Model):
    caption: str | None
    preceding_heading: str | None
    headers: list[str]
    rows: list[list[str]]


class LinkOut(_Model):
    href: str
    text: str
    scope: Literal["same_host", "authorised_host", "external", "unresolved"]


class Parser(_Model):
    name: str
    version: str


class StatedDates(_Model):
    published_at: None = None
    effective_at: None = None


class Observations(_Model):
    first_seen_at: str
    last_seen_at: str
    observation_count: int


class SnapshotOut(_Model):
    snapshot_id: str
    firm_key: str
    source_id: str
    requested_url: str
    final_url: str
    canonical_url: str
    redirect_chain: list[str]
    captured_at: str
    fetch_method: str
    source_channel: str
    http_status: int | None
    content_type: str
    title: str | None
    text: str
    headings: list[HeadingOut]
    tables: list[TableOut]
    links: list[LinkOut]
    content_hash: str
    raw_sha256: str | None
    parser: Parser
    normalization_version: str
    extraction_warnings: list[str]
    stated_dates: StatedDates = StatedDates()
    platform_metadata: dict[str, Any] | None
    observations: Observations


class AttemptOut(_Model):
    attempt_id: str
    run_id: str | None
    firm_key: str
    source_id: str | None
    requested_url: str
    final_url: str | None
    fetch_method: str
    started_at: str
    outcome: str
    http_status: int | None
    policy_reason: str | None
    error_detail: str | None
    snapshot_id: str | None


class Envelope(_Model):
    schema_version: Literal[1] = 1
    kind: Literal["fundedflow.collector.evidence"] = "fundedflow.collector.evidence"
    export_id: str
    generated_at: str
    verification_status: Literal["unverified"] = "unverified"
    notice: str = NOTICE
    producer: Producer
    firms: list[FirmOut]
    snapshots: list[SnapshotOut]
    attempts: list[AttemptOut]


def _scope(base: str, href: str, firm_hosts: set[str]) -> tuple[str, str]:
    try:
        absolute = resolve_link(base, href)
    except UrlRejected:
        return href, "unresolved"
    host = host_of(absolute)
    if host == host_of(base):
        return absolute, "same_host"
    if host in firm_hosts:
        return absolute, "authorised_host"
    return absolute, "external"


def build_envelope(
    conn: sqlite3.Connection,
    *,
    firm_keys: list[str] | None,
    generated_at: str,
    include_attempts: bool = False,
) -> Envelope:
    firms = (
        [registry.require_firm(conn, key) for key in sorted(set(firm_keys))] if firm_keys else registry.list_firms(conn)
    )
    circuits = {r["host"]: r["state"] for r in conn.execute("SELECT host, state FROM host_circuits")}
    firm_out: list[FirmOut] = []
    snapshot_out: list[SnapshotOut] = []
    attempt_out: list[AttemptOut] = []
    for firm in firms:
        hosts = registry.list_hosts(conn, firm.id)
        host_names = {h.host for h in hosts}
        hosts_out = [
            HostOut(
                host=h.host,
                role=h.role.value,
                terms_decision=h.terms_decision.value if h.terms_decision else None,
                terms_reviewed_at=h.terms_reviewed_at,
                terms_url=h.terms_url,
                content_signals=robots.latest_signals(conn, h.host),
                circuit_state=circuits.get(h.host, CircuitState.CLOSED.value),
            )
            for h in hosts
        ]
        sources_out = []
        for source in registry.list_sources(conn, firm.id):
            last = conn.execute(
                "SELECT started_at, outcome, http_status, policy_reason, error_detail FROM fetch_attempts"
                " WHERE source_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
                (source.id,),
            ).fetchone()
            latest = (
                None
                if last is None
                else LatestAttempt(
                    at=last["started_at"],
                    outcome=last["outcome"],
                    http_status=last["http_status"],
                    reason=last["policy_reason"] or last["error_detail"],
                )
            )
            sources_out.append(
                SourceOut(
                    source_id=source.id,
                    canonical_url=source.canonical_url,
                    kind=source.kind.value,
                    source_channel=source.source_channel.value,
                    enabled=source.enabled,
                    latest_snapshot_id=source.latest_snapshot_id,
                    latest_attempt=latest,
                )
            )
        firm_out.append(
            FirmOut(
                firm_key=firm.firm_key,
                display_name=firm.display_name,
                homepage_url=firm.homepage_url,
                enabled=firm.enabled,
                hosts=hosts_out,
                sources=sources_out,
            )
        )
        rows = conn.execute(
            "SELECT s.*, c.canonical_url FROM source_snapshots s JOIN collector_sources c ON c.id = s.source_id"
            " WHERE s.firm_id = ? ORDER BY c.canonical_url, s.captured_at, s.id",
            (firm.id,),
        )
        for row in rows:
            structure = json.loads(row["structure"])
            links = []
            for link in structure.get("links", []):
                href, scope = _scope(row["final_url"], link["href"], host_names)
                links.append(LinkOut(href=href[:2048], text=link["text"], scope=scope))  # type: ignore[arg-type]
            first, last_seen, count = observations(conn, row["id"])
            snapshot_out.append(
                SnapshotOut(
                    snapshot_id=row["id"],
                    firm_key=firm.firm_key,
                    source_id=row["source_id"],
                    requested_url=row["requested_url"],
                    final_url=row["final_url"],
                    canonical_url=row["canonical_url"],
                    redirect_chain=json.loads(row["redirect_chain"]),
                    captured_at=row["captured_at"],
                    fetch_method=row["fetch_method"],
                    source_channel=row["source_channel"],
                    http_status=row["http_status"],
                    content_type=row["content_type"],
                    title=row["title"],
                    text=row["text"],
                    headings=[HeadingOut(**h) for h in structure.get("headings", [])],
                    tables=[TableOut(**t) for t in structure.get("tables", [])],
                    links=links,
                    content_hash=row["content_hash"],
                    raw_sha256=row["raw_sha256"],
                    parser=Parser(name=row["parser_name"], version=row["parser_version"]),
                    normalization_version=row["normalization_version"],
                    extraction_warnings=json.loads(row["warnings"]),
                    platform_metadata=json.loads(row["platform_metadata"]) if row["platform_metadata"] else None,
                    observations=Observations(
                        first_seen_at=first or row["captured_at"],
                        last_seen_at=last_seen or row["captured_at"],
                        observation_count=max(count, 1),
                    ),
                )
            )
        if include_attempts:
            for row in conn.execute(
                "SELECT * FROM fetch_attempts WHERE firm_id = ? ORDER BY started_at, id",
                (firm.id,),
            ):
                attempt_out.append(
                    AttemptOut(
                        attempt_id=row["id"],
                        run_id=row["run_id"],
                        firm_key=firm.firm_key,
                        source_id=row["source_id"],
                        requested_url=row["requested_url"],
                        final_url=row["final_url"],
                        fetch_method=row["fetch_method"],
                        started_at=row["started_at"],
                        outcome=row["outcome"],
                        http_status=row["http_status"],
                        policy_reason=row["policy_reason"],
                        error_detail=row["error_detail"],
                        snapshot_id=row["snapshot_id"],
                    )
                )
    producer = Producer(version=__version__, normalization_version=NORMALIZATION_VERSION)
    body = {
        "producer": producer.model_dump(mode="json"),
        "firms": [f.model_dump(mode="json") for f in firm_out],
        "snapshots": [s.model_dump(mode="json") for s in snapshot_out],
        "attempts": [a.model_dump(mode="json") for a in attempt_out],
    }
    digest = hashlib.sha256(
        json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:32]
    return Envelope(
        export_id=f"exp_{digest}",
        generated_at=generated_at,
        producer=producer,
        firms=firm_out,
        snapshots=snapshot_out,
        attempts=attempt_out,
    )


def serialise(envelope: Envelope) -> bytes:
    """Deterministic bytes: sorted keys, UTF-8, two-space indent, LF line endings, trailing newline."""
    text = json.dumps(envelope.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, indent=2)
    return (text + "\n").encode("utf-8")
