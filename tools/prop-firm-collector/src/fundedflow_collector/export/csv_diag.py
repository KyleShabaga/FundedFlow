"""Optional diagnostic CSV: one row per snapshot with URLs, hashes and times. No page text. Not an import format."""

from __future__ import annotations

import csv
import io

from fundedflow_collector.export.envelope import Envelope

COLUMNS = [
    "firm_key",
    "snapshot_id",
    "canonical_url",
    "final_url",
    "captured_at",
    "fetch_method",
    "content_type",
    "content_hash",
    "text_chars",
    "observation_count",
    "last_seen_at",
    "warnings",
]


def to_csv(envelope: Envelope) -> bytes:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(COLUMNS)
    for s in envelope.snapshots:
        writer.writerow(
            [
                s.firm_key,
                s.snapshot_id,
                s.canonical_url,
                s.final_url,
                s.captured_at,
                s.fetch_method,
                s.content_type,
                s.content_hash,
                len(s.text),
                s.observations.observation_count,
                s.observations.last_seen_at,
                ";".join(s.extraction_warnings),
            ]
        )
    return out.getvalue().encode("utf-8")
