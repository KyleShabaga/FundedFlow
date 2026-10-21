"""Deterministic identities for directory records, without collapsing what is distinct.

Normalisation only removes spelling noise (case, accents, punctuation, "&" vs "and", a trailing legal suffix). It
never drops words that can tell firms or programmes apart ("Funding", "Trader", "Pro", "2.0"), and account size,
currency, phase and variant stay separate dimensions of the record key. Names that are merely *similar* are not
merged: they become an operator review item.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

from fundedflow_collector.directory.values import SIZE_IN_TEXT

LEGAL_SUFFIXES = frozenset({"llc", "ltd", "inc", "limited", "gmbh", "plc", "corp", "pty", "fzco", "fze", "sro"})
PROGRAMME_FILLER = frozenset({"account", "accounts", "plan", "program", "programme"})


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    stripped = stripped.replace("&", " and ").replace("+", " plus ")
    return re.sub(r"[^a-z0-9.]+", " ", stripped).replace(" . ", " ").strip(" .")


def norm_firm(name: str) -> str:
    tokens = _fold(name).replace(".", " ").split()
    while len(tokens) > 1 and tokens[-1] in LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def norm_programme(name: str | None, firm_norm: str = "") -> str:
    if not name:
        return ""
    text = SIZE_IN_TEXT.sub(" ", name)
    folded = _fold(text)
    if firm_norm and (folded == firm_norm or folded.startswith(firm_norm + " ")):
        folded = folded[len(firm_norm) :]
    tokens = [t for t in folded.split() if t not in PROGRAMME_FILLER]
    return " ".join(tokens)


def norm_variant(text: str | None) -> str:
    return _fold(text) if text else ""


def _digest(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:32]


def record_key(
    publisher_key: str,
    firm_norm: str,
    programme_norm: str,
    variant_norm: str,
    account_size: str | None,
    currency: str | None,
    account_size_raw: str | None,
    phase: str,
) -> str:
    """One publisher's record of one programme variant, size and phase of one firm (as the publisher names it)."""
    size = account_size or ("raw:" + _fold(account_size_raw) if account_size_raw else "")
    return "rec_" + _digest(publisher_key, firm_norm, programme_norm, variant_norm, size, currency or "", phase)


def comparison_key(
    identity: str, programme_norm: str, variant_norm: str, size: str | None, currency: str | None, phase: str
) -> str:
    """Records from different publishers that claim to describe the same thing (for duplicates and conflicts)."""
    return "cmp_" + _digest(identity, programme_norm, variant_norm, size or "", currency or "", phase)


def observation_id(extraction_id: str, record: str, field: str, location: str) -> str:
    return "obs_" + _digest(extraction_id, record, field, location)


def extraction_id(snapshot_id: str, adapter: str, version: str) -> str:
    return "dext_" + _digest(snapshot_id, adapter, version)


def similar(a: str, b: str) -> bool:
    """Names close enough that an operator should decide whether they are one firm (never merged automatically)."""
    if a == b or not a or not b:
        return False
    ta, tb = set(a.split()), set(b.split())
    if (a in b or b in a) and min(len(a), len(b)) >= 4:
        return True
    union = ta | tb
    return bool(union) and len(ta & tb) / len(union) >= 0.6
