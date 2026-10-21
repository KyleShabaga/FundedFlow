"""Shared CLI state, error handling and plain-text tables."""

from __future__ import annotations

import contextlib
import functools
import json
import sqlite3
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import typer

from fundedflow_collector.cli import exit_codes
from fundedflow_collector.clock import SystemClock
from fundedflow_collector.config import ConfigError, Settings, load_settings
from fundedflow_collector.db.connection import DatabaseError, open_database
from fundedflow_collector.db.migrate import MigrationError
from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.logging_setup import configure_logging
from fundedflow_collector.net.client import UserAgentNotConfigured
from fundedflow_collector.paths import AppDatabaseGuardError, CollectorPaths, resolve_paths


@dataclass
class AppState:
    data_dir: Path | None
    config_path: Path | None
    _paths: CollectorPaths | None = None
    _settings: tuple[Settings, str] | None = None
    _connections: list[sqlite3.Connection] = field(default_factory=list)

    @property
    def paths(self) -> CollectorPaths:
        if self._paths is None:
            self._paths = resolve_paths(self.data_dir)
        return self._paths

    @property
    def config_file(self) -> Path:
        return self.config_path or self.paths.default_config

    def settings(self) -> tuple[Settings, str]:
        if self._settings is None:
            self._settings = load_settings(self.config_file)
        return self._settings

    def connect(self, *, create: bool = False) -> sqlite3.Connection:
        configure_logging(self.paths.logs)
        conn = open_database(self.paths.db, create=create)
        self._connections.append(conn)
        return conn

    def close(self) -> None:
        for conn in self._connections:
            conn.close()
        self._connections.clear()
        configure_logging(None)


clock = SystemClock()


def state(ctx: typer.Context) -> AppState:
    obj = ctx.find_root().obj
    assert isinstance(obj, AppState)
    return obj


def fail(message: str, code: int) -> typer.Exit:
    typer.echo(f"Error: {message}", err=True)
    return typer.Exit(code)


def handle_errors[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    """Map known errors to stable exit codes with one plain-language line."""

    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return func(*args, **kwargs)
        except (ConfigError, RegistryError, UserAgentNotConfigured) as exc:
            raise fail(str(exc), exit_codes.CONFIG) from exc
        except (DatabaseError, MigrationError, AppDatabaseGuardError, sqlite3.Error) as exc:
            raise fail(str(exc), exit_codes.DATABASE) from exc
        except KeyboardInterrupt as exc:
            typer.echo("Interrupted. Work done so far is saved; the run is marked aborted.", err=True)
            raise typer.Exit(exit_codes.INTERRUPTED) from exc

    return wrapper


def table(headers: Sequence[str], rows: Sequence[Sequence[Any]], max_width: int = 60) -> str:
    def cell(value: Any) -> str:
        text = "-" if value is None or value == "" else str(value)
        text = text.replace("\n", " ")
        return text if len(text) <= max_width else text[: max_width - 3] + "..."

    body = [[cell(v) for v in row] for row in rows]
    widths = [len(h) for h in headers]
    for row in body:
        widths = [max(w, len(v)) for w, v in zip(widths, row, strict=True)]
    lines = ["  ".join(h.ljust(w) for h, w in zip(headers, widths, strict=True)).rstrip()]
    lines.append("  ".join("-" * w for w in widths))
    lines += ["  ".join(v.ljust(w) for v, w in zip(row, widths, strict=True)).rstrip() for row in body]
    return "\n".join(lines)


def echo_json(value: Any) -> None:
    typer.echo(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, default=str))


def configure_console() -> None:
    """Make output safe on legacy Windows code pages (replace characters the console cannot show)."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            with contextlib.suppress(ValueError, OSError):
                reconfigure(errors="replace")
