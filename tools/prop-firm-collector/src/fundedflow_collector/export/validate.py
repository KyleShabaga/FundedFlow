"""JSON Schema validation (Draft 2020-12) of evidence envelopes.

The packaged schema is a byte-for-byte copy of `docs/contracts/collector-snapshot-v1.schema.json`; a test fails if
they differ.
"""

from __future__ import annotations

import json
from functools import cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator

SCHEMA_RESOURCE = "collector-snapshot-v1.schema.json"


@cache
def schema() -> dict[str, Any]:
    text = resources.files("fundedflow_collector.export").joinpath(SCHEMA_RESOURCE).read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(text)
    return data


def validation_errors(document: object, limit: int = 20) -> list[str]:
    validator = Draft202012Validator(schema())
    messages = []
    for error in sorted(validator.iter_errors(document), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in error.absolute_path) or "(root)"
        messages.append(f"{where}: {error.message[:300]}")
        if len(messages) >= limit:
            break
    return messages
