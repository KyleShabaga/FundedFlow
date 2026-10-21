"""The four publisher adapters and the table reader, on synthetic pages only (no real third-party content)."""

from __future__ import annotations

from pathlib import Path

import pytest

from fundedflow_collector.directory.adapters import ADAPTERS, UnknownAdapter, get_adapter
from fundedflow_collector.directory.model import ExtractedRecord, Extraction, ExtractionStatus, PageKind, Phase
from fundedflow_collector.directory.tables import StructureChanged, read_tables, soup_of
from tests.conftest import DIRECTORY_CAPTURES, DIRECTORY_SITE

OPF = get_adapter("onlypropfirms")
TSB = get_adapter("traderssecondbrain")
PFM = get_adapter("propfirmmatch-futures")
PFG = get_adapter("propfirmgorilla")


def page(host: str, relative: str) -> bytes:
    return (DIRECTORY_SITE / host / relative).read_bytes()


def fields(record: ExtractedRecord) -> dict[str, str]:
    return {f.field: f.raw_value for f in record.fields}


def find(extraction: Extraction, firm: str, *, size: str | None = None, phase: Phase | None = None) -> ExtractedRecord:
    for record in extraction.records:
        ident = record.identity
        same_size = size is None or ident.account_size_raw == size
        if ident.firm_name == firm and same_size and (phase is None or ident.phase is phase):
            return record
    raise AssertionError(f"no record for {firm} {size} {phase}")


def wrap(table: str, title: str = "<h1>Synthetic</h1>") -> bytes:
    return f"<html><body>{title}{table}<p>{'filler ' * 50}</p></body></html>".encode()


# ---------------------------------------------------------------- scope and pagination


@pytest.mark.parametrize(
    ("adapter", "url", "kind"),
    [
        (OPF, "https://onlypropfirms.com/prop-firm-comparison", PageKind.COMPARISON),
        (OPF, "https://onlypropfirms.com/prop-firm-comparison?page=2", PageKind.COMPARISON),
        (OPF, "https://onlypropfirms.com/prop-firms/northwind-futures", PageKind.PROFILE),
        (OPF, "https://onlypropfirms.com/prop-firms", PageKind.LISTING),
        (TSB, "https://traderssecondbrain.com/prop-firm/northwind-futures", PageKind.PROFILE),
        (TSB, "https://traderssecondbrain.com/guides/northwind-futures-review", PageKind.RULES_GUIDE),
        (PFM, "https://propfirmmatch.com/futures/prop-firm-challenges", PageKind.COMPARISON),
        (PFM, "https://propfirmmatch.com/futures/prop-firms/northwind-futures", PageKind.PROFILE),
        (PFG, "https://propfirmgorilla.com/firms/northwind-futures", PageKind.PROFILE),
    ],
)
def test_in_scope_pages_are_classified(adapter: object, url: str, kind: PageKind) -> None:
    assert get_adapter(adapter.name).classify(url) is kind  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("adapter", "url"),
    [
        (OPF, "https://onlypropfirms.com/prop-firm-comparison?sort=price"),  # filter/sort permutations
        (OPF, "https://onlypropfirms.com/prop-firm-comparison?page=2&sort=price"),
        (OPF, "https://onlypropfirms.com/prop-firm-comparison?page=99"),  # beyond the pagination cap
        (OPF, "https://onlypropfirms.com/prop-firms/northwind-futures?page=2"),  # profiles have no pages
        (OPF, "https://onlypropfirms.com/go/northwind"),  # affiliate redirect
        (OPF, "https://onlypropfirms.com/blog/best-firms"),
        (TSB, "https://traderssecondbrain.com/go/prop-firm/northwind"),
        (TSB, "https://traderssecondbrain.com/track-prop/northwind"),
        (TSB, "https://traderssecondbrain.com/prop-firms/data.json"),
        (PFM, "https://propfirmmatch.com/futures/prop-firm-challenges?sort=price"),
        (PFM, "https://propfirmmatch.com/_next/data/x.json"),
        (PFG, "https://propfirmgorilla.com/matchup"),
        (PFG, "https://propfirmgorilla.com/deals"),
    ],
)
def test_out_of_scope_urls_are_refused(adapter: object, url: str) -> None:
    assert get_adapter(adapter.name).classify(url) is None  # type: ignore[attr-defined]


def test_links_are_limited_to_the_publishers_own_in_scope_pages() -> None:
    extraction = OPF.extract(
        page("onlypropfirms.com", "prop-firm-comparison.html"), "https://onlypropfirms.com/prop-firm-comparison"
    )
    urls = [u for u, _t in extraction.links]
    assert "https://onlypropfirms.com/prop-firm-comparison?page=2" in urls
    assert "https://onlypropfirms.com/prop-firms/northwind-futures" in urls
    assert not any("sort=" in u or "/go/" in u or "northwind-futures.test" in u for u in urls)
    assert OPF.follow(PageKind.COMPARISON, "https://onlypropfirms.com/prop-firms/northwind-futures") is PageKind.PROFILE
    assert OPF.follow(PageKind.PROFILE, "https://onlypropfirms.com/prop-firm-comparison") is None


def test_every_registered_adapter_has_a_name_and_version() -> None:
    assert set(ADAPTERS) == {
        "onlypropfirms",
        "traderssecondbrain",
        "propfirmmatch-futures",
        "propfirmgorilla",
        "generic",
    }
    for adapter in ADAPTERS.values():
        assert adapter.version.count(".") == 2 and adapter.description
    with pytest.raises(UnknownAdapter):
        get_adapter("crawl-everything")


# ---------------------------------------------------------------- OnlyPropFirms


def test_onlypropfirms_comparison_keeps_sizes_apart_and_drops_ratings_and_deals() -> None:
    extraction = OPF.extract(
        page("onlypropfirms.com", "prop-firm-comparison.html"), "https://onlypropfirms.com/prop-firm-comparison"
    )
    assert extraction.status is ExtractionStatus.COLLECTED
    fifty = find(extraction, "Northwind Futures", size="$50K")
    hundred = find(extraction, "Northwind Futures", size="$100K")
    assert fields(fifty)["daily_loss_limit"] == "$1,100"
    assert fields(hundred)["daily_loss_limit"] == "None"  # a rowspan firm cell is carried to the second row
    assert fifty.identity.programme_name == "Rally"
    assert fifty.identity.publisher_entry_id == "northwind-futures"
    assert fifty.identity.entry_url == "https://onlypropfirms.com/prop-firms/northwind-futures"
    assert "rating" not in str(fields(fifty)).lower()
    assert any("Rating (editorial" in w and "Deal (affiliate" in w for w in extraction.warnings)
    assert {f.field for f in fifty.fields} >= {"profit_target", "max_drawdown", "drawdown_type", "min_trading_days"}
    location = next(f.location for f in fifty.fields if f.field == "profit_target")
    assert location == "table 0 row 1 column 'Profit Target'"


def test_onlypropfirms_profile_separates_evaluation_and_funded_rows_and_records_the_official_link() -> None:
    url = "https://onlypropfirms.com/prop-firms/northwind-futures"
    extraction = OPF.extract(page("onlypropfirms.com", "prop-firms/northwind-futures.html"), url)
    evaluation = find(extraction, "Northwind Futures", phase=Phase.EVALUATION)
    funded = find(extraction, "Northwind Futures", phase=Phase.SIMULATED_FUNDED)
    assert fields(evaluation)["min_trading_days"] == "5"
    assert fields(funded)["min_trading_days"] == "8"
    assert fields(funded)["profit_target"] == "N/A"
    # The displayed official link is kept without its affiliate query string; the /go/ redirect is not.
    assert evaluation.identity.first_party_url == "https://www.northwind-futures.test/rules"


def test_a_profile_table_with_a_new_column_fails_closed() -> None:
    url = "https://onlypropfirms.com/prop-firms/contoso-funding"
    extraction = OPF.extract(page("onlypropfirms.com", "prop-firms/contoso-funding.html"), url)
    assert extraction.status is ExtractionStatus.STRUCTURE_CHANGED
    assert extraction.records == []
    assert "Platform" in (extraction.detail or "")


def test_a_client_rendered_shell_is_js_unavailable_not_empty() -> None:
    url = "https://onlypropfirms.com/largest-drawdown"
    extraction = OPF.extract(page("onlypropfirms.com", "largest-drawdown.html"), url)
    assert extraction.status is ExtractionStatus.JS_UNAVAILABLE


def test_ranges_are_kept_as_displayed() -> None:
    extraction = OPF.extract(
        page("onlypropfirms.com", "prop-firm-comparison.html"), "https://onlypropfirms.com/prop-firm-comparison"
    )
    flex = find(extraction, "Fabrikam Traders")
    assert flex.identity.account_size_raw == "$25K–$150K"
    assert fields(flex)["profit_target"] == "6%–8%"
    assert fields(flex)["max_drawdown"] == "See rules"


# ---------------------------------------------------------------- Trader's Second Brain


def test_tsb_directory_splits_firm_and_programme_and_keeps_qualifiers() -> None:
    url = "https://traderssecondbrain.com/prop-firms"
    extraction = TSB.extract(page("traderssecondbrain.com", "prop-firms.html"), url)
    northwind = find(extraction, "Northwind Futures")
    assert northwind.identity.programme_name == "Rally 50K"
    assert northwind.identity.account_size_raw == "50K"  # taken from the programme name, no currency assumed
    daily = next(f for f in northwind.fields if f.field == "daily_loss_limit")
    assert daily.raw_value == "$1,000"
    assert daily.publisher_qualifier == "Verify the exact configuration before checkout"
    contoso = find(extraction, "Contoso")
    assert fields(contoso)["payout_conditions"] == "See programme rules"
    warning = " ".join(extraction.warnings)
    assert "TSB Fit (editorial" in warning and "Rank (editorial" in warning and "Price / offer (affiliate" in warning


def test_tsb_programme_details_keep_phase_and_market() -> None:
    url = "https://traderssecondbrain.com/prop-firm/northwind-futures"
    extraction = TSB.extract(page("traderssecondbrain.com", "prop-firm/northwind-futures.html"), url)
    evaluation = find(extraction, "Northwind Futures", phase=Phase.EVALUATION)
    funded = find(extraction, "Northwind Futures", phase=Phase.SIMULATED_FUNDED)
    assert evaluation.identity.market.value == "futures"
    assert fields(funded)["payout_split"] == "90/10"
    assert evaluation.identity.first_party_url == "https://www.northwind-futures.test/rules"
    assert ("https://traderssecondbrain.com/guides/northwind-futures-review", "Read the rule guide") in extraction.links


def test_tsb_empty_pages_and_missing_sections_are_told_apart() -> None:
    empty = TSB.extract(
        page("traderssecondbrain.com", "prop-firms__page=2.html"), "https://traderssecondbrain.com/prop-firms?page=2"
    )
    assert empty.status is ExtractionStatus.NO_RECORDS
    missing = TSB.extract(
        page("traderssecondbrain.com", "prop-firm/contoso.html"), "https://traderssecondbrain.com/prop-firm/contoso"
    )
    assert missing.status is ExtractionStatus.STRUCTURE_CHANGED


def test_tsb_rule_guide_reads_key_value_tables_and_reports_unknown_labels() -> None:
    url = "https://traderssecondbrain.com/guides/northwind-futures-review"
    extraction = TSB.extract(page("traderssecondbrain.com", "guides/northwind-futures-review.html"), url)
    record = find(extraction, "Northwind Futures")
    assert record.identity.phase is Phase.EVALUATION
    assert record.identity.programme_name == "Rally"
    assert fields(record)["max_drawdown"] == "$2,500 trailing"
    assert {f.field for f in record.fields} >= {"drawdown_type"}  # basis stated in the drawdown text
    assert any("Trading platforms" in w for w in extraction.warnings)


# ---------------------------------------------------------------- Prop Firm Match (futures, manual capture)


def test_pfm_challenge_table_keeps_programme_steps_size_and_phase() -> None:
    url = "https://propfirmmatch.com/futures/prop-firm-challenges"
    extraction = PFM.extract((DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html").read_bytes(), url)
    assert extraction.status is ExtractionStatus.COLLECTED
    phase1 = find(extraction, "Northwind Futures", phase=Phase.EVALUATION_STEP_1)
    funded = find(extraction, "Northwind Futures", phase=Phase.SIMULATED_FUNDED)
    tailspin = find(extraction, "Tailspin Capital")
    assert phase1.identity.variant == "1 Step" and phase1.identity.market.value == "futures"
    assert fields(phase1)["profit_target"] == "$3,000" and fields(funded)["profit_target"] == "—"
    assert tailspin.identity.phase is Phase.EVALUATION_STEP_2 and tailspin.identity.account_size_raw == "€100k"
    assert all(
        "Discount" not in f.raw_label and "Rating" not in f.raw_label for r in extraction.records for f in r.fields
    )
    assert not any("sort=" in u for u, _t in extraction.links)


def test_pfm_redesigned_table_fails_closed() -> None:
    url = "https://propfirmmatch.com/futures/prop-firm-challenges"
    extraction = PFM.extract((DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges-changed.html").read_bytes(), url)
    assert extraction.status is ExtractionStatus.STRUCTURE_CHANGED
    assert extraction.records == []


# ---------------------------------------------------------------- Prop Firm Gorilla


def test_gorilla_empty_static_list_is_js_unavailable() -> None:
    extraction = PFG.extract(page("propfirmgorilla.com", "firms.html"), "https://propfirmgorilla.com/firms")
    assert extraction.status is ExtractionStatus.JS_UNAVAILABLE


def test_gorilla_rendered_list_gives_profile_links_only() -> None:
    capture = (DIRECTORY_CAPTURES / "propfirmgorilla-firms-rendered.html").read_bytes()
    extraction = PFG.extract(capture, "https://propfirmgorilla.com/firms")
    assert extraction.status is ExtractionStatus.COLLECTED and extraction.records == []
    assert [u for u, _t in extraction.links] == [
        "https://propfirmgorilla.com/firms/northwind-futures",
        "https://propfirmgorilla.com/firms/contoso-funding",
    ]


def test_gorilla_evaluation_and_funded_rules_never_mix() -> None:
    url = "https://propfirmgorilla.com/firms/northwind-futures"
    extraction = PFG.extract(page("propfirmgorilla.com", "firms/northwind-futures.html"), url)
    evaluation = find(extraction, "Northwind Futures", phase=Phase.EVALUATION)
    funded = find(extraction, "Northwind Futures", phase=Phase.SIMULATED_FUNDED)
    assert evaluation.identity.programme_name == "50K Rally" and evaluation.identity.account_size_raw == "50K"
    assert "profit_target" in fields(evaluation) and "profit_target" not in fields(funded)
    assert fields(funded)["payout_split"] == "Up to 90%"
    assert "consistency_rule" not in fields(evaluation)
    assert any("Platforms" in w for w in extraction.warnings)


# ---------------------------------------------------------------- the table reader itself


def test_unexpected_or_missing_columns_and_shifted_rows_fail_closed() -> None:
    url = "https://onlypropfirms.com/prop-firm-comparison"
    head = "<tr><th>Prop Firm</th><th>Program</th><th>Account Size</th><th>Profit Target</th></tr>"
    shifted = OPF.extract(wrap(f"<table>{head}<tr><td>A</td><td>B</td><td>$50K</td></tr></table>"), url)
    assert shifted.status is ExtractionStatus.STRUCTURE_CHANGED and "columns shifted" in (shifted.detail or "")
    unknown = OPF.extract(
        wrap(f"<table>{head.replace('Program', 'Programme name')}<tr>" + "<td>x</td>" * 4 + "</tr></table>"), url
    )
    assert unknown.status is ExtractionStatus.STRUCTURE_CHANGED
    no_table = OPF.extract(wrap("<p>We moved the comparison.</p>"), url)
    assert no_table.status is ExtractionStatus.STRUCTURE_CHANGED


def test_colspan_and_rowspan_are_expanded() -> None:
    html = (
        b"<table><tr><th>A</th><th>B</th><th>C</th></tr>"
        b"<tr><td rowspan='2'>x</td><td colspan='2'>y</td></tr>"
        b"<tr><td>p</td><td>q</td></tr></table>"
    )
    table = read_tables(soup_of(html), max_rows=10)[0]
    assert [[c.text for c in row] for row in table.rows] == [["x", "y", "y"], ["x", "p", "q"]]


def test_row_limit_is_reported() -> None:
    rows = "".join(f"<tr><td>F{i}</td><td>P</td><td>$50K</td><td>8%</td></tr>" for i in range(600))
    head = "<tr><th>Prop Firm</th><th>Program</th><th>Account Size</th><th>Profit Target</th></tr>"
    extraction = OPF.extract(wrap(f"<table>{head}{rows}</table>"), "https://onlypropfirms.com/prop-firm-comparison")
    assert len(extraction.records) == OPF.max_rows
    assert any("stopped after" in w for w in extraction.warnings)


def test_malformed_html_does_not_crash() -> None:
    extraction = OPF.extract(
        b"<html><table><tr><th>Prop Firm<td>x</table", "https://onlypropfirms.com/prop-firm-comparison"
    )
    assert extraction.status in (ExtractionStatus.STRUCTURE_CHANGED, ExtractionStatus.COLLECTED)
    generic = get_adapter("generic").extract(b"\xff\xfe garbage", "https://example.test/anything")
    assert generic.status is ExtractionStatus.UNSUPPORTED_PAGE and generic.links == []


def test_structure_changed_is_an_exception_type() -> None:
    assert issubclass(StructureChanged, Exception)


def test_fixture_pages_are_marked_synthetic() -> None:
    for path in Path(DIRECTORY_SITE).rglob("*.html"):
        assert b"SYNTHETIC FIXTURE" in path.read_bytes(), path
    for path in Path(DIRECTORY_CAPTURES).glob("*.html"):
        assert b"SYNTHETIC FIXTURE" in path.read_bytes(), path
