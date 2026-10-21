"""JSON-lines file logging with redaction of secrets in URLs and headers."""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fundedflow_collector.clock import format_instant

LOGGER_NAME = "fundedflow_collector"

SENSITIVE_QUERY_KEYS = re.compile(
    r"(token|key|sig|signature|session|sess|auth|code|password|passwd|secret|credential|jwt|access|ticket)", re.I
)
SECRET_VALUE = re.compile(
    r"^(?:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[0-9a-fA-F]{32,}|[A-Za-z0-9+/_-]{40,}=*)$"
)
SENSITIVE_HEADERS = frozenset({"authorization", "proxy-authorization", "cookie", "set-cookie"})
REDACTED = "REDACTED"


def redact_url(url: str) -> str:
    """Replace token-like query values with REDACTED. Paths and other query values are kept."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    if not parts.query:
        return url
    pairs = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if SENSITIVE_QUERY_KEYS.search(key) or SECRET_VALUE.match(value):
            pairs.append((key, REDACTED))
        else:
            pairs.append((key, value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(pairs), parts.fragment))


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    out = {}
    for name, value in headers.items():
        lower = name.lower()
        if lower in SENSITIVE_HEADERS:
            out[lower] = REDACTED
        elif lower == "location":
            out[lower] = redact_url(value)
        else:
            out[lower] = value
    return out


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            record.fields = {k: (redact_url(v) if isinstance(v, str) and "://" in v else v) for k, v in fields.items()}
        return True


class JsonLinesFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "at": format_instant(datetime.fromtimestamp(record.created, UTC)),
            "level": record.levelname.lower(),
            "event": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            entry.update(fields)
        return json.dumps(entry, ensure_ascii=False, sort_keys=True, default=str)


def configure_logging(log_dir: Path | None) -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()
    if log_dir is not None:
        log_dir.mkdir(parents=True, exist_ok=True)
        name = f"collector-{datetime.now(UTC):%Y%m%d}.jsonl"
        handler = logging.FileHandler(log_dir / name, encoding="utf-8")
        handler.setFormatter(JsonLinesFormatter())
        handler.addFilter(RedactingFilter())
        logger.addHandler(handler)
    else:
        logger.addHandler(logging.NullHandler())
    return logger


def log_event(event: str, **fields: Any) -> None:
    logging.getLogger(LOGGER_NAME).info(event, extra={"fields": fields})
