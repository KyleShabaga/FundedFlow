"""Global settings from `collector.toml`, validated with hard floors and ceilings.

There is deliberately no setting for proxies, User-Agent replacement, cookies, extra ports, private addresses or
robots/terms bypass. Unknown keys are rejected, so `proxy = ...` or `stealth = true` is a configuration error.
"""

from __future__ import annotations

import hashlib
import tomllib
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class ConfigError(Exception):
    pass


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class UserAgentSettings(_Section):
    info_url: str | None = None
    contact: str | None = Field(default=None, max_length=200)

    @field_validator("info_url")
    @classmethod
    def _https_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            raise ValueError("info_url must be an https URL without credentials")
        return value

    @field_validator("contact")
    @classmethod
    def _contact(cls, value: str | None) -> str | None:
        if value is not None and any(c in value for c in "();\r\n"):
            raise ValueError("contact must not contain parentheses, semicolons or line breaks")
        return value


class PacingSettings(_Section):
    min_delay_seconds: float = Field(default=2.0, ge=1.0, le=600.0)
    unclear_terms_delay_seconds: float = Field(default=5.0, ge=5.0, le=600.0)
    jitter_ms: int = Field(default=250, ge=0, le=500)
    slow_response_seconds: float = Field(default=3.0, ge=0.5, le=60.0)
    max_adaptive_delay_seconds: float = Field(default=60.0, ge=1.0, le=600.0)


class BudgetSettings(_Section):
    fetches_per_firm_run: int = Field(default=75, ge=1, le=300)
    run_deadline_minutes: int = Field(default=20, ge=1, le=120)


class LimitSettings(_Section):
    max_depth: int = Field(default=2, ge=0, le=5)
    max_html_bytes: int = Field(default=5 * 1024 * 1024, ge=64 * 1024, le=10 * 1024 * 1024)
    max_pdf_bytes: int = Field(default=20 * 1024 * 1024, ge=64 * 1024, le=50 * 1024 * 1024)
    max_sitemap_bytes: int = Field(default=10 * 1024 * 1024, ge=64 * 1024, le=50 * 1024 * 1024)
    max_sitemap_urls: int = Field(default=50_000, ge=1, le=50_000)
    connect_timeout_seconds: float = Field(default=10.0, ge=1.0, le=60.0)
    read_timeout_seconds: float = Field(default=20.0, ge=1.0, le=120.0)
    total_timeout_seconds: float = Field(default=30.0, ge=1.0, le=300.0)


class PdfSettings(_Section):
    timeout_seconds: float = Field(default=30.0, ge=1.0, le=300.0)
    max_pages: int = Field(default=50, ge=1, le=1000)
    max_memory_mib: int = Field(default=512, ge=64, le=4096)
    max_text_chars: int = Field(default=2_000_000, ge=10_000, le=20_000_000)


class BrowserSettings(_Section):
    enabled: Literal["auto", "off"] = "auto"
    min_text_chars: int = Field(default=300, ge=0, le=100_000)
    navigation_timeout_seconds: float = Field(default=30.0, ge=5.0, le=120.0)


class RawSettings(_Section):
    retain: bool = False
    retention_days: int = Field(default=90, ge=1, le=3650)


class Settings(_Section):
    user_agent: UserAgentSettings = UserAgentSettings()
    pacing: PacingSettings = PacingSettings()
    budget: BudgetSettings = BudgetSettings()
    limits: LimitSettings = LimitSettings()
    pdf: PdfSettings = PdfSettings()
    browser: BrowserSettings = BrowserSettings()
    raw: RawSettings = RawSettings()


def load_settings(path: Path | None) -> tuple[Settings, str]:
    """Load settings and return them with the SHA-256 of the file (or of the empty defaults)."""
    if path is None or not path.exists():
        return Settings(), hashlib.sha256(b"").hexdigest()
    data = path.read_bytes()
    try:
        raw = tomllib.loads(data.decode("utf-8-sig"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        raise ConfigError(f"{path}: not valid TOML: {exc}") from exc
    try:
        settings = Settings.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(f"{path}: {_describe(exc)}") from exc
    return settings, hashlib.sha256(data).hexdigest()


def _describe(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"])
        parts.append(f"{loc}: {err['msg']}")
    return "; ".join(parts)
