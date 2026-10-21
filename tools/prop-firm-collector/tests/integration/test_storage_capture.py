"""SQLite migrations, recovery, immutability and constraints; manual capture with zero network."""

from __future__ import annotations

import socket
import sqlite3
from pathlib import Path

import pytest

from fundedflow_collector.capture import import_capture
from fundedflow_collector.clock import FakeClock
from fundedflow_collector.config import Settings
from fundedflow_collector.db import registry, runs
from fundedflow_collector.db.connection import DatabaseError, RunLock, open_database
from fundedflow_collector.db.migrate import (
    Migration,
    apply_migrations,
    bundled_migrations,
    current_version,
    recover_interrupted_runs,
)
from fundedflow_collector.outcomes import HostRole, Outcome, SourceKind, TermsDecision
from tests.conftest import CAPTURES, add_firm


def test_migrations_are_idempotent_and_checksummed(tmp_path: Path) -> None:
    path = tmp_path / "c.db"
    conn = open_database(path, create=True)
    assert current_version(conn) == len(bundled_migrations())
    assert apply_migrations(conn, path) == 0
    tampered = [Migration(m.version, m.name, m.sql + "\n-- edited\n") for m in bundled_migrations()]
    with pytest.raises(Exception, match="has changed"):
        apply_migrations(conn, path, tampered)


def test_backup_is_written_before_an_upgrade(tmp_path: Path) -> None:
    path = tmp_path / "c.db"
    conn = open_database(path, create=True)
    extra = [*bundled_migrations(), Migration(len(bundled_migrations()) + 1, "extra", "CREATE TABLE t (x INTEGER);")]
    assert apply_migrations(conn, path, extra) == 1
    assert (tmp_path / "c.db.bak-0001").exists()


def test_missing_database_is_reported(tmp_path: Path) -> None:
    with pytest.raises(DatabaseError, match="init-db"):
        open_database(tmp_path / "absent.db")


def test_interrupted_runs_are_marked_aborted(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(conn, clock)
    run_id = runs.start_run(
        conn, firm_id=firm.id, batch_id="b", command="fetch", now=clock.now(), options={}, config_sha256="x"
    )
    assert recover_interrupted_runs(conn) == 1
    assert runs.get_run(conn, run_id)["status"] == "aborted"  # type: ignore[index]


def test_run_lock_is_exclusive(tmp_path: Path) -> None:
    with RunLock(tmp_path), pytest.raises(DatabaseError, match="another collector command"):
        RunLock(tmp_path).__enter__()
    with RunLock(tmp_path):
        pass


def test_snapshots_attempts_and_policy_log_are_immutable(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(conn, clock)
    result = import_capture(
        conn,
        Settings(),
        clock,
        firm_key=firm.firm_key,
        url="https://www.example-firm.test/payouts",
        file=CAPTURES / "sample-funding-payouts.html",
    )
    for sql in (
        "UPDATE source_snapshots SET text = 'x'",
        "DELETE FROM source_snapshots",
        "UPDATE fetch_attempts SET outcome = 'x'",
        "DELETE FROM fetch_attempts",
        "UPDATE policy_events SET kind = 'x'",
        "DELETE FROM policy_events",
    ):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(sql)
    assert conn.execute("SELECT COUNT(*) FROM source_snapshots WHERE id = ?", (result.snapshot_id,)).fetchone()[0]


def test_constraints_reject_bad_rows(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(conn, clock)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO collector_firms (id, firm_key, display_name, homepage_url, created_at, updated_at)"
            " VALUES ('f2', 'Bad Key', 'x', 'https://a.test/', '2026-10-20T00:00:00.000Z',"
            " '2026-10-20T00:00:00.000Z')"
        )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO collector_sources (id, firm_id, canonical_url, kind, source_channel, created_at,"
            " updated_at) VALUES ('s', ?, 'ftp://a.test/', 'page', 'seed', 'x', 'x')",
            (firm.id,),
        )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO fetch_attempts (id, firm_id, requested_url, fetch_method, started_at, outcome)"
            " VALUES ('a', ?, 'https://a.test/', 'http', '2026-10-20T00:00:00.000Z', 'x')",
            (firm.id,),
        )
    with pytest.raises(registry.RegistryError):
        registry.add_firm(
            conn, firm_key=firm.firm_key, display_name="dup", homepage_url="https://a.test/", now=clock.now()
        )


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"firm_key": "Bad Key"}, "firm key"),
        ({"homepage_url": "javascript:alert(1)"}, "homepage"),
        ({"homepage_url": "https://10.0.0.1/"}, "IP-literal"),
        ({"max_fetches": 301}, "max fetches"),
        ({"excluded_paths": ["blog/*"]}, "excluded path"),
    ],
)
def test_invalid_registry_entries_fail_safely(
    conn: sqlite3.Connection, clock: FakeClock, kwargs: dict[str, object], message: str
) -> None:
    values: dict[str, object] = {"firm_key": "ok-firm", "display_name": "Ok", "homepage_url": "https://ok.test/"}
    values.update(kwargs)
    with pytest.raises(registry.RegistryError, match=message):
        registry.add_firm(conn, now=clock.now(), **values)  # type: ignore[arg-type]


def test_sources_must_be_on_authorised_document_hosts(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(
        conn,
        clock,
        hosts={
            "www.example-firm.test": (HostRole.HOMEPAGE, TermsDecision.ALLOWED),
            "cdn.example-firm.test": (HostRole.ASSET, None),
        },
    )
    with pytest.raises(registry.RegistryError, match="not an authorised"):
        registry.add_source(conn, firm, url="https://evil.test/rules", kind=SourceKind.PAGE, now=clock.now())
    with pytest.raises(registry.RegistryError, match="not an authorised"):
        registry.add_source(conn, firm, url="https://cdn.example-firm.test/x", kind=SourceKind.PAGE, now=clock.now())
    with pytest.raises(registry.RegistryError, match="zendesk"):
        registry.add_source(
            conn, firm, url="https://www.example-firm.test/help", kind=SourceKind.ZENDESK, now=clock.now()
        )
    with pytest.raises(registry.RegistryError):
        registry.add_host(conn, firm, "http://www.example-firm.test/path", HostRole.DOCS, clock.now())


def test_manual_capture_makes_zero_network_calls(
    conn: sqlite3.Connection, clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    firm = add_firm(
        conn, clock, "sample-funding", hosts={"www.sample-funding.test": (HostRole.HOMEPAGE, TermsDecision.PROHIBITED)}
    )

    def no_network(*args: object, **kwargs: object) -> object:
        raise AssertionError("manual capture must not touch the network")

    monkeypatch.setattr(socket, "getaddrinfo", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket.socket, "connect", no_network)
    results = [
        import_capture(
            conn,
            Settings(),
            clock,
            firm_key=firm.firm_key,
            url="https://www.sample-funding.test/payouts",
            file=CAPTURES / "sample-funding-payouts.html",
            captured_at="2026-10-20T14:30:00Z",
        ),
        import_capture(
            conn,
            Settings(),
            clock,
            firm_key=firm.firm_key,
            url="https://www.sample-funding.test/faq",
            file=CAPTURES / "sample-funding-faq.txt",
        ),
        import_capture(
            conn,
            Settings(),
            clock,
            firm_key=firm.firm_key,
            url="https://www.sample-funding.test/terms",
            file=CAPTURES / "sample-funding-terms.pdf",
        ),
    ]
    assert [r.outcome for r in results] == [Outcome.NEW_SNAPSHOT] * 3
    assert results[0].captured_at == "2026-10-20T14:30:00.000Z"
    row = conn.execute("SELECT * FROM source_snapshots WHERE id = ?", (results[0].snapshot_id,)).fetchone()
    assert row["fetch_method"] == "manual_capture" and row["source_channel"] == "manual_capture"
    assert "Profit split" in row["structure"]
    again = import_capture(
        conn,
        Settings(),
        clock,
        firm_key=firm.firm_key,
        url="https://www.sample-funding.test/payouts",
        file=CAPTURES / "sample-funding-payouts.html",
    )
    assert again.outcome is Outcome.UNCHANGED and again.snapshot_id == results[0].snapshot_id
    attempt = conn.execute("SELECT run_id FROM fetch_attempts WHERE fetch_method = 'manual_capture'").fetchone()
    assert attempt["run_id"] is None


def test_manual_capture_requires_a_registered_host_and_supported_file(
    conn: sqlite3.Connection, clock: FakeClock, tmp_path: Path
) -> None:
    firm = add_firm(conn, clock)
    with pytest.raises(registry.RegistryError, match="not registered"):
        import_capture(
            conn,
            Settings(),
            clock,
            firm_key=firm.firm_key,
            url="https://elsewhere.test/x",
            file=CAPTURES / "sample-funding-faq.txt",
        )
    docx = tmp_path / "page.docx"
    docx.write_bytes(b"PK")
    with pytest.raises(registry.RegistryError, match="html"):
        import_capture(
            conn, Settings(), clock, firm_key=firm.firm_key, url="https://www.example-firm.test/x", file=docx
        )
    with pytest.raises(ValueError, match="time zone"):
        import_capture(
            conn,
            Settings(),
            clock,
            firm_key=firm.firm_key,
            url="https://www.example-firm.test/x",
            file=CAPTURES / "sample-funding-faq.txt",
            captured_at="2026-10-20T14:30:00",
        )


def test_raw_bytes_are_off_by_default_and_prunable(conn: sqlite3.Connection, clock: FakeClock) -> None:
    firm = add_firm(conn, clock)
    import_capture(
        conn,
        Settings(),
        clock,
        firm_key=firm.firm_key,
        url="https://www.example-firm.test/a",
        file=CAPTURES / "sample-funding-faq.txt",
    )
    assert conn.execute("SELECT COUNT(*) FROM raw_payloads").fetchone()[0] == 0
    keep = Settings.model_validate({"raw": {"retain": True, "retention_days": 1}})
    import_capture(
        conn,
        keep,
        clock,
        firm_key=firm.firm_key,
        url="https://www.example-firm.test/b",
        file=CAPTURES / "sample-funding-payouts.html",
    )
    assert conn.execute("SELECT COUNT(*) FROM raw_payloads").fetchone()[0] == 1
    from fundedflow_collector.db.snapshots import prune_raw

    assert prune_raw(conn, clock.now()) == 0
    clock.advance(2 * 86400)
    assert prune_raw(conn, clock.now()) == 1
    assert conn.execute("SELECT COUNT(*) FROM source_snapshots").fetchone()[0] == 2
