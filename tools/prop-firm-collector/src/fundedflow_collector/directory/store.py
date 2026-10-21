"""Turning a stored publisher page version into immutable, field-level observations (one transaction per page).

Called by the runner right after a snapshot is stored, and by manual capture import. A page version is read once
per adapter version: fetching an unchanged page again adds an attempt row, never duplicate observations.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime

from fundedflow_collector.clock import format_instant
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.registry import Publisher, Source
from fundedflow_collector.directory import identity
from fundedflow_collector.directory.adapters import get_adapter
from fundedflow_collector.directory.model import Confidence, ExtractionStatus
from fundedflow_collector.directory.values import parse_size, parse_value


@dataclass
class StoredExtraction:
    extraction_id: str
    page_kind: str
    status: str
    record_count: int
    observation_count: int
    detail: str | None
    warnings: list[str] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)
    already_read: bool = False

    def describe(self) -> str:
        if self.status == ExtractionStatus.COLLECTED.value:
            text = f"{self.record_count} records, {self.observation_count} values"
        else:
            text = self.status + (f": {self.detail}" if self.detail else "")
        return f"{self.page_kind}, {text}" + (" (already read)" if self.already_read else "")


def existing_extraction(
    conn: sqlite3.Connection, snapshot_id: str, adapter: str, version: str
) -> StoredExtraction | None:
    row = conn.execute(
        "SELECT e.*, (SELECT COUNT(*) FROM directory_observations o WHERE o.extraction_id = e.id) AS n"
        " FROM directory_extractions e WHERE snapshot_id = ? AND adapter_name = ? AND adapter_version = ?",
        (snapshot_id, adapter, version),
    ).fetchone()
    if row is None:
        return None
    return StoredExtraction(
        extraction_id=row["id"],
        page_kind=row["page_kind"],
        status=row["status"],
        record_count=int(row["record_count"]),
        observation_count=int(row["n"]),
        detail=row["detail"],
        warnings=list(json.loads(row["warnings"])),
        already_read=True,
    )


def extract_and_store(
    conn: sqlite3.Connection,
    *,
    publisher: Publisher,
    source: Source,
    snapshot_id: str,
    attempt_id: str,
    html: bytes,
    page_url: str,
    capture_channel: str,
    observed_at: str,
    now: datetime,
) -> StoredExtraction:
    adapter = get_adapter(publisher.adapter)
    extraction = adapter.extract(html, page_url)
    found = existing_extraction(conn, snapshot_id, adapter.name, adapter.version)
    if found is not None:
        found.links = extraction.links
        return found
    snapshot = conn.execute("SELECT content_hash FROM source_snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if snapshot is None:
        raise ValueError(f"unknown snapshot {snapshot_id}")
    content_hash = str(snapshot["content_hash"])
    ext_id = identity.extraction_id(snapshot_id, adapter.name, adapter.version)
    rows: list[tuple[object, ...]] = []
    seen: set[str] = set()
    for record in extraction.records:
        ident = record.identity
        firm_name = ident.firm_name.strip()[:200]
        firm_norm = identity.norm_firm(firm_name)
        programme_norm = identity.norm_programme(ident.programme_name, firm_norm)
        variant_norm = identity.norm_variant(ident.variant)
        size, currency = parse_size(ident.account_size_raw)
        key = identity.record_key(
            publisher.publisher_key,
            firm_norm,
            programme_norm,
            variant_norm,
            size,
            currency,
            ident.account_size_raw,
            ident.phase.value,
        )
        for obs in record.fields:
            parsed = parse_value(obs.field, obs.raw_value)
            confidence, reason = parsed.confidence, parsed.uncertain_reason
            if ident.account_size_raw and size is None and confidence is Confidence.OBSERVED:
                confidence, reason = Confidence.UNCERTAIN, "account size shown as a range or in an unknown format"
            obs_id = identity.observation_id(ext_id, key, obs.field, obs.location)
            if obs_id in seen:
                continue
            seen.add(obs_id)
            rows.append(
                (
                    obs_id,
                    ext_id,
                    publisher.id,
                    source.id,
                    snapshot_id,
                    key,
                    ident.publisher_entry_id,
                    ident.entry_url,
                    firm_name,
                    firm_norm,
                    ident.programme_name,
                    programme_norm,
                    ident.variant,
                    variant_norm,
                    ident.account_size_raw,
                    size,
                    currency,
                    ident.phase.value,
                    ident.market.value,
                    ident.first_party_url,
                    obs.field,
                    obs.raw_label[:200],
                    obs.raw_value[:1000],
                    parsed.kind.value,
                    json.dumps(parsed.normalized, sort_keys=True) if parsed.normalized is not None else None,
                    confidence.value,
                    reason,
                    obs.publisher_qualifier,
                    obs.location[:300],
                    page_url,
                    observed_at,
                    content_hash,
                    adapter.name,
                    adapter.version,
                    capture_channel,
                )
            )
    with transaction(conn):
        conn.execute(
            "INSERT INTO directory_extractions (id, publisher_id, source_id, snapshot_id, attempt_id, adapter_name,"
            " adapter_version, page_kind, status, detail, record_count, warnings, extracted_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                ext_id,
                publisher.id,
                source.id,
                snapshot_id,
                attempt_id,
                adapter.name,
                adapter.version,
                extraction.page_kind.value,
                extraction.status.value,
                extraction.detail,
                len(extraction.records),
                json.dumps(extraction.warnings),
                format_instant(now),
            ),
        )
        conn.executemany(
            "INSERT INTO directory_observations (id, extraction_id, publisher_id, source_id, snapshot_id, record_key,"
            " publisher_entry_id, entry_url, firm_name, firm_norm, programme_name, programme_norm, variant,"
            " variant_norm, account_size_raw, account_size, currency, phase, market, first_party_url, field,"
            " raw_label, raw_value, value_kind, normalized, confidence, uncertain_reason, publisher_qualifier,"
            " location, page_url, observed_at, content_hash, adapter_name, adapter_version, capture_channel)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,"
            " ?, ?, ?)",
            rows,
        )
    return StoredExtraction(
        extraction_id=ext_id,
        page_kind=extraction.page_kind.value,
        status=extraction.status.value,
        record_count=len(extraction.records),
        observation_count=len(rows),
        detail=extraction.detail,
        warnings=extraction.warnings,
        links=extraction.links,
    )


def latest_extraction_for_source(conn: sqlite3.Connection, source_id: str) -> sqlite3.Row | None:
    return conn.execute(  # type: ignore[no-any-return]
        "SELECT e.* FROM directory_extractions e JOIN collector_sources s ON s.id = e.source_id"
        " WHERE e.source_id = ? AND e.snapshot_id = s.latest_snapshot_id ORDER BY e.extracted_at DESC LIMIT 1",
        (source_id,),
    ).fetchone()
