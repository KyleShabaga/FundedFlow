"""Offline replay of a fixture site directory (`fetch --fixture-site DIR`).

`DIR/<host>/<path>` holds the files. `/` and paths ending in `/` serve `index.html`; a path without an extension
also tries `<path>.html` and `<path>/index.html`. A query string maps to `<path>__<query>` with unsafe characters
replaced by `_`, falling back to `<path>__default`. Every file gets a strong ETag from its content and
honours If-None-Match with 304.
`DIR/_responses.toml` can override any URL:

    [[response]]
    url = "https://www.example-firm.test/blocked"
    status = 403
    headers = { "cf-mitigated" = "challenge" }
    body = "Just a moment..."

No DNS or sockets are used. Attempts made in this mode are recorded as `fixture_replay`.
"""

from __future__ import annotations

import hashlib
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit

import httpx

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".pdf": "application/pdf",
    ".xml": "application/xml",
    ".gz": "application/x-gzip",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".woff2": "font/woff2",
}


@dataclass
class _Override:
    status: int
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""


class FixtureSite:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        if not self.root.is_dir():
            raise FileNotFoundError(f"fixture site directory not found: {root}")
        self.requests: list[str] = []
        self._overrides: dict[str, _Override] = {}
        spec = self.root / "_responses.toml"
        if spec.exists():
            data = tomllib.loads(spec.read_text(encoding="utf-8"))
            for entry in data.get("response", []):
                body = entry.get("body", "").encode("utf-8")
                if "file" in entry:
                    body = self._safe_path(str(entry["file"])).read_bytes()
                self._overrides[str(entry["url"])] = _Override(
                    int(entry["status"]), dict(entry.get("headers", {})), body
                )

    def _safe_path(self, relative: str) -> Path:
        candidate = (self.root / relative).resolve()
        if self.root not in candidate.parents and candidate != self.root:
            raise PermissionError(f"fixture path escapes the fixture directory: {relative}")
        return candidate

    def locate(self, url: str) -> Path | None:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        path = unquote(parts.path or "/")
        if ".." in path.split("/"):
            return None
        relative = host + path
        candidates: list[str] = []
        if parts.query:
            candidates.append(relative + "__" + re.sub(r"[^A-Za-z0-9=&._-]", "_", parts.query))
            candidates.append(relative + "__default")
        if path.endswith("/"):
            candidates.append(relative + "index.html")
        else:
            candidates.append(relative)
            if "." not in path.rsplit("/", 1)[-1]:
                candidates += [relative + ".html", relative + "/index.html"]
        for item in candidates:
            try:
                found = self._safe_path(item)
            except PermissionError:
                return None
            if found.is_file():
                return found
        return None

    def respond(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        override = self._overrides.get(url)
        if override is not None:
            return httpx.Response(override.status, headers=override.headers, content=override.body)
        found = self.locate(url)
        if found is None:
            return httpx.Response(404, headers={"content-type": "text/plain"}, content=b"not found")
        content = found.read_bytes()
        etag = '"' + hashlib.sha256(content).hexdigest()[:20] + '"'
        if request.headers.get("if-none-match") == etag:
            return httpx.Response(304, headers={"etag": etag})
        suffix = found.suffix.lower()
        if found.name == "robots.txt":
            suffix = ".txt"
        return httpx.Response(
            200,
            headers={"content-type": CONTENT_TYPES.get(suffix, "application/octet-stream"), "etag": etag},
            content=content,
        )

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.respond)
