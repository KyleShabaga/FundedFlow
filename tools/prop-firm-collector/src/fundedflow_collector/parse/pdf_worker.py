"""Child-process PDF text extraction. Run as `python -I -m fundedflow_collector.parse.pdf_worker IN OUT PAGES CHARS`.

The parent enforces the wall-clock timeout and memory cap and kills this process on overrun. This module only
reads the input file and writes one JSON result file; it makes no network calls.
"""

from __future__ import annotations

import json
import sys
from importlib import metadata


def extract(in_path: str, max_pages: int, max_chars: int) -> dict[str, object]:
    from pypdf import PdfReader

    reader = PdfReader(in_path, strict=False)
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise ValueError("PDF is encrypted") from exc
    page_count = len(reader.pages)
    pages: list[str] = []
    total = 0
    truncated = False
    for index, page in enumerate(reader.pages):
        if index >= max_pages:
            truncated = True
            break
        text = page.extract_text() or ""
        if total + len(text) > max_chars:
            text = text[: max(0, max_chars - total)]
            truncated = True
        pages.append(text)
        total += len(text)
        if truncated:
            break
    title = None
    try:
        info = reader.metadata
        if info is not None and info.title:
            title = str(info.title)
    except Exception:
        title = None
    return {
        "title": title,
        "pages": pages,
        "page_count": page_count,
        "truncated": truncated,
        "pypdf_version": metadata.version("pypdf"),
    }


def main(argv: list[str]) -> int:
    in_path, out_path, max_pages, max_chars = argv[1], argv[2], int(argv[3]), int(argv[4])
    try:
        result = extract(in_path, max_pages, max_chars)
    except Exception as exc:
        sys.stderr.write(f"{type(exc).__name__}: {exc}"[:500])
        return 3
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
