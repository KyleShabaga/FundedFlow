"""Value reading (null semantics, units, ranges) and record identities. Pure functions, no database."""

from __future__ import annotations

import pytest

from fundedflow_collector.directory import identity
from fundedflow_collector.directory.model import Confidence, Market, Phase, ValueKind
from fundedflow_collector.directory.values import parse_market, parse_phase, parse_size, parse_value, size_in_text


@pytest.mark.parametrize(
    ("raw", "kind"),
    [
        ("", ValueKind.UNKNOWN),
        ("—", ValueKind.UNKNOWN),
        ("-", ValueKind.UNKNOWN),
        ("?", ValueKind.UNKNOWN),
        ("None", ValueKind.NONE),
        ("No limit", ValueKind.NONE),
        ("no", ValueKind.NONE),
        ("N/A", ValueKind.NOT_APPLICABLE),
        ("not applicable", ValueKind.NOT_APPLICABLE),
        ("See rules", ValueKind.SEE_RULES),
        ("See programme rules", ValueKind.SEE_RULES),
        ("Varies by account", ValueKind.SEE_RULES),
    ],
)
def test_unknown_none_na_and_see_rules_are_distinct_and_never_zero(raw: str, kind: ValueKind) -> None:
    parsed = parse_value("daily_loss_limit", raw)
    assert parsed.kind is kind
    assert parsed.normalized is None


def test_zero_is_a_value_not_none() -> None:
    parsed = parse_value("consistency_rule", "0%")
    assert parsed.kind is ValueKind.VALUE
    assert parsed.normalized == {"type": "percent", "value": "0"}


@pytest.mark.parametrize(
    ("field", "raw", "normalized"),
    [
        ("profit_target", "8%", {"type": "percent", "value": "8"}),
        ("profit_target", "$3,000", {"type": "money", "amount": "3000", "currency": "$"}),
        ("profit_target", "€6,000", {"type": "money", "amount": "6000", "currency": "EUR"}),
        (
            "max_drawdown",
            "$2,500 trailing (EOD)",
            {"type": "money", "amount": "2500", "currency": "$", "basis": "trailing_eod"},
        ),
        ("max_drawdown", "4% static", {"type": "percent", "value": "4", "basis": "static"}),
        ("min_trading_days", "5", {"type": "days", "value": "5"}),
        ("min_trading_days", "4 trading days", {"type": "days", "value": "4"}),
        ("payout_split", "Up to 90%", {"type": "percent", "value": "90", "qualifier": "up_to"}),
        ("drawdown_type", "Trailing, end of day", {"type": "drawdown_type", "value": "trailing_eod"}),
        ("drawdown_type", "Static", {"type": "drawdown_type", "value": "static"}),
        ("payout_frequency", "Every 8  trading days", {"type": "text", "value": "Every 8 trading days"}),
        ("evaluation_fee", "$165", {"type": "money", "amount": "165", "currency": "$"}),
    ],
)
def test_explicit_values_are_normalised(field: str, raw: str, normalized: dict[str, str]) -> None:
    parsed = parse_value(field, raw)
    assert parsed.kind is ValueKind.VALUE
    assert parsed.confidence is Confidence.OBSERVED
    assert parsed.normalized == normalized


@pytest.mark.parametrize(
    ("field", "raw", "reason"),
    [
        ("profit_target", "3000", "a number without a unit"),
        ("profit_target", "6%–8%", "a range"),
        ("max_drawdown", "$2,000 - $3,000", "a range"),
        ("payout_split", "90/10", "whose share"),
        ("drawdown_type", "Balance based", "not recognised"),
        ("profit_target", "2,500", "without a currency"),
        ("evaluation_fee", "cheap", "not in a recognised format"),
    ],
)
def test_ambiguous_values_stay_raw_and_uncertain(field: str, raw: str, reason: str) -> None:
    parsed = parse_value(field, raw)
    assert parsed.kind is ValueKind.VALUE
    assert parsed.confidence is Confidence.UNCERTAIN
    assert parsed.uncertain_reason is not None and reason in parsed.uncertain_reason


def test_a_bare_dollar_is_never_assumed_to_be_usd() -> None:
    assert parse_size("$50K") == ("50000", "$")
    assert parse_size("US$50K") == ("50000", "USD")
    assert parse_size("€100k") == ("100000", "EUR")
    assert parse_size("50K") == ("50000", None)
    assert parse_size("$25K–$150K") == (None, None)
    assert parse_size("Large") == (None, None)
    assert size_in_text("50K Rally") == "50K"
    assert size_in_text("Rally") is None


@pytest.mark.parametrize(
    ("text", "phase"),
    [
        ("Phase 1", Phase.EVALUATION_STEP_1),
        ("Step 2", Phase.EVALUATION_STEP_2),
        ("Evaluation", Phase.EVALUATION),
        ("Evaluation rules", Phase.EVALUATION),
        ("Funded", Phase.SIMULATED_FUNDED),
        ("Sim funded", Phase.SIMULATED_FUNDED),
        ("Funded rules", Phase.SIMULATED_FUNDED),
        ("Instant funding", Phase.INSTANT_FUNDED),
        ("1 Step", Phase.UNSPECIFIED),
        ("", Phase.UNSPECIFIED),
    ],
)
def test_phases_are_read_only_when_displayed(text: str, phase: Phase) -> None:
    assert parse_phase(text) is phase


def test_markets() -> None:
    assert parse_market("Futures") is Market.FUTURES
    assert parse_market("Forex & CFD") is Market.FOREX_CFD
    assert parse_market("Futures, crypto") is Market.MULTIPLE
    assert parse_market(None) is Market.UNSPECIFIED


def test_firm_normalisation_removes_noise_but_not_distinguishing_words() -> None:
    assert identity.norm_firm("Fabrikam Traders LLC") == identity.norm_firm("fabrikam traders")
    assert identity.norm_firm("Contoso & Co. Ltd") == "contoso and co"
    assert identity.norm_firm("Café Funding") == "cafe funding"
    assert identity.norm_firm("Northwind Futures") != identity.norm_firm("Northwind Funding")
    assert identity.norm_firm("Apex Trader Funding") != identity.norm_firm("Apex")


def test_programme_normalisation_drops_sizes_and_the_firm_name_only() -> None:
    firm = identity.norm_firm("Northwind Futures")
    assert identity.norm_programme("Northwind Futures 50K Rally", firm) == "rally"
    assert identity.norm_programme("Rally Account", firm) == "rally"
    assert identity.norm_programme("Rally 2.0", firm) == "rally 2.0"
    assert identity.norm_programme("Rally Pro", firm) != identity.norm_programme("Rally", firm)


def test_record_keys_keep_size_currency_phase_and_variant_apart() -> None:
    base = ("pub", "northwind futures", "rally", "")
    one = identity.record_key(*base, "50000", "$", "$50K", "evaluation")
    assert one == identity.record_key(*base, "50000", "$", "$50,000", "evaluation")
    assert one != identity.record_key(*base, "100000", "$", "$100K", "evaluation")
    assert one != identity.record_key(*base, "50000", "EUR", "€50K", "evaluation")
    assert one != identity.record_key(*base, "50000", "$", "$50K", "simulated_funded")
    assert one != identity.record_key("pub", "northwind futures", "rally", "1 step", "50000", "$", "$50K", "evaluation")
    assert one != identity.record_key("other", "northwind futures", "rally", "", "50000", "$", "$50K", "evaluation")


def test_similar_names_are_flagged_not_merged() -> None:
    assert identity.similar("contoso", "contoso funding")
    assert identity.similar("northwind futures", "northwind futures group")
    assert not identity.similar("contoso funding", "contoso funding")
    assert not identity.similar("northwind futures", "tailspin capital")
