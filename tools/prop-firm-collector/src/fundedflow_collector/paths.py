"""Collector data directory and the guard that keeps the collector away from the FundedFlow app database."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

APP_IDENTIFIER = "com.fundedflow.desktop"
APP_DB_NAME = "fundedflow.db"


class AppDatabaseGuardError(Exception):
    pass


@dataclass(frozen=True)
class CollectorPaths:
    data_dir: Path

    @property
    def db(self) -> Path:
        return self.data_dir / "collector.db"

    @property
    def logs(self) -> Path:
        return self.data_dir / "logs"

    @property
    def exports(self) -> Path:
        return self.data_dir / "exports"

    @property
    def default_config(self) -> Path:
        return self.data_dir / "collector.toml"


def default_data_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "FundedFlow" / "Collector"
    return Path.home() / ".fundedflow-collector"


def resolve_paths(data_dir: Path | None) -> CollectorPaths:
    chosen = data_dir or (Path(env) if (env := os.environ.get("FFC_DATA_DIR")) else default_data_dir())
    paths = CollectorPaths(chosen.expanduser().resolve())
    guard_against_app_database(paths.db)
    return paths


def app_data_dirs() -> list[Path]:
    dirs = []
    for var in ("APPDATA", "LOCALAPPDATA"):
        value = os.environ.get(var)
        if value:
            dirs.append((Path(value) / APP_IDENTIFIER).resolve())
    return dirs


def guard_against_app_database(db_path: Path) -> None:
    """Refuse any database path that is, or sits inside, the FundedFlow app's data directory."""
    resolved = db_path.expanduser().resolve()
    if resolved.name.lower() == APP_DB_NAME:
        raise AppDatabaseGuardError(f"refusing to use {resolved}: that is the FundedFlow app database name")
    for app_dir in app_data_dirs():
        if resolved == app_dir or app_dir in resolved.parents:
            raise AppDatabaseGuardError(f"refusing to use {resolved}: it is inside the FundedFlow app data folder")
    if any(part.lower() == APP_IDENTIFIER for part in resolved.parts):
        raise AppDatabaseGuardError(f"refusing to use {resolved}: it is inside a FundedFlow app data folder")
