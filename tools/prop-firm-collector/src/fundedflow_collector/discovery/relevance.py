"""Relevance ranking from URL path and anchor text. Prioritisation only: no rule values are read or inferred."""

from __future__ import annotations

import re
from urllib.parse import unquote, urlsplit

KEYWORDS: dict[str, int] = {
    "rules": 5,
    "rule": 4,
    "evaluation": 5,
    "challenge": 4,
    "funded": 4,
    "drawdown": 5,
    "daily-loss": 5,
    "daily loss": 5,
    "loss-limit": 5,
    "profit-target": 5,
    "profit target": 5,
    "payout": 4,
    "consistency": 4,
    "scaling": 3,
    "trailing": 4,
    "account": 2,
    "plan": 2,
    "pricing": 2,
    "price": 1,
    "faq": 3,
    "terms": 2,
    "prohibited": 4,
    "restricted": 3,
    "news": 2,
    "weekend": 3,
    "overnight": 2,
    "contract": 2,
    "minimum": 2,
    "trading-days": 4,
    "trading days": 4,
    "reset": 2,
    "activation": 2,
    "help": 1,
    "support": 1,
    "article": 1,
}
NEGATIVE: dict[str, int] = {
    "blog": -3,
    "press": -3,
    "careers": -5,
    "jobs": -5,
    "login": -10,
    "signin": -10,
    "sign-in": -10,
    "register": -10,
    "signup": -10,
    "cart": -10,
    "checkout": -10,
    "account/settings": -10,
    "privacy": -2,
    "cookie": -3,
    "affiliate": -3,
    "testimonial": -3,
    "podcast": -3,
    "webinar": -3,
}
_SEPARATORS = re.compile(r"[/_.+]+")


def score(url: str, anchor_text: str = "") -> int:
    parts = urlsplit(url)
    haystack = " ".join(
        [
            _SEPARATORS.sub(" ", unquote(parts.path).lower()),
            unquote(parts.path).lower(),
            anchor_text.lower(),
        ]
    )
    total = sum(weight for word, weight in KEYWORDS.items() if word in haystack)
    total += sum(weight for word, weight in NEGATIVE.items() if word in haystack)
    return max(min(total, 50), -50)
