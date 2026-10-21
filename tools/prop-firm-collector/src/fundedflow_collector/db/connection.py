"""Opening the collector database with the required pragmas, migrations and crash recovery."""

from __future__ import annotations

import sqlite3
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

from fundedflow_collector.paths import guard_against_app_database


class DatabaseError(Exception):
    pass


def connect(path: Path) -> sqlite3.Connection:
    guard_against_app_database(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, detect_types=0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """One explicit write transaction. Deferred foreign keys are checked at COMMIT."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def open_database(path: Path, *, create: bool = False) -> sqlite3.Connection:
    """Open (and with `create`, initialise) the collector database and apply migrations."""
    from fundedflow_collector.db.migrate import MigrationError, apply_migrations

    if not create and not path.exists():
        raise DatabaseError(f"no collector database at {path}; run `collector init-db` first")
    try:
        conn = connect(path)
        apply_migrations(conn, path)
    except (sqlite3.Error, MigrationError) as exc:
        raise DatabaseError(f"{path}: {exc}") from exc
    return conn


class RunLock:
    """Exclusive lock held by network and capture commands, so only one run writes at a time.

    Crash recovery (marking `running` runs as `aborted`) happens only while holding this lock, so a read command
    in a second window never aborts a run that is still going.
    """

    def __init__(self, data_dir: Path) -> None:
        self._path = data_dir / "collector.lock"
        self._handle: BinaryIO | None = None

    def __enter__(self) -> RunLock:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self._path, "a+b")  # noqa: SIM115 - held for the lifetime of the lock
        try:
            _lock_file(handle)
        except OSError as exc:
            handle.close()
            raise DatabaseError("another collector command is running; wait for it to finish") from exc
        self._handle = handle
        return self

    def __exit__(self, *exc: object) -> None:
        if self._handle is not None:
            _unlock_file(self._handle)
            self._handle.close()
            self._handle = None


def _lock_file(handle: BinaryIO) -> None:
    handle.seek(0)
    if sys.platform == "win32":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_file(handle: BinaryIO) -> None:
    try:
        handle.seek(0)
        if sys.platform == "win32":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass
