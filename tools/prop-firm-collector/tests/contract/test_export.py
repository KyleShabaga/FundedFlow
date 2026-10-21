"""Envelope v1 contract: schema validity, determinism, no forbidden fields, and a consumer with no collector code."""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from fundedflow_collector.export.envelope import build_envelope, serialise
from fundedflow_collector.export.validate import schema, validation_errors
from fundedflow_collector.outcomes import SourceKind
from tests.conftest import CAPTURES, PROJECT, Harness, add_firm, add_seed

REPO = PROJECT.parents[1]
SCHEMA_DOC = REPO / "docs" / "contracts" / "collector-snapshot-v1.schema.json"
SCHEMA_PKG = PROJECT / "src" / "fundedflow_collector" / "export" / "collector-snapshot-v1.schema.json"
FIXTURE = PROJECT / "tests" / "fixtures" / "collector-snapshot-v1.json"
GENERATED_AT = "2026-10-20T15:00:00.000Z"
FORBIDDEN_KEYS = {
    "rule",
    "rules",
    "rule_key",
    "rule_value",
    "value_decimal",
    "account_size",
    "account_size_micro",
    "phase",
    "phase_number",
    "stage",
    "program_external_key",
    "variant_external_key",
    "catalogue_version_id",
    "catalogueVersionId",
    "price",
    "pricing",
    "currency",
    "approved",
    "reviewed_by",
    "verified",
}


def build_fixture_db(harness: Harness) -> None:
    from fundedflow_collector.capture import import_capture

    firm = add_firm(harness.conn, harness.clock, excluded=["/blog/*", "/login*"])
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/rules", priority=20)
    add_seed(harness.conn, firm, harness.clock, "https://www.example-firm.test/docs/rulebook.pdf", SourceKind.PDF)
    add_seed(harness.conn, firm, harness.clock, "https://help.example-firm.test/hc/en-us", SourceKind.ZENDESK)
    harness.run()
    harness.advance_days(1)
    harness.run()
    from fundedflow_collector.outcomes import HostRole, TermsDecision

    other = add_firm(
        harness.conn,
        harness.clock,
        "sample-funding",
        hosts={"www.sample-funding.test": (HostRole.HOMEPAGE, TermsDecision.PROHIBITED)},
    )
    import_capture(
        harness.conn,
        harness.settings,
        harness.clock,
        firm_key=other.firm_key,
        url="https://www.sample-funding.test/payouts",
        file=CAPTURES / "sample-funding-payouts.html",
        captured_at="2026-10-20T14:30:00Z",
    )


def keys(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for k, v in value.items():
            if k != "platform_metadata":
                found.add(k)
                found |= keys(v)
    elif isinstance(value, list):
        for item in value:
            found |= keys(item)
    return found


@pytest.fixture
def exported(harness: Harness) -> dict[str, Any]:
    build_fixture_db(harness)
    envelope = build_envelope(harness.conn, firm_keys=None, generated_at=GENERATED_AT)
    data: dict[str, Any] = json.loads(serialise(envelope))
    return data


def test_export_is_schema_valid_and_unverified(exported: dict[str, Any]) -> None:
    assert validation_errors(exported) == []
    assert exported["schema_version"] == 1
    assert exported["verification_status"] == "unverified"
    assert {s["fetch_method"] for s in exported["snapshots"]} == {"fixture_replay", "manual_capture"}
    for snap in exported["snapshots"]:
        assert snap["stated_dates"] == {"published_at": None, "effective_at": None}
        assert snap["content_hash"].startswith("sha256:")
    hosts = {h["host"]: h for f in exported["firms"] for h in f["hosts"]}
    assert hosts["www.example-firm.test"]["content_signals"] == ["search=yes, ai-train=no"]
    assert hosts["www.sample-funding.test"]["terms_decision"] == "prohibited"


def test_export_has_no_rule_money_phase_or_approval_fields(exported: dict[str, Any]) -> None:
    assert not keys(exported) & FORBIDDEN_KEYS


def test_export_is_deterministic(harness: Harness) -> None:
    build_fixture_db(harness)
    first = serialise(build_envelope(harness.conn, firm_keys=None, generated_at=GENERATED_AT))
    second = serialise(build_envelope(harness.conn, firm_keys=None, generated_at=GENERATED_AT))
    assert first == second
    later = json.loads(serialise(build_envelope(harness.conn, firm_keys=None, generated_at="2027-01-01T00:00:00.000Z")))
    assert later["export_id"] == json.loads(first)["export_id"]
    assert b"\r\n" not in first and first.endswith(b"\n")
    with_attempts = json.loads(
        serialise(
            build_envelope(harness.conn, firm_keys=["example-firm"], generated_at=GENERATED_AT, include_attempts=True)
        )
    )
    assert validation_errors(with_attempts) == []
    assert with_attempts["attempts"] and with_attempts["export_id"] != json.loads(first)["export_id"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(verification_status="verified"),
        lambda d: d.update(schema_version=2),
        lambda d: d["snapshots"][0].update(rule_value="2000"),
        lambda d: d["snapshots"][0].update(content_hash="md5:abc"),
        lambda d: d["snapshots"][0].update(captured_at="2026-10-20 15:00"),
        lambda d: d["snapshots"][0]["stated_dates"].update(effective_at="2026-10-20T00:00:00.000Z"),
        lambda d: d["firms"][0]["hosts"][0].update(authorisation="verified_official"),
        lambda d: d["snapshots"][0].update(fetch_method="stealth_browser"),
        lambda d: d.pop("notice"),
    ],
)
def test_invalid_envelopes_are_rejected(exported: dict[str, Any], mutate: Any) -> None:
    broken = copy.deepcopy(exported)
    mutate(broken)
    assert validation_errors(broken)


def test_packaged_schema_matches_the_checked_in_contract() -> None:
    def text(path: Path) -> str:
        return path.read_text(encoding="utf-8").replace("\r\n", "\n")

    assert text(SCHEMA_PKG) == text(SCHEMA_DOC)
    assert schema()["$schema"] == "https://json-schema.org/draft/2020-12/schema"


def test_checked_in_fixture_matches_a_fresh_export(exported: dict[str, Any]) -> None:
    """The synthetic consumer fixture for Build 31. Regenerate with FFC_UPDATE_FIXTURES=1 after a reviewed change."""
    if os.environ.get("FFC_UPDATE_FIXTURES") == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(
            json.dumps(exported, sort_keys=True, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
        )
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == exported


def test_a_consumer_needs_only_json_and_jsonschema() -> None:
    """Parse the fixture in a separate isolated interpreter that never imports the collector package."""
    code = (
        "import json, sys\n"
        "from jsonschema import Draft202012Validator\n"
        "schema = json.load(open(sys.argv[1], encoding='utf-8'))\n"
        "doc = json.load(open(sys.argv[2], encoding='utf-8'))\n"
        "Draft202012Validator(schema).validate(doc)\n"
        "assert 'fundedflow_collector' not in sys.modules\n"
        "assert doc['verification_status'] == 'unverified'\n"
        "print(len(doc['snapshots']))\n"
    )
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(SCHEMA_DOC), str(FIXTURE)],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert int(result.stdout.strip()) > 0
