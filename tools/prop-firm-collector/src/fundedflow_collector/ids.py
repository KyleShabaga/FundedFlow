"""Identifiers. Evidence IDs are derived from content so the same evidence gets the same ID in any database."""

from __future__ import annotations

import hashlib
import uuid


def _digest(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:32]


def source_id(firm_key: str, canonical_url: str) -> str:
    return "src_" + _digest(firm_key, canonical_url)


def snapshot_id(firm_key: str, canonical_url: str, content_hash: str) -> str:
    return "snap_" + _digest(firm_key, canonical_url, content_hash)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"
