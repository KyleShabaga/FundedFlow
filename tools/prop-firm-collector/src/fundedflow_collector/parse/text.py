"""Plain-text documents (manual captures saved as .txt, or text/plain responses)."""

from __future__ import annotations

from fundedflow_collector import __version__
from fundedflow_collector.parse.document import ParsedDocument, ParseError
from fundedflow_collector.parse.hashing import normalise_inline, normalise_text

PARSER_NAME = "text"


def parse_text(raw: bytes, *, max_bytes: int, charset: str | None = None) -> ParsedDocument:
    if len(raw) > max_bytes:
        raise ParseError(f"text is {len(raw)} bytes, over the {max_bytes}-byte limit")
    for encoding in [e for e in (charset, "utf-8-sig") if e]:
        try:
            decoded = raw.decode(encoding)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    else:
        raise ParseError("text is not valid UTF-8")
    if "\x00" in decoded:
        raise ParseError("text contains NUL bytes; it looks binary")
    text = normalise_text(decoded)
    first_line = next((line for line in text.split("\n") if line.strip()), "")
    warnings = ["thin_content"] if len(text) < 50 else []
    return ParsedDocument(title=normalise_inline(first_line)[:200] or None, text=text, parser_name=PARSER_NAME,
                          parser_version=f"fundedflow-collector {__version__}", warnings=warnings)
