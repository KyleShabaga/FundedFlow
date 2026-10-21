"""The desktop window, driven through its own methods with the window hidden. No network: practice mode replays the
synthetic fixture site, and live runs are checked only up to the point where they would refuse to start."""

from __future__ import annotations

import json
import os
import tkinter as tk
from collections.abc import Iterator
from pathlib import Path

import pytest

from fundedflow_collector.clock import FakeClock
from fundedflow_collector.config import load_settings
from fundedflow_collector.gui.app import ALL_FIRMS, CollectorApp
from fundedflow_collector.gui.widgets import FormDialog
from tests.conftest import CAPTURES, FIXTURE_SITE, PROJECT


class Recorder:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str, str]] = []
        self.answer = True

    def notify(self, kind: str, title: str, message: str) -> None:
        self.messages.append((kind, title, message))

    def ask(self, title: str, message: str) -> bool:
        self.messages.append(("ask", title, message))
        return self.answer

    def errors(self) -> list[str]:
        return [m for kind, _t, m in self.messages if kind == "error"]


@pytest.fixture(scope="session")
def tk_root() -> Iterator[tk.Tk]:
    """One Tk interpreter for the whole session (repeatedly creating Tk roots is unreliable on Windows)."""
    try:
        window = tk.Tk()
    except tk.TclError as exc:  # no display available
        pytest.skip(f"Tk is not available: {exc}")
    window.withdraw()
    yield window
    window.destroy()


@pytest.fixture
def root(tk_root: tk.Tk) -> Iterator[tk.Toplevel]:
    window = tk.Toplevel(tk_root)
    window.withdraw()
    yield window
    window.destroy()


@pytest.fixture
def ui(root: tk.Toplevel) -> Iterator[tuple[CollectorApp, Recorder]]:
    recorder = Recorder()
    app = CollectorApp(
        root,
        clock=FakeClock(),
        threaded=False,
        notify=recorder.notify,
        ask=recorder.ask,
        browser_check=lambda: (False, "not used in GUI tests"),
    )
    yield app, recorder
    app.close()


def tree_values(tree: object, column: int = 0) -> list[str]:
    from tkinter import ttk

    assert isinstance(tree, ttk.Treeview)
    return [str(tree.item(i, "values")[column]) for i in tree.get_children()]


def log_text(app: CollectorApp) -> str:
    return app.fetch_log.get("1.0", "end")


def test_first_start_creates_database_and_settings(ui: tuple[CollectorApp, Recorder]) -> None:
    app, _ = ui
    data = Path(os.environ["FFC_DATA_DIR"])
    assert (data / "collector.db").exists()
    assert (data / "collector.toml").exists()
    labels = tree_values(app.checks, 1)
    assert "banned packages" in labels and "user-agent info URL" in labels
    assert "refused" in app.ua_preview.get()


def test_saving_the_info_url_enables_the_user_agent(ui: tuple[CollectorApp, Recorder]) -> None:
    app, recorder = ui
    app.info_url.set("https://example.invalid/ffc")
    app.contact.set("ops@example.invalid")
    app.guard(app.save_user_agent)
    assert recorder.errors() == []
    settings, _ = load_settings(app.config_file)
    assert settings.user_agent.info_url == "https://example.invalid/ffc"
    assert "FundedFlowCollector/0.1; +https://example.invalid/ffc; ops@example.invalid" in app.ua_preview.get()
    assert "[pacing]" in app.config_file.read_text(encoding="utf-8")  # other sections are kept
    app.info_url.set("http://insecure.example.invalid/")
    app.guard(app.save_user_agent)
    assert recorder.errors() and "https" in recorder.errors()[-1]


def test_registry_workflow_through_the_window(ui: tuple[CollectorApp, Recorder]) -> None:
    app, recorder = ui
    app.add_firm("sample-funding", "Sample Funding Co (synthetic)", "https://www.sample-funding.test/")
    assert tree_values(app.firms) == ["sample-funding"]
    app.add_host("www.sample-funding.test", "homepage")
    blocked = app.record_terms("www.sample-funding.test", "unclear", "https://www.sample-funding.test/terms")
    assert blocked.startswith("Live fetching: not allowed")
    allowed = app.record_terms(
        "www.sample-funding.test",
        "unclear",
        "https://www.sample-funding.test/terms",
        notes="No clause found",
        accept_unclear=True,
    )
    assert allowed == "Live fetching: allowed."
    assert tree_values(app.hosts, 2) == ["unclear (acknowledged)"]
    app.add_source("https://www.sample-funding.test/program-rules", "page", label="Program rules", priority="10")
    assert tree_values(app.sources) == ["https://www.sample-funding.test/program-rules"]
    app.sources.selection_set(app.sources.get_children()[0])
    app.toggle_source()
    assert tree_values(app.sources, 4) == ["no"]
    for bad in (
        lambda: app.add_firm("Bad Key", "x", "https://x.test/"),
        lambda: app.add_host("10.0.0.1", "homepage"),
        lambda: app.add_source("https://elsewhere.test/rules", "page"),
        lambda: app.add_firm("ok-firm", "x", "https://ok.test/", max_fetches="lots"),
    ):
        app.guard(bad)
    assert len(recorder.errors()) == 4
    assert "sample-funding" in list(app.fetch_firm.cget("values"))


def test_practice_fetch_results_capture_and_export(ui: tuple[CollectorApp, Recorder], tmp_path: Path) -> None:
    app, recorder = ui
    app.import_firm_file(PROJECT / "config" / "firms" / "example-firm.toml")
    assert tree_values(app.firms) == ["example-firm"]

    app.fetch_firm.set("example-firm")
    app.dry_run.set(True)
    app.start_fetch()
    assert "Preview for example-firm" in log_text(app)

    app.dry_run.set(False)
    app.practice.set(True)
    app.practice_dir.set(str(FIXTURE_SITE))
    app.use_browser.set(False)
    app.start_fetch()
    log = log_text(app)
    assert "new_snapshot" in log and "robots_blocked" in log and "example-firm: completed" in log
    assert not any(kind == "ask" for kind, _t, _m in recorder.messages)  # practice mode needs no confirmation
    assert recorder.errors() == []
    assert tree_values(app.runs, 1) == ["example-firm"]
    assert "new_snapshot" in tree_values(app.attempts)
    app.attempts.selection_set(app.attempts.get_children()[-1])
    app.explain_attempt()
    assert "What to do" in app.attempt_help.get()
    app.snaps.selection_set(app.snaps.get_children()[0])
    app.show_snapshot()
    assert "unverified evidence" in app.snap_text.get("1.0", "end")

    app.capture_firm.set("example-firm")
    app.capture_url.set("https://www.example-firm.test/payouts")
    app.capture_file.set(str(CAPTURES / "sample-funding-payouts.html"))
    app.capture_time.set("2026-10-20T14:30:00Z")
    app.guard(app.import_capture_now)
    assert recorder.errors() == []
    assert "manual_capture" in app.capture_result.get("1.0", "end")

    out = tmp_path / "evidence.json"
    app.export_path.set(str(out))
    app.export_csv.set(True)
    app.guard(app.export_now)
    assert recorder.errors() == []
    assert "collector-snapshot-v1: valid" in app.export_result.get("1.0", "end")
    assert json.loads(out.read_text(encoding="utf-8"))["verification_status"] == "unverified"
    assert out.with_suffix(".csv").exists()
    assert app.validate_file(out) == []
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    assert app.validate_file(bad)


def test_live_runs_ask_first_and_refuse_without_an_info_url(ui: tuple[CollectorApp, Recorder]) -> None:
    app, recorder = ui
    app.import_firm_file(PROJECT / "config" / "firms" / "example-firm.toml")
    app.fetch_firm.set(ALL_FIRMS)
    app.dry_run.set(False)
    app.practice.set(False)
    recorder.answer = False
    app.start_fetch()
    assert recorder.messages[-1][0] == "ask"
    assert "fetch" not in log_text(app)
    recorder.answer = True
    app.start_fetch()  # no info URL saved: refused before any request is made
    assert any("info_url" in e for e in recorder.errors())
    assert tree_values(app.runs) == []


def test_bad_fetch_options_are_reported(ui: tuple[CollectorApp, Recorder]) -> None:
    app, recorder = ui
    app.import_firm_file(PROJECT / "config" / "firms" / "example-firm.toml")
    app.fetch_firm.set("example-firm")
    app.max_fetches.set("500")
    app.start_fetch()
    app.max_fetches.set("")
    app.practice.set(True)
    app.practice_dir.set(str(PROJECT / "no-such-folder"))
    app.start_fetch()
    assert len(recorder.errors()) == 2


def test_form_dialog_returns_values(root: tk.Toplevel) -> None:
    from fundedflow_collector.gui.widgets import Field

    dialog = FormDialog(root, "Test", [Field("name", "Name", default="x"), Field("ok", "Tick", "check", default=True)])
    dialog._ok()
    assert dialog.result == {"name": "x", "ok": True}


# ---------------------------------------------------------------- comparison publishers (Build 29.25)


def review_publisher(app: CollectorApp, key: str, host: str) -> None:
    app.research.publishers.selection_set(key)
    app.research.refresh_detail()
    message = app.research.record_terms(host, "unclear", "https://example.invalid/terms", accept_unclear=True)
    assert message == "Live fetching: allowed."
    app.research.set_enabled(True)


def test_research_sources_presets_policy_gates_and_preview(ui: tuple[CollectorApp, Recorder]) -> None:
    app, recorder = ui
    app.research.refresh_detail()
    assert "No publishers yet" in app.research.policy.get("1.0", "end")
    app.research.install_preset("onlypropfirms")
    assert tree_values(app.research.publishers) == ["onlypropfirms"]
    assert tree_values(app.research.publishers, 1) == ["Not reviewed"]
    policy = app.research.policy.get("1.0", "end")
    assert "third-party comparison publisher" in policy and "Policy review recorded 2026-10-21" in policy
    assert len(tree_values(app.research.pages)) == 4
    app.guard(lambda: app.research.set_enabled(True))
    assert any("record a terms review" in e for e in recorder.errors())
    app.guard(lambda: app.research.add_host("www.northwind-futures.test"))
    app.guard(lambda: app.research.add_seed("https://onlypropfirms.com/go/northwind"))
    assert len(recorder.errors()) == 3
    app.research.preview()  # works while disabled: shows what each request would meet
    log = log_text(app)
    assert "Preview for publisher:onlypropfirms" in log and "terms_blocked" in log and "Planned:" in log
    review_publisher(app, "onlypropfirms", "onlypropfirms.com")
    assert tree_values(app.research.publishers, 2) == ["yes"]
    app.research.update_settings(mode="manual_only")
    assert tree_values(app.research.publishers, 1) == ["Needs manual capture"]
    assert tree_values(app.research.publishers, 2) == ["no"]


def test_publisher_practice_fetch_counts_evidence_and_review(ui: tuple[CollectorApp, Recorder]) -> None:
    from tests.conftest import DIRECTORY_SITE

    app, recorder = ui
    app.add_firm("northwind-futures", "Northwind Futures", "https://www.northwind-futures.test/")
    app.evidence.refresh()
    assert "No observations yet" in str(app.evidence.empty.cget("text"))
    for key, host in (("onlypropfirms", "onlypropfirms.com"), ("traderssecondbrain", "traderssecondbrain.com")):
        app.research.install_preset(key)
        review_publisher(app, key, host)
    app.research.install_preset("propfirmmatch-futures")
    app.select_publishers_for_fetch(["onlypropfirms", "traderssecondbrain"])
    assert app.selected_publishers() == ["onlypropfirms", "traderssecondbrain"]
    app.dry_run.set(False)
    app.practice.set(True)
    app.practice_dir.set(str(DIRECTORY_SITE))
    app.use_browser.set(False)
    app.start_fetch()
    assert recorder.errors() == []
    assert not any(kind == "ask" for kind, _t, _m in recorder.messages)
    log = log_text(app)
    assert "publisher:onlypropfirms: completed" in log and "pages read:" in log
    sites = {row[0]: row for row in (app.site_results.item(i, "values") for i in app.site_results.get_children())}
    assert set(sites) == {"publisher:onlypropfirms", "publisher:traderssecondbrain"}
    assert int(sites["publisher:onlypropfirms"][2]) >= 5  # collected
    assert "structure_changed" in sites["publisher:onlypropfirms"][7]

    evidence = app.evidence
    evidence.refresh()
    assert "unverified third-party claim" in evidence.banner.get() and "conflicting" in evidence.banner.get()
    firms = [evidence.tree.item(i, "text") for i in evidence.node_ids()]
    assert any("Northwind Futures" in f and "northwind-futures" in f for f in firms)  # exact-name mapping shown
    evidence.set_filters(search="contoso")
    assert all("Contoso" in str(evidence.tree.item(i, "text")) for i in evidence.node_ids())
    evidence.set_filters(search="", status="conflicting")
    assert evidence.node_ids() and all(evidence.tree.item(i, "values")[2] == "conflicting" for i in evidence.node_ids())
    evidence.set_filters(status="All", publisher="onlypropfirms")
    firm_node = next(i for i in evidence.node_ids() if "Northwind" in str(evidence.tree.item(i, "text")))
    programme = evidence.node_ids(firm_node)[0]
    record = evidence.node_ids(programme)[0]
    evidence.select_node(record)
    first = evidence.fields.get_children()[0]
    details = evidence.show_observation(str(first))
    assert "Unverified third-party claim." in details and "Snapshot" in details and "History of this value" in details
    assert "northwind-futures's own stored pages" in details

    items = {i.kind: i for i in evidence.items}
    assert {"conflict", "duplicate", "uncertain_identity"} <= set(items)
    evidence.mark_separate(items["uncertain_identity"].key, "different companies")
    evidence.annotate(items["conflict"].key, "asked both publishers", dismiss=True)
    dismissed = {i.key for i in evidence.items if i.dismissed}
    assert {items["uncertain_identity"].key, items["conflict"].key} <= dismissed
    app.guard(lambda: evidence.mark_separate(items["duplicate"].key))
    app.guard(lambda: evidence.verify(str(first), "snap_nonexistent", "checked"))
    assert len(recorder.errors()) == 2

    app.select_publishers_for_fetch(["propfirmmatch-futures"])
    app.practice.set(False)
    app.start_fetch()  # manual-only: refused before any request
    assert "not enabled for live collection" in recorder.errors()[-1]
    app.select_publishers_for_fetch(["onlypropfirms"])
    recorder.answer = False
    app.start_fetch()
    assert recorder.messages[-1][0] == "ask" and "onlypropfirms.com" in recorder.messages[-1][2]


def test_publisher_manual_capture_and_directory_export(ui: tuple[CollectorApp, Recorder], tmp_path: Path) -> None:
    from tests.conftest import DIRECTORY_CAPTURES

    app, recorder = ui
    app.research.install_preset("propfirmmatch-futures")
    app.capture_target.set("publisher")
    app.refresh_all()
    assert list(app.capture_firm.cget("values")) == ["propfirmmatch-futures"]
    app.capture_firm.set("propfirmmatch-futures")
    app.capture_url.set("https://propfirmmatch.com/futures/prop-firm-challenges")
    app.capture_file.set(str(DIRECTORY_CAPTURES / "propfirmmatch-futures-challenges.html"))
    app.capture_time.set("2026-10-21T12:00:00Z")
    app.guard(app.import_capture_now)
    assert recorder.errors() == []
    assert "read as   comparison, 3 records" in app.capture_result.get("1.0", "end")
    assert app.evidence.node_ids()
    out = tmp_path / "observations.json"
    app.export_path.set(str(out))
    app.guard(app.export_directory_now)
    assert recorder.errors() == []
    assert "collector-directory-observations-v1: valid" in app.export_result.get("1.0", "end")
    assert app.validate_file(out) == []
    document = json.loads(out.read_text(encoding="utf-8"))
    assert {f["verification_status"] for r in document["records"] for f in r["fields"]} == {"unverified"}
