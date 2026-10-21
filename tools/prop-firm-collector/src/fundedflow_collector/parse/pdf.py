"""PDF parsing in a resource-limited child process (pypdf only; PyMuPDF is banned).

The child gets a wall-clock timeout, a page cap and an output-text cap; a psutil watchdog kills it if its memory
grows past the limit. Windows has no `resource.setrlimit`, so the watchdog is the memory control.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from importlib import metadata
from pathlib import Path

import psutil

from fundedflow_collector.parse.document import ParsedDocument, ParseError, ParseTimeout
from fundedflow_collector.parse.hashing import normalise_inline, normalise_text

PARSER_NAME = "pypdf"
WORKER_MODULE = "fundedflow_collector.parse.pdf_worker"


def parser_version() -> str:
    return f"pypdf {metadata.version('pypdf')}"


def parse_pdf(
    raw: bytes, *, max_bytes: int, timeout_seconds: float, max_pages: int, max_memory_mib: int, max_text_chars: int,
    worker_command: list[str] | None = None,
) -> ParsedDocument:
    if len(raw) > max_bytes:
        raise ParseError(f"PDF is {len(raw)} bytes, over the {max_bytes}-byte limit")
    if not raw.lstrip()[:5].startswith(b"%PDF-"):
        raise ParseError("not a PDF file")
    with tempfile.TemporaryDirectory(prefix="ffc-pdf-") as tmp:
        in_path = Path(tmp) / "input.pdf"
        out_path = Path(tmp) / "output.json"
        in_path.write_bytes(raw)
        command = worker_command or [sys.executable, "-I", "-m", WORKER_MODULE]
        argv = [*command, str(in_path), str(out_path), str(max_pages), str(max_text_chars)]
        stderr = _run_limited(argv, timeout_seconds=timeout_seconds, max_memory_bytes=max_memory_mib * 1024 * 1024)
        if not out_path.exists():
            raise ParseError(f"PDF could not be parsed: {stderr or 'no output'}")
        result = json.loads(out_path.read_text(encoding="utf-8"))
    pages = [normalise_text(str(p)) for p in result.get("pages", [])]
    text = normalise_text("\n\n".join(p for p in pages if p))
    warnings: list[str] = []
    if result.get("truncated"):
        warnings.append("pdf_truncated")
    if len(text) < 50:
        warnings.append("thin_content")
    title_raw = result.get("title")
    title = normalise_inline(str(title_raw))[:300] if title_raw else None
    return ParsedDocument(title=title or None, text=text, parser_name=PARSER_NAME, parser_version=parser_version(),
                          warnings=warnings)


def _run_limited(argv: list[str], *, timeout_seconds: float, max_memory_bytes: int) -> str:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(  # noqa: S603 - fixed argument list, no shell
        argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        creationflags=creationflags,
    )
    deadline = time.monotonic() + timeout_seconds
    try:
        watched = psutil.Process(proc.pid)
    except psutil.Error:
        watched = None
    reason: str | None = None
    while proc.poll() is None:
        if time.monotonic() > deadline:
            reason = f"PDF extraction exceeded {timeout_seconds:g} s"
            break
        if watched is not None:
            try:
                if watched.memory_info().rss > max_memory_bytes:
                    reason = f"PDF extraction exceeded {max_memory_bytes // (1024 * 1024)} MiB"
                    break
            except psutil.Error:
                pass
        time.sleep(0.05)
    if reason is not None:
        _kill_tree(proc)
        raise ParseTimeout(reason)
    _, err = proc.communicate()
    return err.decode("utf-8", "replace").strip()[:500]


def _kill_tree(proc: subprocess.Popen[bytes]) -> None:
    try:
        parent = psutil.Process(proc.pid)
        for child in parent.children(recursive=True):
            child.kill()
    except psutil.Error:
        pass
    proc.kill()
    proc.communicate()
