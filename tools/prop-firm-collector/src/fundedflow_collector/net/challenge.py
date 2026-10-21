"""Bot-challenge detection. A detected challenge stops the host; it is never solved or worked around."""

from __future__ import annotations

import re
from collections.abc import Mapping

_ALWAYS_BODY_MARKERS = [
    re.compile(rb"/cdn-cgi/challenge-platform", re.I),
    re.compile(rb"cf-chl-(?:bypass|opt|widget)|__cf_chl_", re.I),
    re.compile(rb"<title>\s*Just a moment\.\.\.\s*</title>", re.I),
    re.compile(rb"Checking (?:if the site connection is secure|your browser before accessing)", re.I),
    re.compile(rb"_Incapsula_Resource|Incapsula incident ID", re.I),
    re.compile(rb"captcha-delivery\.com|geo\.captcha-delivery", re.I),
    re.compile(rb"px-captcha|PerimeterX|/_px[0-9a-z]*/captcha", re.I),
    re.compile(rb"AwsWafIntegration|awswaf\.com", re.I),
    re.compile(rb"errors\.edgesuite\.net", re.I),
    re.compile(rb"sec-cpt-if|ak-challenge|akamai-bm-telemetry", re.I),
]
# Generic CAPTCHA widgets appear on ordinary contact forms, so they only count on blocking statuses.
_BLOCKING_STATUS_MARKERS = [
    re.compile(rb"g-recaptcha|recaptcha/api\.js|hcaptcha\.com|challenges\.cloudflare\.com/turnstile", re.I),
    re.compile(rb"Access Denied.{0,200}Reference\s*#", re.I | re.S),
    re.compile(rb"Attention Required! \| Cloudflare", re.I),
]
_BLOCKING_STATUSES = frozenset({403, 429, 503})


def detect_challenge(status: int, headers: Mapping[str, str], body_prefix: bytes) -> str | None:
    """Return a short description of the challenge marker found, or None."""
    lower = {k.lower(): v for k, v in headers.items()}
    if lower.get("cf-mitigated", "").strip().lower() == "challenge":
        return "cf-mitigated: challenge header"
    if lower.get("x-amzn-waf-action", "").strip().lower() in ("challenge", "captcha"):
        return "x-amzn-waf-action header"
    if "x-datadome" in lower and status in _BLOCKING_STATUSES:
        return "x-datadome header on a blocking status"
    sample = body_prefix[:262_144]
    for marker in _ALWAYS_BODY_MARKERS:
        if marker.search(sample):
            return f"challenge marker {marker.pattern.decode('ascii', 'replace')[:60]}"
    if status in _BLOCKING_STATUSES:
        for marker in _BLOCKING_STATUS_MARKERS:
            if marker.search(sample):
                return f"challenge marker {marker.pattern.decode('ascii', 'replace')[:60]}"
    return None
