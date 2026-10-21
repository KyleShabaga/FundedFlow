"""Versioned SQL migrations with checksums and a backup before upgrading an existing database."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from dataclasses import dataclass
from importlib import resources
from pathlib import Path

from fundedflow_collector.clock import SystemClock, format_instant

MIGRATION_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


class MigrationError(Exception):
    pass


def bundled_migrations() -> list[Migration]:
    found = []
    for entry in resources.files("fundedflow_collector.db.migrations").iterdir():
        match = MIGRATION_NAME.match(entry.name)
        if match:
            text = entry.read_text(encoding="utf-8").replace("\r\n", "\n")
            found.append(Migration(int(match.group(1)), match.group(2), text))
    found.sort(key=lambda m: m.version)
    for expected, migration in enumerate(found, start=1):
        if migration.version != expected:
            raise MigrationError(f"migration numbering gap at {migration.version:04d}")
    return found


def current_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").fetchone()
    if row is None:
        return 0
    value = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0]
    return int(value)


def apply_migrations(conn: sqlite3.Connection, db_path: Path | None, migrations: list[Migration] | None = None) -> int:
    """Apply pending migrations. Returns the number applied. Refuses if an applied migration has changed."""
    migrations = bundled_migrations() if migrations is None else migrations
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL,"
        " sha256 TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT"
    )
    applied = {
        int(r["version"]): str(r["sha256"]) for r in conn.execute("SELECT version, sha256 FROM schema_migrations")
    }
    for migration in migrations:
        recorded = applied.get(migration.version)
        if recorded is not None and recorded != migration.sha256:
            raise MigrationError(
                f"migration {migration.version:04d}_{migration.name} has changed since it was applied; "
                "restore the original file"
            )
    pending = [m for m in migrations if m.version not in applied]
    if pending and applied and db_path is not None and db_path.exists():
        backup(conn, db_path.with_name(f"{db_path.name}.bak-{max(applied):04d}"))
    for migration in pending:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for statement in _split_statements(migration.sql):
                conn.execute(statement)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)",
                (migration.version, migration.name, migration.sha256, format_instant(SystemClock().now())),
            )
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
    return len(pending)


def _split_statements(sql: str) -> list[str]:
    """Split a migration into statements, keeping CREATE TRIGGER ... END blocks whole."""
    statements: list[str] = []
    buffer: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not buffer and (not stripped or stripped.startswith("--")):
            continue
        buffer.append(line)
        candidate = "\n".join(buffer)
        if sqlite3.complete_statement(candidate):
            statements.append(candidate)
            buffer = []
    if "".join(buffer).strip():
        raise MigrationError("migration ends with an incomplete statement")
    return statements


def backup(conn: sqlite3.Connection, target: Path) -> None:
    dest = sqlite3.connect(target)
    try:
        conn.backup(dest)
    finally:
        dest.close()


def recover_interrupted_runs(conn: sqlite3.Connection) -> int:
    """Mark runs left `running` by a crash or Ctrl+C as `aborted`. Their attempts and snapshots are kept."""
    now = format_instant(SystemClock().now())
    cur = conn.execute(
        "UPDATE crawl_runs SET status = 'aborted', finished_at = ? WHERE status = 'running'", (now,)
    )
    return cur.rowcount
