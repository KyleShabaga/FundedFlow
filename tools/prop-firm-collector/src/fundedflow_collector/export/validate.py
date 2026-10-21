"""JSON Schema validation (Draft 2020-12) of the collector's two export formats.

The packaged schemas are byte-for-byte copies of `docs/contracts/collector-snapshot-v1.schema.json` and
`docs/contracts/collector-directory-observations-v1.schema.json`; a test fails if they differ. A document is checked
against the directory schema only when its `kind` says it is a directory export; everything else is checked
against collector-snapshot-v1, exactly as before Build 29.25.
"""

from __future__ import annotations

import json
from functools import cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator

SCHEMA_RESOURCE = "collector-snapshot-v1.schema.json"
DIRECTORY_SCHEMA_RESOURCE = "collector-directory-observations-v1.schema.json"
DIRECTORY_KIND = "fundedflow.collector.directory_observations"


@cache
def _load(resource: str) -> dict[str, Any]:
    text = resources.files("fundedflow_collector.export").joinpath(resource).read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(text)
    return data


def schema() -> dict[str, Any]:
    return _load(SCHEMA_RESOURCE)


def directory_schema() -> dict[str, Any]:
    return _load(DIRECTORY_SCHEMA_RESOURCE)


def schema_name(document: object) -> str:
    if isinstance(document, dict) and document.get("kind") == DIRECTORY_KIND:
        return "collector-directory-observations-v1"
    return "collector-snapshot-v1"


def validation_errors(document: object, limit: int = 20) -> list[str]:
    chosen = directory_schema() if schema_name(document) != "collector-snapshot-v1" else schema()
    validator = Draft202012Validator(chosen)
    messages = []
    for error in sorted(validator.iter_errors(document), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in error.absolute_path) or "(root)"
        messages.append(f"{where}: {error.message[:300]}")
        if len(messages) >= limit:
            break
    return messages
