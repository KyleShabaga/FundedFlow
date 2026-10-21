"""D7 manual capture import: a page the operator saved in a browser, stored with zero network access.

It goes through the same normalisation, hashing, deduplication and export path as a live fetch, with
`fetch_method = manual_capture`. This works for every firm, including blocked or terms-prohibited ones, and for
every comparison publisher (Build 29.25): a publisher capture is also read by the publisher's adapter into
directory observations, still with no network access.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from fundedflow_collector.clock import Clock, format_instant, parse_instant
from fundedflow_collector.config import Settings
from fundedflow_collector.db import registry
from fundedflow_collector.db.connection import transaction
from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.db.runs import AttemptRecord
from fundedflow_collector.db.snapshots import EvidenceInput, store_evidence
from fundedflow_collector.directory.store import extract_and_store
from fundedflow_collector.outcomes import FetchMethod, HostRole, Outcome, SourceChannel, SourceKind
from fundedflow_collector.parse.document import ParsedDocument
from fundedflow_collector.parse.hashing import sha256_bytes
from fundedflow_collector.parse.html import parse_html
from fundedflow_collector.parse.pdf import parse_pdf
from fundedflow_collector.parse.text import parse_text
from fundedflow_collector.policy.urls import UrlRejected, canonicalize, host_of

CONTENT_TYPES = {".html": "text/html", ".htm": "text/html", ".pdf": "application/pdf", ".txt": "text/plain"}


@dataclass(frozen=True)
class CaptureResult:
    outcome: Outcome
    snapshot_id: str
    source_id: str
    captured_at: str
    title: str | None
    text_chars: int
    warnings: list[str]
    directory: str | None = None  # what the publisher's adapter made of the page


def import_capture(
    conn: sqlite3.Connection,
    settings: Settings,
    clock: Clock,
    *,
    firm_key: str | None = None,
    url: str,
    file: Path,
    captured_at: str | None = None,
    publisher_key: str | None = None,
) -> CaptureResult:
    if (firm_key is None) == (publisher_key is None):
        raise RegistryError("choose a firm or a comparison publisher for the capture")
    firm: registry.Owner = (
        registry.require_firm(conn, firm_key)
        if firm_key is not None
        else registry.require_publisher(conn, str(publisher_key))
    )
    try:
        canonical = canonicalize(url)
    except UrlRejected as exc:
        raise RegistryError(f"--url: {exc}") from exc
    host = registry.get_host(conn, firm.id, host_of(canonical))
    if host is None or host.role is HostRole.ASSET:
        raise RegistryError(
            f"{host_of(canonical)} is not registered for {firm.owner_key}; add it first so the capture stays tied to "
            "that site"
        )
    if isinstance(firm, registry.Publisher):
        reason = registry.path_outside_scope(firm, canonical)
        if reason is not None:
            raise RegistryError(f"--url {canonical} {reason}")
    suffix = file.suffix.lower()
    if suffix not in CONTENT_TYPES:
        raise RegistryError("capture files must be .html, .htm, .pdf or .txt")
    if not file.is_file():
        raise RegistryError(f"file not found: {file}")
    when = format_instant(parse_instant(captured_at)) if captured_at else format_instant(clock.now())
    raw = file.read_bytes()
    doc = _parse(raw, suffix, settings)
    kind = SourceKind.PDF if suffix == ".pdf" else SourceKind.PAGE
    with transaction(conn):
        source = registry.ensure_source(conn, firm, canonical, kind, SourceChannel.MANUAL_CAPTURE, clock.now())
    attempt = AttemptRecord(
        firm_id=firm.id,
        run_id=None,
        source_id=source.id,
        requested_url=canonical,
        final_url=canonical,
        fetch_method=FetchMethod.MANUAL_CAPTURE,
        started_at=when,
        outcome=Outcome.NEW_SNAPSHOT,
        bytes=len(raw),
        raw_sha256=sha256_bytes(raw),
        duration_ms=0,
    )
    evidence = EvidenceInput(
        document=doc,
        requested_url=canonical,
        final_url=canonical,
        captured_at=when,
        content_type=CONTENT_TYPES[suffix],
        fetch_method=FetchMethod.MANUAL_CAPTURE,
        source_channel=SourceChannel.MANUAL_CAPTURE.value,
        raw_bytes=raw,
        raw_sha256=attempt.raw_sha256,
        platform_metadata={"manual_capture": {"file_name": file.name}},
    )
    outcome, snapshot_id = store_evidence(
        conn,
        firm=firm,
        source=source,
        attempt=attempt,
        evidence=evidence,
        now=clock.now(),
        retain_raw=settings.raw.retain,
        raw_retention_days=settings.raw.retention_days,
    )
    directory = None
    if isinstance(firm, registry.Publisher):
        if suffix in (".html", ".htm"):
            stored = extract_and_store(
                conn,
                publisher=firm,
                source=source,
                snapshot_id=snapshot_id,
                attempt_id=attempt.id,
                html=raw,
                page_url=canonical,
                capture_channel=FetchMethod.MANUAL_CAPTURE.value,
                observed_at=when,
                now=clock.now(),
            )
            directory = stored.describe()
        else:
            directory = "stored as a snapshot only: adapters read saved HTML pages"
    return CaptureResult(
        directory=directory,
        outcome=outcome,
        snapshot_id=snapshot_id,
        source_id=source.id,
        captured_at=when,
        title=doc.title,
        text_chars=len(doc.text),
        warnings=doc.warnings,
    )


def _parse(raw: bytes, suffix: str, settings: Settings) -> ParsedDocument:
    limits = settings.limits
    if suffix == ".pdf":
        pdf = settings.pdf
        return parse_pdf(
            raw,
            max_bytes=limits.max_pdf_bytes,
            timeout_seconds=pdf.timeout_seconds,
            max_pages=pdf.max_pages,
            max_memory_mib=pdf.max_memory_mib,
            max_text_chars=pdf.max_text_chars,
        )
    if suffix == ".txt":
        return parse_text(raw, max_bytes=limits.max_html_bytes)
    return parse_html(raw, max_bytes=limits.max_html_bytes, min_text_chars=settings.browser.min_text_chars)
