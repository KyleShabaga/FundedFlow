"""Banned dependencies (research addendum §1), shared by `collector doctor` and the CI lockfile check."""

from __future__ import annotations

import re
import tomllib
from importlib import metadata
from pathlib import Path

BANNED_PACKAGES: dict[str, str] = {
    "crawl4ai": "ships stealth and undetected-browser modes",
    "playwright-stealth": "fingerprint spoofing",
    "undetected-chromedriver": "headless-detection evasion",
    "selenium-stealth": "fingerprint spoofing",
    "cloudscraper": "bot-challenge solving",
    "curl-cffi": "browser TLS impersonation",
    "tls-client": "browser TLS impersonation",
    "pymupdf": "AGPL-3.0, incompatible with the proprietary repository",
    "fitz": "PyMuPDF alias (AGPL-3.0)",
    "firecrawl": "hosted scraping service",
    "firecrawl-py": "hosted scraping service",
    "apify-client": "hosted scraping service",
    "scrapingbee": "hosted unblocker service",
    "brightdata": "proxy/unblocker service",
    "brightdata-sdk": "proxy/unblocker service",
    "zenrows": "hosted unblocker service",
    "scraperapi": "hosted unblocker service",
    "scraperapi-sdk": "hosted unblocker service",
    "2captcha-python": "CAPTCHA solving",
    "anticaptchaofficial": "CAPTCHA solving",
}


def normalise_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def banned_in_lockfile(lock_path: Path) -> list[str]:
    """Names of banned packages that appear anywhere in a uv.lock file."""
    data = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    names = {normalise_name(pkg["name"]) for pkg in data.get("package", [])}
    return sorted(names & set(BANNED_PACKAGES))


def banned_installed() -> list[str]:
    """Names of banned packages installed in the running environment."""
    installed = {normalise_name(dist.metadata["Name"] or "") for dist in metadata.distributions()}
    return sorted(installed & set(BANNED_PACKAGES))
