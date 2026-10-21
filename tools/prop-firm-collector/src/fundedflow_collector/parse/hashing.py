"""Canonical normalisation and content hashing (`norm-v1`).

Normalisation: Unicode NFC; CRLF/CR to LF; tabs, non-breaking and other horizontal spaces to one space; runs of
spaces collapsed; trailing spaces stripped; more than two consecutive blank lines reduced to two; leading and
trailing blank lines removed.

Hash: SHA-256 of the canonical JSON (sorted keys, UTF-8, no insignificant whitespace) of
`{"normalization": "norm-v1", "title": ..., "text": ..., "tables": ...}`, written as `sha256:<lowercase hex>`.
Links and heading offsets are stored but not hashed, so navigation changes do not create new snapshots. A hash
only detects change; it is not evidence that content is accurate, and a new hash is not a rule change.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata

from fundedflow_collector.parse.document import ParsedDocument

NORMALIZATION_VERSION = "norm-v1"

_HSPACE = re.compile(r"[ \t   -   　\f\v]+")
_BLANKS = re.compile(r"\n{3,}")
_ZERO_WIDTH = re.compile(r"[​‌‍⁠﻿]")


def normalise_text(text: str) -> str:
    value = unicodedata.normalize("NFC", text)
    value = value.replace("\r\n", "\n").replace("\r", "\n").replace(" ", "\n").replace(" ", "\n")
    value = _ZERO_WIDTH.sub("", value)
    lines = [_HSPACE.sub(" ", line).strip() for line in value.split("\n")]
    value = "\n".join(lines)
    value = _BLANKS.sub("\n\n", value)
    return value.strip("\n")


def normalise_inline(text: str) -> str:
    """Normalise a single-line value (title, heading, table cell)."""
    return " ".join(normalise_text(text).split())


def sha256_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def content_hash(doc: ParsedDocument) -> str:
    payload = {
        "normalization": NORMALIZATION_VERSION,
        "title": doc.title,
        "text": doc.text,
        "tables": [
            {"caption": t.caption, "headers": t.headers, "rows": t.rows, "preceding_heading": t.preceding_heading}
            for t in doc.tables
        ],
    }
    return sha256_bytes(canonical_json(payload))
