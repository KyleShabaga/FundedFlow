"""collector-directory-observations-v1: the checked-in schema, its packaged copy and a pinned synthetic fixture.

The fixture is built from the synthetic practice site only (invented firms). Regenerate it with
FFC_UPDATE_FIXTURES=1 after a reviewed change to the adapters, the schema or the export.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from fundedflow_collector.capture import import_capture
from fundedflow_collector.directory import export as directory_export
from fundedflow_collector.export.validate import directory_schema, schema, validation_errors
from tests.conftest import DIRECTORY_CAPTURES, PROJECT, TEST_SETTINGS, Harness, install_publisher, run_publisher

REPO = PROJECT.parents[1]
SCHEMA_DOC = REPO / "docs" / "contracts" / "collector-directory-observations-v1.schema.json"
SCHEMA_PKG = PROJECT / "src" / "fundedflow_collector" / "export" / "collector-directory-observations-v1.schema.json"
FIXTURE = PROJECT / "tests" / "fixtures" / "collector-directory-observations-v1.json"


@pytest.fixture
def exported(dharness: Harness) -> dict[str, Any]:
    from fundedflow_collector.directory import presets

    install_publisher(dharness.conn, dharness.clock, "onlypropfirms")
    install_publisher(dharness.conn, dharness.clock, "traderssecondbrain")
    presets.install_preset(dharness.conn, "propfirmmatch-futures", dharness.clock.now())
    run_publisher(dharness, "onlypropfirms")
    run_publisher(dharness, "traderssecondbrain")
    import_capture(
        dharness.conn,
        TEST_SETTINGS,
        dharness.clock,
        publisher_key="propfirmmatch-futures",
        url="https://propfirmmatch.com/futures/prop-firm-challenges",
        file=DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html",
        captured_at="2026-10-21T12:00:00Z",
    )
    document = directory_export.build(dharness.conn, now=dharness.clock.now())
    data: dict[str, Any] = json.loads(directory_export.serialise(document))
    return data


def test_packaged_schema_matches_the_checked_in_contract() -> None:
    def text(path: Path) -> str:
        return path.read_text(encoding="utf-8").replace("\r\n", "\n")

    assert text(SCHEMA_PKG) == text(SCHEMA_DOC)
    assert directory_schema()["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert directory_schema()["$id"] != schema()["$id"]


def test_export_is_valid_and_every_value_is_unverified_with_provenance(exported: dict[str, Any]) -> None:
    assert validation_errors(exported) == []
    assert exported["kind"] == "fundedflow.collector.directory_observations"
    fields = [f for r in exported["records"] for f in r["fields"]]
    assert fields and {f["verification_status"] for f in fields} == {"unverified"}
    for field in fields:
        provenance = field["provenance"]
        assert provenance["content_hash"].startswith("sha256:")
        assert provenance["snapshot_id"].startswith("snap_")
        assert provenance["page_url"].startswith("https://")
        assert provenance["adapter_version"] == "1.0.0"
    assert {p["publisher_key"] for p in exported["publishers"]} == {
        "onlypropfirms",
        "traderssecondbrain",
        "propfirmmatch-futures",
    }
    assert {r["phase"] for r in exported["records"]} >= {"evaluation", "simulated_funded", "evaluation_step_1"}
    assert {i["kind"] for i in exported["review_items"]} >= {"conflict", "duplicate", "uncertain_identity"}


def test_no_ratings_offers_or_scores_are_exported(exported: dict[str, Any]) -> None:
    labels = {f["raw_label"].lower() for r in exported["records"] for f in r["fields"]}
    assert not labels & {"rating", "tsb fit", "rank", "deal", "discount", "discount code", "price / offer"}


def test_checked_in_fixture_matches_a_fresh_export(exported: dict[str, Any]) -> None:
    if os.environ.get("FFC_UPDATE_FIXTURES") == "1":
        FIXTURE.write_text(
            json.dumps(exported, sort_keys=True, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
        )
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == exported


def test_a_consumer_needs_only_json_and_jsonschema() -> None:
    code = (
        "import json, sys\n"
        "from jsonschema import Draft202012Validator\n"
        "schema = json.load(open(sys.argv[1], encoding='utf-8'))\n"
        "doc = json.load(open(sys.argv[2], encoding='utf-8'))\n"
        "Draft202012Validator(schema).validate(doc)\n"
        "assert 'fundedflow_collector' not in sys.modules\n"
        "print(doc['summary']['observations'])\n"
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
