"""Reading displayed values without inventing any.

A value is normalised only when its text says exactly what it is ("8%", "$2,500", "5 days"). A bare number for a
target or drawdown, a range, or a split whose order is not labelled stays raw and is marked `uncertain`. Blank,
"None", "N/A" and "See rules" are four different things and are kept apart; none of them is zero.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from fundedflow_collector.directory.model import FIELDS, Confidence, Market, Phase, ValueKind

UNKNOWN_TEXT = frozenset({"", "-", "--", "—", "–", "?", "n/d", "tbd", "unknown", "not shown", "not listed"})
NONE_TEXT = frozenset(
    {
        "none",
        "no",
        "no limit",
        "no rule",
        "unlimited",
        "not required",
        "no minimum",
        "no consistency rule",
        "no daily loss",
        "no daily loss limit",
        "no time limit",
    }
)
NOT_APPLICABLE_TEXT = frozenset({"n/a", "na", "not applicable"})
SEE_RULES_PREFIXES = ("see ", "varies", "depends", "check ", "contact ", "refer to ")

#: Explicit currency marks only. A bare "$" is a dollar of unstated country and is kept as "$", never "USD".
CURRENCY_MARKS = {
    "US$": "USD",
    "USD": "USD",
    "A$": "AUD",
    "AUD": "AUD",
    "C$": "CAD",
    "CAD": "CAD",
    "€": "EUR",
    "EUR": "EUR",
    "£": "GBP",
    "GBP": "GBP",
    "$": "$",
}
_MARK = r"US\$|A\$|C\$|\$|€|£|USD|EUR|GBP|AUD|CAD"
MONEY = re.compile(
    rf"^(?P<pre>{_MARK})?\s*(?P<num>\d{{1,3}}(?:,\d{{3}})+|\d+)(?:\.(?P<dec>\d+))?\s*(?P<mult>[kKmM])?\s*(?P<post>{_MARK})?$"
)
PERCENT = re.compile(r"^(?P<num>\d+(?:\.\d+)?)\s*%$")
DAYS = re.compile(r"^(?P<num>\d+)\s*(?:(?:trading|calendar)\s+)?days?$", re.I)
BARE_NUMBER = re.compile(r"^\d+(?:[.,]\d+)*$")
RANGE = re.compile(r"\d\s*(?:%|[kKmM])?\s*(?:–|—|-|to)\s*(?:US\$|\$|€|£)?\s*\d")
SPLIT = re.compile(r"^\d{1,3}\s*/\s*\d{1,3}$")
SIZE_IN_TEXT = re.compile(
    r"(?<![\w.])(?:US\$|\$|€|£)?\s?\d{1,3}(?:\.\d+)?\s?[kK]\b|(?:US\$|\$|€|£)\s?\d{1,3}(?:,\d{3})+"
)
QUALIFIER_PREFIX = re.compile(r"^(?P<q>up to|max(?:imum)?|min(?:imum)?|at least)\s+", re.I)
BASIS_WORDS = re.compile(r"\b(trailing|static|intraday|end[- ]of[- ]day|eod)\b", re.I)


@dataclass(frozen=True)
class Parsed:
    kind: ValueKind
    normalized: dict[str, Any] | None
    confidence: Confidence
    uncertain_reason: str | None = None


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def parse_money(text: str) -> tuple[str, str | None] | None:
    """`$2,500` -> ("2500", "$"); `50K` -> ("50000", None); `€100k` -> ("100000", "EUR"). None if not money."""
    match = MONEY.match(clean(text))
    if match is None:
        return None
    pre, post = match.group("pre"), match.group("post")
    if pre and post and CURRENCY_MARKS[pre] != CURRENCY_MARKS[post] and pre != "$":
        return None
    try:
        amount = Decimal(match.group("num").replace(",", "") + ("." + match.group("dec") if match.group("dec") else ""))
    except InvalidOperation:
        return None
    mult = (match.group("mult") or "").lower()
    if mult:
        amount *= 1000 if mult == "k" else 1_000_000
    elif match.group("num").find(",") < 0 and not (pre or post):
        return None  # "2500" with no mark is a bare number, not money
    mark = post or pre
    return decimal_text(amount), CURRENCY_MARKS[mark] if mark else None


def parse_size(raw: str | None) -> tuple[str | None, str | None]:
    """An account size as displayed: `$50K` -> ("50000", "$"). Ranges and words give (None, None)."""
    if not raw:
        return None, None
    text = clean(raw)
    if RANGE.search(text):
        return None, None
    match = MONEY.match(text)
    if match is None:
        return None, None
    found = parse_money(text)
    if found is None:
        return None, None
    return found


def size_in_text(text: str | None) -> str | None:
    """The first account-size token inside a programme name such as "50K Rally"."""
    if not text:
        return None
    match = SIZE_IN_TEXT.search(text)
    return clean(match.group(0)) if match else None


def special_kind(text: str) -> ValueKind | None:
    lowered = clean(text).lower().rstrip(".")
    if lowered in UNKNOWN_TEXT:
        return ValueKind.UNKNOWN
    if lowered in NONE_TEXT:
        return ValueKind.NONE
    if lowered in NOT_APPLICABLE_TEXT:
        return ValueKind.NOT_APPLICABLE
    if lowered.startswith(SEE_RULES_PREFIXES) or lowered in ("see rules", "see programme rules"):
        return ValueKind.SEE_RULES
    return None


def _uncertain(reason: str) -> Parsed:
    return Parsed(ValueKind.VALUE, None, Confidence.UNCERTAIN, reason)


def _amount(text: str, *, allow_percent: bool, allow_money: bool) -> dict[str, Any] | None:
    percent = PERCENT.match(text)
    if percent and allow_percent:
        return {"type": "percent", "value": decimal_text(Decimal(percent.group("num")))}
    money = parse_money(text) if allow_money else None
    if money is not None:
        return {"type": "money", "amount": money[0], "currency": money[1]}
    return None


def drawdown_basis(text: str) -> str | None:
    words = {w.lower().replace("-", " ") for w in BASIS_WORDS.findall(text)}
    trailing = "trailing" in words
    eod = bool(words & {"eod", "end of day"})
    if trailing and eod:
        return "trailing_eod"
    if trailing and "intraday" in words:
        return "trailing_intraday"
    if trailing:
        return "trailing"
    if "static" in words:
        return "static"
    if eod:
        return "end_of_day"
    if "intraday" in words:
        return "intraday"
    return None


def parse_value(field: str, raw: str) -> Parsed:
    """Classify and, only when unambiguous, normalise one displayed value for `field`."""
    text = clean(raw)
    special = special_kind(text)
    if special is not None:
        return Parsed(special, None, Confidence.OBSERVED)
    unit = FIELDS[field].unit
    if unit == "text":
        return Parsed(ValueKind.VALUE, {"type": "text", "value": text[:500]}, Confidence.OBSERVED)
    if unit == "enum":
        basis = drawdown_basis(text)
        if basis is None:
            return _uncertain("drawdown type not recognised")
        return Parsed(ValueKind.VALUE, {"type": "drawdown_type", "value": basis}, Confidence.OBSERVED)
    if RANGE.search(text):
        return _uncertain("a range of values, not one programme's value")
    qualifier = None
    prefix = QUALIFIER_PREFIX.match(text)
    if prefix:
        word = prefix.group("q").lower()
        qualifier = "up_to" if word == "up to" or word.startswith("max") else "at_least"
        text = text[prefix.end() :]
    basis = drawdown_basis(text) if field == "max_drawdown" else None
    core = clean(BASIS_WORDS.sub("", text).replace("(", " ").replace(")", " ")) if basis else text
    normalized: dict[str, Any] | None
    if unit == "days":
        match = DAYS.match(core) or (re.match(r"^(?P<num>\d+)$", core))
        normalized = {"type": "days", "value": match.group("num")} if match else None
    elif unit == "percent":
        if SPLIT.match(core):
            return _uncertain("split shown without saying whose share is which")
        normalized = _amount(core, allow_percent=True, allow_money=False)
    elif unit == "money":
        normalized = _amount(core, allow_percent=False, allow_money=True)
    else:
        normalized = _amount(core, allow_percent=True, allow_money=True)
    if normalized is None:
        if BARE_NUMBER.match(core):
            return _uncertain("a number without a unit")
        return _uncertain("value not in a recognised format")
    if qualifier:
        normalized["qualifier"] = qualifier
    if basis:
        normalized["basis"] = basis
    if normalized.get("type") == "money" and normalized.get("currency") is None:
        return Parsed(ValueKind.VALUE, normalized, Confidence.UNCERTAIN, "amount shown without a currency")
    return Parsed(ValueKind.VALUE, normalized, Confidence.OBSERVED)


def parse_phase(text: str | None) -> Phase:
    if not text:
        return Phase.UNSPECIFIED
    lowered = clean(text).lower()
    if "instant" in lowered:
        return Phase.INSTANT_FUNDED
    step = re.search(r"\b(?:phase|step|stage)\s*([123])\b", lowered)
    if step:
        return {"1": Phase.EVALUATION_STEP_1, "2": Phase.EVALUATION_STEP_2, "3": Phase.EVALUATION_STEP_3}[step.group(1)]
    if re.search(r"\b(funded|sim(?:ulated)? funded|performance account|pa|express|live sim|master)\b", lowered):
        return Phase.SIMULATED_FUNDED
    if re.search(r"\b(evaluation|eval|challenge|assessment)\b", lowered):
        return Phase.EVALUATION
    return Phase.UNSPECIFIED


def parse_market(text: str | None) -> Market:
    if not text:
        return Market.UNSPECIFIED
    lowered = clean(text).lower()
    found = set()
    if "futures" in lowered:
        found.add(Market.FUTURES)
    if "forex" in lowered or "cfd" in lowered or "fx" in lowered.split():
        found.add(Market.FOREX_CFD)
    if "crypto" in lowered:
        found.add(Market.CRYPTO)
    if "stock" in lowered or "equit" in lowered:
        found.add(Market.STOCKS)
    if len(found) > 1:
        return Market.MULTIPLE
    return found.pop() if found else Market.UNSPECIFIED
